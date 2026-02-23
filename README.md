# Alexithymia Love Quantifier

> **Quantify your emotional landscape using the Color Wheel Theory of Love.**

This application helps users track, analyze, and reflect on their connections with others by categorizing love into seven distinct types: **Eros, Ludus, Storge, Pragma, Mania, Agape, and Selflessness**.

## 🚀 Quick Start (Emergency Onboarding)

**Prerequisites:** Docker & Docker Compose. Alternatively, standard Node/Go environments are sufficient. A detailed local un-containerized setup process is provided in `Setup Guide.md`.

1.  **Clone & Run:**
    ```bash
    git clone <repository-url>
    cd AlexithymiaLoveQuantifier
    docker-compose up --build
    ```
    *Note: A `Makefile` is also provided (`make setup`, `make dev`, `make build`) for easy local development without Docker.*

2.  **Access:**
    *   **Frontend:** `http://localhost:3000`
    *   **Backend API:** `http://localhost:8080/api`

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
-   **Authentication:** JWT (Stateless) stored in `Authorization: Bearer <token>`
-   **Security:** Bcrypt (Password hashing)

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
| POST   | `/login`         | No    | `{ "email": "x@y.com", "password": "..." }` | Returns `200` & `{ "token": "jwt..." }` |
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
│   ├── App.jsx             # Main Router & strict JWT guard setup
│   ├── main.jsx            # Entry point
│   └── index.css           # Tailwind imports
├── docker-compose.yml      # Service orchestration
├── nginx.conf              # Reverse proxy config & SPA 404 fallback
├── Makefile                # Dev scripting shortcuts
├── Setup Guide.md          # Detailed local build instructions
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

-   [ ] **Security:** Move `JWT_SECRET` and DB creds to a `.env` file (not committed to git).
-   [ ] **Tests:** Add unit tests for backend handlers and frontend components.
-   [ ] **Validation:** Improve input validation on the backend (e.g., email format).
-   [ ] **Profile:** Allow users to update their password/email.

---

*Generated by "Antigravity"*
