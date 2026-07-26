# Phase 5 — Retention, Trust & Portability

**Vision features implemented:** 3.1 Gentle Cadence · 3.2 Quick Pulse · 4.1 The Vault
(export/import) · 4.3 The Trust Page · 4.4 Discretion Mode. (4.2 dossier and 4.5 anonymized
share are scoped as a stretch appendix.)

---

## Phase Overview & Objectives

With snapshotting now low-friction (Phase 2), rewarding (Phases 2–3), and structurally sound
(Phase 4), it is finally defensible to invite users back and to ask them to trust the app as a
long-term vault:

1. **Gentle cadence** — an optional per-relationship check-in rhythm, surfaced as a calm
   in-app nudge. **No streaks, no badges, no guilt** — a missed check-in is met with "welcome
   back," never a broken chain (hard product rule, not a style preference).
2. **Quick Pulse** — a 60-second snapshot mode (pre-filled from the last full snapshot) so the
   cadence survives busy months.
3. **The Vault** — complete export (canonical JSON + per-relationship CSV) and re-import.
4. **The Trust Page** — the privacy posture made visible: where data lives, what leaves the
   machine (nothing), counts, last-export nudge.
5. **Discretion Mode** — one-keystroke shoulder-surfing protection (initials + blurred notes)
   plus an optional local app-lock.

## Prerequisites

- **Phase 4 complete** — cadence is a `Relationship` attribute; export's shape nests snapshots
  under relationships; per-relationship pulse pre-fill needs the entity.
- **Phases 1–3** — export must carry notes/tags/uncertainty/guide answers; nudges deep-link to
  the Phase 3 routes.
- **Security prerequisite:** `JWT_SECRET` fail-fast (from
  [Known Issues §Security](../docs/11-known-issues.md#security)) must be landed before the
  Trust Page ships — a "your data is private" page above forgeable-by-default tokens is a lie.

## Component & Schema Specifications

### Backend Changes

#### 1. Cadence field ([`models.go`](../backend/internal/models/models.go))

```go
type Relationship struct {
    // ... Phase 4 fields ...
    CadenceDays *int `json:"cadence_days"` // NEW — nil = no reminders (default)
}
```

- Settable via the existing `PATCH /api/relationships/:id` (pointer field, partial-merge as
  established in Phase 1). Allowed values: nil, or 7–365 (400 outside).
- **No server-side scheduler, no email, no push.** Due-ness is *computed client-side* from
  `latest_date + cadence_days`. This keeps the self-hosted deployment dependency-free and the
  product promise honest ("nothing leaves the machine"). An email digest is explicitly out of
  scope; record it in the backlog, not here.

#### 2. Snapshot kind

```go
type AnalysisSubject struct {
    // ... existing ...
    Kind string `gorm:"default:full" json:"kind"` // NEW — "full" | "pulse"
}
```

Validated to the two values; absent input defaults to `"full"` (all legacy rows are `full` via
column default — verify on both engines).

#### 3. Export / import endpoints

| Method & path | Behavior |
| :--- | :--- |
| `GET /api/export` | Streams one JSON document: `{format: "alq-export", version: 1, exported_at, user: {email, name, age, mbti_type} , relationships: [{name, cadence_days, snapshots: [{name?, date, stats, description, tags, uncertain, guide_answers, kind, created_at}]}]}`. Excludes: password hash, ids (internal), soft-deleted rows, profile picture binary (path noted as unsupported in v1). |
| `POST /api/import` | Accepts the same document. Query `?dry_run=true` returns what *would* happen without writing. Strategy: find-or-create relationships by trimmed name; **skip** any snapshot whose `(relationship, date, stats)` exactly matches an existing one (idempotent re-import); everything inside one transaction; response `{relationships_created, snapshots_created, snapshots_skipped}`. Reject unknown `format`/`version` with 400. |

Import reuses the Phase 1/2 validators wholesale — an import must not be a validation bypass.

#### 4. Meta endpoint (for the Trust Page)

`GET /api/meta` (protected): `{db_backend: "sqlite" | "postgres", relationship_count,
snapshot_count, oldest_snapshot_date}`. Trivial counts, no config secrets.

### Frontend Changes

#### 1. Cadence UI

- **Setting:** in the stack overflow menu (beside Phase 4's rename/merge): "Check-in rhythm" →
  choices: Off (default) · Monthly (30) · Quarterly (90) · Twice a year (182) · custom days.
- **Nudge surface:** a single calm banner at the top of the dashboard when ≥1 relationship is
  due: *"It's been 9 weeks since your last snapshot of Alex."* Multiple due → one banner with
  a count and a small list. Actions: "Snapshot now" (opens new-version form, or Pulse — see
  below), "Later" (snoozes that relationship for 7 days, `localStorage`), and a quiet "turn
  off" link into the cadence setting.
- Copy rules (enforced in review): no red, no urgency vocabulary, no counts of missed
  check-ins, and the banner never appears more than once per session per relationship.

#### 2. Quick Pulse

- Entry points: the nudge banner and a second action on the stack ("Quick pulse", lucide
  `Zap`, beside "Add New Version").
- Behavior: `PersonForm` gains a `mode="pulse"` variant — all values pre-filled from the
  latest snapshot; each `CategorySliderRow` collapses to a single line with a **"unchanged"**
  checkmark (default) that expands to the full row (slider + anchors) on tap; notes/tags step
  intact; saves as a normal POST with `kind: "pulse"`. Guided mode hidden in pulse (it is the
  fast path by definition).
- Rendering: timeline gives pulse snapshots smaller dots; the version badge on cards is
  unchanged (a pulse is a real version, not a lesser one); `WhatChanged` still fires — the
  payoff loop applies to pulses too.

#### 3. The Vault page (`/vault` route, token-guarded)

Sections:

1. **Your data** (from `GET /api/meta` + client state): backend kind in plain words ("a
   SQLite file on this machine" / "your PostgreSQL database"), counts, span ("3 relationships,
   47 snapshots since March 2025").
2. **Plain-language privacy answers** (static copy): Who can see this? What does the app send
   anywhere? (Nothing — verifiable: the app makes requests only to its own origin.) What
   about the optional AI features? (There are none — by design; link to the About content.)
3. **Export**: "Download everything (JSON)" → `GET /api/export` → client triggers a file
   download `alq-export-YYYY-MM-DD.json`; "Download spreadsheets (CSV)" → client-side
   generation from context state, one CSV per relationship zipped is out of scope — emit a
   single combined CSV (`relationship, date, kind, <7 category columns>, uncertain, tags, note`).
   Store `last_export_at` in `localStorage`; show it here and as a gentle line ("Last export:
   never") — this is the only nudge the vault page makes.
4. **Import**: file picker → parse → **always dry-run first** → show the summary ("Would
   create 2 relationships, 31 snapshots; skip 16 duplicates") → explicit confirm → real POST →
   refetch context.
- Navbar gains a "Vault" link (lucide `Archive`).

#### 4. Discretion Mode

- **Toggle:** an eye icon in the Navbar (and keyboard shortcut `Ctrl+.`), state in
  `localStorage`. When on: relationship names render as initials ("Alex" → "A."), notes and
  tag chips get CSS `blur-sm` (hover-to-reveal individual items), the document `<title>`
  drops the app name. All client-side, instant, reversible with one click.
- **App lock (optional layer):** in Vault settings — set a passphrase (stored as a SHA-256
  hash in `localStorage`); when set, an opaque lock screen overlays the app on load and after
  15 min idle until the passphrase is entered. **Honest copy required** beside the setting:
  *"This locks the screen on this device. It does not encrypt the database — anyone with
  access to the server files can read them."* No recovery flow: forgetting it = clear
  localStorage = re-login (state that too).

## Step-by-Step Implementation Tasks

1. [ ] Backend: `CadenceDays` (+ PATCH validation), `Kind` (+ default backfill verification on
       SQLite & Postgres).
2. [ ] Backend: `GET /api/export` (shape above; excludes soft-deleted; streams).
3. [ ] Backend: `POST /api/import` with dry-run, duplicate-skip, transaction, validator reuse.
4. [ ] Backend: `GET /api/meta`.
5. [ ] Backend tests: export→import round-trip on an empty second account reproduces counts
       exactly; re-import is a no-op (all skipped); import with a bad stats value → 400,
       nothing written; cadence bounds.
6. [ ] Frontend: cadence setting + due computation + banner (+ snooze, session-once rule).
7. [ ] Frontend: pulse mode in `PersonForm` + entry points + timeline dot treatment.
8. [ ] Frontend: `/vault` route — meta, copy, JSON/CSV export, dry-run import flow.
9. [ ] Frontend: discretion toggle (+ shortcut) and app-lock overlay with honest copy.
10. [ ] Docs: `docs/04-api-reference.md` (export/import/meta), `docs/01-concepts.md` (pulse vs
        full, cadence philosophy incl. the no-guilt rule), `docs/06-frontend.md` (Vault,
        discretion), and update the "deliberately does not do" list (reminders now exist —
        in-app only, opt-in, computed locally).

## Verification & Testing Criteria

**Automated:**
- `go test ./...` — task-5 cases; export contains no `password` field anywhere in the payload
  (assert on raw JSON); `kind` defaults to `full`.
- `npm test` — due computation (edge: undated latest snapshot → never due; snoozed → not due);
  pulse payload carries `kind: "pulse"` and pre-filled values; CSV row shape for a snapshot
  with skipped + uncertain categories; discretion toggle transforms names/hides notes.

**Manual QA:**
1. Set Monthly cadence, backdate the latest snapshot 6 weeks → banner appears once; "Later"
   silences for the session and 7 days; new snapshot clears it.
2. Pulse an unchanged relationship in under 60 seconds (count the interactions) → saved as a
   real version; What Changed reports mostly steady.
3. Export → wipe a dev database → import → stack count, version counts, notes, tags,
   uncertainty flags, and cadence settings all survive; timeline markers identical.
4. Import the same file again → "skipped" equals total, nothing duplicated.
5. Toggle discretion with a note-bearing card visible → names collapse to initials, notes
   blur, hover reveals; `Ctrl+.` toggles back.
6. Set an app lock, reload → lock screen; wrong passphrase stays locked; correct unlocks.

**Regression guard:** cadence off by default — a freshly migrated user sees zero new banners;
export of a legacy-only database (no Phase 2+ fields) succeeds with absent fields omitted;
all Phase 1–4 flows unchanged.

---

## Appendix — Stretch scope (schedule only if capacity remains)

- **4.2 Relationship Dossier:** a print stylesheet (`@media print`) for the timeline route +
  a "Print dossier" action (shape, timeline, summary line, optional notes). No PDF library —
  the browser's print-to-PDF is sufficient for v1.
- **4.5 Deliberate Share:** an "export image" action on `LoveShape` (SVG → PNG via canvas)
  with a name-pseudonymization toggle and per-category exclusion checkboxes. Client-only.
- **Full guided onboarding walkthrough (vision 1.1):** the step-per-category first-run flow;
  builds entirely on Phase 2's `CategorySliderRow`.
