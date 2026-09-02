# `scripts/journal-eval/` — the model gate

The out-of-band evaluation harness of
[`06-emotional-journal.md`](../../product_vision/06-emotional-journal.md) §5.7. It drives a
candidate model through the golden suite at temperature 0 with the output schema as its
grammar, scores it with **the app's own** `validateProposal`, and writes the report the gate
is applied in.

> **A model does not become a tier default until its numbers are in a checked-in report**
> under `product_vision/eval/`. That is the whole purpose of this directory.

## Start here

```bash
make journal-eval CANDIDATE=reference
```

Needs no weights and takes about two seconds. It answers every case with the golden suite's
own hand-written proposal, so a perfect score means the scoring, the aggregation and the gate
are wired together correctly — and means nothing whatever about any model. Run it first on a
new machine; if it is not perfect, fix that before believing anything else here.

```bash
make journal-eval                      # the tier defaults — what the gate is about
make journal-eval EVAL_ARGS=--help     # the candidate list
make journal-audio-check               # which recordings exist, and whether they are usable
make journal-eval-scripts              # regenerate the printable recording scripts
```

## The files

| File | What |
| :--- | :--- |
| `run.mjs` | The orchestrator. `make journal-eval` runs this |
| `candidates.mjs` | What a run is *of*: model, packaging, runtime, mode, device. The report names all five |
| `runners.mjs` | The four ways to ask: `reference`, `replay`, `llama-mtmd-cli`, `litert-lm` |
| `wer.mjs` | Word error rate, and the normalisation that decides what counts as an error |
| `score.mjs` | Per-id precision/recall, ambiguity accuracy, the *must* lists |
| `gate.mjs` | §5.7's four criteria, and the one threshold §5.7 leaves to be stated |
| `audio.mjs` | Clip discovery, the consent check, the WAV probe, the lock file |
| `audio-check.mjs` | `make journal-audio-check` |
| `pins.mjs` | The model revisions, read out of the Makefile rather than copied |
| `load.mjs` | The esbuild bridge that lets `node` import the app's own modules |
| `paths.mjs` | Repo root and today's date, kept apart from `load.mjs` so the tests can use them |
| `report.mjs` | The Markdown and JSON the run writes |
| `prepare-audio.sh` | ffmpeg: phone recordings → canonical WAV, and the derived noisy half |
| `*.test.mjs` | **In `npm test`** — see below |

## Why some of this *is* in `npm test`

The D4 prompt says not to put the eval in `npm test`, and it is not: nothing in the fast suite
loads a weight, starts a process or reads a clip. What the fast suite does cover is the
arithmetic — `wer.test.mjs`, `score.test.mjs`, `gate.test.mjs`, `runners.test.mjs`, 70 tests
in about 40 ms.

That split is the point. A wrong word error rate or an off-by-one in a gate threshold would
not fail loudly; it would put a wrong number into a checked-in report that a later session
treats as evidence. The expensive half stays out of `npm test` because it needs weights and
minutes; the half that decides what a number *means* stays in, because it is cheap and because
being wrong there is expensive.

`score.test.mjs` also runs all 120 golden references through this directory's `satisfies`,
which is the same reading `src/journal/inference/validate.test.js` applies. If the two ever
drift, a model would be graded by one standard and the suite's own answers by another.

## Running a real candidate

The harness does not download anything and does not know where your weights are. Point it at a
binary and a model through the environment:

```bash
make journal-eval CANDIDATE=full-web \
     JOURNAL_EVAL_LLAMA_BIN=/opt/llama.cpp/build/bin/llama-mtmd-cli \
     JOURNAL_EVAL_MODEL=/weights/gemma-4-E2B-it-Q4_K_M.gguf \
     JOURNAL_EVAL_MMPROJ=/weights/mmproj-gemma-4-E2B-f16.gguf
```

| Variable | For |
| :--- | :--- |
| `JOURNAL_EVAL_LLAMA_BIN` | The `llama-mtmd-cli` binary |
| `JOURNAL_EVAL_LITERT_BIN` | The LiteRT-LM CLI |
| `JOURNAL_EVAL_MODEL` | The weights: a GGUF, or a `.litertlm` bundle |
| `JOURNAL_EVAL_MMPROJ` | llama.cpp's multimodal projector, for the audio pass |
| `JOURNAL_EVAL_REPLAY` | A capture file, for a candidate that runs on a phone |
| `JOURNAL_EVAL_LLAMA_ARGS`, `JOURNAL_EVAL_LITERT_ARGS` | Replace the whole argument template |
| `JOURNAL_EVAL_EXTRA_ARGS` | Append to it |

**The default argument templates in `runners.mjs` have not been run against a real binary from
this repository.** There is no llama.cpp and no LiteRT-LM build on the machine D4 was written
on, and claiming otherwise would be the one kind of dishonesty an evaluation harness cannot
afford. They are taken from the two projects' documented interfaces; if your build spells a
flag differently, override the template rather than patching the file, and check the report's
*Command* row — it prints what actually ran.

What must not change, whatever the flags are called: **temperature 0 and a schema.** §5.7's
gate is a claim about a model, not about one sample from one.

## Running a candidate that lives on a phone

Android has no CLI to drive: LiteRT-LM runs inside the app's own plugin, and the platform
recogniser only exists on a handset. So the device produces a capture and the harness scores it
with exactly the same code as a local run — because the alternative is two scoring paths, which
is how two tiers end up graded differently and nobody notices.

```json
{
  "device": "Pixel 8a, Android 15, LiteRT-LM 0.x",
  "answers": {
    "lucie.de|clean": { "raw": "{\"transcript\":\"…\"}", "ms": 4120, "peak_bytes": 2810000000 },
    "lucie.de|noisy": "…"
  }
}
```

```bash
make journal-eval CANDIDATE=light-android-whisper JOURNAL_EVAL_REPLAY=captures/pixel-8a.json
```

`ms` and `peak_bytes` are optional and are used where present: a figure measured on the device
is better than anything this harness could sample, and §12.1's memory row wants the device's
number, not a desktop's.

## What the harness measures, and what it does not

**Peak memory is sampled**, from the child process, every 100 ms. A spike shorter than that is
missed, so the figure is a floor rather than a peak, and the report says so. The number §12.1
actually asks for — peak with the audio encoder loaded, on the oldest supported phone — comes
from a device profiler and the QA checklist, and reaches a report through the replay file.

**Latency is wall clock for the whole process**, which on a CLI includes loading 2.6 GB of
weights. That is the honest number for "how long did this run take" and the wrong number for
"how long does a check-in take in the app", where the model is already resident. A report
should say which it is quoting.

**A text-mode candidate is scored over the golden transcripts unless you pass
`--hypotheses`.** The Light tier transcribes first and proposes second; scoring it over perfect
transcripts hides exactly the error cascade §5.1 gives as the reason the Full tier is one pass.
The report prints that caveat whenever it applies. To close it, run the tier's own transcriber
over the clips and pass its output:

```json
{ "transcriber": "whisper-tiny int8, onnxruntime 1.24.3",
  "transcripts": { "lucie.de|clean": "Ich hatte heute einen schönen Tag mit Lucy …" } }
```

## The gate

Four criteria (`gate.mjs`), three of them §5.7's own numbers and the fourth stated by D4 with
its reasoning in that file. A run that fails one is `fail`; a run that could not measure one is
`incomplete`, which is **also not a pass** — a criterion nothing was measured against has not
been cleared, and reporting that as success is precisely the mistake §12.1 warns about.

If a run says the thresholds are wrong, move them — in `gate.mjs`, and in the report, **with
the reasoning**. A threshold quietly loosened to make a model pass is the one failure this
whole directory exists to prevent.
