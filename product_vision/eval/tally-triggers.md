# Sheet 2 — triggers, reuse, and the search probe

The tally for [§12.4 question 4](../06-emotional-journal.md#124-what-a-user-test-should-answer-before-building-the-expensive-parts):
*do people reuse triggers, and do they search.* **This is the sheet that decides whether 6-G is
built at all** — §5.8 is explicit that if people do neither, the embedding index is not built,
and that is a decision worth a 200–300 MB download and a slice of work.

Filled from [the protocol](user-test-protocol.md) §8 and §9, read by
[§10.4's rules](user-test-protocol.md#104-whether-6-g-is-built).

**Print one 2A + 2B + 2C per participant, and one 2D for the run.**

---

## 2A — The labels the week produced

Participant: ________  ·  n days: ____  ·  check-ins in the week: ____

From the JSON export: one row per `kind: "trigger"` entry, in the order they were written. The
label is the word as **first** written — a rename is a correction row that supersedes it, and
both belong here, because a rename is itself evidence that the first word did not hold.

| # | label, as first written | day first written | times attached to a feeling | renamed? to what | merged? into what |
| :- | :---------------------- | :---------------- | --------------------------: | :--------------- | :---------------- |
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |
| 6 | | | | | |
| 7 | | | | | |
| 8 | | | | | |
| 9 | | | | | |
| 10 | | | | | |
| 11 | | | | | |
| 12 | | | | | |

**D — distinct labels the week produced:** ____

Counted before the sort and before any rename is applied. A label the participant renamed on
day 3 counts once, under its first spelling.

**Attachment, from `journal.csv`:**

| | count |
| :- | ----: |
| check-ins naming at least one trigger (`about_kind` contains `trigger`) | |
| of those, naming a trigger **that already existed before that day** | |
| check-ins naming a person instead | |
| check-ins naming a context tag instead | |
| check-ins naming nothing at all | |

**R — reuse rate** = (reused ÷ trigger-naming check-ins) = ____

> R is read from the export and not from the participant, because *"do you reuse them"* is a
> question about memory. A trigger counts as reused when the check-in references a trigger row
> written on an earlier day — not one minted in the same composer session, which is one act of
> naming and not two.

---

## 2B — The sort (S2)

Their own labels, printed one per card, grouped by them: *"put together any of these that mean
the same thing to you."* Say nothing about merging, about the app, or about what a group is for.

| group | the labels they put together | is it guessable from the words alone? |
| :---- | :--------------------------- | :------------------------------------ |
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |

**G — groups they made:** ____ (a lone card is its own group)

**M = D − G** = ____ — how many labels would disappear if their own merges were applied. This
is §5.8's fragmentation, measured by the only person entitled to judge it.

The last column is the one that decides what an embedding model could actually have done.
*work* / *my job* / *the office* is guessable from the words; *the thing on Thursday* / *Marc*
is not, and no embedding of those two strings brings them together. Count them separately:

- pairs guessable from the words: ____
- pairs guessable only from what the participant knows: ____

**M is not a target.** A participant who made no groups at all has produced a result, and it is
the result that says trigger normalisation has nothing to normalise.

---

## 2C — The search probe (T7, S3)

The list they wrote in their notes app during the week, unprompted by anything in the app.

| # | the question they wanted to ask, **verbatim, in their own language** | day | would they have wanted the app to answer it? | is it answerable from labels alone, or does it need the words? |
| :- | :------------------------------------------------------------------ | :-- | :------------------------------------------- | :------------------------------------------------------------- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

**P — retrieval-shaped questions written down:** ____

The last column separates the two halves of 6-G. *"Which days had work on them?"* is answerable
by a filter over trigger ids and needs no model at all. *"When did I last feel like this?"* is
what the index is for. A run where every P is in the first column has not made the case for an
embedding model — it has made the case for a filter, which is cheap and is not 6-G.

**The blocked task** (S3): *"find the day you felt closest to someone this week."*

| | |
| :- | :- |
| what they did | |
| time to an answer, or to 90 s | |
| did they find it | |
| what they said they wanted | |

---

## 2D — Pooled, and the decision

n = ____ · of whom German-first = ____

| Participant | D | G | M | R | P | guessable pairs | unguessable pairs |
| :---------- | -: | -: | -: | -: | -: | --------------: | ----------------: |
| P1 | | | | | | | |
| P2 | | | | | | | |
| P3 | | | | | | | |
| P4 | | | | | | | |
| P5 | | | | | | | |
| P6 | | | | | | | |
| **median** | | | | | — | | |
| **total** | | | | | | | |

Read against [§10.4](user-test-protocol.md#104-whether-6-g-is-built), which admits four outcomes
and not two:

| | Condition | Outcome |
| :- | :-------- | :------ |
| **not built** | median D < 3 | No vocabulary to normalise. G1 and G2 are cancelled |
| **not built** | median M = 0 **and** total P = 0 | Nothing fragments and nobody looked anything up. §5.8's own condition, met |
| **built** | median D ≥ 3 **and** (median M ≥ 2 **or** P ≥ 1 for half the participants) | 6-G as designed |
| **split** | median D ≥ 3, median M ≥ 2, total P = 0 | **Normalisation is worth building; recall is not.** G1 is re-scoped to trigger normalisation over a few dozen short labels; G2 is deferred until somebody asks a question of their own journal |

The split outcome is the one to expect and the one the design document does not yet name. It
matters because the costs are not alike: normalising trigger labels embeds tens of strings and
could be done on a laptop-class device or, at a pinch, without a model at all; recall embeds
every entry a user has ever written and is what the 200–300 MB download and the re-embed on
model change are for.

Whatever the sheet says, **the operator makes this call, not the facilitator.** Both *not built*
rows are decisions to cancel a slice, and the protocol's job is to put the numbers in front of
them rather than to act on them.
