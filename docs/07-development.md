# 07 — Development Workflow

---

## 1. Prerequisites

| Tool | Version | Needed for |
| :--- | :------ | :--------- |
| Node.js | 20+ (the Docker build uses `node:22-alpine`; CI uses `lts/*`) | Frontend, Vitest, Playwright |
| Go | 1.24.1+ | Backend |
| Docker + Compose | any current | The containerised path only |
| PostgreSQL | 15 | **Optional** — omit it and the backend uses SQLite automatically |

You do **not** need a database installed to develop locally. With `DB_HOST` unset the backend
creates `backend/alexithymia.db` on first run.

---

## 2. Fastest path — no containers, no database

```bash
# Terminal 1 — backend on :8080, SQLite fallback
cd backend
go mod download
JWT_SECRET=dev-only-change-me go run ./cmd/server

# Terminal 2 — frontend on :5173, proxying to :8080
npm install
npm run dev
```

Open **http://localhost:5173**, sign up, and start analysing.

> **`JWT_SECRET` is required and the server will not start without it** — an unset secret is a
> fatal startup error rather than a silent empty signing key. On PowerShell:
> `$env:JWT_SECRET='dev-only-change-me'` once per terminal. Use a real value anywhere that is
> not your own machine — `openssl rand -hex 32`.

Expected backend log on a clean start:

```
No DB_HOST provided, falling back to local SQLite database: alexithymia.db
Database connection established
Running migrations...
Database migrated
backfill: 0 relationships, 0 snapshots linked
Server starting on port 8080...
```

Working-directory note: run the backend **from `backend/`**. Both the SQLite file and the
`./uploads` directory are resolved relative to the process CWD.

### With Postgres instead

Set the five variables and the driver switches — no code or flag change:

```bash
cd backend
DB_HOST=localhost DB_USER=postgres DB_PASSWORD=password \
DB_NAME=alexithymia DB_PORT=5432 JWT_SECRET=dev-only-change-me \
  go run ./cmd/server
```

The database named in `DB_NAME` must already exist; `AutoMigrate` creates tables, not databases.

---

## 3. Containerised path

```bash
docker-compose up --build
```

Then open **http://localhost:8082** — the Nginx container. Everything about this path is in
[Deployment](09-deployment.md). Rebuild with `--build` whenever `package.json` or `go.mod`
changes; Compose otherwise reuses cached layers.

---

## 4. Ports, at a glance

| Port | Process | Environment | Reachable from |
| :--- | :------ | :---------- | :------------- |
| **5173** | Vite dev server (default; not configured anywhere) | local dev | anywhere |
| **8080** | Go/Gin — hardcoded in [`main.go`](../backend/cmd/server/main.go) | local dev | anywhere |
| **8082** | Nginx (host) → container `:80`; `FRONTEND_PORT` in `.env` | Docker | anywhere |
| **8081** | Go/Gin direct (host) → container `:8080` | Docker | **this machine only** — bound to `127.0.0.1` |
| **5432** | Postgres | Docker | **containers on the `data` network only** — not published |

The frontend port is 8082 so it cannot collide with a local `go run ./cmd/server`. Reach Postgres
with `make db-shell`, which goes in through `docker compose exec` rather than a port.

---

## 5. Environment variables

The backend is the only process that reads any.

| Variable | Read at | Default | Effect |
| :------- | :------ | :------ | :----- |
| `DB_HOST` | `Connect()` | *(unset)* | **The driver switch.** Unset → SQLite `alexithymia.db`; set → Postgres |
| `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` | `Connect()` | — | Postgres connection details (only when `DB_HOST` is set) |
| `JWT_SECRET` | package init of `internal/auth`, re-read by `auth.LoadSecret()` | **none — startup fails** | HS256 signing key. `main()` calls `LoadSecret` before anything else and exits if it is unset or empty |

- The Go process reads the **real environment** — there is no `godotenv`. Under Compose the
  values come from `.env` through `${VAR:?}` interpolation in
  [`docker-compose.yml`](../docker-compose.yml), which fails the stack rather than defaulting.
  Copy [`.env.example`](../.env.example) to `.env` to start.
- `JWT_SECRET` is captured **before `main()` runs**, so it cannot be changed at runtime and
  cannot be set from inside a Go test — `t.Setenv` + `auth.LoadSecret()` is the pattern.
- Postgres TLS is off (`sslmode=disable`, hardcoded) and the port is not configurable.

---

## 6. Makefile targets

[`Makefile`](../Makefile) — thin npm wrappers, the test suites, and the Docker stack plus its
schema and database chores. `make help` prints the list.

| Target | Runs |
| :----- | :--- |
| `make install` / `dev` / `build` / `preview` / `all` | the corresponding npm scripts |
| `make clean` | **`rm -rf node_modules package-lock.json`** — deletes the lockfile, so the next install may resolve different versions. Prefer `rm -rf node_modules` alone |
| `make test-frontend` / `test-backend` / `test-e2e` / `test` | the three suites, and all three in sequence |
| `make journal-eval` / `journal-audio-check` | the model gate ([Testing §6](08-testing.md)) |
| `make up` | `docker compose up -d --build`, then waits for Postgres and runs `migrate-check` |
| `make down` / `logs` | `docker compose down` (keeps the volume); follow the backend log |
| `make migrate` | applies `AutoMigrate` + the relationship backfill to the compose Postgres |
| `make migrate-check` | reports missing tables/columns and exits 1; **writes nothing** |
| `make migrate-local` / `migrate-check-local` | the same two against the SQLite fallback |
| `make db-wait` / `db-shell` / `db-schema` | block until Postgres accepts connections; `psql` inside the container; `\d+` for every table |
| `make db-backup` / `db-restore FILE=…` | `pg_dump` → `backups/alexithymia-<timestamp>.sql` (gitignored), and replay |
| `make db-reset CONFIRM=yes` | **drops every table**, backs up first, then re-migrates |
| `make models-fetch` | downloads and verifies the pinned model weights into the volume |
| `make build-android` | builds the debug APK **entirely in Docker** → `dist-android/`; no local JDK or Android SDK |
| `make android-init` / `dev-android` / `run-android` / `android-logs` | live-reload setup, live reload, install-and-launch, filtered `adb logcat` |
| `make bundle-android KEYSTORE=…` | release AAB, signed with `jarsigner` |
| `make clean-android` | removes `android/`, `dist-android/`, `.gradle/`, and the Docker cache mount |

The Android targets are documented in [The Android App](12-android-app.md). Override the server
address compiled in as the default with `ANDROID_API_URL=http://host:port`.

**Windows.** The Makefile uses Unix `rm`, `seq`, `date`, `ls` and `cp`, and finds them itself:
when `C:\Program Files\Git\bin\sh.exe` exists it pins `SHELL` to it and appends Git's `usr/bin`
to `PATH`, both inside `ifeq ($(OS),Windows_NT)`.

Both assignments are needed, though one looks redundant: Make has a fast path that hands any
recipe line **without shell metacharacters** straight to `CreateProcess` rather than to `SHELL`.
So `ls -1 dist-android` bypasses the pinned shell and fails with
`process_begin: CreateProcess(NULL, ls -1 dist-android, ...) failed`, while the near-identical
`ls -1 dist-android || true` succeeds because `||` forces the shell route. Setting `SHELL` fixes
the second kind of line; extending `PATH` fixes the first.

`PATH` is **appended, not prepended** — ahead of `System32`, Git's `usr/bin` would shadow
Windows' own `find.exe` and `sort.exe` for every recipe. WSL's `System32\bash.exe` is
deliberately **not** used: recipes would run against a different filesystem and Docker context
than the shell you started from.

`make test-e2e` requires the dev server **and** the backend already running.

### Migrations

The server migrates itself on boot, and the Makefile targets call the same `Migrate()` through
[`backend/cmd/migrate`](../backend/cmd/migrate/main.go). There is no second code path and no
migration files: the models are the schema.

What is addressable is the *check*. `make migrate-check` answers "does this database match the
models?" without writing, naming the missing table or column outright — `make up` runs it after
every start, so drift is reported at boot rather than surfacing later as a 500 from whichever
endpoint happened to read the missing column first.

The check is deliberately one-directional: it reports what the models have and the database
lacks. A leftover column from a deleted field is not flagged, because `AutoMigrate` never drops
one either. Type and nullability changes are out of scope — GORM handles those differently per
engine, so a check claiming to cover them would be lying.

---

## 7. Repository layout

```
AlexithymiaLoveQuantifier/
├── docs/                       ← this documentation
├── product_vision/             the phase-6 spec, the invariants, and eval/
├── backend/                    Go service (see 05-backend.md)
├── src/                        React app (see 06-frontend.md)
│   ├── components/             one file per screen
│   ├── constants/              the taxonomy, the journal's vocabulary and copy
│   ├── context/                SubjectsContext, JournalContext
│   ├── journal/                recorder, inference/, embeddings/
│   ├── mobile/                 Android platform layer (see 12-android-app.md)
│   └── auth/                   session storage, renewal, interceptors
├── plugins/alq-journal/        the native Android plugin
├── scripts/journal-eval/       the model gate's harness
├── tests/e2e/                  the Playwright journey
├── .github/workflows/          playwright.yml, android-release.yml, deploy.yml
├── android-config/             committed native files, overlaid onto the generated project
├── android/                    GENERATED by `cap add`, gitignored — never hand-edit
├── capacitor.config.json       appId, androidScheme, CapacitorHttp
├── Dockerfile                  frontend: node build → nginx
├── Dockerfile.android          containerised APK/AAB build
├── nginx.conf                  SPA fallback + /api proxy + CSP
├── docker-compose.yml          frontend + backend + postgres
├── Makefile
├── README.md                   quick start; the detail is in docs/
├── Setup Guide.md              historical scaffold-from-scratch guide
└── TestImplementationDetails.txt  source prose for the seven categories
```

Two files are historical rather than operational. **`Setup Guide.md`** documents creating the
project from a bare Vite template; it predates the Go backend entirely and its "app lives in
`src/App.jsx`" instruction no longer matches reality — keep it for provenance, do not follow it.
**`TestImplementationDetails.txt`** is *not* a test document despite the name: it is the authored
prose for the seven categories, later transcribed into `CATEGORIES`, and it is the editorial
source of truth for that copy.

---

## 8. Everyday commands

```bash
# frontend
npm run dev            # Vite dev server, HMR, :5173
npm run build          # production bundle → dist/
npm run preview        # serve dist/ locally (no API proxy — use Docker instead)
npm run lint           # ESLint flat config — currently exits 2, see Known Issues
npm test               # vitest run (single pass, no watch)
npx vitest             # watch mode

# backend
cd backend
go run ./cmd/server
go test ./...
gofmt -l .             # CRLF files are listed here; that is pre-existing
go vet ./...

# e2e (needs both servers up)
npx playwright test --project=chromium
npx playwright show-report
```

`npm run preview` serves the built bundle but **applies no proxy** — `server.proxy` is a
dev-server-only setting — so API calls 404. Use `docker-compose up --build` to exercise a
production build against a live API.

---

## 9. Local development gotchas

1. **Run the backend from `backend/`.** Otherwise `alexithymia.db` and `uploads/` land in
   whatever directory you started from.
2. **`backend/alexithymia.db` is not gitignored.** Signing up locally creates it and dirties the
   working tree; a `git add .` would commit dev users and their bcrypt hashes. See
   [Known Issues](11-known-issues.md#the-development-sqlite-database-is-not-gitignored).
3. **`go test ./...` writes files.** `upload_test.go` leaves images in
   `backend/internal/handlers/uploads/` because its cleanup glob does not match the handler's
   naming scheme.
4. **Changing a `CATEGORIES` id orphans existing data.** Stored `stats` keys are not migrated;
   renaming `eros` → `passion` makes every historical `eros` value invisible. Ids are effectively
   permanent — the same is true of the journal's feeling and question ids.
5. **Colour classes must stay literal strings** or Tailwind purges them; see
   [Frontend §3.1](06-frontend.md#31-categories--now-in-srcconstantscategoriesjs).
6. **Hovering a card stack blocks page scrolling** while there is a version to scrub to — by
   design (`{ passive: false }` wheel capture), but it surprises people testing on trackpads.
7. **Signup does not log you in.** The form returns to the login view; that is intended.
