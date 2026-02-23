# Makefile for LoveMetrics React App

# Variables
NPM := npm
PACKAGE_MANAGER := npm

.PHONY: all install dev build clean setup test test-frontend test-backend test-e2e

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