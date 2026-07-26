# Phase 1 — Data Integrity & Context Capsules

**Vision features implemented:** 1.4 Context Capsules ·  supporting groundwork for 1.5 and Phase 2.
**Known issues closed:** description wipe, unvalidated `stats`, silent malformed dates, false-success DELETE, console-only errors.

---

## Phase Overview & Objectives

Make every snapshot safe to store and worth storing. Concretely:

1. **Stop the silent data loss**: editing a snapshot must never erase its notes
   ([Known Issues](../docs/11-known-issues.md#description-is-silently-erased-on-edit)).
2. **Give snapshots context**: a notes field (repurposing the existing `Description` column)
   and event **tags** ("Context Capsules") entered at snapshot time — the raw material for the
   timeline markers of Phase 3 and the story views of later phases.
3. **Validate what the server stores**: category ids and 0–100 bounds enforced server-side;
   malformed dates rejected loudly; deletes that touch nothing return 404.
4. **Surface errors to the user**: a failed save must not look identical to a successful one.

User value: nothing a user writes is ever silently destroyed, and six months from now a Mania
spike has a note beside it explaining *why*.

## Prerequisites

- Baseline system as documented in `docs/` (no prior phases).
- Both DB backends must keep working: SQLite fallback and Postgres
  ([Architecture](../docs/02-architecture.md)). All schema changes in this phase are additive
  and `AutoMigrate`-compatible.

---

## Component & Schema Specifications

### Backend Changes

#### 1. Model — add `Tags` ([`models.go`](../backend/internal/models/models.go))

```go
type AnalysisSubject struct {
    gorm.Model
    UserID      uint           `json:"user_id"`
    Name        string         `gorm:"not null" json:"name"`
    Description string         `json:"description"`            // now: the snapshot note
    Date        *time.Time     `json:"date"`
    Stats       map[string]int `gorm:"serializer:json" json:"stats"`
    Tags        []string       `gorm:"serializer:json" json:"tags"` // NEW — context chips
}
```

- `Tags` uses the same JSON serializer pattern as `Stats`; nullable/empty is valid.
- `Description` semantics are formally redefined as **"snapshot note"** — free text the user
  writes about the period the snapshot describes. Update `docs/01-concepts.md` accordingly.

#### 2. Category allowlist — new package `backend/internal/domain`

Create `backend/internal/domain/categories.go`:

```go
package domain

// CategoryIDs is the stable stats-key contract shared with the frontend
// (CATEGORIES in src/components/Dashboard.jsx). IDs only — all prose,
// colors, and metrics remain frontend-owned by design.
var CategoryIDs = []string{"eros", "ludus", "storge", "pragma", "mania", "agape", "selflessness"}
```

Only the **ids** are duplicated (they are already the documented cross-tier contract); no
labels, descriptions, or metrics move to Go.

#### 3. Validation ([`subjects.go`](../backend/internal/handlers/subjects.go))

Add a shared helper used by both create and update:

- `validateStats(stats map[string]int) error`
  - Every key must be in `domain.CategoryIDs` → else `400 {"error": "unknown stats key: <k>"}`.
  - Every value must satisfy `0 <= v <= 100` → else `400 {"error": "stats.<k> must be between 0 and 100"}`.
  - **Missing keys are legal.** An absent key means "not scored" (this becomes the skip
    semantics in Phase 2). Do not zero-fill.
- `validateTags(tags []string) error`
  - Max 12 tags; each trimmed, non-empty, ≤ 40 chars → else 400 with a specific message.
- **Date parsing becomes strict.** In both handlers, a non-empty `Date` that fails
  `time.Parse("2006-01-02", …)` returns `400 {"error": "invalid date, expected YYYY-MM-DD"}`
  instead of being silently discarded
  ([Known Issues](../docs/11-known-issues.md#malformed-dates-are-silently-discarded)).
- **Name is trimmed server-side** (`strings.TrimSpace`) on create and update, and must be
  non-empty after trimming. This prevents the `"Alex "` vs `"Alex"` accidental stack split
  ([Concepts](../docs/01-concepts.md#the-stack-abstraction)). Note: this only affects new
  writes; no retroactive cleanup of existing rows in this phase (Phase 4's backfill handles
  legacy whitespace).

#### 4. Partial-merge update semantics

Replace the reuse of `CreateSubjectInput` in `UpdateSubject` with a dedicated struct using
pointer fields, so *absent* is distinguishable from *empty*:

```go
type UpdateSubjectInput struct {
    Name        *string         `json:"name"`
    Description *string         `json:"description"`
    Date        *string         `json:"date"`   // nil = unchanged; "" = clear to null; value = parse strictly
    Stats       *map[string]int `json:"stats"`
    Tags        *[]string       `json:"tags"`
}
```

Assignment rule: only assign fields that are non-nil. This is the durable fix for the
description wipe — even if a future client omits a field, the server no longer destroys it.
(The same pattern is the documented fix for `PUT /api/me`
([Known Issues](../docs/11-known-issues.md#put-apime-cannot-clear-any-field)) — apply it there
too in this phase; it is the identical three-line change per field.)

#### 5. DELETE honesty

Capture the GORM result in `DeleteSubject`; if `RowsAffected == 0`, return
`404 {"error": "Subject not found"}`
([Known Issues](../docs/11-known-issues.md#delete-reports-success-for-rows-it-did-not-delete)).

### Frontend Changes

#### 1. `PersonForm` — notes + tags step ([`Dashboard.jsx`](../src/components/Dashboard.jsx), §3.6 of [Frontend docs](../docs/06-frontend.md))

- Add a **"What's been happening?"** section below the sliders:
  - A row of preset tag chips (toggle on/off): `conflict`, `distance`, `trip together`,
    `milestone`, `reconciliation`, `routine period`, `life change` — defined as a new
    module-level constant `CONTEXT_TAGS` next to `CATEGORIES`, plus a small free-text input to
    add a custom tag (enforce the same limits as the server: ≤ 40 chars, ≤ 12 tags).
  - A notes `<textarea>` bound to `description` (placeholder: *"Anything future-you should
    know about this period?"*). Optional, 2–3 rows, no length ceiling in UI (server accepts
    arbitrary text).
- `onSave` payload becomes `{ name: name.trim(), date, stats, description, tags }` — the
  client-side half of the wipe fix (currently `{ name, date, stats }` only, per
  [`Dashboard.jsx:410`](../src/components/Dashboard.jsx#L410)).
- Edit mode must seed `description` and `tags` from `initialData`.
- New-version mode seeds `tags`/`description` **empty** (context describes a period; it does
  not inherit).

#### 2. Card surface — show that context exists

- On the active card in `CardStack`: if the snapshot has a note, render a small note icon
  (lucide `StickyNote`); if tags exist, render up to 3 small chips (then `+n`). Clicking the
  icon expands the note inline (simple local toggle — no modal).
- Keep it quiet: context indicators are secondary text, `text-slate-400`-tier, so cards do not
  get noisy.

#### 3. User-visible error handling

- Add a `notice` state `{ type: 'error' | 'success', text }` to `Dashboard`, rendered as a
  dismissible banner above the grid (reuse the visual language of `Profile.jsx`'s message
  banner). Wire it into the three currently-silent `catch` blocks (`fetchSubjects`,
  `handleSavePerson`, `deletePerson`)
  ([Frontend §3.7](../docs/06-frontend.md#37-dashboard-487640--the-screen)). On save failure the
  form stays open with the user's input intact.
- Add a global axios **401 response interceptor** in `App.jsx` beside the existing token
  effect: on 401, clear the token (which routes to Landing) — closing the "empty grid with no
  explanation" trap
  ([Known Issues](../docs/11-known-issues.md#no-client-side-token-expiry-handling)).

## Step-by-Step Implementation Tasks

1. [ ] Backend: add `Tags` to `AnalysisSubject`; verify `AutoMigrate` adds the column on both
       SQLite and Postgres.
2. [ ] Backend: create `internal/domain/categories.go` with `CategoryIDs`.
3. [ ] Backend: implement `validateStats` / `validateTags`; call from `CreateSubject`.
4. [ ] Backend: strict date parsing (400 on malformed) in both handlers.
5. [ ] Backend: server-side `TrimSpace` on `Name` in both handlers; reject empty.
6. [ ] Backend: introduce `UpdateSubjectInput` with pointer fields; rewrite `UpdateSubject`
       with non-nil-only assignment; apply validation to provided fields.
7. [ ] Backend: pointer-field sparse update for `PUT /api/me` (`UpdateProfileInput`).
8. [ ] Backend: `RowsAffected` check in `DeleteSubject` → 404.
9. [ ] Backend: update handler tests + fixtures (existing fixtures with arbitrary stats keys
       will now 400 — adjust deliberately, per
       [Recipe 8's warning](../docs/10-agent-guide.md)).
10. [ ] Frontend: `CONTEXT_TAGS` constant; tags + notes UI in `PersonForm`; extend `onSave`
        payload; seed rules for edit vs new-version modes.
11. [ ] Frontend: context indicators (note icon, tag chips) on the active card.
12. [ ] Frontend: `notice` banner in `Dashboard`; wire all three catch blocks; keep form open
        on failed save.
13. [ ] Frontend: 401 interceptor in `App.jsx`.
14. [ ] Docs: update `docs/01-concepts.md` (Description = snapshot note; tags), `docs/03-data-model.md`,
        `docs/04-api-reference.md` (new validation, 400/404 responses, `tags` field), and strike
        the closed entries from `docs/11-known-issues.md`.

## Verification & Testing Criteria

**Automated (must pass):**
- `go test ./...` — new cases: unknown stats key → 400; value 101 / −1 → 400; missing keys
  accepted; malformed date → 400; `PUT` with body `{"stats": {...}}` only → name, description,
  date, tags unchanged; `DELETE` of nonexistent id → 404; tags over limits → 400.
- `npm test` — new `PersonForm` tests: payload includes trimmed name, description, tags;
  edit mode preserves an existing note; new-version mode starts with empty context.

**Manual QA:**
1. Create a snapshot with a note + 2 tags → reload → both persist and render on the card.
2. Edit that snapshot changing only a slider → note and tags survive (the headline bug).
3. Via `curl`, `PUT` a subject with `{"description": ""}` → note cleared (explicit clear
   works); with description absent → note intact.
4. Stop the backend, attempt a save → error banner appears, form stays open, input intact.
5. Let a token expire (or corrupt it in localStorage) → app returns to Landing instead of an
   unexplained empty grid.

**Regression guard:** existing dashboard flows (create, edit, new version, delete, wheel-scrub,
timeline) behave exactly as before; snapshots created before this phase render unchanged
(`tags` absent → no chips).
