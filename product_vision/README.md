# Product Vision — Execution Roadmap

Phases 1–6 have shipped. What remains here is the Phase 6 spec, the evidence directory, and
the two things a later session actually needs: the **invariants** below and the **Phase 7
carry-over**.

## Where the history went

These files were removed from disk once Phase 6 closed. They are unchanged in git at
**`49e2266`** — `git show 49e2266:<path>` to read one.

| Path | What it was |
| :--- | :---------- |
| `product_vision/Product_Vision.md`, `01-`…`05-*.md` | The shipped phases' specs (removed earlier, at `fcd28b4`) |
| `product_vision/06-implementation-prompts.md` | Phase 6's execution plan — 28 sessions, all run |
| `product_vision/06-progress.md` | Phase 6's session-by-session ledger, incl. *Deferred and follow-ups* |
| `product_vision/PROMPT-emotional-journal.md` | The kickoff prompt for the phase |
| `product_vision/eval/*.json` | Raw per-clip / per-case rows behind the `.md` reports beside them |

The dated `.md` reports in [`eval/`](eval/) stayed: a dated file there is a claim that
something was run, and that record is still the gate.

**Phase 6 closed on 2026-09-04.** Six of its seven slices are built; 6-E (encryption) was
deliberately not built. **Everything from 6-C onward is code no person has yet used** — no one
has tapped the microphone, no model has run on a phone, and the embedding weights have never
been loaded. The spec is [`06-emotional-journal.md`](06-emotional-journal.md); reference
documentation is in [`docs/`](../docs/).

## Invariants — no phase may violate these

- **Self-authored, never computed.** No hidden math. Any arithmetic shown to the user must be
  explainable in one sentence and must never overwrite a user-authored value. Inference runs
  on the user's device, is off by default, and *proposes*: nothing — a value, a label, a
  person, a trigger, a feeling — is written without a confirming tap, and it never touches a
  score.
- **Similarity may propose, never claim.** The journal may say *"you've called this 'work'
  before"* and may **never** show a number for how alike two things are. The vectors live on
  the one device that made them, are never sent or exported, and are deleted at sign-out. A
  suggestion is offered only when something the user confirmed agrees with it — the same
  person or the same trigger.
- **Search returns entries, not conclusions.** A day, a time, the user's own words. No
  summary, no trend, no match score. Words that were **found** are listed separately from
  entries that merely **look alike**: the first is checkable, the second is a guess.
- **The user authors every number and every label.** Suggestion bands never constrain the
  slider; deltas describe, never prescribe. A model's proposal arrives dashed and is discarded
  unless tapped.
- **Non-clinical posture.** Descriptive vocabulary only ("dominant", "most changed") — never
  evaluative ("healthy", "concerning"). "Alexithymia" names the motivating problem, not a
  screening feature.
- **The seven category ids are the stable contract.** `eros`, `ludus`, `storge`, `pragma`,
  `mania`, `agape`, `selflessness` — the `stats` JSON keys, the chart `dataKey`s, and the
  server-side validation allowlist. Taxonomy prose stays frontend-only.
- **Single-user, no social graph.** Nothing transmits anywhere; sharing is deliberate local
  export only. Model files travel one way, from the user's own server or app package to the
  device. Three consequences the code must keep: **audio is never stored or sent** (the mic is
  open only while the button is lit, the buffer is transcribed in memory and released);
  **weights are pinned and verified** (a revision plus a SHA-256 per file, checked before
  caching on web and before the `.part` rename on Android, which is what makes a one-way
  download over a cleartext LAN safe); and **the embedding index has no way out** — no
  endpoint, no export path, no request field, enforced by a test that walks every request the
  two screens produce. The offline outbox (§9.5) is the one thing held before transmitting: it
  queues journal entries only, posts to the same origin as every other write, and is named on
  the Vault page.
- **Additive schema changes only, outside Phase 4.** Nullable columns or whole new tables,
  compatible with `AutoMigrate` on SQLite and Postgres. Phase 4 owns the one structural
  migration. The journal adds two tables and touches no existing column, so
  `make migrate-check-local` against a Phase-5 database reports exactly `missing table
  "journal_entries"` and `missing table "journal_mentions"`.

## Carried into Phase 7

Written at the Phase 6 closeout, 2026-09-04. The first four are **why Phase 6 shipped verified
by construction rather than by use**; until they are done the phase's central bet — does
someone who finds feelings hard to name record more, and more honestly? — cannot be answered
either way. Most cannot be closed by writing code.

| # | Item | Who | Why |
| :- | :--- | :-- | :-- |
| 1 | **Run U1, the user test.** | Operator | The instrument has existed since 2026-08-25, waived on 2026-08-31. Five or six participants, four German-first, over eight days. The only thing that can correct §5.3's twenty-one feelings and the **valence/energy constants positioning every day-graph branch** — which have no evidence behind them — and the only source that answers the bet |
| 2 | **Put a phone on the project.** | Operator | Every manual checklist from 6-C on is unrun and all but 6-G's need hardware: the microphone, a model on a phone, the airplane-mode test, the nightly reminder, the launcher shortcut, the outbox in a tunnel. Three tier `(verify)` rows in §5.5 close with it |
| 3 | **Load a real model once, on any machine.** | Any session with the disk | `make journal-eval` exists with four criteria in code and **has passed nothing**, so no model is a tier default. EmbeddingGemma's 219 MB has never been fetched, `createWebEmbedder` never exercised, and `SIMILARITY_FLOOR = 0.65` is a guess. The retrieval set's eight semantic cases are the instrument |
| 4 | **Record the 240 golden clips.** | Operator | 120 cases × clean/noisy × German/English, consented speakers. Everything around them is built — sentences, per-clip WER ceilings, naming, consent register and its refusal path. Without them there is no German WER figure and §5.1's dedicated-transcriber question stays open |
| 5 | **Decide `person_fact`.** | Operator | Either confirm docs/13 and let 6-E run, or knowingly store verbatim text about a named third party in plain text. One line of consequence in code — `alreadyKnown` is built, tested and wired to nothing |
| 6 | **Empty the embedding index when the *toggle* goes off, not only at sign-out.** | Engineering | `writeEmbeddings(false)` writes a flag and drops the in-memory map; the IndexedDB rows stay. No copy is false — both the Vault and the settings row bind deletion to signing out — but embeddings are invertible, and a user switching the feature off expects the numbers to go |
| 7 | **A native embedding runtime.** | Engineering | The Android plugin's `embed()` rejects `unavailable`, so the phone shows a disabled toggle and **the Android shell has no recall and no search at all**. A missing runtime behind an existing seam, not a missing feature |
| 8 | **A *Suggest* button on the typed path.** | Engineering | §4.1 gives a typed sentence the proposal card too when the model is on. Both runtimes take text now; one button on the note field and one `propose` call |
| 9 | **Stream the weight download's hash.** | Engineering | The download manager reads a whole file into memory before hashing — fine for 1.59 GB on a 32 GB desktop; a 1.59 GB `ArrayBuffer` on a 6 GB phone is the untested failure |
| 10 | **Encryption, if docs/13 is confirmed.** | Operator | 6-E is written and never started. Nothing in the code must change for it to become possible — the row shape, the opaque payload, the ids-only mention table and an outbox that never inspects what it holds all keep the door open |

Two smaller findings from the closeout's `/code-review` and `/simplify` passes, recorded so
they are not rediscovered: the retrieval golden set's harness embeds **snapshot notes the
shipped index deliberately excludes**, so its semantic half scores an index the app never
builds; and `payload.retrieval` **drops the record of an accepted trigger suggestion** — the
one interaction the provenance block exists to count.

## Working conventions

- **Docs stay true.** When code and docs disagree, fix the docs in the same change
  ([source-of-truth map](../docs/README.md#source-of-truth-map)).
- **Tests per phase.** Backend `go test ./...`; frontend `npm test` (Vitest + Testing
  Library). The Playwright E2E suite is non-functional
  ([Known Issues](../docs/11-known-issues.md#the-e2e-suite-cannot-pass)) — do not use it for
  sign-off.
- **Follow the majority axios convention** (global `axios` with `App.jsx`'s default header),
  not `Profile.jsx`'s private instance.
- **Mind the `ID` casing trap** (`person.ID`, from `gorm.Model`) and the Tailwind JIT rule
  (complete literal class strings only).
- **Security hardening is tracked separately** in
  [Known Issues §Security](../docs/11-known-issues.md#security).
