# Alexithymia Love Quantifier

> **Quantify your emotional landscape using the Color Wheel Theory of Love.**

This application helps users track, analyze, and reflect on their connections with others by categorizing love into seven distinct types: **Eros, Ludus, Storge, Pragma, Mania, Agape, and Selflessness**.

## 🚀 Quick Start (Emergency Onboarding)

**Prerequisites:** Docker & Docker Compose. Alternatively, standard Node/Go environments are sufficient. Comprehensive production deployment behind Nginx reverse-proxy and local setup instructions are provided in `Setup Guide.md`.

1.  **Clone & Run:**
    ```bash
    git clone <repository-url>
    cd AlexithymiaLoveQuantifier
    cp .env.example .env        # then fill in the two secrets it asks for
    docker compose up --build
    ```
    *Note: A `Makefile` is also provided (`make setup`, `make dev`, `make build`) for easy local development without Docker.*

    `.env` holds the database password and the JWT signing key, and is git-ignored.
    Compose refuses to start without them rather than falling back to a default — the file
    itself says how to generate each one.

2.  **Access:**
    *   **Frontend:** `http://localhost:8082` (Nginx; `FRONTEND_PORT` in `.env`). *Not `:3000` — see [docs/07-development.md](docs/07-development.md).*
    *   **Backend API:** `http://localhost:8082/api` via Nginx. Also `http://localhost:8081/api` direct, but bound to `127.0.0.1` — from this machine only.
    *   **Postgres:** not published. It listens on an internal Docker network that only the backend is attached to; use `make db-shell`.

3.  **Android (optional):**
    ```bash
    make build-android          # debug APK → dist-android/, entirely in Docker
    ```
    Needs Docker only — no JDK, Android SDK, or Android Studio. See
    [docs/12-android-app.md](docs/12-android-app.md).

**That's it.** The database (Postgres) will be provisioned automatically, and the backend will migrate schemas on startup.

---

## 🛠 Technology Stack

### Frontend
-   **Framework:** React 18 + Vite
-   **Styling:** Tailwind CSS (Utility-first styling) & Lucide React (Icons)
-   **Routing:** React Router DOM (v6) (`/` -> Dashboard/Landing, `/login` -> Auth, `/profile` -> User Profile)
-   **State Management:** Local React State (`useState`, `useEffect`, `useMemo`) + Axios for API calls. Authentication state (`token`) is stored in `localStorage` and injected into Axios headers.

### Backend
-   **Language:** Go (Golang) 1.24+
-   **Framework:** Gin (Web Framework)
-   **Database ORM:** GORM
-   **Database:** PostgreSQL 15
-   **Authentication:** JWT access token in `Authorization: Bearer <token>`, renewed by a rotating server-side refresh token
-   **Security:** Bcrypt (Password hashing)

### Android
-   **Approach:** Capacitor 8 — the same React app packaged in a WebView. No second UI codebase.
-   **Networking:** `CapacitorHttp` routes requests through native OkHttp, so there is no browser
    origin and therefore no CORS requirement on the Go service.
-   **Build:** fully containerized — `make build-android` needs Docker and nothing else.
-   See [docs/12-android-app.md](docs/12-android-app.md).

### Infrastructure & Tooling
-   **Containerization:** Docker (Multi-stage builds), Docker Compose, Nginx.
-   **Dev Tooling:** `Makefile` for dependency and running shortcuts.

---

## 🗄️ Database Models (GORM Schema)

The backend uses GORM for auto-migration and schema definition. All models inherit from `gorm.Model` which injects `ID` (uint), `CreatedAt`, `UpdatedAt`, and `DeletedAt`.

1. **`User` Model:**
   - `Email` (string, unique, not null)
   - `Password` (string, hashed, not null, hidden from JSON)
2. **`AnalysisSubject` Model:**
   - `UserID` (uint) - Foreign key linking to the `User`.
   - `Name` (string, not null) - Target of the analysis (e.g., a person's name).
   - `Description` (string) - Optional notes.
   - `Date` (*time.Time) - Recorded date for the analysis version.
   - `Stats` (map[string]int) - Stored in DB as JSON. Contains keys like `eros`, `ludus`, `storge`, `pragma`, `mania`, `agape`, `selflessness` mapped to integer scores from 0-100.

---

## 🎨 Frontend Architecture & Key Behaviors

- **Routing Logic (`App.jsx`):** Protects routes `/` (Dashboard) and `/profile` checking the presence of a JWT. It synchronously initializes global Axios headers with the stored JWT before the initial render to prevent unauthenticated data-fetching race conditions.
- **`Dashboard.jsx` (Core View):**
  - Fetches and manages the list of `AnalysisSubject`s.
  - **Category Explorer (`AboutModal`):** Features an interactive, dedicated view detailing the core motivations and behavioral metrics for accurately detecting each of the 7 love category styles in the real world.
  - **CardStack Versioning logic:** Subjects with the exact same `Name` are grouped together into "Stacks". Ordered by `Date` descending. Users can scroll (wheel event) over a card stack to flip between older and newer versions of their analysis for that specific person.
  - Generates a horizontal bar chart (`LoveChart`) using simple div widths mapped proportionally to the 0-100 value integers stored in the subject's `Stats` map.
- **Handling forms:** `PersonForm` handles creates and updates. A subject can be edited, or a *new version* of an existing subject can be created (which instantiates a completely new `AnalysisSubject` record with the same Name but a newer Date).

---

## 🔌 API Documentation

All endpoints are prefixed with `/api`.
API requests accept and return JSON.

| Method | Endpoint         | Auth? | Payload | Description                     |
| :----- | :--------------- | :---- | :------ | :------------------------------ |
| POST   | `/signup`        | No    | `{ "email": "x@y.com", "password": "..." }` | Creates user. Returns `201`. |
| POST   | `/login`         | No    | `{ "email": "x@y.com", "password": "..." }` | Returns `200` & `{ "token": "jwt...", "refresh_token": "...", "expires_in": 86400 }` |
| POST   | `/refresh`       | No    | `{ "refresh_token": "..." }` | New session; rotates the token it consumed. Returns `200` + same shape as login. |
| POST   | `/logout`        | No    | `{ "refresh_token": "..." }` | Revokes the refresh token. Always `204`. |
| GET    | `/me`            | Yes   | None | Returns the `User` object. |
| GET    | `/subjects`      | Yes   | None | Returns array of `AnalysisSubject`s. |
| POST   | `/subjects`      | Yes   | `{ "name": "...", "description": "", "date": "YYYY-MM-DD", "stats": { "eros": 50, "ludus": 20 } }` | Creates subject. Returns `201` + Subject. |
| PUT    | `/subjects/:id`  | Yes   | Same as POST `/subjects` | Updates subject. Returns `200` + Subject. |
| DELETE | `/subjects/:id`  | Yes   | None | Deletes subject. Returns `200`. |

---

## 📂 Project Structure

```
AlexithymiaLoveQuantifier/
├── backend/                # Go Backend
│   ├── cmd/server/         # Entry point (main.go)
│   ├── internal/
│   │   ├── handlers/       # Controllers: auth.go, subjects.go
│   │   ├── models/         # Database Schemas: models.go
│   │   ├── database/       # DB Connection & Auto-migration
│   │   └── auth/           # JWT & bcrypt logic
│   ├── Dockerfile          # Backend container spec
│   └── go.mod              # Key dependencies
├── src/                    # React Frontend
│   ├── components/         # Auth, Dashboard, Landing, Navbar, Profile
│   ├── mobile/             # Android platform layer (no-ops on web)
│   ├── App.jsx             # Main Router & strict JWT guard setup
│   ├── main.jsx            # Entry point
│   └── index.css           # Tailwind imports
├── android-config/         # Committed native files, overlaid onto the generated project
├── android/                # GENERATED by `cap add`, gitignored — never hand-edit
├── capacitor.config.json   # appId, androidScheme, CapacitorHttp
├── docker-compose.yml      # Service orchestration
├── nginx.conf              # Reverse proxy config & SPA 404 fallback
├── Makefile                # Dev scripting shortcuts
├── Setup Guide.md          # Detailed local build instructions
├── Dockerfile.android      # Containerized APK/AAB build (no local Android SDK)
└── Dockerfile              # Frontend container spec
```

---

## 🔧 Environment & Configuration

Environment variables are currently managed via `docker-compose.yml` for simplicity.

**Backend Variables:**
-   `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`: Postgres connection details.
-   `JWT_SECRET`: Secret key for signing tokens. **Change this in production!**

**Frontend:**
-   Nginx is configured to proxy all requests from `/api/*` to the backend service. No manual CORS configuration is needed in production mode. Local Dev Vite proxy likely handles this otherwise.

---

## 🐛 Common Issues & Troubleshooting

1.  **"Connection Refused" to Database:**
    -   Ensure the `db` service in Docker is healthy.
    -   The backend waits for Postgres, but if it times out, restart the `backend` container: `docker-compose restart backend`.
2.  **Changes not reflecting:**
    -   If you changed package.json or go.mod, you **must** rebuild: `docker-compose up --build`.
3.  **Frontend Routing 404s:**
    -   Nginx is configured to fallback to `index.html` for logical routing (SPA support). If you see 404s on refresh, check `nginx.conf`.

---

## 📝 TODOs / Technical Debt

-   [x] **Security:** Move `JWT_SECRET` and DB creds to a `.env` file (not committed to git). *Done — see [docs/09-deployment.md §6](docs/09-deployment.md#6-configuration-and-secrets).*
-   [ ] **Security:** Terminate TLS in front of Nginx. Everything is cleartext HTTP today, which is the remaining blocker for exposure to the internet.
-   [ ] **Tests:** Add unit tests for backend handlers and frontend components.
-   [ ] **Validation:** Improve input validation on the backend (e.g., email format).
-   [ ] **Profile:** Allow users to update their password/email.

---

*Generated by "Antigravity"*
