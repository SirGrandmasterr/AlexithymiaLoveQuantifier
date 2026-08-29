# Sheet 1 — the feeling vocabulary

The tally for [§12.4 question 3](../06-emotional-journal.md#124-what-a-user-test-should-answer-before-building-the-expensive-parts):
*which of the twenty-one are never chosen, which are missing, and does `unclear` get used.*
It is filled from [the protocol](user-test-protocol.md) and read by
[§10.1's rules](user-test-protocol.md#101-the-feeling-vocabulary).

**Print one 1A + 1B + 1C per participant, and one 1D + 1E for the run.**

The twenty-one rows below are the vocabulary as of **2026-08-25**. If `FEELINGS` changes, this
sheet and [`proposal-card.html`](proposal-card.html) both go stale — regenerate the card and
re-check the list before printing.

Two rules that make the difference between a tally and a wish:

- **Absent is not zero.** A blank cell means the sheet was not filled for that row. Write `0`
  where a word was genuinely never chosen; the two are different records and §10.1's retirement
  rule reads the `0`.
- **The participant's own language goes down first.** In 1B, the German (or other) word is
  written before any English equivalent is offered, and both are kept.

---

## 1A — Use, per participant

Participant: ________  ·  first language: ________  ·  English comfort (1–5): ____  ·  n days: ____

Fill *check-in* and *day word* from `journal.csv`: `feeling` counted where `source` is `chips`
or `typed`, and where `source` is `ritual_word`. Count check-ins by distinct `at` — the CSV
holds one row per feeling, so a three-word check-in is three rows.

| id | label | check-in | day word | ≈ used | sort pile (1 use / 2 never / 3 unclear) | note |
| :- | :---- | -------: | -------: | -----: | :-------------------------------------- | :--- |
| `joy` | joy | | | | | |
| `excitement` | excitement | | | | | |
| `pleasure` | pleasure | | | | | |
| `rapport` | connectedness | | | | | |
| `gratitude` | gratitude | | | | | |
| `pride` | pride | | | | | |
| `curiosity` | curiosity | | | | | |
| `calm` | calm | | | | | |
| `neutral` | level | | | | | |
| `unclear` | can't tell | | | | | |
| `tiredness` | tiredness | | | | | |
| `boredom` | boredom | | | | | |
| `longing` | longing | | | | | |
| `loneliness` | loneliness | | | | | |
| `sadness` | sadness | | | | | |
| `shame` | shame | | | | | |
| `irritation` | irritation | | | | | |
| `stress` | stress | | | | | |
| `anxiety` | anxiety | | | | | |
| `overwhelm` | overwhelm | | | | | |
| `anger` | anger | | | | | |

Check-ins in the week: ____  ·  of those, naming at least one *about*: ____  ·  day words: ____  ·  nights skipped: ____

> `connectedness` is the label; `rapport` is the id, and they are deliberately different (§5.3).
> Tally against the **label** the participant saw, and record it against the **id**.

---

## 1B — Asked for, and missing

Every word a participant reached for that the vocabulary did not have. Sources, all of them:
what they typed into *Find a word* and got nothing back for (T3), what they said aloud while
choosing (T2's closing card, T4), and pass 1 of the word sort (S1).

| # | The word they used, **in their own language** | Where it came from (T2 / T3 / T4 / S1) | Closest existing label, in their judgement | Is it an existing word at another strength? | Verbatim context |
| :- | :------------------------------------------- | :------------------------------------- | :----------------------------------------- | :------------------------------------------ | :--------------- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |

The fourth column is the one that stops the list growing for no reason: *furious* is `anger` at
`···` and is not a new id (§5.3 — labels are never graded). Write **yes** there and the row does
not count toward §10.1's *three independent asks*.

Words they said they did not understand (pile 3 of the sort), with what they thought each meant:

| id | what they thought it meant |
| :- | :------------------------- |
| | |
| | |

---

## 1C — The affect grid readout

From pass 2 of the word sort (S1). Read each card's placement off the printed grid as a
fraction of the axis and write it as a number: valence −1.0 (left) to +1.0 (right), energy 0.0
(bottom) to 1.0 (top). One decimal is enough — the instrument is not finer than that.

**Leave a row blank if the card was not placed.** A word in pile 2 or 3 has no position, and a
zero would be a claim the participant did not make (invariant 14, applied to a paper sheet).

Photograph the grid before reading it off, and keep the photograph with the report.

| id | current valence | current energy | **their** valence | **their** energy | Δ valence | Δ energy |
| :- | --------------: | -------------: | ----------------: | ---------------: | --------: | -------: |
| `joy` | 0.8 | 0.7 | | | | |
| `excitement` | 0.6 | 0.9 | | | | |
| `pleasure` | 0.7 | 0.5 | | | | |
| `rapport` | 0.7 | 0.4 | | | | |
| `gratitude` | 0.6 | 0.3 | | | | |
| `pride` | 0.6 | 0.6 | | | | |
| `curiosity` | 0.4 | 0.6 | | | | |
| `calm` | 0.5 | 0.2 | | | | |
| `neutral` | 0.0 | 0.3 | | | | |
| `unclear` | 0.0 | 0.4 | | | | |
| `tiredness` | -0.2 | 0.1 | | | | |
| `boredom` | -0.3 | 0.2 | | | | |
| `longing` | -0.2 | 0.5 | | | | |
| `loneliness` | -0.6 | 0.3 | | | | |
| `sadness` | -0.7 | 0.2 | | | | |
| `shame` | -0.7 | 0.5 | | | | |
| `irritation` | -0.4 | 0.6 | | | | |
| `stress` | -0.5 | 0.8 | | | | |
| `anxiety` | -0.6 | 0.8 | | | | |
| `overwhelm` | -0.5 | 0.9 | | | | |
| `anger` | -0.7 | 0.9 | | | | |

> `unclear` sits at valence 0.0 by design — *something is there and it has no name yet* is not
> a pleasant or an unpleasant claim. If participants place it consistently to one side, that is
> a finding about the entry the thesis rests on and it is reported in 1D, not silently averaged
> into a new constant.

---

## 1D — `unclear`, on its own page

The entry the whole vocabulary exists for (§1, §5.3). It gets its own block because pooling it
with twenty other words is how it would get retired by arithmetic.

| Participant | used in a check-in? (n) | used as a day word? (n) | picked in the sort? | said *I cannot tell* aloud, in any words? | what they said, verbatim |
| :---------- | ----------------------: | ----------------------: | :------------------ | :---------------------------------------- | :----------------------- |
| P1 | | | | | |
| P2 | | | | | |
| P3 | | | | | |
| P4 | | | | | |
| P5 | | | | | |
| P6 | | | | | |

Three things to write down beside the counts, because the count alone cannot say which happened:

1. **Did anyone reach for it and then change to a named word?** The composer makes `unclear`
   exclusive, so that is a visible sequence: pick *can't tell*, then pick something else and
   watch it drop. Note every time it happens.
2. **Did anyone want it *with* another word?** The exclusivity rule is a decision A7 made and
   §4.4 records. A participant who tries and is stopped is evidence about that decision, not
   about the vocabulary.
3. **Did anyone skip the day word rather than use it?** *Can't tell* and *skip* are different
   records (§3.2), and a participant who skips where the design expects `unclear` is saying the
   chip did not read as an answer.

**§10.1 does not authorise retiring this id on any number this sheet can produce.** If it goes
unused, the report says so plainly, and the operator decides what that means for the bet.

---

## 1E — Pooled, and the decision

One row per id, filled after every participant's 1A is in. `n` is the number who completed the
week and it goes in the heading, not in a footnote.

n = ____   ·   of whom German-first = ____

| id | participants who used it | total uses | placed on the grid by | median valence | median energy | **§10.1 says** |
| :- | -----------------------: | ---------: | --------------------: | -------------: | ------------: | :-------------- |
| `joy` | | | | | | |
| `excitement` | | | | | | |
| `pleasure` | | | | | | |
| `rapport` | | | | | | |
| `gratitude` | | | | | | |
| `pride` | | | | | | |
| `curiosity` | | | | | | |
| `calm` | | | | | | |
| `neutral` | | | | | | |
| `unclear` | | | | | | **never retired here — see 1D** |
| `tiredness` | | | | | | |
| `boredom` | | | | | | |
| `longing` | | | | | | |
| `loneliness` | | | | | | |
| `sadness` | | | | | | |
| `shame` | | | | | | |
| `irritation` | | | | | | |
| `stress` | | | | | | |
| `anxiety` | | | | | | |
| `overwhelm` | | | | | | |
| `anger` | | | | | | |

The last column takes one of four values, and nothing else:

- **keep** — used by anyone, or defended by anyone in the sort.
- **retire** — zero uses, in nobody's pile 1, and n ≥ 5. Written as `retired: true`; the id is
  never removed, in either language (§5.3, Appendix D).
- **keep, unreached** — zero uses but only among German-first participants, or n < 5. §11 says
  a word not reached is not a word not needed.
- **move** — kept, with a valence or energy change: |Δ| > 0.3 on valence or > 0.25 on energy,
  from four or more placements.

New ids proposed, from 1B pooled across participants — three independent asks each, and none of
them an existing word at another strength:

| proposed id | label | gloss | valence | energy | hex | asked for by |
| :---------- | :---- | :---- | ------: | -----: | :-- | :----------- |
| | | | | | | |

> A new id is **two edits in two languages and no schema change**: `FEELINGS` in
> `src/constants/journal.js` and `FeelingIDs` in `backend/internal/domain/journal.go`, in the
> same commit. The id-parity test in `src/constants/journal.test.js` fails on a one-sided edit —
> and its `toHaveLength(21)` case has to move with the count, in the same commit, or it fails
> on a correct one.
