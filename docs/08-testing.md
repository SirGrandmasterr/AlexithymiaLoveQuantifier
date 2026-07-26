# 08 — Testing

Three layers, three runners. Status below was verified by running each suite
(2026-07-26).

| Layer | Runner | Location | Verified status |
| :---- | :----- | :------- | :-------------- |
| Frontend unit | Vitest + Testing Library + jsdom | `src/components/*.test.jsx` | ✅ **50/50 pass** |
| Backend unit / integration | `go test` + sqlmock + in-memory SQLite | `backend/internal/**/*_test.go` | ✅ **all packages pass** |
| End-to-end | Playwright | `tests/` | ❌ **failing** — needs servers that nothing starts |

```bash
make test          # all three in sequence
make test-frontend # vitest run
make test-backend  # cd backend && go test ./...
make test-e2e      # npx playwright test --project=chromium  (servers must be up)
```

---

## 1. Frontend unit tests

**Configuration** lives in the `test` block of
[`vite.config.js`](../vite.config.js#L7-L12) — there is no separate `vitest.config.js`:

```js
test: {
  globals: true,                    // describe/it/expect/vi without imports
  environment: 'jsdom',
  setupFiles: './src/setupTests.js',
  exclude: ['tests/**', 'node_modules/**'],  // keep out of Playwright's directory
}
```

[`src/setupTests.js`](../src/setupTests.js) is a single line importing
`@testing-library/jest-dom`, which supplies `toBeInTheDocument`, `toBeDisabled`,
`toHaveValue`, `toHaveTextContent`.

The `exclude` entry matters: without it Vitest would try to execute the Playwright specs
in `tests/` and fail on `@playwright/test` imports.

### Coverage today

Four files, 50 tests, all passing.

[`src/components/Auth.test.jsx`](../src/components/Auth.test.jsx) — 7 tests:

| Test | Asserts |
| :--- | :------ |
| renders login view by default | "Welcome back", Sign In button, toggle link |
| toggles to signup view | "Create your account", Create Account button, reverse toggle |
| allows email/password input | controlled inputs hold typed values |
| handles successful login | correct `POST /api/login` payload, loading state, `onLogin(token)` |
| handles successful signup | correct `POST /api/signup` payload, success message, auto-return to login |
| displays API error message | `err.response.data.error` is rendered, button re-enabled |
| displays generic error | falls back to "An error occurred" for a bare `Error` |

[`src/components/Dashboard.test.jsx`](../src/components/Dashboard.test.jsx) — 26 tests over
the pure helpers, the exported `PersonForm`, and the whole `Dashboard` screen:

| Group | Asserts |
| :---- | :------ |
| Anchors | the band containing a value at the boundaries (0, 20, 21, 100), and that **every** category's bands start at 0, end at 100, and leave no gap — a content guard, not just a code one |
| Guide band | `{0:1, 2:2}` (35 and 70) → `{count: 2, midpoint: 53, min: 45, max: 61}`; clamping at both ends; `null` until something is answered |
| Context capsule | trimmed-name payload including `uncertain`/`guide_answers`; Enter adds a tag instead of submitting; edit seeds note + tags; new version starts empty |
| Guided scoring | the anchor phrase follows the slider; answering a metric renders the band **without moving the slider**; `Use 70` sets exactly the midpoint; the saved payload carries the answers |
| Skip / unsure | a skipped category is absent from `stats` (not zero); an unsure id is listed; skipping a category drops its unsure flag; edit seeds both from the snapshot; a new version inherits scores but not uncertainty |
| Card surface | note icon and up to three chips, `+1` overflow, `—` for five skipped categories and `≈60%` for an unsure one, and **no** `0%` anywhere |
| What Changed | appears after a new version, **not** after an in-place edit; shows the elapsed sentence and `↑30`; the note follow-up PUTs only `{description, tags}` |
| Errors | fetch failure surfaces in `role="alert"`; a failed save keeps the form open with its input; the banner dismisses |

[`src/components/WhatChanged.test.jsx`](../src/components/WhatChanged.test.jsx) — 15 tests.
Mostly pure-function tests of `computeDeltas` (ordering, steady collapse, not-comparable,
uncertain propagation, and that a **score of 0 is not a skip**), `findPreviousVersion`
(same-name only, backdated → `null`, undated fallback) and `elapsedSentence` (each unit
boundary, same-day, undated), plus four screen tests covering the delta list, the note save,
the note failure path, and dismissal.

[`src/components/AnalysisTimeline.test.jsx`](../src/components/AnalysisTimeline.test.jsx) —
4 tests. `makeDotRenderer` is tested directly (solid / dashed / nothing) because Recharts
never calls it under jsdom, plus one render test for the conditional legend hint.

**Untested:** `Profile`, `Navbar`, `Landing`, and `App`'s routing guards (including the 401
interceptor). Within `Dashboard`, the `groupedPeople` grouping and the `CardStack` offset
transform table remain the highest-value additions.

### Patterns to copy

**Module-level axios mock:**

```js
vi.mock('axios');
axios.post.mockResolvedValueOnce({ data: { message: 'User created' } });
axios.post.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
```

**Controlled-promise trick for asserting a loading state** — the suite holds the request
pending so the intermediate UI can be observed
([`Auth.test.jsx:48-86`](../src/components/Auth.test.jsx#L48-L86)):

```js
let resolveMock;
axios.post.mockReturnValueOnce(new Promise(r => { resolveMock = r; }));
…
userEvent.click(submitButton);                 // intentionally NOT awaited
await waitFor(() => {
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('Please wait...');
});
resolveMock({ data: { token: mockToken } });   // then release it
await waitFor(() => expect(mockOnLogin).toHaveBeenCalledWith(mockToken));
```

**Queries are placeholder- and role-based**, never CSS selectors:
`screen.getByPlaceholderText('name@example.com')`,
`screen.getByRole('button', { name: /sign in/i })`. Keep it that way — and note that the
placeholders `name@example.com` and `••••••••` are load-bearing selectors in both this
suite and the E2E spec.

`beforeEach(() => vi.clearAllMocks())` is standard here.

---

## 2. Backend tests

`cd backend && go test ./...` — verified output:

```
?   alexithymia-backend/cmd/server        [no test files]
?   alexithymia-backend/internal/auth     [no test files]
ok  alexithymia-backend/internal/database 0.789s
ok  alexithymia-backend/internal/handlers 0.152s
?   alexithymia-backend/internal/models   [no test files]
```

Tests are in-package (`package handlers`, `package database`), so they can reach
unexported identifiers and reassign `database.DB`.

### 2.1 `database_test.go` — real SQLite integration

[`backend/internal/database/database_test.go`](../backend/internal/database/database_test.go)
opens `file::memory:?cache=shared` and runs the real `AutoMigrate`, so it validates GORM
tag behaviour rather than mocking it.

- **`TestDatabaseIntegration_UserConstraints`** — insert succeeds and an auto-increment
  `ID` is assigned; a duplicate email violates `uniqueIndex`. The `not null` case is
  intentionally only *logged*, because SQLite and Postgres differ on empty-string
  handling — an honest limitation, documented in the test's own comments.
- **`TestDatabaseIntegration_SubjectRelationships`** — the important one. It proves the
  `gorm:"serializer:json"` round-trip on `Stats` (`{"love":50,"hate":12}` survives write
  and read), on `Tags` (`["conflict","trip together"]`) and on the nested
  `GuideAnswers` map, that `*time.Time` survives
  (truncated to the second for SQLite precision), and that soft delete works both ways: a
  normal `First` returns `ErrRecordNotFound` while `Unscoped().First` finds the hidden row.
- **`TestAutoMigrateAddsNewColumns`** — the additive-migration guard. It migrates a
  **file-backed** temp database, drops every column in `additiveColumns`
  (`tags`, `uncertain`, `guide_answers`), inserts a legacy row, then re-runs `AutoMigrate`
  and asserts the columns return with the old row's note intact and the new fields empty.
  **Add any future additive column to that list.** Use `t.TempDir()` plus an explicit
  `sqlDB.Close()` in `t.Cleanup` for any new file-backed test — Windows cannot delete a
  SQLite file whose handle is still open.

> These are the guard rails for the least obvious persistence behaviours in the project.
> Any change to the serialized column types, to soft-delete semantics, or to
> `AutoMigrate` compatibility fails here first.

Note the model-level tests deliberately use nonsense stats keys (`{"love":50}`): the
seven-id allowlist is a *handler* rule, not a database constraint.

### 2.2 `subjects_test.go` — sqlmock at the SQL layer

[`backend/internal/handlers/subjects_test.go`](../backend/internal/handlers/subjects_test.go)
mocks the *driver*, not a repository, because handlers call `database.DB` directly:

```go
db, mock, _ := sqlmock.New()
dialector := postgres.New(postgres.Config{Conn: db, DriverName: "postgres"})
gormDB, _ := gorm.Open(dialector, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
database.DB = gormDB     // package-global substitution
```

Consequences of this choice:

- Expectations are **literal SQL** wrapped in `regexp.QuoteMeta`, including GORM's exact
  column order:
  `INSERT INTO "analysis_subjects" (…,"stats","tags","uncertain","guide_answers") VALUES ($1,…,$11) RETURNING "id"`.
  Adding a field to the model, renaming a model, or upgrading GORM will break these
  strings — every column added so far has broken exactly this line, and the `UPDATE`
  argument lists with it. That is a deliberate trade: the tests are brittle but they *do*
  verify the real emitted SQL.
- The mock is a **Postgres** dialect even though local dev often uses SQLite, so these
  tests describe production SQL.
- Soft delete is asserted as an `UPDATE`, pinning that behaviour.
- `mock.ExpectationsWereMet()` is checked in every subtest, so *unfired* expectations also
  fail — the suite catches missing queries as well as wrong ones.

**Authentication is faked with an inline middleware:**

```go
func setupGinTestRouter(handler gin.HandlerFunc, userID uint, authenticated bool) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.Default()
	r.Use(func(c *gin.Context) {
		if authenticated { c.Set("userID", userID) }
		c.Next()
	})
	return r
}
```

This is why every handler's defensive `!exists → 401` branch is reachable and tested. Note
the `handler` parameter is **unused** — callers register the route themselves right after
(`r.POST("/subjects", CreateSubject)`). Harmless, but do not assume passing a handler here
wires anything.

Table-driven cases per handler:

| Handler | Cases |
| :------ | :---- |
| `TestCreateSubject` | Valid Request · Name Is Trimmed Server-Side · Partial Stats Are Accepted (missing keys are legal) · Whitespace-Only Name → 400 · Unknown Stats Key → 400 · Stats Value Above/Below Range → 400 · Malformed Date → 400 · Too Many Tags / Blank Tag / Overlong Tag → 400 · Unknown Uncertain Category → 400 · Uncertain About An Unscored Category → 400 · Unknown Guide Answer Category / Above Scale / Non-Index Key → 400 · Unauthorized · Missing Required Fields · Database Error (rollback → 500) |
| `TestCreateSubjectPersistsContext` | The note, the trimmed tags, the parsed date, the uncertain flags, and the nested guide answers all come back on the created row. |
| `TestGetSubjects` | Valid (2 rows, length asserted after unmarshalling) · Unauthorized · Database Error |
| `TestUpdateSubject` | Valid (SELECT then UPDATE; note the id arrives as the **string** `"1"` from the route param) · Not Found (`gorm.ErrRecordNotFound` → 404) · Invalid JSON → 400 · Unknown Stats Key → 400 · Malformed Date → 400 · Whitespace-Only Name → 400 · Guide Answer Out Of Range → 400 · **Stats Update Orphans An Uncertain Flag** → 400 (the post-merge invariant) |
| `TestUpdateSubjectPartialMerge` | **The description-wipe regression guard.** A body of only `{"stats":…}` leaves name, description, date, tags, uncertain, and guide answers exactly as stored. |
| `TestUpdateSubjectExplicitClear` | `{"description":"","date":"","tags":[]}` really does clear — absent ≠ empty. |
| `TestDeleteSubject` | Valid (soft-delete UPDATE) · Not Found — Nothing Deleted (`RowsAffected == 0` → 404) · Unauthorized · Database Error |

Validation subtests assert on the **error string** as well as the status, via an
`expectedError` substring field on the table — status codes alone would not catch a check
firing for the wrong reason.

### 2.3 `upload_test.go` — multipart handling

[`backend/internal/handlers/upload_test.go`](../backend/internal/handlers/upload_test.go)
builds multipart bodies by hand. `createMultipartPayload` cannot use
`writer.CreateFormFile` for the negative cases because that helper hardcodes
`application/octet-stream`; so for an explicit MIME it resets the buffer and constructs the
part headers manually via `writer.CreatePart` — that is what the somewhat convoluted
branch at lines 26-45 is doing.

Cases: Valid JPEG · Valid PNG · Unauthorized · Invalid Field Name (`wrong_field` instead of
`image`) · Invalid File Type (`application/x-msdownload`).

Two rough edges in this file, both cosmetic but worth knowing before editing it:

- **The cleanup glob never matches.** `defer` removes `uploads/profile_test_*.jpg`, but the
  handler names files `profile_<UnixNano><ext>` and ignores the uploaded filename entirely.
  So every run leaves real files in `backend/internal/handlers/uploads/` — four are already
  committed to the repository. Correct fix: glob `uploads/profile_*` (and, better, make the
  upload directory configurable so tests can point at `t.TempDir()`).
- `requireRegex` is an identity function (`return str`) used only to gate a
  `bytes.Index` check, and the unmarshalled `response` map is assigned but never asserted.
  Both are leftovers; substring matching on `w.Body` is what actually runs.

### 2.4 Untested backend surface

`internal/auth` has **no tests at all** — bcrypt hashing, token generation, expiry, and
tamper rejection are unverified. That is the single largest gap in the backend, and it is
cheap to close (pure functions, no HTTP, no database). The one wrinkle: `jwtKey` is read at
package init, so a test cannot set `JWT_SECRET` from inside a test function — it must
either rely on the empty-key default or the code must be refactored to read the key lazily.

`Signup`, `Login`, `GetUserProfile`, and `UpdateUserProfile` also have no handler tests.
Testing `Signup`/`Login` through sqlmock is feasible but slow: bcrypt cost 14 makes each
hash roughly a second.

---

## 3. End-to-end tests

### 3.1 The real journey

[`tests/e2e/user_journey.spec.ts`](../tests/e2e/user_journey.spec.ts) — one test, three
`test.step`s, covering the critical path against a live stack:

1. **Navigate and Login** — go to `http://localhost:5173/`, click *Sign In*, toggle to
   sign-up, register a unique `e2e_${Date.now()}@example.com`, assert the "Account
   created! Please log in." banner, log in, assert the *My Analysis* heading.
2. **Create New Analysis Subject** — open the form, assert *Analyze & Save* starts
   disabled, fill the name, assert it enables, drag the first range input to `85`, submit,
   assert the modal closes and a card with the subject's name appears.
3. **Navigate to Profile and Upload Image** — go to `/profile`, register a
   `waitForResponse` interceptor for `/api/upload` **before** setting the file (the correct
   ordering — a `setInputFiles` first would race the response), upload a dummy file created
   in `beforeAll`, await the 200, assert the success banner.

The dummy file is `Buffer.from('fake image data')` with a `.jpg` name — it passes only
because upload validation trusts the client-declared MIME type
([API Reference §5](04-api-reference.md#5-upload-endpoints)). **Adding real image
validation to the backend will break this test**, and the fix is to commit a genuine tiny
JPEG fixture.

The dynamic email exists because the test database is persistent; the spec never cleans up
after itself, so every run adds a user and a subject.

### 3.2 Why it currently fails

`test-results/.last-run.json` records `{"status":"failed"}`, and the cause is structural,
not a flaky assertion:

- **`baseURL` is commented out** and the spec hardcodes `http://localhost:5173`.
- **`webServer` is commented out** in [`playwright.config.ts`](../playwright.config.ts#L74-L78),
  so Playwright starts nothing.
- The CI workflow runs `npx playwright test` with **no frontend, no backend, and no
  database** running — so the journey cannot pass there under any circumstance.
- `tests/example.spec.ts` is the untouched Playwright scaffold that navigates to
  `https://playwright.dev/`. It tests the framework's own website, requires outbound
  internet, and should be deleted.

Config otherwise: `testDir: './tests'`, `fullyParallel: true`, `forbidOnly` and 2 retries
on CI, single worker on CI, `reporter: 'html'`, `trace: 'on-first-retry'`, and three browser
projects (chromium, firefox, webkit) — while `make test-e2e` deliberately narrows to
chromium.

### 3.3 Making E2E actually pass

The minimal, correct fix is to let Playwright own the servers:

```ts
// playwright.config.ts
use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
webServer: [
  { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  { command: 'go run ./cmd/server', cwd: 'backend', url: 'http://localhost:8080/api/subjects',
    reuseExistingServer: !process.env.CI },
],
```

Then change `page.goto('http://localhost:5173/')` to `page.goto('/')` and the URL
assertions to relative paths. Two further steps are needed for CI:

1. Add a `setup-go` step to
   [`.github/workflows/playwright.yml`](../.github/workflows/playwright.yml) — the workflow
   currently sets up Node only.
2. Delete `tests/example.spec.ts`, or the suite still depends on reaching the public
   internet.

A health endpoint would help here: the backend has none, so the `webServer.url` above has
to poll an authenticated route that answers 401 (which Playwright accepts as "up", since it
only waits for an HTTP response).

---

## 4. CI

[`.github/workflows/playwright.yml`](../.github/workflows/playwright.yml) — the only
workflow. On push/PR to `main` or `master`: checkout → Node `lts/*` → `npm ci` →
`npx playwright install --with-deps` → `npx playwright test` → upload `playwright-report/`
for 30 days, 60-minute timeout.

**Not in CI:** `vitest`, `go test`, `eslint`, `go vet`, and any Docker build. (`eslint` would
fail anyway in the current checkout — see
[Known Issues](11-known-issues.md#npm-run-lint-is-broken-in-this-checkout).) Given that
the only suite CI does run cannot pass in that environment, the pipeline is currently
red-by-construction. The highest-value change is to add the two suites that *do* pass:

```yaml
- name: Frontend unit tests
  run: npm test
- uses: actions/setup-go@v5
  with: { go-version: '1.24' }
- name: Backend tests
  run: cd backend && go test ./...
```

---

## 5. Test-writing conventions

**Frontend**
- Co-locate as `ComponentName.test.jsx` beside the component.
- Query by role, label, placeholder, or text — never by class or DOM structure.
- `vi.mock('axios')` at module scope; `vi.clearAllMocks()` in `beforeEach`.
- Assert the axios call *payload*, not just that it was called.
- Use `userEvent` over `fireEvent`; hold a promise open to assert intermediate states.

**Backend**
- In-package tests (`package handlers`), file named `<subject>_test.go`.
- Table-driven with a `name` field and `t.Run(tt.name, …)`.
- Substitute persistence by assigning `database.DB`.
- Use sqlmock for handler tests, real in-memory SQLite for persistence semantics.
- Always assert `mock.ExpectationsWereMet()`.
- Silence GORM's logger (`logger.Silent`) to keep output readable.
- Prefer `t.TempDir()` for anything that touches the filesystem.

**E2E**
- One `test` per journey, split into `test.step`s.
- Unique data per run (`Date.now()` in the email).
- Register `waitForResponse` *before* the action that triggers it.
- Create fixtures in `beforeAll`, remove them in `afterAll`.
