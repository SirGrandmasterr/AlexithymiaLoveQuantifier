# 08 — Testing

Three layers, three runners. Status below was verified by running each suite
(E2E 2026-07-26; backend and frontend 2026-08-22, at the 6-A closeout).

| Layer | Runner | Location | Verified status |
| :---- | :----- | :------- | :-------------- |
| Frontend unit | Vitest + Testing Library + jsdom | `src/**/*.test.{js,jsx}` | ✅ **609/609 pass** |
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

Twenty-four files, 609 tests, all passing (2026-08-23, session B2).

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

[`src/constants/journal.test.js`](../src/constants/journal.test.js) — 134 tests, all pure.
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

[`src/components/Journal.test.jsx`](../src/components/Journal.test.jsx) — 25 tests, through
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

[`src/components/Profile.test.jsx`](../src/components/Profile.test.jsx) — 10 tests, the
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
