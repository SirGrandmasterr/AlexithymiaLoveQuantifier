# Makefile for LoveMetrics React App

# Variables
NPM := npm
PACKAGE_MANAGER := npm

# Docker / database. DB_USER and DB_NAME must match docker-compose.yml — the psql targets
# talk to the container directly, not through the backend.
DC := docker compose
DB_SERVICE := postgres
BACKEND_SERVICE := backend
DB_USER := postgres
DB_NAME := alexithymia
BACKUP_DIR := backups
PSQL := $(DC) exec -T $(DB_SERVICE) psql -v ON_ERROR_STOP=1 -U $(DB_USER) -d $(DB_NAME)

# One-off container rather than `exec`: the schema step has to be runnable when the backend
# is down or crash-looping, which is exactly when a migration is the thing you need.
MIGRATE := $(DC) run --rm $(BACKEND_SERVICE) ./migrate

.PHONY: all install dev build clean setup test test-frontend test-backend test-e2e \
        up down logs db-wait db-shell db-schema db-backup db-restore db-reset \
        migrate migrate-check migrate-local migrate-check-local help

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

help:
	@echo "Stack:      up, down, logs"
	@echo "Migrations: migrate, migrate-check, migrate-local, migrate-check-local"
	@echo "Database:   db-shell, db-schema, db-backup, db-restore FILE=..., db-reset CONFIRM=yes, db-wait"
	@echo "Frontend:   install, dev, build, preview, clean"
	@echo "Tests:      test, test-frontend, test-backend, test-e2e"