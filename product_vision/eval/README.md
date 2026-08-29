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

**A dated file in this directory is a claim that something was run.** Do not create one before
it was. The absence of `user-test-report-*.md` is how a later session knows the gate in
[`06-progress.md`](../06-progress.md) is still open.

Later sessions add to this directory: 6-D's model eval report, and 6-G's retrieval report
(§11).
