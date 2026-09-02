# Recording script — French (français)

**Generated from `src/journal/inference/golden/transcripts.json`. Do not hand-edit** — a word
changed here and not there becomes a permanent error in every word error rate computed from
the recording. To change a sentence, change it in the suite (in *both* halves of its pair),
run `npm test`, then re-run `node product_vision/eval/build-recording-scripts.mjs`.

1 sentence, about 3 seconds of speech. Read
each one **exactly as written**, twice: once for the clean take and — if you are recording the
noisy one in a real room rather than deriving it — once more there. Allow three or four times
the speech length in wall clock, for setup, re-takes and stopping between sentences.

## Before you start

- A quiet room. No music, no second voice, nothing running that hums.
- 20–30 cm from the microphone. A phone is fine; a phone held at arm's length is not.
- Say your speaker id out loud once at the start of the session, not into any clip.
- **These sentences are not about you.** They describe an invented person's day, with
  invented friends called Alex, Lucie and Sam. Nothing in them is true of anybody.
- Read the sentence, not the meaning. If a line feels wrong to say, say so afterwards —
  that is worth knowing — but read it as written for the recording.
- A mistake is not a problem: stop, pause, and say the whole sentence again. Only the last
  take needs to be in the file.

## Saving

One folder for you, named `sp01`, `sp02`, … (whichever you were given), inside
`src/journal/inference/golden/audio/`. Save each clip as the **File** column says, exactly.
Full instructions, including what to do with a phone recording, are in
[`audio/README.md`](../../src/journal/inference/golden/audio/README.md).

---

### 1. `other-language.en`

> J'étais tellement contente de voir Lucie aujourd'hui.

**File:** `other-language.en.clean.wav` — and `other-language.en.noisy.wav` for the noisy take.
**About:** 7 words, roughly 2.5 s.

**Note:** this sentence is in French (français) although the file name ends `.en`. That is deliberate; save it under the name above.

**How to say it:** The one pair whose halves swap languages on purpose, to find out whether the model reports the language it heard. The file name is the case id, not the language.
