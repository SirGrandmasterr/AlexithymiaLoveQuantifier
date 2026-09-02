# `golden/audio/` — where the recordings go

This directory is empty in the repository and full on the machine that runs
`make journal-eval`. Everything below is what `scripts/journal-eval/audio.mjs` looks for; if
a file is not named and placed like this the harness will not find it, and
`make journal-audio-check` will say so by name.

## 1. The shape

```
src/journal/inference/golden/audio/
├── README.md                     ← this file, tracked
├── .gitignore                    ← tracked; the audio itself is not
├── manifest.lock.json            ← tracked; written by `make journal-audio-check`
├── sp01/                         ← one directory per speaker
│   ├── lucie.en.clean.wav
│   ├── lucie.en.noisy.wav
│   ├── lucie.de.clean.wav
│   └── …
├── sp02/
│   └── …
└── tts-de-female-a/              ← a synthesised voice is a speaker too
    └── …
```

**One directory per speaker, flat inside it.** No `en/` or `de/` sub-directories — the
language is already in the case id, and a second place to state it is a second place to get
it wrong.

## 2. The file name

```
<case-id>.<condition>.<extension>
```

| Part | What | Examples |
| :--- | :--- | :------- |
| `<case-id>` | The `id` of a case in [`../transcripts.json`](../transcripts.json), verbatim. It already ends in `.en` or `.de`. | `lucie.en`, `two-triggers.de`, `short-utterance.en` |
| `<condition>` | `clean` or `noisy`. Nothing else. | `clean` |
| `<extension>` | `wav` for a finished clip. `m4a`, `mp3`, `ogg`, `opus` and `flac` are accepted and converted by `prepare-audio.sh`. | `wav` |

So: **`sp01/tag-milestone.de.clean.wav`**. Lower case throughout; the ids are lower case and
some filesystems here are not case-sensitive, so a capital letter is a file that works on one
machine and not the next.

Every case needs **both** conditions and **both** languages. The full set is
**120 cases × 2 conditions = 240 clips**, and they do not all have to come from one speaker:
several people may record the same case, and the harness evaluates every clip it finds
rather than picking one. More voices on the same sentence is better evidence, not duplicate
evidence — a per-id recall that only holds for one voice is a fact about that voice.

## 3. The speaker directory

`sp01`, `sp02`, `sp03`… for people. `tts-<something>` for a synthesised voice. The id is
what appears in the report and in the consent register; it is **not** a name, and no name
belongs in a file name or a directory name here.

**A speaker directory with no consent record is skipped, loudly.** Every `spNN/` must have a
matching `../consent/spNN.md` and a row in `../consent/speakers.json`, or
`make journal-audio-check` reports `no consent record` and `make journal-eval` refuses to read
the clips. That is the mechanism behind §5.7's *"consent for any real clip is recorded
alongside it"*: not a promise, a check. A `tts-` directory needs the same row, with
`"kind": "synthetic"`, which is how the report can separate synthesised WER from human WER —
they are not the same number and should never be averaged into one.

## 4. What to record

The words are in [`../transcripts.json`](../transcripts.json), and the readable version of
them — every case in order, with its file name printed beside it — is generated into
[`../../../../product_vision/eval/recording-script-en.md`](../../../../product_vision/eval/recording-script-en.md)
and [`recording-script-de.md`](../../../../product_vision/eval/recording-script-de.md):

```bash
node product_vision/eval/build-recording-scripts.mjs
```

Print or open the one for the language the speaker actually speaks. **German is not a
translation exercise:** a German case should be read by someone who speaks German, and an
English case by someone who speaks English, or the WER comparison in §5.7's gate measures
accents rather than languages.

Read the sentence as written. If a speaker would naturally say it differently, that is worth
knowing — but change it in `transcripts.json`, in both halves of the pair, and re-run
`npm test`; do not improvise at the microphone, because the reference transcript is the
denominator of that clip's WER.

Six of the cases carry a direction beyond the words, and the recording script prints it:

| Case | How to say it |
| :--- | :------------ |
| `quiet-voice.*` | Quietly, close in, the way somebody actually says this |
| `emphatic.*` | Loud, close, let it clip a little |
| `fast-list.*` | Fast, no pauses between the items |
| `filler-heavy.*` | With the fillers, the false start and the rising question |
| `long-run-on.*` | One breath group, no full stops in the delivery |
| `short-utterance.*` | Just the two words, nothing before or after |

## 5. The two conditions

**Clean** is a quiet room, 20–30 cm from the microphone, no music and no second voice.

**Noisy** is the same words in the condition §12.1 calls certain for café check-ins. Either
is fine, and the lock file records which:

- **Recorded noisy** — the same sentence said again in a café, on a tram, with a fan on.
  This is the better evidence and the slower path.
- **Derived** — a noise bed mixed into the clean take at a stated signal-to-noise ratio:

  ```bash
  bash scripts/journal-eval/prepare-audio.sh --noise --snr 10
  ```

  Reproducible from the seed it prints, which means a later run can regenerate exactly the
  clips the report was written from. Not as good as a real room, and the report must not
  claim it is.

Mixing the two across the suite is fine as long as the report says which cases were which —
`manifest.lock.json` carries `"noise": "recorded"` or `"noise": "derived"` per clip, and the
report prints the split.

## 6. Format

16 kHz, mono, 16-bit PCM WAV. That is what both transcribers want — Whisper resamples to it
and Gemma 4's audio encoder is documented at it — so recording anything else means a
resample that somebody has to get right, silently, in the middle of the measurement.

Record on whatever is to hand, including a phone, then convert everything in one pass:

```bash
bash scripts/journal-eval/prepare-audio.sh
```

It walks every speaker directory, converts any accepted extension to canonical WAV beside
the original, leaves already-canonical files alone, and needs `ffmpeg` on `PATH`. It never
deletes the original.

Then:

```bash
make journal-audio-check
```

which prints, per case and condition, whether a clip exists, whether it is the right format,
how long it is, and its SHA-256 — and writes `manifest.lock.json` so that a later run can
tell a re-recorded clip from an unchanged one. **A report that names a lock file hash is a
report a later session can reproduce.**

## 7. Why the clips are not in the repository

`.gitignore` in this directory keeps every audio file out of git. Three reasons, in order of
weight:

1. **They are recordings of identifiable people saying sentences about named third parties.**
   §12.1's *third-party sensitivity* row is about the journal's own data; a voice clip is the
   same problem with a biometric on top. Consent to be recorded for an evaluation is not
   consent to be committed to a repository that may be cloned, forked or published.
2. Roughly 240 clips at 16 kHz mono is 40–80 MB that every clone would pay for and almost no
   clone would use.
3. The suite's evidence is the **report**, which is checked in, names the lock file's hashes,
   and is reproducible against a directory of clips held wherever the operator keeps them.

**To reverse this**, delete the `.gitignore` in this directory and commit. That is the whole
of the change, and it is the operator's call — but get the speakers' consent to publication
first, and record it in `../consent/`, because the consent form they signed says evaluation,
not distribution.

Back the clips up somewhere. They are the expensive part of this suite; the harness around
them is a morning's work and re-recording 240 clips is not.
