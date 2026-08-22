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
> **Closed by Phase 3** (visualisations & routing), 2026-07-26: the categorical timeline
> x-axis, the timeline not being addressable, the stale timeline snapshot, the card-stack
> wheel-scroll trap, and the `CATEGORY_COLORS` palette duplication.
>
> **Closed by Phase 4** (domain model evolution), 2026-07-26: the no-subject-entity
> limitation and everything downstream of it — stacks can now be renamed and merged, two
> people sharing a name no longer collapse into one stack, the timeline route is keyed by
> id, `GET /api/subjects` has an `ORDER BY`, and `analysis_subjects` has a declared foreign
> key (enforced on Postgres; see the register below for the SQLite caveat).
>
> **Closed by Phase 5** (retention, trust & portability), 2026-07-26: `JWT_SECRET`
> defaulting to an empty key (startup now fails), and `internal/auth` having no tests. The
> app gained in-app reminders, quick pulses, a full export/import vault, and discretion mode.
>
> **Closed 2026-07-26** (dead-session handling): a token whose user row no longer exists —
> a dropped volume, a `down -v`, a deleted account — used to pass `AuthMiddleware` on its
> signature alone, so `/api/me` answered 404 and the list endpoints answered `[]` for a user
> that named nobody. The middleware now confirms the account exists and answers 401
> otherwise, and `Profile.jsx` no longer holds a private `axios.create()` instance, so the
> global 401 interceptor covers it (this closes Recipe 6's first half).
>
> **Closed by the container hardening pass, 2026-07-28**: committed secrets (now `.env` +
> `${VAR:?}` interpolation), Postgres published on `5432` with the password `password` (now
> `expose` only, on an `internal` network, with a generated password), `/uploads` not being
> proxied by Nginx, uploaded files being lost on container recreation (`uploads_data`
> volume), the backend starting before Postgres was ready (healthcheck +
> `condition: service_healthy`), and no rate limiting on `/api/login` and `/api/signup`.
> The backend also stopped running as root. See
> [Deployment §1](09-deployment.md#1-compose-topology) and
> [§6](09-deployment.md#6-configuration-and-secrets).
>
> **Closed by the session and touch pass, 2026-08-21**: an access token expiring was a
> user-visible event. There was no renewal path at all, so every client met "Invalid or
> expired token" on a 24-hour schedule — the web app dropped to Landing mid-task, and the
> Android app, which is resumed rather than reloaded for weeks, met it almost every session.
> Login now issues a rotating refresh token, a 401 renews and replays the request, and a
> genuinely dead session asks for the passphrase *over* the current screen instead of
> evicting the user to Landing. See [API §3.1](04-api-reference.md#31-session-renewal) and
> [Frontend §2a](06-frontend.md#2a-authsessionjs--why-an-expired-token-is-no-longer-an-event).
>
> Closed in the same pass, on touch: the scoring slider claimed every touch that landed on
> it, so scrolling the page from a point above a track moved a score silently; the card stack
> scrubbed on the *vertical* axis, competing with the page's own scroll gesture; and a
> thumb placed on a slider covered the anchor phrase that explains the number it is setting.
> Each axis now has one owner (`touch-action`), the stack scrubs horizontally with a visible
> pager, and scoring by thumb happens on a dial that sits clear of everything it affects —
> [Android §3.3](12-android-app.md#33-inputs-and-touch).
>
> Also closed: each anchor band carried a single sentence, so a category's whole 0-100 scale
> was explained by four of them and a user who had read them once learned nothing on the
> second pass. There are now five or six bands per category, each with five phrasings written
> through five different lenses, and the one shown rotates between form openings
> ([Concepts §3a](01-concepts.md#anchored-sliders)).
>
> Also closed: a new version opened on the previous snapshot's scores, so an untouched row
> recorded a fresh dated score the user never made. New versions start at zero, with last
> time's value marked on the track and one tap away
> ([Frontend §3.6](06-frontend.md#36-personform--exported-for-tests)).
>
> Closed entries are removed rather than annotated; see
> [`product_vision/`](../product_vision/) for what replaced them.

---


## Session lifetime: what is still true after renewal

Renewal changed how often a user is interrupted, not what a token can do.

| Property | Status | Why it is acceptable here |
| :------- | :----- | :------------------------ |
| An access token cannot be revoked before its `exp` | Unchanged | It is stateless by design. Logging out revokes the *refresh* token, so the window is at most 24 hours and only for a token already in an attacker's hands. |
| Refresh tokens live in `localStorage`, readable by any XSS | Unchanged trade-off | The alternative is an `HttpOnly` cookie, which the Android client cannot use cross-origin without CSRF machinery this app has no other need for. The CSP in `nginx.conf` is the primary XSS control. |
| A user cannot see or end their other sessions | Not built | The table has everything a session list would need (`user_id`, timestamps, `revoked_at`); what is missing is a device label and a screen. Worth building the day this stops being single-user-per-server software. |
| The keyfunc still does not pin the signing algorithm | Unchanged | See the entry in the register below; unaffected by this change. |

## Functional defects

### Duplicate signup returns 500 instead of 409

**Severity: low.**

Every `DB.Create` error collapses to
`500 "Failed to create user. Email might already exist."`
([`auth.go:37-41`](../backend/internal/handlers/auth.go#L37-L41)), so a normal, expected
conflict is reported as a server fault. Same shape in `UpdateUserProfile` for an email
collision.

---

## Broken in the container deployment

### Postgres restarting mid-life still kills the backend

**Severity: low — the cold-start race is closed, this remainder is not.**

The healthcheck and `condition: service_healthy` gate only the *first* connect. `Open()`
still has no retry loop and `Connect()` still calls `log.Fatalf`
([`database.go:36-38`](../backend/internal/database/database.go#L36-L38)), so a database
that goes away and comes back after boot takes the backend down with it. `restart:
unless-stopped` then brings the backend back, which makes this self-healing rather than
fatal — but through the crash, not around it.

*Fix:* a bounded connect-retry loop in `Open()`.

---

## Security

Reasonable for a personal, locally-hosted tool; all are blockers before public exposure.

### No TLS anywhere

**Severity: high on a public address.**

Nginx serves cleartext HTTP and there is no TLS termination in the stack. Credentials and
bearer tokens are readable by anything on the path, which is the one weakness that makes
the others cheaper to exploit — a generated 238-bit database password does not matter if
the token authorising the request was sniffed. Acceptable on a trusted LAN; not acceptable
on the internet.

*Fix:* a TLS-terminating proxy in front of `frontend`
([Deployment §6](09-deployment.md#what-is-still-missing-tls)).

### The backend connects to Postgres as a superuser

The role in `.env` is `postgres`, the cluster superuser. `AutoMigrate` genuinely needs DDL
rights, so this cannot drop to read/write only — but it does not need `SUPERUSER`, which
carries `COPY … FROM PROGRAM` and the ability to disable row-level security. Changing it
requires an initdb script and therefore a fresh volume, which is why it is a register entry
and not a fix.

### The development SQLite database is no longer committed, but is still not ignored

**Half fixed, and this entry used to be wrong.** `backend/alexithymia.db` *was* tracked; it
was last committed at `2e4d71c` and has since been removed. Verified untracked on
2026-08-22 — `git ls-files backend/ | grep '\.db$'` is empty at HEAD.

What is still true is the other half: it is **not** covered by
[`.gitignore`](../.gitignore), and it is not in a `.dockerignore` either (there is none). So
a developer who runs the backend locally creates one, it appears as an untracked file in
`git status`, and a `git add .` puts dev users and their bcrypt hashes back into history.
Booting a newer version against an old file also **rewrites it in place** — since Phase 4 the
migration recreates `analysis_subjects` and the backfill populates `relationship_id` on every
row — so if it ever were tracked again, a schema change would land in a binary as an
unreviewable diff.

*Fix:* add `*.db` to `.gitignore`. (`backend/**/uploads/` is already there.) Purge history if
that file ever held real credentials.

*Consequence for anyone testing a migration:* there is no dev database in the tree to migrate
against, so `make migrate-check-local` on a clean checkout **creates an empty one** and
reports every table missing, which proves nothing. Build a real one first — check out the
models as they stood before your change, `cd backend && go run ./cmd/migrate`, put some rows
in it, then add your models — and delete the file again afterwards so the working tree is as
you found it.

### Upload validation trusts the client

`file.Header.Get("Content-Type")` is compared against a three-entry allowlist
([`upload.go:29-33`](../backend/internal/handlers/upload.go#L29-L33)) — no magic-byte
sniffing, no decode, and the extension comes from the user-supplied filename. Any file
declaring `image/png` is stored and then served publicly.

Two mitigations landed with the container pass, neither of which fixes the cause: Nginx
caps request bodies at 8 MB (`client_max_body_size`), and `/uploads/` is served under
`Content-Security-Policy: default-src 'none'; … sandbox`, so an HTML file smuggled in as an
image cannot execute against this origin. Real validation is still owed.

Note the E2E suite depends on this weakness (it uploads the bytes `fake image data`), so
tightening validation requires a real image fixture.

### Uploaded files are publicly readable

`r.Static("/uploads", "./uploads")` is registered **outside** the protected group
([`main.go:22`](../backend/cmd/server/main.go#L22)), and Nginx now proxies `/uploads/`
through to it. Anyone who knows a filename can fetch any avatar. Filenames are nanosecond
timestamps — not guessable, but not access-controlled either, and not namespaced per user.

### JWT signing method is not pinned

`ValidateToken`'s keyfunc returns the key unconditionally, with no
`jwt.WithValidMethods([]string{"HS256"})`. `golang-jwt/v5` rejects `alg: none` on its own,
but pinning is the standard defence and is a one-line change.

### Rate limiting stops at the proxy

`/api/login` and `/api/signup` are limited to 20 requests per minute per IP by Nginx
([`nginx.conf`](../nginx.conf)), which is where the traffic arrives — but the limit lives in
the proxy, so it does not exist for anything that reaches the backend another way, and it
counts `$binary_remote_addr`, which is a single address behind a NAT or a CDN. The
application itself still has no account lockout and no attempt counter.

### No email validation, no password policy

`binding:"required"` only. `{"email":"x","password":"y"}` creates a valid account. Email
changes via `PUT /api/me` have no verification flow — the code comment acknowledges this.

### The backend↔Postgres link is unencrypted

The DSN hardcodes `sslmode=disable`
([`database.go:39`](../backend/internal/database/database.go#L39)). It is a private,
`internal` Docker network with no gateway, so the traffic never leaves the host and this is
a reasonable trade — but it is a hardcoded value, not a configured one, so moving Postgres
to another host would silently keep sending credentials in clear.

---

## Test and CI gaps

### The Go suite runs on SQLite while production runs Postgres

Every backend test opens `glebarez/sqlite` — see
[`relationships_test.go:30`](../backend/internal/handlers/relationships_test.go#L30) and
[`database_test.go:18`](../backend/internal/database/database_test.go#L18). SQLite is the
laxer engine, so a query can be green in `go test` and fail in the container.

This is not hypothetical. `GetRelationships` ordered by the `latest_date` **alias** inside
an expression (`ORDER BY latest_date IS NULL`). SQLite allows that; Postgres accepts an
output alias only when it stands alone, so the homepage answered 500 with
`column "latest_date" does not exist` against a schema that was perfectly up to date. The
handler now repeats `MAX(analysis_subjects.date)` instead, which both engines accept —
[`relationships.go:171-184`](../backend/internal/handlers/relationships.go#L171-L184).

`make migrate-check` does **not** cover this class: the schema was never the problem. The
gap closes only by running the handler tests against Postgres too.

*Watch for:* aliases in `ORDER BY`/`WHERE` expressions, `GROUP BY` that omits a selected
column, and anything relying on SQLite's dynamic typing.

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
(161/161 green) and `go test` (all green) are **not** run in CI, nor are `eslint` or
`go vet`. The pipeline is red by construction while both healthy suites go unverified.

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

### Frontend coverage has gaps at the edges

`Auth`, `Dashboard` (including `PersonForm`, guided scoring, the card surface, the summary
line, the wheel handler, quick pulse, the cadence nudge and the stack-level dialogs),
`WhatChanged`, `LoveShape`, `AnalysisTimeline`, `TimelineRoute` (both the id route and the
legacy redirect), `SubjectsContext`, `DiscretionContext`, `Vault`, `AppLock`, the cadence
arithmetic, and `App`'s login handoff are covered — 161 tests. Still untested: `Profile`,
`Navbar`, `Landing`, `StackActions`'s click-outside dismissal, `AppLock`'s idle timer (it
needs fake timers), and the `CardStack` offset transform table.

Note that Recharts renders nothing under jsdom (`ResponsiveContainer` measures zero), so the
chart components are tested through their exported pure functions and dot renderers rather
than by asserting on SVG. Visual regressions in the charts are **not** covered by any suite.

### `upload_test.go` leaves files behind

The cleanup glob is `uploads/profile_test_*.jpg`, but the handler names files
`profile_<UnixNano><ext>` and ignores the uploaded filename — so nothing matches. Four
generated images are already committed under `backend/internal/handlers/uploads/`, and every
`go test ./...` adds two more untracked ones. When clearing them, delete only the untracked
files — the four committed ones are tracked and removing them is a separate decision.

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

### ~~The development SQLite database is missing from the working tree~~ — resolved

**Closed 2026-08-22.** This described the file mid-removal: deleted in the working tree but
still tracked. The removal was finished — it is untracked at HEAD — so there is nothing to
restore and nothing to check out. What remains of it is the `.gitignore` half, which is
recorded above under
[the SQLite database entry](#the-development-sqlite-database-is-no-longer-committed-but-is-still-not-ignored).

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

---

## Architectural limitations

These are design consequences, not bugs — but they bound what can be built without a
migration.

| Limitation | Consequence |
| :--------- | :---------- |
| **Relationship uniqueness is enforced in handlers, not the database** | Soft deletes would need a partial unique index, spelled differently on SQLite and Postgres. Two simultaneous creates of the same new name could race into duplicate relationships. Worst case is two stacks the user can merge; acceptable for a single-user tool. |
| **The `relationship_id` foreign key is not enforced on upgraded SQLite databases** | GORM writes the constraint into `CREATE TABLE`, so a *fresh* SQLite database and Postgres both get it, but SQLite cannot retrofit one onto an existing table. Handler-level `user_id` checks are the effective guarantee everywhere. (Same reason SQLite refuses to drop that column — which is why it has its own migration test.) |
| **`AnalysisSubject.Name` is still denormalized** | Rename and merge sync it in a transaction, but the same fact lives in two tables. Retained deliberately this phase so rollback is trivial and old clients keep working; removing it is a follow-up. |
| **Merging is one-way** | Nothing records which snapshots came from where, so a merge cannot be undone in-app. The dialog says so before acting; restoring a backup is the only reversal. |
| **An emptied relationship lingers** | Deleting a stack's last version leaves the relationship row with `snapshot_count: 0`. Intentional — posting that name again reuses it, so the stack returns with its identity and URL intact — but it does mean `GET /api/relationships` can list stacks the dashboard does not draw. |
| **`stats` is an opaque JSON column** | No SQL filtering or aggregation per category (and `stats->>'x'` would be Postgres-only, breaking the SQLite fallback). All analysis is client-side. |
| **No pagination** | Every subject is fetched on every dashboard mount. Ordered server-side since Phase 4, but still unbounded; deliberately deferred until a real dashboard exceeds ~500 snapshots. |
| **Soft deletes only** | The database grows monotonically; nothing is ever reclaimed; `users.email` stays reserved by a soft-deleted user (latent — no user-delete endpoint exists). |
| **`AutoMigrate` plus one hand-written backfill** | No migration files and no version table. The Phase 4 backfill is idempotent Go run at boot, not a versioned migration — it works, but a second structural change would want real tooling. Renames, type narrowing, and constraint changes still need hand-written SQL per environment. |
| **No `user_id` foreign key** | No referential integrity; deleting a user would orphan their relationships and subjects. Unchanged by Phase 4 — no user-delete endpoint exists. |
| **Reminders exist only while the app is open** | Cadence is computed in the browser from data already loaded. That is a deliberate trade for "nothing leaves this machine", but it does mean a rhythm you never visit never nudges you. An email digest would need a scheduler, an outbound connection, and a different privacy claim. |
| **Discretion mode is visual only** | Names and notes are masked on screen; the data, the API responses, the export, and assistive-technology labels are unchanged. It defends against the person next to you, not against anyone with access to the machine. |
| **The app lock encrypts nothing** | A SHA-256 hash in `localStorage` gates the UI. The database is exactly as readable as before, there is no recovery flow, and clearing site data removes the lock. The Vault page says all three. |
| **Export omits avatars** | Format version 1 carries `profile_picture` only as a path; the image bytes are not included, so a restore into a fresh install has no avatar. |
| **Nothing is encrypted at rest** | The SQLite file or Postgres database holds notes and scores in plain text. Passwords are bcrypt-hashed; nothing else is protected. |
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
