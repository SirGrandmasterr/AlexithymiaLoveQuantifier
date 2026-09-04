# 01 — Concepts & Domain Model

The *semantic* content of the project: what the application is about, what each domain term
means, and where each concept is realised in code.

---

## 1. The premise

**Alexithymia** is difficulty identifying and describing one's own emotions. The thesis is that
if a feeling cannot be *named* introspectively it can still be *estimated behaviourally* — by
scoring observable behaviours instead of reporting felt states. So the app does not ask "how do
you feel about this person?"; it asks the user to rate, per love category, **behavioural
metrics** — things noticeable from the outside, such as *"You experience genuine distress if
they do not reply to a message within a specific timeframe."* The output is seven integers,
0–100, describing the *mixture* of love styles in one relationship at one point in time.

Two consequences shape the entire product:

1. **Self-scored, not computed.** The **love snapshots** contain no inference engine and no
   scoring algorithm: the user moves seven sliders and the backend stores those numbers
   verbatim. Every "metric" description is guidance for the human doing the rating — see
   [Category Explorer](#5-the-category-explorer-aboutmodal).

   The **emotional journal** may, on this device and only when turned on, **transcribe a spoken
   note and propose labels for it** — every one of them dashed until tapped. **A proposal is
   never a record until the user confirms it**, and what is saved is built from the confirmed
   state and nothing else. No model has ever written a score, and none can: the proposal
   contract has no slot for one.
2. **Longitudinal by design.** A single self-assessment is noisy and feelings change, so the
   primary unit is not "a person" but "a dated snapshot of a person". Change over time is the
   actual signal — hence versioning and the timeline.

---

## 2. The Color Wheel Theory of Love

The scoring dimensions come from John Alan Lee's *Colours of Love* (1973). This project uses
**seven** categories: Lee's six, plus `selflessness`, which it treats as the extreme tail of
`agape` — a deliberate project-specific extension, documented as such in
[`TestImplementationDetails.txt`](../TestImplementationDetails.txt) and in the UI copy.

### The seven categories

Each category is stored under a lowercase `id`, which is also the JSON key inside `stats` and
the chart's `dataKey`. **These ids are the stable contract** between frontend, backend and
database.

| `id` | Label | Plain meaning | Core motivation | Colour (Tailwind / hex) |
| :--- | :---- | :------------ | :-------------- | :---------------------- |
| `eros` | Eros | Romantic, passionate love — the "chemistry" mode, driven by attraction, aesthetics and rapid intense connection | Physical and emotional merging | `bg-rose-400` / `#fb7185` |
| `ludus` | Ludus | Playful, flirtatious love — love as a game enjoyed without the weight of obligation | Entertainment, freedom, the "chase" | `bg-orange-400` / `#fb923c` |
| `storge` | Storge | Unconditional, familial love — the "slow burn" out of friendship and shared values | Companionship, stability, comfort | `bg-amber-400` / `#fbbf24` |
| `pragma` | Pragma | Enduring, logical love — checklist-driven evaluation of practical compatibility | Long-term compatibility and life alignment | `bg-emerald-400` / `#34d399` |
| `mania` | Mania | Obsessive, intense love — volatile, rooted in low self-esteem or fear of abandonment | Alleviating anxiety through possession and reassurance | `bg-violet-400` / `#a78bfa` |
| `agape` | Agape | Selfless, universal love — the partner's wellbeing above one's own, without expectation of return | Unconditional care and betterment of the other | `bg-blue-400` / `#60a5fa` |
| `selflessness` | Selflessness | Complete lack of ego — the absolute extreme end of the Agape spectrum | Total removal of the "self" from the relationship | `bg-slate-400` / `#94a3b8` |

Each also carries in code: `description` (one-line gloss), `extendedDescription`,
`coreMotivation`, `metrics[]` (2–4 `{ title, description }` behavioural indicators — six
categories have four, `selflessness` has two), and `anchors[]` (5–6 `{ min, max, phrases }`
bands, each with **five** phrasings — see [Anchored sliders](#anchored-sliders)).

**Where this lives:** the `CATEGORIES` array in
[`src/constants/categories.js`](../src/constants/categories.js), the *only* definition of the
taxonomy in the running application, re-exported from `Dashboard.jsx` for existing callers.

The backend knows the seven **ids** and nothing else: they are duplicated as a validation
allowlist in [`domain/categories.go`](../backend/internal/domain/categories.go), which
`POST`/`PUT /api/subjects` check every `stats` key against
([contract note](03-data-model.md#stats-is-validated-against-the-seven-ids)). Labels, colours,
prose and metrics stay frontend-owned — adding a category means editing `CATEGORIES` **and**
`domain.CategoryIDs`.

> **One palette, one place.** Bar charts use `cat.color` (a Tailwind class) and SVG charts use
> `cat.hex` — both on the same object. The old `CATEGORY_COLORS` mirror is gone; recolouring is
> a single edit.

---

## 3. Domain vocabulary

### Relationship
The person a stack of snapshots is about — one `Relationship` row owned by a user, carrying a
`name` unique among that user's relationships. It is the durable identity: renaming it renames
every snapshot under it, and the timeline URL addresses it by id.

Names are compared exactly after trimming, so `"Alex "` and `"Alex"` are one relationship while
`"alex"` and `"Alex"` are two. Uniqueness is enforced in the handlers rather than by a database
constraint — see [Data Model](03-data-model.md#relationship). A relationship also carries an
optional **check-in rhythm** (`cadence_days`) — see [Cadence](#cadence-and-the-two-nudges).

### Subject
One dated snapshot, stored as one `AnalysisSubject` row. (The name is historical: "subject"
means the *snapshot*, which is why the durable entity added in Phase 4 is called `Relationship`
instead.) It carries:

- `relationship_id` — set by the server on every write; never chosen by the client.
- `name` — free text kept denormalized on the row so old clients keep working. A **label, not
  the identity**: rename and merge sync it across every version.
- `date` — the *date of state*: the point in time the assessment describes, not when it was
  entered.
- `stats` — the seven scores. A **missing key means "not scored"**, not zero; the server never
  zero-fills.
- `description` — the **snapshot note** about the period described. Optional.
- `tags` — the **context capsule**: up to 12 short event labels for the same period.
- `uncertain` — category ids the user scored but does not trust.
- `guide_answers` — the guided-scoring answers behind those scores, if any were used.
- `kind` — `full` or `pulse`; how the snapshot was taken, not how much it counts.

### Context capsule (`description` + `tags`)
A snapshot records *what* changed; the capsule records *why it might have*. Two fields written
in `PersonForm`'s "What's been happening?" step: a free-text **note** with no length limit, and
**tags** — a JSON string array with seven presets offered as toggle chips (*conflict, distance,
trip together, milestone, reconciliation, routine period, life change*) plus free-text entry.
Limits — max 12 tags, each trimmed, non-empty, ≤ 40 characters — are enforced on both sides.

Context describes a **period, not a person**, so it is never inherited: editing seeds the
existing note and tags, but a new version starts them empty. Nothing is computed from tags.

### Check-in
The journal's peer of the snapshot, and deliberately a different thing. A snapshot is a
considered reading of a whole relationship on a date; a check-in is a sentence about **right
now** — one to five feelings from the closed `FEELINGS` vocabulary, each with a strength of one
to three and optionally what it was about: a person, a trigger, or a context tag. Stored as one
`JournalEntry` of `kind: "checkin"` ([Data Model](03-data-model.md#journalentry)), written in
three taps.

- **It records an instant, not a period.** `at` is the moment; `day` is the civil day it falls
  in, with a **4 a.m. rollover** — a check-in at 02:00 belongs to the day you have not gone to
  bed from yet.
- **It is append-only, like a version.** There is no edit: a correction is a new entry naming
  the one it replaces, and a withdrawal is a delete that leaves the people and triggers it named
  where they are.
- **Its people are the same people.** A name typed into a check-in resolves through
  `FindOrCreateRelationship` on the server, in the entry's transaction — the same function the
  snapshot path uses — so naming someone in the journal and then snapshotting them yields one
  relationship. A person known only from the journal has `snapshot_count: 0` and so does not
  appear on the dashboard; the journal's People view is where they live.
- **`can't tell` is a first-class answer**, not a gap. Alexithymia is not the absence of feeling
  but the absence of a name for one, so the vocabulary carries an entry for exactly that.
- **Nothing is graded but the strength.** No mood score, no daily average, no streak.

### Trigger
What a feeling was about when it was not a person — *work*, *the move*, *money*. The user grows
them one at a time: a new one is created only when the user confirms the label, in the same
transaction as the check-in that named it, and a check-in references it by `client_id` and never
by label, so renaming one never rewrites what was already written. Merging two is one-way, and
the dialog says so.

### The nightly ritual
Five to nine binary questions, one card at a time, at an hour the user picks. The five core
questions ask about the things that move how a day felt without being about anyone — sleep,
movement, daylight, company, eating — and up to three optional ones sit beside them. It closes
by asking for the day in one word. Stored as a single `JournalEntry` of `kind: "ritual"`.

- **A skipped question is absent, not `false`.** `answers` holds only what was answered;
  `question_set.asked` records what was put on screen, and it is the only thing that can tell a
  question nobody answered from one never shown. Swipe right for yes, left for no, up to skip —
  and a tap records nothing, because the person doing this is half asleep.
- **A night nobody answers writes no row.** There is no place a missed night could leave a mark.
  That is the absence of the data structure, not restraint in the copy.
- **The day word is written twice, on purpose.** It stays in the ritual row so the night reads
  whole in an export, and it is also written as a `checkin` with `source: "ritual_word"` so that
  everything reading check-ins never has to know rituals exist. It carries no intensity: one tap
  on one word has no strength in it, and inventing a middle number would be the app authoring a
  value the user did not.

Each question has a permanent id, so turning an optional one on later never changes what an
older night meant. The settings are per device and are never sent anywhere.

### Version
One snapshot in a relationship's history. Creating a new version modifies nothing: it `POST`s a
brand-new `AnalysisSubject` with the same name and a newer `date`, and the server resolves it
into the same relationship. History is append-only and every past assessment stays independently
editable and deletable.

### The "stack" abstraction
All versions of one relationship, presented as a pile of cards. The pile is a view; the
relationship is the record.

```js
// src/context/SubjectsContext.jsx — grouping is the relationship id
export const stackKey = (person) => person.relationship_id ?? `unlinked-${person.ID}`;
```

Before Phase 4 this grouped on the `name` string, which had three consequences the entity
removes:

| Before | Now |
| :----- | :-- |
| Renaming one version split it out of its stack, and nothing could rename the group | The stack has a name of its own. Renaming it moves every version; renaming a single version still detaches it, deliberately |
| Two different people sharing a name silently became one stack | Two relationships, two stacks, side by side |
| Nothing could be attached to a relationship as a whole | Anything can — this is what per-relationship cadence and export hang off |

Version labels are positional, not stored — `v{sortedVersions.length - index}` after a
descending date sort, so the newest always shows the highest number.

**A stack is grouped by id, never by name.** A snapshot arriving without a `relationship_id`
would be a server bug (the startup backfill and find-or-create leave no unlinked rows), so the
client gives such a row a stack of its own rather than merging every unlinked row into one pile.

### Rename and merge
Two stack-level actions from the `⋯` menu. **Rename** changes the relationship's name and every
card follows; colliding with another of your relationships is refused with a message suggesting
merge. **Merge** moves every snapshot of one stack into another and retires the source — it is
**one-way**, nothing records which snapshots came from where, so the dialog states exactly what
will happen before confirming. Deleting a whole relationship is the third action, worded to be
unmistakable next to the per-version delete: it names the number of snapshots it will take.

### Full and pulse
Two ways to take a snapshot, one kind of record. A **full** snapshot is the seven-slider form. A
**pulse** is the same snapshot in under a minute: every category opens carrying last time's
answer marked *unchanged*, and you open only what has moved; guided scoring is hidden.

**A pulse is a real version, not a lesser one.** Same version badge, same
[What Changed](#what-changed) payoff, counted the same everywhere. The only difference is that
the timeline draws its point slightly smaller — a *quieter* mark, not a lower-status one. The
distinction exists so a rhythm can survive a busy month, not so snapshots can be ranked.

### Cadence, and the two nudges
A relationship can opt in to a **check-in rhythm**: monthly, quarterly, twice a year, or a
custom 7–365 days. Off is the default and always available. When more days have passed than the
rhythm asks, the dashboard shows **one calm sentence**: *"It's been 9 weeks since your last
snapshot of Alex."* That is the entire feature.

What it deliberately does **not** do, as a product rule rather than a style preference:

| Not this | Because |
| :------- | :------ |
| Streaks, chains, badges | A missed month must not read as a failure. Coming back after six silent months looks exactly like coming back after six days |
| Counts of missed check-ins | Nothing is gained by telling someone how much they did not do |
| Red, urgency vocabulary, exclamation marks | The copy states an interval and stops. `nudgeSentence` is unit-tested against a list of forbidden words |
| Repeating within a session | Dismissing retires it until a new session; "Later" buys seven days |
| Email, push, or any server-side scheduler | Due-ness is computed **in the browser** from the latest snapshot's date. There is nothing to send, which keeps the privacy claim literally true |

A relationship with no dated snapshot is never due: an undated snapshot has no position in time.

The journal's nightly prompt is the second nudge, under the same rules. The two never show at
once — after the ritual's chosen hour the ritual line takes the slot and the cadence banner waits
for the next session, because two calm sentences stacked are a to-do list.

### Stat / metric / anchor — three different things
- A **stat** is one of the seven stored integers (`stats.eros === 85`).
- A **metric** is *educational copy* — a behavioural indicator listed in the Category Explorer
  and in guided scoring. Metric text is never stored; the user's *answers* to metrics are.
- An **anchor** is a band of slider positions with five phrasings attached, so a number means
  something before it is chosen — and means more than one thing, said more than one way.

---

## 3a. Scoring vocabulary

### Anchored sliders
A naked 0–100 slider asks for exactly the introspection alexithymia impairs. Every category
carries `anchors[]`: contiguous bands covering 0–100 — six for most, five for `selflessness`,
which has half as many metrics behind it and so resolves more coarsely. One phrasing from the
band containing the current value shows live beneath the slider, and band boundaries are drawn
as tick marks.

**Each band carries five phrasings, not one.** A single sentence per band meant the whole scale
was explained by a handful of sentences, and a user who had read them once learned nothing from
reading them again. The five are written through five lenses: where your attention goes, what
you actually do, a recognisable scene, what their absence is like, and how it feels from inside.

Which one appears is chosen by `anchorPhrase(category, value, seed)`, under two constraints that
pull against each other: it must not change while the thumb is moving (so it depends on the
*band*, never the value), and it must not be the same sentence forever (so the seed changes each
time the form is opened). The seed is a rotating counter with a random start — five openings walk
the whole set, where a fresh random draw would happily repeat itself.

Anchors are **content, not computation**: they describe the position the user chose, and choosing
a position never consults them.

### Guided scoring
Any category can be scored by answering its `metrics[]` instead of guessing at a number. Each is
answered on a four-point frequency scale (`GUIDE_SCALE`: *Never, Sometimes, Often, Constantly* →
0, 35, 70, 100), from which the UI computes:

```
average = mean of the chosen frequency values
band    = [average − 8, average + 8]   (rounded, clamped to 0–100)
```

and states it in one sentence: *"Your 2 answers average 53 — a suggested range of 45–61. The
final number is yours."* The band is drawn on the slider track as a highlight.

**The slider never moves on its own.** A "Use 53" button applies the midpoint, and that press is
the user authoring the value. The arithmetic is one line of subtraction and addition, visible,
explained and ignorable.

What is stored is the *answers*, not the band: `guide_answers` maps category id → metric index →
scale index (0–3), so a future view can show why a score was chosen.

### Skipped and unsure — two kinds of "I don't know"
- **Skipped** ("Not scoring this today") means the category key is **absent** from `stats`.
  Absent is not zero: the card renders `—`, the timeline leaves a gap, and a comparison involving
  it is reported as *not comparable*.
- **Unsure** (the `?` chip) means the user gave a number but does not trust it. The id goes into
  `uncertain[]`; the value renders with a `≈` and a dashed outline, and deltas built from it are
  prefixed `≈`. A category can only be unsure if it has a score — the server enforces that.

Both exist so that "I don't know" never has to be expressed as a confident 0.

### What Changed
After a snapshot lands in an existing stack — a new version, or a create whose name matches one —
the app immediately shows the difference from the previous snapshot by date: elapsed time,
per-category deltas sorted by size, small movements collapsed into *"4 dimensions steady"*, and a
prompt to write a note. It is **plain subtraction**, and the screen says so. An in-place edit is a
correction rather than a new reading, so it never triggers the screen.

---

## 4. The user journeys

### Onboarding
`/` renders [`Landing.jsx`](../src/components/Landing.jsx) for anonymous visitors. `/login`
renders [`Auth.jsx`](../src/components/Auth.jsx), one component toggling between sign-in and
sign-up. Signup does **not** return a token: the component switches back to the login view and
shows *"Account created! Please log in."*

### The dashboard loop
Once a token exists, `/` renders [`Dashboard.jsx`](../src/components/Dashboard.jsx):

1. **Read** — a responsive grid of card stacks, one per relationship. A header above each pile
   gives the snapshot count and a `⋯` menu with the stack-level actions. Each card shows the
   name, date, version badge, a one-line summary (*"Storge · Pragma dominant — Mania most
   changed"*), and a seven-bar chart in which unscored categories read `—` and unsure ones `≈`. A
   toggle flips the bars to the Love Shape. Context, if any, appears as a note icon and up to
   three tag chips under the date.
2. **Browse history** — hovering a stack and scrolling the wheel flips through versions in place.
3. **Create** — "New Analysis" opens `PersonForm`: name, date, seven anchored sliders, then the
   "What's been happening?" step.
4. **Amend** — the pencil edits that exact version in place (`PUT`), context included. No What
   Changed screen: this is a correction.
5. **Extend** — the plus opens the same form with the name locked, the date today, and context,
   uncertainty and scores cleared, saving as a new row (`POST`) — which opens
   [What Changed](#what-changed).
6. **Analyse** — the trending-up action navigates to `/relationships/<id>/timeline`, a real URL,
   keyed by id so the bookmark survives a rename.
7. **Delete** — the trash removes *one version* after a `window.confirm` whose wording says "this
   specific version". Removing the whole history is a separate action in the stack menu.

### Reflection — the timeline
`/relationships/:id/timeline` renders one stack as a Recharts multi-line chart: **x-axis
proportional to real time**, y-axis fixed to 0–100, seven coloured lines, legend entries toggling
visibility. This is the payoff of the whole versioning design.

Because the axis is real time, a week's gap and a year's gap no longer look the same, and
snapshots carrying tags or a note appear as **milestone markers** — a flag at the true date
opening a panel with the tags and the note. The marker states what else was happening; the app
never claims one caused the other.

The pre-Phase-4 form `/timeline/:name` still resolves by looking the name up in the loaded list
and redirecting. Best-effort by construction — a stack renamed since the link was made cannot be
found that way, which is exactly the fragility the id route ends.

### Love Shape
The same seven numbers drawn as a polygon on seven fixed axes. Because the axis order is always
the taxonomy order, the *shape* becomes recognisable in a way seven bars are not. An unscored
category is an open vertex at the centre rather than a confident zero, and a snapshot can be
ghosted against another to see the difference directly.

### The vault
`/vault` answers three questions on one page: what is stored, what leaves the machine, and how to
get it all out.

- **Export** — one JSON document with every relationship and snapshot (notes, tags, uncertainty,
  guided answers) and every journal entry with the people it names and anything since corrected;
  plus flat CSVs, where a skipped category is an **empty cell** rather than a zero, and a second
  sheet at one row per feeling per check-in, without the transcript.
- **Import** — the same JSON back in. It always dry-runs first; a snapshot already present is
  skipped and a journal entry is matched by the id it was written with, so importing the same
  file twice changes nothing.
- **The privacy answers** are static copy, and every claim has to be true of the code as written:
  nothing is sent anywhere, and **the database is not encrypted**. Saying the last one plainly
  matters more than the others.

### Discretion mode
An eye icon in the navbar (or `Ctrl+.`) collapses names to initials, blurs notes and tag chips
until you look directly at them, and drops the app name from the tab title. Instant, reversible,
entirely client-side.

It is scoped honestly: it defends against the person sitting next to you, not against anyone with
access to the machine. The data, the API responses and the labels read by assistive technology are
unchanged — hiding a name from a screen reader would harm a user without protecting them.

An optional **app lock** adds a passphrase (a SHA-256 hash in `localStorage`) covering the app on
load and after 15 minutes idle. The setting says outright what it is: *"This locks the screen on
this device. It does not encrypt the database."* There is no recovery flow, and the page says so.

### Self-description
[`Profile.jsx`](../src/components/Profile.jsx) stores facts about the *user*: name, email, age,
MBTI type (a fixed 16-entry `<select>`), and an avatar. MBTI is a free-form string used in no
calculation — contextual self-description only.

---

## 5. The Category Explorer (`AboutModal`)

The `ⓘ` button in the dashboard header opens a two-level modal that is the application's entire
teaching surface: level 1 is a 2-column grid of the seven categories (colour dot, label,
one-line description); level 2 shows a category's `extendedDescription`, its `coreMotivation`,
and a "How to Detect It" list built from `metrics[]`. Navigation is one piece of local state,
`selectedCategory`; `null` means level 1. No routing.

This modal is why the taxonomy copy is long-form: it is not decoration, it is the instrument the
user calibrates against before touching a slider.

---

## 6. What the application deliberately does not do

Knowing the negative space prevents wrong assumptions when extending the project.

- **No computation of scores.** No weighting, normalising or summing; the seven values are
  independent and need not total 100. The arithmetic that does exist — the guided-scoring band,
  the What Changed deltas, the card summary line — is mean-and-±8, subtraction, and
  max-minus-min. Each is stated in words on screen, and none writes a value the user did not
  confirm. **The journal computes nothing either**: no mood score, no daily average, no weighting
  of one feeling against another. What it counts, it counts.
- **No causal claims.** Milestone markers put a tag beside a movement; they never assert it
  caused one. Vocabulary stays descriptive: "most changed", not "most volatile".
- **No inter-user features.** No sharing, no comparing, no social graph. Every row is scoped by
  `user_id` on every query, and a row belonging to someone else is `404`, never `403`.
- **No cross-relationship analysis.** Relationships are separate records with no links between
  them. The entity makes such a view *possible*; nothing implements one.
- **No merge history.** Merging is one-way and records nothing about where a snapshot came from,
  so it cannot be undone from within the app. The dialog says so before it acts.
- **No clinical claim.** Nothing performs alexithymia screening. "Alexithymia" names the
  motivating problem, not a diagnostic feature.
- **No AI that decides.** Where a model runs, it runs on the device, off by default, and its
  output is a proposal the user accepts or rejects chip by chip. Nothing a model says is written
  without that tap, and no model ever writes a score. The journal can run Gemma 4 E2B on the
  device to write a spoken note down and suggest labels for it; the save payload is built from
  what was confirmed, and the server validates ids rather than opinions. There is a **second**
  on-device model behind a **second** switch, off by default: EmbeddingGemma turns the words you
  have already used into numbers, kept only on that device and deleted at sign-out, so the
  journal can say *"you've called this 'work' before"*. It offers; it never merges, never renames,
  never shows a number — and it only offers when something structural agrees, meaning the same
  person or the same trigger. The same switch lets the journal be **searched**, on the device,
  and what comes back is entries — a day, a time, your own words — never a summary and never a
  score. The love snapshots are untouched by any of it.
- **No listening.** The microphone is open only while the record button is active. No wake word,
  no background capture; recording stops on a second tap, after two seconds of silence, or at
  thirty. **The audio is never stored** — it lives in memory until the words exist and is
  overwritten the moment they do. A voice is a biometric; a transcript is not.
- **No notifications sent anywhere.** Reminders exist and on Android are system notifications,
  but every one is scheduled by the app, on the device, from data the device already holds.
  Opt-in, off by default: no push service, no token, no email, no server that knows when anything
  is due. **The ritual's reminder has fixed, content-free text** — one sentence saying the
  questions are ready, never what they are, because a lock screen is readable by whoever is
  holding the phone.
- **No gamification.** No streaks, no badges, no scores about your scoring — see
  [Cadence](#cadence-and-the-two-nudges).
- **No encryption at rest.** The database is a plain file or your Postgres instance. Passwords
  are hashed; notes and scores are not, and neither is anything the journal holds. The Vault page
  says so rather than implying otherwise. [`docs/13`](13-zero-knowledge-encryption.md) describes
  an envelope scheme that would change this; it is an **unconfirmed option and not a schedule**.
