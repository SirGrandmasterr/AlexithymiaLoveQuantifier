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

1. **Self-scored, not computed.** The application contains no inference engine, no
   questionnaire scoring algorithm, and no AI. The user moves seven sliders; the
   backend stores those seven numbers verbatim. Every "metric" description in the UI is
   guidance for the human doing the rating — see
   [Category Explorer](#5-the-category-explorer-aboutmodal).
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
- `anchors[]` — 3–4 `{ min, max, phrase }` bands that give every slider position a
  behavioural meaning. See [Anchored sliders](#anchored-sliders) below.

**Where this lives:** the `CATEGORIES` array,
[`src/components/Dashboard.jsx:6-117`](../src/components/Dashboard.jsx#L6-L117).
It is a plain module-level constant — the *only* definition of the taxonomy in the
running application.

The backend knows the seven **ids** and nothing else: they are duplicated as a validation
allowlist in [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go),
which `POST`/`PUT /api/subjects` check every `stats` key against
([see the contract note](03-data-model.md#stats-is-validated-against-the-seven-ids)).
Labels, colours, prose, and metrics stay frontend-owned — adding a category means editing
`CATEGORIES`, `CATEGORY_COLORS`, **and** `domain.CategoryIDs`.

> **Colour duplication.** Bar charts use the Tailwind class strings (`cat.color`), but
> Recharts needs real hex values for SVG strokes, so the palette is restated as
> `CATEGORY_COLORS` in
> [`src/components/AnalysisTimeline.jsx:15-23`](../src/components/AnalysisTimeline.jsx#L15-L23).
> Adding or recolouring a category requires editing **both** places.

---

## 3. Domain vocabulary

### Subject
A **subject** is the target of one analysis — typically a person the user has feelings
about. It is stored as one `AnalysisSubject` row. A subject carries:

- `name` — free text; also the grouping key (see below). Trimmed server-side on write.
- `date` — the *date of state*: the point in time the assessment describes, not the
  moment it was entered.
- `stats` — the seven scores. A **missing key means "not scored"**, not zero; the server
  never zero-fills.
- `description` — the **snapshot note**: free text about the period the snapshot
  describes. Optional.
- `tags` — the **context capsule**: up to 12 short event labels for the same period.
- `uncertain` — category ids the user scored but does not trust.
- `guide_answers` — the guided-scoring answers behind those scores, if any were used.

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

### Version
A **version** is a subject row that shares its `name` with other rows. Creating a new
version does not modify anything: it `POST`s a brand-new `AnalysisSubject` with the same
`name` and a newer `date`. History is therefore append-only and every past assessment
stays independently editable and deletable.

Realised by `startNewVersion` →`PersonForm` with `isNewVersion` →`handleSavePerson`'s
POST branch, [`src/components/Dashboard.jsx:520-563`](../src/components/Dashboard.jsx#L520-L563).
In new-version mode the name input is disabled so the grouping key cannot drift
([`Dashboard.jsx:429-437`](../src/components/Dashboard.jsx#L429-L437)).

### The "stack" abstraction
A **stack** is all versions sharing one `name`, presented as a physical pile of cards.
It is computed, never stored:

```js
// src/components/Dashboard.jsx:509-518
const groupedPeople = useMemo(() => {
    const groups = {};
    people.forEach(person => {
        if (!groups[person.name]) groups[person.name] = [];
        groups[person.name].push(person);
    });
    return Object.values(groups);
}, [people]);
```

Consequences worth internalising before changing anything here:

- Grouping is by **exact string equality** on `name`. `"Alex"` and `"alex "` are two
  different people.
- Renaming one version splits it out of its stack.
- Two genuinely different people who share a name are merged into one stack.
- Version labels are positional, not stored: `v{sortedVersions.length - index}` after a
  descending date sort, so the newest version always shows the highest number
  ([`Dashboard.jsx:253-257`](../src/components/Dashboard.jsx#L253-L257)).

### Stat / metric / anchor — three different things
- A **stat** is one of the seven stored integers (`stats.eros === 85`).
- A **metric** is a piece of *educational copy* — a behavioural indicator listed in the
  Category Explorer and in guided scoring to help the user choose a number. Metric text is
  never stored; the user's *answers* to metrics are (see [guided scoring](#guided-scoring)).
- An **anchor** is a phrase attached to a range of slider positions, so a number means
  something before it is chosen.

---

## 3a. Scoring vocabulary

### Anchored sliders
A naked 0–100 slider asks for exactly the introspection alexithymia impairs. Every category
therefore carries `anchors[]`: contiguous bands covering 0–100, each with one behavioural
phrase in the second person. The phrase for the band containing the current value is shown
live beneath the slider, and the band boundaries are drawn as tick marks.

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

1. **Read** — a responsive grid of card stacks, one per distinct name. Each card shows
   the name, its date, its version badge, and a seven-bar horizontal chart in which
   unscored categories read `—` and unsure ones read `≈`. If the active snapshot carries
   context, a note icon and up to three tag chips sit under the date; the icon expands the
   note inline.
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
6. **Analyse** — the trending-up action swaps the whole grid for the timeline view.
7. **Delete** — the trash action removes *one version* after a `window.confirm`, whose
   wording deliberately says "this specific version".

### Reflection — the timeline
[`AnalysisTimeline.jsx`](../src/components/AnalysisTimeline.jsx) renders one stack as a
Recharts multi-line chart: x-axis = version dates ascending, y-axis fixed to 0–100,
seven coloured lines. Clicking a legend entry toggles that line's visibility, so a user
can isolate, say, `mania` against `storge` over two years. This is the payoff of the
whole versioning design — the one screen where drift over time becomes legible.

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
  are independent and need not total 100. The two pieces of arithmetic that do exist —
  the guided-scoring suggestion band and the What Changed deltas — are mean-and-±8 and
  subtraction respectively, are stated in words on screen, and never write a value the
  user did not confirm.
- **No inter-user features.** No sharing, no comparing, no social graph. Every
  `AnalysisSubject` is scoped to its owner by `user_id` on every query.
- **No subject identity.** Subjects are strings, not records; see
  [the stack abstraction](#the-stack-abstraction).
- **No clinical claim.** Nothing in the codebase performs alexithymia screening (no
  TAS-20 or similar). "Alexithymia" names the motivating problem, not a diagnostic
  feature.
- **No notifications, reminders, or scheduling.**
