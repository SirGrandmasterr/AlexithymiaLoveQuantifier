# 11 — Known Issues & Documentation Drift

A register, not a work order — several entries are acceptable trade-offs for a self-hosted
personal tool. Severity assumes eventual public exposure. Closed entries are removed rather than
annotated; Phases 1–6 closed everything they were scoped to, and what they replaced is in git
history at `49e2266` and `fcd28b4`.

---

## Session lifetime: what is still true after renewal

Renewal changed how often a user is interrupted, not what a token can do.

| Property | Status | Why it is acceptable here |
| :------- | :----- | :------------------------ |
| An access token cannot be revoked before its `exp` | Unchanged | It is stateless by design. Logging out revokes the *refresh* token, so the window is at most 24 hours and only for a token already in an attacker's hands |
| Refresh tokens live in `localStorage`, readable by any XSS | Unchanged trade-off | The alternative is an `HttpOnly` cookie, which the Android client cannot use cross-origin without CSRF machinery this app has no other need for. The CSP in `nginx.conf` is the primary XSS control |
| A user cannot see or end their other sessions | Not built | The table has everything a session list would need; what is missing is a device label and a screen |
| The keyfunc still does not pin the signing algorithm | Unchanged | See the register below |

## Functional defects

### Duplicate signup returns 500 instead of 409

**Severity: low.** Every `DB.Create` error collapses to
`500 "Failed to create user. Email might already exist."`, so a normal, expected conflict is
reported as a server fault. Same shape in `UpdateUserProfile` for an email collision.

---

## Broken in the container deployment

### Postgres restarting mid-life still kills the backend

**Severity: low — the cold-start race is closed, this remainder is not.** The healthcheck and
`condition: service_healthy` gate only the *first* connect. `Open()` still has no retry loop and
`Connect()` still calls `log.Fatalf`, so a database that goes away and comes back after boot
takes the backend down with it. `restart: unless-stopped` brings it back, which makes this
self-healing rather than fatal — but through the crash, not around it.

*Fix:* a bounded connect-retry loop in `Open()`.

---

## Security

Reasonable for a personal, locally-hosted tool; all are blockers before public exposure.

### No TLS anywhere

**Severity: high on a public address.** Nginx serves cleartext HTTP and there is no TLS
termination in the stack. Credentials and bearer tokens are readable by anything on the path,
which is the one weakness that makes the others cheaper to exploit — a generated 238-bit
database password does not matter if the token authorising the request was sniffed. Acceptable
on a trusted LAN; not acceptable on the internet.

*Fix:* a TLS-terminating proxy in front of `frontend`
([Deployment](09-deployment.md#what-is-still-missing-tls)).

### The backend connects to Postgres as a superuser

The role in `.env` is `postgres`, the cluster superuser. `AutoMigrate` genuinely needs DDL
rights, so this cannot drop to read/write only — but it does not need `SUPERUSER`, which carries
`COPY … FROM PROGRAM` and the ability to disable row-level security. Changing it requires an
initdb script and therefore a fresh volume, which is why it is a register entry and not a fix.

### The development SQLite database is not gitignored

`backend/alexithymia.db` *was* tracked; it was last committed at `2e4d71c` and has since been
removed (verified untracked at HEAD). What is still true is the other half: it is **not** covered
by [`.gitignore`](../.gitignore), and there is no `.dockerignore` for it either. So a developer
who runs the backend locally creates one, it appears as an untracked file in `git status`, and a
`git add .` puts dev users and their bcrypt hashes back into history. Booting a newer version
against an old file also **rewrites it in place**, so if it ever were tracked again a schema
change would land in a binary as an unreviewable diff.

*Fix:* add `*.db` to `.gitignore`. (`backend/**/uploads/` is already there.)

*Consequence for anyone testing a migration:* there is no dev database in the tree to migrate
against, so `make migrate-check-local` on a clean checkout **creates an empty one** and reports
every table missing, which proves nothing. Build a real one first — check out the models as they
stood before your change, `cd backend && go run ./cmd/migrate`, put some rows in it, then add
your models — and delete the file afterwards.

### Upload validation trusts the client

`file.Header.Get("Content-Type")` is compared against a three-entry allowlist — no magic-byte
sniffing, no decode, and the extension comes from the user-supplied filename. Any file declaring
`image/png` is stored and then served publicly.

Two mitigations landed with the container pass, neither of which fixes the cause: Nginx caps
request bodies at 8 MB, and `/uploads/` is served under
`Content-Security-Policy: default-src 'none'; … sandbox`, so an HTML file smuggled in as an image
cannot execute against this origin. Real validation is still owed.

Note the E2E suite depends on this weakness (it uploads the bytes `fake image data`), so
tightening validation requires a real image fixture.

### Uploaded files are publicly readable

`r.Static("/uploads", "./uploads")` is registered **outside** the protected group, and Nginx
proxies `/uploads/` through to it. Anyone who knows a filename can fetch any avatar. Filenames
are nanosecond timestamps — not guessable, but not access-controlled either, and not namespaced
per user.

### JWT signing method is not pinned

`ValidateToken`'s keyfunc returns the key unconditionally, with no
`jwt.WithValidMethods([]string{"HS256"})`. `golang-jwt/v5` rejects `alg: none` on its own, but
pinning is the standard defence and is a one-line change.

### Rate limiting stops at the proxy

`/api/login`, `/api/signup` and `/api/refresh` are limited to 20 requests per minute per IP by
Nginx, which is where the traffic arrives — but the limit lives in the proxy, so it does not
exist for anything reaching the backend another way, and it counts `$binary_remote_addr`, a
single address behind a NAT or CDN. The application itself has no account lockout and no attempt
counter.

### No email validation, no password policy

`binding:"required"` only. `{"email":"x","password":"y"}` creates a valid account. Email changes
via `PUT /api/me` have no verification flow.

### The backend↔Postgres link is unencrypted

The DSN hardcodes `sslmode=disable`. It is a private, `internal` Docker network with no gateway,
so the traffic never leaves the host and this is a reasonable trade — but it is a hardcoded
value, not a configured one, so moving Postgres to another host would silently keep sending
credentials in clear.

---

## Test and CI gaps

### The Go suite runs on SQLite while production runs Postgres

Every backend test opens `glebarez/sqlite`. SQLite is the laxer engine, so a query can be green
in `go test` and fail in the container.

This is not hypothetical. `GetRelationships` ordered by the `latest_date` **alias** inside an
expression (`ORDER BY latest_date IS NULL`). SQLite allows that; Postgres accepts an output alias
only when it stands alone, so the homepage answered 500 with
`column "latest_date" does not exist` against a schema that was perfectly up to date. The handler
now repeats `MAX(analysis_subjects.date)` instead, which both engines accept.

`make migrate-check` does **not** cover this class: the schema was never the problem. The gap
closes only by running the handler tests against Postgres too.

*Watch for:* aliases in `ORDER BY`/`WHERE` expressions, `GROUP BY` that omits a selected column,
and anything relying on SQLite's dynamic typing.

### The E2E suite cannot pass

`test-results/.last-run.json` records `{"status":"failed"}`. Structural causes: `webServer` is
commented out in `playwright.config.ts` so nothing starts the servers; `baseURL` is commented out
and the spec hardcodes `http://localhost:5173`; CI runs `npx playwright test` with no frontend,
backend or database; and `tests/example.spec.ts` is the untouched scaffold that navigates to
`playwright.dev` and needs outbound internet.

*Fix:* [Testing §3.3](08-testing.md#33-making-e2e-actually-pass).

### CI runs only the suite that cannot pass

[`playwright.yml`](../.github/workflows/playwright.yml) is the only workflow that runs on a push,
and it is the one suite that cannot pass. `go test` (all green) is **not** run by any workflow,
nor are `eslint` or `go vet`. The push pipeline is red by construction while the healthy suites
go unverified.

Partly closed: [`android-release.yml`](../.github/workflows/android-release.yml) runs `vitest` and
`npx vite build` before it will build an APK, so a release is gated on a green frontend suite —
but it is triggered by a `v*` tag or by hand, so it is a release gate and not continuous
integration. `go test` is still in neither.

### `npm run lint` is broken in this checkout

**Severity: low — tooling, not product.** `npx eslint .` exits **2** with
`Cannot find module './cjs/eslint-plugin-react-hooks.development.js'`. The installed
`eslint-plugin-react-hooks@7.0.1` has a `cjs/` directory containing only the `.d.ts` — the
CommonJS build files its `index.js` requires are absent. Since
[`eslint.config.js`](../eslint.config.js) extends `reactHooks.configs.flat.recommended`, ESLint
cannot load its config and lints nothing.

An installation/packaging problem rather than a defect in project code. Try `rm -rf node_modules
&& npm ci`, or pin a known-good plugin version. Lint is not in CI either, so nothing currently
enforces the rules.

### Frontend coverage has gaps at the edges

55 files, 1493 tests. Still untested: `Navbar`, `Landing`, `StackActions`'s click-outside
dismissal, `AppLock`'s idle timer (it needs fake timers), and the `CardStack` offset transform
table.

Recharts renders nothing under jsdom (`ResponsiveContainer` measures zero), so the chart
components are tested through their exported pure functions and dot renderers rather than by
asserting on SVG. Visual regressions in the Recharts timeline are **not** covered by any suite —
the hand-drawn day graph and radar are, because their SVG is assertable.

### `upload_test.go` leaves files behind

The cleanup glob is `uploads/profile_test_*.jpg`, but the handler names files
`profile_<UnixNano><ext>` and ignores the uploaded filename — so nothing matches. Six generated
images are already committed under `backend/internal/handlers/uploads/`, and every `go test ./...`
adds more untracked ones. When clearing them, delete only the untracked files.

*Fix:* glob `uploads/profile_*`, and preferably make the upload directory configurable so tests
can use `t.TempDir()`.

### Minor test-code leftovers

`setupGinTestRouter`'s `handler` parameter is unused (callers register routes themselves);
`requireRegex` in `upload_test.go` is an identity function; the unmarshalled `response` map there
is assigned but never asserted. All harmless.

### A duplicate import specifier in `journal.test.js`

`src/constants/journal.test.js` names `isDayString` twice in one import list. esbuild tolerates
it and the suite is green, but it is a `SyntaxError` per spec and a stricter parser rejects the
file.

---

## Frontend polish

### Modal animation classes are inert

`animate-in`, `fade-in`, `zoom-in-95`, `slide-in-from-right-2` and `slide-in-from-bottom-4` are
used in `AboutModal`, `PersonForm`, `AnalysisTimeline` and `Landing`. They are
**`tailwindcss-animate` utilities and that plugin is not installed** — absent from
`package.json` and `node_modules`, and `tailwind.config.js` declares `plugins: []`. No CSS is
generated; elements appear instantly.

*Fix:* `npm i -D tailwindcss-animate` and add it to `plugins`, or delete the classes.

### An interpolated Tailwind class never renders

`AboutModal` builds `` `group-hover:${cat.textColor}` ``. Tailwind's scanner cannot see composed
class names, so `group-hover:text-rose-500` is never generated and the category-grid hover colour
does nothing.

*Fix:* add a literal `hoverTextColor: 'group-hover:text-rose-500'` field per category.

### Dead controls

"Change Password" — [`Profile.jsx:247`](../src/components/Profile.jsx#L247), no `onClick`.

### Inconsistent accent colour

`Profile.jsx` uses `indigo-600` for its primary actions and focus rings; every other screen uses
`slate-800`/`slate-900` with `rose` accents.

### Placeholder identity

`index.html` still has `<title>temp_app</title>`, `package.json` is named `temp_app`, and the
favicon is the default `vite.svg`. The Compose containers are named `love-metrics-*`, the
Makefile header says "LoveMetrics React App", and the UI says "AlexithymiaLoveQuantifier" — four
different names for one product.

---

## Architectural limitations

Design consequences, not bugs — but they bound what can be built without a migration.

| Limitation | Consequence |
| :--------- | :---------- |
| **Relationship uniqueness is enforced in handlers, not the database** | Soft deletes would need a partial unique index, spelled differently on SQLite and Postgres. Two simultaneous creates of the same new name could race into duplicate relationships. Worst case is two stacks the user can merge |
| **The `relationship_id` foreign key is not enforced on upgraded SQLite databases** | GORM writes the constraint into `CREATE TABLE`, so a *fresh* SQLite database and Postgres both get it, but SQLite cannot retrofit one. Handler-level `user_id` checks are the effective guarantee everywhere |
| **`AnalysisSubject.Name` is still denormalized** | Rename and merge sync it in a transaction, but the same fact lives in two tables. Retained deliberately so rollback is trivial and old clients keep working |
| **Merging is one-way** | Nothing records which snapshots came from where, so a merge cannot be undone in-app. Restoring a backup is the only reversal |
| **An emptied relationship lingers** | Deleting a stack's last version leaves the row with `snapshot_count: 0`. Intentional — posting that name again reuses it — but it means `GET /api/relationships` can list stacks the dashboard does not draw |
| **`stats` is an opaque JSON column** | No SQL filtering or aggregation per category (and `stats->>'x'` would be Postgres-only, breaking the SQLite fallback). All analysis is client-side |
| **No pagination** | Every subject is fetched on every dashboard mount. Ordered server-side, but still unbounded; deliberately deferred until a real dashboard exceeds ~500 snapshots |
| **Soft deletes only** | The database grows monotonically; `users.email` stays reserved by a soft-deleted user (latent — no user-delete endpoint) |
| **`AutoMigrate` plus one hand-written backfill** | No migration files and no version table. The Phase 4 backfill is idempotent Go run at boot; a second structural change would want real tooling. Renames, type narrowing and constraint changes still need hand-written SQL per environment |
| **No `user_id` foreign key** | No referential integrity; deleting a user would orphan their relationships and subjects |
| **Reminders exist only while the app is open, on the web** | Cadence is computed in the browser from data already loaded — a deliberate trade for "nothing leaves this machine", but a rhythm you never visit never nudges you. On Android the ritual schedules a local notification; there is still no server-side scheduler anywhere |
| **Discretion mode is visual only** | Names and notes are masked on screen; the data, the API responses, the export and assistive-technology labels are unchanged |
| **The app lock encrypts nothing** | A SHA-256 hash in `localStorage` gates the UI. The database is exactly as readable as before, there is no recovery flow, and clearing site data removes the lock. The Vault page says all three |
| **Export omits avatars** | `profile_picture` travels only as a path; the image bytes are not included, so a restore into a fresh install has no avatar |
| **Nothing is encrypted at rest** | Notes, scores and the whole journal sit in plain rows. Passwords are bcrypt-hashed; nothing else is protected. [`docs/13`](13-zero-knowledge-encryption.md) is an unconfirmed option, not a schedule |
| **No CORS middleware** | Only same-origin deployments work; a split-origin deployment fails in the browser with nothing logged server-side |
| **Backend port is hardcoded** | `:8080` literal in `main.go`; no `PORT` variable |
| **Upload paths are CWD-relative** | The database file and uploads land wherever the process was started; it is also why tests write into the package directory |
| **The Android shell has no embedding runtime** | `embed()` rejects `unavailable`, so recall and `/journal/search` are absent on the phone. A missing runtime behind an existing seam |

---

## README drift

The root [`README.md`](../README.md) has been trimmed to a quick start that points here, so the
long drift table this section used to carry is gone. If it grows a claim about versions, ports or
endpoints again, that claim belongs in `docs/` instead — these documents are the current ones.
