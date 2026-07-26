# Phase 4 — Domain Model Evolution

**Vision features enabled:** stack rename & merge · stable identity for deep links · the
foundation for Phase 5 (per-relationship cadence, coherent export) and for 2.5
(cross-relationship views).
**Known issues closed:** "no subject entity" architectural limitation, no `ORDER BY`, no
referential integrity.

---

## Phase Overview & Objectives

Today "a person" is an emergent client-side grouping of `AnalysisSubject` rows sharing an
exact `name` string ([Concepts](../docs/01-concepts.md#the-stack-abstraction)). Consequences:
stacks cannot be renamed (renaming one version splits it out), two people named "Alex" merge
silently, and nothing can be attached to a relationship as a whole
([Known Issues](../docs/11-known-issues.md#architectural-limitations)).

This phase promotes the grouping into a first-class **`Relationship`** entity (naming note:
"Subject" is avoided because the existing API and model already use it for *snapshots*;
`Relationship` is unambiguous). This is the only phase with a structural migration — keep it
free of feature work beyond rename/merge so the risk stays contained.

Objectives:

1. `Relationship` table; every snapshot carries `relationship_id`.
2. Zero-downtime backfill from `(user_id, TRIM(name))` groupings.
3. **Compatibility by find-or-create:** the existing name-based snapshot flow keeps working —
   the server resolves or creates the `Relationship` on write, so the frontend can migrate
   incrementally.
4. Rename and merge as explicit user actions.
5. Server-side ordering; groundwork FKs.
6. Frontend grouping keyed by `relationship_id`; timeline route becomes id-based.

## Prerequisites

- **Phases 1–3 complete.** Phase 1's name-trimming makes the backfill's TRIM grouping match
  runtime behavior; Phase 3's `SubjectsContext` + extracted `groupPeople` util mean the
  grouping key changes in exactly one place; the route swap assumes `/timeline/:name` is
  already a thin route.
- A **database backup step is mandatory** before running the migration in any real
  deployment (document: copy the SQLite file / `pg_dump`).

## Component & Schema Specifications

### Backend Changes

#### 1. Models ([`models.go`](../backend/internal/models/models.go))

```go
type Relationship struct {
    gorm.Model
    UserID uint   `gorm:"index;not null" json:"user_id"`
    Name   string `gorm:"not null" json:"name"`
}

type AnalysisSubject struct {
    gorm.Model
    UserID         uint  `json:"user_id"`
    RelationshipID *uint `gorm:"index" json:"relationship_id"` // nullable during migration; required after backfill
    // ... existing fields unchanged (Name retained — see below) ...
}
```

- `AnalysisSubject.Name` is **retained** during this phase (denormalized, kept in sync on
  rename) so rollback is trivial and old clients/tests keep passing. Removing it is a listed
  follow-up, not part of this phase.
- Uniqueness: enforce `(user_id, name)` uniqueness for `Relationship` **in the handler**, not
  as a DB constraint (soft deletes make partial unique indexes backend-specific; keep parity
  between SQLite and Postgres). Comparison is exact-match after `TrimSpace` — the documented
  policy since Phase 1.

#### 2. Migration & backfill ([`database`](../backend/internal/database/database.go))

`AutoMigrate` creates the table and column. Then a **backfill routine**, run at startup after
migrate, idempotent (skips rows where `relationship_id` is already set):

1. Select distinct `(user_id, TRIM(name))` from `analysis_subjects` where
   `relationship_id IS NULL` (including soft-deleted rows, so restores stay coherent).
2. Find-or-create the `Relationship`; update matching snapshots' `relationship_id` (and
   normalize their stored `Name` to the trimmed form — the one-time cleanup Phase 1 deferred).
3. Log a summary line: `backfill: N relationships, M snapshots linked`.

Idempotency makes this safe on every boot; wrap in a transaction per user to bound failure
blast radius.

#### 3. API

New endpoints (inside the protected group in
[`main.go`](../backend/cmd/server/main.go)):

| Method & path | Behavior |
| :--- | :--- |
| `GET /api/relationships` | All of the user's relationships, each with `snapshot_count` and `latest_date` (single grouped query — this is where `ORDER BY date DESC` server-side arrives). |
| `PATCH /api/relationships/:id` | Rename: trims, rejects empty, rejects a name colliding with another of the user's relationships (409). Syncs the denormalized `Name` on all its snapshots in the same transaction. |
| `POST /api/relationships/:id/merge` | Body `{"source_id": n}`. Moves all of source's snapshots to `:id`, syncs their `Name`, soft-deletes the source relationship. 400 if source == target; 404 unless both belong to the user. |
| `DELETE /api/relationships/:id` | Soft-deletes the relationship **and** its snapshots (transaction). Distinct from single-version delete. |

Existing snapshot endpoints — compatibility rules:

- `POST /api/subjects`: after validation, **find-or-create** the `Relationship` from the
  trimmed name and set `relationship_id`. Response now includes it. (This alone keeps every
  existing client working while populating the FK.)
- `PUT /api/subjects/:id`: if `name` is provided and differs, re-resolve find-or-create — an
  explicit per-version rename detaches that version to the (possibly new) relationship,
  matching current split-on-rename behavior but now *visible* in data rather than emergent.
- `GET /api/subjects`: unchanged shape plus `relationship_id`; add `ORDER BY date DESC NULLS LAST`
  (SQLite: `date IS NULL, date DESC`). Optional `?relationship_id=` filter. Pagination is
  **deliberately deferred** (self-hosted single-user scale; revisit if a real dashboard exceeds
  ~500 snapshots).

#### 4. Referential integrity

- Declare the FK in GORM tags (`RelationshipID` → `relationships.id`). Note honestly in code
  comments and docs: SQLite + `AutoMigrate` will not retrofit enforcement onto the existing
  table; Postgres gets the constraint. Handler-level checks remain the effective guarantee —
  merge/delete/rename all verify `user_id` ownership on every touched row.
- The pre-existing `user_id`-has-no-FK limitation is unchanged (no user-delete endpoint
  exists); leave documented.

### Frontend Changes

- **Grouping key:** `groupPeople` (Phase 3 util) groups by `relationship_id` (fallback to name
  only for the transitional moment where cached rows lack it; drop the fallback before
  sign-off). Stack React keys become the relationship id.
- **Fetch:** `SubjectsContext` fetches `GET /api/relationships` + `GET /api/subjects` (or
  keeps subjects-only and derives, implementer's choice — but rename/merge need relationship
  ids and names, so fetching both is simpler).
- **Rename:** a stack-level action (pencil on the stack header area, distinct from the
  version-edit pencil) → small dialog → `PATCH`. On success update context state; all versions
  reflect the new name.
- **Merge:** stack action "Merge into…" → dialog listing the user's other relationships →
  confirm with an explicit sentence ("All N snapshots of *X* will move into *Y*. This cannot
  be split apart automatically.") → `POST merge`. Replace the `window.confirm` pattern with the
  app's dialog component here; migrating the delete confirm to match is an optional cleanup.
- **Delete whole relationship:** stack overflow menu, wording clearly distinct from
  single-version delete.
- **Route swap:** `/relationships/:id/timeline` replaces `/timeline/:name`; keep the old route
  as a redirect that resolves name → id from context (best-effort; unknown → empty state).
- **New-version mode** already locks the name input; now it also carries `relationship_id`
  implicitly via the name — no form changes required this phase.

## Step-by-Step Implementation Tasks

1. [ ] Backend: `Relationship` model + `RelationshipID` column; `AutoMigrate` on both engines.
2. [ ] Backend: idempotent backfill routine + startup wiring + summary log; document the
       backup prerequisite in `docs/09-deployment.md`.
3. [ ] Backend: find-or-create in `POST /api/subjects`; re-resolve on `PUT` name change.
4. [ ] Backend: `GET /api/relationships` (counts + latest via grouped query).
5. [ ] Backend: `PATCH` rename (collision → 409; snapshot `Name` sync in transaction).
6. [ ] Backend: `POST merge` + `DELETE` relationship (transactions; ownership checks).
7. [ ] Backend: `ORDER BY` on `GET /api/subjects` + optional `relationship_id` filter.
8. [ ] Backend tests: backfill idempotency (run twice, same counts); merge moves rows +
       soft-deletes source; rename collision 409; cross-user access 404s on every new route.
9. [ ] Frontend: context fetches relationships; `groupPeople` keyed by id; stack keys.
10. [ ] Frontend: rename dialog, merge dialog, relationship delete.
11. [ ] Frontend: id-based timeline route + legacy redirect.
12. [ ] Docs: this is a load-bearing docs update — `docs/01-concepts.md` (the "stack" section
        and the "no person table" claims), `docs/03-data-model.md`, `docs/04-api-reference.md`,
        `docs/README.md` orientation block, and the architectural-limitations table in
        `docs/11-known-issues.md`.

## Verification & Testing Criteria

**Automated:**
- `go test ./...` — all tasks-8 cases; plus: create with a novel name creates a relationship;
  create with an existing (differently-whitespaced) name reuses it; subjects list is
  date-descending.
- `npm test` — `groupPeople` by id (two relationships that share a display name stay
  separate — the previously-impossible case); rename updates every card in a stack; merge
  dialog excludes the current stack.

**Manual QA (run against a copy of a pre-Phase-4 database):**
1. Boot → backfill log line; every stack renders exactly as before the migration
   (count parity: same number of stacks and cards).
2. Rename a stack with 3 versions → all versions + timeline header show the new name;
   old-name deep link redirects.
3. Merge two stacks → one stack with interleaved, date-sorted versions; timeline spans both
   histories; the source name is gone from the grid.
4. Create a snapshot for `"Alex "` (trailing space) → lands in the existing "Alex" stack.
5. Reboot → backfill is a no-op (log shows 0 linked).
6. Verify rollback path: restoring the backup restores the exact pre-migration state.

**Regression guard:** every Phase 1–3 behavior (notes/tags round-trip, guided scoring fields,
What Changed, markers, radar, wheel scrub) works unchanged on a migrated database; a snapshot
created via raw API with only `{name, stats}` still succeeds (compatibility contract).
