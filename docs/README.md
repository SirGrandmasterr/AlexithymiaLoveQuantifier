# Alexithymia Love Quantifier — Documentation

This folder is the reference documentation for the Alexithymia Love Quantifier: a
self-hosted web application for recording, versioning, and visualising how one
experiences love toward specific people, scored across the seven categories of the
**Color Wheel Theory of Love**.

The documentation is written for two audiences at once:

- **Humans** who need to understand *what the product means* and *how to run it*.
- **Coding agents** who need to understand *how every concept is physically realised
  in code*, so a change can be made without first re-deriving the architecture.

Every document therefore names concrete files, symbols, and line ranges rather than
describing things abstractly.

---

## Reading order

| # | Document | What it answers |
| :- | :------- | :-------------- |
| 01 | [Concepts & Domain Model](01-concepts.md) | What is being measured, why, and what every domain word means (relationship, subject, version, stack, stat). |
| 02 | [System Architecture](02-architecture.md) | The three processes, how a request flows end-to-end, and where state lives. |
| 03 | [Data Model & Persistence](03-data-model.md) | GORM schemas, the JSON-serialised `Stats` map, soft deletes, migrations, the `ID`-vs-`id` casing trap. |
| 04 | [API Reference](04-api-reference.md) | Every endpoint, exact payloads, status codes, and the auth contract. |
| 05 | [Backend Implementation](05-backend.md) | Package-by-package walkthrough of the Go service. |
| 06 | [Frontend Implementation](06-frontend.md) | Component-by-component walkthrough of the React app, including the card-stack and timeline mechanics. |
| 07 | [Development Workflow](07-development.md) | Local setup, ports, proxying, environment variables, Makefile targets. |
| 08 | [Testing](08-testing.md) | The three test layers, what each covers, how to run them, and their current real status. |
| 09 | [Deployment & Containers](09-deployment.md) | Dockerfiles, Compose topology, Nginx, CI. |
| 10 | [Agent Guide](10-agent-guide.md) | Conventions, invariants, and step-by-step recipes for the most common change requests. |
| 11 | [Known Issues & Documentation Drift](11-known-issues.md) | Verified defects, gaps, and places where the root `README.md` disagrees with the code. |
| 12 | [The Android App](12-android-app.md) | Why Capacitor rather than a rewrite, how the packaged client reaches a self-hosted backend, the mobile UI changes, and the containerised APK build. |
| 13 | [Zero-Knowledge Encryption](13-zero-knowledge-encryption.md) | **Design only, and an unconfirmed option rather than a plan.** What would be encrypted, how, and what it would cost. Nothing in the product implements or promises it; read §0 before assuming otherwise. |

---

## Thirty-second orientation

```
Browser ──► Vite dev server (:5173)  ──proxy /api, /uploads──►  Go + Gin (:8080)  ──►  SQLite or Postgres
   or   ──► Nginx in container (:80) ──proxy /api────────────►  Go + Gin (:8080)
Android ──► Capacitor WebView (bundled SPA) ──native HTTP───►  Go + Gin (:8080)
```

- **Frontend**: React 19 + Vite 7 + Tailwind CSS 3, SPA. Access and refresh tokens in
  `localStorage`; an expired access token is renewed silently rather than surfaced.
- **Backend**: Go 1.24 + Gin + GORM, stateless JWT access tokens with rotating server-side
  refresh tokens, bcrypt password hashing.
  **`JWT_SECRET` is required** — the server refuses to start without it.
- **Database**: PostgreSQL 15 when `DB_HOST` is set; otherwise an automatic fallback to a
  local SQLite file. Schema is auto-migrated on every boot.
- **Core records**: a `Relationship` — the person — and an `AnalysisSubject` — one dated
  snapshot of that person, carrying a `stats` map of seven 0–100 integers.

The structural idea to hold on to:

> **A "stack" is a `Relationship` and its snapshots.** The relationship is the durable
> identity: it can be renamed and merged, and the timeline route addresses it by id. The
> `name` on each snapshot is a denormalized label kept in sync, not the key.
>
> Every write resolves the relationship from the name (**find-or-create**), so a client that
> knows nothing about relationships still works. See
> [Concepts](01-concepts.md#the-stack-abstraction) and
> [Data Model](03-data-model.md#6-the-relationship-entity).
>
> *Historical note, because it explains the shape of the code:* before Phase 4 there was no
> person table at all — a person was an emergent grouping of rows sharing an identical name,
> assembled client-side. That is why snapshots are called "subjects" and why the name is
> still on every row.

---

## Source-of-truth map

When these two disagree, the code wins; please correct the docs in the same change.

| Concept | Canonical definition lives in |
| :------ | :---------------------------- |
| Check-in rhythm arithmetic and the no-guilt copy rules | [`src/constants/cadence.js`](../src/constants/cadence.js) |
| The export/import document format | [`backend/internal/handlers/vault.go`](../backend/internal/handlers/vault.go) — `format: "alq-export"`, `version: 2` (version 1 still importable) |
| How a name resolves to a relationship (find-or-create), and the startup backfill | [`backend/internal/database/backfill.go`](../backend/internal/database/backfill.go) — the write path and the migration deliberately share one function |
| The seven love categories (ids, labels, colours, descriptions, detection metrics, slider anchors) | `CATEGORIES` in [`src/constants/categories.js`](../src/constants/categories.js) |
| The seven category **ids**, as the server-side validation allowlist | `CategoryIDs` in [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go) — ids only; must stay in step with `CATEGORIES` |
| The prose source the category text was derived from | [`TestImplementationDetails.txt`](../TestImplementationDetails.txt) |
| Chart colours | the `hex` field on each `CATEGORIES` entry — one palette, not two |
| Guided-scoring scale, suggestion band, card summary arithmetic | `GUIDE_SCALE` / `guideBand` / `summarizeStack` in [`src/constants/categories.js`](../src/constants/categories.js) |
| Preset context tags and their limits | [`src/constants/contextTags.js`](../src/constants/contextTags.js) — shared by the snapshot form and the journal, and re-exported from `ContextCapsule.jsx` for its existing importers |
| The journal's vocabularies, readers, candidate matching, day arithmetic and **every string it can say** | [`src/constants/journal.js`](../src/constants/journal.js) — `FEELINGS`, `RITUAL_QUESTIONS`, `JOURNAL_COPY`, `readCheckin`/`readRitual`/`readTrigger`. Pure: nothing here renders or fetches |
| The journal's **ids**, as the server-side validation allowlist | `FeelingIDs`, `RitualQuestionIDs`, `JournalKinds` in [`backend/internal/domain/journal.go`](../backend/internal/domain/journal.go) — ids only, mirrored by the constants above and asserted in both directions by a test |
| The journal's row shape, payload validation and the find-or-create path for triggers | [`backend/internal/handlers/journal.go`](../backend/internal/handlers/journal.go) |
| Journal entries and state for every screen that reads them | [`src/context/JournalContext.jsx`](../src/context/JournalContext.jsx) — a second context beside `SubjectsContext`, never a second copy of the people |
| The journal's per-device settings (ritual, its hour, the optional questions, ask-who) | [`src/constants/journalSettings.js`](../src/constants/journalSettings.js) — `localStorage` only; none of it is ever sent anywhere |
| Delta arithmetic for "What Changed" | [`src/components/WhatChanged.jsx`](../src/components/WhatChanged.jsx) |
| The shared subject list, grouping, and mutations | [`src/context/SubjectsContext.jsx`](../src/context/SubjectsContext.jsx) |
| Route table (frontend) | [`src/App.jsx`](../src/App.jsx) |
| Session storage, renewal, and the 401-renew-retry rule | [`src/auth/session.js`](../src/auth/session.js) — and its one hard rule: never two refreshes at once |
| The vault dial's gesture, detents, and the touch-axis contract | [`src/components/VaultKnob.jsx`](../src/components/VaultKnob.jsx) + [`src/mobile/knobFeedback.js`](../src/mobile/knobFeedback.js) |
| The API base URL on Android, and the rule that it must resolve synchronously | [`src/mobile/serverUrl.js`](../src/mobile/serverUrl.js) — mirrors `applyToken` in `App.jsx` for the same ordering reason |
| Android toolchain versions (JDK, AGP, Gradle, SDK) | [`Dockerfile.android`](../Dockerfile.android) — derived from what `@capacitor/android` declares, not chosen |
| Native manifest and network policy | [`android-config/`](../android-config/) — `android/` is generated and gitignored |
| Database schema | [`backend/internal/models/models.go`](../backend/internal/models/models.go) |
| Route table | [`backend/cmd/server/main.go`](../backend/cmd/server/main.go#L17-L35) |
| Auth rules (hash cost, token lifetime, claims) | [`backend/internal/auth/auth.go`](../backend/internal/auth/auth.go) |
| Session issuing, rotation, and reuse detection | [`backend/internal/handlers/session.go`](../backend/internal/handlers/session.go) |
