# 10 — Agent Guide

Operational guidance for a coding agent working in this repository: the invariants that
must not be broken, the traps that produce silent failures, and step-by-step recipes for
the changes most likely to be requested.

---

## 1. Orientation in sixty seconds

```
React 19 SPA (src/)  ──HTTP /api──►  Go + Gin (backend/)  ──GORM──►  Postgres or SQLite
```

- Five domain records exist: `User`, `Relationship`, `AnalysisSubject`, and — since Phase 6 —
  `JournalEntry` and `JournalMention`, plus `RefreshToken` for sessions. That is the entire
  schema ([`models.go`](../backend/internal/models/models.go)). The two journal tables sit
  *beside* the love snapshots rather than inside them: a check-in has no `stats`, is not a
  version of anything, and never appears in a stack. What joins the two layers is
  `Relationship`.
- **`JWT_SECRET` must be set or the server exits.** `go run ./cmd/server` without it now
  fails by design.
- A "person" is a `Relationship`; a "snapshot" is an `AnalysisSubject` pointing at one. The
  stack you see on the dashboard is a relationship and its snapshots, grouped **by
  `relationship_id`**. The `name` on each snapshot is a denormalized label, not the key.
- Every write resolves the relationship from the trimmed name (**find-or-create**), so a
  client that only sends `{name, stats}` still works.
- The seven love categories exist **only** in the frontend `CATEGORIES` constant. The
  backend stores an untyped `map[string]int`.
- Auth is a 24-hour JWT access token in `localStorage` (`auth.AccessTokenTTL`) **plus a
  rotating refresh token** held server-side as a hashed `RefreshToken` row
  (`auth.RefreshTokenTTL`, 60 days), so the *request path* is stateless and the *session* is
  not. The middleware puts `userID` in the Gin context and every query filters on it.
- No service layer, no state library, no migration files.

Read [Concepts](01-concepts.md) before touching domain copy, and
[Architecture](02-architecture.md) before touching data flow.

---

## 2. Hard invariants

Breaking any of these produces a silent or confusing failure rather than a clean error.

| # | Invariant | Why |
| :- | :-------- | :-- |
| 1 | **The primary key is `person.ID`, uppercase.** | `gorm.Model` has no JSON tags. `person.id` is `undefined`; the request goes to `/api/subjects/undefined`. [Details](03-data-model.md#2-gormmodel-and-the-id-casing-trap) |
| 2 | **Never write the axios auth header from an effect.** `applyToken` in [`auth/session.js`](../src/auth/session.js) is called synchronously at import and from `saveSession`. | Child effects run before parent effects, so the first fetch after login would go out unauthenticated and 401 — looking exactly like "login is broken". [Details](06-frontend.md#applytoken--the-header-is-never-written-from-an-effect) |
| 2f | **Never refresh a session twice at once.** Every caller goes through `refreshSession()`, which shares one in-flight promise. | Refresh tokens rotate, so a second spend of the same token is read by the server as a replay: it revokes the whole family and signs the user out. The dashboard fetches two endpoints in parallel, so this is the normal case, not an edge one. [Details](06-frontend.md#2a-authsessionjs--why-an-expired-token-is-no-longer-an-event) |
| 2g | **One owner per touch axis, declared with `touch-action`.** Vertical is the page's; a control may claim horizontal, or claim everything only if it is small enough to land on deliberately (the vault dial). | Two gestures competing for one axis cannot be fixed with a better threshold — the result is an app that does something different depending on where a finger happened to land. [Details](12-android-app.md#33-inputs-and-touch) |
| 2a | **Group stacks by `relationship_id`, never by `name`.** | Two relationships may legitimately share a display name now. Name-grouping would silently merge two different people — the exact bug the entity exists to fix. |
| 2b | **The write path and the backfill must resolve names the same way.** Both go through `database.FindOrCreateRelationship`. | Two different rules for "which relationship is this name?" split a stack in half, and the halves cannot be told apart afterwards. |
| 2c | **The cadence nudge never guilt-trips.** No streaks, no badges, no counts of missed check-ins, no red, no urgency vocabulary. | It is a product rule, not a style preference — a missed month must not read as a failure. `nudgeSentence` is tested against a forbidden-word list; keep it that way. |
| 2d | **Reminders are computed on the device, never scheduled on the server.** | "Nothing leaves this machine" is a claim the Vault page makes in writing. A server-side scheduler or an email digest would make it false. There are **two** channels since 6-F — the check-in cadence and the journal's nightly ritual — and both are decided in JavaScript and handed to the OS through `LocalNotifications` on the phone; the body of each is a fixed, content-free string bound by invariant 2c. A third channel is allowed and a server-side one is not. See trap 20 for the way the two channels collide over `getPending()`. |
| 2e | **Every claim on the Vault page must be true of the code as written — and since Phase 6, true of *this device* as well as of the build.** | It says every request goes to this app's own origin, and that the database is not encrypted. It no longer says *"there are no AI features"*: three models can run, all on the device, all off by default, and the page therefore has **two paragraphs that are chosen at render time** from the same `localStorage` keys the settings screen writes — `voiceIsOn()` and `embeddingsAreOn()` in [`Vault.jsx`](../src/components/Vault.jsx), each of which asks the *device* (the tier, and whether an index could exist here) as well as the key, so a `true` written by a better browser on the same profile cannot make this page describe a model that is not running. Two further consequences of the same rule: the *voice on* paragraph has a **third** variant because the Light tier is genuinely two models and *"one model"* would be false on it, and the outbox sentence renders **only on the phone**, because that is the only place the queue exists. `Vault.test.jsx` asserts all of them **verbatim**, in both opt-in states and on every tier, and a paraphrase is exactly what those tests exist to refuse. If you add a network call, a background service, a fourth model, or a fourth tier, that page is the first thing to fix — and the test will tell you which sentence. |
| 3 | **Category `id`s are permanent, and now live in two languages — and they are no longer the only vocabulary that does.** | They are the stored `stats` keys, the `uncertain` entries, the `guide_answers` outer keys, *and* the server's validation allowlist ([`domain.CategoryIDs`](../backend/internal/domain/categories.go)). Renaming one orphans every historical value and starts 400-ing the new one. **Feeling ids and ritual-question ids are the third and fourth permanent id vocabulary** ([`domain.FeelingIDs` and `domain.RitualQuestionIDs`](../backend/internal/domain/journal.go), mirrored by `FEELINGS` and `RITUAL_QUESTIONS` in [`src/constants/journal.js`](../src/constants/journal.js)), with `domain.JournalKinds` and `domain.TriggerRoles` under the same rule. The Go side holds **ids only** — labels, glosses, colours and the three coordinates are the frontend's, exactly as `domain/categories.go` splits them; the parity between the two languages is asserted by a test that reads `domain/journal.go` from disk (`journal.test.js`). Adding one is two edits in two languages and no schema change — thirty feelings today, the last nine **appended** by the EmotionGuesser integration, never inserted, because list order is the tie-break `topFeelings`, `dominantFeeling` and the day graph read; **removing one is forbidden** — retire it with `retired: true` in the frontend constant, so the UI stops offering it while the server keeps accepting it for the rows already written and for an import of them. |
| 3a | **A feeling's coordinates are fixed lookups. Do not retune one once data exists.** | `valence`, `energy` and (since the EmotionGuesser integration) `dominance` on each `FEELINGS` entry are what the day graph and every Insights drawing position a check-in by. They are never stored — a row holds the id — so changing one silently moves every entry ever written. The same rule the EmotionGuesser stated for its VAD centroids. |
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
| 14 | **Absent ≠ zero, and absent ≠ false** — in `stats`, and now in every journal payload. | A missing `stats` key means the category was skipped. Read it with a presence check (`isScored`), never `stats[id] \|\| 0`. The journal extends the rule to booleans and to whole keys: a skipped ritual question is **absent from `answers`**, never `false`; a check-in with no strength in it omits `intensity` rather than writing a middle number; `uncertain` is written only when it is `true`. The Go validators mirror this with pointer fields (`Intensity *int`, `Uncertain *bool`), so nil and zero stay distinguishable — see trap 13. |
| 15 | **The user authors every number.** | The guided-scoring band is a suggestion drawn on the track; only an explicit "Use N" click moves the slider. No code path may write a score the user did not confirm. **The proposal card (6-D) is the same rule made visible**: a model's proposal is a dashed chip, the save body is built from the card's *confirmed* state by `confirmedPicked` ([Frontend §2ea](06-frontend.md)), and the model's output travels beside it as provenance the server never reads as input — it validates ids, not opinions. |
| 16 | **Guide answers store the scale *index* (0-3), not its value (0/35/70/100).** | The band arithmetic maps index → value through `GUIDE_SCALE`. Confusing them yields a band that looks reasonable and is wrong. |
| 17 | **The subject list lives in `SubjectsContext`.** | Fetching it again in a screen re-introduces the stale-copy bug the context exists to kill. Use `useSubjects()`. `JournalContext` is the second context, not a second store: it holds journal entries and **reads** the people from `useSubjects()`, which is why it is mounted inside `SubjectsProvider`. |
| 18 | **Radar axis order is `CATEGORIES` order, always.** | A Love Shape is only recognisable if a given category sits at the same angle every time. Do not sort the shape data. |
| 19 | **Recharts renders nothing under jsdom.** | Chart logic must live in exported pure functions; a test asserting on a *Recharts* chart's output proves nothing. **Hand-drawn SVG is the exception, and it is the reason to prefer it**: `DayGraph.jsx` is a `map` over [`dayGraph.js`](../src/components/dayGraph.js)'s geometry, and `DayGraph.test.jsx` counts its `<path>`s and reads its `stroke-dasharray` for real. The rule is unchanged — the decisions live in pure functions either way. |

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
6. **`GET /api/subjects` is ordered newest-first** (`date IS NULL, date DESC, id DESC`), but
   both consumers still sort client-side anyway — cards descending, timeline ascending.
   Do not remove those sorts on the strength of the server's order.
7. **`uncertain` must stay consistent with `stats`.** Change which categories are scored and
   you must send `uncertain` in the same request, or the server rejects the update.
8. **`npm run preview` has no API proxy** — `server.proxy` is dev-only. Use Docker to test
   a production build against the API.
9. **Run the backend from `backend/`.** `alexithymia.db` and `uploads/` are CWD-relative.
10. **`go test ./...` leaves files behind** in `backend/internal/handlers/uploads/` (the
    test's cleanup glob does not match the handler's naming scheme). Check `git status` —
    and note four such files are *tracked*, so delete only the untracked ones.
10a. **`MAX(date)` scans as a string on SQLite** and as a `time.Time` on Postgres, because
    the aggregate drops the column's declared type. `aggregateTime` in
    [`relationships.go`](../backend/internal/handlers/relationships.go) absorbs both. Any new
    aggregate over a time column needs the same treatment, and the failure only appears once
    real dated data exists.
10b. **SQLite cannot drop a column a foreign key references**, so `relationship_id` cannot
    be exercised by `database_test.go`'s drop-and-re-add trick. It has its own test.
10c. **Mock `axios.get` per URL in frontend tests.** The provider loads `/api/subjects` and
    `/api/relationships` together; one blanket `mockResolvedValue` feeds snapshots to both.
    Copy the `mockFetch` helper. `Vault` adds `/api/meta` to the list, and anything under
    `JournalProvider` adds `/api/journal/entries` and `/api/journal/days` — four URLs, so
    copy `Journal.test.jsx`'s version of the helper rather than the two-URL one.
10d. **`Dashboard` and `TimelineRoute` need `DiscretionProvider` as well as
    `SubjectsProvider`.** `useDiscretion()` throws without it; copy `renderDashboard`.
    `Journal` needs a third, `JournalProvider`, **inside** `SubjectsProvider` — it calls
    `useSubjects()` for the names, so the nesting is not interchangeable. Copy `renderAt`.
10e. **A JSON `null` is indistinguishable from an absent key through a pointer field**, at
    any pointer depth — `**int` does not help. `cadence_days` needs all three states, which is
    why `UpdateRelationship` decodes into `map[string]json.RawMessage` and reads presence from
    the keys. Any future nullable-and-optional field needs the same treatment.
10f. **A new column on `AnalysisSubject` that is not nullable needs a `default` tag.**
    Scanning NULL into a Go `string` fails outright, so a missing default breaks *every read*
    of every legacy row, not just the new field.
11. **Every screen calls through the global `axios`.** `Profile.jsx` used to hold its own
    instance and so sat outside the 401 auto-logout in `App.jsx`; it no longer does. Do not
    reintroduce a private instance — an interceptor on the global default never reaches one.
12. **Port 8080 is the backend in dev but the frontend under Docker.** They collide.
13. **A skipped ritual question is *absent*, and `question_set.asked` is the only thing that
    says it was shown.** `answers` holds answers, so `answers.alcohol === undefined` covers
    two different nights: one where the question was on screen and swiped past, and one where
    the user had never turned that optional question on. Only `asked` separates them, which is
    why it is recorded even though it looks derivable from today's settings — tomorrow's
    settings are not yesterday's. Anything that renders, exports, counts or graphs a ritual
    reads **both**: `asked.includes(id)` first, then `answers[id]`. Reading `answers` alone
    silently turns "never asked" into "answered no", which is the invariant-14 mistake wearing
    a different hat, and it is invisible in a test whose fixture happens to ask everything.
14. **A journal row's `client_id` is not the same key as its row `ID`, and the API takes
    different ones in different places.** `DELETE /api/journal/entries/:id` takes the **row
    id**; `supersedes_id` is a **row id**; everything inside a payload — `about.trigger`,
    `merged_into`, `corrects`, the `triggers[]` list — is a **`client_id`**. The two are both
    opaque and one is a UUID, so a mix-up returns a clean 404 rather than an error that
    explains itself. The rule behind it: ids that travel in an export are client ids, because
    row ids are not portable; ids that only ever address a row on this server are row ids.
15. **Two files in `src/components/` differ only in the case of one letter, and this
    filesystem does not.** `dayGraph.js` is the day graph's geometry; `DayGraph.jsx` is the
    component that draws it. Vite resolves `.js` before `.jsx`, so `import X from './DayGraph'`
    returns the **geometry** module — no default export, and an error reading
    `Element type is invalid: … got: undefined` that points at the JSX rather than at the
    import. It would resolve correctly on a Linux CI and wrongly on Windows and macOS.
    **Spell the extension out** in every import of either.
16. **A feeling's label appears twice on the day view** — once on the check-in's chip, once in
    the graph's legend — so `screen.getByText('connectedness')` throws *"Found multiple
    elements"*. Both are correct; the test has to say which it means.
    `Journal.test.jsx`'s `rows()` helper is the scoped-query pattern to copy.
17. **On Android, the permission prompt pauses the app.** The runtime-permission dialog is an
    activity of its own, so the first tap of the microphone fires Capacitor's `appStateChange`
    with `isActive: false` — the exact signal `watchLifecycle` treats as "throw the audio
    away". A recorder in `requesting` has captured nothing, and discarding it there cancels
    the request the user is in the middle of granting; `recorder.js` therefore leaves that one
    state alone on native platforms. Any new listener for "the app went to the background"
    that touches the journal has to make the same distinction, and a test that fakes
    `appStateChange` during `requesting` is how to know it does.
18. **A `tap()` on the recorder is ignored while the permission prompt is up.** The button
    contract dispatches on state and `requesting` is deliberately a no-op, so a test that
    "taps again to cancel" during the prompt asserts nothing; `stop()` is what cancels a
    pending request, and it is what the discard button and the lock call.
19. **A model's output is safe only after `propose`, and the transcript is the one slot the
    filter leaves alone.** `validateProposal` ([Frontend §4bm](06-frontend.md)) runs inside
    `propose` on everything a runtime returns, so a component that calls a runtime's own
    `propose` directly — or reads anything off a result but `proposal` and `provenance` —
    has stepped around the only thing standing between a model's `label` and a chip. The
    reverse mistake is as easy: the forbidden list is read over `label` and `text`, **never
    over `transcript`**, because that is the user's own sentence and a journal that censors
    *bad* out of it is not a record. A test asserts both directions in the same case; if
    you add a filter and the transcript case goes red, the filter is wrong, not the test.
20. **`LocalNotifications.getPending()` is the whole app's list, not your channel's.** There
    are two channels now — the check-in cadence and the journal's nightly ritual — and a
    cancel-then-reschedule written over the pending list unschedules the other one. The
    cadence sync used to, which would have quietly removed tonight's reminder on every
    dashboard visit and looked exactly like an OEM battery manager dropping alarms. Each
    channel owns its ids and cancels only those: `cadenceReminders.js` filters
    `RITUAL_NOTIFICATION_ID` out, and `ritualReminder.js` cancels by id rather than by
    listing. A third channel would have to do the same, and there is a test that crosses the
    two.
21. **A wrong embedding prompt prefix has no symptom at all.** EmbeddingGemma was trained with
    two mandatory prefixes — `task: search result | query: ` for a query and
    `title: none | text: ` for a stored entry, trailing spaces included — and a vector made
    without them, or with the wrong one, is a different point in a different space. It still
    has 256 numbers. It still scans, still ranks, still returns a plausible-looking answer, and
    is quietly worse at everything downstream. Nothing throws and nothing looks broken. So
    there is exactly one function that builds the string a model sees (`prefixed()` in
    `src/journal/embeddings/embed.js`), it throws on a `kind` it does not know rather than
    embedding without a prefix, and `embed.test.js` asserts both strings **character for
    character** — which is the only place the mistake can be caught. Anything that adds a
    caller goes through that function; anything that adds a kind adds a prefix beside it.
22. **An entry's searchable text is not its transcript, and `entries` is not the journal.**
    Two halves of the same trap, both from G2 and both silent.
    `journalDocument` joins the transcript with the *current* names of the people mentioned
    (through `personName`, which prefers the relationship's name over the label stored on the
    mention, so a rename is visible everywhere) and the *resolved* labels of the triggers the
    entry is filed under — each label once, however many feelings name it. So the string that
    gets embedded and searched is `"Lucie · Der Tag im Büro war lang. · Arbeit"`, not the
    sentence. A fixture keyed on the transcript alone silently gets an unrelated vector and the
    feature simply makes no offer; there is nothing to see in the failure.
    And `useJournal().entries` holds **the loaded range**, which the day view narrows to one
    month. An id that is not in it means *not loaded* far more often than *deleted*, so nothing
    may prune on its absence — `EmbeddingContext` drops a vector only when the vocabulary can
    say the id is dead. The version that pruned on absence re-embedded the whole journal every
    time the user walked to another month, and looked exactly like a slow device.
23. **A look-alike is an offer, never a link.** `triggerCandidates` and `personCandidates` return
    `match: 'similar'` rows (the EmotionGuesser's review band, `SIMILAR_FLOOR`) after the exact,
    insensitive and prefix ones, and every consumer — `resolveTriggerLabel`, `resolvePerson`, the
    two pickers — treats them as a question beside *new trigger* / *new person*, never as the
    resolution. A caller that takes `candidates[0]` as a hit without reading `match` links *Lucy*
    to *Lucie* silently, which is precisely the merge no metric is allowed to make. And a quote is
    the one model-authored slot that is *checked* rather than word-filtered: `validateProposal`
    drops a `quote` the transcript does not contain and never reads it against the forbidden
    list, because it is the user's own words. Reading it against the list would censor the
    user's speech; skipping the containment check would let the model put words in it.
24. **Insights is derived on read, from the whole record.** `JournalInsights` calls `loadAll()`
    the way the People and Triggers views do; an analytics pass over `entriesForDay` or a month
    is a drift chart of one month that looks exactly like a drift chart. Nothing it computes is
    stored, nothing reaches a request body, and a trigger's role is read through `resolveTrigger`
    (so a merged-away id lands on the survivor's role), never off the `about`.

---

## 4. Recipes

### Recipe 1: Add or change a love category

**Three places, two languages.** The prose is frontend-only, but the `id` is also the
server's validation allowlist — skip step 3 and every save carrying the new key 400s.

1. Append to `CATEGORIES` in
   [`src/constants/categories.js`](../src/constants/categories.js), matching the
   existing shape exactly: `id`, `label`, `description`, `color`, `hex`, `textColor`,
   `borderColor`, `extendedDescription`, `coreMotivation`, `metrics[{title, description}]`,
   `anchors[{min, max, phrases}]` — **five** phrasings per band, five or six bands covering
   0-100. Use **literal** Tailwind class strings. The anchor bands
   must start at 0, end at 100 and be contiguous — a unit test enforces it. `hex` must match
   `color`; it is what the SVG charts stroke with.
2. Add the `id` to `CategoryIDs` in
   [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go).
   Ids only — no labels, colours, or prose migrate to Go.
3. Optionally mirror the prose into
   [`TestImplementationDetails.txt`](../TestImplementationDetails.txt), the editorial
   source for this copy.
4. Verify: the slider list, the bar chart, the radar axes, the category grid and detail
   view, and the timeline legend all pick it up automatically — they iterate `CATEGORIES`.

Existing subjects simply have no key for the new id and render as 0%.

**To rename a category's `id`**, you must also migrate stored data — every existing
`stats` JSON blob carries the old key. Prefer changing only the `label`.

**To recolour**, change `color` and `hex` on the same object and keep them describing the
same colour — the bars, the lines and the radar vertices must agree.

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

### Recipe 4: Add a screen that reads subjects

The pattern `TimelineRoute` established, and the one to copy for any new screen over the
same data:

1. Register the route **inside** the `SubjectsProvider` in
   [`App.jsx`](../src/App.jsx), guarded on `token` like `/profile`.
2. Read data with `useSubjects()` — never fetch `GET /api/subjects` again. Handle all three
   states it exposes: `loading` (someone may have landed here directly), `loadError`, and
   the empty case.
3. Link to it through an exported path builder that encodes its params, the way
   `timelinePath` does. Read params back with `useParams` and **do not** decode again.
4. Back is `navigate(-1)`, falling back to `/` when `location.key === 'default'`.
5. Test it through `MemoryRouter` + `SubjectsProvider` with `axios` mocked.

### Recipe 5: Surface an error on a new screen

`Dashboard` and `Profile` already do this; copy whichever is closer.

- **Local**: a `notice`/`message` state of `{type: 'success'|'error', text}` rendered as a
  dismissible `role="alert"` banner — emerald for success, red for error. `Dashboard`'s
  `errorText(error, fallback)` helper prefers the server's own message
  (`error.response.data.error`) and falls back to a written sentence that says what to do.
- **Global 401 handling** is already installed by [`auth/session.js`](../src/auth/session.js)
  **at module scope**, on import — not from an effect, and this is load-bearing. Child effects
  commit before their parent's, so registering it in `App`'s `useEffect` let
  `SubjectsProvider`'s fetch go out first: on a cold load with an aged token those requests
  401'd with no interceptor to catch them and were never renewed or replayed. There are two
  interceptors — a request one that renews *before* sending a doomed request, and the response
  one that renews and replays after a 401. Only a dead refresh token surfaces anything, and
  what it surfaces is a signed-out app, not a dialog. Both cover the global axios, which every
  screen uses — a private `axios.create()` would opt out of both.
  If a request must *not* be retried this way (a sign-in, where a 401 is a wrong passphrase),
  mark its config `__isSessionCall: true`.
- **Do not close a modal on failure.** Keep the close call inside `try`, after the awaits,
  so failed input survives for a retry.

### Recipe 6: Unify the axios setup

**Half done.** `Profile.jsx`'s private instance is gone — every screen now calls the global
`axios` and is covered by the 401 interceptor.

What remains is the other half: replace the module-scope header assignment in `App.jsx`
with a single request interceptor that reads `localStorage` per request. That would remove
the load-bearing ordering hazard of invariant 2 entirely — today the header must be written
synchronously at import time, and an effect would be too late.

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

[`journal.go`](../backend/internal/handlers/journal.go) is the same pattern at scale, and it
is the one to copy from now: `validateClientID`, `parseDayString`, `validateDay`,
`validateMentions`, `validateTriggerRefs` and one `validate<Kind>Payload` per entry kind, all
above the handler, all returning a message that names the field. Two things it adds worth
carrying forward. It normalizes **in place** — `validateTriggerPayload` writes the trimmed
label back into the payload map before the row is stored, so the value checked is the value
written. And it splits a rule that needs a database from the rule that does not: the same
check on `merged_into` is a pure function for "is this well-formed and not self-referential"
and a query inside the transaction for "is this trigger still the caller's", so the cheap half
rejects before a transaction is opened and the expensive half cannot race.

### Recipe 9: Add a journal entry kind

A new `kind` is how the journal extends. It brings its own payload shape and needs **no schema
change** — the row is `kind` plus an opaque `payload`, and a payload that lacks a key already
means "not present" ([Data Model §journal](03-data-model.md#journalentry)).

1. **The id** — add it to `JournalKinds` in
   [`domain/journal.go`](../backend/internal/domain/journal.go). Never remove one: a kind that
   stops validating orphans every row that used it, and an import of those rows too.
2. **The payload struct and its validator** — in
   [`handlers/journal.go`](../backend/internal/handlers/journal.go), beside
   `checkinPayload`/`validateCheckinPayload`. Name only the keys the server checks; everything
   else in the map travels through untouched, which is what lets a newer client write a field
   this server has never heard of. Use pointer fields for anything where absent and zero
   differ (invariant 14).
3. **The dispatch** — one `case` in `validateJournalPayload`.
4. **The reader** — a `read<Kind>` in [`src/constants/journal.js`](../src/constants/journal.js)
   beside `readCheckin`/`readRitual`/`readTrigger`, returning `null` for absent rather than a
   default, and tolerant of unknown keys.
5. **The copy** — every string it puts on screen goes in `JOURNAL_COPY`, or the forbidden-word
   walk in `journal.test.js` cannot see it.
6. **Does it put something on a day?** If yes, add it to `DAY_KINDS` in
   [`JournalContext.jsx`](../src/context/JournalContext.jsx) and to the counted kinds in
   `GetJournalDays`; if it is vocabulary rather than an event — the way `trigger` is — do
   neither, or it will mark days in the month strip that have nothing on them.
7. **Export** — nothing to do. The export walks entries of every kind, so a new one is carried
   and re-imported for free; that is the point of the shape.

---

## 5. Before you finish

```bash
npm test                        # vitest run — must stay all-pass (1571 tests)
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
- Did you add a category? `CATEGORIES` (with `hex` and `anchors`) **and**
  `domain.CategoryIDs`.
- Did you add a screen? Inside `SubjectsProvider`, reading through `useSubjects()`.
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
| The seven categories, all copy, colours and anchors | `CATEGORIES`, [`constants/categories.js`](../src/constants/categories.js) |
| The seven ids, server-side | `CategoryIDs`, [`domain/categories.go`](../backend/internal/domain/categories.go) |
| Chart colours | the `hex` field on each `CATEGORIES` entry (`CATEGORY_COLORS` is gone) |
| Guided-scoring scale and band maths | `GUIDE_SCALE` / `guideBand`, [`constants/categories.js`](../src/constants/categories.js) |
| Card summary arithmetic | `summarizeStack`, [`constants/categories.js`](../src/constants/categories.js) |
| Preset context tags | `CONTEXT_TAGS`, [`ContextCapsule.jsx`](../src/components/ContextCapsule.jsx) |
| Delta arithmetic and elapsed phrasing | [`WhatChanged.jsx`](../src/components/WhatChanged.jsx) |
| The shared subject list and its mutations | [`context/SubjectsContext.jsx`](../src/context/SubjectsContext.jsx) |
| Timeline shaping, markers, time axis | `buildTimelineData`, [`AnalysisTimeline.jsx`](../src/components/AnalysisTimeline.jsx) |
| The radar polygon | [`LoveShape.jsx`](../src/components/LoveShape.jsx) |
| Timeline URL builder | `timelinePath`, [`TimelineRoute.jsx`](../src/components/TimelineRoute.jsx) |
| Database schema | [`models.go`](../backend/internal/models/models.go) |
| Route table | [`main.go:17-35`](../backend/cmd/server/main.go#L17-L35) |
| Request validation helpers | `validateStats` / `validateTags` / `parseSubjectDate`, [`subjects.go`](../backend/internal/handlers/subjects.go) |
| Auth rules (cost, TTL, claims) | [`auth.go`](../backend/internal/auth/auth.go) |
| Token → `userID` in context | [`middleware.go`](../backend/internal/handlers/middleware.go) |
| Session storage, renewal, both interceptors | [`auth/session.js`](../src/auth/session.js) |
| Driver choice + migrations | [`database.go`](../backend/internal/database/database.go) |
| Grouping snapshots into stacks | `groupPeople` / `buildStacks`, [`SubjectsContext.jsx`](../src/context/SubjectsContext.jsx) |
| Whether a relationship is due for a check-in | `dueStacks`, [`constants/cadence.js`](../src/constants/cadence.js) |
| The export document's shape | `ExportDocument` and friends, [`vault.go`](../backend/internal/handlers/vault.go) |
| What counts as a duplicate on import | `isDuplicateSnapshot`, [`vault.go`](../backend/internal/handlers/vault.go) |
| Name masking and the blur class | [`DiscretionContext.jsx`](../src/context/DiscretionContext.jsx) |
| The feeling vocabulary's three axes and families | `FEELINGS`, `FEELING_FAMILIES`, `feelingCoordinates`, [`constants/journal.js`](../src/constants/journal.js) |
| A trigger's two halves, and the quote cap | `TRIGGER_ROLES`, `MAX_QUOTE_LENGTH`, [`constants/journal.js`](../src/constants/journal.js); `domain.TriggerRoles`, [`domain/journal.go`](../backend/internal/domain/journal.go) |
| Look-alike matching (the review band) | `labelSimilarity`, `SIMILAR_FLOOR`, `triggerCandidates`, `personCandidates`, [`constants/journal.js`](../src/constants/journal.js) |
| The observation table and its three groupings | `observationsOf`, `atLevel`, `seriesOf`, [`journal/analytics/observations.js`](../src/journal/analytics/observations.js) |
| Drift arithmetic (EWMA, slope, distance, weekly mood, heatmap, families) | [`journal/analytics/drift.js`](../src/journal/analytics/drift.js) |
| The Insights drawings' geometry | [`journal/analytics/charts.js`](../src/journal/analytics/charts.js) |
| The Insights screen | [`JournalInsights.jsx`](../src/components/JournalInsights.jsx), `INSIGHTS_PATH` |
| The model prompt, its version and its two examples | `buildPrompt`, `PROMPT_VERSION`, [`journal/inference/prompt.js`](../src/journal/inference/prompt.js) |
| Resolving a name to a relationship | `FindOrCreateRelationship`, [`backfill.go`](../backend/internal/database/backfill.go) |
| Rename / merge / delete a whole stack | [`relationships.go`](../backend/internal/handlers/relationships.go) + [`RelationshipDialogs.jsx`](../src/components/RelationshipDialogs.jsx) |
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
collections; sub-components declared in the same file when only used there; two contexts for the
shared subject list and the journal, props for everything else; async handlers wrapped in
`try/catch`.

**Styling** — Tailwind utilities only, no custom CSS, unextended theme; `slate` neutrals,
`rose` accent, `rounded-2xl` surfaces, `font-light` headings; lucide icons sized via `size`.

**Naming** — Go: `PascalCase` exported / `camelCase` local. JS: `PascalCase` components,
`camelCase` values, `SCREAMING_SNAKE` module constants. API JSON: `snake_case` for declared
fields, `PascalCase` for the four `gorm.Model` fields. Files: `PascalCase.jsx` for
components, `lowercase.go` for Go.
