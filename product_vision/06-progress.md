# Phase 6 — Progress Ledger

The hand-off between sessions of [`06-implementation-prompts.md`](06-implementation-prompts.md).
Each session appends its own entry. The most recent state is the truth; this document beats the
plan where they disagree.

## Baseline (session S0, 2026-08-22)

Measured on branch `app-improvements` at commit `ba045c9`, Windows 11, Node 22 / Go 1.x.

| Check | Result |
| :---- | :----- |
| `npm test` | **14 files / 201 tests green**, 24.9 s wall (the preamble's "~70 s" is the slower figure; 25 s is what this machine does) |
| `cd backend && go test ./...` | **green** — `auth`, `database`, `handlers` ok (handlers 10.4 s); `cmd/*`, `domain`, `models` have no test files |
| `gofmt -l .` | **not empty — 15 of 24 tracked `.go` files listed.** The only difference is CRLF line endings; formatting is genuinely clean. See *Warnings*. |
| `go vet ./...` | **clean** |
| `npx vite build` | **success**, 12.5 s, 2455 modules |
| — bundle, main JS | `dist/assets/index-*.js` **813.17 kB** raw / **250.38 kB** gzip |
| — bundle, CSS | `dist/assets/index-*.css` **38.11 kB** raw / **6.87 kB** gzip |
| — bundle, other | three `web-*.js` chunks: 0.84 / 0.90 / 3.45 kB raw |
| `npm run lint` | **broken** — `Cannot find module './cjs/eslint-plugin-react-hooks.development.js'` (ESLint 9.39.2). Environment fault; do not fix, do not use as a signal |
| `git status` | **clean** (six — not four — tracked files under `backend/internal/handlers/uploads/`; see *Warnings*) |

**The bundle numbers above are the yardstick for C3 and D3.** Those sessions add a transcriber
and a runtime; the number that matters is what they add to the 813 kB / 250 kB gzip main chunk,
and whether the weights stay out of it entirely.

## Sessions

| # | Session | State | Commit | Date | Notes |
| :- | :------ | :---- | :----- | :--- | :---- |
| S0 | Baseline, ledger, and the two ordering decisions | done | — | 2026-08-22 | Baseline recorded above; both decisions recorded below |
| A1 | Backend: models, ids, migration | done | — | 2026-08-22 | Two tables, three id vocabularies, no handlers |
| A2 | Backend: `POST /api/journal/entries` | done | — | 2026-08-22 | One endpoint, one transaction; no GET, no DELETE, no PUT |
| A3 | Backend: read, delete, days, and the relationship seams | done | — | 2026-08-22 | Two reads, a delete, and the merge/delete seams; nothing stranded |
| A4 | Backend: export/import v2 | done | — | 2026-08-22 | `exportVersion = 2`, a `journal` block, and a second CSV |
| A5 | Frontend: `src/constants/journal.js` | done | — | 2026-08-22 | One pure module and 86 tests; the two copy rails; nothing renders |
| A6 | Frontend: provider, routes, navigation, day view | done | — | 2026-08-22 | The journal is a place in the app: a provider, six routes, five nav slots, and a day that reads |
| A7 | Frontend: the check-in composer | done | — | 2026-08-22 | Three taps to a check-in; new people and triggers minted only on save |
| A8 | Frontend: the nightly ritual | done | — | 2026-08-22 | `/journal/ritual`, its settings, and the second nudge; one backend line moved with it |
| A9 | Frontend: People and Triggers views | done | — | 2026-08-22 | Both vocabularies visible and editable; two corrections, not endpoints; **one backend endpoint added** for §10.6 |
| A10 | 6-A closeout: docs, QA, review | done | — | 2026-08-22 | **Slice 6-A ships.** Ten QA items on a real stack, three defects found and fixed, thirteen documents made true, a review pass and a simplify pass |
| B1 | Day graph: the geometry | not started | | | |
| B2 | Day graph: the component | not started | | | |
| U1 | The user test | not started | | | Gate: decides whether G1/G2 are built at all |
| C1 | Deployment: headers and the model channel | not started | | | |
| C2 | Capture and the inference boundary | not started | | | |
| C3 | Web Light-tier transcription + the Vault copy | not started | | | |
| C4 | Android: microphone, plugin skeleton, tiers | not started | | | |
| D1 | The proposal contract, offline | not started | | | |
| D2 | The proposal card | not started | | | |
| D3 | Real runtimes + the full Vault copy | not started | | | |
| D4 | The golden suite and the model gate | not started | | | |
| E1 | Encryption alignment | not started | | | **Conditional** — docs/13 is unconfirmed (2026-08-22). May never run. |
| F1 | The outbox | not started | | | |
| F2 | Android depth | not started | | | |
| G1 | The embedding index and trigger normalisation | not started | | | |
| G2 | Retrieval: past entries, search, and the Vault line | not started | | | |
| Z | Phase closeout | not started | | | |

## Decisions

| Date | Decision | Reasoning | Who |
| :--- | :------- | :-------- | :-- |
| 2026-08-22 | **docs/13 does not gate 6-A. The journal ships plaintext.** | Zero-knowledge encryption was *explored as an option and is not confirmed as a future feature.* It is therefore not "close" in the sense §12.3 means, and 6-A does not wait on it. The Vault page states the plaintext position in the journal's own words; the operator explicitly authorised adapting Vault sentences as needed. | User |
| 2026-08-22 | **`person_fact` waits for 6-E — and 6-E is conditional.** | It is the one payload that is verbatim text *about a named third party* (§12.5, docs/13 §0). A1–A4 still build the `kind` and the server still accepts it; **no UI writes one** until the envelope lands. Because encryption is unconfirmed, the honest reading is that `person_fact` is deferred indefinitely, not merely by one slice. | User |

**The consequence, stated plainly so no later session has to infer it:** encryption is not on the
roadmap. **Session E1 is conditional** — it exists in the table below only for the case where
docs/13 is later confirmed, and it may never run. 6-A must still ship the docs/13-compatible row
shape (`client_id`, opaque `payload`, ids-only mention table) exactly as §6.2 specifies: that shape
is cheap, it is good design on its own merits, and it is the only thing that keeps the door open.
**A1 must not drop it as "no longer needed."**

## Measured

Everything the design document marked `(verify)`, as it gets measured. Device, build, date.

| Date | What | Value | Where measured | Design doc updated? |
| :--- | :--- | :---- | :------------- | :------------------ |
| 2026-08-22 | Baseline main-chunk size, pre-journal | 813.17 kB raw / 250.38 kB gzip | `npx vite build`, this machine | n/a — baseline, not a `(verify)` |
| 2026-08-22 | Main-chunk size after A4 — the first bundle movement of the phase | 815.15 kB raw / 251.19 kB gzip (**+1.98 kB / +0.81 kB gzip**), from `buildJournalCSV` and the changed Vault copy | `npx vite build`, this machine | n/a — not a `(verify)`, but the number C3 and D3 are measured against |
| 2026-08-22 | Main-chunk size after A5, the first **frontend** slice | 815.15 kB raw / 251.19 kB gzip — **unchanged from A4**. Nothing imports `journal.js` yet, so it tree-shakes out entirely | `npx vite build`, this machine | n/a — not a `(verify)` |
| 2026-08-22 | Main-chunk size after A6 | 838.39 kB raw / **258.95 kB gzip** (**+23.24 kB raw / +7.76 kB gzip** over A5). Two thirds of it is `journal.js` finally being reached — it tree-shook out entirely until A6 imported it — plus `Journal.jsx`, `JournalContext.jsx` and one lucide icon | `npx vite build`, this machine | n/a — not a `(verify)`, but this is now the yardstick C3 and D3 are measured against, **not** the 815 kB figure |
| 2026-08-22 | Main-chunk size after A7 | 859.58 kB raw / **264.46 kB gzip** (**+21.19 kB raw / +5.51 kB gzip** over A6). The composer, its three pickers and one lucide icon. This is now the yardstick C3 and D3 are measured against | `npx vite build`, this machine | n/a — not a `(verify)` |
| 2026-08-22 | **The handset check-in button, measured on the running app at 360 × 800** | **64 × 64 px**, 16 px from the right edge, its bottom 72 px above the viewport — clearing the 57 px bar with a 15 px gap. `display: none` above `md`, where the header button (`Check in`) sits flush with the content column's right edge instead | Chromium, dev server, this machine | Yes — §9.2's "64 px, inside the thumb's arc" is now a measurement |
| 2026-08-22 | Main-chunk size after A9 | 896.58 kB raw / **273.02 kB gzip** (**+20.59 kB raw / +4.56 kB gzip** over A8). The two vocabulary screens, their four dialogs and two lucide icons. Superseded by the A10 row below | `npx vite build`, this machine | n/a — not a `(verify)` |
| 2026-08-22 | **Main-chunk size after A10 — and therefore the cost of the whole of slice 6-A** | **897.65 kB raw / 273.27 kB gzip.** Against S0's pre-journal baseline of 813.17 / 250.38, **6-A costs +84.48 kB raw / +22.89 kB gzip** — about 9 % of the main chunk for two tables, five endpoints, six routes and five screens. CSS 41.73 / 7.33, up 3.62 / 0.46. A10 itself added +1.07 kB raw / +0.25 kB gzip over A9 (the Vault copy, `contextTags.js`, the trigger index). **This is the number C3 and D3 are measured against** — and the reason to have it: the entire manual journal is 23 kB gzip, so a transcriber costing megabytes has to stay out of this chunk altogether | `npx vite build`, this machine | n/a — not a `(verify)`, and the yardstick for the rest of the phase |
| 2026-08-22 | **§12.4 question 1, the mechanism floor for the *worst-case* deck** | **11 interactions, 17.2 s** — five core questions, three optional, the *Who?* card and its Done, and the day word — driven at a deliberate 1.5 s per interaction at 360 × 800. The app's own share is **~90 ms per card**; a minute allows **5.4 s per interaction**, so ~3.5× headroom and **§3.3's optional tail does not need to shrink**. The screen had no scroll in either axis throughout, which is the condition invariant 2g's exception rests on. **Driven, not observed** — the pace was chosen, and the number §12.4 actually asks for is U1's. Note that `duration_ms` on the stored row read **29.8 s** for the same pass, because the app's clock starts when the screen mounts: do not read that field as a user timing | Chromium, dev server against a real backend, this machine | Yes — §3.3 now carries the measurement and states plainly what it is and is not |
| 2026-08-22 | **Phase-5 → Phase-6 migration, against a seeded database rather than an empty one** | Built a Phase-5 database from a worktree at `HEAD`, seeded it through the API with a user, two relationships and three snapshots, then ran the Phase-6 code against it. `make migrate-check-local` reported **exactly** `missing table "journal_entries"` and `missing table "journal_mentions"` — no column drift on any existing table — and after `go run ./cmd/migrate`, *schema is up to date* with every Phase-5 row intact. This is the evidence behind the roadmap invariant now reading "additive… **outside** Phase 4" | `make migrate-check-local`, this machine | Yes — `product_vision/README.md` |
| 2026-08-22 | **A trigger rename and a merge, end to end on a real backend** — the §7.1 claim that readers resolve while the writer never does | Three check-ins naming `cea3f018…` still reference **that** id after a rename; the export carries both rows with `corrects` linking them; the day view, the composer and the triggers view all read the survivor's label. A two-step merge behaved the same | Chromium, dev server against a real backend, this machine | Yes — §6.3's `corrects` decision is now demonstrated rather than argued |
| 2026-08-22 | Main-chunk size after A8 | 875.99 kB raw / **268.46 kB gzip** (**+16.41 kB raw / +4.00 kB gzip** over A7). The ritual route, its settings section and two lucide icons. This is now the yardstick C3 and D3 are measured against | `npx vite build`, this machine | n/a — not a `(verify)` |
| 2026-08-22 | **§12.4 question 1, partially: nine interactions at a deliberate pace** | **13.5 s** wall clock, first card to *Recorded.*, at 1.5 s per card on a 360 × 800 viewport — a minute allows 6.7 s per card, so ~4× headroom and the optional tail need not shrink. **Driven, not observed**: the pace was chosen. The number §12.4 asks for is U1's; this is the floor to compare it against | Chromium, dev server against a real backend, this machine | Partly — §3.3's "nine interactions … should confirm" now has a mechanism floor; the user-test half is still open |
| 2026-08-22 | **The ritual card and its controls at 360 dp** | card 328 × 143 with a 98 px commit threshold (30 %); Yes/No 157 × 56 at y 632, skip 56 × 44 at y 704 — inside the thumb's arc over a viewport with **no scroll in either axis**, which is what invariant 2g's exception rests on | Chromium, dev server, this machine | Yes — `docs/12-android-app.md` §3.3 now lists the ritual card as the second surface allowed `touch-action: none` |
| 2026-08-22 | **Five bottom-nav slots at 360 dp** — the §9.2 claim, which was arithmetic until now | **72 × 56 dp each**, no label truncated, `nav` 57 px tall including `pb-safe`. Measured with `getBoundingClientRect` on the running app at a 360 × 800 viewport | Chromium, dev server, this machine | Yes — `docs/12-android-app.md` §3.1 now states the measured number and its date |

## Deferred and follow-ups

| From | Item | Where it should land |
| :--- | :--- | :------------------- |
| S0 | **Closed by A10.** Preamble §2.4 and Appendix B item 9 now say six, and add that `backend/**/uploads/` is gitignored so the untracked leftovers need no attention at all — while a stray `backend/alexithymia.db` **does**, because it is untracked *and* un-ignored. | — |
| S0 | **Closed by A10.** Preamble §2.4 now states that `gofmt -l .` can never be empty on this checkout, says not to run `gofmt -w .`, and carries the line-ending-insensitive walk inline — with the addition that `git ls-files` will not see the `.go` files your own session created, so add them to the list. | — |
| S0 | **Closed by A10.** Preamble §2.4 now reads 22 files / 511 tests in ~20 s, which is what this machine does at the 6-A closeout. | — |
| S0 | **Closed by A10.** §12.3 has been rewritten to say docs/13 is an unconfirmed option rather than a matter of *when*, and to spell out the four consequences; the 6-E heading now reads **"conditional, and may never run"** and opens with a block quote saying so. `docs/01` §6 and the new `docs/13` §0 paragraph carry the same position, and neither promises a schedule. | — |
| S0 | **Closed by A10.** The *"Is it encrypted?"* answer now names the journal in the journal's own words, and `Vault.test.jsx` asserts the sentence verbatim. It promises nothing about docs/13. Original note: the Vault page must state that journal content is stored plaintext, in the journal's own words. | — |
| A10 | **`createEntry`'s un-awaited `refresh()` can drop a check-in that was written while it was in flight.** After a write that mints a trigger, `refresh()` is fired and not awaited; if a second check-in is saved and spliced optimistically before that GET resolves, `setEntries(response.data)` replaces the list with one taken before the second POST committed, and the check-in vanishes from the day view until the next range change. The row is on the server — a display inconsistency, not data loss. | **F1**, which rewrites `createEntry` for the outbox and has to solve request ordering anyway. A request-sequence guard on `refresh` is the small fix; awaiting it is the wrong one, and the comment there says why |
| A10 | **`applyJournal` records correction links only for rows it creates in that run.** Import a file holding only correction row B (target A absent): B is created and the link skipped, correctly. Import A later: A is created, B is skipped as already held, and nothing revisits B — its `supersedes_id` stays NULL for good. Reads stay correct because A carries the `superseded_at` its own file declared; what is lost is provenance. Needs hand-split export files to reach. | Not scheduled. Worth doing whenever the import is next opened — the fix is to seed `corrections` from skipped rows whose `supersedes_id` is still null |
| A10 | **Performance findings from `/simplify`, all real and none reachable at today's data volumes.** (a) `summarizeTrigger` re-scans every entry and re-parses every check-in payload **once per trigger** — 40 triggers over 3,000 check-ins is ~120,000 `readCheckin` calls in one synchronous `useMemo`; one pass building a `Map<liveId, …>` replaces it. (b) `loadAll()` replaces rather than widens, so every People↔day↔Triggers navigation re-downloads the whole journal, and `refresh` always fetches `/api/journal/days` even for the two screens that never read it. (c) The import JSON round-trips every check-in payload twice — `validateCheckinPayload` and then `checkinTriggerRefs` decode the same map. (d) `DeleteJournalPerson` materialises every mentioned entry id in Go and sends it back in three statements, which will hit `SQLITE_MAX_VARIABLE_NUMBER` (999 on some builds) for a frequently-named person; a subquery keeps it constant. | **Not scheduled, and deliberately not fixed at closeout** — each needs a change that can measure it. (a) and (b) belong with **B1/B2**, which are the sessions that make the journal's read path hot. (d) belongs wherever the journal first has a user with thousands of entries |
| A10 | **`PickedFeeling` re-implements `FeelingChip`'s markup** (same classes, same `${hex}1f`, same dashed rule) minus the `data-feeling-label` hook — so invariant 4's literal-hex rule is enforced in two places no test compares. `chipClass`, the byte-identical half, was fixed; this half was not, because replacing it changes rendering the QA run had just validated. | Any session that touches the composer's chips. The fix is a shared chip module — not an import from `Journal.jsx`, which would be a cycle |
| A10 | **Three request builders live in components** (`buildCheckinRequest`, `buildRitualRequest`, `buildDayWordRequest`) beside two that live in `journal.js`, and all four hand-write the row envelope with `schema_version: 1` as a **bare literal**. §6.2 explicitly anticipates the row version moving independently of `payload.v`; the day it does, four literals in three files must be found by eye, and the two in components are the ones a grep for the constant will not surface. | **F1** — it rewrites the write path for the outbox, which is the moment one `journalEntryRequest({…})` helper and an exported `SCHEMA_VERSION` pay for themselves |
| A10 | **`App.jsx` repeats `token ? <X/> : <Navigate to="/login"/>` on all ten routes**, six of them added by 6-A. One layout route with an `Outlet` would make the guard structural rather than opt-in, so a route added without it could not render signed-out. | Not scheduled — it is a routing change and wants its own commit |
| S0 | `person_fact` is deferred indefinitely, not by one slice. The `kind` still ships in A1–A4. | A1–A4 build the kind; **D2 must not offer a `person_fact` affordance in the proposal card** |
| A1 | **Closed by A10.** Both documents were wrong, and in both directions: `docs/03` §7 said the file is *"Committed to git"* (it is not tracked at HEAD, last committed at `2e4d71c`) and `docs/11` carried a second entry describing it mid-removal as still tracked and restorable. Both now say what is true — untracked, still **not** in `.gitignore`, so a locally-created one is one `git add .` from being committed with bcrypt hashes in it — and `docs/03` also had "four such files" under `handlers/uploads/` where there are six. | — |
| A2 | A trigger rename or merge is a correction row with a **new** `client_id` that supersedes the old one, so the old id stops being referenceable by a new entry while every check-in already written still points at it. A2 rejects a superseded trigger, per its prompt. **A3 shipped the reader half** — `?kind=trigger` filters `superseded_at IS NULL`, so the vocabulary list is already correct. | **Closed by A5.** The client always references the surviving id (`readTrigger().live`), the server's check is unchanged, and readers resolve old ids through a new `corrects` list on the trigger payload. See the A5 entry and §6.3. |
| A2 | **Closed by A10.** `docs/05-backend.md` §4.2 said "six of the seven protected handlers"; the count is **twenty** as of Phase 6 (the ledger's own "fifteen" was already stale when it was written). The sentence now gives the number and names the five transactional handlers that are the exception to the skeleton. | — |
| A4 | **Closed by A9.** The triggers view offers no delete at all — only rename and merge, both corrections — so no UI path can strand a reference. `DELETE /api/journal/entries/:id` still accepts a trigger id; A10 may decide whether the import should tolerate a file written by something else. Original note: **A soft-deleted trigger that check-ins still reference makes that account's export un-importable.** `DELETE /api/journal/entries/:id` accepts a trigger id, the export then omits the row, and `prepareJournal` refuses the file with `400 … names a trigger this file does not contain`. No UI can do it yet. | **A9** — the triggers view must not offer a plain delete for a trigger any entry references (merge or rename instead), or A10 decides the import should tolerate it |
| A4 | **Closed by A10.** The Vault's "your data" paragraph now counts journal entries beside relationships and snapshots, from `journal_entry_count` and `oldest_journal_day`, naming the kinds so the number reads — and is omitted entirely when the journal is empty rather than rendered as "0 journal entries". | — |
| A6 | **Closed by A9** — `/journal/people/:id` shows a person's facts with their dates, drawn even when empty. Original note: the day view renders `person_fact` rows as a plain card, because a row that renders as nothing would make the day's empty state a lie. The *person's* view of them — facts with their dates — does not exist. | **A9**, `/journal/people/:id` |
| A6 | `createEntry` splices the echoed row into `entries` but does not adjust `days`. `markedDays` covers it by merging both sources, so nothing is wrong on screen; the *counts* in `days` are stale until the next load. If a screen ever renders a count rather than a mark, it must refetch. | **Still open after A7.** A7 added a refetch to `createEntry`, but only for a request that minted a trigger — the case that is *wrong on screen* rather than merely stale. A check-in with no new trigger still leaves `days` behind by one. Nothing renders a count yet; **A9's People and Triggers views are the first that might**, and they must refetch or read from `entries` |
| A6 | **Closed — A8 took the first, A9 the other three.** `App.jsx` imports the real components and `JournalPlaceholder` is gone. Original note: `/journal/ritual`, `/journal/people`, `/journal/people/:id` and `/journal/triggers` render `JOURNAL_COPY.empty.nothingHere` from `Journal.jsx`'s exported `JournalPlaceholder`. | **A8** replaces the first, **A9** the other three — swap the import in `App.jsx`, do not add a route |
| A7 | **Closed by A9** — `PersonForm` takes a `suggestions` prop the dashboard fills with `useSubjects().relationships`, rendered as a `datalist` on the *Identity* field; verified on the running app offering a `snapshot_count: 0` person. Original note: **the dashboard's *New Analysis* name field offers no suggestions at all** — no `datalist`, no autocomplete, nothing. §2.2 asks for a journal-only person to be offered there, and it is not: verified against the running app, where a person created by a check-in and then snapshotted had to be typed out in full. It resolved correctly (one relationship, not two), so this is a discoverability gap and not a data one. | **A9 or A10** — the prompt names both. It is a `PersonForm` change, not a journal one: `useSubjects().relationships` already holds every person including the `snapshot_count: 0` ones |
| A7 | **`POST /api/journal/entries` does not echo the trigger rows it creates.** The client works around it by refetching the range after a request that minted one. Echoing them would remove a round trip and is the better fix. | Not scheduled. Worth doing only if the write path is revisited for another reason — **F1** touches it for the outbox and is the natural place |
| A8 | **`intensity` is now optional on a check-in payload**, because the ritual's day word is one tap with no strength in it and inventing a number would break invariant 15. A `source: "ritual_word"` sample therefore reaches the day graph with `intensity: null`. | **B1** — `buildDayCurve` must decide what an intensity-free sample draws at, as a **stated constant in the ⓘ sentence**, never a silent 2. §6.5 and §8.2 now say so |
| A8 | §10.3 asks `docs/01-concepts.md` §6's *"No notifications sent anywhere"* to gain a sentence about the ritual's local notification. A8 did **not** write it: that notification does not exist yet, and the sentence would be a false claim on the concepts page. | **F2**, with the notification itself |
| A8 | The five §9.7 settings with no feature behind them (voice, suggestions, embeddings, transcripts, language) are described in `JOURNAL_COPY.settings` and rendered nowhere. `Profile.test.jsx` asserts their absence. | **C3** (voice, suggestions, transcripts, language) and **G1** (embeddings) — each renders its toggle in the session that builds the feature, never before |
| A7 | **Partly closed by A9**, which writes correction rows for the trigger vocabulary — the concrete half. A check-in still has only *delete*; a general "correct this check-in" is **D2's or later**, and §7.1 supports the current position. Original note: the composer has **no edit affordance**, deliberately. A correction is a new entry with `supersedes_id` (§7.1, Appendix D) and the provider already drops the row it replaces; nothing in the UI writes one yet. | **A9**, as the prompt allows. The triggers view is already writing correction rows there, so the two land in one place |

| A9 | **A counted sentence must be a `{one, many}` pair carrying its own verb.** The remove dialog first read *“0 facts … go, and 1 entry stop being linked”* — one template, two counts, invisible to a suite that asserts the template's own output. Fixed here; `countCopy(count, templates, values)` is the helper, and `mentionCount` / `entryCount` are pairs now. | A rule for every session, recorded under *Warnings* below |
| A9 | **Closed by A10.** `docs/08-testing.md` §2.2b now carries A2's write-path cases, A3's read cases and the two scoping tests, and §2.2a gained the four relationship↔journal mention tests it had never listed. The file's own headline counts were also wrong in two places (291 in the status table, 506 in the coverage section); both now read 511. | — |
| A9 | **Closed by A10 — written down and left, which was one of the three options.** `DELETE /api/journal/entries/:id` does still accept a trigger id, and **no UI can reach it**: the triggers view offers rename and merge only, both corrections, and the day view deletes check-ins. A trigger deleted out-of-band by `curl` still makes that account's export un-importable (`prepareJournal` refuses a file naming a trigger it does not contain), which is the correct refusal — the alternative, a tolerant import, would silently drop the word a stored feeling was about. Making the endpoint refuse a referenced trigger would need a payload scan per delete to defend against a path nothing takes. Revisit only if a UI ever offers trigger deletion. | — |

## Warnings for later sessions

Things a future session would otherwise rediscover the hard way.

- **`gofmt -l .` lists 15 files on a clean tree, and always will.** Every `.go` file the repo
  tracks is CRLF; `gofmt` normalises to LF, so it reports all of them. Formatting is genuinely
  clean. **Do not run `gofmt -w .`** — it rewrites 15 files end to end and buries your real
  diff. Use this instead, which ignores line endings and printed empty on 2026-08-22:

  ```bash
  for f in $(git ls-files '*.go'); do diff -q <(gofmt < "$f" | tr -d '\r') <(tr -d '\r' < "$f") >/dev/null || echo "$f"; done
  ```

- **Six tracked files, not four,** live in `backend/internal/handlers/uploads/`. It does not
  matter much: `backend/**/uploads/` is in `.gitignore`, so the ~20 untracked leftovers
  `go test` drops there never show in `git status` and cannot be committed by accident. Do not
  delete the six tracked ones.
- **Line endings are split per *file*, not per file type — and A1's summary of this was
  wrong.** It is **not** true that every tracked `.go` file is CRLF. The split tracks roughly
  when a file was added: `relationships.go` and `relationships_test.go` (Phase 4) are **LF**,
  while `subjects.go`, `vault.go`, `vault_test.go`, `models.go`, `database.go` and `main.go`
  are **CRLF**. Every tracked `.md` file under `docs/` and `product_vision/` is LF.
  **Check the file you are about to edit against what git actually stores**, rather than
  trusting a rule:

  ```bash
  git show HEAD:backend/internal/handlers/subjects.go | od -c | head -1
  ```

  Two consequences A3 hit. **`gofmt -w` rewrites a CRLF file to LF end to end** — running it
  on one of the older files *is* the whole-file-churn mistake Appendix B item 8 warns about,
  so use the walk above and hand-fix instead. And an editor that normalises on save leaves a
  CRLF file needing conversion back. Match the convention of the file you are editing, and
  check `git diff --stat`
  afterwards — a file you barely touched showing hundreds of changed lines means you flipped
  its endings. Note that `grep -c $'$'` lies about this in Git Bash; use `od -c` or Python
  to check for real.
- **Nothing in this shell reports line endings correctly except a byte-level read.** A3's
  warning above is right that the split is per file; what it does not say is that the *tools*
  lie. `grep -c $'\r'` reported every file as CRLF, `awk '/\r$/'` reported the same files as
  LF, and both were wrong — Git Bash strips CR in text mode. `od -c | grep '\\r'` only works
  with **`grep -F`**, because a bare `\\r` pattern silently matches nothing. The only check
  that told the truth on 2026-08-22 reads the file as bytes:

  ```python
  # eol.py — python eol.py <paths…>
  import sys
  for path in sys.argv[1:]:
      data = open(path, 'rb').read()
      crlf = data.count(b'\r\n')
      print('%s CRLF=%d bare-LF=%d' % (path, crlf, data.count(b'\n') - crlf))
  ```

  And **the Edit tool normalises a whole file's line endings** rather than only the lines it
  touches: one edit turned the (CRLF) `src/constants/journal.js` entirely LF, and a later edit
  turned it back. Check with the script above after editing, not with `git diff --stat` alone —
  on an **untracked** file `git diff` shows nothing at all, so a flipped file is invisible
  until the day it is added.
- **`python -c` does not work in this shell.** `python` is a pyenv **shim** — a batch wrapper
  that re-parses its arguments through `cmd`, so anything with a `|`, a `<`, a `>` or a
  newline inside the program text is mangled and the failure looks like
  `'journal' is not recognized as an internal or external command`. A4 lost a run of its
  manual script to this. Write the program to a `.py` file and call it; SQLite has no other
  client on this machine, so any session inspecting a database will hit this.
- **`docs/13` is design only.** No `encryption_status`, no Argon2, no `/api/auth/params`, no
  `wrapped_dek` exists anywhere in `backend/` or `src/`. The local `feature/encryption` branch
  is an ancestor of `main` and carries no encryption code — the name is a leftover.
- **Encryption is not coming, unless it is re-confirmed.** Do not design around a future
  envelope, do not add "TODO: encrypt this" seams beyond the row shape §6.2 already specifies,
  and do not write a Vault sentence that promises encryption later. If a session finds itself
  needing docs/13 to make a claim true, the claim is wrong, not the schedule.
- **A Vitest test cannot locate a file with `import.meta.url`.** Vite rewrites it to a module
  URL that is not a `file:` URL, so `fileURLToPath` throws *"The URL must be of scheme file"*.
  Read from `resolve(process.cwd(), '<repo-relative path>')` instead — Vitest runs with the
  project root as its cwd. A5's id-parity test does this to read `domain/journal.go`, and any
  later test that asserts against a source file (a golden suite, a constant shared with Go)
  will hit the same wall.
- **`process.env.TZ` is mutable in this Node on Windows** and takes effect on the next `Date`
  call, which is how A5 tests DST wherever the suite runs. Restore it in `afterAll`, and when
  it was originally unset **delete it** — assigning `undefined` sets the *string* "undefined"
  and leaves the process in a zone that does not exist. Pair it with a guard case asserting
  the offset really changes across the boundary, or a DST test in a zone without DST passes
  while asserting nothing.
- **The Playwright E2E suite cannot pass** (`docs/11-known-issues.md` §"The E2E suite cannot
  pass"). Never use it for sign-off; the manual QA checklists in each prompt are the sign-off.
- **There is no `backend/alexithymia.db` in the tree, and there is no dev database to migrate
  against.** `docs/03-data-model.md` §7 and `docs/11-known-issues.md` both say the SQLite file is
  committed to git; it is not tracked at HEAD. The consequence for any schema session: running
  `make migrate-check-local` with no file there **creates an empty one** and reports every table
  missing, which proves nothing about migrating real data. Build a Phase-5 database first — check
  out the models as they stood *before* your change, `cd backend && go run ./cmd/migrate`, insert a
  user, two relationships and three snapshots with any SQLite client, and only then add your
  models. A1 did exactly that, recorded both `migrate-check-local` outputs, and **deleted the file
  again** so the working tree stayed as it was found: it is untracked *and* un-ignored, so leaving
  it turns up as noise in `git status` and is one `git add .` away from committing seeded data.
- **The `POST` response tells you less than you think.** It echoes the entry and its
  mentions with ids resolved — and **not** the `kind: "trigger"` rows created in the same
  transaction. A7 found this against a running server, after the unit tests were green:
  every composer test passed while the second check-in of a real session was one tap away
  from minting a second *work*. **Any client-side vocabulary that the server creates as a
  side effect has to be refetched, not inferred**, and a test that mocks the POST cannot
  find that on its own — only driving the real stack did.
- **`process.env.TZ` is the difference between an assertion and a decoration.** A7's
  composer tests pin `Europe/Berlin` for the whole file, because `tz_offset_min: 120` and the
  `+02:00` on `at` would otherwise be true of whatever zone the runner sits in, and a sign
  error in `tzOffsetMinutes` passes on a machine at UTC. Pair the pin with a guard case
  asserting `getTimezoneOffset()` really moved — see A5's warning above for the
  delete-when-unset rule in `afterAll`.
- **A composer test should assert on the request body, not on component state.** The §7.2
  shape is a contract with a Go validator: `feelings[i].about[j].ref` must index the
  `mentions` array, every `about` of kind `trigger` must name a `client_id` listed in
  `triggers[]`, and **every feeling needs an `intensity`**. All three are invisible to a test
  that checks what the component thinks it holds. `CheckinComposer.test.jsx` has one
  `toEqual` against a literal request object for exactly this reason.
- **`Dashboard.test.jsx` → "only swallows the wheel while there is a version left to scrub to" is
  flaky.** It failed once and passed on the two runs after it, with no frontend file changed
  between them; it dispatches synthetic `WheelEvent`s inside a `waitFor`, which is timing-sensitive
  under load. A single red on that test is not a signal — re-run before you go looking. If it turns
  chronic, it is B1/B2 territory (the scrub geometry), not the journal's.
- **sqlmock renders GORM's SQL in two shapes that are easy to guess wrong.** A multi-clause
  `Where` comes out parenthesised and carries the soft-delete scope and a bound `LIMIT`:
  `SELECT * FROM "journal_entries" WHERE (user_id = $1 AND client_id = $2) AND
  "journal_entries"."deleted_at" IS NULL LIMIT $3`. An association insert is an **upsert**:
  `INSERT INTO "journal_mentions" (…) VALUES (…) ON CONFLICT ("id") DO UPDATE SET
  "entry_id"="excluded"."entry_id" RETURNING "id"`. And `WithArgs` on a `uint` does not
  match — which is why `subjects_test.go` omits it on every `SELECT`. When an expectation will
  not match, set `database.DB.Logger = logger.Default.LogMode(logger.Info)` for that one test
  and read the actual statement out of the log rather than guessing again.
- **A drag cannot be driven through the browser pane, and does not need to be.**
  `left_click_drag` times out — the pane will not composite the frames (A7 hit the same wall
  from the other side). Dispatching `PointerEvent`s at the element runs the *same* handlers,
  the same threshold and the same tilt, so nothing is being faked but the input device:

  ```js
  const ev = (t, dx, dy) => card.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: x0 + dx, clientY: y0 + dy }));
  ev('pointerdown', 0, 0);
  for (let i = 1; i <= 6; i++) ev('pointermove', dx * i / 6, dy * i / 6);
  ev('pointerup', dx, dy);
  ```

  In jsdom `fireEvent.pointerDown/Move/Up` works identically, which `VaultKnob.test.jsx`
  already relied on. Two things a gesture component should export so the test is not entirely
  DOM-shaped: the **intent function** (`gestureIntent(dx, dy, threshold)`), because the case
  that matters most is a *tap* and a tap is what a synthetic drag is least likely to get
  right; and a **pixel floor under any percentage threshold**, because an unmeasured layout
  reports a width of zero and 30 % of zero commits on the first pixel of every tap — in jsdom
  that makes every gesture test pass while asserting nothing.
- **A React handler that computes its next value from the render's copy loses one of two
  events fired in the same task.** A8's optional-question chips did exactly this: two
  `.click()`s inside one synchronous block both read the same list and the first choice was
  overwritten. A thumb cannot produce it and a script can, which is why eleven green tests
  missed it and driving the real app found it in one call. Read through a **ref** when the
  handler must also write the value somewhere (storage, the network); the functional updater
  is the other answer, but only where nothing but state changes — a `localStorage` write
  inside an updater is a side effect React may run twice. And note the shape of the trap: it
  is invisible to `userEvent`, which awaits between clicks.
- **A copy template that ends before its verb cannot agree with its own number.** A9's
  remove dialog read *“0 facts kept about Lucie M go, and 1 entry stop being linked”* on a
  running screen while its own tests were green — because they asserted `fillCopy` of the
  same template. **Make every counted sentence a `{one, many}` pair that carries its verb**,
  fill it with `countCopy(count, templates, values)`, and leave out a clause whose count is
  zero rather than saying “0 …”. Both halves live in `JOURNAL_COPY`, so the walk asserts the
  *paths* as well as the strings.
- **A fixture that derives a row id from a client id will collide.** A9's trigger fixtures
  both computed `ID: 1`, and a merge then looked like it removed *both* rows — `createEntry`
  drops `row.ID === created.supersedes_id`. Row ids are the server's; give each fixture a
  distinct one from a counter reset in `beforeEach`.
- **The copy rail can match a filled template by shape.** Turn every `JOURNAL_COPY` string
  containing `{x}` into a regex with `.+` in its place, and the walk accepts *“17 entries name
  this.”* while still failing a sentence nobody wrote. Strictly better than listing each
  filling a test happens to produce, which is what A8's note below recommends.
- **A test that walks `JOURNAL_COPY` proves less than one that walks the screen.** A8's copy
  rail queries every **text node the component rendered** and asserts each is in
  `JOURNAL_COPY`, a question text, a feeling label, a person's name or an arrow glyph, with a
  planted sentence proving the filter looks and a `wordsOnScreen().length > n` guard proving
  the screen was not empty. It catches a bare string in a branch the module walk cannot see,
  which is every branch. One caveat: a `fillCopy` result must be listed explicitly, because
  the walk over the *template* cannot match the *filled* string — which is the cost of A5's
  decision to use templates rather than functions, and worth it.
- **Driving the app for manual QA: clicks through the browser pane time out, JS `.click()` does
  not.** A10 ran all ten QA items this way. `computer{action:"left_click"}` fails with *"The
  Browser pane is currently hidden"* after 30 s; `javascript_tool` running
  `element.click()` invokes the same React handler and returns instantly. For a **controlled
  input**, set it through the native setter or React ignores the value:
  `Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el, v)`
  then `el.dispatchEvent(new Event('input',{bubbles:true}))`. Gestures need `PointerEvent`s —
  see the drag warning above. And **an entire QA flow can run as one async IIFE**: the tool
  awaits a returned promise, so a whole ritual (swipe, wait, read the next step, swipe…) is one
  call with its own wall-clock timing, which is how the 17.2 s figure was measured. Doing it in
  separate calls measures the harness instead.
- **A comment claiming an optimisation is a claim, and this repo treats it as one.** Two
  comments said the trigger index was hoisted out of the loop — *"Bound once here, it stays
  one pass"* — and it was not: `readTrigger(id, array)` rebuilds the index on every call, so
  hoisting the `useCallback` only stopped the arrow function being re-created. Nothing was
  visibly wrong, and both comments would have been believed by the next reader deciding
  whether the path was already fast. **If you write down that something is one pass, make the
  test or the type say so** — `readTrigger` now takes a `Map` *or* the rows, and a test asserts
  the two answer identically, so the fast path is the one that is covered.
- **The reviewer that finds the bug is not always the one looking for bugs.** `/code-review
  high` found one confirmed defect in 6-A; the *altitude* pass of `/simplify` found another —
  `DeleteJournalPerson` counting superseded rows — because it was asking "is this rule
  enforced at one depth or six?" rather than "is this line wrong". Both passes are worth
  running, and the quality pass is worth reading for correctness even though it is told not to
  look for it.
- **A number a dialog states before acting must be counted over the same set the screen showed.**
  Three separate places got this wrong in one slice: `DeleteRelationship`, `DeleteJournalPerson`,
  and the delete dialog that stated no journal number at all. The rule: the *action* may touch
  soft-deleted and superseded rows — they are still the user's statements and still in the
  export — but the *count* covers only what `GET /api/journal/entries` returns, because that is
  where the sentence's number came from. Scope them together or they drift apart.
- **A first fix can be a second bug.** `mention_count` was added by joining `journal_mentions`
  onto `summaryQuery` — correct, `DISTINCT`-guarded, and quadratic on the one query every
  screen issues. Pre-aggregate in a subquery when adding a count to a query that already has a
  join; then the counts need no `DISTINCT` at all. A test pins `snapshot_count` against the
  fan-out, because the symptom is a number quietly becoming a product rather than an error.
- **A GORM composite index needs the tag on *every* column in it.** `priority:2` alone silently
  yields a single-column index: the field with `priority:1` is what makes it composite, and
  `Migrator().HasIndex(model, name)` returns true either way. Assert the *columns* — A1 added
  `assertIndexColumns`, which reads `GetIndexes` and checks names, order and uniqueness. Any future
  composite index should use it.

---

### Session entry template

**<ID> — <title>** · <date> · commit `<sha>`

- **Shipped:** one or two sentences, plus the files that matter.
- **Verified:** the commands run and their results, including any manual QA.
- **Measured:** anything that resolved a `(verify)`.
- **Deferred:** what was in scope and did not happen, and why.
- **Next session should know:** the one or two things that would otherwise be rediscovered.

---

**S0 — Baseline, ledger, and the two ordering decisions** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** this file, and one appended sentence at the top of
  `product_vision/06-emotional-journal.md` pointing at the execution plan and this ledger. No
  code, no schema, no constants — by design.
- **Verified:** `npm test` 14/201 green (24.9 s); `go test ./...` green; `go vet ./...` clean;
  `gofmt` clean modulo CRLF; `npx vite build` success, 813.17 kB / 250.38 kB gzip main chunk;
  `git status` clean; `npm run lint` still broken on the `eslint-plugin-react-hooks` load error.
- **Measured:** the pre-journal bundle size, as the yardstick for C3 and D3.
- **Deferred:** nothing in scope. `product_vision/eval/` deliberately not created — U1 and D4
  own it.
- **Decided:** both ordering questions, above. The headline: **zero-knowledge encryption is
  unconfirmed**, so 6-A ships plaintext, E1 is conditional and may never run, and `person_fact`
  is deferred indefinitely while its `kind` still ships in A1–A4.
- **Next session should know:** read the *Warnings* section above before you run `gofmt` — it
  reports 15 files on a clean tree and always will. A1 starts from a green baseline with no
  encryption code in the tree, and must still build the docs/13-compatible row shape from §6.2
  even though docs/13 is not on the roadmap.

---

**A1 — Backend: models, ids, migration** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal's two tables and the server's id vocabularies, with nothing able to
  write to them. `models.JournalEntry` and `models.JournalMention` in
  [`models.go`](../backend/internal/models/models.go) as §6.2 specifies; a new
  [`domain/journal.go`](../backend/internal/domain/journal.go) holding `FeelingIDs` (21),
  `RitualQuestionIDs` (5 core + 8 optional) and `JournalKinds` (4) with `IsFeelingID`,
  `IsRitualQuestionID` and `IsJournalKind` — ids only, no labels, no colours; both models added
  to `database.Models()` in dependency order. Tests: `TestAutoMigrateAddsJournalTables`,
  `TestJournalEntryPayloadRoundTrip`, `TestJournalEntryClientIDIsUniquePerUser` and
  `TestJournalMentionBelongsToItsEntry` in `database_test.go`, plus the `domain` package's first
  test file. Docs: `docs/03-data-model.md` gains both entities (ER diagram, struct, prose) and an
  updated §5; `docs/10-agent-guide.md` invariant 3 now names feeling and ritual-question ids as
  the third and fourth permanent id vocabulary. **No handlers, no routes, no validation helpers,
  no frontend file** — as the scope fence says.
- **One correction to the design document,** made in the same change: §6.2's code block declared
  `uniqueIndex:idx_journal_user_client,priority:2` on `ClientID` and
  `index:idx_journal_user_day,priority:2` on `Day`, but left `UserID` out of both. A `priority:2`
  with no `priority:1` beside it builds a unique index on `client_id` **alone** — which would
  reserve every client id across every user, and would still pass a `HasIndex` check. `UserID`
  now carries `priority:1` in both, §6.2 is corrected, and
  `TestJournalEntryClientIDIsUniquePerUser` asserts the behaviour rather than the tag.
- **Verified:**
  - `go vet ./...` clean. `go test ./...` green — `database` 0.9 s, `domain` 0.3 s, `handlers`
    10.4 s, `auth` cached.
  - `gofmt`: the raw `gofmt -l .` lists 17 files (15 at baseline + the two new ones) and always
    will; the line-ending-insensitive walk in *Warnings* printed **empty**.
  - `npm test` 201 passed / 14 files on two consecutive runs. The **first** run failed one test —
    see *Warnings*; it is a pre-existing flake in a file this session never touched.
  - `npx vite build` success in 6.1 s. Main chunk **813.17 kB raw / 250.38 kB gzip** — byte for
    byte the S0 baseline, which is the expected result for a backend-only slice and the sanity
    check that nothing leaked into the bundle.
  - `make migrate-check-local` against a SQLite database carrying Phase-5 rows (1 user, 2
    relationships, 3 snapshots), **before** the migration:

    ```
    migrate: schema is behind the models:
      missing table "journal_entries"
      missing table "journal_mentions"
    run 'make migrate' to apply
    exit status 1
    ```

    then `make migrate-local` → `backfill: 0 relationships, 0 snapshots linked` / `migrate: done`,
    and `make migrate-check-local` **after**:

    ```
    migrate: schema is up to date
    ```

    The built schema was then read back out of the file: both tables, every column with the
    declared defaults (`client_id ''`, `kind 'checkin'`, `day ''`, `schema_version 1`, `label ''`,
    `ref 0`), ten indexes including `CREATE UNIQUE INDEX idx_journal_user_client ON
    journal_entries(user_id, client_id)` and the `fk_journal_entries_mentions` foreign key. All
    six Phase-5 rows survived untouched.
- **Measured:** nothing that resolves a `(verify)`. The bundle is unchanged from baseline, which
  is worth having on the record before C3 and D3 argue about kilobytes.
- **Deferred:** nothing in scope. `person_fact` ships as an id in `domain.JournalKinds` with no
  writer, exactly as S0 decided. Not committed — the prompt does not ask for one.
- **Next session should know:**
  - **A2 gets a real constraint to translate.** A duplicate `(user_id, client_id)` surfaces from
    the driver as `constraint failed: UNIQUE constraint failed: journal_entries.user_id,
    journal_entries.client_id (2067)`. That is the idempotent-retry case, and it is a `409` (or a
    replay of the existing row), never a `500`.
  - **A payload's numbers come back as `float64`.** JSON has one number type, so an `int` written
    into `Payload` reads back as a float and a naïve `DeepEqual` fails on the type rather than the
    value. The round-trip test writes `float64` throughout and says why.
  - **`Mentions` is a real association with a real foreign key**, so SQLite will not let anyone
    drop `journal_mentions.entry_id` — trap 10b now has a second instance. Migration tests drop
    whole tables.
  - There is **no dev SQLite database in the tree**; see *Warnings* for the 30-second recipe to
    rebuild the Phase-5 one this session measured against.

---

**A2 — Backend: `POST /api/journal/entries`** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal's whole write path, in one transaction.
  [`handlers/journal.go`](../backend/internal/handlers/journal.go) holds
  `CreateJournalEntryInput` (plus `JournalMentionInput` and `JournalTriggerInput`) with the
  §7.2 shape exactly, the eight validators §6.5 names — `validateJournalKind`, `validateDay`,
  `validateCheckinPayload`, `validateRitualPayload`, `validatePersonFactPayload`,
  `validateTriggerPayload`, `validateMentions`, `validateTriggerRefs` — and
  `CreateJournalEntry`, whose transaction runs the six steps in the prescribed order:
  idempotency lookup, correction, triggers, mentions, insert, echo. One route inside the
  `protected` group. Tests: `journal_test.go`, **24 test functions and 30 validation
  subtests**, real SQLite where the transaction matters and sqlmock where the statement
  shape does. Docs: `docs/04-api-reference.md` gains a `## 5a. Journal endpoints` section
  with the full field and status tables plus a row in §1; `docs/05-backend.md` gains
  `### 4.4b journal.go` and names `journal.go`, `journal_test.go` and A1's
  `domain/journal.go` in its package layout. **No `GET`, no `DELETE`, no `/api/journal/days`,
  no export change, no merge/delete integration, no frontend, and no `PUT`** — as the scope
  fence says.
- **Three judgement calls, made and documented rather than asked about:**
  1. **The ±36 h `day` window is anchored on the day's *midpoint*, not its midnight.** A day
     is an interval and `at` is an instant, so the window needs an anchor, and the obvious one
     is wrong: measured from midnight, a legitimate 03:59 rollover check-in at UTC−9 lands
     **37 h** out and is rejected, as does anything past 12:00 UTC on the following day for
     every offset west of UTC−8. Measured from noon, every rollover-hour-plus-time-zone
     combination fits with hours to spare — the widest legitimate case is 28 h — and a `day`
     three days from `at` still fails at 60 h. `TestValidateDayAnchorsOnTheDaysMidpoint` pins
     both extremes (UTC−9 rollover, UTC+14 just-past-midnight) and the mistake.
  2. **`superseded_at` is stamped with the correcting entry's own `at`,** not the wall clock,
     so `old.superseded_at == new.at` holds in an export and the pair reads as one event.
  3. **A duplicate `client_id` held by a *soft-deleted* entry is `409`, not `200`.** §6.2 says
     a retried POST after a delete "should 409, not resurrect", and that falls out for free:
     the idempotency lookup runs under GORM's default scope and cannot see the deleted row, so
     the insert hits the unique index and `isDuplicateClientID` translates it. A live
     duplicate is still `200` with the stored row, which is what F1's outbox needs.
- **Verified:**
  - `go vet ./...` clean. `go test ./...` green — handlers 10.5 s, `auth` / `database` /
    `domain` cached.
  - `gofmt`: the line-ending-insensitive walk in *Warnings* (extended to cover the two
    untracked new files) printed **empty**.
  - `npm test` **14 files / 201 tests green**, 27.1 s. `npx vite build` success in 7.7 s, main
    chunk **813.17 kB raw / 250.38 kB gzip** — byte for byte the S0 baseline, as a
    backend-only slice should be.
  - **Manual round trip**, against `go run ./cmd/server` on a throwaway SQLite database. A
    check-in naming a person who did not exist, posted twice with the same `client_id`:

    ```
    === FIRST POST ===  HTTP 201
    {"ID":1,"CreatedAt":"2026-08-22T15:43:49.9231386+02:00", … ,"user_id":1,
     "client_id":"6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1","kind":"checkin","day":"2026-08-21",
     "at":"2026-08-21T16:42:10Z","schema_version":1,
     "payload":{"feelings":[{"about":[{"kind":"person","ref":0}],"id":"pleasure","intensity":2,
       "uncertain":false},{"about":[{"kind":"person","ref":0}],"id":"rapport","intensity":3,
       "uncertain":false}],"source":"typed","tags":[],"transcript":"I had a nice day with Lucie
       today and felt very connected to her.","tz_offset_min":120,"v":1},
     "superseded_at":null,"supersedes_id":null,
     "mentions":[{"ID":1,"entry_id":1,"relationship_id":1,"label":"Lucie","ref":0}]}

    === SECOND POST (same client_id) ===  HTTP 200
    { …byte-for-byte the same row, same ID 1, same mention ID 1… }
    ```

    and the database afterwards: `relationships 1 · journal_entries 1 · journal_mentions 1 ·
    analysis_subjects 0`, with `GET /api/relationships` returning the single stack
    `{"ID":1,"name":"Lucie","snapshot_count":0}` — the person exists, created by the journal,
    with no snapshot invented for her. Note `at` went in as `+02:00` and came back `Z`. The
    throwaway `backend/alexithymia.db` was **deleted afterwards** and the four untracked
    leftovers `go test` drops in `internal/handlers/uploads/` were removed; the six tracked
    ones stay.
- **Measured:** nothing that resolves a `(verify)`. The bundle is unchanged from baseline.
- **Deferred:** nothing in scope. `person_fact` now has a server writer and still has no UI,
  exactly as S0 decided. Not committed — the prompt does not ask for one.
- **Next session should know:**
  - **A3 inherits a real problem with trigger corrections.** A referenced trigger must be
    *live*, which A2 implements as neither soft-deleted nor superseded (`superseded_at IS
    NULL`) — the prompt's own wording. But a rename or a merge is a **correction row with a
    new `client_id`** (client ids are unique per user, so a correction cannot reuse the old
    one), which supersedes the old row. So **after a rename, the old trigger's `client_id`
    stops being referenceable by a new entry**, while every check-in already written still
    points at it. §6.3 says `readTrigger` resolves the old id to the new one for readers;
    nothing yet says what the *writer* should accept. A3/A5 has to decide: resolve the chain
    on write, or have the client always reference the surviving id. **Do not "fix" this by
    quietly accepting superseded triggers** — that would let a merged-away trigger keep
    collecting entries.
  - **The sqlmock statement shapes, so the next handler test does not rediscover them.**
    GORM parenthesises a multi-clause `Where`: `SELECT * FROM "journal_entries" WHERE
    (user_id = $1 AND client_id = $2) AND "journal_entries"."deleted_at" IS NULL LIMIT $3`.
    And an association insert is an upsert: `INSERT INTO "journal_mentions"
    ("entry_id","relationship_id","label","ref") VALUES ($1,$2,$3,$4) ON CONFLICT ("id") DO
    UPDATE SET "entry_id"="excluded"."entry_id" RETURNING "id"`. Arg matching on `uint` values
    does not work through sqlmock; `subjects_test.go` avoids `WithArgs` on its `SELECT`s for
    the same reason.
  - **`schema_version` other than 1 is rejected**, not stored. The server can only validate
    what it knows, and a row nothing has ever checked is worse than a `400`. A2 defaults an
    absent or zero `schema_version` to 1.
  - **Signup takes `email`, not `username`** — worth knowing before the next manual round
    trip; the first attempt here wasted a call on it.
  - **Numbering in error messages is zero-based** (`mention 0`, `triggers[0]`), matching how
    `about.ref` addresses the same rows. §7.2's example `mention 1 needs relationship_id or
    name` is produced by a request whose *second* mention is empty, and there is a test for
    exactly that string.
  - **`docs/05-backend.md` §4.2 still says "six of the seven protected handlers".** There are
    now fifteen. The sentence predates Phase 4 and A2 did not touch it; it belongs to A10's
    doc pass with the other stale counts.

---

**A3 — Backend: read, delete, days, and the relationship seams** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal is now readable, deletable, countable, and impossible to strand.
  Three handlers added to [`handlers/journal.go`](../backend/internal/handlers/journal.go) —
  `GetJournalEntries` (`from`/`to`/`kind`/`relationship_id`, mentions preloaded, ordered
  `day, at, id`, `superseded_at IS NULL` always), `DeleteJournalEntry` (soft, owner-scoped,
  `RowsAffected == 0` → `404`, exactly as `DeleteSubject`), and `GetJournalDays` (one grouped
  query returning `day`/`checkins`/`ritual`/`people`) — plus `parseJournalRange` and
  `parseDayString`, the latter extracted from A2's `validateDay` so the write path and the
  read range cannot drift on what "strictly YYYY-MM-DD" means. Three routes inside the
  `protected` group. `MergeRelationship` now moves journal mentions in its existing
  transaction and answers with `mentions_moved` (a new `MergeRelationshipResponse` embedding
  the summary, so the shape every other relationship endpoint returns is unchanged);
  `DeleteRelationship` counts them, leaves them alone, and answers with `mentions_detached`;
  `GetMeta` gains `journal_entry_count` and `oldest_journal_day`. Tests: **12 new functions**
  — nine in `journal_test.go`, three in `relationships_test.go`, two in `vault_test.go` (23
  total across the three files) — all against real SQLite. Docs: `docs/04-api-reference.md`
  now documents all four journal endpoints and all three changed ones;
  `docs/03-data-model.md` gains a table under `JournalMention` stating what rename, merge,
  relationship-delete and entry-delete each do to a mention; `docs/05-backend.md` §4.4b covers
  the reads and §4.4a the merge change.
- **Three judgement calls, made and documented:**
  1. **`checkins` counts `kind: "checkin"` only** — a ritual is not a check-in. And `ritual`
     is a **bool**, not a count: the question a month view asks is whether it happened, and a
     number would invite a reader to draw "how many", which is the scoreboard this app does
     not keep (invariant 2c).
  2. **`journal_entry_count` includes superseded rows** but not soft-deleted ones. A
     correction does not remove the statement it replaces, the export carries both, and the
     Vault's question is "how much of my data is here", not "how many entries are current".
  3. **The default `to` is the server's UTC day.** `day` is a civil day the *client* chose,
     so the server has no better guess. A caller east of UTC could miss today's entries from
     the default window — which no screen will hit, because every screen passes both ends.
     Documented in the API reference rather than papered over with a fudge factor.
- **One fan-out trap found and closed before it shipped.** `GetJournalDays` joins mentions to
  count people, and that join makes an entry appear once per person it names — a plain
  `COUNT(*)` would report an entry naming two people as **two check-ins**. The per-kind counts
  are `COUNT(DISTINCT CASE WHEN kind = ? THEN id END)`, which is portable to both engines and
  immune to the duplication. `TestGetJournalDays` is built specifically around a day whose
  three mentions belong to two entries and name two people, so the wrong query fails it.
  `GetJournalEntries` avoids the same trap differently, by filtering `relationship_id` through
  a subquery rather than a join.
- **Verified:**
  - `go vet ./...` clean. `go test ./...` green — handlers 10.5 s.
  - `gofmt`: the line-ending-insensitive walk over tracked *and* untracked `.go` files printed
    **empty**.
  - `npm test` **14 files / 201 tests green**. `npx vite build` success, main chunk
    **813.17 kB raw / 250.38 kB gzip** — the S0 baseline again, as a backend-only slice should
    be.
  - **Manual round trip**, against `go run ./cmd/server` on a throwaway database. Three
    check-ins naming a new person `Lucie` (relationship 1), a separate `Lucie M`
    (relationship 2), then the merge:

    ```
    POST /api/relationships/2/merge  {"source_id":1}     HTTP 200
    {"ID":2,"name":"Lucie M","cadence_days":null,"snapshot_count":1,
     "latest_date":null,"mentions_moved":3}

    GET /api/journal/entries?from=2026-08-01&to=2026-08-31&relationship_id=2
      entry 3  day 2026-08-19  -> relationship_id 2  label 'Lucie'
      entry 1  day 2026-08-21  -> relationship_id 2  label 'Lucie'
      entry 2  day 2026-08-22  -> relationship_id 2  label 'Lucie'
    GET …?relationship_id=1   (the retired stack)      0 entries
    ```

    then the delete:

    ```
    DELETE /api/relationships/2                          HTTP 200
    {"mentions_detached":3,"message":"Relationship deleted","snapshots_deleted":1}

    GET /api/journal/entries?from=2026-08-01&to=2026-08-31
      all three entries still returned, labels still 'Lucie'
    GET /api/relationships                               []
    GET /api/meta   {"journal_entry_count":3,"oldest_journal_day":"2026-08-19", …}
    ```

    `GET /api/journal/days` over the same range returned
    `[{"day":"2026-08-19","checkins":1,"ritual":false,"people":1}, …]` — note the entries come
    back ordered by `day`, not by insertion. The throwaway `backend/alexithymia.db` was
    deleted afterwards and the untracked `uploads/` leftovers removed.
- **Measured:** nothing that resolves a `(verify)`.
- **Deferred:** nothing in scope. No `PUT`, no triggers endpoint, no export change (A4), no
  frontend.
- **Next session should know:**
  - **The ledger's line-ending warning was wrong, and it cost time.** It says "every tracked
    `.go` file is CRLF". It is not: the split is **per file**, and it tracks roughly when the
    file was added. `relationships.go` and `relationships_test.go` are **LF** at HEAD; the
    older `subjects.go`, `vault.go`, `models.go`, `database.go` and `main.go` are CRLF. The
    *Warnings* section has been corrected. Do not convert a file wholesale in either
    direction — check what git actually stores first:

    ```bash
    git show HEAD:<path> | head -c 200 | od -c | grep -c '\\r'
    ```

    and note that `gofmt -w` **rewrites a CRLF file to LF**, so running it on one of the older
    files is itself the whole-file-churn mistake Appendix B item 8 is about. `gofmt -l` on a
    CRLF file always reports it; the walk in *Warnings* is the only reliable check.
  - **A2's trigger-correction question is still open, and A3 did not need to answer it.** A3
    adds no writer, and the reader half now works correctly on its own: `?kind=trigger` filters
    `superseded_at IS NULL`, so a renamed trigger's old row drops out of the vocabulary list
    and the correction appears in its place. What is still undecided is what the *writer*
    should accept when a check-in references a renamed trigger's old `client_id` — the
    follow-up row now points at **A5**.
  - **`GET /api/journal/entries` returns an entry once, however many people it names.** The
    `relationship_id` filter is a subquery, not a join, and there is a test asserting the
    two-person entry comes back with both mentions and no duplicate row. If a later session
    rewrites it as a join for performance, that test is the one that will catch the
    regression.
  - **`aggregateTime` is not needed for anything the journal aggregates.** `MIN(day)` and
    `MAX(day)` are strings on both engines because `day` is a `varchar(10)`. A4's export and
    any later day-range aggregate can scan straight into a `*string`. The moment someone
    aggregates over `at` instead, trap 10a is back.

---

**A4 — Backend: export/import v2** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the vault now carries the journal, exactly. `exportVersion` is **2** and
  [`vault.go`](../backend/internal/handlers/vault.go) gains `ExportJournal`,
  `ExportJournalEntry` and `ExportJournalMention` plus `exportJournal` on the way out;
  `preparedDocument`, `preparedJournalEntry`, `prepareJournal`, `checkinTriggerRefs`,
  `applyJournal` and `findOrCreateForImport` on the way in; and two new counters,
  `journal_entries_created` / `journal_entries_skipped`. `prepareImport` now returns both
  halves of the document, and `prepareRelationships` is the old body under its own name.
  On the frontend, `buildJournalCSV` in [`Vault.jsx`](../src/components/Vault.jsx) writes
  the second sheet and `exportCSV` downloads both. Tests: **7 new functions in
  `vault_test.go`** (592 lines, real SQLite) and **4 new `buildJournalCSV` cases** in
  `Vault.test.jsx`. Docs: `docs/04-api-reference.md` documents the v2 document, the six
  journal import rules and the two CSV files; `docs/05-backend.md` §4.5a gains a "journal
  half, version 2" subsection; `docs/01-concepts.md`, `docs/06-frontend.md`,
  `docs/08-testing.md` and `docs/README.md` are brought into step; §6.7 of the design
  document gains the correction link and the ordering answer it did not spell out.
- **Five judgement calls, made and documented rather than asked about:**
  1. **The version check reads a range, 1 to 2.** A version 1 file predates the journal and
     needs no translation, so refusing it would throw away a file for nothing. The other
     half of the rule is new: a file that *says* version 1 and carries a `journal` block is
     `400`, because importing the block would contradict the version it declares and
     dropping it silently is the description-wipe mistake in a new form (invariant 13).
  2. **Import is order-independent, and that is the answer to the prompt's question.** A
     check-in points at a trigger by client id *inside its opaque payload*, so there is no
     database link that needs the trigger row written first — importing in file order,
     reverse order or any other produces the same rows. The one real link, `supersedes_id`,
     is resolved in a second pass over the client ids the import can see. Sorting triggers
     to the front was the alternative; it would have worked only for triggers and would
     have broken quietly the day a second reference of this kind arrived.
  3. **The duplicate lookup is `Unscoped`.** A soft-deleted row still holds its
     `(user_id, client_id)` slot, so an import that could not see it would hit the unique
     index instead of skipping. The consequence is deliberate and matches A2's rule for a
     retried POST: **re-importing a file does not resurrect an entry the user deleted.**
  4. **A `supersedes` naming a row that is in neither the file nor the database is left
     unlinked, not refused.** That state is reachable — delete the row a correction
     replaced, and the export can no longer name it — so refusing would make a legitimate
     export un-importable. A trigger reference *is* refused, because an export always
     carries the trigger (see the new follow-up for the one case where it does not).
  5. **The second CSV is a second download from the same button.** The existing CSV is
     built in the browser and saved with a blob, so a second blob is the smallest change
     that follows the mechanism already there; the two sheets have different columns and no
     single sheet can hold both. `exportCSV` became `async` and now fetches `/api/export`,
     because the journal sheet needs rows no screen holds — trigger labels, and the entries
     a correction replaced. Same origin, same endpoint as the JSON button. The journal sheet
     is skipped entirely when there is no feeling to write, so an empty journal still
     produces one file rather than a mystery empty one.
- **One shape decision worth naming.** A mention whose relationship has been soft-deleted
  exports with **no** `relationship` key and keeps its `label`, and imports detached. The
  alternative — find-or-create on the label — would put back a person the user deleted, on
  the strength of a quotation.
- **Verified:**
  - `go vet ./...` clean. `go test ./...` green — handlers 10.3 s; the seven new tests run
    in 0.02 s between them.
  - `gofmt`: the line-ending-insensitive walk from *Warnings*, over tracked and untracked
    `.go` files, printed **empty**.
  - `npm test` **14 files / 205 tests green**, 24.4 s (201 at baseline + the four new
    `buildJournalCSV` cases).
  - `npx vite build` success in 6.1 s. Main chunk **815.15 kB raw / 251.19 kB gzip** —
    **+1.98 kB raw / +0.81 kB gzip** over the S0 baseline, which is `buildJournalCSV` and
    the changed copy. The first bundle movement of Phase 6; recorded under *Measured*.
  - `git diff --numstat` on the four code files: 496/9, 592/0, 136/13, 79/1. No
    whole-file churn, so no line endings were flipped.
  - **Manual round trip**, against `go run ./cmd/server` on a throwaway SQLite database. A
    full day posted through the real endpoint — a trigger, a check-in naming a new person
    and that trigger, the correction that superseded it, a ritual and a person fact — then
    exported, then the journal tables **hard-deleted** (a soft delete would have been a
    no-op on re-import, which is the designed behaviour and not what this was testing),
    then imported:

    ```
    export version 2 | journal entries 5
      trigger      11111111  superseded_at=None                supersedes=-
      checkin      22222222  superseded_at=2026-08-21T17:05:00Z supersedes=-        mentions=1
      checkin      22222222  superseded_at=None                supersedes=22222222
      ritual       33333333  superseded_at=None                supersedes=-
      person_fact  44444444  superseded_at=None                supersedes=-        mentions=1

    wipe:   entries 5 -> 0, mentions 2 -> 0, relationships left alone: 1
    import: {"relationships_created":0,"snapshots_created":0,"snapshots_skipped":0,
             "journal_entries_created":5,"journal_entries_skipped":0}

    GET /api/journal/entries, before vs after
      entries before: 4   after: 4
      IDENTICAL apart from row ids and timestamps

    re-import of the same file:
            {"journal_entries_created":0,"journal_entries_skipped":5}
            journal_entry_count still 5
    ```

    and the remapped link, read back out of the file: row 13 (`22222222…2222`) carries
    `supersedes_id = 12`, and row 12 is `22222222…2221` with `superseded_at` set. Both
    mentions resolved onto the **existing** relationship 1, so no shadow person was
    invented. The journal CSV was then generated from that same `export.json` and came out
    as one row (`2026-08-21,…,chips,irritation,1,false,trigger,deadline,`) — the superseded
    check-in excluded, the trigger resolved to its word, no transcript column. The
    throwaway `backend/alexithymia.db` was **deleted afterwards**.
- **Measured:** the first bundle movement of the phase, +1.98 kB raw / +0.81 kB gzip. Not a
  `(verify)` item, but it is the number C3 and D3 will be compared against.
- **Deferred:** nothing in scope. No encryption-aware export (E1, conditional); no frontend
  beyond the download and the copy the change made stale. The untracked leftovers `go test`
  drops in `backend/internal/handlers/uploads/` were **not** removed this session — the
  cleanup command was refused by the sandbox — but `backend/**/uploads/` is gitignored, they
  do not appear in `git status`, and they cannot be committed by accident. Not committed —
  the prompt does not ask for one.
- **Next session should know:**
  - **The Vault copy that changed, so A10 does not re-litigate it.** Four sentences now
    mention the journal: what an export contains, what the CSV button produces, what an
    import matches on, and the import preview, which gained a second line when the file has
    journal entries. The four privacy claims — origin, no AI features, not encrypted, the
    lock does not encrypt — were **left alone**; A10 still owns the plaintext sentence S0
    asked for.
  - **`GET /api/export` is now on the CSV button's path.** It was previously the only export
    that never touched the network. Nothing leaves the origin, but a test that mocks
    `axios.get` and expects the CSV button to work offline would now be wrong.
  - **The export is the only reader that sees superseded rows.** Everything else in the app
    filters `superseded_at IS NULL`. If a later session adds a second whole-record reader,
    `exportJournal` is the shape to copy, not `GetJournalEntries`.
  - **A9 has a real problem to close.** Deleting a trigger that check-ins still reference
    makes that account's export un-importable — the new follow-up row says where it lands.
    Nothing can do it through the UI today because there is no UI.
  - **`python -c` is unusable in this shell** (a pyenv shim mangles the quoting), which cost
    a run of the manual script. Write a `.py` file and call it. The ledger's *Warnings* did
    not have this; it is worth remembering before the next manual round trip.

---

**A5 — Frontend: `src/constants/journal.js`** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal's whole frontend vocabulary, every string it can show, and the
  arithmetic that reads a stored entry back — as one pure module that nothing renders.
  [`src/constants/journal.js`](../src/constants/journal.js), 976 lines, no React and no
  network: `FEELINGS` (the twenty-one §5.3 entries with label, gloss, valence, energy and a
  complete literal hex), `RITUAL_QUESTIONS` (five core in the fixed order, eight optional,
  each with the settings note), `ENTRY_KINDS`, the limits (`MAX_FEELINGS_PER_CHECKIN` 5,
  `MAX_TRANSCRIPT_LENGTH` 4000, `MAX_TRIGGER_LABEL` = `MAX_TAG_LENGTH`, `INTENSITY_LEVELS`
  1–3, `DAY_ROLLOVER_HOUR` 4), `JOURNAL_COPY` as one nested constant, the four readers
  (`readCheckin`, `readRitual`, `readTrigger`, `readPersonFact`), the day arithmetic
  (`civilDay`, `journalDayPath`, `dayRange`, `isDayString`), `personCandidates` /
  `triggerCandidates`, and `clientId()`. Tests:
  [`journal.test.js`](../src/constants/journal.test.js), **86 tests**, all pure. Docs:
  `docs/06-frontend.md` gains the module to its inventory; `docs/08-testing.md` gains the
  file and names **the two rails this phase adds** as what the entry is for. §6.3 of the
  design document gains the one payload field this session had to add, below. **No
  component, no provider, no route, no network call, no model code** — as the scope fence
  says.
- **The A2/A3 trigger question is closed, and it needed a payload field.** Both sessions
  deferred "does the writer resolve the chain, or does the client always reference the
  surviving id?" to A5. The answer is **both halves, fixed in opposite directions**:
  1. **The writer never resolves.** A new check-in must reference a *live* trigger id and
     A2's server check (`superseded_at IS NULL`) is unchanged. Nothing can trip it, because
     `triggerCandidates` is only ever handed live triggers and `readTrigger` returns `live`,
     the id a new entry must use. Loosening the check would have let a merged-away trigger
     keep collecting entries.
  2. **Readers resolve** — which turned out to be impossible with what §6.3 specified. A
     correction row needs a new `client_id` (they are unique per user), and the row-level
     link back is `supersedes_id`, **a database row id the client never sees**, because
     `GET /api/journal/entries` returns only `superseded_at IS NULL` and the row a
     correction replaced is therefore in no list the frontend holds. So the trigger payload
     gains **`corrects`**: every `client_id` this trigger has been referenced by before this
     row. §6.4 explicitly allows this — a field whose absence reads as "unknown" needs no
     version bump — and **the server needs no change**: `decodePayload` is not strict and
     `models.JournalEntry.Payload` keeps keys the server does not know.
  It is a **list**, and the first draft of it was a single predecessor, which is wrong:
  rename twice and the middle row is superseded too, so a reader walking one hop finds the
  second id and then hits a gap, and every check-in written before the first rename resolves
  to nothing. Each correction carries its predecessor's list plus the predecessor's own id.
  `TestreadTrigger` "still answers for the original id after a second rename" is the case,
  and it fails against the one-hop version.
- **Four other judgement calls, made and documented rather than asked about:**
  1. **An exact person match is returned alone,** not first in a list. §4.5 step 1 says
     *resolved*, and step 2 begins *"Otherwise"* — offering alternatives beside a name the
     server would match exactly invites the user to pick something the server would not have
     picked. The prefix rule requires a **word boundary**: *Lucie* → *Lucie M*, but *Luc*
     does not reach *Lucie*. A partial word is a typo more often than a person.
  2. **`civilDay` shifts the calendar date, never four hours of milliseconds.** The naive
     version is wrong on a spring-forward morning: 04:30 local in Berlin on 2026-03-29 is
     02:30 UTC, and subtracting four hours lands on the previous evening and answers
     *2026-03-28*. Verified both ways before the test was written. `dayRange` is the
     opposite — day strings carry no offset, so it runs in **UTC** and DST is not its
     problem. Two functions, two rules, both stated in the file.
  3. **`uncertain` and `intensity` are `null` when absent, never `false` and never `0`**
     (Appendix B item 4 names `uncertain` specifically). Only `uncertain === true` draws
     dashed, so `null` and `false` behave identically on screen while the record stays
     honest about which it holds. `readRitual`'s `answers` carries exactly the keys the
     payload had — it never invents one and never zero-fills.
  4. **Copy that needs a number carries a `{placeholder}`** and a `fillCopy` helper, rather
     than being a function. A function is invisible to a recursive string walk; a template
     is not. `humanMinutes` (the sibling of `humanGap`) turns the graph's half-life into
     words, so B2's ⓘ sentence is derived from `FEELING_HALF_LIFE_MIN` and tuning the
     constant cannot make the sentence false. There is a test for exactly that.
- **Three small additions beyond the eight numbered items,** each because leaving it out
  would have put a bare string in a component later: `JOURNAL_STORAGE_KEYS` (the eight §9.7
  keys), `DEFAULT_RITUAL_TIME`, `MAX_OPTIONAL_QUESTIONS`, and `activeFeelings` /
  `activeTriggers` / `feelingById` / `questionById` as the readers of the two lists.
  `INTENSITY_LEVELS` is `[1, 2, 3]` and its **words** live in `JOURNAL_COPY.checkin.intensity`
  so the forbidden-word walk reaches them — intensity is the graded axis by design, and that
  separation is the reason the feeling labels may not be graded.
- **Verified:**
  - `npm test` **15 files / 291 tests green** (205 at A4 + 86 new), 20–25 s, on three
    consecutive runs. The `Dashboard.test.jsx` wheel flake did not appear.
  - `npx vite build` success in 5.8 s. Main chunk **815.15 kB raw / 251.19 kB gzip** —
    **byte for byte A4's figure**. Nothing imports `journal.js` yet, so it tree-shakes out
    entirely; a frontend slice that adds zero bytes is the correct result for a module that
    nothing renders, and it is the sanity check that no component crept in.
  - `go vet ./...` clean; `go test ./...` green (handlers 10.1 s). No Go file changed; the
    line-ending-insensitive `gofmt` walk over tracked *and* untracked `.go` files printed
    **empty**.
  - `git diff --stat`: `docs/06-frontend.md` +10, `docs/08-testing.md` +60,
    `product_vision/06-emotional-journal.md` +59 — all cumulative across A1–A5, none of them
    whole-file churn. The two new files are **CRLF**, matching `cadence.js` and
    `categories.js` beside them.
  - The id-parity test was checked against the file it reads: it asserts 21 / 13 / 4 before
    comparing, so a moved or rewritten `domain/journal.go` fails loudly instead of comparing
    two empty lists. The forbidden-word walk has the same guard plus a planted-string case.
- **Measured:** the bundle, unchanged from A4 — recorded because it is the first *frontend*
  slice of the phase and "a frontend session that moves the bundle by zero" is worth having
  on the record before C3 and D3 argue about kilobytes.
- **Deferred:** nothing in scope. No component reads this module yet — A6 is the first.
  `person_fact` has a reader and still no writer, exactly as S0 decided. Not committed —
  the prompt does not ask for one.
- **Next session should know:**
  - **A6 onward: no bare strings.** Every user-visible sentence goes in `JOURNAL_COPY`, or
    the forbidden-word walk cannot see it and Appendix B item 3 is not met. `JOURNAL_COPY`
    already has `ritual`, `checkin`, `empty`, `settings`, `triggers`, `dayGraph` and
    `people` groups; extend them rather than starting a group per component.
  - **The settings block describes all eight §9.7 settings, including four that do not
    exist yet** (voice, suggestions, embeddings, language — 6-C, 6-D, 6-G). A description is
    not permission to render the toggle; rendering one for a feature that does not exist
    would make a Vault claim false (invariant 2e). There is a comment saying so in the file.
    The voice description **is the §10.2 Vault paragraph verbatim**, so the two cannot drift.
  - **A9 owns writing `corrects`.** The triggers view is where rename and merge happen, and
    a correction row it writes must carry `corrects` = the predecessor's `corrects` plus the
    predecessor's own `client_id`, and reference `readTrigger(...).live` for everything else.
    Get that wrong and old check-ins silently lose their trigger. A9 also still owns the A4
    follow-up: a trigger delete that strands references makes an export un-importable.
  - **`civilDay` is local, `dayRange` is UTC, and that is deliberate.** Do not "fix" either
    to match the other. The DST cases in the test set `process.env.TZ` to `Europe/Berlin` in
    `beforeAll` and restore it in `afterAll` (deleting it when it was unset, because
    assigning `undefined` sets the *string* "undefined" and leaves the process in a zone that
    does not exist). There is a guard case asserting the zone really has a DST rule, so the
    two DST tests cannot pass by asserting nothing.
  - **The id-parity test reads the Go file from `process.cwd()`**, not `import.meta.url` —
    Vite rewrites `import.meta.url` to a module URL that is not a `file:` URL and
    `fileURLToPath` throws on it. That cost one run to find.
  - **`journal.js` imports `MAX_TAG_LENGTH` from `ContextCapsule.jsx`,** which is the one
    place this pure module touches a component file. It is deliberate — the prompt says reuse
    rather than redefine, and a second `40` would drift — but it means the constants module's
    import graph reaches React. Nothing in it uses React, and the build proves it costs
    nothing.

---

**A6 — Frontend: provider, routes, navigation, day view** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal became a place in the app, and it reads.
  [`src/context/JournalContext.jsx`](../src/context/JournalContext.jsx) — a second context
  beside `SubjectsContext`, mounted **inside** it, holding the loaded day range, the entries
  and day counts in it, the trigger vocabulary, `createEntry` / `deleteEntry`, and F1's empty
  `outbox`; it reads `relationships` from `useSubjects()` and never fetches them (invariant
  17), and everything goes through the global `axios` (trap 11).
  [`src/components/Journal.jsx`](../src/components/Journal.jsx) — the day view: a month strip,
  a header that walks days, the day's check-ins newest-first with feelings as coloured chips
  and what each was about, the ritual as the day's footer, and a day-graph slot that renders
  nothing until B2. Six routes in [`App.jsx`](../src/App.jsx), all guarded on `token` like
  `/vault`, four of them placeholders so no link is a 404. `Journal` is now the second of
  `MobileBottomNav`'s **five** slots and sits beside Vault in `Navbar`. `journal.js` gained
  `shiftDay`, `monthBounds`, `timeOfDay` and four copy additions (`day`, `nav`,
  `empty.nothingHere`, `ritual.heading`). Tests: **49 new** —
  `JournalContext.test.jsx` (22) and `Journal.test.jsx` (27) — plus **11** in
  `journal.test.js`. Docs: `docs/06-frontend.md` gains §2c and §2d, the graph, the inventory
  and the guard block; `docs/12-android-app.md` §3.1 states the fifth slot and its measured
  width; `docs/08-testing.md` documents both new files and the two new test traps;
  `docs/10-agent-guide.md` traps 10c/10d and invariant 17 now name the journal; §9.4 of the
  design document gains the first-run rule below. **No composer, no ritual cards, no People
  or Triggers bodies, no day graph, no microphone, no outbox** — as the scope fence says.
- **Four judgement calls, made and documented rather than asked about:**
  1. **What "first ever visit" means**, which §9.4 named and did not define. The card shows
     when today is empty **and** the loaded range holds no entry **and** `alq:journal-ritual`
     has never been written on this device. The card is an offer, so it belongs where the
     offer has never been answered — a one-shot "seen" flag would hide it from someone who
     never read it, and showing it beside a day's work would be noise. The design document
     now says so, including the one imprecision it accepts.
  2. **A `person_fact` row renders.** Nothing writes one and nothing will until 6-E, but an
     import can carry one, and a row that renders as nothing would make *Nothing recorded for
     this day* a lie — "never silently discard" is a reading rule as much as a writing one
     (invariant 13). It is a plain card with the text and the person; the person's own view of
     their facts is still A9's.
  3. **`loadRange` replaces the window, it does not widen it.** A window that only ever grew
     would refetch a year to draw a week. The consequence is that `markedDays` is a month at
     a time, which is all the strip draws.
  4. **A day is marked from two sources** — `/api/journal/days` and the entries in state —
     so a check-in saved a moment ago marks its day without a refetch. Which is also why
     `createEntry` does not have to maintain the counts by hand; see the new follow-up for
     the one thing that stays stale.
- **Verified:**
  - `npm test` **17 files / 351 tests green** (291 at A5 + 49 + 11), 25.5 s, on two
    consecutive runs. The `Dashboard.test.jsx` wheel flake did not appear.
  - `npx vite build` success in 6.9 s. Main chunk **838.39 kB raw / 258.95 kB gzip** —
    **+23.24 kB / +7.76 kB gzip** over A5, recorded under *Measured*. Most of it is
    `journal.js` finally being imported by something.
  - `go vet ./...` clean; `go test ./...` green (handlers 10.7 s). No Go file changed.
  - `git diff --stat` on the three tracked files this session edited: `App.jsx` 54,
    `MobileBottomNav.jsx` 39, `Navbar.jsx` 12. No whole-file churn, so no line endings were
    flipped — but see *Warnings* for the tool behaviour that nearly caused one.
  - **Manual QA against the real stack** — `go run ./cmd/server` on a throwaway SQLite
    database, `npm run dev`, Chromium at a **360 × 800** viewport, with a trigger, a check-in
    naming a new person and that trigger, and a ritual posted through the real endpoints:

    ```
    /journal  →  header time 2026-08-22 "Saturday, 22 August 2026"
                 month strip 31 cells, marked: [2026-08-22]
                 entry kinds in order: [checkin, ritual]
                 ritual: Slept well…Yes · Moved your body…No · Spent time outside…Yes
                         Spent time with someone…Yes · Ate at regular times…Unanswered
                         And today, in a word? → calm
                 bottom bar: Journal aria-current=page, Analysis none
                 horizontal scroll: false

    bottom bar at 360 dp:  5 slots × 72 × 56 px, no label overflowing, nav 57 px tall
    ```

    Discretion on: two name chips masked to `L.`, the trigger label and the transcript both
    carrying `blur-[3px]`, all four feeling chips unblurred with their labels intact and only
    `unclear` dashed, tab title `Notes`. With a lock hash set, `/journal/2026-08-21` rendered
    **`Locked` and nothing else** — no header, no strip, no bottom bar, no transcript — which
    is the app-lock check the prompt asked for, verified rather than re-implemented. The
    throwaway `backend/alexithymia.db` was **deleted afterwards** and `.claude/launch.json`
    (written only to start the dev server) was removed, so the tree is as it was found.
- **Measured:** the bundle after the first slice that renders, and the **five-slot width at
  360 dp** — 72 × 56 dp — which §9.2 asserted as arithmetic and is now a measurement.
  `docs/12-android-app.md` carries the number and the date.
- **Deferred:** nothing in scope. Three follow-ups added above, all pointing at A7 and A9.
  Not committed — the prompt does not ask for one.
- **Next session should know:**
  - **The Edit tool normalises a whole file's line endings**, and it did it to
    `src/constants/journal.js` mid-session — one edit turned a CRLF file entirely LF, and a
    later edit turned it back. It came out right, but do not trust it. **And `grep -c $'\r'`
    and `awk /\r$/` both lie in this shell** — Git Bash strips CR in text mode, so both report
    a CRLF file as LF and an LF file as CRLF depending on the tool. The only check that told
    the truth was a Python script reading the file as **bytes** and counting `b'\r\n'`. The
    ledger's existing `od -c` advice works too, but only with `grep -F`. Check every file you
    edit this way before you believe `git diff --stat`.
  - **Every new user-visible string is in `JOURNAL_COPY`, and the walk checks the *path* too.**
    The assertion is made against the path *and* the string joined together, so a **key name**
    containing a forbidden word fails the test — a key called `loadFailed` would have been red
    on `fail`. It is `day.loadError` for that reason. Name keys as carefully as sentences.
  - **A test that depends on which day it is must fake only `Date`.**
    `vi.useFakeTimers({ toFake: ['Date'] })` pins `civilDay()` while leaving `setTimeout` to
    testing-library, so `userEvent` and `waitFor` still work; faking all timers breaks them.
    `Journal.test.jsx` pins **12:00 UTC**, which is past the 04:00 rollover in every zone the
    suite could run in.
  - **A7 writes through `createEntry`, and it mints the `client_id`.** Do not mint one in the
    composer — the provider does it if the caller did not, which is what makes the same entry
    posted twice one row and what F1's outbox depends on. A correction posts with
    `supersedes_id` and the provider drops the row it replaced from the list.
  - **The check-in payload the server actually accepts needs an `intensity` on every
    feeling.** The first manual POST of this session was a `400
    {"error":"feelings[2] needs an intensity"}` because the `unclear` chip was sent without
    one. `readCheckin` reads an absent intensity as `null` and the chip renders fine without
    it, so this is a **server** rule the composer has to satisfy, not a reader rule — A7 must
    make the intensity step non-skippable, or A2's validator has to change.
  - **`JournalPlaceholder` is exported from `Journal.jsx`** and `App.jsx` imports
    `JournalRitual`, `JournalPeople`, `JournalPerson` and `JournalTriggers` from there. A8 and
    A9 replace those bodies and swap the import; **do not add a route** — all six already
    exist and are guarded.
  - **`MobileBottomNav` and `Navbar` now import `src/constants/journal.js`.** The nav label is
    the journal's word, so the forbidden-word walk reaches it. That is also why the bundle
    moved: `journal.js` used to tree-shake out completely.

---

**A7 — Frontend: the check-in composer** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal writes.
  [`src/components/CheckinComposer.jsx`](../src/components/CheckinComposer.jsx) — the sheet,
  plus the two ways in §9.2 names: `CheckinButton` (`hidden md:flex`, sharing the day
  header's top row so it lands where the dashboard puts *New Analysis*) and `CheckinFab`
  (64 px, bottom-right, `pb-safe`- and keyboard-aware). Inside it: the twenty-one `FEELINGS`
  as a filterable grid of coloured buttons; a card per picked feeling carrying a strength
  that cycles `·` → `··` → `···` and never renders a digit, an `≈` toggle writing
  `uncertain: true`, and what it was about — a person, a trigger, or a `CONTEXT_TAGS` tag,
  each movable between feelings and removable with its `×`; the check-in's own tags and a
  free-text note; and an exported, pure `buildCheckinRequest` that assembles the §7.2 body.
  [`Journal.jsx`](../src/components/Journal.jsx) mounts all three and gains a **delete**
  affordance per check-in whose dialog names the time, lists the words and says what
  survives. [`JournalContext.jsx`](../src/context/JournalContext.jsx)'s `createEntry` gained
  one behaviour — see the bug below. `journal.js` gained `tzOffsetMinutes`, `rfc3339Local`
  and the composer's copy (a `checkin.delete` group and eighteen other keys). Tests:
  **35 new** in `CheckinComposer.test.jsx` and **5** in `journal.test.js`. Docs:
  `docs/06-frontend.md` gains §2e and two additions to §2c/§2d; `docs/01-concepts.md` gains
  **check-in** and **trigger** to its domain vocabulary as peers of the snapshot, without
  touching the "no AI" claim, which is still true; `docs/08-testing.md` documents the new
  file; §4.4 and §7.2 of the design document gain the two decisions below. **No voice, no
  transcription, no model, no proposal card, no ritual, no outbox, no People or Triggers
  bodies, and no `PUT`** — as the scope fence says.

- **One bug the unit tests could not have found, and it is the reason the manual QA exists.**
  `POST /api/journal/entries` creates a new trigger as **its own row in the same
  transaction** and echoes back only the entry that named it. So after the first check-in
  naming *work*, the client held no trigger row, the second composer offered nothing but
  *new trigger: work?* again, and one more tap would have produced **two rows with the same
  label** — the exact duplicate-vocabulary failure the whole `client_id` machinery exists to
  prevent. Every composer test was green at the time; it surfaced on the first of the
  prompt's three manual check-ins. `createEntry` now refetches the range when, and only
  when, the request minted a trigger, deliberately **without awaiting it**: the write has
  landed, and a sheet sitting on *Saving…* for two more round trips is worse than a
  vocabulary that catches up a moment later. Two tests pin both halves. §7.2 of the design
  document now says the response does not echo the trigger rows, and names the better fix
  (echo them) as an F1-shaped change rather than one worth making on its own.

- **Five judgement calls, made and documented rather than asked about:**
  1. **`unclear` is exclusive.** §4.4 said it is first-class and dashed; it did not say what
     happens when it is picked beside *joy*. *Can't tell* and a named feeling in one record
     is a contradiction, so picking `unclear` puts the others down and picking another puts
     it down. It still saves alone, which is the reason it exists. The rule is **stated**
     beside the cap rather than discovered by tapping, and §4.4 now carries it.
  2. **A check-in records now, whatever day is on screen**, because §6.3 says `at` is the
     moment and `day` is the civil day it falls in. That would have saved into a day the
     reader cannot see, so the day view **follows the saved entry** to the day it landed on.
  3. **`source` is `typed` when a note was written and `chips` otherwise** — §4.1's two paths,
     told apart by the only thing that distinguishes them before voice exists.
  4. **An empty `tags` or `note` is absent from the payload, not empty.** Invariant 14: the
     honest record of a user who added neither is a missing key, and `readCheckin` already
     reads absence as nothing.
  5. **Neither picker offers to create something beside an exact match.** *New person: Noor?*
     next to the existing Noor invites a duplicate `FindOrCreateRelationship` cannot make,
     and *new trigger: work?* next to *work* would split a grouping key. A trigger minted
     earlier in the **same sheet** counts as existing for every later feeling, for the same
     reason.

- **Verified:**
  - `npm test` **18 files / 391 tests green** (351 at A6 + 35 new component tests + 5 in
    `journal.test.js`), 26.9 s, on two consecutive runs. The `Dashboard.test.jsx` wheel flake
    did not appear.
  - `npx vite build` success in 6.9 s. Main chunk **859.58 kB raw / 264.46 kB gzip**
    (**+21.19 kB / +5.51 kB gzip** over A6), recorded under *Measured*.
  - `go vet ./...` clean; `go test ./...` green (handlers 10.3 s). No Go file changed; the
    line-ending-insensitive `gofmt` walk over tracked *and* untracked `.go` files printed
    **empty**.
  - Line endings checked with the byte-level Python script for every file touched:
    `journal.js` and `journal.test.js` still CRLF, `Journal.jsx`, `JournalContext.jsx` and
    both new component files LF, every doc LF. `git diff --stat` shows no whole-file churn.
  - **Manual QA against the real stack** — `go run ./cmd/server` on a throwaway SQLite
    database, `npm run dev`, Chromium at **360 × 800** and again at 1280 × 720, driven
    through the page's own DOM because the browser pane would not composite frames.

    ```
    three check-ins, "work" typed as a new trigger on the first only
      → trigger rows:  1  · client_id 3fe44305-… · label "work"
      → check-ins:     3  · stress / irritation / tiredness
      → each about:    {"kind":"trigger","trigger":"3fe44305-…"}   ← the same id, three times
      composer 2 and 3 offered "work" as a chip; neither showed "new trigger:" before typing

    a person created in the journal, then snapshotted from the dashboard
      → relationships: 1  · Lucie · snapshot_count 1
      → subjects:      1  · relationship_id 1
      → journal mention still relationship_id 1        ← one relationship, not two

    delete, from the day view
      dialog: "This removes the check-in from 18:19 — connectedness — and what each was
               about. The people and triggers it named stay where they are."
      after:  card gone · relationship "Lucie" intact · trigger "work" intact

    the cap and "can't tell", on the real screen
      "Up to 5 words in one check-in. That one stands on its own — picking it puts the
       others down."   · sixth chip disabled · unclear never disabled
      pick 5 → unclear  ⇒ [unclear]      pick joy  ⇒ [joy]

    discretion on
      person chip "L." (masked, not blurred) · trigger label blurred · note blurred
      feeling chip "connectedness" untouched

    360 × 800: header button display:none · fab 64 × 64, 16 px right, 72 px above the
               viewport, nav 57 px, no horizontal scroll
    1280 ×720: header button "Check in" flush with the column's right edge · fab hidden
    ```

    The throwaway `backend/alexithymia.db` was **deleted afterwards**, `.claude/launch.json`
    (written only to start the dev server) removed, and the two untracked leftovers `go test`
    dropped in `internal/handlers/uploads/` deleted; the six tracked ones stay.

- **Measured:** the bundle after the first slice that writes, and the **handset button at
  360 dp** — 64 × 64 px, 72 px above the viewport bottom over a 57 px bar — which §9.2
  asserted and is now a measurement.

- **Deferred:**
  - **The edit affordance**, as the prompt allows. A correction is a new entry with
    `supersedes_id` and the provider already drops the row it replaces, but nothing in the UI
    writes one. **A9** is writing correction rows for trigger renames anyway, so the two
    belong in one session.
  - **The dashboard's *New Analysis* name suggestions.** §2.2 asks for a journal-only person
    to be offered there; the field has no `datalist` and no autocomplete at all. Logged as an
    A9/A10 follow-up above. It resolved correctly regardless — one relationship, not two —
    so this is discoverability, not data.
  - Not committed — the prompt does not ask for one.

- **Next session should know:**
  - **Drive the real stack before you call a writer done.** Everything above about the
    trigger echo was invisible to 33 green tests, because a mocked `POST` cannot forget to
    return a row the real one never returns. A8 writes rituals and A9 writes corrections;
    both create rows the response does not fully describe.
  - **`createEntry` refetches only when the request minted a trigger.** If A8 or A9 adds a
    kind whose write creates a second row server-side, that condition needs widening — it is
    one `if` in `JournalContext.jsx` with the reasoning beside it.
  - **The composer's copy is `JOURNAL_COPY.checkin`, and it now has a nested `delete` group.**
    Extend the group rather than starting a new one, and remember the walk asserts the *path*
    as well as the string — a key named `deleteFailed` would be red on `fail`.
  - **`rfc3339Local` and `tzOffsetMinutes` are in `journal.js`**, not in the composer, and
    they are written from **one** `new Date()` so `at` and `tz_offset_min` cannot disagree.
    A8's ritual needs both.
  - **`buildCheckinRequest` is exported and pure**, so a future writer (the proposal card in
    D2, the outbox in F1) can build the same body without the sheet.
  - **The `unclear` exclusivity rule is enforced in `toggleFeeling`**, and A8's *day word* is
    a single feeling by construction, so it does not inherit the question — but B2's graph
    will draw `unclear` alongside other feelings on the same *day*, which is fine and is a
    different claim.

---

**A8 — Frontend: the nightly ritual** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the ritual, and a night nobody answers still weighs nothing.
  [`src/components/RitualCards.jsx`](../src/components/RitualCards.jsx) at `/journal/ritual` —
  a `fixed inset-0`, non-scrolling route: one card at a time, the question as a sentence with
  the two answers written under it, swipe right/left/up mirrored by a **Yes**/**No** button
  pair, a smaller skip link and `→`/`←`/`↑`, a tilt that follows the finger, a commit
  threshold of `max(48px, 30% of the card)`, one `knobFeedback` tick per commit and none under
  discretion. The deck is `ritualDeck()`: the core five in the §3.2 order, the optional ones
  this device turned on **in the set's order**, a *Who?* card spliced in behind a yes to
  `with_people`, and the twenty-one-chip closing card last. Two exported pure builders —
  `buildRitualRequest` and `buildDayWordRequest` — write the §6.3 payload and the duplicate
  `checkin` at the same `at`. The file also holds `useRitualPrompt` and `RitualNudge`, the
  dashboard's ritual line.
  [`src/constants/journalSettings.js`](../src/constants/journalSettings.js) — the three §9.7
  keys 6-A ships, as tolerant readers and writers.
  [`Profile.jsx`](../src/components/Profile.jsx) gains the **Journal** section beside
  *Check-in reminders*. `journal.js` gained `ritualDeck`, `RITUAL_QUESTION_SET_VERSION`,
  `RITUAL_PATH`, `isClockTime`, `minutesIntoCivilDay`, `ritualTimeReached` and the ritual's
  remaining copy. `Dashboard.jsx` now renders **one** nudge, never two. `App.jsx` swaps the
  placeholder for the route and `Journal.jsx` drops `JournalRitual`. Tests: **32** in
  `RitualCards.test.jsx`, **11** in a new `Profile.test.jsx`, **9** in `journal.test.js`, and
  **1** in `journal_test.go`; `Dashboard.test.jsx` gained `JournalProvider`. Docs: `docs/06`
  §2f and four amended sections, `docs/12` §3.3, `docs/01` §3's heading, `docs/04` §5a,
  `docs/08`, and §3.2 / §6.3 / §6.5 of the design document. **No Android notification, no
  launcher shortcut, no voice, no day graph** — as the scope fence says.

- **One deviation, and it is a backend line.** `POST /api/journal/entries` **no longer
  requires an `intensity` on a feeling** (`journal.go`; present ⇒ still 1–3). It had to
  change, and the reasoning is the session's only interesting argument: the day word is
  duplicated as a `checkin` (§6.3, and item 4 of this prompt), the closing card is *one tap on
  one word* (§3.2), and a check-in with no strength in it cannot satisfy a validator that
  demands one. The two ways out were to invent a middle number — which is the application
  authoring a value the user did not, and rule 1 of the preamble — or to make the server say
  what §6.5 always said, which is a **range for a value that is present**. A6 already logged
  this exact fork ("A7 must make the intensity step non-skippable, **or A2's validator has to
  change**"); A7 took the first branch, and A8 is the writer that forces the second.
  `TestCreateJournalEntryAcceptsAFeelingWithNoIntensity` pins the absence surviving the round
  trip and a new `Intensity Of Zero` case pins that a zero is still refused — absent is not
  zero (invariant 14). Verified against the running server, not only in unit tests.

- **Five judgement calls, made and documented rather than asked about:**
  1. **The route is `fixed inset-0`, over the header and the bottom bar.** Not aesthetics: the
     touch-axis claim is only legitimate while nothing on the screen scrolls, and a route
     rendered inside `App`'s scrolling column inherits a page that does. This is the *whole*
     of why invariant 2g permits `touch-action: none` here, so the layout and the claim are
     one decision. The comment sits on the line that makes the claim and names the condition
     that would revoke it.
  2. **The commit threshold has a 48 px floor under the 30 %.** An unmeasured layout reports a
     width of zero and 30 % of zero commits on the first pixel of a tap — which is precisely
     the half-asleep tap §3.4 says must record nothing. Without the floor every gesture test
     would also have passed while asserting nothing.
  3. **`day_word` carries no `uncertain` and the duplicated check-in carries no `intensity`.**
     §6.3's example shows `"uncertain": false`; the ritual has no `≈` affordance, so writing
     it would record a statement nobody made. §6.3 now says so.
  4. **A ritual with every question skipped still writes a row** — `asked` full, `answers`
     empty. "I opened it and answered nothing" and "I never opened it" are different records,
     and only the first has a row. Verified on the real stack.
  5. **The nudge slot is owned, not shared.** `owns = due || seen === today`, so once the
     ritual has claimed the slot this session the cadence banner waits for the next one even
     after *Not tonight*. The one edge, stated rather than discovered: a ritual completed
     without ever being prompted — from the journal, or F2's shortcut — hands the slot back,
     because nothing this session ever claimed it.

- **One bug found by driving the real app, again.** Two optional-question chips toggled inside
  **one task** lost the first: both handlers read the same render's list and the second
  overwrote. A thumb cannot do this and a script can, which is exactly how it surfaced — the
  eleven Profile tests were green at the time. `toggleQuestion` now reads through a ref, and a
  test drives both clicks inside one `act`. The write stays at the call site rather than
  moving to an effect, because an effect firing on mount would write `alq:journal-ritual`
  before the user touched it and silently kill the journal's first-run card (§9.4).

- **Verified:**
  - `npm test` **20 files / 442 tests green**, 18.7–26.5 s, on three consecutive runs. The
    `Dashboard.test.jsx` wheel flake did not appear.
  - `npx vite build` success in 5.9 s. Main chunk **875.99 kB raw / 268.46 kB gzip**
    (**+16.41 kB / +4.00 kB gzip** over A7), recorded under *Measured*.
  - `go vet ./...` clean; `go test ./...` green (handlers 10.1 s). The line-ending-insensitive
    `gofmt` walk over tracked *and* untracked `.go` files printed **empty**.
  - **Five mutations planted in `RitualCards.jsx`, each run against the suite, all five
    caught**: skip writing `false`, the card dropping to `pan-y`, the tick ignoring discretion,
    the day word writing no second row, and a tap answering *yes*. Appendix B item 2 asserted
    rather than assumed — the whole file passed on its first run, which is a reason to check,
    not a reason to relax.
  - Line endings checked byte-wise on every file touched: `journal.js`, `journal.test.js`,
    `journalSettings.js`, `App.jsx`, `Dashboard.jsx` and `Dashboard.test.jsx` still **CRLF**;
    `RitualCards.jsx`, its test, `Profile.jsx`, `Profile.test.jsx`, `Journal.jsx`,
    `Journal.test.jsx` and every doc **LF**. No whole-file churn in `git diff --stat`.
  - **Manual QA against the real stack** — `go run ./cmd/server` on a throwaway SQLite
    database, `npm run dev`, Chromium at **360 × 800**, then 360 × 640 and 320 × 560. The
    browser pane would not composite a drag (A7 hit the same wall), so the gesture was driven
    as real `PointerEvent`s dispatched at the card — the same handler path, the same
    threshold, the same tilt.

    ```
    the full nine-interaction night, one direction per card, at a deliberate 1.5 s pace
      trace: slept_well → moved_body → daylight(skip) → with_people(yes) → who
             → ate_regularly → alcohol → worked_late → word
      wall clock, first card to "Recorded.":  13.5 s      (nine interactions)

    the row the server stored
      ritual   asked   [slept_well, moved_body, daylight, with_people,
                        ate_regularly, alcohol, worked_late]      ← seven
               answers {slept_well, moved_body, with_people,
                        ate_regularly, alcohol, worked_late}      ← six
               daylight in asked: true   ·   in answers: false    ← the session, in one line
               day_word {id: calm}   ·   no `uncertain` key
               rollover_hour 4   ·   duration_ms 29051
               mentions [{relationship_id: 1, label: "Lucie", ref: 0}]
      checkin  source ritual_word · at 2026-08-22T17:21:46Z  ← the ritual's own `at`
               feelings [{id: calm, about: []}]              ← no `intensity`, and the real
                                                               Go validator took it

    GET /api/export
      daylight in asked: true   ·   in answers: false        ← the prompt's own check

    the day after, /journal/2026-08-21
      "Nothing recorded for this day."  and nothing else
      entry kinds: []  ·  no ritual heading  ·  no "Unanswered"  ·  no zero  ·  no "you didn't"

    the two nudges, on a stack 7 weeks past a 30-day rhythm
      ritual off        →  "It's been 7 weeks since your last snapshot of Lucie."
      ritual on, hour passed  →  "Tonight's questions are ready."   · cadence line: absent
      after "Not tonight"     →  neither, and neither on a second visit in the same session

    geometry at 360 × 800
      card 328 × 143, touch-action none, computed `auto` on every ancestor
      commit threshold 98 px (= 30 % of 328)
      Yes / No 157 × 56 at y 632  ·  skip 56 × 44 at y 704   ← inside the thumb's arc
      vertical scroll false · horizontal scroll false        ← what the axis claim rests on
    ```

    The word card overflowed the viewport's top by 7 px at **320 × 560** before the layout was
    compacted (tighter card padding below `sm`, 36 px chips, and the skip hint hidden on the
    closing card only); after it the card is 374 px, fully on screen, twenty-one chips, still
    no scrolling in either axis. The throwaway `backend/alexithymia.db` was **deleted
    afterwards**, `.claude/launch.json` (written only to start the dev server) removed with its
    directory, and the two untracked leftovers `go test` dropped in
    `internal/handlers/uploads/` deleted; the six tracked ones stay.

- **Measured:**
  - The bundle after the ritual: **875.99 kB / 268.46 kB gzip**, +16.41 kB / +4.00 kB over A7.
  - **§12.4 question 1, partially.** Nine interactions — the §3.3 maximum — completed in
    **13.5 s** of wall clock at a deliberate 1.5 s per card, ending on *Recorded.* A minute
    allows **6.7 s per card**, so the mechanism has roughly 4× headroom and the optional tail
    does not have to shrink on these grounds. **This is a driven measurement, not a user
    test**: the pace was chosen, not observed, and what it establishes is that the *screen* is
    not the constraint. The number §12.4 actually asks for — a half-asleep person, unprompted
    — is **U1's**, and this is the floor it should be compared against.
  - `duration_ms` measures **mount to save**, not first card to last, so the stored 29051 ms
    includes the time this session sat idle between tool calls. That is the right semantic —
    a ritual left open for ten minutes did take ten minutes — but it means the field is not a
    clean interaction time, and U1 should read the wall clock rather than the row.

- **Deferred:**
  - The Android local notification and the launcher shortcut (**F2**), voice answering
    (§3.7, **D3**), and the day graph (**B1/B2**) — all out of scope by the fence.
  - §10.3's append to `docs/01-concepts.md` §6, *"No notifications sent anywhere"*, naming the
    ritual's local notification. **Not made**: that notification does not exist until F2, and
    writing the sentence now would put a false claim on the concepts page. **F2 owns it.**
  - Not committed — the prompt does not ask for one.

- **Next session should know:**
  - **`intensity` is now optional on a check-in, and B1 inherits the consequence.** A
    `source: "ritual_word"` sample carries no intensity, so `buildDayCurve` must decide what
    an intensity-free sample draws at — as a **stated constant in the ⓘ sentence**, not a
    silent 2. §6.5 and §8.2 of the design document now say so. This is the one thing A8 hands
    forward that is not a UI detail.
  - **`journal.js` is still free of `window`, and that is now load-bearing.** The three
    settings keys live in `journalSettings.js` for that reason: `journal.js` is the module the
    forbidden-word walk and the id-parity test are built around. C3 and G1 add the voice and
    embedding settings — **put their readers in `journalSettings.js`**, and remember that a
    key with a reader but no feature is a Vault claim that is false (invariant 2e).
    `Profile.test.jsx` asserts the five unbuilt toggles are absent; that test is the guard.
  - **The copy rail moved up a level.** `RitualCards.test.jsx` and `Profile.test.jsx` walk
    **every text node that reached the screen** and assert each one is in `JOURNAL_COPY`, a
    question text, a feeling label, a person's name or an arrow glyph — with a planted
    sentence proving the filter looks. It is stronger than grepping the component and it
    catches a bare string in a branch the module walk cannot see. Copy it for A9's screens;
    note that a `fillCopy` result has to be listed explicitly, because the walk over the
    template cannot match the filled string.
  - **`Dashboard.jsx` calls `useJournal()` now**, so `Dashboard.test.jsx` wraps in
    `JournalProvider`. Any new test that renders the dashboard needs the same tree.
  - **The ritual's session key is `alq:journal-ritual-seen`, in `sessionStorage`**, holding the
    civil day. F2's notification must not write it — a notification tapped at 22:30 should open
    the cards, and the line on a dashboard opened later is a separate decision.
  - **A gesture is testable, and `left_click_drag` is not.** The browser pane cannot composite
    a drag; dispatching `PointerEvent`s at the element runs the same handlers, the same
    threshold and the same tilt, and `fireEvent.pointerDown/Move/Up` works identically in
    jsdom (as `VaultKnob.test.jsx` already knew). Export the intent function too —
    `gestureIntent(dx, dy, threshold)` — because the case that matters most is the **tap**,
    and a tap is what a DOM-level gesture test is least likely to reproduce faithfully.

---

**A9 — Frontend: People and Triggers views** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** the journal's two vocabularies became visible and editable, and every screen
  the phase registered as a placeholder now has a body.
  - [`src/components/JournalPeople.jsx`](../src/components/JournalPeople.jsx) — `/journal/people`
    lists **every** relationship from `useSubjects().relationships` including the
    `snapshot_count: 0` ones the dashboard does not draw, each with its mention count, its two
    most-attached feelings (descriptive, taxonomy-order tie-break, `summarizeStack`'s register
    and its ⓘ), and a timeline link **only when a snapshot exists** — otherwise *No snapshot
    yet*, which is a fact about the record rather than a nudge. `/journal/people/:id` is keyed
    by `relationship_id`: mentions newest first with the feelings attached to *them* and the
    line that named them, the person's facts with their dates, and one line saying rename,
    merge and delete live on the dashboard.
  - [`src/components/JournalTriggers.jsx`](../src/components/JournalTriggers.jsx) —
    `/journal/triggers`, one row per **live** trigger with its entry count and two feelings,
    the entries that name it behind a disclosure (no new route: §9.1 gives the vocabulary one
    screen), and the two corrections. **No delete**, which closes A4's stranded-trigger
    follow-up: rename covers *called the wrong thing*, merge covers *same as that*, and
    neither can strand a reference out of an export.
  - **The two corrections are `POST /api/journal/entries` with `supersedes_id`**, built by the
    pure `renameTriggerRequest` / `mergeTriggerRequest` in `journal.js`. Both carry `corrects`
    (the predecessor's list plus the predecessor's own id) so a check-in written before the
    correction still resolves; merge names the survivor's **`live`** id, not the id it was
    looked up as. The merge dialog states the count and the one-way sentence, in
    `MergeRelationshipDialog`'s shape.
  - **`DELETE /api/journal/people/:id`** — §10.6's *remove this person from the journal*.
    See *the one thing that went past a frontend session*, below.
  - [`src/constants/journal.js`](../src/constants/journal.js) grew the copy for both screens,
    `PEOPLE_PATH` / `TRIGGERS_PATH` / `journalPersonPath` / `JOURNAL_HISTORY_FROM`,
    `countCopy`, `topFeelings`, `summarizePerson`, `summarizeTrigger` and the two builders.
    `JournalContext` gained `loadAll`, `triggerEntries` and `removePersonFromJournal`.
  - **The day header links to both screens.** Nothing did before — the bottom bar has one
    journal slot and the day is what it opens, so without this neither view was reachable.
  - **`PersonForm`'s *Identity* field has a `datalist`** fed with every relationship,
    `snapshot_count: 0` included — A7's deferred §2.2 item, closed.
  - `Journal.jsx` now exports the shared shell and chips (`Frame`, `Loading`, `LoadFailed`,
    `FeelingChip`, `PersonChip`, `WordChip`, `chipClass`, `AttachedFeelings`) instead of the
    three placeholder bodies; `App.jsx` imports the real components.

- **Verified:** `npm test` **22 files / 506 tests green** (20.1 s); `cd backend && go test ./...`
  green; `go vet ./...` clean; the line-ending-insensitive `gofmt` walk printed empty;
  `npx vite build` success. `git diff --stat` shows no whole-file churn, and the six tracked
  files under `backend/internal/handlers/uploads/` are intact.

  **Manual QA against a real backend and dev server**, and it earned its keep:

  ```
  three check-ins naming "work"  → the composer offered the existing trigger from the
                                   second one on (one candidate, never two)
  rename "work" → "the job"      → all three entries read "the job" on the day view
  export                         → carries BOTH rows: cea3f018… label "work" with
                                   superseded_at stamped, and 4860269b… with
                                   corrects: ["cea3f018…"] and label "the job".
                                   The three check-ins still reference cea3f018….
                                   The correction row's link is named `supersedes`
                                   (a client_id) — the export never carries a row id.
  new trigger "my job" → merged into "the job"
                                 → dialog: "…— 1 so far." + the one-way sentence;
                                   after: one row, 4 entries, all four chips read
                                   "the job", composer offers only the survivor's live id,
                                   and nothing on the screen would take it apart again
  remove Lucie M from the journal → "1 entry stops being linked to Lucie M."; after
                                   confirming, GET /api/journal/entries shows the check-in
                                   alive with relationship_id: null and label "Lucie M"
  New Analysis                   → datalist offers "Lucie M" (snapshot_count 0)
  discretion, 360 × 800          → names → "L. M.", trigger label blur(3px),
                                   no horizontal scroll, row tap target 326 × 76
  ```

  The throwaway `backend/alexithymia.db` was deleted afterwards, `.claude/launch.json`
  (written only to start the dev server) removed, and the six untracked leftovers `go test`
  dropped in `internal/handlers/uploads/` deleted.

- **Measured:** main chunk after A9 — **896.58 kB raw / 273.02 kB gzip** (+20.59 kB raw /
  +4.56 kB gzip over A8). Two screens, their dialogs and two lucide icons.

- **The one thing that went past a frontend session, stated plainly:** §10.6 requires *remove
  this person from the journal* to **soft-delete their `person_fact` entries and detach their
  mentions**, and **no endpoint could detach a mention**. `DELETE /api/relationships/:id` only
  *counts* them, and `DELETE /api/journal/entries/:id` takes the whole entry — which would
  rewrite the user's own record of a day, exactly what `DeleteRelationship` refuses to do. So
  A9 added `DeleteJournalPerson` (~90 lines in `journal.go`, one route, two Go tests). It is
  the minimum that makes the button's sentence true; a frontend-only version would have been a
  screen that says it detaches mentions and does not.

- **Deferred:**
  - **The edit affordance** A7 handed to A9 is **not** built as a general affordance. A9 writes
    correction rows for the trigger vocabulary, which was the concrete half of that item; a
    check-in still has only *delete*, which §7.1 supports (a withdrawal is honest; an edit
    would be a new statement, and the composer has no seam for pre-filling one). **D2 or a
    later slice** owns a general "correct this check-in" if it is wanted.
  - **Not committed** — the prompt does not ask for one.

- **Next session should know:**
  - **A copy template that ends before its verb cannot agree with its own number.** The remove
    dialog first read *"0 facts kept about Lucie M go, and 1 entry stop being linked"* — one
    template, two counts, and eleven green tests could not see it because they asserted the
    template's own output. It is now **two clauses, each a `{one, many}` pair carrying its
    verb**, each naming the person so either can stand alone, and a clause with a count of
    zero is not rendered. `countCopy(count, templates, values)` is the helper. **Any future
    counted sentence should be a pair, not a stem plus an `s`.**
  - **`countCopy` exists and `mentionCount` / `entryCount` are now `{one, many}` objects**, not
    plain templates. The forbidden-word walk asserts the *paths*, so a new counted string needs
    both halves in `JOURNAL_COPY`.
  - **Both vocabulary views call `loadAll()`, which loads the whole history** — `1970-01-01` to
    today, replacing the provider's month. They are the first screens that render a *number*
    rather than a mark, and a month's window would make the remove dialog's sentence untrue.
    B1/B2 and G2 should keep this in mind: `range` is whatever the last screen asked for, and a
    screen that needs a month must ask for one on mount (the day view does).
  - **A9's counts read `entries`, never `days`.** That closes A6's stale-`days` follow-up for
    these two screens without changing `createEntry`; the note stands for anything else that
    renders a count.
  - **The copy rail can match filled templates by shape.** `JournalTriggers.test.jsx` turns
    every `JOURNAL_COPY` string containing `{x}` into a regex with `.+` in its place, so a
    number or a label dropped into a sentence passes while a sentence nobody wrote still fails.
    That is strictly better than A8's "list each filling explicitly" and is worth copying.
  - **Fixture row ids must be distinct.** `JournalTriggers.test.jsx` first derived a row `ID`
    from the client id, and two fixtures collided on `1`; a merge then looked like it removed
    *both* rows, because `createEntry` drops `row.ID === created.supersedes_id`. The suite was
    red for a real-looking reason that was entirely the fixture's.
  - **`Journal.jsx` is now the journal's shared-UI module** as well as the day view. Put a chip
    or a shell piece both vocabulary screens need there, not in a third file — the day view's
    colours are the ones that must not drift.
  - **`readTrigger` indexes the vocabulary on every call.** `summarizeTrigger` takes a
    `resolve` function rather than calling it inside the loop, so walking every check-in for
    every trigger stays one pass. Anything that resolves in bulk should do the same.
  - **`docs/08-testing.md` had no section for `journal_test.go` at all** before this session;
    A9 added a short §2.2b. **A10's doc pass should fill in A2–A4's cases**, which are recorded
    in this ledger and nowhere in the docs.

---

**A10 — 6-A closeout: docs, QA, review** · 2026-08-22 · commit `—` (not committed)

- **Shipped:** slice 6-A closed. The full manual QA run against a real stack, three defects
  found and fixed, thirteen documents brought back into line with the code, a `/code-review
  high` pass and a `/simplify` pass. **No new feature.** Files that changed for reasons other
  than documentation: `Vault.jsx` + `Vault.test.jsx` (two copy fixes), `relationships.go` +
  `relationships_test.go` (`mention_count`, scoping, the fan-out fix), `RelationshipDialogs.jsx`
  + `Dashboard.test.jsx` (the §7.3 delete sentence), `SubjectsContext.jsx` (pass the count
  through), `journal.go` + `journal_test.go` (two scoping fixes), `vault.go` (import dedup and
  an N+1), `journal.js` + `JournalContext.jsx` + `JournalTriggers.jsx` (the trigger index),
  `contextTags.js` (new), `ContextCapsule.jsx`, `CheckinComposer.jsx`, `Journal.jsx`,
  `domain/categories.go`.

- **Verified:** `npm test` **22 files / 511 tests green**, 20.2 s. `cd backend && go test ./...`
  **green**, handlers 10.1 s. `go vet ./...` **clean**. Formatting **genuinely clean** — the
  line-ending-insensitive walk under *Warnings* prints empty; plain `gofmt -l .` still lists
  every CRLF file and always will. `npx vite build` **succeeds**, 5.8 s.
  `make migrate-check-local` against a **seeded Phase-5 database**: before, exactly
  `missing table "journal_entries"` and `missing table "journal_mentions"` and nothing else;
  after `go run ./cmd/migrate`, *schema is up to date*, with the Phase-5 user, two
  relationships and three snapshots intact. That is the evidence for the roadmap invariant
  edit below.

### The manual QA run (§11's 6-A list), on a real backend and a real browser at 360 × 800

Every item was done against a Phase-5 database migrated forward, not against fixtures.

| # | Item | Result |
| :- | :--- | :----- |
| 1 | Ritual under 60 s with a thumb, 360 dp | **PASS.** Worst-case deck (5 core + 3 optional + *Who?* + Done + day word) = **11 interactions, 17.2 s** at a deliberate 1.5 s each; ~90 ms of that is the app. 60 s allows 5.4 s per interaction — ~3.5× headroom. No scroll in either axis throughout |
| 2 | Skip a question, export, key absent | **PASS.** `caffeine_late` appears **once** in the export, inside `question_set.asked`, and never in `answers`. Absent, not `false` |
| 3 | A missed night leaves no trace the next day | **PASS.** The day before reads *"Nothing recorded for this day."* — no counter, no reference to the ritual, no forbidden word |
| 4 | Journal person → snapshot from the dashboard = one relationship | **PASS.** *Nadia K* created by a check-in, then snapshotted: one relationship (`ID 3`), `snapshot_count` 0 → 1, the journal mention still on the same id. The dashboard's name field offered her in its `datalist` (A7's deferred discoverability gap, confirmed closed) |
| 5 | *work* in three check-ins → one trigger, three entries | **PASS.** One `kind: "trigger"` row; three check-ins carrying its `client_id`; the triggers view says *"3 entries name this."* Typing `WORK` offered the existing `work` **and** *New trigger: WORK?* — matched case-insensitively, never auto-selected |
| 6 | Merge two triggers → every entry shows the survivor | **PASS**, and it demonstrated §7.1 end to end: all four check-ins render *the commute*, while the three written before the merge **still carry the original id in their stored payload**. The writer rewrote nothing; the reader resolved through `corrects` |
| 7 | Rename / merge / delete a relationship → §7.3 | **PASS on data, FAIL on copy → fixed.** Rename: mention keeps `label: "Nadia K"` as a quotation and renders the current name. Merge: `mentions_moved: 1`, mention moved, label kept. Delete: entry survives, *"Who? Lucie M"* still reads from the label. **The dialog did not name the journal at all** — see defect 1 |
| 8 | Discretion masks the day list, People and Triggers | **PASS.** Names → initials (`N. K.`, and the ritual's *Who?* card → `L. M.`), trigger labels → `blur(3px)` with hover reveal, tab title → *Notes*. All three views |
| 9 | App lock covers every journal route | **PASS.** All six — `/journal`, `/journal/:day`, `/journal/ritual`, `/journal/people`, `/journal/people/:id`, `/journal/triggers` — render the lock and leak no content behind it |
| 10 | Export → wipe → import → identical | **PASS.** Wiped the database, re-created the account, imported: `journal_entries_created: 11`. Re-exported and compared — **the whole document is identical** modulo `exported_at` and snapshot `created_at`. The merge chain survived and still resolves. Re-importing the same file: `journal_entries_skipped: 11`, nothing created |

**No stop-and-ask was needed.** §3.3's optional tail does not have to shrink; the measurement
is in *Measured* below and §3.3 now carries it.

### Defects found and fixed

1. **The relationship delete dialog said nothing about the journal**, contrary to §7.3, which
   specifies the copy. `docs/03` even said *"so the dialog can state it"* — and it did not.
   The server already returned `mentions_detached`, but only **after** the fact; the dialog
   needs the number **before**. Fixed the way §7.3 anticipated: `mention_count` added to
   `summaryQuery`, threaded through `buildStacks`, and the dialog now says *"2 journal
   mentions of them stay: the entries are still there, and will no longer be linked to a
   person."* — omitted entirely at zero, per A9's counted-sentence rule. Verified on the
   running app.
2. **`mentions_detached` counted rows the user could not see.** `DeleteRelationship` counted
   `WHERE relationship_id = ?` with no join, so mentions on soft-deleted *and* superseded
   entries were included — it reported **2** where one live entry named the person. Harmless
   while nothing rendered it; wrong the moment the dialog did. Both it and the new
   `mention_count` are now scoped to the entries the journal shows.
3. **`DeleteJournalPerson` had the same bug, and its dialog was already stating the number.**
   Found by the altitude reviewer, not by me. The two `Pluck`s carried the soft-delete scope
   but not `superseded_at IS NULL`, so `facts_deleted` and `mentions_detached` counted
   superseded rows while the dialog's *before* count came from `GET /api/journal/entries`,
   which excludes them: a user who had corrected anything was told *two facts go* and then
   four went. Fixed so that **what is acted on and what is counted are deliberately different
   sets** — every fact goes and every mention detaches, superseded included, because those are
   still statements about that person and still in the export, but the two *numbers* cover
   only what the journal shows. `TestDeleteJournalPersonCountsOnlyTheEntriesTheJournalShows`
   was written red first.

### The review pass

`/code-review high` over the whole slice produced three findings.

- **Fixed — the minted-trigger path accepted a superseded trigger.** `{"trigger": id}` is
  refused with 404 for a renamed or merged-away trigger; the same id sent as
  `{"label": …, "client_id": id}` went down find-or-create, which matched on
  `(user_id, client_id)` and `kind` alone, and was accepted. **Confirmed against the running
  server**, both shapes, before and after. Unreachable from today's UI, which mints a fresh
  UUID — but F1's outbox replays raw POSTs, which is exactly where it becomes reachable.
  `TestCreateJournalEntryRejectsASupersededTrigger` now covers both shapes.
- **Recorded, not fixed — `createEntry`'s un-awaited `refresh()` can drop a concurrent
  check-in.** See *Deferred*. Display-only, narrow, and F1 owns `createEntry`.
- **Recorded, not fixed — `applyJournal` relinks corrections only for rows it created.** See
  *Deferred*. Needs hand-split export files to reach.

`/simplify` produced 30 findings across reuse, simplification, efficiency and altitude. Seven
were taken (below). **What was rejected, and why:**

- **`FeelingChip`'s markup duplicated in `PickedFeeling`** — real, but replacing it changes
  rendering the QA run had just validated, and the fix is a shared chip module. `chipClass`,
  the byte-identical half, was fixed; the markup half is in *Deferred*.
- **Entry-request builders living in components; `schema_version: 1` as a bare literal in
  four places** — a correct altitude finding. It is a cross-file refactor of the write path,
  and F1 rewrites that path for the outbox. Deferred there.
- **`token ? <X/> : <Navigate/>` on all ten routes** — a genuine improvement (one layout route
  with an `Outlet`), and out of scope for a closeout that must not touch routing.
- **Journal-flavoured counted copy in `RelationshipDialogs.jsx` and `Vault.jsx` outside
  `JOURNAL_COPY`** — including the sentence *I added today*. Rejected on purpose: neither file
  is a journal screen, and importing `JOURNAL_COPY` into the dashboard's dialogs would couple
  the snapshot half of the app to the journal's copy module to buy coverage by a walk that is
  scoped to journal screens. Both new sentences are pinned verbatim by tests instead.
- **`humanMinutes` has no caller** — true, and B2 supplies one. It is tested; leaving it is
  cheaper than deleting and restoring it.
- **`DeleteJournalPerson`'s id lists could exceed `SQLITE_MAX_VARIABLE_NUMBER`** — real at a
  scale nobody is at. Deferred with the other performance items.
- **Double JSON round-trip per payload on import**, **`loadAll` refetching the whole history
  on every People↔day navigation**, **`summarizeTrigger` re-scanning all entries per trigger**
  — all real, all deferred to a change that can measure them. The one exception is the index
  rebuild, which was fixed because two comments in the code *claimed* it had been.

**Taken from `/simplify`:**

1. **`summaryQuery`'s fan-out — a regression I introduced this session and the reviewer
   caught.** My first `mention_count` joined `journal_mentions` and `journal_entries` straight
   onto the query every screen issues on load and after every mutation. `COUNT(DISTINCT …)`
   made it *correct*, and quadratic: 40 snapshots × 2,000 mentions is 80,000 intermediate rows
   for one person, growing in both dimensions forever. Rewritten as a **pre-aggregated
   subquery**, so the journal side contributes one row per relationship and `snapshot_count`
   goes back to a plain `COUNT`. `TestMentionCountsCoverOnlyTheEntriesTheJournalShows` pins
   `snapshot_count` at 2 rather than 6 for exactly this.
2. **`readTrigger` rebuilt its index on every call, and two comments said it did not.**
   `JournalTriggers.jsx` said *"Bound once here, it stays one pass"* and `summarizeTrigger`'s
   docstring said the `resolve` parameter was *"the difference between one pass and a
   quadratic one"* — but the `resolve` supplied called `readTrigger(id, array)`, which indexes
   from scratch each time. `indexTriggers` is now exported, `readTrigger` takes a `Map` or the
   rows, and `JournalContext` memoises the index on `triggerEntries`. A false comment in this
   codebase is a defect; the fix makes both sentences true.
3. **`applyImport` still inlined the body of `findOrCreateForImport`**, the helper extracted
   from it, so one file resolved people two ways.
4. **The import resolved a relationship per *mention***, two queries each — thousands of round
   trips to learn the same few ids. One `importPeople` cache now serves both halves of an
   import, so `relationships_created` also cannot be counted twice.
5. **`src/constants/journal.js` imported from a React component** while its own header claimed
   *"Nothing in this file renders, imports React, or talks to the network"* — a claim
   `journalSettings.js` leans on, and `MobileBottomNav` pays for. The three shared tag
   constants moved to `src/constants/contextTags.js`; `ContextCapsule.jsx` re-exports them.
6. **`chipClass` was byte-identical in two files.** Defined once in `CheckinComposer.jsx`
   (`Journal.jsx` imports it, so the other direction is a cycle) and re-exported.
7. **Three small ones:** `domain.IsCategoryID` now uses `containsID` rather than its own copy
   of the loop; `parseJournalRange` no longer parses `to` twice with an unreachable error
   branch; a `useMemo` in the composer that bundled three values read once inside a handler is
   gone.

### Is every Vault claim still true?

**Yes — after two changes, both of which the ledger had already assigned to this session.**

- *"Every request goes to this app's own origin"* — true; nothing in 6-A adds a network call.
- *"There are no AI features, by design. Nothing here infers, scores, or interprets on your
  behalf — every number in this app is one you set yourself."* — **true, and re-read
  deliberately.** 6-A contains no model and no microphone. Candidate matching is
  exact-then-case-and-diacritic string comparison that never auto-selects; *"most often"* is a
  count of the user's own rows; `duration_ms` is a stopwatch. §10.1 puts the change at **6-C**,
  when the transcriber ships — and §10.2's voice-off variant must **not** be written now,
  because it describes a feature that does not exist yet. The one sentence a pedant could
  press is *"every number… is one you set yourself"*: `duration_ms` and `tz_offset_min` are
  recorded, not authored. Neither is shown, and neither is a number *about the user's
  feelings*, which is what the sentence is about. Left as it is.
- *"Is it encrypted? No…"* — **was incomplete, now fixed.** It said *"your notes and scores"*,
  and a journal entry is neither a note nor a score in this app's vocabulary. It now names the
  journal in the journal's own words. It promises **nothing** about later: docs/13 is an
  unconfirmed option, and per the S0 warning no Vault sentence may imply a schedule.
- *"This locks the screen, it does not encrypt the database"* — true, and QA item 9 exercised
  it across all six journal routes.
- **The "Your data" paragraph** was the other gap A4 left. *"Everything you have written is
  stored in…"* was followed by a count of relationships and snapshots only, while `/api/meta`
  had carried `journal_entry_count` and `oldest_journal_day` since A3 and nothing showed them.
  It now counts journal entries too, names the kinds so the number is readable, and is
  **omitted entirely** when the journal is empty. Its month comes from a new `monthOf`, which
  reads the civil-day string by its parts — `new Date('2026-08-01')` is UTC midnight and
  renders as *July* west of Greenwich.

`Vault.test.jsx` asserts both new sentences verbatim (invariant 2e), and `docs/06 §3c`'s claims
table records the reasoning for each.

### The documentation sweep

`docs/01` (check-in, trigger **and the ritual** as vocabulary; the journal computes nothing;
encryption covers the journal) · `docs/03` (the SQLite-file row, which was wrong in both
directions) · `docs/04` (`mention_count`, and both delete endpoints' counting scope) ·
`docs/05` (the "six of the seven protected handlers" line, which predated Phase 4 — there are
twenty; `summaryQuery`; `DeleteJournalPerson`) · `docs/06` (§3c re-read and expanded) ·
`docs/08` (A2–A4's backend cases, which A9 flagged as living only in this ledger; the
relationship/journal mention tests; the counts, which said 291 in one place and 506 in
another) · `docs/10` (invariant 3's stale *"when the frontend half lands"*, invariant 14
extended to journal payloads, **two new traps** — the `asked`-vs-`answers` one the prompt
suggested, and a client-id-vs-row-id one the QA run produced — and **Recipe 9, add a journal
entry kind**) · `docs/11` (the SQLite entry was simply wrong, and a second entry described the
same file mid-removal) · `docs/12` (verified complete from A8/A9, unchanged) · `docs/13` (the
journal rows added to §0's register, with the shape reasoning and an explicit *this is a
register, not a plan*) · `docs/README` (six journal rows in the source-of-truth map, and
docs/13 added to a reading-order table that had never listed it) · `product_vision/README`
(the two §10.4 edits, plus Phase 6 in a table and a graph that stopped at five) ·
`product_vision/06-emotional-journal` (status line, §3.3's measurement).

**`docs/12` needed nothing** — A8 and A9 had already written the fifth nav slot and the
ritual's touch-axis exception, with measured numbers. Re-read and confirmed rather than
assumed.

### Measured

- **Bundle after A10: 897.65 kB raw / 273.27 kB gzip.** Against S0's pre-journal baseline of
  813.17 / 250.38, **the whole of slice 6-A costs +84.48 kB raw / +22.89 kB gzip** — about
  9 % of the main chunk for two tables, five endpoints, six routes and five screens. CSS
  41.73 / 7.33, up 3.62 / 0.46. A10 itself added **+1.07 kB raw / +0.25 kB gzip** over A9.
  **This is the number C3 and D3 are measured against**, and the point of measuring it now:
  6-A is the whole manual journal and it costs 23 kB gzip, so a transcriber that costs
  megabytes has to keep them out of this chunk entirely.
- **The ritual, worst case, at 360 × 800:** 11 interactions, 17.2 s driven at 1.5 s each;
  ~90 ms per card is the app's own share. `duration_ms` on the stored row read 29.8 s for the
  same pass, because the app's clock starts when the screen mounts and the harness idled
  before the first swipe — worth knowing before anyone reads that field as a user timing.
  §3.3 now carries the number and states plainly that the pace was chosen, not observed.

### Deferred

- **Not fixed by design:** the `(verify)` markers left in the design document are all
  **model-download sizes** for 6-C/6-D. None is resolvable by 6-A; every marker 6-A could
  resolve was resolved by A8/A9 and is in *Measured* above.
- Everything else is in *Deferred and follow-ups*, with the reviewer's own numbers.

### Next session should know

1. **6-A is closed and every document is true of the code as of 2026-08-22.** B1 can start
   from the design document without cross-checking it against the ledger first — which has not
   been true at any earlier point in this phase.
2. **Nothing is committed.** The whole of Phase 6 is still one uncommitted working tree on
   `app-improvements`. `git diff main...HEAD` is *not* the 6-A diff — it is the pre-existing
   branch work. The slice is `git diff HEAD` plus the untracked files.
3. **`mention_count` is now on every relationship summary.** If you add another aggregate to
   `summaryQuery`, pre-aggregate it in a subquery — do not join the raw table. The comment
   there explains why, and a test pins `snapshot_count` against the fan-out.
4. **`readTrigger` takes a `Map` or the rows.** Resolving in bulk means passing
   `triggerIndex` from `JournalContext`. Passing the array still works and still rebuilds.
5. **B1 inherits an open question from A8**, unchanged: a `source: "ritual_word"` check-in
   carries **no `intensity`**, so `buildDayCurve` must decide what an intensity-free sample
   draws at, as a stated constant in the ⓘ sentence rather than a silent 2.
