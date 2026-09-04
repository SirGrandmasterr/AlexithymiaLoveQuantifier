# The golden suite

The evidence about what the prompt in [`../prompt.js`](../prompt.js) does. Nothing in this
directory loads a model: in `npm test` these files are read by
[`../validate.test.js`](../validate.test.js) to prove the *contract* (every reference
proposal survives `validateProposal` unchanged, every adversarial output comes out
schema-valid and forbidden-word-free); `make journal-eval` (session D4) is what drives a
candidate model through them and reports the numbers §5.7 asks for.

| File | What | Read by |
| :--- | :--- | :------ |
| `contexts.json` | The fixture user — §4.7's three relationships and two triggers, once in English and once with German trigger labels. | tests, eval |
| `transcripts.json` | The cases: **120 transcripts in 60 English/German pairs**, each with a loose expectation and a full reference proposal. | tests, eval |
| `adversarial.js` | Raw *model outputs* — not transcripts — that the validator must survive. JavaScript rather than JSON because a 10 000-character label is `'x'.repeat(10000)` and a fixture should be readable. | tests only |
| `recordings.json` | The recording plan: one row per case, with its difficulty class, its length and the per-clip WER ceiling that class implies. | eval |
| `audio/` | Where the clips go. Empty in git — [`audio/README.md`](audio/README.md) says how they are named, where they live, and why they are not committed. | eval |
| `consent/` | Who agreed to be recorded, and to what. A speaker directory with no row here is **refused**, not skipped. | eval |

## The two halves

**Transcripts** are the text-mode suite and they work today: `npm test` reads them, and
`make journal-eval CANDIDATE=reference` scores them without a model.

**Recordings** are the audio-mode suite (§5.7) and they do not exist yet. 120 cases × a clean
and a noisy variant is **240 clips**, and `make journal-audio-check` will tell you at any
moment how many of them are on this machine. Until there are some, every audio-mode candidate
has nothing to run and the German-versus-English WER margin — §5.7's fourth gate criterion, and
§12.4 question 8 — is unmeasurable.

What a recording session needs is generated from this directory:

```bash
node product_vision/eval/build-recording-scripts.mjs
```

which writes `product_vision/eval/recording-script-{en,de,fr}.md` — every sentence in order,
with the file name to save it under and any direction the case carries. The sentences are read
from `transcripts.json`, not typed a second time, because a recording script that had drifted
by one word would put a permanent error into every WER computed from it.

## A transcript case

```json
{
  "id": "lucie.en",
  "pair": "lucie",
  "context": "en",
  "language": "en",
  "transcript": "I had a nice day with Lucie today and felt very connected to her, even though work was stressful.",
  "note": "§4.7, traced end to end in the design document.",
  "expect": {
    "ambiguity": "none",
    "must_include": ["pleasure", "rapport", "stress"],
    "must_not_include": ["anger"],
    "people": ["Lucie"],
    "trigger_labels": ["work"],
    "facts": []
  },
  "reference": { "…the full §5.2 object a correct model would return…" }
}
```

- **`expect` is loose on purpose** (§5.7): quantisation and runtime differences make exact
  matching brittle, so a model is scored on *must include* / *must not include* feeling ids,
  the `ambiguity` value, and — where the case is about them — the people it named and the
  trigger labels it reused. In `expect`, a list means *must include these*, an empty list
  means *none at all*, and an absent key means *no opinion*. `new_trigger: true` means a
  trigger label must be present that is **not** in the context's list.
- **`reference` is exact**, and it is what `npm test` reads: it must pass `validateProposal`
  byte-for-byte with nothing dropped, and it must satisfy its own `expect`. A reference that
  the filter would change is a wrong reference or a wrong filter, and the test does not say
  which — that is the point of running it.
- **Every pair has an `.en` and a `.de` case**, and the test asserts it. German is the
  language §12.1 says this app's users actually speak; an English-only suite would prove the
  prompt works for the wrong people.
- The transcript may contain anything a person might say, including every word on the
  forbidden list. It is never filtered (§5.4). The reference's `label` and `text` slots may
  not.

## Adding a case

Add both halves of the pair. Keep `id` as `<pair>.<language>`. Write the reference by hand,
as the answer you would want, then run `npm test` — the validator will tell you if the
reference asks for something the contract does not allow. Bump nothing: the suite has no
version, the prompt does.

## What the eval does with it

`make journal-eval` ([`scripts/journal-eval/`](../../../../scripts/journal-eval/README.md))
drives the default model of each tier through every case at temperature 0 with the schema as
the grammar where the runtime takes one, validates each answer with `validateProposal`, and
reports per-id precision and recall, ambiguity accuracy, WER per language and noise condition,
latency, peak memory, the new-trigger and known-trigger hit rates and `dropped_by_filter`
totals — into `product_vision/eval/`. The acceptance gate is §5.7's, and its numbers are to be
revised after the first run against a real model, in the report and with the reasoning.

## Adding a case, in full

1. Add **both** halves of the pair to `transcripts.json`, keeping `id` as `<pair>.<language>`.
2. `npm test` — the validator says whether the reference asks for something the contract does
   not allow, and `scripts/journal-eval/score.test.mjs` says whether it satisfies its own
   `expect`.
3. Add a row per half to `recordings.json`, naming a `difficulty` class. `make journal-audio-check`
   fails on a case with no row.
4. `node product_vision/eval/build-recording-scripts.mjs`, so the recording scripts carry it.
5. Record the four clips (two halves × clean and noisy) into `audio/<speaker>/`.
