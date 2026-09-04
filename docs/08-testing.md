# 08 — Testing

Three layers in `make test`, three runners — plus a fourth that is deliberately outside it
(§6). Status verified by running each suite (E2E 2026-07-26; backend 2026-08-22; frontend
2026-09-04).

| Layer | Runner | Location | Verified status |
| :---- | :----- | :------- | :-------------- |
| Frontend unit | Vitest + Testing Library + jsdom | `src/**/*.test.{js,jsx}`, `scripts/**/*.test.mjs` | ✅ **1493/1493 pass** (55 files) |
| Backend unit / integration | `go test` + sqlmock + in-memory SQLite | `backend/internal/**/*_test.go` | ✅ **all packages pass** |
| End-to-end | Playwright | `tests/` | ❌ **failing** — needs servers that nothing starts |
| Model gate (§6) | `make journal-eval` | `scripts/journal-eval/` | ⚠️ **runs; no model has been through it** |

```bash
make test          # all three in sequence
make test-frontend # vitest run
make test-backend  # cd backend && go test ./...
make test-e2e      # npx playwright test --project=chromium  (servers must be up)

# Not part of `make test`. Needs weights and minutes; §6.
make journal-eval CANDIDATE=reference   # the harness against itself, no weights
make journal-audio-check                # which golden recordings exist
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

[`src/setupTests.js`](../src/setupTests.js) imports `@testing-library/jest-dom`. The `exclude`
entry matters: without it Vitest would execute the Playwright specs and fail on
`@playwright/test` imports.

### The standing rails

These are the properties the suite exists to hold. Each is structural — breaking it fails a
test that names the rule, not an incidental assertion.

- **No test ever loads a model weight.** `propose(input, context, runtime)` takes its runtime as
  an argument, and every test passes `createFakeRuntime(fixtures)`
  ([`fake.js`](../src/journal/inference/fake.js)); the embedding suites inject
  `createFakeEmbedder` the same way. A suite that needs 219 MB — or 2.6 GB — to run is a suite
  that stops being run. `VoiceCheckin.test.jsx` adds a fake recorder and a fake downloader, so
  nothing touches a microphone, Cache Storage, WebCrypto or 45 MB of weights.
- **Invariant 15 is asserted on the request body.** `ProposalCard.test.jsx` drives the real
  composer in voice mode with `voiceKit.fake.js` and reads what reaches
  `POST /api/journal/entries`: only confirmed chips, their people, and nothing under a dashed
  one. The §4.7 payload is a literal `toEqual` on the whole request, provenance included. Facts
  are asserted **absent**. Five deliberate breakages each failed only the tests naming the rule.
- **The forbidden-word walk** (`journal.test.js`) is a **recursive walk over `JOURNAL_COPY`**,
  plus every `RITUAL_QUESTIONS[].text`/`.note` and `FEELINGS[].label`/`.gloss`, against eighteen
  words — not a list someone remembered to update, so a sentence written next session is covered
  the moment it lands. Two cases guard the walk itself: one reaches a deeply nested path, one
  plants an offending string.
- **Two parity rails.** `journal.test.js` holds `FEELINGS`, `RITUAL_QUESTIONS` and `ENTRY_KINDS`
  id-for-id against `backend/internal/domain/journal.go`; `models.test.js` reads the `Makefile`
  and holds the thirteen pinned model paths **and SHA-256 sums** against the manifest the browser
  verifies. Without the second, the browser's check degrades into a second opinion about the
  operator's. Its first draft silently dropped the licence row (whose sum is a `$(VAR)`), so
  there is a guard assertion on the row count.
- **Nothing about the embedding index leaves the device.** `normalisation.test.jsx` walks **every
  request body** the card and the Triggers view produce and fails on a typed array, on any run of
  sixteen or more numbers, and on any field named `vector`, `embedding`, `dims` or
  `entry_client_id` — with a self-test planting each first, so the walk is known to look.
  `retrieval.test.jsx` types a query and asserts no request is made at all.
- **Rule 2 — never a number — is held in three places**: `journal.test.js` walks
  `JOURNAL_COPY.similar` for digits, `similar.js`/`recall.js` return offers with the similarity
  thrown away, and `retrieval.test.jsx` walks the rendered search screen for one.
- **Absence is asserted by key, not by value.** `RitualVoice.test.jsx` asserts an unmentioned
  question is **missing from `answers`** rather than `false` — invariant 14, and the one place a
  model could invent an answer.
- **`axios.get` is mocked per URL, not once**, since the provider loads subjects and
  relationships in parallel. **A test that depends on which day it is fakes only `Date`.**

### What each frontend suite covers

| File | Covers |
| :--- | :----- |
| `App.test.jsx` | Route guards; the auth header's value **at the moment the first fetch fires** |
| `auth/session.test.js` | Storage choice, renewal margin, both interceptors, one-refresh-at-a-time, 5xx not ending a session |
| `components/Auth.test.jsx` | Both modes, the remembered email (never the passphrase), the whole login payload incl. refresh token, error and generic-fallback rendering, the loading state via a held-open promise |
| `components/Dashboard.test.jsx` | Anchors (every category's bands start at 0, end at 100, no gap), the five distinct phrasings per band, guided scoring and `guideBand` arithmetic, skip/unsure seeding, the card surface (`—`, `≈60%`, never `0%`), the summary line, the wheel trap, routing, all four stack dialogs, Quick Pulse, the cadence nudge, What Changed, error surfaces |
| `components/CheckinComposer.test.jsx` | The two ways in, the feeling cap stated before reached, `unclear` exclusivity, the two dedupe passes in `buildCheckinRequest`, trap 4 |
| `components/ProposalCard.test.jsx` | See the rails above; plus the four ambiguity values, `mergeProposal` over user decisions, and the provenance block |
| `components/RitualCards.test.jsx` | The deck's fixed order, the three gestures, `touch-action: none` present on the card and **absent from every ancestor**, the day word written twice, a skipped question absent from `answers` |
| `components/RitualVoice.test.jsx` | One recording → one `proposeRitual` → a confirm card; unmentioned questions absent |
| `components/Journal.test.jsx`, `JournalPeople.test.jsx`, `JournalTriggers.test.jsx` | The day view, the two vocabulary views, the remove-person dialog's two clauses each with its own verb, rename and merge as `supersedes_id` posts |
| `components/Vault.test.jsx` | **37 tests** — all twenty page claims asserted verbatim, in both opt-in states and on all three tiers; `buildCSV`/`buildJournalCSV` empty-cell rule; the dry-run flow |
| `components/dayGraph.test.js` | 62 tests on the geometry: the eight §8.2 rules, the DST case, `paintersOrder` stability, and a case that reads the source back and fails if a renderer import appears |
| `components/DayGraph.test.jsx` | The drawing: path count **equals** `branchPaths(curve).length`, the gesture contract, the empty day drawing nothing |
| `components/LoveShape.test.jsx`, `AnalysisTimeline.test.jsx`, `WhatChanged.test.jsx` | `buildShapeData`/`ShapeDot` three cases; `buildTimelineData`'s three honesty rules and `makeDotRenderer` called directly; `findPreviousVersion` / `computeDeltas` / `elapsedSentence` |
| `components/VaultKnob.test.jsx` | The gesture, the re-anchor at the stops, the keyboard contract, silence under discretion |
| `components/Profile.test.jsx`, `AppLock.test.jsx`, `TimelineRoute.test.jsx` | The settings rows (incl. the Android tier line, by mocking `isNative()`), the lock's availability check, the four route states |
| `constants/journal.test.js` | 138 pure tests — the readers, civil-day arithmetic, candidate matching, plus the forbidden-word walk and the id-parity rail |
| `constants/cadence.test.js` | Due on the exact day, never without a rhythm, never without a **dated** snapshot, snooze and seen semantics, longest wait first, and `nudgeSentence` against its six forbidden words |
| `context/*.test.jsx` | The two providers' load/mutation contracts, the outbox's queue conditions and flush semantics, discretion's masking |
| `journal/recorder.test.js` | A fake `MediaRecorder` and a scripted level meter: two seconds of silence, thirty seconds of speech, backgrounding mid-take, and that silence *before* the first word never stops one |
| `journal/inference/validate.test.js` | The 120 golden references through the real filter, and `adversarial.js` — every raw output asserted schema-valid and forbidden-word-free before any case-specific expectation |
| `journal/inference/download.test.js` | Fakes `fetch`, `caches` and `crypto.subtle` but uses Node's `createHash`, so the checksum path runs against a **real** SHA-256; its tampering case flips bytes **without changing the length**, because a wrong length is caught a step earlier |
| `journal/inference/tier.test.js` | §5.5's memory table against the numbers phones actually report (a "4 GB" phone says 3.6 GiB); the downward-only override |
| `journal/inference/index.test.js`, `web.test.js`, `native.test.js`, `runtimes.test.js`, `ritual.test.js`, `weights.test.js` | The seam's failure-as-a-value contract and its zero network calls on both paths; `configureEnvironment`'s five settings; that only **handles** cross the native bridge and a browser buffer is refused |
| `journal/embeddings/embed.test.js` | The two **mandatory prompt prefixes** on the exact string, trailing spaces included. The only place a wrong prefix can be caught — downstream there is no symptom, because the vector still has 256 numbers and still ranks, just quietly worse |
| `journal/embeddings/similar.test.js` | **Rule 3 as a gate, not a weight**: a close vector with no shared witness produces nothing, and *two identical vectors still produce nothing*. Also the scan's budget — 10 000 × 256-dim, 2.4 ms measured, asserted under a loose 1 s so a quadratic change fails by minutes |
| `journal/embeddings/recall.test.js` | German folding (`Fußball` = `Fussball`, which NFD does not do), compounds found by their first half, the IDF weighting, and that `orderNamesakes` returns **the same array** reordered — nothing added, removed or selected |
| `journal/embeddings/retrievalGolden.test.js` | Every **lexical** case passes with no model, in both languages; every **semantic** case is asserted *skipped, by name, with a reason*, never graded against a stand-in |
| `journal/embeddings/retrievalPrompt.test.js` | Over all 120 cases with a deliberately hostile retrieval: a retrieval-influenced prompt cannot lose a word a clear case needs, add an unconfirmed word, name a feeling, or change a rule. The last test plants a narrowing retrieval to prove the guard is not vacuous. **It does not prove no model is ever swayed by an ordering** — that needs weights |
| `journal/embeddings/retrieval.test.jsx`, `normalisation.test.jsx`, `logout.test.jsx`, `store.test.js` | The four uses on real screens; the request-body walk; that the index is *emptied* on the no-session branch (`store.test.js` proves `clearVectorIndex` works, `logout.test.jsx` proves it is called — the half a refactor can drop while everything else stays green) |
| `mobile/journalPlugin.test.js` | Behind `journalPlugin.fake.js`, which records call order: **nothing is asked of the plugin at construction or mount, and the first tap asks `checkPermissions` → `requestPermissions` → `startCapture`**, with no second request once granted, a refusal ending as the recorder's ordinary `permission` state, and a background during the prompt leaving the request alone |
| `mobile/offlineCache.test.js`, `deepLink.test.jsx`, `ritualReminder.test.js` | The cache and outbox, `/journal?record=1`, and the local notification's schedule/replace/cancel |
| `scripts/journal-eval/*.test.mjs` | 70 tests on the gate's **arithmetic** — see §6 |

> **The Java core has a JVM harness, not a unit suite.** `LogMel`, `WhisperTokens`,
> `WhisperTranscriber` and `ModelStore` contain no Android import, so they were compiled with a
> desktop JDK against the ONNX Runtime and `org.json` jars and run against the pinned model
> files: the spectrogram matched a NumPy port of PyTorch's to 1.2 × 10⁻⁵, three synthesised
> sentences transcribed word-for-word as transformers.js transcribes them, and the store's cold
> fetch, warm no-op, cancel-and-resume, tampered file, SPA fall-through and 404 cases all
> behaved. The harness lives in that session's scratch space, not the repository.

> **Recharts renders nothing under jsdom.** `ResponsiveContainer` measures its parent, which is
> always zero, so nothing inside is drawn.
> **[`dayGraph.js`](../src/components/dayGraph.js) is the pattern to follow** — invariant 19
> taken to its conclusion rather than worked around: every decision about where a line goes
> lives in exported pure functions, and the component is a `map` over paths.
> `AnalysisTimeline`'s `buildTimelineData` and `LoveShape`'s `buildShapeData` are the same idea
> at a smaller scale. Hand-drawn SVG then makes even the drawing assertable, which is why
> `LoveShape.test.jsx` can check `stroke-dasharray` and a Recharts test cannot.

> **Assert both sides of every boundary** — 90 minutes is confident and 95 is not.

### Patterns to copy

**Module-level axios mock:**

```js
vi.mock('axios');
axios.post.mockResolvedValueOnce({ data: { message: 'User created' } });
axios.post.mockRejectedValueOnce({ response: { data: { error: 'Invalid credentials' } } });
```

**Controlled-promise trick for asserting a loading state** — hold the request pending so the
intermediate UI can be observed ([`Auth.test.jsx:48-86`](../src/components/Auth.test.jsx#L48-L86)):

```js
let resolveMock;
axios.post.mockReturnValueOnce(new Promise(r => { resolveMock = r; }));
userEvent.click(submitButton);                 // intentionally NOT awaited
await waitFor(() => {
    expect(submitButton).toBeDisabled();
    expect(submitButton).toHaveTextContent('Please wait...');
});
resolveMock({ data: { token: mockToken, refresh_token: 'refresh-abc', expires_in: 86400 } });
await waitFor(() => expect(mockOnLogin).toHaveBeenCalledWith(mockToken));
```

**Queries are placeholder- and role-based**, never CSS selectors. The placeholders
`name@example.com` and `••••••••` are load-bearing selectors in both this suite and the E2E
spec. `beforeEach(() => vi.clearAllMocks())` is standard.

---

## 2. Backend tests

`cd backend && go test ./...`. Tests are in-package (`package handlers`, `package database`), so
they can reach unexported identifiers and reassign `database.DB`.

**Which style, and why.** sqlmock where the *statement shape* is the subject; real in-memory
SQLite where the *resulting rows* are. Rename, merge, the journal write path and the vault are
claims about data, so asserting on the SQL that produced them would only restate the handler.

| File | Covers, and the traps in it |
| :--- | :-------------------------- |
| `database/database_test.go` | Real SQLite, real `AutoMigrate`. User constraints; the `serializer:json` round-trip on `Stats`, `Tags` and the nested `GuideAnswers`; `*time.Time` survival; soft delete both ways. **`TestAutoMigrateAddsNewColumns`** drops every column in `additiveColumns` and re-migrates — **add any future additive column to that list**. **`TestUpgradeFromPreRelationshipSchema`** builds a genuinely pre-Phase-4 schema *from a struct* (GORM's SQLite migrator only parses DDL it produced itself) and runs the real backfill. `relationship_id` is **not** in `additiveColumns` because SQLite refuses to drop a column a foreign key references. Use `t.TempDir()` plus an explicit `sqlDB.Close()` in `t.Cleanup` for any file-backed test — Windows cannot delete a SQLite file whose handle is open |
| `database/backfill_test.go` | Trimmed-name grouping per user, idempotence (a second pass reports `0, 0` — the property that makes running it on every boot safe), soft-deleted snapshots included, existing relationships reused, empty database. Each test gets its **own** DSN; the package's older `setupMemoryDB` shares one `file::memory:?cache=shared` and would let one backfill test see another's rows |
| `handlers/subjects_test.go` | sqlmock at the driver, **Postgres** dialect so the tests describe production SQL. Expectations are literal SQL under `regexp.QuoteMeta`, GORM's exact column order included — brittle by design, but they verify the real emitted SQL. `mock.ExpectationsWereMet()` in every subtest, so *unfired* expectations fail too. Auth is faked with an inline middleware, which is why every `!exists → 401` branch is reachable. Cases: create/update/get/delete with the whole validation matrix; **`TestUpdateSubjectPartialMerge`** is the description-wipe regression guard; **`TestUpdateSubjectExplicitClear`** pins absent ≠ empty. Every write path runs find-or-create first — call `expectFindOrCreateRelationship(mock, found)` rather than hand-writing the pair. Validation subtests assert on the **error string** as well as the status |
| `handlers/relationships_test.go` | Real SQLite. Counts and latest dates per stack; rename (every snapshot carries it; a 409 rolls back; renaming to its own name succeeds); merge (snapshots move, source soft-deleted, mentions move **including ones on soft-deleted entries**, `mentions_moved` reported); delete detaches mentions while the entries **survive** with their labels; cross-user 404s and unauthenticated 401s. **`TestMentionCountsCoverOnlyTheEntriesTheJournalShows`** pins `snapshot_count` at **2 rather than 6** for two snapshots joined against three mentions — the fan-out that made the journal's arrival a silent regression in a number every screen reads. **`TestAggregateTimeScan`** covers the four shapes `MAX(date)` arrives as: `MAX()` drops a column's declared type, so SQLite returns a **string** where Postgres returns a `time.Time`, and GORM refuses to scan into a field implementing only half of `Valuer`/`Scanner` — which is why `aggregateTime` carries an otherwise-unused `Value()` |
| `handlers/journal_test.go` | Real SQLite; two cases use sqlmock where the statement shape is the subject. **Every failure case asserts `countEntries(db)` as well as the status: a `400` that left a row behind is a worse bug than a `500`.** The write path table covers a valid check-in/ritual/fact, a new trigger created in the same transaction, an existing trigger by id, another user's trigger (404), an `about` naming an unlisted trigger (400), unknown ids, a `day` three days from `at`, a mention with neither id nor name, a duplicate `client_id` (**200 with the stored row**), `supersedes_id` stamping `superseded_at` and a second supersede answering 409, and a rollback on database error. **`TestCreateJournalEntryRejectsASupersededTrigger`** pins that a merged-away trigger is refused through **both** shapes — `{"label", "client_id"}` went down find-or-create, matched on `(user_id, client_id)` alone and quietly accepted it until 2026-08-22. **`TestDeleteJournalPersonCountsOnlyTheEntriesTheJournalShows`** pins that the reported counts cover what the journal displays while the action still covers superseded rows |
| `handlers/vault_test.go` | Real SQLite. Export shape (and, **on the raw response bytes**, that no form of `password` or a bcrypt prefix appears); export→import→re-export identity; re-import as a no-op; dry-run writing nothing *and* the real run doing exactly what the preview promised; seven bad files each 400 with nothing written; merging into existing stacks; local cadence winning; `GetMeta` counts and null spans; the whole journal block round-tripping with `supersedes_id` remapped and **no row id anywhere**; a version-1 file still importing; a version-1 file carrying a journal refused by name |
| `handlers/upload_test.go` | Multipart built by hand — `createMultipartPayload` cannot use `writer.CreateFormFile` for the negative cases because it hardcodes `application/octet-stream`. **The cleanup glob never matches**: it removes `uploads/profile_test_*.jpg` while the handler names files `profile_<UnixNano><ext>`, so every run leaves real files behind (four are committed). Fix: glob `uploads/profile_*`, and make the upload directory configurable so tests can use `t.TempDir()` |
| `auth/auth_test.go` | `LoadSecret` both ways, a token round-trip with its 24-hour expiry, a wrong-secret token, an expired one, **forged claims**, and bcrypt both ways. This package was untestable until `LoadSecret` re-read the variable — `t.Setenv` + `LoadSecret()` is the pattern. **Do not test tampering by flipping the last character of the signature**: it is base64url, the final character can carry padding bits, and the flip can decode to the same bytes |
| `handlers/session_test.go` | Nine tests on real SQLite: the refresh token stored only as a hash; rotation retiring the token it consumed; a replayed token revoking every token the user holds; expired, unknown and deleted-account tokens; logout; the expired-row sweep. `setupSQLiteDB` migrates from `database.Models()` rather than a hand-written list, so a table cannot exist in the server and be missing from the tests |

**Untested backend surface:** `Signup`, `GetUserProfile`, `UpdateUserProfile`. `Login` is covered
indirectly by `session_test.go`, which drives it for real — bcrypt cost 14 included, which is
most of the suite's ten seconds.

Model-level tests deliberately use nonsense stats keys (`{"love":50}`): the seven-id allowlist is
a *handler* rule, not a database constraint.

---

## 3. End-to-end tests

### 3.1 The real journey

[`tests/e2e/user_journey.spec.ts`](../tests/e2e/user_journey.spec.ts) — one test, three
`test.step`s against a live stack: register a unique `e2e_${Date.now()}@example.com` and log in;
create a subject (asserting *Analyze & Save* starts disabled, enables on a name, and that
dragging the first range input to `85` then submitting produces a card); then upload an avatar,
registering the `waitForResponse` interceptor for `/api/upload` **before** setting the file.

The dummy file is `Buffer.from('fake image data')` with a `.jpg` name — it passes only because
upload validation trusts the client-declared MIME type
([API §5](04-api-reference.md#7-upload-endpoints)). **Adding real image validation will break this
test**; the fix is to commit a genuine tiny JPEG fixture. The dynamic email exists because the
test database is persistent and the spec never cleans up after itself.

### 3.2 Why it currently fails

Structural, not a flaky assertion:

- **`baseURL` is commented out** and the spec hardcodes `http://localhost:5173`.
- **`webServer` is commented out** in [`playwright.config.ts`](../playwright.config.ts#L74-L78),
  so Playwright starts nothing.
- CI runs `npx playwright test` with no frontend, no backend and no database.
- `tests/example.spec.ts` is the untouched scaffold that navigates to `https://playwright.dev/`
  — it tests the framework's own website, needs outbound internet, and should be deleted.

Config otherwise: `testDir: './tests'`, `fullyParallel: true`, `forbidOnly` and 2 retries on CI,
single worker on CI, `reporter: 'html'`, `trace: 'on-first-retry'`, three browser projects —
while `make test-e2e` narrows to chromium.

### 3.3 Making E2E actually pass

Let Playwright own the servers:

```ts
// playwright.config.ts
use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
webServer: [
  { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
  { command: 'go run ./cmd/server', cwd: 'backend', url: 'http://localhost:8080/api/subjects',
    reuseExistingServer: !process.env.CI },
],
```

Then change `page.goto('http://localhost:5173/')` to `page.goto('/')` and the URL assertions to
relative paths. Two further steps for CI: add a `setup-go` step to
[`playwright.yml`](../.github/workflows/playwright.yml) (it sets up Node only), and delete
`tests/example.spec.ts`. A health endpoint would help — the backend has none, so `webServer.url`
has to poll an authenticated route that answers 401, which Playwright accepts as "up".

---

## 4. CI

[`playwright.yml`](../.github/workflows/playwright.yml) is the only workflow that runs unasked.
On push/PR to `main` or `master`: checkout → Node `lts/*` → `npm ci` →
`npx playwright install --with-deps` → `npx playwright test` → upload `playwright-report/` for
30 days, 60-minute timeout.

Two others are triggered deliberately ([Deployment §7](09-deployment.md#7-ci)):
[`android-release.yml`](../.github/workflows/android-release.yml) on a `v*` tag or manual
dispatch, and [`deploy.yml`](../.github/workflows/deploy.yml) on manual dispatch only.
**`android-release.yml` is the one place `vitest` runs in CI** — it gates the APK on `npm test`
and `npx vite build`.

**Not run by any workflow on push:** `vitest`, `go test`, `eslint`, `go vet`, and any Docker
build. (`eslint` would fail anyway — see
[Known Issues](11-known-issues.md#npm-run-lint-is-broken-in-this-checkout).) Given that the only
suite CI runs cannot pass in that environment, the pipeline is red-by-construction. The
highest-value change is to add the two suites that *do* pass:

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
- Query by role, label, placeholder or text — never by class or DOM structure.
- `vi.mock('axios')` at module scope; `vi.clearAllMocks()` in `beforeEach`.
- Assert the axios call *payload*, not just that it was called.
- Use `userEvent` over `fireEvent`; hold a promise open to assert intermediate states.

**Backend**
- In-package tests (`package handlers`), file named `<subject>_test.go`.
- Table-driven with a `name` field and `t.Run(tt.name, …)`.
- Substitute persistence by assigning `database.DB`.
- sqlmock for statement shape, real in-memory SQLite for persistence semantics.
- Always assert `mock.ExpectationsWereMet()`.
- Silence GORM's logger (`logger.Silent`); prefer `t.TempDir()` for anything on the filesystem.

**E2E**
- One `test` per journey, split into `test.step`s.
- Unique data per run; register `waitForResponse` *before* the action that triggers it.
- Create fixtures in `beforeAll`, remove them in `afterAll`.

---

## 6. The model gate — a fourth layer, deliberately not in `npm test`

§5.7 of the phase-6 spec makes "this model is good enough" a testable claim rather than a hope.
The layer that does it is **out of band**: it needs weights and minutes.

```bash
make journal-eval CANDIDATE=reference   # ~2 s, no weights: checks the harness itself
make journal-eval                       # the tier defaults; needs a binary and a model
make journal-audio-check                # which of the 240 golden recordings exist
```

The harness is [`scripts/journal-eval/`](../scripts/journal-eval/README.md) and it writes its
report into `product_vision/eval/`. **A model does not become a tier default until its numbers
are in a checked-in report there** — that rule, not a code path, is the gate.

### What *is* in `npm test`, and why the split is where it is

| In `npm test` | Out of `npm test` |
| :------------ | :---------------- |
| The 120 golden references against the real `validateProposal` | Any model answering anything |
| The word error rate and its normaliser (`wer.test.mjs`) | Computing a WER over a real clip |
| The scoring and the aggregates (`score.test.mjs`) | Running a candidate |
| The four gate criteria (`gate.test.mjs`) | Applying them to a model |
| CLI argument templating and the WAV header reader (`runners.test.mjs`) | Spawning a binary; reading a clip |
| That `transcripts.json` and `recordings.json` agree about the suite | — |

The line is not "cheap versus expensive", it is **"would being wrong here be loud?"** A broken
runner fails immediately and visibly. A word error rate quietly 10 % out, or a gate threshold
compared with `>` where it should be `>=`, produces a plausible number in a document a later
session treats as evidence — and nothing ever fails. So the arithmetic is in the fast suite
(65 tests, ~40 ms) and the model is not.

`score.test.mjs` also runs all 120 golden references through the **harness's** reading of an
expectation, which `validate.test.js` runs through its own. Holding the two together is the
point: otherwise a model could be graded by one standard and the suite's own answers by another,
and the gate would be measuring the drift.

### Three things the harness cannot tell you

- **Peak memory is sampled**, every 100 ms from the child process, so it is a floor and not a
  peak. §12.1's actual question — peak with the audio encoder loaded, on the oldest supported
  phone — is a QA-checklist measurement.
- **Latency is whole-process wall clock**, which on a CLI includes loading gigabytes of weights.
  The in-app figure, with the model already resident, is a different number.
- **The web tier is stood in for.** transformers.js over WebGPU has no CLI; the `full-web`
  candidate runs the same upstream weights through llama.cpp instead. A pass there is evidence
  about the model, not about the runtime a browser uses.

### Adding to the golden suite

Both halves of a pair, then `npm test`, then a row in `recordings.json`, then
`node product_vision/eval/build-recording-scripts.mjs`. The full list is in
[`src/journal/inference/golden/README.md`](../src/journal/inference/golden/README.md), and the
suite's own tests will tell you if you skip one.
