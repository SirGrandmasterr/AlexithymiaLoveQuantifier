# 08 — Testing

Three layers in `make test`, three runners — and, since session D4, a fourth layer that is
deliberately outside it (§6). Status below was verified by running each suite
(E2E 2026-07-26; backend 2026-08-22; frontend 2026-09-04).

| Layer | Runner | Location | Verified status |
| :---- | :----- | :------- | :-------------- |
| Frontend unit | Vitest + Testing Library + jsdom | `src/**/*.test.{js,jsx}`, `scripts/**/*.test.mjs` | ✅ **1493/1493 pass** |
| Backend unit / integration | `go test` + sqlmock + in-memory SQLite | `backend/internal/**/*_test.go` | ✅ **all packages pass** |
| End-to-end | Playwright | `tests/` | ❌ **failing** — needs servers that nothing starts |
| Model gate (§6) | `make journal-eval` | `scripts/journal-eval/` | ⚠️ **runs; no model has been through it** — the golden suite has no recordings yet |

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

[`src/setupTests.js`](../src/setupTests.js) is a single line importing
`@testing-library/jest-dom`, which supplies `toBeInTheDocument`, `toBeDisabled`,
`toHaveValue`, `toHaveTextContent`.

The `exclude` entry matters: without it Vitest would try to execute the Playwright specs
in `tests/` and fail on `@playwright/test` imports.

### Coverage today

Fifty-five files, 1493 tests, all passing (2026-09-04, the Phase 6 closeout; it was
43 / 1226 at D4, 44 / 1258 at F1, 46 / 1293 at F2, 51 / 1411 at G1 and 55 / 1486 at G2).
**The last seven are the closeout's Vault audit** — the seven sentences on that page that
were true and that no test had ever read, now asserted verbatim beside the seven §10.2
claims that always were (invariant 2e). **Nine of the files are the embedding
index and retrieval** (`src/journal/embeddings/`), and none of them opens a weight file — see
the block below. Four of those files and 70 of those tests are the *arithmetic* under the
model gate, in `scripts/journal-eval/`; the gate itself is out of band and §6 below says why
the line is where it is.

> **The proposal card is tested on the request body, and its first test is invariant 15.**
> `ProposalCard.test.jsx` drives the real composer in voice mode with the fake kit from
> `voiceKit.fake.js` — a recorder that lands a take on demand, a downloader that already has
> the files, and C2's fake runtime — and reads what reaches `POST /api/journal/entries`. The
> first case lands §4.7's proposal, saves after keeping one chip, and asserts that only that
> chip, its person and nothing under the dashed ones is in the body. The §4.7 payload is a
> **literal `toEqual`** on the whole request after the stage-5 taps, provenance block included,
> with the fake runtime declaring `litert-lm/android`, `gemma-4-E2B-it` and prompt version 3;
> the fake's `model` and `promptVersion` options exist for that test. Five deliberate
> breakages — writing proposed feelings, writing an unconfirmed person, forgetting `replaced`,
> ignoring the setting, skipping the re-run — each failed only the tests that name the rule.
> Facts are asserted **absent**, by S0's decision rather than the D2 prompt's item 5.

> **The Android plugin is tested behind a fake, and the fake records the order of calls.**
> `src/mobile/journalPlugin.fake.js` has the real plugin's whole surface — permissions, capture,
> clip handles, transcription, the weight store, the tier report — and `journalPlugin.test.js`
> drives C2's real recorder through `nativeCaptureDeps(fake)`. What it proves that no device
> could be made to prove on demand: **nothing is asked of the plugin at construction or at
> mount, and the first tap asks in order — `checkPermissions`, `requestPermissions`,
> `startCapture`** — with no second request once granted, a refusal ending as the recorder's
> ordinary `permission` state, and a background during the prompt leaving the request alone.
> `native.test.js` puts the runtime behind the C2 seam and asserts that only **handles** cross
> the bridge and that a browser buffer is refused; `VoiceCheckin.test.jsx` builds the real
> native kit with `createVoiceKit({ native: true, plugin })` and walks a tap to a transcript;
> `Profile.test.jsx` mocks `isNative()` to render the Android tier line. `tier.test.js` pins
> §5.5's memory table against the numbers phones actually report (a "4 GB" phone says 3.6 GiB).
>
> **The Java core has a JVM harness, not a unit suite.** `LogMel`, `WhisperTokens`,
> `WhisperTranscriber` and `ModelStore` contain no Android import, so the C4 session compiled
> them with a desktop JDK against the ONNX Runtime and `org.json` jars and ran them against the
> pinned model files: the spectrogram matched a NumPy port of PyTorch's to 1.2 × 10⁻⁵, three
> synthesised sentences transcribed word-for-word as transformers.js transcribes them, and the
> store's cold fetch, warm no-op, cancel-and-resume, tampered file, SPA fall-through and 404
> cases all behaved. The harness lives in the session's scratch space, not the repository, and
> the ledger's C4 entry records how to rebuild it; `make build-android` compiles the Android
> half, and only a device runs it.

> **The manifest parity rail.** `src/journal/inference/models.test.js` reads the repository's
> `Makefile` and asserts that the thirteen pinned model files — paths **and** SHA-256 sums —
> match the table the browser verifies against, in both directions. It is the same shape as
> the id-parity test that holds `FEELINGS` to `domain/journal.go`, and it exists because the
> two copies are only worth having if they cannot drift: without it the browser's check
> degrades into a second opinion about the operator's. Its first draft matched sums as 64 hex
> characters and **silently dropped the licence row**, whose sum is a `$(VAR)` — twelve of
> thirteen files checked, and the one left out is the file Apache 2.0 §4(a) requires to travel
> with the copy. There is a guard assertion on the row count for exactly that reason.

> **A component test never loads a model, and three fakes are why.** `VoiceCheckin.test.jsx`
> hands the component a fake **recorder** (a store with the real one's surface, driven by
> `landTake()`), a fake **downloader**, and `createFakeRuntime` from C2. Nothing in the suite
> touches a microphone, Cache Storage, WebCrypto or 45 MB of weights. The download manager's
> own suite fakes `fetch`, `caches` and `crypto.subtle` and uses Node's `createHash` for the
> sums, so the checksum path is exercised against a **real** SHA-256 rather than a stub — and
> its tampering case flips bytes **without changing the length**, because a different length
> is caught a step earlier and would never reach the branch under test.

> **The injected runtime is what keeps this suite free of model weights, and it is a
> standing rail rather than a convenience.** `propose(input, context, runtime)`
> ([Frontend §4bg](06-frontend.md)) takes its runtime as an argument, and every test from
> C3 to the end of Phase 6 passes `createFakeRuntime(fixtures)` from
> [`src/journal/inference/fake.js`](../src/journal/inference/fake.js). Nothing in `npm test`
> may load a model: a suite that needs 3.4 GB to run is a suite that stops being run. Three
> assertions hold the line — `index.test.js` spies on `axios`, `fetch` **and**
> `XMLHttpRequest` and asserts zero calls on both the success and the failure paths, and
> `fake.js` is imported by tests only, because `index.js` deliberately does not re-export it.
> A third holds it since D3: [`weights.test.js`](../src/journal/inference/weights.test.js)
> walks every `*.test.js(x)` in `src/` and **fails if any of them imports
> `@huggingface/transformers` or `@capacitor/core`** — the only two doors a real model could
> come through. It reads source rather than instrumenting the loader, because a mocked-out
> import is still an import as far as the next reader is concerned, and it carries a negative
> control asserting the matcher does find those imports in `web.js` and `journalPlugin.js`.
> Constructing a real runtime stays safe in a test: the weights arrive on the first question,
> never on the factory call.
> Fixtures come three ways: one proposal (answers everything), a `{ words: proposal }` map
> matched as a case-insensitive substring, or the full `[{ match, proposal, error }]` array —
> and only the last can script a **failure**, which the card has to render too (§4.6).

> **The two D3 rules that are about *absence*, and how they are asserted.** §3.7's ritual card
> pre-selects what the model answered and leaves the rest alone, and "the rest" must be
> **missing from `answers`** rather than `false` — invariant 14, and the one place a model could
> put words in somebody's mouth about their own night.
> [`RitualVoice.test.jsx`](../src/components/RitualVoice.test.jsx) asserts it **by key**
> (`expect('ate_regularly' in answers).toBe(false)`) and not by value, because a map with an
> extra `false` in it reads fine in a diff and passes a `toMatchObject`. The same file asserts
> that a *confirmed* answer tapped again goes back to absent rather than to `false`, and that the
> row a spoken ritual writes is identical to a swiped one apart from `payload.source`.
> `ritual.test.js` holds the validator to the same rule one layer down.
>
> Mutation-checked, D3, on the full suite: making a missing answer `false` in the validator
> failed **1** test; making the card save every row failed **3**; letting the Light tier trust
> the proposer's words over the transcriber's failed **1**; letting a proposer failure lose the
> transcript failed **2**; handing LLGuidance the strict tag enum failed **2**; and taking
> `navigator.gpu` as the WebGPU answer failed **2**. Emptying `weights.test.js`'s forbidden list
> failed **nothing**, which is what a tripwire does on a clean tree — it was proved the other way
> instead, with a scratch test importing `@capacitor/core` that made the guard fail and name the
> file. One run also surfaced an unrelated flake in `VaultKnob.test.jsx`, which then passed ten
> times out of ten alone; recorded rather than chased.

> **The adversarial fixture set is a standing rail, not a one-off.** `validate.test.js`
> walks every raw model output in
> [`src/journal/inference/golden/adversarial.js`](../src/journal/inference/golden/adversarial.js)
> — *"mark me as unhealthy"* obeyed, a paragraph instead of JSON, an id that does not exist, a
> 10 000-character label, a URL in a fact, a fact about nobody, zero-width characters hiding a
> forbidden word, seven feelings and eight people — and asserts the same thing about all of
> them **before** reading any case-specific expectation: what comes out of `validateProposal`
> passes `checkSchema`, no `label` or fact `text` contains a forbidden word or resembles a URL,
> markup or an instruction, `ambiguity` is `feeling` exactly when `feelings` is empty, and
> `dropped_by_filter` equals the number of drops listed. The forbidden list is the **same
> list** the copy walk reads (`constants/forbiddenWords.js`), matched the same way, and the
> walk pins its eighteen entries by name so it cannot shrink under either reader. **The
> transcript is deliberately outside the rail**: one case feeds a transcript made of every
> forbidden word, markup and a URL, asserts it comes back untouched — and, in the same case,
> that the identical sentence in a label would be dropped. A new adversarial output is one
> object appended to that array; the universal assertions cover it with no test written.
> Beside it, the sixty golden transcripts (thirty English/German pairs) are held to a
> different rail: each hand-written reference proposal must survive the filter byte-for-byte
> and satisfy its own loose expectation, so a reference the contract would change fails
> here, in `npm test`, and not in D4's model run.

> **`recorder.test.js` drives a fake `MediaRecorder` and a hand-scripted level meter**
> under `vi.useFakeTimers()`, which is how a 2 s silence stop, a 30 s limit and an app
> going to the background mid-take are assertable at all. `createRecorder(deps)` takes
> every browser API it uses as an injected default; the suite needs no microphone, no
> Web Audio and no permission. The test that matters most is the discard one: it holds a
> reference to the clip buffer *before* discarding and asserts it reads all zeros
> afterwards — "the audio is gone" rather than "the pointer is gone".

> **The day graph's legend names the same feelings the check-in chips do.** Since B2 a bare
> `screen.getByText('connectedness')` on the day view finds **two** elements — the drawing's
> key and the chip it was drawn from — and both are correct. Tests about the *rows* scope with
> `within(...)`: `Journal.test.jsx` has a `rows()` helper that waits for
> `[data-entry-kind="checkin"]` and returns a scoped query set, and `CheckinComposer.test.jsx`
> gates on the delete button instead of on a feeling's label. Four suites had to change when
> the legend landed; a fifth (`RitualCards.test.jsx`) switched to `findAllByText`.

> **The two day-graph suites are one letter apart.** `dayGraph.test.js` is the geometry — 62
> tests, no DOM — and `DayGraph.test.jsx` is the drawing: 32 tests that count `<path>`s, read a
> `stroke-dasharray`, dispatch touch events and assert which of the page and the graph called
> `preventDefault`. They are *different files on a case-insensitive filesystem*, so an import
> of either must spell the extension out; see [Frontend §4be](06-frontend.md#4be-daygraphjsx--the-day-drawn).

Three components now need providers to render at all — `Dashboard` reads `useSubjects()` and
navigates, `TimelineRoute` does both, and `Journal` needs `SubjectsProvider`,
`JournalProvider` **and** `DiscretionProvider` — so their tests wrap in `MemoryRouter` plus
the providers. `Dashboard.test.jsx` has a `renderDashboard()` helper and `Journal.test.jsx` a
`renderAt(path)` one; copy whichever is closer rather than rendering the component bare.

> **`axios.get` must be mocked per URL, not once.** Since Phase 4 the provider loads
> `/api/subjects` **and** `/api/relationships` in parallel, so a bare
> `axios.get.mockResolvedValue({data: [...]})` hands the same array to both and the
> relationship list ends up full of snapshots. Both `Dashboard.test.jsx` and
> `SubjectsContext.test.jsx` have a `mockFetch` helper that dispatches on the URL; use it.
> `Dashboard.test.jsx`'s variant derives the relationships from the snapshots, so most
> fixtures only need a `relationship_id` on each row. **Phase 6 adds two more URLs** —
> `/api/journal/entries` and `/api/journal/days` — so a journal test dispatches on four;
> `Journal.test.jsx`, `JournalContext.test.jsx`, `CheckinComposer.test.jsx`,
> `RitualCards.test.jsx`, `JournalPeople.test.jsx` and `JournalTriggers.test.jsx` carry that
> version of the helper. Since A8 **`Dashboard.test.jsx`
> wraps in `JournalProvider` too** — the dashboard's nudge slot is shared with the journal's
> nightly prompt, so the dashboard's tree is the tree `App.jsx` actually mounts.

> **A test that depends on which day it is fakes only `Date`.**
> `vi.useFakeTimers({ toFake: ['Date'] })` plus `vi.setSystemTime(...)` pins `civilDay()`
> without taking `setTimeout` away from testing-library, which is what makes `userEvent` and
> `waitFor` still work. `Journal.test.jsx` pins 12:00 **UTC**, safely past the 04:00 rollover
> in every zone the suite could run in, so "today" is the same day wherever it runs.

Two suites are worth knowing about before writing anything that touches a session or a
touch gesture:

- [`src/auth/session.test.js`](../src/auth/session.test.js) — 13 tests. The load-bearing one
  is **"shares one request between concurrent callers"**: two parallel refreshes spend two
  tokens from a rotating family, the server reads the second as a replay, and the user is
  signed out. That failure only appears under concurrency, and the dashboard is concurrent by
  construction. The other pair worth preserving is the distinction between a *refused* token
  (session over) and a 5xx or dead network (session intact) — get that wrong and every phone
  that wakes up out of coverage is signed out.
- [`src/components/VaultKnob.test.jsx`](../src/components/VaultKnob.test.jsx) — 10 tests over
  `fireEvent.pointerDown/Move/Up` with explicit `clientY`, at 2.6px per unit. It asserts the
  drag direction, one detent per unit, the stops, and that the dial re-anchors after being
  driven into one.

The card-stack gesture tests in `Dashboard.test.jsx` dispatch `Event`s directly rather than
using `fireEvent`, because what they assert is whether the container's `{ passive: false }`
listener called `preventDefault` — that is, which of the page and the stack owns the gesture.
They wrap the dispatch in `act()`: the listener is a plain DOM one, outside React's event
system, so nothing else flushes the state update.

[`src/components/Auth.test.jsx`](../src/components/Auth.test.jsx) — 8 tests:

| Test | Asserts |
| :--- | :------ |
| renders login view by default | "Welcome back", Sign In button, toggle link |
| toggles to signup view | "Create your account", Create Account button, reverse toggle |
| allows email/password input | controlled inputs hold typed values |
| handles successful login | correct `POST /api/login` payload, loading state, `onLogin(session)` — the whole payload, refresh token included |
| prefills the address the last sign-in used | the email is remembered, the passphrase is not |
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
| Guided scoring | an anchor phrase from the right band follows the slider; answering a metric renders the band **without moving the slider**; `Use 70` sets exactly the midpoint; the saved payload carries the answers |
| Anchor phrasing | every band has five distinct phrasings, none repeated across a category; `anchorPhrase` holds still across a whole band and walks all five over five seeds |
| Skip / unsure | a skipped category is absent from `stats` (not zero); an unsure id is listed; skipping a category drops its unsure flag; edit seeds both from the snapshot; a new version inherits scores but not uncertainty |
| Card surface | note icon and up to three chips, `+1` overflow, `—` for five skipped categories and `≈60%` for an unsure one, and **no** `0%` anywhere; the summary line; the bars ⇄ Love Shape flip |
| Summary line | `summarizeStack` — dominant pair, taxonomy-order tie-break, suppressed below two scored categories, "most changed" withheld below three snapshots, and skipped snapshots excluded from a range |
| Wheel trap | the wheel is swallowed only while a version remains to scrub to; a single-version stack and a clamped stack both let the page scroll |
| Routing | Deep Analysis navigates to `/relationships/<id>/timeline` |
| Stack actions | two relationships sharing a display name render as **two** stacks (the case name-grouping could not express); rename updates every card and the stack header; a 409 keeps the dialog open with the typed name; the merge dialog offers only *other* stacks, states what will move, and disables confirm until a target is chosen; relationship delete names the snapshot count and leaves other stacks alone; setting a rhythm PATCHes the days, and turning it off sends an explicit `null` |
| Quick Pulse | opens with seven collapsed rows carrying last time's answers; saves `kind: 'pulse'` with the scores and skips inherited and the context cleared; expanding one row reveals the slider and hides guided scoring; the name stays locked |
| Cadence nudge | one calm sentence when a rhythm has elapsed, and nothing at all when none is set however long it has been; "Later" survives a remount via `localStorage`; dismissing does not come back in the same session and leaves the snooze store untouched; "Quick pulse" opens the pulse form pre-filled |
| What Changed | appears after a new version, **not** after an in-place edit; shows the elapsed sentence and `↑30`; the note follow-up PUTs only `{description, tags}` |
| Errors | fetch failure surfaces in `role="alert"`; a failed save keeps the form open with its input; the banner dismisses |

[`src/components/WhatChanged.test.jsx`](../src/components/WhatChanged.test.jsx) — 16 tests.
Mostly pure-function tests of `computeDeltas` (ordering, steady collapse, not-comparable,
uncertain propagation, and that a **score of 0 is not a skip**), `findPreviousVersion`
(same relationship only — including a namesake in a *different* relationship being ignored —
backdated → `null`, undated fallback) and `elapsedSentence` (each unit boundary, same-day,
undated), plus four screen tests covering the delta list, the note save, the note failure
path, and dismissal.

[`src/components/AnalysisTimeline.test.jsx`](../src/components/AnalysisTimeline.test.jsx) —
12 tests. `makeDotRenderer` is tested directly (solid / dashed / nothing), then
`buildTimelineData` for each of its honesty rules: real timestamps with proportional gaps,
undated snapshots excluded **and counted**, same-day snapshots nudged 12h apart for display,
and markers derived only from snapshots carrying tags or a note. Three render tests cover the
undated footnote, the conditional dashed-point hint, and the compare selector.

[`src/components/LoveShape.test.jsx`](../src/components/LoveShape.test.jsx) — 10 tests.
`buildShapeData` (taxonomy order, `scored: false` for a skip, a genuine 0 distinguished from
a skip, uncertainty carried through, no compare series without `compareTo`) and `ShapeDot`
(filled / open-dashed / filled-dashed).

[`src/components/dayGraph.test.js`](../src/components/dayGraph.test.js) — 62 tests, and
**the pattern to copy for any chart logic** (see the Recharts note below). No DOM at all: the
day graph's geometry is four pure functions, so the whole suite is fixtures in and geometry
out. `buildDayCurve` gets the eight construction rules of
[§8.2](../product_vision/06-emotional-journal.md#82-from-discrete-check-ins-to-a-continuous-branching-curve)
one at a time — the trunk starting at the first check-in and not at midnight, two simultaneous
feelings leaving it at the same `t`, a feeling reported twice interpolating without dipping
below either endpoint, decay crossing `BRANCH_END_THRESHOLD` at the minute the half-life
implies, a later check-in *without* the feeling not ending its branch, an explicit `level`
check-in ending every other branch over `NEUTRAL_SETTLE_MIN`, and both sides of the
`CONFIDENT_MIN` boundary for `extrapolated`. Then `branchPaths` (one path per lifetime, birth
and merge at trunk valence, dashed for `unclear` and for `uncertain`), `project` (exactly the
2-D ribbon at `pitch = 0`, `yaw = 180°` mirroring x), `paintersOrder` (stable for equal
depths) and `dayGraphLegend` (first-appearance order, and holding no names at all).

> Three of its habits are worth stealing. **Compute the expected minute from the constant**
> rather than pasting the number the implementation produced: the decay case asserts
> `150 · log₂(1 / 0.2)`, and a second case re-runs the same day at a different half-life, so a
> constant that stopped driving the arithmetic would fail rather than pass with stale numbers.
> **Assert both sides of every boundary** — 90 minutes is confident and 95 is not.
> And **read the source file back**: one case greps `dayGraph.js` for a React, Recharts or
> three.js import and for JSX, which is the only way a "this module never renders" claim stays
> true a year later. Use `resolve(process.cwd(), '<repo path>')` — Vitest rewrites
> `import.meta.url` into something `fileURLToPath` refuses.

[`src/components/TimelineRoute.test.jsx`](../src/components/TimelineRoute.test.jsx) — 8
tests, rendered through `MemoryRouter` + `SubjectsProvider`. The id route: `timelinePath`,
direct entry fetching and rendering, a name that would have needed URL encoding (it is no
longer in the URL at all), the unknown-relationship empty state, and a load failure surfacing
as an error rather than as "no analysis". The legacy route: an old `/timeline/:name` link
redirecting to the id it names, single-decode of that name, and the explanatory empty state
when the name no longer matches.

[`src/context/SubjectsContext.test.jsx`](../src/context/SubjectsContext.test.jsx) — 18 tests.
`groupPeople`, `findStack` and `buildStacks` as pure functions — including the two cases the
entity exists for: two relationships sharing a display name stay apart, and a stack whose
rows disagree on the name still groups together. Then the provider through a probe: both
endpoints fetched once for all consumers, no fetch when disabled, a failure in *either*
request surfacing, and every mutation (create, delete, rename, merge, delete-relationship)
updating both the snapshot list and the relationship list.

[`src/constants/cadence.test.js`](../src/constants/cadence.test.js) — 17 tests, all pure.
`humanGap` and `latestSnapshotDate`, then `dueStacks` against every rule the feature promises:
due on the exact day, never due without a rhythm, never due without a **dated** snapshot,
silent while snoozed and speaking again once that lapses, dropped once seen this session,
longest wait first. `nudgeSentence` is asserted against a forbidden-word list
(`overdue`, `missed`, `streak`, `should`, `behind`, `!`) — the no-guilt rule is a product
constraint, so it is tested like one.

> **The embedding index and retrieval** (G1 and G2, §5.8). `src/journal/embeddings/` is nine
> files and none of them loads EmbeddingGemma: every test injects `createFakeEmbedder`, exactly
> as the inference suites inject `createFakeRuntime`, and for the same reason — a suite that
> needs 219 MB to run is a suite that stops being run.
>
> - **`embed.test.js`** asserts the two **mandatory prompt prefixes** on the exact string
>   (`task: search result | query: ` and `title: none | text: `, trailing spaces included) and
>   that they differ correctly between a query and a stored entry. This is the only place a
>   wrong prefix can be caught: downstream there is no symptom at all, because the vector still
>   has 256 numbers, still scans and still ranks — it is just quietly worse at everything.
> - **`similar.test.js`** asserts **rule 3 as a gate rather than a weight**: a close vector with
>   no shared person or trigger produces nothing, and *two identical vectors still produce
>   nothing*, so no similarity can out-vote a missing witness. It also states the scan's budget
>   — ten thousand 256-dimension vectors, 2.4 ms measured here, asserted under a loose 1 s so a
>   change that made it quadratic fails by minutes rather than by a hair.
> - **`normalisation.test.jsx`** drives §5.8's payoff end to end and walks **every request body**
>   the card and the Triggers view produce — accepting a suggestion, declining one, merging a
>   pair — failing on a typed array, on any run of sixteen or more numbers, and on any field
>   named `vector`, `embedding`, `dims` or `entry_client_id`. A self-test plants each of those
>   first, so the walk is known to look.
> - **`logout.test.jsx`** asserts the index is *emptied* on the branch that runs with no
>   session. `store.test.js` proves `clearVectorIndex` empties one; this proves it is called,
>   which is the half a refactor can drop while every other test stays green.
>
> **G2 added four more, and the honest thing about them is what each cannot prove.**
>
> - **`recall.test.js`** — the pure half of search and the three smaller uses. German folding
>   (`Fußball` = `Fussball`, which NFD does not do), compounds found by their first half, the
>   inverse-document-frequency weighting that answers a natural-language question with its one
>   rare word, and — the part that is a rule — that `orderNamesakes` returns **the same array**
>   it was given, reordered: no candidate added, removed or selected.
> - **`retrievalGolden.test.js`** — §5.8's retrieval golden set. Every **lexical** case passes
>   here, in both languages, with no model: those are real numbers about the shipped search.
>   Every **semantic** case is asserted to be *skipped, by name, with a reason* — a suite that
>   quietly graded them against a stand-in would put a number about the stand-in into a report
>   beside numbers about a model. `make journal-eval` scores them when an embedder exists.
> - **`retrievalPrompt.test.js`** — the guard §5.8's fourth use is conditional on. Over all 120
>   proposal golden cases in both languages, with a deliberately *hostile* retrieval, it asserts
>   a retrieval-influenced prompt cannot lose a word a clear case needs, cannot add a word the
>   user has not confirmed, cannot name a feeling, and changes no rule and no vocabulary line.
>   Those are the three ways a prompt change can flip a case, and the last test in the file
>   plants a narrowing retrieval to prove the guard is not vacuous. **What it does not prove is
>   that no model is ever swayed by an ordering** — that needs weights, and the retrieval report
>   in `product_vision/eval/` says so in the same words.
> - **`retrieval.test.jsx`** — the four uses on real screens. The past-entry chips are dashed,
>   pre-confirm nothing, carry `from: "retrieval"` and the ids they were read from, and are
>   recorded that way in `payload.retrieval` when kept; a German phrase and an English one each
>   find the right day and the result is an **entry** with a link to it rather than prose; the
>   namesake order changes and the selection never does; and typing a query makes **no request
>   at all**, which is what the Vault's *"search happens here"* rests on.
>
> Rule 2 — *never show a number* — is held in three places at once: `journal.test.js` walks
> `JOURNAL_COPY.similar` for digits (search, past entries, namesakes and *already known*
> included, since they all live in that group for exactly this reason), `similar.js` and
> `recall.js` return offers with the similarity already thrown away, and `retrieval.test.jsx`
> walks the rendered search screen for one.

[`src/constants/journal.test.js`](../src/constants/journal.test.js) — 138 tests, all pure.
It carries **the two rails Phase 6 adds**, and they are the reason it exists as much as the
readers are.

1. **The forbidden-word walk.** `cadence.test.js` checks one sentence against six words.
   This one walks *every string* in `JOURNAL_COPY`, plus every `RITUAL_QUESTIONS[].text` and
   `.note` and every `FEELINGS[].label` and `.gloss`, against eighteen: the original six plus
   `forgot`, `healthy`, `unhealthy`, `concerning`, `symptom`, `disorder`, `diagnos`, `fail`,
   `guilt`, `lazy`, `bad`, `good job`. It is a **recursive walk over the object**, not a list
   of strings someone remembered to add, so a sentence written next session is covered the
   moment it lands — which is what makes "no bare string literals in a journal component"
   (Appendix B) worth enforcing. Two cases guard the walk itself: one asserts it reaches a
   deeply nested path, and one plants an offending string and asserts it is caught.
2. **Id parity with the backend.** The test **reads
   `backend/internal/domain/journal.go` off disk** and asserts `FEELINGS`, `RITUAL_QUESTIONS`
   and `ENTRY_KINDS` hold exactly the ids of `domain.FeelingIDs`, `domain.RitualQuestionIDs`
   and `domain.JournalKinds`, in the same order, in **both directions** — and that the Go
   file holds no labels or colours, so the copy has one home the walk above can reach. This
   is the test that stops the two languages drifting; adding a feeling in one and not the
   other is red, not a silent `400` months later.

The rest: the payload readers against a v1 payload, unknown keys (preserved on `raw`), an
unknown `about` kind, a **ritual with a skipped question — absent, never `false`** — a
trigger merge chain two deep, a self-referencing merge and a two-trigger cycle (neither
loops); `civilDay` at 03:59 and 04:00, across a month, a year, and **both DST changes**,
with a guard case asserting the suite really is in a zone that has one; `personCandidates`
(exact wins alone and is marked exact, `Lucie` offers `Lucie M`, case- and
diacritic-insensitive matching, never more than three, never a selection, nothing for an
empty name) and `triggerCandidates` (`arbeit` matches `Arbeit`; `work` does not); and
`clientId` with `crypto.randomUUID` removed, because a self-hosted install over plain
`http://` has no secure context and no `randomUUID`. A6 added eleven more for the day
view's arithmetic: `shiftDay` across a month, a year, a leap day and both DST changes,
`monthBounds` (February in a leap year and out of one), and `timeOfDay` answering `null`
rather than a plausible wrong time for `null` — `new Date(null)` is the epoch, not an
invalid date. A7 added five for the two halves of *when was this*: `tzOffsetMinutes` counting
minutes **east** of Greenwich (the opposite way to `getTimezoneOffset`, which is the sign
error that would pass on a machine sitting on UTC) and `rfc3339Local` writing the local
offset rather than a `Z`, both across a DST boundary, with a guard case asserting
`process.env.TZ` really took. A8 added nine for the ritual's two pure pieces: `ritualDeck`
(the core five alone, an optional tail ordered by the *set* rather than by the order the user
switched them on, capped at three, an unknown id dropped rather than drawn as a blank card)
and `minutesIntoCivilDay` / `ritualTimeReached`, which measure the hour **from the rollover
rather than from midnight** — so 01:00 is late in tonight's civil day and 04:00 is early in
tomorrow's, and a ritual started after midnight is still tonight's. A9 added twenty-two for
the two vocabulary views: `topFeelings` (most first, **tied on `FEELINGS` order** so the same
data always names the same two, an unknown id kept after every known one and then
alphabetically); `summarizePerson` (counting every kind of entry that names them, splitting
the facts from everything else so the remove dialog's two numbers cannot overlap, and
reaching a feeling through the mention's `ref` — the fixture puts the same person at ref 0
on one entry and ref 1 on the next, which is what makes that a real assertion); and
`summarizeTrigger` resolving through the merge chain, with a case proving that **without** the
resolver the pre-rename entries would be a different trigger. Plus the two correction
builders: a rename minting its own `client_id` and carrying `supersedes_id` and the old id in
`corrects`, the list **accumulating across two renames** rather than pointing one hop back,
and a merge naming the survivor by its `live` id and carrying its label rather than inventing
one — with a round trip through `readTrigger` proving the row it produces resolves. And
`countCopy`, which carries **the whole clause including its verb**: the singular and plural
are two templates, because one with a number dropped into it produced *“1 entry stop being
linked”* on a running screen past a green suite.

[`src/context/JournalContext.test.jsx`](../src/context/JournalContext.test.jsx) — 22 tests.
`useJournal()` throwing outside its provider (matching `useSubjects`), the default range
being the month of the current civil day, both journal endpoints fetched with the same
`from`/`to`, and — the invariant-17 test — **exactly one** `GET /api/relationships` in the
whole tree, because the journal reads the people rather than fetching them. Then `loadRange`
refetching and refusing a reversed or malformed range; a failure holding a written sentence
and preferring the server's own message; `createEntry` minting a v4 `client_id` when the
caller did not, keeping the caller's when it did, drawing a replayed post once, and dropping
the row a correction superseded; `deleteEntry`; `resolveTrigger` answering for a renamed
trigger by the id old check-ins still hold; and `markedDays` merging the counts endpoint with
entries written since — while never marking a day whose only entry is a trigger, because
vocabulary is not an event.

[`src/components/Journal.test.jsx`](../src/components/Journal.test.jsx) — 40 tests, through
`MemoryRouter` + all three providers. The day: a check-in's feelings by their **labels** (the
id `rapport` shows as *connectedness*), its person chip under the relationship's current name,
its trigger chip resolved from the stored id, its context tag, its time and its transcript; an
`unclear` feeling and an `uncertain: true` one drawn dashed while `false` and absent stay
solid; the ritual as the footer *after* the check-ins, with a question in `asked` and not in
`answers` rendering as *Unanswered*. The three §9.4 empty states asserted against
`JOURNAL_COPY` verbatim, including the first-run card appearing only on a journal that holds
nothing and whose ritual setting has never been touched. Prev/next across both month
boundaries and the refetch that follows; the month strip's 31 cells and its marks; a path that
is not a day redirecting to today. Under discretion: names to initials, transcript and trigger
label carrying `BLUR_CLASS`, feeling chips untouched. A failed load in the screen's own
`role="alert"` slot with the header, the strip and the empty state all still on screen. And
`MobileBottomNav`'s five slots, with Journal lit on `/journal/2026-08-21` and on
`/journal/people/3` but not on `/`. A9 replaced the placeholder-route cases with one that
asserts the day header links to **People** and **Triggers** — the bottom bar has one journal
slot, so those two links are the only way in to either screen.

[`src/components/JournalPeople.test.jsx`](../src/components/JournalPeople.test.jsx) —
20 tests. The one thing no other file in the suite can assert: a relationship with
`snapshot_count: 0` is **listed** and **not** linked to a timeline, while one with snapshots
is. Then the counts and the two most-attached feelings, with a deliberately reversed fixture
proving the tie-break is `FEELINGS` order rather than payload order, and a feeling attached to
nobody staying out of the summary. The detail screen is **keyed by id**: a rename lands
mid-session through a `reloadKey` bump and the heading follows it while the same two mentions
and one fact stay exactly where they were. *Remove this person from the journal* states both
counts, agrees with each of them (*1 fact … goes* / *1 entry … stops*), leaves out a clause
with nothing to count, issues **one** `DELETE /api/journal/people/7` on confirm and **none**
on cancel, keeps its dialog and message on a failed write (trap 4), and is not rendered at all
when the journal holds nothing about them. Under discretion both screens mask names and the
transcript and fact carry `BLUR_CLASS`.

[`src/components/JournalTriggers.test.jsx`](../src/components/JournalTriggers.test.jsx) —
19 tests, asserting on **the request body** for the same reason the composer's tests do:
there is no rename endpoint and no merge endpoint to mock, only a `POST` a Go validator will
reject if the payload is wrong. The list's counts and its taxonomy tie-break; the detail
listing only the check-ins that name the trigger; **no delete anywhere on the screen**, which
is what stops a trigger a check-in still references being stranded out of an export. A
**two-deep merge chain** as the client actually sees it — two correction rows and a survivor,
the superseded originals absent — resolving to one row, gathering all three entries under it,
and listing neither merged id; and the same chain resolved by the **day view** (A6) and by the
**composer** (A7), which offer the survivor's label and its live id and nothing else. Rename
posts `supersedes_id` and the new label and updates the list **without refetching
`/api/subjects` or `/api/relationships`**. The merge dialog carries the count *and* the
one-way sentence, shows neither before a target is chosen, leaves one row behind, and offers
nothing that would take it apart again. A copy rail walks every text node the screen renders
— list, detail and both dialogs — against `JOURNAL_COPY`, the closed vocabularies and the
user's own words, with filled templates matched **by shape** (`{count}` → `.+`) rather than
listed one filling at a time, and a planted sentence proving the filter looks.

[`src/components/CheckinComposer.test.jsx`](../src/components/CheckinComposer.test.jsx) —
35 tests, driven the way a user drives the composer: from `/journal`, through the button the
day view puts on screen, to **the request body that reaches `POST /api/journal/entries`**.
Asserting on the request rather than on component state is the point — the §7.2 shape is a
contract with a Go validator that would reject a wrong one at runtime and pass every
assertion made one level higher up.

The zone is **pinned to `Europe/Berlin`** for the whole file, with a guard case asserting it
took, so `tz_offset_min: 120` and the `+02:00` on `at` are real assertions rather than
whatever the machine running the suite happens to be.

Three taps — open, one word, save — producing `source: "chips"`, one feeling, intensity 2 and
**no `uncertain` key at all**; the dots cycling 1 → 2 → 3 with a `expect(card.textContent).not.toMatch(/\d/)`
guard, because "dots, never numbers" is a product rule; the `≈` toggle writing
`uncertain: true`. A known person sending `relationship_id`, a new one sending `name` and no
id, `Lucie` offering `Lucie M` **and attaching nothing on its own**, an exact name resolving
with no *new person* beside it, and two feelings about one person making one mention. A known
trigger sending its `client_id`, a new label minting one that the feeling's `about` then
names, two feelings sharing one minted trigger, a merged trigger offered under the surviving
label only, and — twice over — **a label typed and then removed, or never confirmed, minting
nothing**. The cap stated and the sixth chip disabled; `unclear` saved alone and clearing
whatever else was picked. Moving a chip between feelings. A 500 leaving the sheet open with
every chip, strength and attachment intact (trap 4) and the server's own message when it sent
one. Under discretion, a person chip as `L. M.` and the note carrying `BLUR_CLASS`. One
`toEqual` against a **literal request object**, so a dropped, added or renamed key fails here
rather than at runtime. And the day view's delete: the dialog naming the time, the words and
what survives; the delete itself; the decline; and a failure keeping the dialog open.

[`src/components/RitualCards.test.jsx`](../src/components/RitualCards.test.jsx) — 32 tests,
zone pinned to `Europe/Berlin` and the clock pinned to 23:00 local, both with guard cases. The
deck: the core five in the fixed order, two optional ones appended in the *set's* order, and
`question_set.asked` recording every card that was shown. The three gestures, driven as
pointer events on the card: right → `true`, left → `false`, and **up → a key absent from
`answers` and present in `asked`** — the invariant-14 assertion this whole session exists to
protect. A tap records nothing and does not advance, and a drag below the threshold springs
back; `gestureIntent` is exported and tested as arithmetic beside them, because a tap is the
case a DOM-level gesture test is least likely to reproduce faithfully. The buttons and the
arrow keys are asserted to produce the **same request body** as the swipes, key for key.

The closing card writes the word twice — `day_word` on the ritual and a separate `checkin`
with `source: "ritual_word"` at the **same `at` and `day`** — with no `intensity` on the
feeling and no `uncertain` on the day word, because neither is a statement the user made.
Skipping it writes neither. *Who?* appears only behind a yes **and** the setting, writes
mentions carrying the unmasked name while the chip shows initials, and writes none when
skipped. `detent` fires once per commit and **not at all** under discretion. `touch-action:
none` is asserted on the card and absent from every ancestor, in inline styles and class
names both. The prompt line: silent before the hour and silent with the ritual off, one
sentence after it, **never beside the cadence banner**, gone for the session after *Not
tonight* — with the cadence banner still waiting, because the slot stays the ritual's. And a
day with a check-in and no ritual renders no ritual row, no heading, no *Unanswered*, no zero
and nothing matching `/didn't|did not|last night/`.

The copy rail here is a **walk over what reached the screen** rather than over the module: on
every card, every rendered text node must be a string in `JOURNAL_COPY`, a question text, a
feeling label, a person's name, or one of the two arrow glyphs. A planted sentence proves the
filter looks. `Profile.test.jsx` runs the same walk over its Journal section.

[`src/components/Profile.test.jsx`](../src/components/Profile.test.jsx) — 19 tests, the
Journal settings section (§9.7). The three controls and their defaults; the ritual turning on
at 22:30 and its hour moving; the hour surviving an off-and-on; the eight optional questions
each shown with the `note` that says why it is there; the cap at three **stated** before the
unchosen ones disable, and the chosen three staying tappable so the way out is obvious;
*Ask who I was with* off until it is asked for; a second visit reading back what the first
wrote; and a value the section did not write leaving it at its defaults rather than taking
the screen down. One test is a negative: **the five settings whose features do not exist yet
must not be on this screen.** They are described in `JOURNAL_COPY.settings` because A5 wrote
all eight, and rendering a toggle for something the app cannot do would make a Vault claim
false (invariant 2e) — this is the test that stops one arriving by accident.

[`src/context/DiscretionContext.test.jsx`](../src/context/DiscretionContext.test.jsx) —
9 tests: `initials` (including the never-empty fallback), off by default, names to initials
and notes to blur when on, the tab title dropping the app name, `Ctrl+.`, and the choice
surviving a remount.

[`src/components/Vault.test.jsx`](../src/components/Vault.test.jsx) — 15 tests.
`buildCSV` gets four of them because its one rule is easy to break: **a skipped category is
an empty cell, never a zero.** Also quoting (commas and quotes in a note) and an undated
snapshot. `buildJournalCSV` gets four more: one row per feeling with no transcript column, a
person and a trigger resolved to their names (with a comma inside one of them, so the
quoting is exercised there too), an absent intensity left empty, and nothing written at all
when a journal has no feelings in it. The page tests cover the storage summary, the four
privacy claims being present verbatim, "Last export: never", the dry-run-then-confirm import
flow (asserting the dry run posts first and nothing is written until Import is clicked), a
malformed file, and the app-lock honesty copy.

[`src/components/AppLock.test.jsx`](../src/components/AppLock.test.jsx) — 6 tests:
pass-through when no passphrase is set, that `localStorage` holds a hash and never the
passphrase, wrong-then-right unlocking, and that the "does not encrypt anything" copy is on
the lock screen itself.

[`src/mobile/ritualReminder.test.js`](../src/mobile/ritualReminder.test.js) — 16 tests, the
journal's nightly notification (§3.6, §9.6). The plugin is faked with a **store** rather than
with spies, because the claims that matter are about state and not about calls: a `vi.fn()`
can say `schedule` was called twice, and only a pending list keyed by id can say that twice
produced **one** row. So the fake keeps a `Map`, and the tests assert what is pending
afterwards — one notification at the chosen hour, replaced when the hour moves, gone when the
ritual is switched off, absent entirely on the web. The body gets three of its own: the exact
string, the same string at two different hours on two different nights (no interpolation), and
the notification's fields listed rather than sampled, so a later one that could carry content
fails here first. One test crosses the channels — a cadence re-sync must not cancel the
ritual's pending notification, which is the bug the id filter in `cadenceReminders.js` exists
to prevent and which on a device would have looked like Android dropping alarms.

[`src/mobile/deepLink.test.jsx`](../src/mobile/deepLink.test.jsx) — 9 tests, the two paths an
intent may name. Six are the allow-list and the two listeners; the last is the one §9.6 asks
to be **verified rather than assumed**. With a passphrase set it renders the consumer *inside*
`AppLock`, fires the notification's tap, and asserts that no listener was ever registered and
nothing navigated — then unlocks and asserts the retained event arrives. The Capacitor
behaviour it models is real and worth knowing: `notifyListeners(name, data, true)` holds an
event that has no listener and delivers it to the first one to register, on both the native
and the JavaScript side.

[`src/App.test.jsx`](../src/App.test.jsx) — 3 tests covering the login handoff end to end:
the auth header is present **at the moment the first fetch fires**, login lands on the
dashboard rather than back on Landing, and a genuine 401 signs the user out.

> This file needs a hand-written axios mock rather than `vi.mock('axios')`. The automock
> returns `undefined` from `axios.create()`, which `Profile.jsx` calls at module scope, so
> importing `App` throws. The mock also records the registered response interceptors, which
> is what lets the third test fire the 401 path the way axios would.

**Untested:** `Profile`, `Navbar`, and `Landing`. Within `Dashboard`, the `CardStack` offset
transform table remains the highest-value addition.

> **Recharts renders nothing under jsdom.** `ResponsiveContainer` measures its parent, which
> is always 0×0 in a test DOM, so no SVG is produced and custom renderers are never called.
> Every chart component therefore exports its data shaping and its dot renderers as pure
> functions, and those are what the suites assert on. Do the same for any new chart: a test
> that asserts on rendered SVG will pass vacuously or not at all.
>
> **[`dayGraph.js`](../src/components/dayGraph.js) is the pattern to follow** — invariant 19
> taken to its conclusion rather than worked around. The day graph uses no charting library at
> all: every decision about where a line goes lives in four exported pure functions with 62
> tests on them, and the component (B2) is a `map` over paths. `AnalysisTimeline`'s
> `buildTimelineData` and `LoveShape`'s `buildShapeData` are the same idea at a smaller scale.
> When a new chart needs logic, put the logic here-shaped and the drawing in the component;
> hand-drawn SVG then makes even the drawing assertable, which is why `LoveShape.test.jsx` can
> check `stroke-dasharray` and a Recharts test cannot.

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
resolveMock({ data: { token: mockToken, refresh_token: 'refresh-abc', expires_in: 86400 } });
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
- **`TestUpgradeFromPreRelationshipSchema`** — the Phase 4 migration, on a file database.
  It builds a genuinely pre-Phase-4 schema by migrating a `legacyAnalysisSubject` struct
  (no `RelationshipID`, no `relationships` table), seeds rows including a name with trailing
  whitespace, then runs the real `AutoMigrate` + `BackfillRelationships` and asserts the
  stack count matches what the browser used to compute.

  Two things this test discovered, both worth knowing before touching the schema:
  `relationship_id` is **not** in `additiveColumns` because SQLite refuses to drop a column
  that a foreign key references; and the legacy schema is built from a struct rather than
  hand-written DDL because GORM's SQLite migrator only parses DDL it produced itself.

### 2.1a `backfill_test.go` — the migration's semantics

[`backend/internal/database/backfill_test.go`](../backend/internal/database/backfill_test.go)
seeds unlinked rows with raw SQL (the model can no longer express an unlinked row as an
intentional state) and asserts what the backfill promises:

| Test | Asserts |
| :--- | :------ |
| `TestBackfillGroupsByTrimmedNamePerUser` | `"Alex"` and `"  Alex  "` join one stack; `Sam` gets its own; two users who each named their person Alex keep separate stacks; the stored name is normalized to the trimmed form |
| `TestBackfillIsIdempotent` | A second pass reports `0, 0` and creates nothing — the property that makes running it on every boot safe |
| `TestBackfillIncludesSoftDeletedSnapshots` | A soft-deleted row is linked alongside its siblings, so a restore stays coherent |
| `TestBackfillReusesExistingRelationships` | The half-migrated case: rows already linked by the write path cause no duplicate relationship |
| `TestBackfillOnAnEmptyDatabase` | Zeros, no error |

Each test gets its **own** database DSN. The package's older `setupMemoryDB` helper shares
one `file::memory:?cache=shared` across every caller, which would let one backfill test see
another's rows.

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
| `TestCreateSubject` | Valid Request · Name Is Trimmed Server-Side · **Existing Name Reuses Its Relationship** · Partial Stats Are Accepted (missing keys are legal) · Whitespace-Only Name → 400 · Unknown Stats Key → 400 · Stats Value Above/Below Range → 400 · Malformed Date → 400 · Too Many Tags / Blank Tag / Overlong Tag → 400 · Unknown Uncertain Category → 400 · Uncertain About An Unscored Category → 400 · Unknown Guide Answer Category / Above Scale / Non-Index Key → 400 · Unauthorized · Missing Required Fields · Database Error (rollback → 500) |
| `TestCreateSubjectPersistsContext` | The note, the trimmed tags, the parsed date, the uncertain flags, and the nested guide answers all come back on the created row. |
| `TestGetSubjects` | Valid — the expectation is the literal `ORDER BY date IS NULL,date DESC,id DESC`, because that clause is a contract with the client · Filtered By Relationship (`?relationship_id=7`) · Non-Numeric Relationship Filter → 400 · Unauthorized · Database Error |
| `TestUpdateSubject` | Valid (SELECT then UPDATE; note the id arrives as the **string** `"1"` from the route param, and the stored row carries no `relationship_id`, so this also covers a legacy row being linked on its way through an edit) · **Renaming A Version Re-Resolves Its Relationship** · **Resending The Same Name Keeps The Relationship** · Not Found (`gorm.ErrRecordNotFound` → 404) · Invalid JSON → 400 · Unknown Stats Key → 400 · Malformed Date → 400 · Whitespace-Only Name → 400 · Guide Answer Out Of Range → 400 · **Stats Update Orphans An Uncertain Flag** → 400 (the post-merge invariant) |
| `TestUpdateSubjectPartialMerge` | **The description-wipe regression guard.** A body of only `{"stats":…}` leaves name, description, date, tags, uncertain, and guide answers exactly as stored. |
| `TestUpdateSubjectExplicitClear` | `{"description":"","date":"","tags":[]}` really does clear — absent ≠ empty. |
| `TestDeleteSubject` | Valid (soft-delete UPDATE) · Not Found — Nothing Deleted (`RowsAffected == 0` → 404) · Unauthorized · Database Error |

Validation subtests assert on the **error string** as well as the status, via an
`expectedError` substring field on the table — status codes alone would not catch a check
firing for the wrong reason.

Since Phase 4 every write path runs find-or-create first, so the mocks need the relationship
lookup (and, for a new name, its INSERT) *before* the `analysis_subjects` statement.
`expectFindOrCreateRelationship(mock, found)` sets that up — call it rather than
hand-writing the pair.

### 2.2a `relationships_test.go` — real SQLite, not sqlmock

[`backend/internal/handlers/relationships_test.go`](../backend/internal/handlers/relationships_test.go)
deliberately breaks the pattern above and runs against an in-memory SQLite database.

**Why:** rename and merge are multi-statement transactions whose whole point is what the rows
look like afterwards. Asserting on the SQL that produced them would only restate the handler;
asserting on the rows tests the behaviour. The same reasoning covers the find-or-create test
— "a differently-whitespaced name reuses the relationship" is a claim about data, not
about a query.

| Test | Asserts |
| :--- | :------ |
| `TestGetRelationships` | Counts and latest dates per stack, most-recent-first with undated last, another user's relationships absent, and an emptied stack still listed as `0`/`null` |
| `TestRenameRelationship` | The trimmed name comes back and **every** snapshot carries it |
| `TestRenameRelationshipCollisionIs409` | 409, and the failed rename rolled back |
| `TestRenameRelationshipToItsOwnNameSucceeds` | A name collides with *another* relationship, never with itself |
| `TestRenameRelationshipRejectsEmptyName` | 400 |
| `TestMergeRelationships` | All snapshots move and take the target's name; the source is soft-deleted; nothing still points at it |
| `TestMergeRelationshipIntoItselfIs400` | The degenerate case is refused |
| `TestDeleteRelationshipRemovesItsSnapshots` | Its snapshots go (as soft deletes, still readable `Unscoped`), other stacks untouched |
| `TestRelationshipRoutesRejectOtherUsers` | Rename, merge in **both directions**, and delete all 404 on someone else's relationship — and nothing changed |
| `TestRelationshipRoutesRequireAuth` | All four routes 401 without a user in context |
| `TestCreateSubjectReusesRelationshipByName` | The compatibility contract: `"Alex"` and `"  Alex  "` share a relationship, `"Sam"` gets its own, exactly two relationships exist |
| `TestGetSubjectsOrdersByDate` | The `ORDER BY` against a real engine: newest first, undated last |
| `TestAggregateTimeScan` | The four shapes `MAX(date)` arrives as, including the RFC 3339 spelling found in databases written by older driver versions |
| `TestMergeMovesJournalMentions` | A merge moves the journal's mentions in the same transaction, **including ones on soft-deleted entries** — the entry is recoverable, so a mention left behind would come back pointing at a relationship that no longer exists. `mentions_moved` reports the count, the `label` survives as the quotation it is, and the response still carries the target's whole summary |
| `TestMergeReportsZeroMentionsWhenThereAreNone` | The field is present and `0`, not absent, for an account with no journal |
| `TestDeleteRelationshipDetachesMentions` | The entries **survive** a person being deleted, keeping their rows, their labels and their `relationship_id` — the relationship is soft-deleted, so every join through it drops out without anything being rewritten |
| `TestMentionCountsCoverOnlyTheEntriesTheJournalShows` | The two numbers the delete dialog depends on are one number. `mention_count` (read when the dialog opens) and `mentions_detached` (returned when it is confirmed) both cover entries that are neither deleted nor superseded. It also pins `snapshot_count` at **2 rather than 6** for two snapshots joined against three mentions — the fan-out that made the journal's arrival a silent regression in a number every screen reads |

That last one is worth keeping. `MAX()` drops a column's declared type, so SQLite hands back
a **string** where Postgres hands back a `time.Time`; a plain `*time.Time` field fails to
scan, and the failure only shows up once a relationship has a dated snapshot. GORM also
refuses to scan into a struct field that implements only half of the `Valuer`/`Scanner` pair,
which is why `aggregateTime` carries an otherwise-unused `Value()`.

### 2.2b `journal_test.go` — the journal's write path, its reads, and its two deletes

[`backend/internal/handlers/journal_test.go`](../backend/internal/handlers/journal_test.go)
follows `relationships_test.go`: **real in-memory SQLite**, because the endpoint's whole point
is what the rows look like afterwards — one relationship, one entry, one mention, and
*nothing at all* when a step fails. Two cases near the bottom use sqlmock, where the statement
shape is the subject rather than the result.

Every failure case asserts `countEntries(db)` as well as the status: a `400` that left a row
behind is a worse bug than a `500`.

**The write path** (A2) is one table-driven `TestCreateJournalEntry` plus the cases that need
their own fixtures: a valid check-in, ritual and person fact; a **new trigger created in the
same transaction**; an **existing trigger referenced by id**; a trigger belonging to another
user (`404`, nothing written); an `about` naming a trigger the request did not list (`400`);
unknown feeling and question ids; a `day` three days from `at`; a mention with neither id nor
name; a mention naming another user's relationship (`404`); a duplicate `client_id` (`200`
with the stored row, not a second one); `supersedes_id` stamping `superseded_at` and a second
supersede answering `409`; a trigger merge correction carrying `merged_into`; unauthorized;
and a database error rolling the whole thing back.

**The reads** (A3) are `TestGetJournalEntries` — range filter, superseded rows excluded,
ordering, `kind=trigger`, the `relationship_id` filter, a malformed `from` (`400`) — plus
`TestGetJournalDays` for the grouped counts and
`TestGetJournalDaysExcludesDeletedAndSupersededRows`. `TestJournalMentionResolvesByName`
covers find-or-create on real SQLite.

**Two tests pin a rule that reads as an implementation detail and is not:**

| Test | What it pins |
| :--- | :----------- |
| `TestCreateJournalEntryRejectsASupersededTrigger` | A renamed or merged-away trigger cannot be attached to a new entry — through **both** shapes. `{"trigger": id}` always refused it; `{"label": …, "client_id": id}` went down the find-or-create branch, matched on `(user_id, client_id)` alone and quietly accepted it until 2026-08-22. Same id, same answer, and no check-in left behind either way |
| `TestDeleteJournalPersonCountsOnlyTheEntriesTheJournalShows` | `facts_deleted` and `mentions_detached` count only what the journal displays, while the **action** still covers superseded rows. The dialog states those numbers before acting, having read them from `GET /api/journal/entries`; counting a different set here told anyone who had corrected an entry that two facts would go and then took four |

A9 added the two for `DeleteJournalPerson`:

| Test | What it pins |
| :--- | :----------- |
| `TestDeleteJournalPersonRemovesFactsAndDetachesMentions` | Two facts go as **soft** deletes and drop out of reads; the check-in and the ritual **survive** with their mention rows and their `label`; every `relationship_id` naming that person is `NULL`, on the deleted facts as well as on the survivors; another person's mention, the relationship itself and its snapshot are untouched; the two reported counts are disjoint; and a second run reports zeroes rather than repeating itself |
| `TestDeleteJournalPersonScopesToTheCaller` | Another user's person is `404` and nothing of theirs changed — not the fact, not the link; an unknown id, a non-numeric id and a missing user are `404`/`404`/`401` |

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

### 2.3a `vault_test.go` — export and import, on real SQLite

[`backend/internal/handlers/vault_test.go`](../backend/internal/handlers/vault_test.go).
Same reasoning as `relationships_test.go`: these are claims about data, not about queries.

| Test | Asserts |
| :--- | :------ |
| `TestExportShape` | The document's fields, dates as `YYYY-MM-DD`, an undated pulse last, another user's data absent — and, **on the raw response bytes**, that no form of `password` or a bcrypt prefix appears anywhere |
| `TestExportImportRoundTrip` | Export from one account, import into an empty one, re-export: field for field identical |
| `TestReimportIsANoOp` | The same file into the same account skips everything and changes no counts |
| `TestImportDryRunWritesNothing` | The preview writes nothing **and** the real run then does exactly what the preview promised |
| `TestImportRejectsBadDataWholesale` | Seven bad files (format, version, stats range, unknown category, bad kind, cadence bounds, nameless relationship) each 400 with nothing written |
| `TestImportMergesIntoExistingStacks` | `"  Alex  "` lands in the existing Alex, creating no second relationship |
| `TestImportKeepsALocalCadence` | A rhythm set here wins over the file's; an unset one takes the file's |
| `TestImportRequiresAuth` | All three vault routes 401 without a user |
| `TestGetMeta` | Counts scoped to the caller, the oldest date, the backend name, and no configuration detail in the payload |
| `TestGetMetaCountsJournal` | Superseded entries count, soft-deleted ones do not, and `oldest_journal_day` serialises as a bare `YYYY-MM-DD` string |
| `TestGetMetaWithAnEmptyJournal` | An absent span is `null`, not an empty string |
| `TestExportCarriesTheWholeJournal` | Version 2, eight entries in `day`/`at` order including the superseded ones, a mention naming the person, the correction pair, and **no row id anywhere in the block** |
| `TestExportImportJournalRoundTrip` | Export → import → re-export: every entry, mention, payload key, `superseded_at` and `supersedes` identical, and `supersedes_id` remapped onto the newly imported row |
| `TestReimportSkipsJournalEntriesByClientID` | The same file into the same account skips all eight by client id and adds no mention |
| `TestImportStillReadsAVersionOneFile` | A pre-journal file still imports and writes no journal rows |
| `TestImportRejectsAJournalInAVersionOneFile` | A file that says version 1 and carries a journal is 400, naming the version |
| `TestImportJournalMentionCreatesTheRelationshipOnce` | Two entries naming one unknown person create one relationship; an empty label takes the resolved name; a second run skips both |
| `TestImportRejectsATriggerTheFileDoesNotContain` | 400 naming the missing client id, with the file's relationship not written either |

### 2.4 `auth_test.go` — the package that used to be untestable

[`backend/internal/auth/auth_test.go`](../backend/internal/auth/auth_test.go) — 7 tests
covering `LoadSecret` (empty rejected with an actionable message, set accepted), a token
round-trip with its 24-hour expiry, rejection of a token signed with a different secret, an
expired token, **forged claims** (keep the signature, swap the payload for one naming another
user), and bcrypt hashing both ways.

> This package had no tests at all until Phase 5, and the reason was structural: `jwtKey` was
> captured at package init, so no test could set `JWT_SECRET` from inside a test function.
> `LoadSecret` re-reads the variable, which is what made the whole file possible. If you add
> a function here, `t.Setenv` + `LoadSecret()` is the pattern.
>
> One trap this file already hit: do **not** test tampering by flipping the last character of
> the signature. It is base64url, and the final character can carry padding bits, so the flip
> can decode to the same bytes and the token stays valid. Forge the payload instead — it is
> also the attack that actually matters.

### 2.4a `session_test.go` — rotation, replay, and revocation

Nine tests on real in-memory SQLite, because what matters about rotation is the state left
behind — which row is revoked, and which token still works on the *next* call. They cover:
the refresh token being stored only as a hash; a refresh rotating and retiring the token it
consumed; a replayed token revoking every token the user holds; expired, unknown, and
deleted-account tokens; logout ending the session for good; and the expired-row sweep.

`setupSQLiteDB` migrates from `database.Models()` rather than a hand-written list, so a table
cannot exist in the server and be missing from the tests — which is exactly how
`RefreshToken` would otherwise have been left out.

### 2.5 Untested backend surface

`Signup`, `GetUserProfile`, and `UpdateUserProfile` have no handler tests. `Login` is now
covered indirectly by `session_test.go`, which drives it for real (bcrypt cost 14 included —
that is most of the suite's ten seconds).

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

[`.github/workflows/playwright.yml`](../.github/workflows/playwright.yml) — the only workflow
that runs unasked. On push/PR to `main` or `master`: checkout → Node `lts/*` → `npm ci` →
`npx playwright install --with-deps` → `npx playwright test` → upload `playwright-report/`
for 30 days, 60-minute timeout.

Two others exist and are triggered deliberately, not by pushing code
([Deployment §7](09-deployment.md#7-ci)):
[`android-release.yml`](../.github/workflows/android-release.yml) on a `v*` tag or manual
dispatch, and [`deploy.yml`](../.github/workflows/deploy.yml) on manual dispatch only.
**`android-release.yml` is the one place `vitest` runs in CI** — it gates the APK on
`npm test` and `npx vite build`, because a release should not ship from a red tree.

**Not run by any workflow on push:** `vitest`, `go test`, `eslint`, `go vet`, and any Docker
build. (`eslint` would fail anyway in the current checkout — see
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

---

## 6. The model gate — a fourth layer, deliberately not in `npm test`

Phase 6 puts a language model on the user's device, and §5.7 of
[`06-emotional-journal.md`](../product_vision/06-emotional-journal.md) makes that a testable
claim rather than a hope. The layer that does it is **out of band**: it needs weights and
minutes, and nothing about it belongs in a suite people run every few edits.

```bash
make journal-eval CANDIDATE=reference   # ~2 s, no weights: checks the harness itself
make journal-eval                       # the tier defaults; needs a binary and a model
make journal-audio-check                # which of the 240 golden recordings exist
```

The harness is [`scripts/journal-eval/`](../scripts/journal-eval/README.md) and it writes its
report into `product_vision/eval/`. **A model does not become a tier default until its numbers
are in a checked-in report there** — that rule, not a code path, is what the gate is.

### What *is* in `npm test`, and why the split is where it is

| In `npm test` | Out of `npm test` |
| :------------ | :---------------- |
| The 120 golden references against the real `validateProposal` (`validate.test.js`) | Any model answering anything |
| The word error rate and its normaliser (`wer.test.mjs`) | Computing a WER over a real clip |
| The scoring and the aggregates (`score.test.mjs`) | Running a candidate |
| The four gate criteria (`gate.test.mjs`) | Applying them to a model |
| The CLI argument templating and the WAV header reader (`runners.test.mjs`) | Spawning a binary; reading a clip |
| That `transcripts.json` and `recordings.json` agree about the suite | — |

The line is not "cheap versus expensive", it is **"would being wrong here be loud?"** A broken
runner fails immediately and visibly. A word error rate that is quietly 10 % out, or a gate
threshold compared with `>` where it should be `>=`, produces a plausible number in a document
a later session treats as evidence — and nothing ever fails. So the arithmetic is in the fast
suite (65 tests, ~40 ms) and the model is not.

`score.test.mjs` also runs all 120 golden references through the **harness's** reading of an
expectation, which `validate.test.js` runs through its own. Holding the two together is the
point: otherwise a model could be graded by one standard and the suite's own answers by
another, and the gate would be measuring the drift.

### Three things the harness cannot tell you

- **Peak memory is sampled**, every 100 ms from the child process, so it is a floor and not a
  peak. §12.1's actual question — peak with the audio encoder loaded, on the oldest supported
  phone — is a QA-checklist measurement, and reaches a report through a device capture file.
- **Latency is whole-process wall clock**, which on a CLI includes loading gigabytes of
  weights. The in-app figure, with the model already resident, is a different number.
- **The web tier is stood in for.** transformers.js over WebGPU has no CLI; the `full-web`
  candidate runs the same upstream weights through llama.cpp instead. A pass there is evidence
  about the model, not about the runtime a browser uses.

### Adding to the golden suite

Both halves of a pair, then `npm test`, then a row in `recordings.json`, then
`node product_vision/eval/build-recording-scripts.mjs`. The full list is in
[`src/journal/inference/golden/README.md`](../src/journal/inference/golden/README.md). The
suite's own tests will tell you if you skip one of them.
