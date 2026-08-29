# Phase 6 — the user test, as a runnable protocol

**Status: written 2026-08-25 (session U1). Not yet run.** The gate is open. Nothing after
[session C2](../06-implementation-prompts.md#c2--capture-and-the-inference-boundary) should
be built on the strength of it until a dated report sits beside this file.

This document is the instrument for
[§12.4 of the design](../06-emotional-journal.md#124-what-a-user-test-should-answer-before-building-the-expensive-parts).
It exists to decide four things, and it is deliberately built so that each of the four falls
out of a number rather than out of an impression:

| Decision | The number that decides it | Where it comes from |
| :------- | :------------------------- | :------------------ |
| The feeling vocabulary's membership, and the valence/energy constants | Question 3's tally and the affect-grid sort | [Sheet 1](tally-feelings.md) |
| Whether the ritual keeps nine cards or fewer | Question 1's timings | §6, task T2 · §8, the week |
| Whether the proposal card is worth building at all | Question 2's acceptance rate on the fixture card | [proposal-card.html](proposal-card.html) |
| Whether 6-G is built | Question 4's two numbers, plus the search probe | [Sheet 2](tally-triggers.md) |

Two of those four are decisions to **not build something large**. They are the operator's to
make, not the facilitator's, and §10 says so in the shape of the rules rather than leaving it
to the day.

---

## 1. What is under test, and what is not

**Under test:** the 6-A + 6-B build at `app-improvements` — the check-in composer and its
twenty-one chips, the nightly ritual and its settings, the People and Triggers views, the day
view and the day graph with its *Show it flat* control, and export.

**Not under test, because it does not exist:** voice, transcription, the model, the real
proposal card, retrieval, search, and the second nightly prompt on Android. Where a question
needs one of those, this protocol substitutes something honest and says so:

| §12.4 needs | This protocol substitutes |
| :---------- | :------------------------ |
| A model proposal (Q2) | A facilitator who plays the model, driving [the fixture card](#7-the-fixture-proposal-card) |
| Search (Q4) | A **search probe**: retrieval-shaped questions counted as they are asked out loud, plus one blocked task |
| A second nightly prompt (Q7) | The web nudge line, which exists — the Android notification does not |
| A transcript (Q5) | The participant's own sentence, typed by the facilitator into the fixture card |

**The German-first rule (Q8).** §12.4's eighth question is not a question, it is a
precondition: *every recording in the test in the participants' own language, before any
English number is believed.* For U1 there is no model to be believed or disbelieved, so the
rule takes the only form it can:

1. At least **four of the six participants speak German as their first language**, and every
   sentence they give the fixture card is in German. The facilitator types it in German. No
   participant is asked to translate their own words before the card sees them.
2. The card's **chrome** can be shown in German (a toggle in the fixture's setup screen). The
   **feeling words are never translated**, because the app ships one set of English labels and
   translating them here would test a product that does not exist.
3. Every German word a participant reaches for is written down **in German**, in the last
   column of [Sheet 1](tally-feelings.md), beside the English label they settled on. That
   column is the evidence for a decision this test may well force and that nothing in the
   design document has yet faced: whether an English-only vocabulary is reachable at all for
   the user this product is for.
4. **No number in the report is reported for German and English participants pooled** unless
   the split is also given. A pooled acceptance rate hides exactly the failure Q8 exists to
   catch.

---

## 2. Participants

**Six, and not fewer than five.** Four or more speak German as their first language. Recruit
for the product's user rather than for a general population: people who have said, in their
own words, that naming a feeling is hard, or who keep a journal and find the *how do you feel*
question in existing apps unanswerable. One participant who already uses a mood tracker is
useful as a contrast and should be marked as such in the report.

**Screening, four questions, asked before the session is booked**

1. First language, and how comfortable reading an interface in English (1–5, self-rated).
   Recorded; it is a confound for every English label in this test.
2. Do you currently record anything about how your days go? (Nothing / notes / an app / other.)
3. Is there a phone you can keep this on for a week?
4. Have you used this application before? A prior user is not excluded but is marked; their
   first-run reactions are not usable.

**Exclusions.** Nobody currently in acute distress, and nobody for whom a week of recording
feelings is a clinical matter rather than a product question. This is a product test and the
app is explicitly not a clinician (§1). If a participant raises something the session is not
equipped for, the session stops and the facilitator says plainly that this is a test of an
interface and not a place for it.

**Consent, in writing, before anything is installed.** It has to name six things, because six
things are true of this test:

- What is recorded: screen and audio of the two sessions, the app's own export at the end of
  the week, and the fixture card's tap log.
- That the fixture card's proposal is **written by a person in the next chair**, not by a
  model. This is disclosed at the end of the session, not the start — see §6, T4 — and the
  consent form says that some element will be explained afterwards.
- That the week's entries are the participant's own words about their own life, including
  about named third parties, and that the export will be read by the facilitator.
- That the account is deleted, and the export destroyed, on a stated date.
- That the participant may withhold any single entry from the export at the end of the week —
  the Triggers and day views let them delete a check-in before they hand it over.
- That nothing is sent anywhere: this build stores plaintext on a server the operator runs,
  which is what the Vault page says, and the consent form must not claim more.

**Compensation** is stated up front and is not contingent on completing the week.

---

## 3. Kit

| Item | Note |
| :--- | :--- |
| A handset per participant, or their own | 360 × 800 dp or larger. Their own is better for the week and worse for timing — record which |
| The 6-A + 6-B build, reachable from the phone | `npm run dev -- --host`, backend on the same network, or a deployed instance |
| One account per participant, seeded with **their** relationships | Created in the session, by them, in task T1 — not before |
| [`proposal-card.html`](proposal-card.html) | Self-contained, offline, no network calls. Copy it to the phone or serve it |
| A stopwatch that is not the phone under test | The phone is being timed; do not put the timer on it |
| A printed affect grid, one per participant | §9's card sort. Two axes, no numbers printed on it |
| Twenty-one printed word cards per participant | The vocabulary, one word and its gloss per card, for the same sort |
| [Sheet 1](tally-feelings.md) and [Sheet 2](tally-triggers.md), printed | One of each per participant, plus one pooled copy each |

**Serving the fixture card to a phone.** It is one file with no imports, so any static server
does:

```bash
npx --yes serve product_vision/eval -l 5055
```

Opening it from the phone's own file system also works and keeps it offline; the run log is
held in memory either way and mirrored to `localStorage` only where the origin allows it, so
**copy the log out after every card** rather than trusting it to survive a reload.

---

## 4. The shape of the run

Three contacts, because two of the eight questions cannot be answered in a room:

| | When | Length | What it settles |
| :- | :--- | :----- | :-------------- |
| **Session A** | Day 0, in person | 60–75 min | Q1 (first timing), Q2, Q3 (first pass), Q5, Q6 |
| **The week** | Days 1–7, remote | ~2 min/day | Q1 (bedtime timing), Q3 (real use), Q4, Q7 (first week) |
| **Session B** | Day 8, in person or video | 40 min | Q3 (the sort), Q4 (the sort and the probe), Q1, Q7 |
| *The tail* | Days 8–14, remote | — | Q7 only, and only for participants who agree on day 8 |

**Q7 needs two weeks and the protocol says so.** §12.4 asks whether the second nightly prompt
is *tolerated after two weeks*. One week produces a first reading and nothing more; the report
must label it as such. Participants who agree to a second week are asked one question on day
15 and nothing else.

**Order effects.** T2 (the ritual) comes before T4 (the proposal card) for every participant,
because the ritual's closing card is the participant's first sight of the vocabulary and the
proposal card must not be. T6 (the graph) comes last, because it shows the participant their
own data and changes how they talk about everything before it. Nothing else is counterbalanced
— with six participants, counterbalancing buys less than it costs.

---

## 5. What is timed, and with what

Three instruments, and they disagree by design:

1. **The stopwatch**, in Session A: started when the first ritual card is on screen, stopped
   when *Recorded.* appears. This is the number §12.4 question 1 asks for.
2. **The app's `duration_ms`**, on every ritual row in the JSON export. It measures the
   ritual screen's mount to the last card answered, taken before the network save. For a real
   user navigating to `/journal/ritual` these two are close; for a driven run they are not,
   which is what the ledger's 17.2 s / 29.8 s note was about.
3. **Calibration.** In Session A, record **both** on the same run, for each participant and
   phone. The offset that comes out is what makes the week's `duration_ms` readable, because
   at 23:00 in the dark there is no stopwatch and `duration_ms` is the only instrument there is.

Record every timing against **which deck was on screen** — five cards, or five plus *n*
optional, plus the *Who?* card if it appeared, plus the closing word. A time without its deck
is not comparable to anything.

**The floor to compare against** is in the ledger and in §3.3: eleven interactions in **17.2 s**,
driven at a chosen 1.5 s per interaction, of which the app's own share is ~90 ms per card. Any
human number above that is decision time, which is the thing being measured.

---

## 6. Session A — tasks, in order

Think-aloud throughout, with one exception stated in T4. The facilitator answers no question
about what a control does until the task is over; *"what would you do if I were not here"* is
the whole script for a stuck participant.

### T1 — Sign up, and the empty journal · 8 min · nothing timed

Hand over the phone at the sign-in screen. Ask them to make an account and add the two or
three people they see most, then to find the journal.

*Observe:* whether they find the journal at all, and by which of the five bottom-nav slots or
the header. What they expect the journal to be before they open it. Whether the empty state
reads as an absence or as a place. Any word on the first screens they read differently from
how it is meant.

*Record:* how many people they added, and whether any of them are people the journal will
later need. Note verbatim anything they say about privacy — it is the only unprompted read of
the Vault position this test gets.

### T2 — The nightly ritual, twice · 12 min · **timed**

**First run, core deck only.** *"It is bedtime. Do tonight's questions."* Nothing else is said.

- Stopwatch from first card to *Recorded.* Record the deck.
- Note every hesitation longer than about two seconds, and on which card.
- Note whether they swipe or use the buttons, and whether they discover the swipe unprompted.
- If they answer *yes* to *Spent time with someone today?* the *Who?* card does not appear —
  it is off by default. Do not turn it on yet.

**Then the settings**, without prompting toward any answer: *"is there anything you would want
it to ask you, or stop asking you?"* Let them turn on what they choose, up to three, and turn
on *Ask who I was with*. Record which optional questions they chose and in what order they
considered them — that list is what decides whether an optional question stays in the settings
at all.

**Second run, their own deck.** Same day, so it is a repeat rather than a record: they will be
faster, and the interest is in *how much* faster and *where* the time went. Stopwatch again.

*The closing card is the moment to watch.* *And today, in a word?* is the first time the
twenty-one words are on screen. Record, in order: how long before a tap, which word, whether
they scrolled, whether they said any word aloud that is not in the list, and whether they used
*can't tell* or skipped. **Whether they skipped and why is worth more than which word they
chose.**

*Q1 evidence:* both timings, with decks. *Q3 evidence:* the first unguided contact with the
vocabulary.

### T3 — A check-in with the chips · 10 min · **timed to first save**

*"Something happened this morning — anything at all. Put it in."* No mention of feelings, of
chips, or of the composer.

*Observe and record:*

- Whether they reach for the note field or for the words first. This is the chips-versus-words
  baseline that T4's number has to be read against.
- Every word they type into *Find a word* — including the ones that return nothing. **That
  list is the single richest source for question 3** and it goes straight into Sheet 1's
  *asked for and missing* column, in the language they typed it in.
- Whether they attach an *about* at all without being asked to, and to what: a person, a
  trigger, or a tag.
- Whether the five-word cap is reached, and whether the sentence stating it was read.
- Whether they find the ≈ control, and what they think it means.
- If they pick *can't tell*: what the exclusivity rule looks like from the outside, and whether
  the sentence beside the grid explained it before or after they ran into it.

Then: *"do one more, about something to do with another person."* Record whether the person
resolves to a relationship they added in T1 or mints a new one.

### T4 — The proposal card · 15 min · **the question-2 measurement**

Three cards per participant. This is a Wizard-of-Oz task and it has rules, because a
facilitator who is a better listener than Gemma 4 E2B will produce a number that no model can
reach and the decision will be made on it.

**How a card is produced**

1. Ask for a sentence: *"tell me about a moment from the last day or two — as long or as short
   as you like."* Let them say it out loud. Do not shape it. **In their own language.**
2. The facilitator types the sentence into the fixture's setup screen **verbatim**, including
   the false starts. Editing it into good prose is editing the input the card is a proposal
   for.
3. The facilitator picks **two or three** feelings from the closed twenty-one that a listener
   would plausibly have taken from that sentence, sets an intensity for each, and attaches an
   *about* where the sentence names one: a person by name, a trigger by the participant's own
   word, a tag. Where the participant has not named that thing before, it goes on as
   **new trigger** or **new person** — dashed — because that is what a first mention looks like.
4. **The condition schedule is fixed before the session and not chosen in the moment:**

   | Card | Condition |
   | :--- | :-------- |
   | 1 | clean — the facilitator's best reading |
   | 2 | **degraded** — exactly one proposed word swapped for a neighbour on the same axis (*stress* → *anxiety*, *tiredness* → *boredom*, *rapport* → *pleasure*) |
   | 3 | clean |

   Two clean cards and one degraded, in that order, for every participant. The two rates are
   reported separately; the model sits between them and the report says so rather than pooling
   them into one number that describes neither.
5. Hand the phone over with one sentence and no more: *"this is a first guess at what you just
   said. Do whatever you would do with it."*

**The one place think-aloud stops.** Do not ask them to narrate the first card. What is being
measured is whether the first move is to confirm or to reach past the proposal for the grid,
and a participant explaining themselves confirms more than one who is not. Ask for the
narration **after** the first card is saved or discarded, and run cards 2 and 3 with
think-aloud on.

**What the fixture records for you** — five taps in the top-right corner opens the log:
`proposed`, `kept as proposed`, `dropped`, `added from the grid`, `acceptance`, the first
action and when it happened, time to the outcome, whether the transcript was edited, and
whether *This isn't it* was tapped. Copy the JSON out after each card.

**What only a person can record** — in the session notes, and later in the report's question 2
block ([template](user-test-report-TEMPLATE.md#q2--does-the-proposal-card-feel-like-help-or-like-being-told)):

- Did it read as help or as being told? Ask it in those words, afterwards, and write the
  answer verbatim.
- Was the first move a **confirm**, a **removal**, or the **add chip**? The log answers this;
  the reason does not.
- On the degraded card: did they notice the wrong word, and did they replace it or drop it?
  **A participant who does not notice a wrong label is a worse outcome than one who fixes it**
  — it means the card can put a word into their record that they did not choose, and that is
  the invariant-15 failure the design says the card exists to prevent.
- Did they change the transcript? Q5's first piece of evidence.

**The disclosure.** After the third card: *"the guesses were written by me, sitting here, not
by the app."* Then ask whether that changes what they said. Record the answer. It belongs in
the report because it is the only correction available for the demand characteristics of a
Wizard-of-Oz task.

### T5 — The transcript · 5 min · not timed

One of the three cards in T4 is run with the transcript hidden — set the fixture's
*Show the transcript on the card* checkbox off for **card 2** (the degraded one, so the
comparison is not confounded with the clean/degraded split for the other two). Afterwards:

- *"One of those showed your own sentence and the others did not. Which would you rather have?"*
- *"If the app wrote down what you said, would you want it kept after the words on the card
  were saved — or thrown away?"*
- *"And would you want to be able to read it back later?"*

Record all three verbatim. This is Q5 in full, and it is the only question here whose answer
changes a storage decision rather than an interface one.

### T6 — The day graph, tilted and flat · 8 min · not timed

By now the participant's own day holds three or four check-ins. Open the day view.

Ask, of **the same day**, in this order, using the *Show it flat* control between the two:

> *"When were you most stressed, and about what?"*

Half the participants see the tilted drawing first, half the flat ribbon first — this one
**is** counterbalanced, because it is a direct comparison and the order is the whole confound.

*Record:* which reading is correct, how long each takes, and what they look at to answer. Then
ask which they would keep, and whether the second half of the question — *about what* — was
answered by the drawing or by the row underneath it. §8.3 and §12.4 both record that B2 ran
this once against itself, with one reader who had just drawn it; that is not an answer and
this is the first real one.

Also ask what they think the depth means before explaining it. If nobody reads the z-axis as
energy unprompted, that is a finding about the drawing and not about the reader.

### T7 — Set up the week · 5 min

Set the ritual hour to their own bedtime. Leave the optional questions exactly as they chose
them in T2 — resist tidying them. Explain the week in four sentences:

> Check in whenever you want to, or not at all. Do the questions at night if you feel like it.
> A night with nothing on it is nothing, and the app will not mention it. If you want to stop,
> stop, and tell me.

Give them the day-8 appointment and one instruction that produces Q4's search probe:

> If you ever find yourself wanting to look something up in it — *when did I last feel like
> this*, *what was going on that week* — write down the question you wanted to ask, in the
> notes app, in your own words. You will not be able to ask it of this build. Write it down
> anyway.

That written list is the search probe. **Nothing in the app prompts for it**, so a participant
who writes nothing has produced a result, not a gap.

---

## 7. The fixture proposal card

**What was built: an interactive fixture, not a printed card.**
[`proposal-card.html`](proposal-card.html) — one self-contained file, generated from the app's
own constants by [`build-proposal-card.mjs`](build-proposal-card.mjs).

**Why not the A7 composer with a hard-coded proposal.** The composer has no proposal card in
it. There is no transcript, no dashed *pre-selected but not yet saved* state, no *This isn't
it*; §4.4 is a design and D2 is the session that builds it. Reaching for the composer would
mean building most of D2 inside U1 — against this session's own fence — and it would put
unshipped strings into `JOURNAL_COPY`, where the forbidden-word walk would then be asserting
copy for a screen the app does not have.

**Why not a printed card.** Question 2 asks for an *acceptance rate*, and an acceptance rate is
a count of taps: which proposed words survived, what was reached for instead, and in what
order. Paper gives that only through a facilitator's memory of what happened, and the one
number the decision most depends on — whether the first move was a confirm or the add chip —
is exactly the one memory is worst at.

**What makes it look like the real thing rather than a mock-up.** The twenty-one words, their
labels, their glosses and their colours are read out of `src/constants/journal.js` at build
time, so a chip on this card is the same word in the same colour as the app's; and the chip
shape, the dashed *proposed* outline, the dot, the `·`/`··`/`···` strength button, the ≈
control, the *about* row, the add chip and the *This isn't it* link are the composer's, matched
against `CheckinComposer.jsx`. `unclear` is exclusive here as it is there. What is **not** the
app is the sheet's own frame, which is hand-written CSS rather than Tailwind — it is a research
instrument, and re-rendering the app's build pipeline for it would buy nothing the participant
can see.

**What it does not do**, deliberately: no network call of any kind, no write to the app's
database, no model, and no shared vocabulary module — it is a generated copy, so a change to
`FEELINGS` that is not followed by a regeneration shows up as a stale date in the file's header
rather than as a silently divergent card.

**What it records.** Every tap, with a millisecond offset from the moment the card appeared:
which words were confirmed, which were dropped, which were added from the grid, every intensity
and ≈ change, whether the transcript was edited, whether *This isn't it* was tapped, and how the
card ended. From those it computes the acceptance rate, the first action and its latency, and
the time to save — the numbers §10.3 turns into the decision. Five taps in the top-right corner
opens the log; **copy the JSON out after every card.**

**Its copy is not `JOURNAL_COPY`.** The card's own strings — *Dashed means not saved yet*,
*This isn't it*, the German column — live in the fixture and nowhere else. If D2 is built, they
move into `src/constants/journal.js` there, and the forbidden-word walk covers them from that
point. They were written to the same discipline (§3.6) in the meantime.

---

## 8. The week — days 1 to 7

The facilitator does nothing except one message on day 4: *"still going? anything in the way?"*
— and answers only what is asked. No reminders, no encouragement, and nothing that would read
as counting; the product does not count nights and neither does its test.

**What is collected on day 8, before Session B**

1. The **JSON export** and the **journal CSV** from the Vault page, taken by the participant,
   in front of the facilitator, after they have had the chance to delete anything they would
   rather not hand over. Record how many entries they deleted; that number is itself a finding.
2. The search-probe list from their notes app.
3. Two questions, asked before anything is opened, so the export does not lead the answer:
   *"which of the nights did you skip, and what was in the way?"* and *"did the app ever ask
   you something you did not want to answer?"*

**What the export gives, and where each column lands**

| From | Column | Fills |
| :--- | :----- | :---- |
| `journal.csv` | `feeling` | Sheet 1, the use count per id |
| `journal.csv` | `source` | Separates a check-in's word (`chips`, `typed`) from the ritual's closing word (`ritual_word`) — they are different acts and Sheet 1 counts them apart |
| `journal.csv` | `uncertain` | How often ≈ is used, and on which words |
| `journal.csv` | `about_kind`, `about` | Sheet 2's trigger labels, and how often a feeling was attached to anything at all |
| `journal.json` | `payload.duration_ms` on `kind: "ritual"` rows | The week's ritual timings, corrected by the participant's Session-A calibration |
| `journal.json` | `payload.asked` on the same rows | Which deck each night actually was — a timing without it is not comparable |
| `journal.json` | `kind: "trigger"` rows | The trigger vocabulary, with the label as first written |

The CSV holds one row **per feeling per check-in**, not per check-in. Count check-ins by
distinct `at`, or Sheet 1's totals will be inflated by every multi-word entry.

---

## 9. Session B — day 8

### S1 — The word sort · 12 min · Q3's second half

Two passes over the twenty-one printed word cards.

**Pass 1, membership.** Three piles: *words I used or would use*, *words I would never use*,
*words I do not understand*. Then: *"is there anything you wanted to say this week that none of
these cards say?"* Write each answer down **in the participant's own language**, verbatim,
before offering any English equivalent. Then, and only then, ask which card comes closest, and
record both.

**Pass 2, the affect grid.** Give them the printed grid — horizontal *unpleasant ↔ pleasant*,
vertical *still ↔ stirred up*, no numbers anywhere on it — and ask them to place every card
from pile 1. Photograph it. Read off each card's position as a fraction of the axis, to one
decimal, into Sheet 1's grid columns.

That photograph is the only evidence this test produces for **the valence and energy
constants**, which §5.3 lists as undecided and §12.5 repeats. Without pass 2 the vocabulary
decision is half-made: the membership would be settled and the two numbers behind every branch
of the day graph would still be authored from nothing.

### S2 — The trigger sort · 10 min · **the number that decides 6-G**

Print each participant's own trigger labels — from the `kind: "trigger"` rows — one per card,
in their own words, and hand them the stack.

> *"Put together any of these that mean the same thing to you."*

Record, on [Sheet 2](tally-triggers.md):

- **D** — how many distinct labels the week produced.
- **G** — how many groups they made, counting a lone card as its own group.
- **M = D − G** — how many labels would disappear if their own merges were applied. This is
  §5.8's fragmentation, measured by the only person entitled to judge it.
- Whether any pair they merged is one the app could not have guessed from the words alone
  (*the thing on Thursday* and *Marc*), because that pair is one an embedding model would also
  have missed.

Then the reuse number, from the CSV rather than from the participant: **R** = check-ins whose
trigger already existed before that day, over check-ins naming any trigger at all.

### S3 — The search probe · 5 min

Read their written list back to them and ask, of each: *"would you have wanted the app to
answer that?"* Then one blocked task:

> *"Find the day you felt closest to someone this week."*

The build has no search. What they do instead — scroll the day list, go through People, give
up — is the finding. Time it, and stop them at 90 seconds.

### S4 — The ritual after a week · 5 min · Q1 and Q7

- *"Did the questions get quicker, or just shorter?"*
- *"Was there a night you did it and wished you had not?"*
- The web nudge line: *"did you see this? what did you do with it?"* — and if they turned it
  off, **which of the three**: the time, the length, or being asked at all. §12.4 asks for that
  distinction by name and a yes/no answer to it is worthless.
- *"Would you keep the three extra questions, drop them, or swap them?"*

### S5 — Close · 3 min

*"If this vanished tomorrow, what would you miss?"* and *"what would you not?"* Verbatim, both.
Then the deletion date is confirmed out loud.

---

## 10. The decision rules, fixed before the run

Written down here, in advance, so that the four decisions are read off the numbers rather than
argued from them afterwards. A rule that turns out to be wrong is changed **in this file, with
a date and a reason**, before the numbers are looked at — not after.

`n` is the number of participants who completed the week. Every number below is a **median
across participants**, and every one of them is reported with its `n` beside it.

### 10.1 The feeling vocabulary

**Retire an id** (`retired: true`, never removed — §5.3 and Appendix D) when **all** of:

- it is chosen zero times across every participant's whole week, in check-ins and as a day word;
- no participant puts it in pile 1 of the word sort;
- at least five participants completed the week.

Anything short of that is kept. Six people are not enough to prove a word useless, and the cost
of keeping an unused word is one chip in a grid, while the cost of retiring a used one is a
word somebody needed being gone.

**Add an id** when **all** of:

- three or more participants independently reach for the same missing concept — in *Find a
  word*, in the sort, or aloud;
- it is not the same thing as an existing label at a different intensity (*furious* is `anger`
  at `···`, not a new id);
- a descriptive, ungraded noun exists for it in English, and its German equivalent is what the
  participants actually said.

**Move a valence or energy constant** when the median placement from the affect grid differs
from the current constant by more than **0.3 on valence** or **0.25 on energy**, with at least
four placements for that word. Below that, the authored constant stands: the grid is a
ten-minute instrument and it is not more precise than the number it would replace.

**`unclear` is not subject to any of the above.** It is the entry the thesis rests on (§1,
§5.3). If it goes unused for a week by every participant, that is a finding about the bet and
it is reported as one — **it is not a reason to retire the id, and this protocol does not
authorise retiring it.** The operator decides, with the number in front of them.

### 10.2 The ritual's length

Read from the week's corrected `duration_ms`, per night, against the deck that night actually
was.

| Median full-deck time | Decision |
| :-------------------- | :------- |
| under 60 s | **Nine cards stay.** `MAX_OPTIONAL_QUESTIONS` unchanged |
| 60–90 s | **The optional tail shrinks to two.** §3.3: the tail goes before the core |
| over 90 s, or two or more participants stop mid-deck on two or more nights | **The tail shrinks to one**, and the report says what the core five alone cost |

**The core five do not shrink on this evidence.** They are the dataset; a condition asked of
four participants out of six is not comparable to anything, and §3.3 rules out a rotating set
for the same reason.

An optional question **no participant turned on** is a candidate for removal from the settings
list. Its id stays in `RITUAL_QUESTIONS` and in `domain.RitualQuestionIDs` either way — an id
is permanent — and removal from the settings list needs the same evidence as a retirement:
zero across five or more participants.

*The `Who?` card* is decided separately: if two or more participants call it intrusive, or turn
it off within the week, it stays off by default and §3.5 gains their words as the reason.

### 10.3 The proposal card — whether D2 is built at all

Per card, from the fixture log: `acceptance = kept-as-proposed / proposed`.

**Build the card as §4.4 designs it** when **all** of:

- median acceptance on the **clean** cards ≥ **0.6**;
- median acceptance on the **degraded** cards ≥ **0.4**;
- at most one participant describes it as being told rather than helped;
- at least half the participants **notice** the swapped word on the degraded card.

The 0.6 is not arbitrary and it is not a model benchmark. The proposer here is a human being
who heard the sentence, watched the face that said it, and chose from twenty-one words with
unlimited time. That is a ceiling. If a proposal built under those conditions cannot hold six
words in ten, an on-device 2-billion-parameter model working from a transcript will not, and
the card would spend its life being corrected.

**Do not build it, and make the chips path the whole feature**, when **any** of:

- median clean acceptance < 0.6;
- half or more of the participants open the grid before touching a single proposed chip — they
  are not reading the proposal, they are working around it;
- half or more fail to notice the swapped word. This one is disqualifying on its own and
  regardless of the acceptance rate: a card whose wrong word is accepted is a card that writes
  into the record something the user did not choose, and invariant 15 is the product.

**The middle case is real and it is not a failure.** Acceptance at 0.6 with a high replacement
rate — words dropped and others chosen from the grid — says the card works as *a way into the
vocabulary* and not as an answer. That is D2 built with the grid opened by default and the
proposal dashed underneath it, which is a smaller build than §4.4 and a legitimate outcome.

### 10.4 Whether 6-G is built

Three numbers per participant: **D** (distinct labels in the week), **M** (labels that would
disappear under their own merges), **R** (share of trigger-naming check-ins that reused an
existing trigger). Plus **P**, the search probe: retrieval-shaped questions written down.

**Not built** when either:

- median **D < 3** — a week that produced one or two labels has no vocabulary to normalise, and
  §5.8's "if people do not reuse triggers" is answered; or
- median **M = 0** *and* total **P = 0** across every participant — nothing is fragmenting and
  nobody wanted to look anything up. This is §5.8's own condition, and it is the outcome that
  saves a 200–300 MB download and a whole slice.

**Built** when median **D ≥ 3** and either median **M ≥ 2** or **P ≥ 1 for half the
participants**.

**Split, and this is the likely case:** median **D ≥ 3**, median **M ≥ 2**, **P = 0**. Labels
fragment but nobody searches. Then trigger normalisation is worth building and *recall* is not
— which is most of 6-G's cost, because normalisation runs over a few dozen short labels and
recall is what needs the whole index over every entry. The report says so explicitly and G1/G2
are re-scoped rather than cancelled.

---

## 11. What could make these numbers wrong

Stated here so the report can say which of them bit, rather than discovering them in the
discussion.

- **The proposer is not the model.** A person who heard the sentence is a ceiling, not an
  estimate. The degraded condition exists to put a floor under the same number, and the report
  gives both and never one.
- **Demand characteristics.** A participant being watched confirms more than one who is not.
  The first card is run without think-aloud for that reason, and the disclosure at the end of
  T4 is the only correction available.
- **English labels, German speakers.** Every feeling word in this test is English and four of
  the six participants are not. A word left unchosen may be a word not reached rather than a
  word not needed, and Sheet 1's German column is what tells the two apart. **No id is retired
  on the strength of a German participant's silence alone.**
- **A week is not a habit.** Q7 asks about two weeks and gets one. Novelty inflates the check-in
  count and probably deflates the ritual time by the end. The day-1-to-3 and day-5-to-7 halves
  are reported separately.
- **Six people.** Every rule in §10 is built to fail safe under this: retire on zero, add on
  three, keep everything else. A vocabulary decision made on six people is provisional and §5.3
  should say so with the date on it rather than claiming the test settled it.
- **Their own phones.** Better for the week, worse for timing. Record the device against every
  `duration_ms`.
- **The facilitator wrote this protocol and wants the feature to exist.** The decision rules
  are fixed in §10 before the run for exactly that reason. If a rule is changed, the change is
  dated in this file and the reason is given.

---

## 12. Running it

```bash
node product_vision/eval/build-proposal-card.mjs
```

Regenerates the fixture card from `src/constants/journal.js`. Run it before the first session
and after any change to `FEELINGS`; the vocabulary in the card is generated, never hand-edited.

```bash
npx --yes serve product_vision/eval -l 5055
```

Serves the card to the phone. It makes no network calls of its own.

```bash
npm run dev -- --host
```

The build under test, reachable from the handset. The backend runs from `backend/` as usual.

**On the day the run closes**, copy [`user-test-report-TEMPLATE.md`](user-test-report-TEMPLATE.md)
to `user-test-report-YYYY-MM-DD.md`, fill it, and attach the two sheets and the affect-grid
photographs. Then, and only then, the four decisions in §10 are read off it, `06-progress.md`
records the gate as closed, and the sessions §10 changed have their prompts updated in
`06-implementation-prompts.md`.
