# 11 — Known Issues & Documentation Drift

Everything below was verified against the code on **2026-07-26** by reading the source and
running the test suites. Items are grouped by kind and ordered by impact within each group.

This is a register, not a work order — several entries are acceptable trade-offs for a
self-hosted personal tool. Severity assumes eventual public exposure.

> **Closed by Phase 1** (data integrity & context capsules), 2026-07-26: the `description`
> wipe on edit, unvalidated `stats`, silently discarded malformed dates, `DELETE` reporting
> success for rows it did not delete, `PUT /api/me` being unable to clear a field, no
> client-side 401 handling on the dashboard, and console-only frontend errors.
>
> **Closed by Phase 2** (guided scoring & feedback), 2026-07-26: missing-key-≡-zero in the
> UI, and the dead "Learn the Theory" control.
>
> Closed entries are removed rather than annotated; see
> [`product_vision/`](../product_vision/) for what replaced them.

---

## Functional defects

### Duplicate signup returns 500 instead of 409

**Severity: low.**

Every `DB.Create` error collapses to
`500 "Failed to create user. Email might already exist."`
([`auth.go:37-41`](../backend/internal/handlers/auth.go#L37-L41)), so a normal, expected
conflict is reported as a server fault. Same shape in `UpdateUserProfile` for an email
collision.

### The 401 interceptor does not cover `Profile.jsx`

**Severity: low (UX).**

`App.jsx` now registers a global axios response interceptor that clears the token on 401,
so an expired session drops the user back to Landing instead of an unexplained empty grid.
But `Profile.jsx` calls through its own `axios.create()` instance, and interceptors on the
global default do not apply to instances — so an expired token on the profile screen still
fails silently into `message: {type:'error'}` with no logout.

*Fix:* [Recipe 6](10-agent-guide.md#recipe-6-unify-the-axios-setup) — drop the private
instance and use the global axios everywhere.

---

## Broken in the container deployment

### `/uploads` is not proxied in the container setup

**Severity: high in Docker — avatars never load.**

[`vite.config.js`](../vite.config.js#L16) proxies both `/api` and `/uploads`;
[`nginx.conf`](../nginx.conf) proxies **only `/api/`**. Under Docker an avatar request
therefore falls through to `location /`, gets `try_files … /index.html`, and returns HTTP
200 containing HTML — so the `<img>` breaks with no error status to diagnose it. It works
perfectly in local dev, which is why it has gone unnoticed.

*Fix:* add a `location /uploads/ { proxy_pass http://backend:8080; … }` block
([Deployment §2](09-deployment.md#uploads-is-not-proxied-in-the-container-setup)).

### Uploaded files are lost on container recreation

**Severity: high in Docker — data loss.**

The backend writes `/root/uploads` inside the container's writable layer and
[`docker-compose.yml`](../docker-compose.yml) mounts **no volume** for it. Any
`down`/`up`/rebuild discards every avatar while `users.profile_picture` keeps pointing at
the missing file. Postgres, by contrast, does have `postgres_data`.

*Fix:* mount a named volume at `/root/uploads`.

### Backend can exit before Postgres is ready

**Severity: medium — first-run failure.**

`depends_on` orders start, not readiness; there is no healthcheck, no `restart:` policy, and
`Connect()` calls `log.Fatalf` with no retry. A cold `docker-compose up --build` frequently
kills the backend immediately. This is the exact symptom the root README's troubleshooting
section describes — and the README's claim that *"the backend waits for Postgres"* is
incorrect.

*Fix:* healthcheck + `condition: service_healthy`, and/or a connect-retry loop
([Deployment §4](09-deployment.md#no-readiness-gate-for-postgres)).

---

## Security

Reasonable for a personal, locally-hosted tool; all are blockers before public exposure.

### `JWT_SECRET` defaults to an empty key

**Severity: critical if unset.**

```go
var jwtKey = []byte(os.Getenv("JWT_SECRET"))   // auth.go:12 — package init
```

Read once, before `main()`. If the variable is unset the key is `[]byte{}`, and HS256 signs
and verifies happily with it — so the application **works normally while every token is
forgeable by anyone**. Nothing warns. The local-dev path (`go run ./cmd/server` with no env)
hits this by default.

*Fix:* fail fast at startup:

```go
func init() {
    if len(jwtKey) == 0 { log.Fatal("JWT_SECRET must be set") }
}
```

### Secrets are committed

`JWT_SECRET=supersecretkey` and `DB_PASSWORD=password` are in
[`docker-compose.yml:22-28`](../docker-compose.yml#L22-L28). No `.env` support exists
anywhere in the stack. Tracked as a TODO in the root README and still open.

### The development SQLite database is committed to git

`backend/alexithymia.db` (28 KB) is tracked, currently shows as modified in `git status`,
and is not covered by [`.gitignore`](../.gitignore). It contains dev users and their bcrypt
hashes. Every local signup dirties the working tree, and it is copied into the Docker build
context (no `.dockerignore`).

*Fix:* add `*.db` and `backend/uploads/` to `.gitignore`, `git rm --cached
backend/alexithymia.db`, and purge history if it ever held real credentials.

### Upload validation trusts the client

`file.Header.Get("Content-Type")` is compared against a three-entry allowlist
([`upload.go:29-33`](../backend/internal/handlers/upload.go#L29-L33)) — no magic-byte
sniffing, no decode, no size limit beyond Gin's default multipart cap, and the extension
comes from the user-supplied filename. Any file declaring `image/png` is stored and then
served publicly.

Note the E2E suite depends on this weakness (it uploads the bytes `fake image data`), so
tightening validation requires a real image fixture.

### Uploaded files are publicly readable

`r.Static("/uploads", "./uploads")` is registered **outside** the protected group
([`main.go:22`](../backend/cmd/server/main.go#L22)). Anyone who knows a filename can fetch
any avatar. Filenames are nanosecond timestamps — not guessable, but not access-controlled
either, and not namespaced per user.

### JWT signing method is not pinned

`ValidateToken`'s keyfunc returns the key unconditionally, with no
`jwt.WithValidMethods([]string{"HS256"})`. `golang-jwt/v5` rejects `alg: none` on its own,
but pinning is the standard defence and is a one-line change.

### No rate limiting anywhere

Including `/api/login` and `/api/signup`. bcrypt cost 14 makes brute-forcing slow but also
makes the login endpoint a cheap denial-of-service target: each attempt costs the server
roughly a second of CPU.

### No email validation, no password policy

`binding:"required"` only. `{"email":"x","password":"y"}` creates a valid account. Email
changes via `PUT /api/me` have no verification flow — the code comment acknowledges this.

### Postgres exposed with a weak password

`5432:5432` is published to the host with `POSTGRES_PASSWORD=password`, and the backend DSN
hardcodes `sslmode=disable`. Remove the port mapping unless external access is needed.

---

## Test and CI gaps

### The E2E suite cannot pass

`test-results/.last-run.json` records `{"status":"failed"}`. Structural causes:

- `webServer` is commented out in
  [`playwright.config.ts:74-78`](../playwright.config.ts#L74-L78), so nothing starts the
  servers.
- `baseURL` is commented out and `user_journey.spec.ts` hardcodes `http://localhost:5173`.
- The CI workflow runs `npx playwright test` with no frontend, backend, or database.
- `tests/example.spec.ts` is the untouched scaffold that navigates to `playwright.dev` and
  needs outbound internet.

*Fix:* [Testing §3.3](08-testing.md#33-making-e2e-actually-pass).

### CI runs only the suite that cannot pass

[`playwright.yml`](../.github/workflows/playwright.yml) is the only workflow. `vitest`
(50/50 green) and `go test` (all green) are **not** run in CI, nor are `eslint` or `go vet`.
The pipeline is red by construction while both healthy suites go unverified.

### `npm run lint` is broken in this checkout

**Severity: low — tooling, not product.**

`npx eslint .` exits **2** with:

```
Error: Cannot find module './cjs/eslint-plugin-react-hooks.development.js'
```

The installed `eslint-plugin-react-hooks@7.0.1` has a `cjs/` directory containing only
`eslint-plugin-react-hooks.d.ts` — the CommonJS build files the package's `index.js`
requires are absent. Since [`eslint.config.js`](../eslint.config.js) extends
`reactHooks.configs.flat.recommended`, ESLint cannot load its config and lints nothing.

This is an installation/packaging problem rather than a defect in project code. Try
reinstalling (`rm -rf node_modules && npm ci`) or pinning a known-good plugin version. Note
lint is not in CI either, so nothing currently enforces the rules.

### `internal/auth` has no tests

Hashing, token generation, expiry, and tamper rejection are entirely unverified — the
largest backend gap, and the cheapest to close. Complication: `jwtKey` is captured at
package init, so a test cannot set `JWT_SECRET` from inside a test function.

### Frontend coverage has gaps at the edges

`Auth`, `Dashboard` (including `PersonForm`, guided scoring, and the card surface),
`WhatChanged`, and `AnalysisTimeline`'s dot renderer are covered — 50 tests. Still untested:
`Profile`, `Navbar`, `Landing`, `App`'s routing guards and 401 interceptor, the
name-grouping `useMemo`, and the `CardStack` offset transform table.

### `upload_test.go` leaves files behind

The cleanup glob is `uploads/profile_test_*.jpg`, but the handler names files
`profile_<UnixNano><ext>` and ignores the uploaded filename — so nothing matches. Four
generated images are already committed under
`backend/internal/handlers/uploads/`.

*Fix:* glob `uploads/profile_*`, and preferably make the upload directory configurable so
tests can use `t.TempDir()`.

### Minor test-code leftovers

`setupGinTestRouter`'s `handler` parameter is unused (callers register routes themselves);
`requireRegex` in `upload_test.go` is an identity function; the unmarshalled `response` map
there is assigned but never asserted. All harmless.

---

## Frontend polish

### Modal animation classes are inert

`animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-right-2`, `slide-in-from-bottom-4`
are used in `AboutModal`, `PersonForm`, `AnalysisTimeline`, and `Landing`. They are
**`tailwindcss-animate` utilities and that plugin is not installed** — absent from
`package.json` and `node_modules`, and `tailwind.config.js` declares `plugins: []`. No CSS
is generated; elements appear instantly.

*Fix:* `npm i -D tailwindcss-animate` and add it to `plugins`, or delete the classes.

### An interpolated Tailwind class never renders

[`Dashboard.jsx:341`](../src/components/Dashboard.jsx#L341) builds
`` `group-hover:${cat.textColor}` ``. Tailwind's scanner cannot see composed class names, so
`group-hover:text-rose-500` is never generated and the category-grid hover colour does
nothing.

*Fix:* add a literal `hoverTextColor: 'group-hover:text-rose-500'` field per category.

### Dead controls

- "Change Password" — [`Profile.jsx:247`](../src/components/Profile.jsx#L247), no `onClick`.
  The last one: "Learn the Theory" on the Landing page now opens `AboutModal`.

### Card stacks trap wheel scrolling

`CardStack` registers `wheel` with `{ passive: false }` and always calls
`preventDefault()` — even for single-version stacks, where there is nothing to scrub. On a
dashboard taller than the viewport the page stops scrolling whenever the pointer crosses a
card.

*Fix:* skip `preventDefault()` when `sortedVersions.length === 1`, or when the index is
already clamped at the relevant end.

### Two axios conventions coexist

`Profile.jsx` uses a private instance with a request interceptor; everything else uses the
global default header set in `App.jsx`. Both work; the duplication is accidental and it is
now load-bearing in the wrong direction — the global 401 response interceptor does not
cover `Profile`. See [Recipe 6](10-agent-guide.md#recipe-6-unify-the-axios-setup).

### Inconsistent accent colour

`Profile.jsx` uses `indigo-600` for its primary actions and focus rings; every other screen
uses `slate-800`/`slate-900` with `rose` accents.

### Unused import

`Layers` is imported in `Dashboard.jsx` and never used. ESLint does not flag it because the
project's `no-unused-vars` rule exempts capitalised identifiers
(`varsIgnorePattern: '^[A-Z_]'`).

### Placeholder identity

`index.html` still has `<title>temp_app</title>`, `package.json` is named `temp_app`, and
the favicon is the default `vite.svg`. The Compose containers are named `love-metrics-*`,
the Makefile header says "LoveMetrics React App", and the UI says
"AlexithymiaLoveQuantifier" — four different names for one product.

### The timeline is not addressable

Rendered by a conditional swap, so it cannot be linked or bookmarked, Back exits the
dashboard entirely, and `selectedTimelineStack` is a snapshot that goes stale if a version is
edited while it is open. See [Recipe 4](10-agent-guide.md#recipe-4-make-the-timeline-a-real-route).

---

## Architectural limitations

These are design consequences, not bugs — but they bound what can be built without a
migration.

| Limitation | Consequence |
| :--------- | :---------- |
| **No subject entity** — identity is the `name` string | Cannot rename a stack, cannot merge stacks, two different people sharing a name merge silently. Whitespace no longer splits stacks (names are trimmed on write) but case still does, and legacy rows keep their whitespace until a backfill. [Details](03-data-model.md#6-there-is-no-person-entity) |
| **`stats` is an opaque JSON column** | No SQL filtering or aggregation per category (and `stats->>'x'` would be Postgres-only, breaking the SQLite fallback). All analysis is client-side. |
| **No `ORDER BY`, no pagination** | Every subject is fetched on every dashboard mount and sorted in the browser. Degrades with hundreds of rows. |
| **Soft deletes only** | The database grows monotonically; nothing is ever reclaimed; `users.email` stays reserved by a soft-deleted user (latent — no user-delete endpoint exists). |
| **`AutoMigrate` only** | No migration files, no version table. Renames, type narrowing, and constraint changes need hand-written SQL per environment. |
| **No `user_id` foreign key** | No referential integrity; deleting a user would orphan their subjects. |
| **Timeline x-axis is categorical** | Points are evenly spaced regardless of the real gap between dates, so a day and a year look the same. |
| **No CORS middleware** | Only same-origin deployments work; a split-origin deployment fails in the browser with nothing logged server-side. |
| **`stats` is still an opaque blob for reads** | Skipped categories are honoured end to end, but "show me every snapshot where `mania` was skipped" is a client-side scan, not a query. |
| **Backend port is hardcoded** | `:8080` literal in `main.go`; no `PORT` variable. |
| **Upload paths are CWD-relative** | The database file and uploads land wherever the process was started; it is also why tests write into the package directory. |

---

## README drift

The root [`README.md`](../README.md) is a good overview but has fallen behind. Verified
discrepancies:

| README says | Reality |
| :---------- | :------ |
| "React 18 + Vite" | React **19.2**, Vite **7.3** ([`package.json`](../package.json)) |
| "React Router DOM (v6)" | react-router-dom **7.13** |
| Frontend at `http://localhost:3000` | **`:8080`** under Compose (host 8080 → Nginx 80); **`:5173`** in local dev. No service listens on 3000. |
| Backend API at `http://localhost:8080/api` | Under Compose the backend is on **`:8081`** directly; `:8080/api` works only because Nginx proxies it. |
| "Database (Postgres) will be provisioned automatically" | True under Compose only. Without `DB_HOST` the backend silently uses **SQLite** — a whole execution mode the README never mentions. |
| "The backend waits for Postgres, but if it times out…" | There is **no wait and no timeout**. `log.Fatalf` exits immediately; `depends_on` only orders start. |
| API table lists 7 endpoints | There are **9** plus static files: `PUT /api/me`, `POST /api/upload`, and `GET /uploads/*` are missing. |
| `User` model: email + password | Also `Name`, `Age`, `MBTIType`, `ProfilePicture`. |
| Project structure tree | Omits `AnalysisTimeline.jsx`, `internal/auth`, `internal/handlers/middleware.go`, `upload.go`, all `*_test.go`, `tests/`, `.github/`, `playwright.config.ts`. |
| Dashboard "Generates a horizontal bar chart… using simple div widths" | Still true, but the README predates `AnalysisTimeline` and **recharts** entirely — the timeline feature is undocumented there. |
| TODO: "Add unit tests for backend handlers and frontend components" | Partly done: backend handler + database tests and `Auth.test.jsx` all exist and pass. |
| Stats keys "mapped to integer scores from 0-100" | Now true — enforced by the sliders *and* by server-side validation against the seven ids. Rows written before that validation existed are not retroactively cleaned. |

*Suggested fix:* trim the root README to a quick-start plus a link to `docs/`, and let these
documents carry the detail.
