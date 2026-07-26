# Phase 3 — Visual Identity & Navigation

**Vision features implemented:** 2.1 Love Shapes (radar) · 2.3 Truthful Timeline (time axis +
milestone markers) · 2.4 Relationship Summary Line · addressable timeline routes.
**Known issues closed:** categorical x-axis, timeline not addressable, stale timeline snapshot,
wheel-scroll trap, `CATEGORY_COLORS` duplication.

---

## Phase Overview & Objectives

Turn stored history into recognizable meaning:

1. **A truthful timeline** — x-axis proportional to real time, with Phase 1 context tags
   rendered as milestone markers, so "Mania spiked right after the long-distance move" becomes
   *visible* without the app ever claiming causation.
2. **Love Shapes** — every snapshot renderable as a seven-axis radar polygon, with ghost
   overlays (previous / first / other stack) for instant comparison.
3. **Deep-linkable analysis** — `/timeline/:name` as a real route: bookmarkable, refreshable,
   back-button-correct, and never stale.
4. **Glanceable card meaning** — a one-line transparent summary per stack (dominant styles,
   most-changed dimension).

## Prerequisites

- **Phase 1** (tags exist — they are the milestone markers; error banner for fetch failures on
  direct route entry).
- **Phase 2** (skipped/uncertain semantics — every new chart must render them honestly;
  `WhatChanged` will embed the radar overlay built here).

## Component & Schema Specifications

### Backend Changes

**None.** This phase is intentionally frontend-only; it must ship without touching the API, to
keep the Phase 4 migration isolated.

### Frontend Changes

#### 1. Single-source color/palette cleanup (enabler)

- Add a `hex` field to each `CATEGORIES` entry in
  [`Dashboard.jsx`](../src/components/Dashboard.jsx) (values from the existing
  `CATEGORY_COLORS` in
  [`AnalysisTimeline.jsx:15-23`](../src/components/AnalysisTimeline.jsx#L15-L23)); delete
  `CATEGORY_COLORS` and read `cat.hex` everywhere. Removes the two-place registration rule
  documented in [Concepts §2](../docs/01-concepts.md#2-the-color-wheel-theory-of-love).
- Optional but recommended while touching this file: move `CATEGORIES` (and `CONTEXT_TAGS`,
  `GUIDE_SCALE`) into `src/constants/categories.js`, re-exported from `Dashboard.jsx` for
  compatibility. `Dashboard.jsx` is 641+ lines and Phase 3 adds components; start splitting.

#### 2. Time-proportional timeline ([`AnalysisTimeline.jsx`](../src/components/AnalysisTimeline.jsx))

- Data shaping gains a numeric timestamp: `ts: v.date ? new Date(v.date).getTime() : null`;
  rows without dates are excluded from the chart and counted in a small footnote ("1 undated
  snapshot not shown") rather than silently misplaced.
- `<XAxis dataKey="ts" type="number" domain={['dataMin', 'dataMax']} scale="time"
  tickFormatter={d => new Date(d).toLocaleDateString()} />` — points now sit at their true
  temporal positions; a day's gap and a year's gap finally look different
  ([Known Issues](../docs/11-known-issues.md#architectural-limitations)).
- Tooltip `labelFormatter` formats the timestamp back to a locale date.
- Duplicate-date snapshots: nudge subsequent duplicates by +12h for display only (document in
  a code comment; data untouched).
- **Milestone markers:** for every snapshot with `tags.length > 0` or a note, render a
  `<ReferenceLine x={ts}>` with a slim slate stroke and a custom label glyph (lucide `Flag` or
  the first tag's chip). Hover/click opens a small popover: date, tags, note excerpt. Marker
  rendering must not collide with line dots — labels sit in a reserved 24px top band.
- Keep: fixed `YAxis domain={[0,100]}`, legend line-toggling (`hiddenLines` Set), per-mount
  reset — these are working patterns ([Frontend §4](../docs/06-frontend.md#4-analysistimelinejsx)).
- Keep Phase 2 honesty: `connectNulls={false}`, dashed dots for uncertain points.

#### 3. `LoveShape` — the radar component (new, `src/components/LoveShape.jsx`)

- Recharts `RadarChart`: `PolarAngleAxis` over the seven category labels (stable order =
  `CATEGORIES` order), `PolarRadiusAxis domain={[0,100]}` hidden ticks, one `<Radar>` per
  series, fill `cat`-neutral (single-hue polygon with per-vertex colored dots is cleaner than
  seven-color fill; use `slate` fill at 20% opacity, stroke `slate-800`; comparison ghost in
  `rose` at 15% opacity, dashed stroke).
- Props: `snapshot` (required), `compareTo` (optional snapshot), `size`. Skipped categories
  render at the center with an open marker (not zero-filled — annotate "not scored" in the
  tooltip); uncertain vertices use dashed markers.
- Placements this phase:
  1. **Card flip:** a toggle icon on the active card switches bars ⇄ radar (local state per
     stack; bars remain the default).
  2. **Timeline header:** current shape beside a ghost of the **first** snapshot, with a
     selector `compare to: first | previous | none`.
  3. **`WhatChanged` (Phase 2 component):** embed new-vs-previous overlay above the delta list.
- Animation between versions while wheel-scrubbing the card stack is a stretch goal; only do
  it if the radar toggle is default-off (bars) so scrub performance is unaffected.

#### 4. Routing — make analysis addressable ([`App.jsx`](../src/App.jsx))

- New route: `/timeline/:name` (token-guarded like `/profile`;
  `encodeURIComponent(name)` when linking, `decodeURIComponent` via `useParams`).
- **State lift:** move `people` + `fetchSubjects` + the mutation handlers' state updates from
  `Dashboard` into a `SubjectsContext` provider mounted in `App` (or a custom hook
  `useSubjects` with module-level cache — implementer's choice; context is the straightforward
  option given no state library exists). `Dashboard` and the new `TimelineRoute` both consume
  it. This kills the stale-snapshot bug: the timeline derives its stack from live state instead
  of a captured array
  ([Known Issues](../docs/11-known-issues.md#the-timeline-is-not-addressable)).
- `TimelineRoute`: reads `:name`, finds the stack via the same grouping logic (extract
  `groupPeople(people)` into a shared util), renders `AnalysisTimeline`; unknown name → an
  empty-state card with a back link. Direct entry (fresh load) fetches via the context and
  shows a loading state.
- `Dashboard`'s "Deep Analysis" action becomes `navigate('/timeline/' + encodeURIComponent(name))`;
  the `selectedTimelineStack` conditional-swap state is deleted. "Back" is `navigate(-1)` with
  a fallback link to `/`.
- Phase 4 will migrate this route to id-based (`/relationships/:id/timeline`); keep the
  name-based route thin so the swap is cheap (route component + link builder only).

#### 5. Relationship summary line (on each stack card)

Beneath the name on the active card, one muted line, e.g.
**`Storge · Pragma dominant — Mania most changed`**:

- *Dominant:* top 2 categories by value in the **latest** snapshot (ties broken by
  `CATEGORIES` order; suppress the line if latest has < 2 scored categories).
- *Most changed:* category with the largest `max − min` across the stack's scored values;
  only shown when the stack has ≥ 3 versions. Label is exactly "most changed" — the vocabulary
  invariant forbids "volatile"-as-judgment; "changed" is descriptive.
- An `ⓘ` `title`/popover states the formula in one sentence ("highest two scores in your
  latest snapshot; widest range across all snapshots").

#### 6. Wheel-trap fix ([`CardStack`](../src/components/Dashboard.jsx), [Frontend §3.4](../docs/06-frontend.md#34-cardstack-149296--the-wheel-scrubbed-version-pile))

In the wheel handler: when `sortedVersions.length === 1`, or the scroll direction is already
clamped at the relevant end, **do not** call `preventDefault()` — let the page scroll. Mind the
documented dependency-array caveat when touching this handler.

## Step-by-Step Implementation Tasks

1. [ ] Palette single-sourcing (`hex` on `CATEGORIES`, delete `CATEGORY_COLORS`); optional
       constants-file extraction.
2. [ ] Timeline: numeric time axis + tick/tooltip formatters + undated-row footnote +
       duplicate-date display nudge.
3. [ ] Timeline: milestone `ReferenceLine` markers + tag/note popover.
4. [ ] `LoveShape` component with compare-ghost, skip/uncertain rendering.
5. [ ] Card radar toggle; timeline-header shape + compare selector; embed overlay in
       `WhatChanged`.
6. [ ] `SubjectsContext` (or `useSubjects`) state lift; extract shared `groupPeople` util.
7. [ ] `/timeline/:name` route + `TimelineRoute`; delete `selectedTimelineStack`; rewrite
       Deep-Analysis action + Back behavior.
8. [ ] Summary line (dominant / most changed) + formula popover.
9. [ ] Wheel-trap fix in `CardStack`.
10. [ ] Docs: rewrite `docs/06-frontend.md` §3–4 (context, routes, new components); update
        `docs/01-concepts.md` user journeys; strike closed items in `docs/11-known-issues.md`.

## Verification & Testing Criteria

**Automated (`npm test`):**
- `groupPeople` util: grouping, sort order, whitespace names (still exact-match post-trim).
- `LoveShape`: renders 7 axes; skipped category yields open center marker, not a zero vertex;
  compare ghost appears only with `compareTo`.
- Summary line: dominant pair for a known snapshot; "most changed" hidden below 3 versions;
  tie-break order.
- Timeline shaping: `ts` computed; undated rows excluded and counted; marker data derived only
  from snapshots with tags/notes.
- Route: `/timeline/Unknown%20Name` renders empty state; valid name renders chart (Testing
  Library + `MemoryRouter`).

**Manual QA:**
1. A stack with snapshots at 1-day and 1-year gaps → visibly unequal spacing.
2. Tagged snapshot → flag marker at correct date; popover shows tags + note.
3. Radar toggle on a card; scrub versions → shape reflects the active version.
4. Open `/timeline/Alex` directly in a fresh tab → loads (fetch on entry), Back goes to `/`.
5. From an open timeline, edit a version in another tab/window → timeline reflects it after
   the context refetch (no stale snapshot).
6. Pointer over a single-version card → page still wheel-scrolls.

**Regression guard:** legend toggling still isolates lines; Y stays fixed 0–100 for
cross-subject comparability; bars remain the card default; no API calls changed shape (backend
untouched this phase).
