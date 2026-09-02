# `product_vision/eval/`

Evidence, and the instruments that produce it. Nothing here is shipped: no file in this
directory is imported by `src/` or `backend/`, none of it reaches the bundle, and no route
renders any of it.

| File | What it is |
| :--- | :--------- |
| [`user-test-protocol.md`](user-test-protocol.md) | The §12.4 user test as a runnable protocol, with the decision rules fixed in advance |
| [`user-test-report-TEMPLATE.md`](user-test-report-TEMPLATE.md) | The report's shape. Copied to `user-test-report-YYYY-MM-DD.md` on the day a run closes |
| [`tally-feelings.md`](tally-feelings.md) | Sheet 1 — the feeling vocabulary, question 3 |
| [`tally-triggers.md`](tally-triggers.md) | Sheet 2 — triggers and search, question 4, which decides 6-G |
| [`proposal-card.html`](proposal-card.html) | The fixture proposal card for question 2. **Generated — do not hand-edit** |
| [`proposal-card.template.html`](proposal-card.template.html) | Its source. Edit this |
| [`build-proposal-card.mjs`](build-proposal-card.mjs) | `node product_vision/eval/build-proposal-card.mjs` — regenerates the card from `src/constants/journal.js` |

### The model gate (§5.7, session D4)

| File | What it is |
| :--- | :--------- |
| [`model-eval-TEMPLATE.md`](model-eval-TEMPLATE.md) | What a model-eval report has to contain, and which half of it a person writes |
| [`harness-check-2026-09-03.md`](harness-check-2026-09-03.md) | The harness driven through the golden suite with **no weights**, to prove its own arithmetic. Not a model evaluation, and named so it cannot be mistaken for one |
| [`recording-script-en.md`](recording-script-en.md) · [`-de`](recording-script-de.md) · [`-fr`](recording-script-fr.md) | What a person at a microphone reads. **Generated — do not hand-edit** |
| [`build-recording-scripts.mjs`](build-recording-scripts.mjs) | `node product_vision/eval/build-recording-scripts.mjs` — regenerates those three from the golden suite |

`make journal-eval` writes `model-eval-YYYY-MM-DD.md` (and a `.json` beside it, with every
per-clip row). It **refuses to overwrite an existing report**: the tables are generated, the
*Reading* and *Decisions* sections under them are not, and a second run on the same day would
otherwise replace an afternoon of reasoning with an empty heading. Pass `--force` when you mean
it. The harness itself lives in [`scripts/journal-eval/`](../../scripts/journal-eval/README.md).

**A dated file in this directory is a claim that something was run.** Do not create one before
it was. The absence of `user-test-report-*.md` is how a later session knows the gate in
[`06-progress.md`](../06-progress.md) is still open, and the absence of `model-eval-*.md` is
how it knows no model has cleared §5.7's.

Later sessions add to this directory: the first real model eval report, and 6-G's retrieval
report (§11).
