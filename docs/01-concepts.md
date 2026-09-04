# 01 — Concepts & Domain Model

This document defines the *semantic* content of the project: what the application is
about, what each domain term means, and where each concept is realised in code.

---

## 1. The premise

**Alexithymia** is difficulty identifying and describing one's own emotions. The
application's thesis is that if a feeling cannot be *named* introspectively, it can
still be *estimated behaviourally* — by scoring observable behaviours instead of
reporting felt states.

The application therefore does not ask "how do you feel about this person?". It asks
the user to rate, per love category, a set of **behavioural metrics** — things that can
be noticed from the outside, such as *"You experience genuine distress if they do not
reply to a message within a specific timeframe."*

The output is a numeric profile: seven integers, each 0–100, describing the *mixture*
of love styles present in one relationship at one point in time.

Two consequences shape the entire product:

1. **Self-scored, not computed.** The **love snapshots** contain no inference engine, no
   scoring algorithm, and no AI: the user moves seven sliders and the backend stores those
   seven numbers verbatim. Every "metric" description in the UI is guidance for the human
   doing the rating — see [Category Explorer](#5-the-category-explorer-aboutmodal).

   The **emotional journal** (Phase 6) may, on this device and only when turned on,
   **transcribe a spoken note and propose labels for it**. It writes the words down, shows
   them to you to correct, and offers feelings, people and triggers it heard — every one of
   them dashed until you tap it. **A proposal is never a record until the user confirms it**,
   and what is saved is built from the confirmed state and nothing else. No model has ever
   written a score, and none can: the proposal contract has no slot for one.
2. **Longitudinal by design.** Because a single self-assessment is noisy and because
   feelings change, the primary unit is not "a person" but "a dated snapshot of a
   person". Change over time is the actual signal — hence the versioning and timeline
   features.

---

## 2. The Color Wheel Theory of Love

The scoring dimensions come from John Alan Lee's *Colours of Love* (1973), commonly
called the Color Wheel Theory of Love, which describes love styles as primary and
secondary "colours" that mix.

This project uses **seven** categories: Lee's six, plus a seventh, `selflessness`,
which the project treats as the extreme tail of `agape`. The seventh is a deliberate
project-specific extension, documented as such in the source text
([`TestImplementationDetails.txt:97-106`](../TestImplementationDetails.txt#L97-L106))
and in the UI copy itself.

### The seven categories

Each category is stored under a lowercase `id`, which is also the JSON key inside
`stats` and the `dataKey` used by the chart. **These ids are the stable contract**
between frontend, backend, and database.

| `id` | Label | Plain meaning | Core motivation | Colour (Tailwind / hex) |
| :--- | :---- | :------------ | :-------------- | :---------------------- |
| `eros` | Eros | Romantic, passionate love — the "chemistry" mode, driven by attraction, aesthetics, and rapid intense connection. | Physical and emotional merging. | `bg-rose-400` / `#fb7185` |
| `ludus` | Ludus | Playful, flirtatious love — love as a game enjoyed without the weight of obligation. | Entertainment, freedom, the "chase". | `bg-orange-400` / `#fb923c` |
| `storge` | Storge | Unconditional, familial love — the "slow burn" that grows out of friendship and shared values. | Companionship, stability, psychological comfort. | `bg-amber-400` / `#fbbf24` |
| `pragma` | Pragma | Enduring, logical love — checklist-driven evaluation of practical compatibility. | Long-term compatibility and life alignment. | `bg-emerald-400` / `#34d399` |
| `mania` | Mania | Obsessive, intense love — volatile, rooted in low self-esteem or fear of abandonment. | Alleviating anxiety through possession and reassurance. | `bg-violet-400` / `#a78bfa` |
| `agape` | Agape | Selfless, universal love — the partner's wellbeing placed above one's own, without expectation of return. | Unconditional care and betterment of the other. | `bg-blue-400` / `#60a5fa` |
| `selflessness` | Selflessness | Complete lack of ego — the absolute extreme end of the Agape spectrum. | Total removal of the "self" from the relationship. | `bg-slate-400` / `#94a3b8` |

Each category additionally carries, in code:

- `description` — one-line gloss shown next to sliders and in the category grid.
- `extendedDescription` — paragraph shown in the category detail view.
- `coreMotivation` — the italicised "why" line.
- `metrics[]` — 2–4 `{ title, description }` pairs; the behavioural indicators. Six
  categories have four metrics; `selflessness` has two.
- `anchors[]` — 5–6 `{ min, max, phrases }` bands that give every slider position a
  behavioural meaning, each carrying **five** phrasings of it. See
  [Anchored sliders](#anchored-sliders) below.

**Where this lives:** the `CATEGORIES` array,
[`src/constants/categories.js`](../src/constants/categories.js). It is a plain module-level
constant — the *only* definition of the taxonomy in the running application, re-exported
from `Dashboard.jsx` for callers that have always looked there.

The backend knows the seven **ids** and nothing else: they are duplicated as a validation
allowlist in [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go),
which `POST`/`PUT /api/subjects` check every `stats` key against
([see the contract note](03-data-model.md#stats-is-validated-against-the-seven-ids)).
Labels, colours, prose, and metrics stay frontend-owned — adding a category means editing
`CATEGORIES`, `CATEGORY_COLORS`, **and** `domain.CategoryIDs`.

> **One palette, one place.** Bar charts use the Tailwind class string (`cat.color`) and the
> SVG charts use `cat.hex` — both fields sit on the same category object. The old
> `CATEGORY_COLORS` mirror in `AnalysisTimeline.jsx` is gone; recolouring is a single edit.

---

## 3. Domain vocabulary

### Relationship
A **relationship** is the person a stack of snapshots is about — one `Relationship` row,
owned by a user, carrying a `name` that is unique among that user's relationships. It is
the durable identity: renaming it renames every snapshot under it, and the timeline URL
addresses it by id.

Names are compared exactly after trimming, so `"Alex "` and `"Alex"` are one relationship
while `"alex"` and `"Alex"` are two. Uniqueness is enforced in the handlers rather than by a
database constraint — see [Data Model](03-data-model.md#relationship).

A relationship also carries an optional **check-in rhythm** (`cadence_days`) — see
[Cadence](#cadence-and-the-two-nudges) below.

### Subject
A **subject** is the target of one analysis — one dated snapshot, stored as one
`AnalysisSubject` row. (The name is historical: "subject" means the *snapshot*, which is why
the durable entity added in Phase 4 is called `Relationship` instead.) A subject carries:

- `relationship_id` — which relationship this is a snapshot of. Set by the server on every
  write; never chosen by the client.
- `name` — free text, kept denormalized on the row so old clients keep working. It is a
  **label, not the identity**: rename and merge sync it across every version.
- `date` — the *date of state*: the point in time the assessment describes, not the
  moment it was entered.
- `stats` — the seven scores. A **missing key means "not scored"**, not zero; the server
  never zero-fills.
- `description` — the **snapshot note**: free text about the period the snapshot
  describes. Optional.
- `tags` — the **context capsule**: up to 12 short event labels for the same period.
- `uncertain` — category ids the user scored but does not trust.
- `guide_answers` — the guided-scoring answers behind those scores, if any were used.
- `kind` — `full` or `pulse`; how the snapshot was taken, not how much it counts.

### Context capsule (`description` + `tags`)
A snapshot records *what* changed; the context capsule records *why it might have*. It is
two fields written at snapshot time in `PersonForm`'s "What's been happening?" step:

- **Note** (`description`) — free text, no length limit, prompted with *"Anything
  future-you should know about this period?"*.
- **Tags** (`tags`) — a JSON string array. Seven presets are offered as toggle chips
  (`CONTEXT_TAGS` in [`Dashboard.jsx:122`](../src/components/Dashboard.jsx#L122): *conflict,
  distance, trip together, milestone, reconciliation, routine period, life change*) plus
  free-text entry. Limits — max 12 tags, each trimmed, non-empty, ≤ 40 characters — are
  enforced on both sides.

Context describes a **period, not a person**, so it is never inherited: editing a snapshot
seeds the existing note and tags, but starting a new version starts them empty. Nothing is
computed from tags; they are raw material for the user's own reading of the timeline.

### Check-in
A **check-in** is the journal's peer of the snapshot, and the two are deliberately different
things. A snapshot is a considered reading of a whole relationship on a date; a check-in is a
sentence about **right now** — one to five feelings from the closed `FEELINGS` vocabulary,
each with a strength of one to three and, optionally, what it was about: a person, a trigger,
or a context tag. It is stored as one `JournalEntry` of `kind: "checkin"`
([Data Model](03-data-model.md#journalentry)), and it is written in three taps.

- **It records an instant, not a period.** `at` is the moment; `day` is the civil day that
  moment falls in, with a **4 a.m. rollover** — a check-in at 02:00 belongs to the day you
  have not gone to bed from yet.
- **It is append-only, like a version.** A check-in is a statement made at a moment, so there
  is no edit: a correction is a new entry naming the one it replaces, and a withdrawal is a
  delete that leaves the people and triggers it named where they are.
- **Its people are the same people.** A name typed into a check-in resolves through
  `FindOrCreateRelationship` on the server, in the entry's transaction — the same function the
  snapshot path uses — so naming someone in the journal and then snapshotting them yields one
  relationship, not two. A person known only from the journal has `snapshot_count: 0` and so
  does not appear on the dashboard; the journal's own People view is where they live.
- **`can't tell` is a first-class answer**, not a gap. Alexithymia is not the absence of
  feeling but the absence of a name for one, so the vocabulary carries an entry for exactly
  that, drawn dashed like every other uncertainty in this app, and it stands on its own.
- **Nothing is graded but the strength.** There is no mood score, no daily average and no
  streak; the feeling labels are nouns and the one graded axis is the intensity the user set.

### Trigger
A **trigger** is what a feeling was about when it was not a person — *work*, *the move*,
*money*. Triggers are records the user grows one at a time: a new one is created only when the
user confirms the label, in the same transaction as the check-in that named it, and a check-in
references it by its `client_id` and never by its label, so renaming one never rewrites what
was already written. Merging two is one-way, and the dialog says so.

### The nightly ritual
The **ritual** is the journal's other way in: five to nine binary questions, one card at a
time, at an hour the user picks. The five core questions ask about the things that move how a
day felt without being about anyone — sleep, movement, daylight, company, eating — and up to
three optional ones can be turned on beside them. It closes by asking for the day in one word.

It is stored as a single `JournalEntry` of `kind: "ritual"`, and three properties are the
whole design:

- **A skipped question is absent, not `false`.** `answers` holds only what was answered;
  `question_set.asked` records what was put on screen, and it is the only thing that can tell
  a question nobody answered from one that was never shown. Swipe right for yes, left for no,
  up to skip — and a tap records nothing, because the person doing this is half asleep.
- **A night nobody answers writes no row.** There is no place a missed night could leave a
  mark: no "last night", no total, nothing to count. That is the absence of the data
  structure, not restraint in the copy — see [the two nudges](#cadence-and-the-two-nudges).
- **The day word is written twice, on purpose.** It stays in the ritual row so the night reads
  whole in an export, and it is also written as a `checkin` with `source: "ritual_word"` so
  that everything reading check-ins never has to know rituals exist. It carries no intensity:
  one tap on one word has no strength in it, and inventing a middle number would be the app
  authoring a value the user did not.

Each question is stored under a permanent id, so turning an optional one on later never
changes what an older night meant. The settings are per device and are never sent anywhere.

### Version
A **version** is one snapshot in a relationship's history. Creating a new version does not
modify anything: it `POST`s a brand-new `AnalysisSubject` with the same name and a newer
`date`, and the server resolves it into the same relationship. History is therefore
append-only and every past assessment stays independently editable and deletable.

Realised by `startNewVersion` → `PersonForm` with `isNewVersion` → `handleSavePerson`'s
POST branch. In new-version mode the name input is disabled, which now matters less than it
used to: the server would resolve the same relationship anyway.

### The "stack" abstraction
A **stack** is all versions of one relationship, presented as a physical pile of cards.
The pile is a view; the relationship is the record.

```js
// src/context/SubjectsContext.jsx — grouping is the relationship id
export const stackKey = (person) => person.relationship_id ?? `unlinked-${person.ID}`;
```

Before Phase 4 this grouped on the `name` string, which had three consequences the entity
removes:

| Before | Now |
| :----- | :-- |
| Renaming one version split it out of its stack, and nothing could rename the group. | The stack has a name of its own. Renaming it moves every version; renaming a single version still detaches it, deliberately. |
| Two different people sharing a name silently became one stack. | Two relationships, two stacks. The dashboard shows them side by side. |
| Nothing could be attached to a relationship as a whole. | Anything can — this is what Phase 5's per-relationship cadence and export hang off. |

Still true: version labels are positional, not stored — `v{sortedVersions.length - index}`
after a descending date sort, so the newest version always shows the highest number.

**A stack is grouped by id, never by name.** A snapshot arriving without a
`relationship_id` would be a server bug (the startup backfill and find-or-create between
them leave no unlinked rows), so the client gives such a row a stack of its own rather than
merging every unlinked row into one pile.

### Rename and merge
Two stack-level actions, reached from the `⋯` menu above each pile:

- **Rename** changes the relationship's name; every card follows. Colliding with another of
  your relationships is refused with a message suggesting merge instead.
- **Merge** moves every snapshot of one stack into another and retires the source. It is
  **one-way** — nothing records which snapshots came from where — so the dialog states
  exactly what will happen (*"All 4 snapshots of Alex M will move into Alex. This cannot be
  split apart automatically."*) before asking for confirmation.

Deleting a whole relationship is the third action, worded to be unmistakable next to the
per-version delete: it names the number of snapshots it will take.

### Full and pulse
Two ways to take a snapshot, one kind of record.

- A **full** snapshot is the seven-slider form: anchors, optional guided scoring, skip and
  unsure toggles, then the context step.
- A **pulse** is the same snapshot taken in under a minute. Every category opens carrying
  last time's answer marked *unchanged*; you open only what has moved. Guided scoring is
  hidden — the careful path and the fast path are different tools for different days.

**A pulse is a real version, not a lesser one.** It gets the same version badge, triggers
the same [What Changed](#what-changed) payoff, and counts the same everywhere. The only
difference in the product is that the timeline draws its point slightly smaller — a
*quieter* mark, not a lower-status one. The distinction exists so that a rhythm can survive
a busy month, not so that snapshots can be ranked.

### Cadence, and the two nudges
A relationship can opt in to a **check-in rhythm**: monthly, quarterly, twice a year, or a
custom interval between 7 and 365 days. Off is the default and always available.

When more days have passed than the rhythm asks for, the dashboard shows **one calm
sentence**: *"It's been 9 weeks since your last snapshot of Alex."* That is the entire
feature.

What it deliberately does **not** do, as a product rule rather than a style preference:

| Not this | Because |
| :------- | :------ |
| Streaks, chains, badges | A missed month must not read as a failure. Coming back after six silent months looks exactly like coming back after six days. |
| Counts of missed check-ins | Nothing is gained by telling someone how much they did not do. |
| Red, urgency vocabulary, exclamation marks | The copy states an interval and stops. `nudgeSentence` is unit-tested against a list of forbidden words. |
| Repeating within a session | Dismissing retires it until a new session; "Later" buys seven days. |
| Email, push, or any server-side scheduler | Due-ness is computed **in the browser** from the latest snapshot's date. There is nothing to send, which is what keeps the privacy claim literally true. |

A relationship with no dated snapshot is never due: an undated snapshot has no position in
time, so it cannot make anything overdue.

The journal's nightly prompt is the second, under the same rules: opt-in, one sentence, no
count of anything. The two never show at once — after the ritual's chosen hour the ritual
line takes the slot and the cadence banner waits for the next session, because two calm
sentences stacked are a to-do list. A night nobody answers writes no row and leaves no trace
the next morning.

### Stat / metric / anchor — three different things
- A **stat** is one of the seven stored integers (`stats.eros === 85`).
- A **metric** is a piece of *educational copy* — a behavioural indicator listed in the
  Category Explorer and in guided scoring to help the user choose a number. Metric text is
  never stored; the user's *answers* to metrics are (see [guided scoring](#guided-scoring)).
- An **anchor** is a band of slider positions with five phrasings attached, so a number
  means something before it is chosen — and means more than one thing, said more than one
  way.

---

## 3a. Scoring vocabulary

### Anchored sliders
A naked 0–100 slider asks for exactly the introspection alexithymia impairs. Every category
therefore carries `anchors[]`: contiguous bands covering 0–100 — six for most categories,
five for `selflessness`, which has half as many metrics behind it and so resolves more
coarsely. One phrasing from the band containing the current value is shown live beneath the
slider, and the band boundaries are drawn as tick marks.

**Each band carries five phrasings, not one.** A single sentence per band meant the whole
scale was explained by a handful of sentences, and a user who had read them once learned
nothing from reading them again — which is a poor deal for the person this feature exists
for. The five are written through five different lenses: where your attention goes, what you
actually do, a recognisable scene, what their absence is like, and how it feels from inside.
They describe one position on the scale from five directions rather than restating it.

Which one appears is chosen by `anchorPhrase(category, value, seed)`, under two constraints
that pull against each other: it must not change while the thumb is moving (so it depends on
the *band*, never the value), and it must not be the same sentence forever (so the seed
changes each time the form is opened). The seed is a rotating counter with a random start —
five openings walk the whole set, where a fresh random draw each time would happily repeat
itself and defeat the point.

Anchors are **content, not computation** — they describe the position the user chose, and
choosing a position never consults them.

### Guided scoring
Any category can be scored by answering its `metrics[]` instead of guessing at a number.
Each metric is answered on a four-point frequency scale (`GUIDE_SCALE`: *Never, Sometimes,
Often, Constantly* → 0, 35, 70, 100). From the answered metrics the UI computes:

```
average = mean of the chosen frequency values
band    = [average − 8, average + 8]   (rounded, clamped to 0–100)
```

and states it in one sentence: *"Your 2 answers average 53 — a suggested range of 45–61.
The final number is yours."* The band is drawn on the slider track as a highlight.

**The slider never moves on its own.** A "Use 53" button applies the midpoint, and that
button press is the user authoring the value. This is the whole point: the arithmetic is
one line of subtraction and addition, visible, explained, and ignorable.

What is stored is the *answers*, not the band: `guide_answers` maps category id → metric
index → scale index (0–3), so a future view can show why a score was chosen.

### Skipped and unsure — two kinds of "I don't know"
- **Skipped** ("Not scoring this today") means the category key is **absent** from `stats`.
  Absent is not zero: the card renders `—`, the timeline leaves a gap, and a comparison
  involving it is reported as *not comparable*.
- **Unsure** (the `?` chip) means the user gave a number but does not trust it. The id goes
  into `uncertain[]`; the value renders with a `≈` and a dashed outline, and deltas built
  from it are prefixed `≈`. A category can only be unsure if it has a score — the server
  enforces that.

Both exist so that "I don't know" never has to be expressed as a confident 0.

### What Changed
After a snapshot lands in an existing stack — a new version, or a create whose name matches
one — the app immediately shows the difference from the previous snapshot by date: elapsed
time, per-category deltas sorted by size, small movements collapsed into *"4 dimensions
steady"*, and a prompt to write a note about what drove it. It is **plain subtraction**, and
the screen says so. An in-place edit is a correction rather than a new reading, so it never
triggers the screen.

---

## 4. The user journeys

### Onboarding
`/` renders [`Landing.jsx`](../src/components/Landing.jsx) for anonymous visitors —
value proposition, a "Start Analyzing" link to `/login`, and four colour dots teasing
the taxonomy. `/login` renders [`Auth.jsx`](../src/components/Auth.jsx), one component
toggling between sign-in and sign-up. Signup does **not** return a token: the component
switches itself back to the login view and shows *"Account created! Please log in."*
([`Auth.jsx:21-29`](../src/components/Auth.jsx#L21-L29)).

### The dashboard loop
Once a token exists, `/` renders [`Dashboard.jsx`](../src/components/Dashboard.jsx):

1. **Read** — a responsive grid of card stacks, one per relationship. A quiet header above
   each pile gives the snapshot count and a `⋯` menu holding the stack-level actions
   (rename, merge, delete the whole relationship). Each card shows
   the name, its date, its version badge, a one-line summary (*"Storge · Pragma dominant —
   Mania most changed"*), and a seven-bar horizontal chart in which unscored categories read
   `—` and unsure ones read `≈`. A toggle flips the bars to the Love Shape. If the active
   snapshot carries context, a note icon and up to three tag chips sit under the date; the
   icon expands the note inline.
2. **Browse history** — hovering a stack and scrolling the mouse wheel flips through
   versions in place. Wheel-down reveals older, wheel-up returns to newer.
3. **Create** — "New Analysis" opens `PersonForm`: name, date, seven anchored sliders —
   each with optional guided scoring, a skip toggle and an unsure chip — then the
   "What's been happening?" step (tags + note).
4. **Amend** — the pencil action edits that exact version in place (`PUT`), note, tags,
   uncertainty and guide answers included. No What Changed screen: this is a correction.
5. **Extend** — the plus action opens the same form pre-filled with the last scores, name
   locked, date reset to today, **context and uncertainty cleared**, and saves as a new row
   (`POST`) — which then opens [What Changed](#what-changed).
6. **Analyse** — the trending-up action navigates to `/relationships/<id>/timeline`, a real
   URL the user can bookmark or reload. Keyed by id, so the bookmark survives a rename.
7. **Delete** — the trash action removes *one version* after a `window.confirm`, whose
   wording deliberately says "this specific version". Removing the whole history is a
   separate action in the stack menu, with its own dialog.

### Reflection — the timeline
`/relationships/:id/timeline` renders one stack as a Recharts multi-line chart: **x-axis proportional to
real time**, y-axis fixed to 0–100, seven coloured lines. Clicking a legend entry toggles
that line's visibility, so a user can isolate, say, `mania` against `storge` over two years.
This is the payoff of the whole versioning design — the one screen where drift over time
becomes legible.

Because the axis is real time, a week's gap and a year's gap no longer look the same, and
snapshots carrying tags or a note appear as **milestone markers**: a flag at the true date,
opening a panel with the tags and the note. The marker states what else was happening; the
app never claims one caused the other.

The screen is a real route — bookmarkable, refreshable, back-button-correct — and it reads
the same live subject list the dashboard does, so an edit made elsewhere is never stale here.

The pre-Phase-4 form `/timeline/:name` still resolves: it looks the name up in the loaded
list and redirects to the id route. Best-effort by construction — a stack renamed since the
link was made cannot be found that way, which is exactly the fragility the id route ends.

### Love Shape
The same seven numbers drawn as a polygon on seven fixed axes. Because the axis order is
always the taxonomy order, the *shape* becomes recognisable in a way seven bars are not —
"this is what that relationship looked like". An unscored category is drawn as an open
vertex at the centre rather than a confident zero, and a snapshot can be ghosted against
another (the previous one, the first one, or one from a different stack) to see the
difference directly. It appears on the card as a flip from the bars, in the timeline header,
and in [What Changed](#what-changed).

### The vault
`/vault` answers three questions in one page: what is stored, what leaves the machine, and
how to get it all out.

- **Export** — one JSON document containing every relationship and snapshot with its notes,
  tags, uncertainty flags and guided answers, and every journal entry with the people it
  names and anything since corrected; plus flat CSVs for spreadsheets (one row per snapshot,
  one column per category, a skipped category left as an **empty cell** rather than a zero —
  and a second sheet at one row per feeling per check-in, without the transcript).
- **Import** — the same JSON, back in. It always dry-runs first and shows what would happen
  before writing anything; a snapshot already present is skipped and a journal entry is
  matched by the id it was written with, so importing the same file twice changes nothing.
- **The privacy answers** are static copy, and every claim on the page has to be true of the
  code as written: nothing is sent anywhere, there are no AI features, and **the database is
  not encrypted**. Saying the last one plainly matters more than the first two.

### Discretion mode
An eye icon in the navbar (or `Ctrl+.`) collapses relationship names to initials, blurs
notes and tag chips until you look directly at them, and drops the app name from the tab
title. It is instant, reversible, and entirely client-side.

It is scoped honestly: it defends against the person sitting next to you, not against
anyone with access to the machine. The data, the API responses, and the labels read by
assistive technology are all unchanged — hiding a name from a screen reader would harm a
user without protecting them from anyone looking at the screen.

An optional **app lock** adds a passphrase (stored as a SHA-256 hash in `localStorage`) that
covers the app on load and after 15 minutes idle. The setting says outright what it is:
*"This locks the screen on this device. It does not encrypt the database — anyone with
access to the server files can read them."* There is no recovery flow, and the page says
that too.

### Self-description
[`Profile.jsx`](../src/components/Profile.jsx) stores facts about the *user*, not about
subjects: name, email, age, MBTI type (a fixed 16-entry `<select>`), and an uploaded
avatar. MBTI is stored as a free-form string on the user and is not used in any
calculation — it is contextual self-description only.

---

## 5. The Category Explorer (`AboutModal`)

The `ⓘ` button in the dashboard header opens a two-level modal that is the application's
entire teaching surface
([`Dashboard.jsx:299-385`](../src/components/Dashboard.jsx#L299-L385)):

- **Level 1** — a 2-column grid of the seven categories: colour dot, label, one-line
  description.
- **Level 2** — selecting one shows its `extendedDescription`, its `coreMotivation`, and
  a "How to Detect It" list built from `metrics[]`.

Navigation is a single piece of local state, `selectedCategory`; `null` means level 1,
and the chevron button sets it back to `null`. There is no routing involved.

This modal is why the taxonomy copy is long-form: it is not decoration, it is the
instrument the user calibrates against before touching a slider.

---

## 6. What the application deliberately does not do

Knowing the negative space prevents wrong assumptions when extending the project:

- **No computation of scores.** No weighting, normalising, or summing. The seven values
  are independent and need not total 100. The arithmetic that does exist — the
  guided-scoring suggestion band, the What Changed deltas, and the card summary line — is
  mean-and-±8, subtraction, and max-minus-min respectively. Each is stated in words on
  screen, and none writes a value the user did not confirm.
  **The journal computes nothing either**: no mood score, no daily average, no weighting of
  one feeling against another. What it counts, it counts — *"4 entries name this"* is a count
  of the user's own rows, and the People and Triggers views' *"most often"* line is the same.
- **No causal claims.** Milestone markers put a tag beside a movement; they never assert
  that the tagged event produced it. Vocabulary stays descriptive throughout: "most
  changed", not "most volatile".
- **No inter-user features.** No sharing, no comparing, no social graph. Every
  `AnalysisSubject` and `Relationship` is scoped to its owner by `user_id` on every query,
  and a row belonging to someone else is reported as `404`, never `403`.
- **No cross-relationship analysis.** Relationships are separate records with no links
  between them — no "compare Alex and Sam", no aggregate profile. The entity makes such a
  view *possible*; nothing implements one.
- **No merge history.** Merging is one-way and records nothing about where a snapshot came
  from, so it cannot be undone from within the app. The dialog says so before it acts.
- **No clinical claim.** Nothing in the codebase performs alexithymia screening (no
  TAS-20 or similar). "Alexithymia" names the motivating problem, not a diagnostic
  feature.
- **No AI that decides.** Where a model runs, it runs on the device, off by default, and its
  output is a proposal the user accepts or rejects chip by chip. Nothing a model says is
  written without that tap, and no model ever writes a score. Since Phase 6-D the journal can
  run Gemma 4 E2B on the device to write a spoken note down and suggest labels for it; the
  suggestion arrives on a card where every chip is dashed until it is confirmed, the save
  payload is built from what was confirmed, and the server validates ids rather than opinions.
  Since 6-G there is a **second** on-device model behind a **second** switch, off by default:
  EmbeddingGemma turns the words you have already used into numbers, kept only on that device
  and deleted when you sign out, so the journal can say *"you've called this 'work' before"*
  when a new label looks like an old one. It offers; it never merges, never renames, and never
  shows a number — and it only offers at all when something structural agrees, meaning the same
  person or the same trigger. The love snapshots are untouched by any of it.
- **No listening.** The microphone is open only while the record button is active. There is
  no wake word and no background capture, recording stops on a second tap, after two
  seconds of silence or at thirty, and **the audio is never stored** — it lives in memory
  until the words exist and is overwritten the moment they do. A voice is a biometric; a
  transcript is not.
- **No notifications sent anywhere.** Reminders now exist, and on Android they are system
  notifications — but every one of them is scheduled by the app, on the device, from data the
  device already holds. Opt-in, off by default, and due-ness computed in the browser or the
  WebView: there is no push service, no token, no email, and no server that knows when
  anything is due. On the web there is no scheduler at all and nothing runs when the tab is
  closed. **The nightly ritual's reminder is a local notification with fixed, content-free
  text, scheduled on the device like the cadence reminders** — one sentence saying the
  questions are ready, never what they are, because a lock screen is readable by whoever is
  holding the phone.
- **No gamification.** No streaks, no badges, no scores about your scoring. See
  [Cadence](#cadence-and-the-two-nudges) for the rules this holds itself to.
- **No encryption at rest.** The database is a plain file or your Postgres instance.
  Passwords are hashed; notes and scores are not, and neither is anything the journal holds —
  the words tapped, what was typed, the people and triggers named, the answers to the
  evening questions **and journal transcripts** all sit in the same plain rows. The Vault page says so rather than
  implying otherwise. [`docs/13`](13-zero-knowledge-encryption.md) describes an envelope
  scheme that would change this; it is an **unconfirmed option and not a schedule**, and
  nothing in the product promises it.
