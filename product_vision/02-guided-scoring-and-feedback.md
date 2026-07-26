# Phase 2 — Guided Scoring & Immediate Feedback

**Vision features implemented:** 1.2 Metric-First Guided Scoring · 1.3 Anchored Sliders ·
1.5 Honest Uncertainty · 2.2 "What Changed" post-snapshot payoff · (partial) 1.1 onboarding
touchpoints.

---

## Phase Overview & Objectives

Fix the two ends of the core loop: **scoring is too hard** (a naked 0–100 slider demands the
exact introspection alexithymia impairs) and **saving is unrewarded** (the modal closes and
nothing acknowledges what changed). After this phase:

1. Every slider position has a behavioral meaning (**anchors**).
2. Every category can be scored by answering its behavioral indicators, with a **transparent
   suggestion band** the user is free to ignore (**guided mode**).
3. "I'm not sure" and "skip this one" are first-class answers (**uncertainty**).
4. Saving a non-first snapshot immediately shows plain-arithmetic **deltas** since the previous
   one, with a prompt to add a context note (**What Changed**).

Hard constraint (from [README invariants](README.md#invariants--every-phase-must-preserve-these)):
all arithmetic is visible, explained in the UI in one sentence, and never writes a value the
user didn't confirm. The suggestion band **never** moves the slider.

## Prerequisites

- **Phase 1 complete.** Required: server accepts missing stats keys (skip semantics), notes +
  tags exist (the What Changed screen links into them), partial-merge updates (new fields added
  here must not wipe old ones), error banner (guided-mode saves reuse it).

---

## Component & Schema Specifications

### Backend Changes

Small and additive — this phase is predominantly frontend.

#### 1. Model additions ([`models.go`](../backend/internal/models/models.go))

```go
type AnalysisSubject struct {
    // ... existing fields ...
    Uncertain    []string                  `gorm:"serializer:json" json:"uncertain"`     // NEW — category ids flagged "unsure"
    GuideAnswers map[string]map[string]int `gorm:"serializer:json" json:"guide_answers"` // NEW — categoryId -> metricIndex(as string) -> 0..3
}
```

- `Uncertain`: subset of `domain.CategoryIDs`; validated server-side (unknown id → 400). A
  category may be uncertain only if it is present in `stats`.
- `GuideAnswers`: the user's per-metric frequency answers, persisted so a future view can show
  *why* a score was chosen ("defensible scores"). Outer keys validated against
  `domain.CategoryIDs`; inner values must be 0–3. Optional — absent is the normal case for
  unguided scoring. Metric index keys are stringified ints (`"0"`–`"3"`) because JSON object
  keys are strings.
- Extend `CreateSubjectInput` and `UpdateSubjectInput` (pointer field) accordingly; extend the
  Phase 1 validators.

No new endpoints. `stats` semantics from Phase 1 carry the skip feature for free: a skipped
category is simply an absent key.

### Frontend Changes

#### 1. Taxonomy content — anchors ([`Dashboard.jsx`](../src/components/Dashboard.jsx) `CATEGORIES`)

Each of the seven category objects gains:

```js
anchors: [
  { min: 0,  max: 20,  phrase: '…' },
  { min: 21, max: 45,  phrase: '…' },
  { min: 46, max: 70,  phrase: '…' },
  { min: 71, max: 100, phrase: '…' },
]
```

- **Content task, not just code:** author 3–4 anchor phrases per category in the voice of the
  existing `metrics` copy — behavioral, second-person, recognizable (e.g., Eros 0–20: *"You
  notice them the way you notice anyone."*). Derive tone from
  [`TestImplementationDetails.txt`](../TestImplementationDetails.txt). Bands need not be
  uniform widths; they must be contiguous and cover 0–100.
- The frequency scale for guided mode is a shared constant:
  `GUIDE_SCALE = [{label:'Never', value:0}, {label:'Sometimes', value:35}, {label:'Often', value:70}, {label:'Constantly', value:100}]`.

#### 2. `CategorySliderRow` — extract and extend

Extract the per-category slider row from `PersonForm` into a dedicated component (props:
`category`, `value`, `uncertain`, `skipped`, `guideAnswers`, plus change callbacks). It renders:

- **The slider** (unchanged input) with subtle tick marks at anchor band boundaries.
- **The live anchor phrase** beneath the slider — the phrase of the band containing the current
  value; updates as the thumb moves. Hidden when skipped.
- **"Guide me" expander**: reveals the category's `metrics[]` as rows, each with a 4-option
  segmented control (`GUIDE_SCALE` labels). When ≥1 metric is answered:
  - Compute `avg` = mean of answered metric values; band = `[max(0, round(avg) − 8), min(100, round(avg) + 8)]`.
  - Render the band as a translucent highlight on the slider track plus the sentence:
    *"Your N answers average X — a suggested range of A–B. The final number is yours."*
  - The slider is **never** auto-moved. A small "use midpoint" button sets the value to
    `round(avg)` — an explicit user action, satisfying the authorship invariant.
- **Skip toggle** ("Not scoring this today"): removes the key from `stats` on save; row renders
  collapsed/ghosted. Distinct from value 0, per Phase 1 semantics.
- **Unsure toggle** (small `?` chip): adds the id to `uncertain`; the row shows a dashed value
  chip. Disabled while skipped.

`PersonForm` state grows: `uncertain: []`, `skipped: []`, `guideAnswers: {}` — seeded from
`initialData` in edit mode (`skipped` derived from absent keys), reset appropriately in
new-version mode (carry forward nothing except slider values, which already pre-fill; decide:
**pre-fill values, clear uncertainty/guides** — last time's uncertainty is not this time's).
`onSave` payload adds `uncertain` and `guide_answers`, and omits skipped keys from `stats`.

#### 3. Rendering skipped & uncertain everywhere

- `LoveChart` (the seven-bar card chart): distinguish key-absent from zero — currently
  impossible because of `stats[cat.id] || 0`
  ([Frontend §3.3](../docs/06-frontend.md#33-lovechart-125145)). Absent → render the track with
  a small "—" and no fill (not a zero-width bar); uncertain → bar at 60% opacity with a dashed
  border. Tooltip/`title` text explains: "not scored" / "marked unsure".
- `AnalysisTimeline`: uncertain points get hollow dashed dots (Recharts custom `dot` renderer);
  skipped categories simply have no datum for that snapshot (`connectNulls={false}` so gaps are
  honest). Full timeline overhaul is Phase 3; this phase only ensures the current chart does
  not lie about the new states.

#### 4. `WhatChanged` — the post-snapshot payoff screen (new component)

Trigger: after a successful save in **new-version mode** (POST branch of `handleSavePerson`),
and after **create** when the name matches an existing stack. Never after an in-place edit.

Content (all client-side arithmetic over the just-saved snapshot vs. the previous version by
date within the stack):

1. Header: name + elapsed time — *"11 weeks since your last snapshot of Alex."*
2. **Delta list**, sorted by `|delta|` descending: category dot, label, signed delta with
   arrow, old → new. Rules: category absent on either side → listed under "not comparable
   (skipped)"; both uncertain or either uncertain → delta shown with a "≈" prefix.
   Movements of |delta| < 5 collapse into one line: *"4 dimensions steady."*
3. Footer prompt: *"Want to note what you think drove this?"* → button opens the Phase 1
   notes/tags editor for the **new** snapshot (partial-merge PUT saves just
   `description`/`tags`).
4. Dismiss ("Done") returns to the grid.

Copy discipline: descriptive only. Never "improved/worsened," never advice. The one-sentence
transparency rule: a caption reading *"Differences between your last two snapshots — plain
subtraction, nothing more."*

#### 5. Small onboarding touchpoints (partial 1.1)

- Wire the dead **"Learn the Theory"** button on `Landing.jsx` to open the category content
  (either render `AboutModal` from Landing or link to a `/about` route — implementer's choice,
  minimal scope) ([Known Issues](../docs/11-known-issues.md#dead-controls)).
- Empty-grid state: replace the bare "New Analysis" affordance with a short invitation block:
  *"Map your first relationship — a past one works well: you already know how it ended."*
  Full guided-walkthrough onboarding remains future scope (post-Phase 5 backlog).

## Step-by-Step Implementation Tasks

1. [ ] Backend: add `Uncertain` + `GuideAnswers` columns; extend both input structs and Phase 1
       validators; handler tests for invalid ids / out-of-range guide values / uncertain-on-skipped.
2. [ ] Content: author anchor phrases for all 7 categories (review pass against
       `TestImplementationDetails.txt` tone; non-clinical vocabulary check).
3. [ ] Frontend: add `anchors` to `CATEGORIES`; define `GUIDE_SCALE`.
4. [ ] Frontend: extract `CategorySliderRow`; implement anchor display + band ticks.
5. [ ] Frontend: guided mode (metric rows, band math, band overlay, "use midpoint").
6. [ ] Frontend: skip + unsure toggles; `PersonForm` state/payload changes; edit/new-version
       seeding rules.
7. [ ] Frontend: `LoveChart` skipped/uncertain rendering (remove the `|| 0` conflation).
8. [ ] Frontend: `AnalysisTimeline` gap + dashed-dot handling (`connectNulls={false}`).
9. [ ] Frontend: `WhatChanged` component + trigger wiring in `handleSavePerson`; note/tags
       follow-up action via partial PUT.
10. [ ] Frontend: "Learn the Theory" wiring; empty-state invitation copy.
11. [ ] Docs: update `docs/01-concepts.md` (anchors, guided scoring, uncertainty semantics),
        `docs/03-data-model.md` + `docs/04-api-reference.md` (new fields), `docs/06-frontend.md`
        (new components).

## Verification & Testing Criteria

**Automated:**
- `go test ./...` — new fields round-trip; `uncertain: ["nope"]` → 400; guide answer value 4 → 400;
  uncertain id not present in stats → 400.
- `npm test` — `CategorySliderRow`: anchor phrase matches band at boundary values (0, 20, 21,
  100); band math for known answer sets (e.g., answers [35, 70] → avg 52.5 → band [45, 61]);
  "use midpoint" sets exactly `round(avg)`; skip removes the key from the save payload.
  `WhatChanged`: delta ordering, skip/uncertain rules, steady-collapse threshold.

**Manual QA:**
1. Score a category via guided mode only → band renders; slider untouched until "use midpoint".
2. Set a value outside the band and save → saved value is the user's, not the midpoint.
3. Skip `ludus`, mark `mania` unsure, save → card shows "—" for ludus and dashed mania; reload
   persists both.
4. Add a new version → What Changed appears with correct deltas and elapsed time; "add a note"
   saves note+tags onto the new snapshot without touching stats (verify via reload).
5. In-place edit → **no** What Changed screen.
6. A pre-Phase-2 snapshot (no uncertain/guide fields) renders and edits without errors.

**Regression guard:** unguided fast path (slide seven values, save) requires zero extra clicks
versus today; Phase 1 banner still appears on failures; timeline still renders stacks
containing mixed old/new snapshots.
