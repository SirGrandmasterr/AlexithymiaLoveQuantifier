# `golden/consent/` — the record that every voice agreed to be here

§5.7 asks that *"consent for any real clip is recorded alongside it"*. This directory is that
record, and it is enforced rather than promised: `make journal-audio-check` and
`make journal-eval` both refuse to read a speaker directory that has no row here, and say
which one.

| File | What |
| :--- | :--- |
| `speakers.json` | The register the harness reads. One row per speaker directory in `../audio/` |
| `CONSENT-TEMPLATE.md` | The form. Copy to `spNN.md`, fill in, keep |
| `spNN.md` | One per human speaker. What they agreed to, when, and in which language |

## The rules

1. **A speaker id is not a name.** `sp01`, `sp02`, `tts-de-female-a`. The consent file may
   carry a first name if the speaker wants it there; nothing else in this repository does,
   and no file name or directory name ever does.
2. **A directory in `../audio/` with no row here is skipped**, and counted as missing clips
   rather than silently ignored. That is the check.
3. **`kind` separates humans from synthesis.** `"kind": "human"` needs a consent file;
   `"kind": "synthetic"` needs the voice's licence named in `notes` instead, and the report
   keeps the two WER figures apart — a text-to-speech voice reading a sentence is easier to
   transcribe than a person saying it, and averaging the two would flatter the model.
4. **Consent is per purpose.** The template asks for evaluation on the operator's own
   machines. It does *not* ask for publication, and the clips are gitignored accordingly
   (`../audio/README.md` §7). Publishing them needs a second conversation and a second dated
   line in the speaker's file.
5. **Withdrawal is a delete.** If a speaker withdraws, delete their directory under
   `../audio/`, set `"withdrawn"` to the date in their row, and re-run the eval. The report
   that was written while their clips were in it stays as it is — it was true when it was
   written — and the next report says the suite changed and why.

## Adding a speaker

```bash
cp src/journal/inference/golden/consent/CONSENT-TEMPLATE.md \
   src/journal/inference/golden/consent/sp03.md
# fill it in with them, in the language they speak
# add the row to speakers.json
mkdir src/journal/inference/golden/audio/sp03
make journal-audio-check
```
