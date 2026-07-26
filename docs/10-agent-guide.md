# 10 — Agent Guide

Operational guidance for a coding agent working in this repository: the invariants that
must not be broken, the traps that produce silent failures, and step-by-step recipes for
the changes most likely to be requested.

---

## 1. Orientation in sixty seconds

```
React 19 SPA (src/)  ──HTTP /api──►  Go + Gin (backend/)  ──GORM──►  Postgres or SQLite
```

- Two records exist: `User` and `AnalysisSubject`. That is the entire schema
  ([`models.go`](../backend/internal/models/models.go), 27 lines).
- A "person" is not stored — it is `AnalysisSubject` rows grouped by identical `name`
  **in the browser**.
- The seven love categories exist **only** in the frontend `CATEGORIES` constant. The
  backend stores an untyped `map[string]int`.
- Auth is a stateless 24-hour JWT in `localStorage`; the middleware puts `userID` in the
  Gin context and every query filters on it.
- No service layer, no global store, no migration files, no `.env` support.

Read [Concepts](01-concepts.md) before touching domain copy, and
[Architecture](02-architecture.md) before touching data flow.

---

## 2. Hard invariants

Breaking any of these produces a silent or confusing failure rather than a clean error.

| # | Invariant | Why |
| :- | :-------- | :-- |
| 1 | **The primary key is `person.ID`, uppercase.** | `gorm.Model` has no JSON tags. `person.id` is `undefined`; the request goes to `/api/subjects/undefined`. [Details](03-data-model.md#2-gormmodel-and-the-id-casing-trap) |
| 2 | **Never move the axios header assignment in `App.jsx` into an effect.** | Child effects run before parent effects; the dashboard's first fetch would go out unauthenticated. [Details](06-frontend.md#the-module-scope-header-assignment) |
| 3 | **Category `id`s are permanent, and now live in two languages.** | They are the stored `stats` keys, the `uncertain` entries, the `guide_answers` outer keys, *and* the server's validation allowlist ([`domain.CategoryIDs`](../backend/internal/domain/categories.go)). Renaming one orphans every historical value and starts 400-ing the new one. |
| 4 | **Tailwind colour classes must be complete literal strings.** | The JIT scanner cannot see `` `bg-${x}-400` ``; interpolated classes are purged and render colourless. |
| 5 | **Register protected routes inside the `protected` group** in `main.go`. | Outside it, the route is public with no warning — that is how `/uploads` became unauthenticated. |
| 6 | **Read the user id from `c.Get("userID")`, never from the request body.** | It is the only trusted identity source. |
| 7 | **Scope every subject query with `AND user_id = ?`.** | There is no ACL layer; per-query scoping *is* the authorisation model. Return 404, not 403. |
| 8 | **Dates on the wire are `YYYY-MM-DD`.** | `time.Parse("2006-01-02", …)`. RFC3339 is rejected with a 400. |
| 9 | **Add new models to `AutoMigrate`.** | Otherwise the table is never created. |
| 10 | **Prefer additive schema changes.** | `AutoMigrate` never drops, renames, or narrows. Renames need hand-written SQL per environment. |
| 11 | **Do not change the `Auth.jsx` placeholders or button labels casually.** | `name@example.com`, `••••••••`, "Sign In", "Create Account", "Analyze & Save", "Account created! Please log in." are all test selectors in the unit and/or E2E suites. The same now applies to `PersonForm`'s note placeholder and the "Add a custom tag" label. |
| 12 | **`PUT /api/subjects/:id` is a partial merge.** | Absent field = unchanged; present field = written, including `""`/`[]`. Keep `UpdateSubjectInput`'s fields pointers — turning one back into a value type silently reinstates the description-wipe bug. |
| 13 | **Never silently discard bad input.** | Validation failures return a 400 naming the field. A handler that "just ignores" a malformed value is how the old date bug survived. |
| 14 | **Absent ≠ zero, in `stats`.** | A missing key means the category was skipped. Read it with a presence check (`isScored`), never `stats[id] \|\| 0`. |
| 15 | **The user authors every number.** | The guided-scoring band is a suggestion drawn on the track; only an explicit "Use N" click moves the slider. No code path may write a score the user did not confirm. |
| 16 | **Guide answers store the scale *index* (0-3), not its value (0/35/70/100).** | The band arithmetic maps index → value through `GUIDE_SCALE`. Confusing them yields a band that looks reasonable and is wrong. |

---

## 3. Traps that fail silently

Ranked by how much time they waste.

1. **`person.id` vs `person.ID`** — invariant 1. Always uppercase for the PK; lowercase
   snake_case for everything the models declare explicitly (`user_id`, `mbti_type`,
   `profile_picture`).
2. **Legacy rows can hold values today's validation would reject.** Validation runs on
   write only; a pre-existing `{"love": -999}` or an untrimmed `"Alex "` still reads back
   fine and still splits a stack. Do not assume stored data satisfies the current rules.
3. **`tags` is `null` on old rows**, not `[]`. Always read it as `person.tags || []`.
4. **A save that fails must leave the form open.** `handleCloseForm()` deliberately sits
   *inside* `try`, after the awaits. Moving it to a `finally` throws away the user's input
   on every failure.
5. **The `animate-*` classes do nothing.** `tailwindcss-animate` is not installed. Do not
   debug "why the modal doesn't animate" — install the plugin or drop the classes.
6. **`GET /api/subjects` has no `ORDER BY`.** Never assume ordering; both consumers sort
   client-side, in opposite directions (cards descending, timeline ascending).
7. **`uncertain` must stay consistent with `stats`.** Change which categories are scored and
   you must send `uncertain` in the same request, or the server rejects the update.
8. **`npm run preview` has no API proxy** — `server.proxy` is dev-only. Use Docker to test
   a production build against the API.
9. **Run the backend from `backend/`.** `alexithymia.db` and `uploads/` are CWD-relative.
10. **`go test ./...` leaves files behind** in `backend/internal/handlers/uploads/` (the
    test's cleanup glob does not match the handler's naming scheme). Check `git status`.
11. **`Profile.jsx` is outside the global axios interceptors.** It has its own instance, so
    the 401 auto-logout in `App.jsx` does not cover the profile screen.
12. **Port 8080 is the backend in dev but the frontend under Docker.** They collide.

---

## 4. Recipes

### Recipe 1: Add or change a love category

**Three places, two languages.** The prose is frontend-only, but the `id` is also the
server's validation allowlist — skip step 3 and every save carrying the new key 400s.

1. Append to `CATEGORIES` in
   [`src/components/Dashboard.jsx`](../src/components/Dashboard.jsx), matching the
   existing shape exactly: `id`, `label`, `description`, `color`, `textColor`,
   `borderColor`, `extendedDescription`, `coreMotivation`, `metrics[{title, description}]`,
   `anchors[{min, max, phrase}]`. Use **literal** Tailwind class strings. The anchor bands
   must start at 0, end at 100 and be contiguous — a unit test enforces it.
2. Add the matching hex to `CATEGORY_COLORS` in
   [`src/components/AnalysisTimeline.jsx`](../src/components/AnalysisTimeline.jsx#L15-L23) —
   Recharts needs a real colour for the SVG stroke. **This step is the one most often
   forgotten**; a missing entry yields an invisible line.
3. Add the `id` to `CategoryIDs` in
   [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go).
   Ids only — no labels, colours, or prose migrate to Go.
4. Optionally mirror the prose into
   [`TestImplementationDetails.txt`](../TestImplementationDetails.txt), the editorial
   source for this copy.
5. Verify: the slider list, the bar chart, the category grid and detail view, and the
   timeline legend all pick it up automatically — they iterate `CATEGORIES`.

Existing subjects simply have no key for the new id and render as 0%.

**To rename a category's `id`**, you must also migrate stored data — every existing
`stats` JSON blob carries the old key. Prefer changing only the `label`.

**To recolour**, change both `color` (Tailwind class) and the `CATEGORY_COLORS` hex, and
keep them consistent — the bar chart and line chart must agree.

### Recipe 2: Add a field to `AnalysisSubject`

Example: a `confidence int` field. Six files, in this order:

1. **Model** — [`models.go`](../backend/internal/models/models.go):
   `Confidence int \`json:"confidence"\``
   Additive, so `AutoMigrate` adds the column on next boot. No migration file.
2. **Binding structs** — **both** of them in
   [`subjects.go`](../backend/internal/handlers/subjects.go): `Confidence int` on
   `CreateSubjectInput`, `Confidence *int` on `UpdateSubjectInput`. The pointer is what
   keeps the field safe from clients that omit it.
3. **`CreateSubject`** — add to the `models.AnalysisSubject{…}` literal, plus a validator
   call if the field has a valid range.
4. **`UpdateSubject`** — `if input.Confidence != nil { subject.Confidence = *input.Confidence }`,
   beside the other assignments. Do not assign unconditionally.
5. **Form** — `PersonForm` in `Dashboard.jsx`: add state, an input, and include it in the
   `onSave({...})` payload. Omitting it from `onSave` no longer destroys stored data (the
   server ignores absent fields), but the user's edit will appear to do nothing.
6. **Display** — the card body in `CardStack`, and/or the timeline.

Then update the sqlmock `INSERT` expectation in
[`subjects_test.go`](../backend/internal/handlers/subjects_test.go) — it asserts the
literal column list and placeholder count, so it **will** fail until you add the new
column and argument. Add a partial-merge case too: a `PUT` body without your field must
leave it unchanged.

### Recipe 3: Add a new API endpoint

Example: `GET /api/subjects/:id`.

1. Handler in the appropriate `handlers/*.go` file, following
   [the skeleton](05-backend.md#42-the-universal-handler-skeleton): identity first, bind
   second, owner-scoped query third, respond fourth.
2. Register it **inside the `protected` group** in
   [`main.go:27-34`](../backend/cmd/server/main.go#L27-L34).
3. Errors as `gin.H{"error": "…"}`; a not-found or not-owned row is `404`, never `403`.
4. Add a table-driven test with at least Valid / Unauthorized / Not Found / Database Error
   cases, using `setupMockDB` + `setupGinTestRouter` from
   [`subjects_test.go`](../backend/internal/handlers/subjects_test.go).
5. Client call: plain `axios.get('/api/subjects/' + id)` — the global default header is
   already set. Do not create a new axios instance (see Recipe 6).

### Recipe 4: Make the timeline a real route

The most commonly wanted structural change: today the timeline is a conditional swap, so
it is not linkable and Back leaves the dashboard
([Architecture §5](02-architecture.md#the-timeline-is-not-a-route)).

1. Add `<Route path="/timeline/:name" element={token ? <TimelinePage /> : <Navigate to="/login" />} />`
   in [`App.jsx`](../src/App.jsx#L42-L55).
2. Create a `TimelinePage` wrapper that reads `useParams().name`, fetches
   `GET /api/subjects`, filters by name, and renders `AnalysisTimeline`. `CATEGORIES_EXPORT`
   is already exported for exactly this.
3. Replace `onAnalyze={setSelectedTimelineStack}` with
   `navigate('/timeline/' + encodeURIComponent(person.name))`, and delete
   `selectedTimelineStack` plus the conditional block at
   [`Dashboard.jsx:588-620`](../src/components/Dashboard.jsx#L588-L620).
4. `onBack` becomes `navigate('/')`.

Watch out: names can contain `/`, `#`, and `?` — encode on the way out and decode on the
way in. This also fixes the current snapshot-staleness (the chart not reflecting edits made
while it is open).

### Recipe 5: Surface an error on a new screen

`Dashboard` and `Profile` already do this; copy whichever is closer.

- **Local**: a `notice`/`message` state of `{type: 'success'|'error', text}` rendered as a
  dismissible `role="alert"` banner — emerald for success, red for error. `Dashboard`'s
  `errorText(error, fallback)` helper prefers the server's own message
  (`error.response.data.error`) and falls back to a written sentence that says what to do.
- **Global 401 handling** is already installed in `App.jsx` (a response interceptor that
  clears the token, registered in a `useEffect` and ejected on cleanup so StrictMode's
  double-invoke cannot stack duplicates). It covers the global axios only — `Profile.jsx`'s
  private instance stays uncovered until Recipe 6.
- **Do not close a modal on failure.** Keep the close call inside `try`, after the awaits,
  so failed input survives for a retry.

### Recipe 6: Unify the axios setup

`Profile.jsx` creates its own instance with a request interceptor; everything else uses the
global default header ([Frontend §6](06-frontend.md#its-own-axios-instance--an-inconsistency-worth-knowing)).

Preferred direction: keep one global axios, and replace the module-scope header assignment
in `App.jsx` with a single request interceptor that reads `localStorage` per request. That
removes the load-bearing ordering hazard of invariant 2 entirely. Then delete the local
`api` instance from `Profile.jsx` and use bare `axios`.

Do this as its own change, not folded into a feature.

### Recipe 7: Make the E2E suite pass

See [Testing §3.3](08-testing.md#33-making-e2e-actually-pass) for the exact config. In
short: uncomment/introduce `baseURL` and `webServer` in `playwright.config.ts`, switch the
spec to relative URLs, delete `tests/example.spec.ts`, and add a `setup-go` step to the
workflow. Consider adding a `/healthz` endpoint — the backend has none, so
`webServer.url` currently has to poll a route that answers 401.

### Recipe 8: Extend request validation

The pattern is established in
[`subjects.go`](../backend/internal/handlers/subjects.go): small pure helpers above the
handlers (`validateStats`, `validateTags`, `parseSubjectDate`), each returning an `error`
whose message is written for a human, called from both write paths.

```go
func validateStats(stats map[string]int) error {
    for k, v := range stats {
        if !domain.IsCategoryID(k) { return fmt.Errorf("unknown stats key: %s", k) }
        if v < 0 || v > 100 { return fmt.Errorf("stats.%s must be between 0 and 100", k) }
    }
    return nil
}
```

Three rules when adding to it:

- **Absence is not invalidity.** A missing `stats` key means "not scored"; a missing body
  field on `PUT` means "unchanged". Only validate what was actually sent.
- **Validate the normalized value.** `validateTags` returns the trimmed slice and that is
  what gets stored, so the check and the write cannot drift.
- **Fixtures are not exempt.** The model-level tests in
  [`database_test.go`](../backend/internal/database/database_test.go) deliberately store
  `{"love": 50, "hate": 12}` — legal, because the allowlist is a handler rule. Handler
  tests must use real ids.

`binding:"dive"` tags cannot express any of this — map *keys* are not covered.

---

## 5. Before you finish

```bash
npm test                        # vitest run — must stay 50/50
cd backend && gofmt -l .        # must print nothing
cd backend && go vet ./...
cd backend && go test ./...     # must stay all-pass
git status                      # did alexithymia.db or uploads/ get dirtied?
```

`npm run lint` is currently **broken in this checkout** — `eslint-plugin-react-hooks@7.0.1`
is installed with an empty `cjs/` build directory, so ESLint exits 2 before linting anything
([Known Issues](11-known-issues.md#npm-run-lint-is-broken-in-this-checkout)). Do not read
its failure as a problem with your change; equally, do not rely on it to catch one.

Then check, specifically:

- Did you touch `models.go` or `subjects.go`? The sqlmock SQL expectations may need
  updating.
- Did you add a category? `CATEGORIES` (with `anchors`), `CATEGORY_COLORS`, **and**
  `domain.CategoryIDs`.
- Did you add a form field? It must appear in the `onSave` payload, and its
  `UpdateSubjectInput` counterpart must be a pointer.
- Did you add a model column? Add it to `additiveColumns` in `database_test.go`.
- Did you read `stats`? With a presence check, not `|| 0`.
- Did you add a route? Inside the `protected` group.
- Did you change `Auth.jsx` copy or placeholders? Run the unit tests.
- Did the SQLite database or `uploads/` change? Revert those files unless the change is
  intentional.

---

## 6. Where things are

| Looking for | Go to |
| :---------- | :---- |
| The seven categories, all copy | `CATEGORIES`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| The seven ids, server-side | `CategoryIDs`, [`domain/categories.go`](../backend/internal/domain/categories.go) |
| Slider anchor phrases | the `anchors` array on each `CATEGORIES` entry |
| Guided-scoring scale and band maths | `GUIDE_SCALE` / `guideBand`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| Preset context tags | `CONTEXT_TAGS`, [`ContextCapsule.jsx`](../src/components/ContextCapsule.jsx) |
| Delta arithmetic and elapsed phrasing | [`WhatChanged.jsx`](../src/components/WhatChanged.jsx) |
| Chart hex colours | `CATEGORY_COLORS`, [`AnalysisTimeline.jsx:15-23`](../src/components/AnalysisTimeline.jsx#L15-L23) |
| Database schema | [`models.go`](../backend/internal/models/models.go) |
| Route table | [`main.go:17-35`](../backend/cmd/server/main.go#L17-L35) |
| Request validation helpers | `validateStats` / `validateTags` / `parseSubjectDate`, [`subjects.go`](../backend/internal/handlers/subjects.go) |
| Auth rules (cost, TTL, claims) | [`auth.go`](../backend/internal/auth/auth.go) |
| Token → `userID` in context | [`middleware.go`](../backend/internal/handlers/middleware.go) |
| 401 auto-logout | the response interceptor in [`App.jsx`](../src/App.jsx) |
| Driver choice + migrations | [`database.go`](../backend/internal/database/database.go) |
| Name grouping into stacks | `groupedPeople`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| Card-stack wheel + transforms | `CardStack`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| One category's scoring row | `CategorySliderRow`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| The create/edit/new-version form | `PersonForm`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) |
| Category explorer modal | `AboutModal`, [`Dashboard.jsx`](../src/components/Dashboard.jsx) — also used by `Landing` |
| Dev proxy + Vitest config | [`vite.config.js`](../vite.config.js) |
| Prod proxy + SPA fallback | [`nginx.conf`](../nginx.conf) |
| Env vars and ports | [Development §4–5](07-development.md#4-ports-at-a-glance) |
| Verified defects | [Known Issues](11-known-issues.md) |

---

## 7. Conventions

**Go** — gofmt (tabs); packages under `internal/`; absolute module imports; input structs
above their handler; errors as `gin.H{"error": …}`; no service layer, handlers call
`database.DB` directly.

**React** — function components with hooks; default export per file; `useMemo` for derived
collections; sub-components declared in the same file when only used there; props for
cross-component state, no Context or store; async handlers wrapped in `try/catch`.

**Styling** — Tailwind utilities only, no custom CSS, unextended theme; `slate` neutrals,
`rose` accent, `rounded-2xl` surfaces, `font-light` headings; lucide icons sized via `size`.

**Naming** — Go: `PascalCase` exported / `camelCase` local. JS: `PascalCase` components,
`camelCase` values, `SCREAMING_SNAKE` module constants. API JSON: `snake_case` for declared
fields, `PascalCase` for the four `gorm.Model` fields. Files: `PascalCase.jsx` for
components, `lowercase.go` for Go.
