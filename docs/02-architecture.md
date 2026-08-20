# 02 — System Architecture

---

## 1. Shape of the system

Three processes, no message queues, no caches, no background workers.

```mermaid
graph TB
    subgraph client["Browser"]
        SPA["React 19 SPA<br/>router + local state<br/>JWT in localStorage"]
    end

    subgraph edge["Static edge (production only)"]
        NGINX["Nginx :80<br/>serves /dist<br/>SPA fallback to index.html<br/>proxies /api/ -> backend:8080"]
    end

    subgraph api["Go service :8080"]
        GIN["Gin engine"]
        MW["AuthMiddleware<br/>validates Bearer JWT<br/>sets ctx userID"]
        H["handlers: auth, subjects, upload"]
        STATIC["r.Static /uploads"]
    end

    subgraph store["Persistence"]
        PG[("PostgreSQL 15")]
        SQLITE[("SQLite file<br/>alexithymia.db")]
        DISK["./uploads/*.jpg|png|webp"]
    end

    SPA -->|"dev: Vite proxy :5173"| GIN
    SPA -->|"prod: same-origin"| NGINX
    NGINX --> GIN
    GIN --> MW --> H
    GIN --> STATIC --> DISK
    H -->|"GORM, DB_HOST set"| PG
    H -->|"GORM, DB_HOST empty"| SQLITE
    H --> DISK
```

**Deliberate simplicity.** State lives in exactly two places: one relational table set
and one uploads directory. The API is stateless — the only session artefact is a signed
JWT held by the client — so the Go process can be restarted or replaced at any moment
without invalidating logins.

---

## 2. Layering

### Backend — a flat three-layer service

```
cmd/server/main.go          Composition root: connect DB, register routes, listen.
        │
internal/handlers/          HTTP layer. Binds JSON, reads ctx "userID", calls GORM
        │                   directly, writes JSON. No service layer by design.
        │
internal/database/          Package-global *gorm.DB + driver selection + AutoMigrate.
internal/models/            GORM structs; the schema.
internal/auth/              bcrypt + JWT primitives. HTTP-agnostic.
```

There is intentionally **no repository or service layer**: handlers talk to
`database.DB` directly. The trade-off is that persistence cannot be swapped without
touching handlers, which is why the handler tests use `sqlmock` at the SQL level rather
than a mocked interface (see [Testing](08-testing.md)).

`database.DB` is a package-level variable, which is exactly what makes the tests able to
substitute a mock by assignment: `database.DB = gormDB`.

### Frontend — router shell plus self-contained screens

```
main.jsx            React root, StrictMode, imports Tailwind entry CSS.
        │
App.jsx             BrowserRouter, token state, axios auth header wiring, route guards.
        │
components/         One file per screen. Each screen owns its own fetching and state.
   Navbar / Landing / Auth / Dashboard / AnalysisTimeline / Profile
```

There is **no global store** — no Redux, Zustand, or Context. `token` in `App.jsx` is the
only cross-screen state, and it is propagated by props (`isAuthenticated`, `onLogin`,
`onLogout`). Everything else is local to the screen that displays it. Dashboard's
sub-components (`Card`, `LoveChart`, `CardStack`, `AboutModal`, `PersonForm`) are
declared inside `Dashboard.jsx` rather than extracted; `AnalysisTimeline` is the one
sibling extracted into its own file, because Recharts is a heavy import worth isolating.

---

## 3. Request lifecycle, end to end

### 3.1 Authenticated read — loading the dashboard

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as App.jsx
    participant D as Dashboard.jsx
    participant X as axios (global defaults)
    participant M as AuthMiddleware
    participant H as GetSubjects
    participant DB as GORM

    B->>A: load bundle
    Note over A: module scope — before first render<br/>localStorage.getItem('token')<br/>axios.defaults.headers.common.Authorization = Bearer …
    A->>D: token truthy -> render Dashboard
    D->>X: useEffect -> GET /api/subjects + GET /api/relationships (Promise.all)
    X->>M: Authorization: Bearer <jwt>
    M->>M: split header, ValidateToken (HS256)
    M->>H: c.Set("userID", claims.UserID)
    H->>DB: WHERE user_id = ? ORDER BY date IS NULL, date DESC, id DESC
    DB-->>H: []AnalysisSubject
    H-->>D: 200 [{ID, relationship_id, name, date, stats, …}]
    D->>D: buildStacks(people, relationships) -> CardStack per relationship
```

The header assignment at
[`App.jsx:11-15`](../src/App.jsx#L11-L15) happens at **module evaluation time**, not in
an effect. That ordering is load-bearing: `Dashboard`'s `useEffect` fires on its first
mount, and if the header were set in `App`'s own effect the very first `GET /api/subjects`
would race it and return 401. The comment in the file says as much; do not "clean it up"
into an effect.

### 3.2 Write path — creating a subject

1. `PersonForm.handleSubmit` guards on a non-empty trimmed name and calls
   `onSave({ name: name.trim(), date, stats, description, tags, uncertain, guide_answers })`
   — the whole snapshot, context capsule and scoring confidence included. Skipped categories
   are omitted from `stats` entirely.
2. `handleSavePerson` branches on `editingPerson && !isNewVersionMode`:
   `PUT /api/subjects/:ID` for a true edit, otherwise `POST /api/subjects`.
3. `CreateSubject` binds `CreateSubjectInput`, reads `userID` from context, trims `name`,
   validates `stats` keys/ranges and the tag limits, parses `date` strictly with layout
   `2006-01-02`, then — in one transaction — **finds or creates the relationship** for that
   trimmed name and inserts the row pointing at it. Any validation failure is a `400` naming
   the offending field.
4. The response body — the full created row, including its server-assigned `ID` — is
   merged into local state (`setPeople([...people, response.data])`). **No refetch.**
   Optimistic-free but also round-trip-free: the client trusts the echoed row.
5. On failure nothing is spliced: the modal stays open with the user's input and a
   `role="alert"` banner appears above the grid carrying the server's message.
6. On success, if the new row lands in a stack that already had members, `WhatChanged`
   opens over the grid with the deltas against the previous snapshot. Its "add a note"
   action is a second, **partial** `PUT` carrying only `description` and `tags`.

This "echo the row, splice it into state" pattern is used uniformly by create, update,
and delete. If you add a field that the server derives, it will appear correctly without
extra work; if you add a field the server *ignores*, the UI will silently show stale data
until reload.

`PUT` follows the same path but through `UpdateSubjectInput`, whose fields are pointers —
fields absent from the body are left as stored rather than overwritten with zero values.

### 3.3 Upload path

`Profile.jsx` posts `multipart/form-data` with field name `image` to `/api/upload`. The
handler validates the *client-declared* `Content-Type`, writes
`./uploads/profile_<UnixNano><ext>`, and returns `{ url: "/uploads/<file>" }`. The
component stores that string into `formData.profile_picture` **but does not persist it** —
the user must still press *Save Changes*, which is why the success banner says
"Remember to save changes". `PUT /api/me` is what actually attaches the URL to the user.

Serving is a separate concern: `r.Static("/uploads", "./uploads")` is registered
**outside** the protected group, so avatars are public to anyone who knows the filename.

---

## 4. Authentication architecture

```mermaid
graph LR
    P["password"] -->|"bcrypt cost 14"| HASH["users.password"]
    LOGIN["POST /api/login"] -->|"CompareHashAndPassword"| OK{"match?"}
    OK -->|no| U401["401 Invalid credentials"]
    OK -->|yes| JWT["HS256 token<br/>claim user_id<br/>exp = now + 24h"]
    JWT --> LS["localStorage['token']"]
    LS --> HDR["axios Authorization header"]
    HDR --> MWV["AuthMiddleware.ValidateToken"]
    MWV --> CTX["gin ctx userID (uint)"]
    CTX --> SCOPE["every query: WHERE user_id = ?"]
```

Properties of this design:

- **Stateless.** No session table, no refresh token, no server-side revocation. Logout is
  purely client-side: `handleLogout` sets `token` to `null`, and the effect in `App.jsx`
  deletes the axios header and the `localStorage` entry. An already-issued token stays
  valid until its 24-hour expiry.
- **Expiry is discovered, not predicted.** The client never inspects `exp`; a global axios
  response interceptor in `App.jsx` clears the token on any `401`, which flips `/` back to
  Landing. Every screen calls through the global `axios`, so the interceptor sees them all.
- **A signature is not an account.** `AuthMiddleware` also confirms the user row still
  exists, because a token outlives the account it names — a dropped volume or a `down -v`
  leaves a browser holding a token that verifies perfectly against a user id that is gone.
  That case is a `401`, so the client ends the session rather than showing an error it
  cannot act on.
- **Ownership is enforced per query, not per resource.** There is no ACL layer; instead
  every subject query carries `AND user_id = ?`, so a mismatched id yields *not found*
  rather than *forbidden*. This is consistent across `GetSubjects`, `UpdateSubject`, and
  `DeleteSubject` — preserve that pattern in any new subject endpoint.
- **The signing key is captured once, at package init:**
  `var jwtKey = []byte(os.Getenv("JWT_SECRET"))`
  ([`auth.go`](../backend/internal/auth/auth.go)). It is read before `main()` runs, so it
  cannot be reconfigured later. **An unset variable is now fatal:** `main()` calls
  `auth.LoadSecret()` first and exits with an explanatory message. Before Phase 5 the key
  silently became the empty byte slice — tokens still signed and verified, so the
  application worked normally while every token was forgeable by anyone. That is the failure
  mode the fail-fast exists to remove, and the reason the Vault page can claim what it does.

---

## 5. Where state lives

| State | Location | Lifetime | Notes |
| :---- | :------- | :------- | :---- |
| Users, subjects | Postgres or SQLite, via GORM | Durable | Soft-deleted, never hard-deleted by the app. |
| Avatars | `./uploads` on the backend's working directory | Durable on host, **ephemeral in Docker** (no volume). | Served publicly. |
| JWT | `localStorage['token']` | 24 h or until logout | Also mirrored into `axios.defaults`. |
| Subject list | `useState` in `Dashboard` | Per mount | Fetched once on mount; mutated locally afterwards. |
| Active card index per stack | `useState` in each `CardStack` | Per mount | Reset to 0 whenever `versions.length` changes. |
| Which stack dialog is open | `stackDialog` in `Dashboard` | Until closed | Stores the relationship **id**, not the stack, so it re-reads live state. |
| Hidden chart lines | `useState(new Set())` in `AnalysisTimeline` | Per mount | Lost when navigating back to the grid. |
| Radar comparison mode | `useState('first')` in `AnalysisTimeline` | Per mount | `first \| previous \| none`. |

### The subject list is shared, and the timeline is a route

`people` lives in `SubjectsProvider`
([`src/context/SubjectsContext.jsx`](../src/context/SubjectsContext.jsx)), mounted around
the whole route table. `Dashboard` and `TimelineRoute` both consume it, so a mutation made
on one screen is visible on the other with no refetch and no staleness.

`AnalysisTimeline` is reached by URL — `/relationships/:id/timeline` — so it is linkable,
bookmarkable, and correct under the back button. It renders from the shared
`SubjectsContext`, so an edit made on the dashboard is never stale here.

> The route is keyed by the relationship **id**, so a bookmark survives a rename. The
> pre-Phase-4 `/timeline/:name` form still resolves: `LegacyTimelineRedirect` looks the name
> up in the loaded list and redirects. That path is best-effort by construction — a stack
> renamed since the link was made cannot be found by name, which is the fragility the id
> route ends.

---

## 6. Network topology per environment

| | Frontend origin | How `/api` reaches Go | How `/uploads` reaches Go |
| :- | :-------------- | :-------------------- | :------------------------ |
| **Local dev** (`npm run dev` + `go run`) | `http://localhost:5173` | Vite dev-server proxy → `http://localhost:8080` ([`vite.config.js:13-18`](../vite.config.js#L13-L18)) | Vite proxy, explicitly configured |
| **Docker Compose** | `http://localhost:8082` (host → Nginx :80) | Nginx `location /api/` → `backend:8080` ([`nginx.conf`](../nginx.conf)) | Nginx `location /uploads/` → `backend:8080`, under a `sandbox` CSP |
| **Direct backend** | — | `http://127.0.0.1:8081` (loopback-bound; this machine only) | same |

Under Compose the proxy is now the only route in: `8081` is bound to loopback and Postgres
is not published at all, so the body-size cap, the login rate limit and the security
headers in `nginx.conf` are the limits everything on the network actually hits. The
upstream is resolved per request through Docker's DNS rather than once at startup, so
recreating the backend container no longer strands Nginx on a dead IP.

Because both environments make the SPA and the API **same-origin**, the Go service ships
**no CORS middleware at all**. Any future deployment that serves the SPA from a different
origin than the API must add CORS handling; nothing in the current code will hint at
this until requests start failing in the browser.

---

## 7. Extension seams

Where to hook in, if the system needs to grow:

| Want to… | Touch |
| :------- | :---- |
| Add a persisted field to a subject | `models.go` → `CreateSubjectInput` → both handlers → `PersonForm` → card render. [Recipe](10-agent-guide.md#recipe-2-add-a-field-to-analysissubject) |
| Add an eighth category | `CATEGORIES` + `CATEGORY_COLORS`. Nothing server-side. [Recipe](10-agent-guide.md#recipe-1-add-or-change-a-love-category) |
| Introduce a service layer | Insert between `handlers/` and `database.DB`; the handler tests would move from `sqlmock` to interface mocks. |
| Attach anything to a relationship as a whole | The `Relationship` model, plus `summaryQuery`'s select list in [`relationships.go`](../backend/internal/handlers/relationships.go). This is the seam Phase 5's per-relationship cadence and coherent export hang off; it is what the entity exists for. |
| Drop the denormalized `AnalysisSubject.Name` | Remove the field, delete the sync in rename and merge, and have every reader take the name from the relationship. Deliberately deferred past Phase 4 so rollback stays trivial. |
| Add server-side validation of stats | Already done — `validateStats` and friends in [`subjects.go`](../backend/internal/handlers/subjects.go) check every key against `domain.CategoryIDs` and every value against `0..100`. |
