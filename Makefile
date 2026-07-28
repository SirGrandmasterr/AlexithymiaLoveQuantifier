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
# there is Nginx, which does not proxy /uploads.
ANDROID_API_URL ?= http://212.132.80.55:8082/login
ANDROID_OUT := dist-android
ANDROID_IMAGE := alq-android-build
GRADLE_TASK ?= assembleDebug

.PHONY: all install dev build clean setup test test-frontend test-backend test-e2e \
        up down logs db-wait db-shell db-schema db-backup db-restore db-reset db-password \
        migrate migrate-check migrate-local migrate-check-local help \
        android-init build-android bundle-android dev-android run-android \
        android-install android-logs clean-android

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
	@echo "Android:    android-init, build-android, run-android, dev-android, clean-android"
	@echo "            android-install, android-logs, bundle-android KEYSTORE=..."
	@echo "            override the baked-in server with ANDROID_API_URL=http://host:port"