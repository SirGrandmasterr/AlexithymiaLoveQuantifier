# Makefile for LoveMetrics React App

# ---------------------------------------------------------------------------
# Shell selection (Windows)
#
# Every recipe in this file is POSIX — rm, test, seq, date, ls, cp, command -v. GNU Make on
# Windows uses sh.exe *when it happens to find one on PATH* and silently falls back to cmd.exe
# otherwise, so whether this file works depended on which terminal you launched it from: fine
# from Git Bash, and from PowerShell it failed on the first recipe line with cmd's own error,
# e.g. `mkdir -p` reported as "A subdirectory or file dist-android already exists."
#
# Pinning the shell removes that dependency on the caller's PATH.
#
# Git's bin/sh.exe rather than usr/bin/sh.exe: the former is the wrapper that also puts the
# MSYS coreutils on PATH, and the bare one starts a shell that cannot find `ls`.
#
# Deliberately NOT C:\Windows\System32\bash.exe — that is the WSL launcher, and recipes would
# run against a different filesystem and a different Docker context than the one you are in.
#
# If Git is installed elsewhere this stays empty and Make keeps its default behaviour, which
# is correct inside Git Bash. Nothing here applies on Linux or macOS.
# ---------------------------------------------------------------------------
ifeq ($(OS),Windows_NT)
  # $(wildcard) rather than a $(shell) probe, because the probe would have to be written in
  # one shell's syntax and this runs under both: a cmd-syntax `if exist` test emits
  # `syntax error: unexpected end of file` on every single invocation from Git Bash, where
  # Make has already found sh on PATH. $(wildcard) spawns nothing and is silent either way.
  # The backslash escapes the space in "Program Files"; without it Make reads two patterns.
  ifneq ($(wildcard C:/Program\ Files/Git/bin/sh.exe),)
    SHELL := C:/Program Files/Git/bin/sh.exe
    .SHELLFLAGS := -c

    # Setting SHELL is necessary but not sufficient. Make has a fast path: a recipe line with
    # no shell metacharacters is handed straight to CreateProcess instead of to SHELL, so
    # `ls -1 dist-android` never reaches sh and fails with
    #   process_begin: CreateProcess(NULL, ls -1 dist-android, ...) failed.
    # while the very similar `ls ... || true` works, because `||` forces the shell path.
    # Putting the coreutils on PATH fixes both routes rather than the one that happened to
    # be reported.
    #
    # Appended, not prepended: ahead of System32 these would shadow Windows' own find.exe
    # and sort.exe for every recipe. Nothing in this file needs that, and it is a nasty
    # surprise to leave lying around. Nothing here applies on Linux or macOS.
    export PATH := $(PATH);C:/Program Files/Git/usr/bin
  endif
endif

# Variables
NPM := npm
PACKAGE_MANAGER := npm

# Docker / database. DB_USER and DB_NAME must match POSTGRES_USER and POSTGRES_DB in .env —
# the psql targets talk to the container directly, not through the backend. Overridable
# (`make db-shell DB_USER=...`) rather than hardcoded, because .env is now where those names
# are chosen; the defaults are the values .env.example ships with.
DC := docker compose
DB_SERVICE := postgres
BACKEND_SERVICE := backend
DB_USER ?= postgres
DB_NAME ?= alexithymia
BACKUP_DIR := backups
PSQL := $(DC) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME)

# One-off container rather than `exec`: the schema step has to be runnable when the backend
# is down or crash-looping, which is exactly when a migration is the thing you need.
MIGRATE := $(DC) run --rm $(BACKEND_SERVICE) ./migrate

# Android. See docs/12-android-app.md.
#
# ANDROID_API_URL is compiled into the bundle as the *default* server address; the in-app
# Server settings screen overrides it and wins. 10.0.2.2 is the emulator's alias for the host
# — inside the emulator, localhost is the emulated device. Port 8080 is a bare
# `go run ./cmd/server`; under `make up` the backend is published on 8081 instead, and 8080
ANDROID_API_URL ?= https://api.alexithymialovequantifier.voglerprojekte.com
ANDROID_OUT := dist-android
ANDROID_IMAGE := alq-android-build
GRADLE_TASK ?= assembleDebug

.PHONY: all install dev build clean setup test test-frontend test-backend test-e2e \
        up down logs db-wait db-shell db-schema db-backup db-restore db-reset db-password \
        migrate migrate-check migrate-local migrate-check-local help \
        android-init build-android bundle-android dev-android run-android \
        android-install android-logs clean-android \
        models-fetch \
        journal-eval journal-audio-check journal-eval-scripts

# Default target
all: install build

# Install dependencies
install:
	@echo "Installing dependencies..."
	$(NPM) install

# Start development server
dev:
	@echo "Starting development server..."
	$(NPM) run dev

# Build for production
build:
	@echo "Building for production..."
	$(NPM) run build

# Preview production build
preview:
	@echo "Previewing production build..."
	$(NPM) run preview

# Clean node_modules (use with caution)
clean:
	@echo "Cleaning node_modules..."
	rm -rf node_modules package-lock.json

# Initial setup helper (installs deps and ensures git is ready)
setup: install
	@echo "Setup complete. Run 'make dev' to start."

# Testing commands
test-frontend:
	@echo "Running frontend tests (Vitest)..."
	$(NPM) run test

test-backend:
	@echo "Running backend tests (Go)..."
	cd backend && go test ./...

test-e2e:
	@echo "Running End-to-End tests (Playwright)..."
	@echo "Note: Ensure 'make dev' and the backend server are running."
	npx playwright test --project=chromium

test: test-frontend test-backend test-e2e

# ---------------------------------------------------------------------------
# Docker stack
# ---------------------------------------------------------------------------

# Database first, schema second, app third. The backend migrates itself on boot too, so the
# ordering is not what makes the schema correct — it is what makes a failed migration stop
# the start instead of leaving a server up and answering 500s.
up:
	@echo "Starting the database..."
	$(DC) up -d $(DB_SERVICE)
	@$(MAKE) --no-print-directory migrate
	@echo "Starting the application..."
	$(DC) up -d --build

down:
	@echo "Stopping the stack..."
	$(DC) down

logs:
	$(DC) logs -f $(BACKEND_SERVICE)

# ---------------------------------------------------------------------------
# Migrations
#
# The server also migrates on boot, so these targets are not the only path the schema can
# move — they are the addressable one. `migrate-check` is the target worth wiring into CI
# and into `up`: it fails loudly with the missing column named, instead of letting the gap
# surface later as a 500 from whichever endpoint happened to touch it first.
# ---------------------------------------------------------------------------

# Block until Postgres accepts connections. `docker compose up -d` returns as soon as the
# container starts, which is well before the database is listening.
db-wait:
	@echo "Waiting for Postgres..."
	@for i in $$(seq 1 60); do \
		if $(DC) exec -T $(DB_SERVICE) pg_isready -U $(DB_USER) -d $(DB_NAME) >/dev/null 2>&1; then \
			echo "Postgres is ready."; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Postgres did not become ready in 60s."; exit 1

# Apply the schema (AutoMigrate) and the relationship backfill.
migrate: db-wait
	@echo "Applying migrations..."
	$(MIGRATE)

# Report tables/columns the models declare but the database lacks. Writes nothing; exits 1
# on drift, so it is safe to run against any environment.
migrate-check: db-wait
	@echo "Checking schema against models..."
	$(MIGRATE) -check

# Same two targets against the SQLite fallback used when running the backend without
# Docker (DB_HOST unset -> backend/alexithymia.db). Needs a local Go toolchain.
migrate-local:
	@echo "Applying migrations to local SQLite database..."
	cd backend && go run ./cmd/migrate

migrate-check-local:
	@echo "Checking local SQLite schema against models..."
	cd backend && go run ./cmd/migrate -check

# ---------------------------------------------------------------------------
# Database utilities
# ---------------------------------------------------------------------------

db-shell:
	$(DC) exec $(DB_SERVICE) psql -U $(DB_USER) -d $(DB_NAME)

# Apply POSTGRES_PASSWORD from .env to a database that already exists.
#
# The POSTGRES_* variables are read by initdb, which runs exactly once — when the data
# directory is empty. So rotating the password in .env changes what the backend *presents*
# and not what Postgres *expects*, and the symptom is a backend that will not connect to a
# database that is running perfectly well. This closes that gap.
#
# It needs no old password: the connection goes over the container's unix socket, which the
# image initialises as trust, and reaching that socket already requires exec on the
# container. Restart the backend afterwards so it picks the new value out of .env.
db-password: db-wait
	@test -f .env || { echo "No .env — copy .env.example and fill it in."; exit 1; }
	@pw=$$(sed -n 's/^POSTGRES_PASSWORD=//p' .env | head -n 1); \
	test -n "$$pw" || { echo "POSTGRES_PASSWORD is unset or empty in .env"; exit 1; }; \
	$(DC) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME) \
		-c "ALTER USER \"$(DB_USER)\" WITH PASSWORD '$$pw';" >/dev/null
	@echo "Role $(DB_USER) now uses the password in .env."
	@echo "Restart the backend to pick it up: $(DC) up -d backend"

# What the database actually looks like right now — the first thing to read when a query
# fails with "column does not exist".
db-schema:
	@$(PSQL) -c '\d+ users' -c '\d+ relationships' -c '\d+ analysis_subjects'

db-backup: db-wait
	@mkdir -p $(BACKUP_DIR)
	@stamp=$$(date +%Y%m%d-%H%M%S); \
	$(DC) exec -T $(DB_SERVICE) pg_dump -U $(DB_USER) -d $(DB_NAME) > $(BACKUP_DIR)/$(DB_NAME)-$$stamp.sql; \
	echo "Wrote $(BACKUP_DIR)/$(DB_NAME)-$$stamp.sql"

# Restore a dump taken by db-backup: make db-restore FILE=backups/alexithymia-....sql
# The dump carries its own CREATE TABLE statements, so it wants an empty schema — run
# `make db-reset CONFIRM=yes` first if the tables are already there.
db-restore: db-wait
	@test -n "$(FILE)" || { echo "Usage: make db-restore FILE=backups/<dump>.sql"; exit 1; }
	@test -f "$(FILE)" || { echo "No such file: $(FILE)"; exit 1; }
	@echo "Restoring $(FILE) into $(DB_NAME)..."
	@$(PSQL) < "$(FILE)"
	@echo "Restored."

# Destructive: drops every table and re-migrates from empty. Guarded rather than
# interactive so it cannot be triggered by a stray tab-complete, and it takes a backup
# first regardless.
db-reset: db-wait
	@test "$(CONFIRM)" = "yes" || { echo "This DELETES all data in $(DB_NAME). Re-run with: make db-reset CONFIRM=yes"; exit 1; }
	@$(MAKE) --no-print-directory db-backup
	@echo "Dropping schema..."
	@$(PSQL) -c 'DROP SCHEMA public CASCADE;' -c 'CREATE SCHEMA public;'
	@$(MAKE) --no-print-directory migrate

# ---------------------------------------------------------------------------
# On-device model weights
#
# Phase 6 runs a transcriber, and later a proposal model, on the user's own device. The
# weights are served by Nginx from /models/, backed by the models_data volume — never baked
# into the frontend image, whose layers would grow by gigabytes, and never fetched by the app
# from a public model hub, which `connect-src 'self'` and the Vault page both forbid
# (product_vision/06-emotional-journal.md §5.6). This target is the operator step that fills
# that volume; docs/09-deployment.md §2 is the operator-facing version of it.
#
# Every file is pinned by URL *and* by SHA-256, and a mismatch fails the run rather than
# being repaired quietly. A weight file is code that runs on a user's device, so "the
# download looked plausible" is not a check. scripts/models-fetch.sh is the mechanism; the
# pins live here, so adding a model is editing a table and never editing logic.
#
# Two rules for whoever adds the next set:
#
#   Pin the revision, not a branch. A `.../resolve/main/...` URL is not a pin — the bytes
#   behind it can change while the URL does not, and the sum would then fail on the next
#   operator's first run with no way to tell a re-tag from tampering.
#
#   Do not add a large set to the MODELS default. whisper-tiny is 41 MB and is the floor the
#   Light tier needs; Gemma 4 E2B is 3.4 GB as ONNX and 2.6 GB as a LiteRT-LM bundle, and
#   EmbeddingGemma will be ~200-300 MB, and §5.6 has all of them opt-in.
#   `make models-fetch MODELS="whisper-tiny gemma-4-e2b-onnx"` is how they are asked for, and
#   an unknown name is refused before anything downloads.
#
#   Gemma is two sets rather than one because the two platforms need different files and
#   neither should pay for the other's: `gemma-4-e2b-onnx` is what the browser loads through
#   transformers.js, `gemma-4-e2b-litertlm` is the single bundle the Android plugin opens. An
#   operator serving only phones fetches 2.6 GB, not 6 GB. Both are needed only where both
#   kinds of client exist.
# ---------------------------------------------------------------------------

# Named explicitly in docker-compose.yml so it can be stated here rather than derived from
# the Compose project name, which is the checkout's directory name and differs between
# clones. This runs as a one-off container, not as a Compose service, because it has to work
# when the stack has never been up.
MODELS_VOLUME := love-metrics-models

# Pinned like everything else in this section. Alpine's busybox already provides sha256sum;
# the script adds curl, which is needed for the redirect Hugging Face answers weight URLs
# with and for a retry that distinguishes a 404 from a dropped connection.
MODELS_IMAGE := alpine:3.20

# Which sets to fetch. Override to add one:
#   make models-fetch MODELS="whisper-tiny gemma-4-e2b-onnx gemma-4-e2b-litertlm"
MODELS ?= whisper-tiny

# Light-tier transcriber: Whisper tiny, ONNX, int8-quantised, for transformers.js (§5.5).
#
# Each row lands at a path mirroring the Hugging Face repo id, because that is what
# transformers.js resolves against env.localModelPath — the base, then the model id, then the
# file. C3 should not have to rewrite paths to consume these.
#
# The two .onnx files are the quantised encoder and merged decoder that transformers.js loads
# by default for automatic-speech-recognition; together they are 41 MB, which is the measured
# answer to the "~40-75 MB (verify)" in §5.5. The rest is the tokeniser and the configs.
WHISPER_TINY_REV := ff4177021cc41f7db950912b73ea4fdf7d01d8e7
WHISPER_TINY_URL := https://huggingface.co/onnx-community/whisper-tiny/resolve/$(WHISPER_TINY_REV)
WHISPER_TINY_DIR := onnx-community/whisper-tiny

# The licence, fetched and pinned like any other row.
#
# These weights are an ONNX export of openai/whisper-tiny, which is Apache 2.0 — not MIT,
# which is the licence of OpenAI's Whisper *code* and which §5.5 of the design document
# carried until this was checked against the model card on 2026-08-25. Serving them from the
# operator's own machine is redistribution, and Apache 2.0 §4(a) wants the licence to travel
# with the copy, so it lands beside the weights rather than in a document nobody deploys.
# Neither Hugging Face repo ships a LICENSE file, so the canonical text is the source.
APACHE_20_URL := https://www.apache.org/licenses/LICENSE-2.0.txt
APACHE_20_SHA := cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30


# Full tier on the web: Gemma 4 E2B IT, ONNX, q4f16, for transformers.js over WebGPU (§5.5).
#
# Four sub-models, because `Gemma4ForConditionalGeneration` is four ONNX graphs and
# transformers.js opens a session for each: the token embedding table, the merged decoder,
# the audio encoder, and the vision encoder. The app never shows the model an image — the
# vision encoder is fetched because the model class declares the session, and it is 99 MB of
# a 3.4 GB download, which is not where a saving is.
#
# Every `.onnx` row here is a few hundred kilobytes of graph beside a `.onnx_data` row of
# weights. Both halves are required, and ONNX Runtime resolves the second by the name written
# inside the first — so they must land in the same directory, which is what these paths do.
#
# **3,401,460,010 bytes, 3.4 GB, measured 2026-09-02 from this revision.** §5.5 estimated
# "2-3 GB (verify)" and the design document now carries the measurement instead. q4f16 is the
# floor and not a preference: every other quantisation this repo offers is larger, and the
# 3.1 GB of it that is the language model is needed for the Light tier's text mode too.
GEMMA_E2B_ONNX_REV := 9f4bef82ea6e296bc69f8a2f5939f73af81b07a6
GEMMA_E2B_ONNX_URL := https://huggingface.co/onnx-community/gemma-4-E2B-it-ONNX/resolve/$(GEMMA_E2B_ONNX_REV)
GEMMA_E2B_ONNX_DIR := onnx-community/gemma-4-E2B-it-ONNX

# Full tier on Android: the same model as one LiteRT-LM bundle (§5.5 option A).
#
# One file, mixed 2/4/8-bit weights, opened by com.google.ai.edge.litertlm. The generic
# CPU/GPU bundle and not one of the six vendor builds beside it: those are NPU images for one
# SoC each, and picking the wrong one is a multi-gigabyte download that cannot run.
#
# **2,588,159,070 bytes with the licence, 2.6 GB, measured 2026-09-02** — which is §5.5's
# published 2,583 MB to the byte.
GEMMA_E2B_LITERTLM_REV := b3ca0d2f076785a8f4b2219ddbd2bdb99954eae1
GEMMA_E2B_LITERTLM_URL := https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/$(GEMMA_E2B_LITERTLM_REV)
GEMMA_E2B_LITERTLM_DIR := litert-community/gemma-4-E2B-it-litert-lm

# One row per file: set|path-under-the-volume|url|sha256
MODEL_MANIFEST := \
	whisper-tiny|$(WHISPER_TINY_DIR)/LICENSE.txt|$(APACHE_20_URL)|$(APACHE_20_SHA) \
	whisper-tiny|$(WHISPER_TINY_DIR)/config.json|$(WHISPER_TINY_URL)/config.json|46aeea0a406afbeb563fc8e59ca10609203df4299af6a83f73752fef369efd2d \
	whisper-tiny|$(WHISPER_TINY_DIR)/generation_config.json|$(WHISPER_TINY_URL)/generation_config.json|f5c67e5a4f7102f8cb4d058bc95da276bbc19eeec997267c3bb0f25ef68facd1 \
	whisper-tiny|$(WHISPER_TINY_DIR)/preprocessor_config.json|$(WHISPER_TINY_URL)/preprocessor_config.json|a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d \
	whisper-tiny|$(WHISPER_TINY_DIR)/tokenizer.json|$(WHISPER_TINY_URL)/tokenizer.json|27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566 \
	whisper-tiny|$(WHISPER_TINY_DIR)/tokenizer_config.json|$(WHISPER_TINY_URL)/tokenizer_config.json|2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce \
	whisper-tiny|$(WHISPER_TINY_DIR)/special_tokens_map.json|$(WHISPER_TINY_URL)/special_tokens_map.json|e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691 \
	whisper-tiny|$(WHISPER_TINY_DIR)/added_tokens.json|$(WHISPER_TINY_URL)/added_tokens.json|9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1 \
	whisper-tiny|$(WHISPER_TINY_DIR)/vocab.json|$(WHISPER_TINY_URL)/vocab.json|50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a \
	whisper-tiny|$(WHISPER_TINY_DIR)/merges.txt|$(WHISPER_TINY_URL)/merges.txt|2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6 \
	whisper-tiny|$(WHISPER_TINY_DIR)/normalizer.json|$(WHISPER_TINY_URL)/normalizer.json|bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd \
	whisper-tiny|$(WHISPER_TINY_DIR)/onnx/encoder_model_quantized.onnx|$(WHISPER_TINY_URL)/onnx/encoder_model_quantized.onnx|2af4a414ca47aa30f61246017e5fe82b0a8d229281d1255ba666a2a7f6b84d19 \
	whisper-tiny|$(WHISPER_TINY_DIR)/onnx/decoder_model_merged_quantized.onnx|$(WHISPER_TINY_URL)/onnx/decoder_model_merged_quantized.onnx|25e807a962b6349356d0ea5d0dfe530b7e5bf0e2a484aeca0359d03143faddd3 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/LICENSE.txt|$(APACHE_20_URL)|$(APACHE_20_SHA) \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/config.json|$(GEMMA_E2B_ONNX_URL)/config.json|5494e6677d9e150ea20ba3101ae8a32b0f141004626f052725d8bf48991b9faa \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/generation_config.json|$(GEMMA_E2B_ONNX_URL)/generation_config.json|e6a0b50de21a511f15ac4857b7f227f68ee60ecb1f11255d07b75e0bdc60e155 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/preprocessor_config.json|$(GEMMA_E2B_ONNX_URL)/preprocessor_config.json|4457c6e8a09070d7d5d1cd983fbfb67ebafe602bd98120c3543a024f5d07056b \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/processor_config.json|$(GEMMA_E2B_ONNX_URL)/processor_config.json|32bdf45d2ad4cc29a0822ddd157a182de76644f0419a6228d151495256e9813c \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/chat_template.jinja|$(GEMMA_E2B_ONNX_URL)/chat_template.jinja|781d10940fbc44be40064b5d43a056fc486c84ceaa55538226368b57314132bf \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/tokenizer.json|$(GEMMA_E2B_ONNX_URL)/tokenizer.json|47bd35616c7c782aaca6ccf48c75f3461d5877170984b8836b375107d0a9f566 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/tokenizer_config.json|$(GEMMA_E2B_ONNX_URL)/tokenizer_config.json|06afbf54e228050cba79c4a0afd83543cc89070a2d62b8337d0aa8b4cdc348c3 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/embed_tokens_q4f16.onnx|$(GEMMA_E2B_ONNX_URL)/onnx/embed_tokens_q4f16.onnx|d7ca53f6a169471b5699b2f57ee4c7aa2c73732b0152f3909e64b71384444825 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/embed_tokens_q4f16.onnx_data|$(GEMMA_E2B_ONNX_URL)/onnx/embed_tokens_q4f16.onnx_data|024b199e6358ed42970f807686add5f9430d7e254ca7ce22fc9c83f015b9c517 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/decoder_model_merged_q4f16.onnx|$(GEMMA_E2B_ONNX_URL)/onnx/decoder_model_merged_q4f16.onnx|73c0f1fe04f9a3a048fb3319c0671b6cf0346bf33a3a8624c853bcffe01c24a4 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/decoder_model_merged_q4f16.onnx_data|$(GEMMA_E2B_ONNX_URL)/onnx/decoder_model_merged_q4f16.onnx_data|3b27245a7396cb7039a4e4118bd2a8aa35106bae381522edf7c4867b5f22bb10 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/audio_encoder_q4f16.onnx|$(GEMMA_E2B_ONNX_URL)/onnx/audio_encoder_q4f16.onnx|5e0deb22791685c792d4b8e089deef9670fa4a4cecde434213d6a742e58fc3fa \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/audio_encoder_q4f16.onnx_data|$(GEMMA_E2B_ONNX_URL)/onnx/audio_encoder_q4f16.onnx_data|df58e61a00bafa9449ee5fd52895ce952f158bbdd1fe38df8a68f48f36842e62 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/vision_encoder_q4f16.onnx|$(GEMMA_E2B_ONNX_URL)/onnx/vision_encoder_q4f16.onnx|e0a4e48e519ade4eeddbb4cdadb812a7251aea871f7fb5f50576615fd3af22a3 \
	gemma-4-e2b-onnx|$(GEMMA_E2B_ONNX_DIR)/onnx/vision_encoder_q4f16.onnx_data|$(GEMMA_E2B_ONNX_URL)/onnx/vision_encoder_q4f16.onnx_data|0835071d2c79c105f8e1b549b7f8dd8c9af07fa95f01ead2e7add280602d3c6d \
	gemma-4-e2b-litertlm|$(GEMMA_E2B_LITERTLM_DIR)/LICENSE.txt|$(APACHE_20_URL)|$(APACHE_20_SHA) \
	gemma-4-e2b-litertlm|$(GEMMA_E2B_LITERTLM_DIR)/gemma-4-E2B-it.litertlm|$(GEMMA_E2B_LITERTLM_URL)/gemma-4-E2B-it.litertlm|181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c

models-fetch:
	@test -n "$(MODELS)" || { echo "MODELS is empty. Usage: make models-fetch MODELS=\"whisper-tiny\""; exit 1; }
	@docker volume inspect $(MODELS_VOLUME) >/dev/null 2>&1 || { \
		echo "Creating volume $(MODELS_VOLUME)..."; \
		docker volume create $(MODELS_VOLUME) >/dev/null; \
	}
	@echo "Fetching into $(MODELS_VOLUME): $(MODELS)"
	@# Piped in on stdin rather than bind-mounted. A -v with a *host path* is rewritten by
	@# MSYS's path conversion when this runs from Git Bash and the mount silently lands
	@# somewhere else; a named volume has no leading slash and is left alone. `tr` strips CR so
	@# the script still runs if this repo was cloned with autocrlf=true — there is no
	@# .gitattributes here, and /bin/sh reports a stray CR as the unhelpful `\r: not found`.
	@tr -d '\r' < scripts/models-fetch.sh | docker run --rm -i \
		-e MODELS="$(MODELS)" \
		-e MANIFEST="$(MODEL_MANIFEST)" \
		-v $(MODELS_VOLUME):/models \
		$(MODELS_IMAGE) sh -s


# ---------------------------------------------------------------------------
# The golden suite and the model gate (§5.7, session D4)
#
# `journal-eval` drives a candidate model through every case in
# src/journal/inference/golden/ at temperature 0 with the output schema as its grammar,
# scores it with the app's own validateProposal, and writes the report §5.7 gates on into
# product_vision/eval/. **A model does not become a tier default until its numbers are in a
# checked-in report.**
#
# It is deliberately not part of `npm test`: it needs weights and minutes. What *is* in
# `npm test` is the arithmetic underneath it — scripts/journal-eval/*.test.mjs cover the word
# error rate, the scoring and the gate, because a wrong number there would mis-state a gate
# result in a document somebody later trusts.
#
# With no arguments it runs the tier defaults. With CANDIDATE=reference it needs no weights at
# all and checks itself, which is the useful thing to run first on a new machine:
#
#   make journal-eval CANDIDATE=reference
#   make journal-eval --help                 (the candidate list)
#
# A real run needs a binary and a model, passed through the environment:
#
#   make journal-eval CANDIDATE=full-web \
#        JOURNAL_EVAL_LLAMA_BIN=/opt/llama.cpp/llama-mtmd-cli \
#        JOURNAL_EVAL_MODEL=/weights/gemma-4-E2B-it-Q4_K_M.gguf \
#        JOURNAL_EVAL_MMPROJ=/weights/mmproj-gemma-4-E2B.gguf
#
# scripts/journal-eval/README.md has the rest, including how to score a candidate that only
# runs on a phone.
#
# `journal-audio-check` is the other half: it says which of the 240 clips exist, whether they
# are the right format, and — the part that is a rule rather than a convenience — refuses any
# speaker directory that has no consent record beside it.
# ---------------------------------------------------------------------------

# Which candidate(s) to run. Empty means the tier defaults, which is what the gate is about.
CANDIDATE ?=

# Extra flags for the harness, e.g. EVAL_ARGS="--verbose --limit 8" while wiring a new runner up.
EVAL_ARGS ?=

journal-eval:
	@node scripts/journal-eval/run.mjs \
		$(if $(CANDIDATE),$(foreach c,$(CANDIDATE),--candidate $(c)),--tier-defaults) \
		$(EVAL_ARGS)

journal-audio-check:
	@node scripts/journal-eval/audio-check.mjs $(AUDIO_ARGS)

# Regenerates the two things a recording session is run from: the printable scripts, and this
# is also the command to run after adding a case to the golden suite.
journal-eval-scripts:
	@node product_vision/eval/build-recording-scripts.mjs

# ---------------------------------------------------------------------------
# Android
#
# Two paths, and it is worth knowing which you are on:
#
#   build-android    Everything in Docker. No JDK, no Android SDK, no Android Studio on the
#                    host. Regenerates android/ from the Capacitor template every run, so the
#                    APK depends on package-lock.json and Dockerfile.android rather than on
#                    local state. This is the reproducible one and the one CI should use.
#
#   dev-android      Live reload against a running Vite server. Needs local Android tooling
#                    (adb, a JDK, an emulator or a device) because it drives hardware, which
#                    a container cannot do for you. This is the one you develop against.
#
# android/ is generated and gitignored. Hand-edits go in android-config/, which both paths
# copy over the generated project.
# ---------------------------------------------------------------------------

# One-time local setup for the dev-android path. Not needed for build-android.
android-init:
	@echo "Installing dependencies..."
	$(NPM) install
	@if [ -d android ]; then \
		echo "android/ already exists — syncing instead of regenerating."; \
	else \
		echo "Generating the native project..."; \
		npx cap add android; \
	fi
	@echo "Applying android-config/ overlay..."
	@cp -r android-config/. android/
	@npx cap sync android
	@echo "Done. 'make dev-android' for live reload, or open android/ in Android Studio."

# Build the APK in Docker and export it to $(ANDROID_OUT)/.
#
# --output writes the artefacts straight to the host from the scratch stage, so there is no
# container to create and copy out of. Needs BuildKit, which is the default in current Docker;
# on an older engine, export DOCKER_BUILDKIT=1.
build-android:
	@echo "Building Android APK in Docker (API default: $(ANDROID_API_URL))..."
	@# No mkdir: BuildKit's local exporter creates the destination itself. Calling `mkdir -p`
	@# first was redundant and was the line that failed under cmd.exe, which has no -p.
	docker build \
		-f Dockerfile.android \
		--target artifacts \
		--build-arg VITE_ANDROID_API_URL=$(ANDROID_API_URL) \
		--build-arg GRADLE_TASK=$(GRADLE_TASK) \
		--output type=local,dest=$(ANDROID_OUT) \
		.
	@echo ""
	@echo "Artefacts in $(ANDROID_OUT)/:"
	@ls -1 $(ANDROID_OUT)
	@echo ""
	@echo "Install on a running device with: make android-install"

# Release bundle for the Play Store.
#
# Gradle produces an *unsigned* AAB here and jarsigner signs it afterwards, deliberately: the
# alternative is a signingConfig block in android/app/build.gradle, and android/ is
# regenerated on every build. Keeping the keystore out of the Gradle files also keeps it out
# of the build context and therefore out of any image layer.
bundle-android:
	@test -n "$(KEYSTORE)" || { echo "Usage: make bundle-android KEYSTORE=path/to/release.jks KEYSTORE_PASS=... KEY_ALIAS=..."; exit 1; }
	@test -f "$(KEYSTORE)" || { echo "No such keystore: $(KEYSTORE)"; exit 1; }
	@$(MAKE) --no-print-directory build-android GRADLE_TASK=bundleRelease
	@echo "Signing $(ANDROID_OUT)/app-release.aab..."
	jarsigner -verbose -sigalg SHA256withRSA -digestalg SHA-256 \
		-keystore "$(KEYSTORE)" \
		-storepass "$(KEYSTORE_PASS)" \
		"$(ANDROID_OUT)/app-release.aab" "$(KEY_ALIAS)"
	@echo "Signed. Upload $(ANDROID_OUT)/app-release.aab to the Play Console."

# Live reload: the WebView loads from the Vite dev server instead of the bundled assets, so a
# save on the host reloads the app on the device. Editing a React component is then the same
# loop it is on the web.
#
# --external makes Vite listen on 0.0.0.0 rather than localhost: a physical device has to
# reach your machine across the network, and the default binding refuses that connection.
# Capacitor picks the host address and rewrites its own config; nothing is committed.
dev-android:
	@command -v adb >/dev/null 2>&1 || { echo "adb not found. 'make dev-android' drives real hardware and needs local Android platform-tools. Use 'make build-android' for a container-only build."; exit 1; }
	@test -d android || { echo "No android/ directory. Run 'make android-init' first."; exit 1; }
	@echo "Devices:"
	@adb devices
	@echo "Starting Vite and launching with live reload..."
	npx cap run android --live-reload --external

# Install and launch the bundled build on a connected device. No dev server involved: this is
# the artefact a user would get, which is what makes it worth running before a release.
run-android: build-android android-install

android-install:
	@command -v adb >/dev/null 2>&1 || { echo "adb not found — install Android platform-tools."; exit 1; }
	@test -f $(ANDROID_OUT)/app-debug.apk || { echo "No APK in $(ANDROID_OUT)/. Run 'make build-android' first."; exit 1; }
	@echo "Installing on the connected device..."
	adb install -r $(ANDROID_OUT)/app-debug.apk
	adb shell monkey -p com.thinkmusic.alexithymia -c android.intent.category.LAUNCHER 1

# The WebView logs console.* to logcat under the 'Capacitor/Console' tag, so a JavaScript
# error in the packaged app is readable here — the first place to look when the app works
# under `npm run dev` and not on the device.
android-logs:
	@command -v adb >/dev/null 2>&1 || { echo "adb not found — install Android platform-tools."; exit 1; }
	adb logcat -v color Capacitor:V Capacitor/Console:V chromium:V AndroidRuntime:E '*:S'

# Build artefacts and caches. android/ goes too — it is generated, and a stale copy is the
# usual reason a build succeeds in Docker and fails locally.
clean-android:
	@echo "Removing generated Android project and artefacts..."
	rm -rf android $(ANDROID_OUT)
	@echo "Removing Gradle and Capacitor caches..."
	rm -rf .gradle
	@echo "Removing the Docker build cache for this image..."
	-docker builder prune --filter type=exec.cachemount --force
	@echo "Clean. 'make android-init' regenerates the project."

help:
	@echo "Stack:      up, down, logs"
	@echo "Migrations: migrate, migrate-check, migrate-local, migrate-check-local"
	@echo "Database:   db-shell, db-schema, db-backup, db-restore FILE=..., db-reset CONFIRM=yes, db-wait"
	@echo "            db-password (apply POSTGRES_PASSWORD from .env to a live database)"
	@echo "Frontend:   install, dev, build, preview, clean"
	@echo "Tests:      test, test-frontend, test-backend, test-e2e"
	@echo "Models:     models-fetch (fills the weights volume; MODELS=\"whisper-tiny\")"
	@echo "Journal:    journal-eval (the golden suite against a model; CANDIDATE=reference needs no weights)"
	@echo "            journal-audio-check (which recordings exist and whether they can be used)"
	@echo "            journal-eval-scripts (regenerate the printable recording scripts)"
	@echo "Android:    android-init, build-android, run-android, dev-android, clean-android"
	@echo "            android-install, android-logs, bundle-android KEYSTORE=..."
	@echo "            override the baked-in server with ANDROID_API_URL=http://host:port"