# Model evaluation — YYYY-MM-DD (TEMPLATE)

**This file is the shape of a report, not a report.** `make journal-eval` writes
`model-eval-YYYY-MM-DD.md` for you, with every table already filled in from the run. What it
cannot write, and what this template is a reminder of, is the half a person has to add: what
the numbers mean, what moved, and what was decided.

Do not copy this file by hand. Run the harness, then write into the two sections it leaves
empty — *Reading* and *Decisions* — and add *What this run does not say* if the generated one
is not enough.

---

## What the generator produces

1. **What was run** — the date, the suite (cases, pairs, languages, ambiguity cases), the
   recordings found, the `suite_sha` of the lock file, the prompt version, the host, the
   commit.
2. **The thresholds this run was judged against**, and where each came from.
3. **One section per candidate**, each naming the model, the build and quantisation, the
   pinned revision, the runtime, the exact command, the input mode, the transcriber, the
   grammar and the device — then:
   - the gate, criterion by criterion, with pass / FAIL / *not measured*;
   - the numbers the gate reads;
   - WER by language and noise condition, and the German margin;
   - latency and peak memory;
   - precision and recall per feeling id;
   - the ambiguity confusion table;
   - the cases that failed, by name.

## What you write

### Reading

Not a summary of the tables — the tables are already there. What is worth writing:

- **The shape of the failures.** Which cases, and do they have anything in common? Twelve
  failures spread across the suite and twelve failures all in German are the same number and
  a different situation.
- **Whether a threshold should move**, with the reasoning. §5.7 says its numbers are *"to be
  revised after the first run"*, so revising them is expected — revising them *silently* is
  the failure mode. If one moves, say what evidence moved it, change `THRESHOLDS` in
  `scripts/journal-eval/gate.mjs` in the same commit, and note that the earlier reports were
  judged against the older number.
- **What the per-id table says about the vocabulary** (§5.3). An id the model never proposes
  and an id it proposes everywhere are both facts about the 21, not only about the model.
- **What the drop counts say about the prompt** (§5.4). A high `dropped_by_filter` with a
  passing gate means the validator is doing work the prompt should be doing.
- **Whether the run measured what it claims to.** Derived noise is not a café. A desktop
  llama.cpp pass is not the browser's WebGPU path. Say so here, not only in the caveat rows.

### Decisions

One line each, and each one repeated in [`../06-progress.md`](../06-progress.md) and in
§12.5 of the design document. The four the harness leaves headed:

| Question | Answer | Evidence |
| :--- | :--- | :--- |
| Is E4B a desktop-tier default? (§12.5) | | |
| Is the Android Light-tier transcriber Whisper or the platform recogniser on API 31+? (§12.5) | | |
| Does the single pass need a dedicated transcriber back on the Full tier? (§5.1) | | |
| Does any candidate become a tier default? | | |

**"Not enough evidence" is an answer**, and the right one when the run did not cover the
question. What is not an answer is leaving the row blank, or writing a decision the run does
not support. §5.1 is explicit about the third row in particular: record the evidence *before*
adding a model back.

### If the model clears English but not German

Stop. The harness prints a line saying so, and `clearsEnglishButNotGerman` in `gate.mjs` is
what detects it. §12.1 names the Light tier's Whisper as the fallback, but the choice between
falling back, shipping English-only with honest copy, and holding is a product decision, and
this app's likely first users are German-speaking (§12.4 question 8). Write the three options
and their costs here; do not pick one alone.

### What this run does not say

The limits of the evidence. At minimum: which devices were not touched, which runtime was
stood in for by another, how much of the noisy set was derived rather than recorded, and what
a second run should do differently.

---

## The rule this directory runs on

From [`README.md`](README.md): **a dated file here is a claim that something was run.** Do not
create one before it was. A run with no weights in it is named `harness-check-YYYY-MM-DD.md`
by the generator, not `model-eval-`, for exactly that reason.
