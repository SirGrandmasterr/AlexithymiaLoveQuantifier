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
| 01 | [Concepts & Domain Model](01-concepts.md) | What is being measured, why, and what every domain word means (subject, version, stack, stat). |
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

---

## Thirty-second orientation

```
Browser ──► Vite dev server (:5173)  ──proxy /api, /uploads──►  Go + Gin (:8080)  ──►  SQLite or Postgres
   or   ──► Nginx in container (:80) ──proxy /api────────────►  Go + Gin (:8080)
```

- **Frontend**: React 19 + Vite 7 + Tailwind CSS 3, SPA, JWT held in `localStorage`.
- **Backend**: Go 1.24 + Gin + GORM, stateless JWT auth, bcrypt password hashing.
- **Database**: PostgreSQL 15 when `DB_HOST` is set; otherwise an automatic fallback to a
  local SQLite file. Schema is auto-migrated on every boot.
- **Core record**: an `AnalysisSubject` — one dated snapshot of one person, carrying a
  `stats` map of seven 0–100 integers.

The single most important structural idea in the whole codebase:

> **There is no "person" table.** A person is an emergent grouping of
> `AnalysisSubject` rows that share an identical `name`, assembled client-side.
> See [Concepts](01-concepts.md#the-stack-abstraction) and
> [Data Model](03-data-model.md#6-there-is-no-person-entity).

---

## Source-of-truth map

When these two disagree, the code wins; please correct the docs in the same change.

| Concept | Canonical definition lives in |
| :------ | :---------------------------- |
| The seven love categories (ids, labels, colours, descriptions, detection metrics, slider anchors) | `CATEGORIES` in [`src/components/Dashboard.jsx`](../src/components/Dashboard.jsx) |
| The seven category **ids**, as the server-side validation allowlist | `CategoryIDs` in [`backend/internal/domain/categories.go`](../backend/internal/domain/categories.go) — ids only; must stay in step with `CATEGORIES` |
| The prose source the category text was derived from | [`TestImplementationDetails.txt`](../TestImplementationDetails.txt) |
| Chart line colours (hex duplicates of the Tailwind classes) | `CATEGORY_COLORS` in [`src/components/AnalysisTimeline.jsx`](../src/components/AnalysisTimeline.jsx#L15-L23) |
| Guided-scoring scale and suggestion-band arithmetic | `GUIDE_SCALE` / `guideBand` in [`src/components/Dashboard.jsx`](../src/components/Dashboard.jsx) |
| Preset context tags and their limits | [`src/components/ContextCapsule.jsx`](../src/components/ContextCapsule.jsx) |
| Delta arithmetic for "What Changed" | [`src/components/WhatChanged.jsx`](../src/components/WhatChanged.jsx) |
| Database schema | [`backend/internal/models/models.go`](../backend/internal/models/models.go) |
| Route table | [`backend/cmd/server/main.go`](../backend/cmd/server/main.go#L17-L35) |
| Auth rules (hash cost, token lifetime, claims) | [`backend/internal/auth/auth.go`](../backend/internal/auth/auth.go) |
