# 07 — Development Workflow

---

## 1. Prerequisites

| Tool | Version | Needed for |
| :--- | :------ | :--------- |
| Node.js | 20+ (the Docker build uses `node:22-alpine`; CI uses `lts/*`) | Frontend, Vitest, Playwright |
| Go | 1.24.1+ (`go.mod` declares `go 1.24.1`) | Backend |
| Docker + Compose | any current | The containerised path only |
| PostgreSQL | 15 | **Optional** — omit it and the backend uses SQLite automatically |

You do **not** need a database installed to develop locally. With `DB_HOST` unset the
backend creates `backend/alexithymia.db` on first run.

---

## 2. Fastest path — no containers, no database

Two terminals:

```bash
# Terminal 1 — backend on :8080, SQLite fallback
cd backend
go mod download
JWT_SECRET=dev-only-change-me go run ./cmd/server
```

> **`JWT_SECRET` is required and the server will not start without it.** Since Phase 5 an
> unset secret is a fatal startup error rather than a silent empty signing key. On
> PowerShell: `$env:JWT_SECRET='dev-only-change-me'` once per terminal. Use a real value
> anywhere that is not your own machine — `openssl rand -hex 32`.

```bash
# Terminal 2 — frontend on :5173, proxying to :8080
npm install
npm run dev
```

Open **http://localhost:5173**, sign up, and start analysing.

Expected backend log on a clean start:

```
No DB_HOST provided, falling back to local SQLite database: alexithymia.db
Database connection established
Running migrations...
Database migrated
backfill: 0 relationships, 0 snapshots linked
Server starting on port 8080...
```

Without the secret it stops there instead, which is the intended behaviour:

```
JWT_SECRET is not set: every token would be signed with an empty key and forgeable by
anyone. Set it before starting the server, e.g. JWT_SECRET=$(openssl rand -hex 32)
```

Working-directory note: run the backend **from `backend/`**. Both the SQLite file and the
`./uploads` directory are resolved relative to the process CWD, so `go run
./backend/cmd/server` from the repo root would create them at the root instead.

### With Postgres instead

Set the five variables and the driver switches — no code or flag change:

```bash
cd backend
DB_HOST=localhost DB_USER=postgres DB_PASSWORD=password \
DB_NAME=alexithymia DB_PORT=5432 JWT_SECRET=dev-only-change-me \
  go run ./cmd/server
```

On PowerShell:

```powershell
$env:DB_HOST='localhost'; $env:DB_USER='postgres'; $env:DB_PASSWORD='password'
$env:DB_NAME='alexithymia'; $env:DB_PORT='5432'; $env:JWT_SECRET='dev-only-change-me'
go run ./cmd/server
```

The database named in `DB_NAME` must already exist; `AutoMigrate` creates tables, not
databases.

---

## 3. Containerised path

```bash
docker-compose up --build
```

Then open **http://localhost:8080** — the Nginx container, *not* 3000 (the root README's
`:3000` is wrong; see [Known Issues](11-known-issues.md#readme-drift)).

Everything about this path — port mapping, the Postgres readiness gap, the missing
`/uploads` proxy — is in [Deployment](09-deployment.md). Rebuild with `--build` whenever
`package.json` or `go.mod` changes; Compose otherwise reuses cached layers.

---

## 4. Ports, at a glance

| Port | Process | Environment |
| :--- | :------ | :---------- |
| **5173** | Vite dev server (default; not configured anywhere) | local dev |
| **8080** | Go/Gin — hardcoded in [`main.go:38`](../backend/cmd/server/main.go#L38) | local dev |
| **8080** | Nginx (host) → container `:80` | Docker |
| **8081** | Go/Gin direct (host) → container `:8080` | Docker |
| **5432** | Postgres | Docker |

Port 8080 means the backend in local dev and the frontend under Docker. Running both at
once collides — stop one first.

---

## 5. Environment variables

The backend is the only process that reads any.

| Variable | Read at | Default | Effect |
| :------- | :------ | :------ | :----- |
| `DB_HOST` | `Connect()` | *(unset)* | **The driver switch.** Unset → SQLite `alexithymia.db`; set → Postgres. |
| `DB_USER` | `Connect()` | — | Postgres user (only when `DB_HOST` is set) |
| `DB_PASSWORD` | `Connect()` | — | Postgres password |
| `DB_NAME` | `Connect()` | — | Postgres database name |
| `DB_PORT` | `Connect()` | — | Postgres port |
| `JWT_SECRET` | package init of `internal/auth`, re-read by `auth.LoadSecret()` | **none — startup fails** | HS256 signing key. `main()` calls `LoadSecret` before anything else and exits if it is unset or empty. |

Notes:

- There is **no `.env` support** — no `godotenv`, no `--env-file` in Compose. Values come
  from the real process environment, and under Docker from the `environment:` block in
  [`docker-compose.yml:22-28`](../docker-compose.yml#L22-L28) (`JWT_SECRET=supersecretkey`,
  committed).
- `JWT_SECRET` is captured **before `main()` runs**, so it cannot be changed at runtime and
  cannot be set from inside a Go test.
- **An unset `JWT_SECRET` does not fail** — HS256 signs with the empty key and everything
  appears to work while tokens are forgeable. Always set it, even locally.
- Postgres TLS is off (`sslmode=disable`, hardcoded) and the port is not configurable.

---

## 6. Makefile targets

[`Makefile`](../Makefile) — thin npm wrappers, the three test suites, and the Docker stack
plus its schema and database chores. `make help` prints the list.

| Target | Runs |
| :----- | :--- |
| `make install` | `npm install` |
| `make setup` | `install`, then a "run make dev" hint |
| `make dev` | `npm run dev` |
| `make build` | `npm run build` (→ `dist/`) |
| `make preview` | `npm run preview` |
| `make all` | `install build` |
| `make clean` | **`rm -rf node_modules package-lock.json`** — deletes the lockfile, so the next install may resolve different versions. Prefer `rm -rf node_modules` alone. |
| `make test-frontend` | `npm run test` → `vitest run` |
| `make test-backend` | `cd backend && go test ./...` |
| `make test-e2e` | `npx playwright test --project=chromium` |
| `make test` | all three in sequence |
| `make up` | `docker compose up -d --build`, then waits for Postgres and runs `migrate-check` |
| `make down` | `docker compose down` (keeps the volume) |
| `make logs` | follows the backend container's log |
| `make migrate` | applies `AutoMigrate` + the relationship backfill to the compose Postgres |
| `make migrate-check` | reports missing tables/columns and exits 1; **writes nothing** |
| `make migrate-local` / `make migrate-check-local` | the same two against the SQLite fallback, via a local Go toolchain |
| `make db-wait` | blocks until Postgres accepts connections (up to 60s) |
| `make db-shell` | `psql` inside the database container |
| `make db-schema` | `\d+` for all three tables |
| `make db-backup` | `pg_dump` → `backups/alexithymia-<timestamp>.sql` (gitignored) |
| `make db-restore FILE=…` | replays a dump taken by `db-backup` |
| `make db-reset CONFIRM=yes` | **drops every table**, backs up first, then re-migrates |

The Makefile uses Unix `rm`, `seq`, and `date`, so it needs Git Bash or WSL on Windows.

`make test-e2e` requires the dev server **and** the backend already running — the note in
the Makefile says so, and [`playwright.config.ts`](../playwright.config.ts) has its
`webServer` block commented out.

### Migrations

The server still migrates itself on boot — [`database.Connect()`](../backend/internal/database/database.go)
calls `Open()` then `Migrate()`, and the Makefile targets call the same `Migrate()` through
[`backend/cmd/migrate`](../backend/cmd/migrate/main.go). There is no second code path and
no migration files: the models are the schema, as before.

What is new is that the step is *addressable*. `make migrate-check` answers "does this
database match the models?" without writing, naming the missing table or column outright —
`make up` runs it after every start, so drift is reported at boot rather than surfacing
later as a 500 from whichever endpoint happened to read the missing column first.

The check is deliberately one-directional: it reports what the models have and the database
lacks. A leftover column from a deleted field is not flagged, because `AutoMigrate` never
drops one either. Type and nullability changes are also out of scope — GORM handles those
differently per engine, so a check claiming to cover them would be lying.

---

## 7. Repository layout

```
AlexithymiaLoveQuantifier/
├── docs/                       ← this documentation
├── backend/                    Go service (see 05-backend.md)
├── src/                        React app (see 06-frontend.md)
│   ├── components/             one file per screen + AnalysisTimeline
│   ├── App.jsx  main.jsx  index.css  setupTests.js
│   └── assets/
├── public/                     served verbatim by Vite (vite.svg)
├── tests/
│   ├── example.spec.ts         Playwright scaffold — hits playwright.dev
│   └── e2e/user_journey.spec.ts  the real E2E journey
├── .github/workflows/playwright.yml
├── index.html                  SPA shell (title still "temp_app")
├── vite.config.js              Vite + Vitest + dev proxy
├── tailwind.config.js  postcss.config.js  eslint.config.js
├── playwright.config.ts
├── Dockerfile                  frontend: node build → nginx
├── nginx.conf                  SPA fallback + /api proxy
├── docker-compose.yml          frontend + backend + postgres
├── Makefile
├── README.md                   project overview (partially stale)
├── Setup Guide.md              historical scaffold-from-scratch guide
└── TestImplementationDetails.txt  source prose for the seven categories
```

Two files are historical rather than operational:

- **`Setup Guide.md`** documents creating the project from a bare Vite template and
  pasting code out of a browser canvas. It predates the Go backend entirely (it never
  mentions Go, JWT, or Postgres) and its "app lives in `src/App.jsx`" instruction no
  longer matches reality. Keep it for provenance; do not follow it.
- **`TestImplementationDetails.txt`** is *not* a test document despite the name. It is the
  authored prose for the seven categories, later transcribed into the `CATEGORIES`
  constant. It is the editorial source of truth for that copy.

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
go build -o server ./cmd/server
gofmt -l .             # should print nothing
go vet ./...

# e2e (needs both servers up)
npx playwright test --project=chromium
npx playwright test tests/e2e/user_journey.spec.ts
npx playwright show-report
```

`npm run preview` serves the built bundle but **applies no proxy** — `server.proxy` is a
dev-server-only setting — so API calls 404. Use `docker-compose up --build` to exercise a
production build against a live API.

---

## 9. Local development gotchas

1. **Run the backend from `backend/`.** Otherwise `alexithymia.db` and `uploads/` land in
   whatever directory you started from.
2. **`backend/alexithymia.db` is tracked by git.** Signing up locally dirties the working
   tree. Check `git status` before committing, and never commit a database containing real
   credentials. See [Known Issues](11-known-issues.md#the-development-sqlite-database-is-committed-to-git).
3. **`go test ./...` writes files.** `upload_test.go` leaves images in
   `backend/internal/handlers/uploads/` because its cleanup glob does not match the
   handler's naming scheme. Four such files are already committed.
4. **Tokens are not validated client-side.** After a token expires (24 h) the dashboard
   still renders but stays empty, with only a console error. Clear
   `localStorage['token']` (or use Logout) to recover.
5. **Changing a `CATEGORIES` id orphans existing data.** Stored `stats` keys are not
   migrated; renaming `eros` → `passion` makes every historical `eros` value invisible and
   render as 0. Ids are effectively permanent.
6. **Colour classes must stay literal strings** or Tailwind purges them; see
   [Frontend §3.1](06-frontend.md#31-categories-lines-6117).
7. **Hovering a card stack blocks page scrolling** — by design (`{ passive: false }` wheel
   capture), but it surprises people testing on trackpads.
8. **Signup does not log you in.** The form returns to the login view; that is intended
   behaviour, not a bug.
