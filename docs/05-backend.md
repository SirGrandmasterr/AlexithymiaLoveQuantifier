# 05 — Backend Implementation

Go 1.24.1 · Gin 1.11 · GORM 1.31 · `golang-jwt/v5` · `golang.org/x/crypto/bcrypt`
Module: `alexithymia-backend` ([`backend/go.mod`](../backend/go.mod))

---

## 1. Package layout

```
backend/
├── cmd/server/main.go              composition root, ~39 lines
├── internal/
│   ├── auth/auth.go                bcrypt + JWT primitives (HTTP-agnostic)
│   ├── database/
│   │   ├── database.go             driver selection, global DB, AutoMigrate
│   │   └── database_test.go        SQLite integration + additive-migration tests
│   ├── domain/categories.go        the seven stats-key ids (validation allowlist)
│   ├── handlers/
│   │   ├── middleware.go           AuthMiddleware
│   │   ├── auth.go                 Signup, Login, GetUserProfile, UpdateUserProfile
│   │   ├── subjects.go             CRUD for AnalysisSubject
│   │   ├── upload.go               UploadProfilePicture
│   │   ├── subjects_test.go        sqlmock table-driven handler tests
│   │   └── upload_test.go          multipart handler tests
│   └── models/models.go            GORM schema
├── Dockerfile                      multi-stage, CGO_ENABLED=0
└── alexithymia.db                  dev SQLite artefact (committed — see Known Issues)
```

Everything is under `internal/`, so nothing is importable from outside the module. There
is no `pkg/`, no `api/`, and no generated code.

**Import convention:** absolute module paths only —
`alexithymia-backend/internal/database`. No relative imports, no aliasing.

---

## 2. `cmd/server/main.go` — composition root

The whole wiring, in order:

```go
database.Connect()                       // 1. connect + migrate, or log.Fatalf

r := gin.Default()                       // 2. Logger + Recovery middleware

r.POST("/api/signup", handlers.Signup)   // 3. public
r.POST("/api/login",  handlers.Login)

r.Static("/uploads", "./uploads")        // 4. public static files

protected := r.Group("/api")             // 5. everything else
protected.Use(handlers.AuthMiddleware())
{
    protected.GET("/me", …); protected.PUT("/me", …); protected.POST("/upload", …)
    protected.GET("/subjects", …); protected.POST("/subjects", …)
    protected.PUT("/subjects/:id", …); protected.DELETE("/subjects/:id", …)
}

r.Run(":8080")                           // 6. hardcoded port
```

Points that matter when editing:

- **The port is hardcoded.** `:8080` is a literal; there is no `PORT` env var.
- **`r.Static` is outside the group,** so `/uploads/*` is unauthenticated.
- **Adding a protected route = adding one line inside the braces.** Registering it
  outside makes it public with no warning.
- `gin.Default()` includes the request logger, so every request is written to stdout —
  useful in `docker-compose logs backend`.
- `r.Run` errors are unchecked; a bind failure exits quietly.

---

## 3. `internal/auth` — credentials and tokens

[`auth.go`](../backend/internal/auth/auth.go), 57 lines, four functions, no HTTP.

```go
var jwtKey = []byte(os.Getenv("JWT_SECRET"))

type Claims struct {
	UserID uint `json:"user_id"`
	jwt.RegisteredClaims
}
```

| Function | Behaviour |
| :------- | :-------- |
| `HashPassword(string) (string, error)` | `bcrypt.GenerateFromPassword(…, 14)`. **Cost 14** — deliberately high; ~1s per hash on typical hardware, which shapes signup/login latency and slows test suites that hash for real. |
| `CheckPasswordHash(password, hash) bool` | `CompareHashAndPassword` — errors collapse to `false`, so a malformed stored hash is indistinguishable from a wrong password. |
| `GenerateToken(userID uint) (string, error)` | HS256, `exp = now + 24h`. No `iat`, `nbf`, `sub`, `iss`, or `jti`. |
| `ValidateToken(string) (*Claims, error)` | `jwt.ParseWithClaims` + explicit `token.Valid` check. |

Two properties to be aware of before touching this file:

1. **`jwtKey` is captured at package initialisation**, before `main()` runs. It cannot be
   changed at runtime, and tests cannot inject a key by setting the env var inside a test
   function. If the variable is unset the key is `[]byte{}` — HS256 signs and verifies
   happily with an empty key, so the app *works* while issuing forgeable tokens
   ([Known Issues](11-known-issues.md#jwt_secret-defaults-to-an-empty-key)).
2. **The keyfunc does not restrict the signing algorithm.** It returns `jwtKey`
   unconditionally, with no `jwt.WithValidMethods([]string{"HS256"})` parse option.
   `golang-jwt/v5` rejects `alg: none` on its own, but pinning the method is the standard
   defensive measure and is a one-line change:
   `jwt.ParseWithClaims(tokenString, claims, keyfunc, jwt.WithValidMethods([]string{"HS256"}))`.

Token expiry is enforced by the library through `RegisteredClaims.ExpiresAt`; there is no
manual clock comparison anywhere.

---

## 4. `internal/handlers` — the HTTP layer

### 4.1 `AuthMiddleware` — the only middleware

[`middleware.go`](../backend/internal/handlers/middleware.go):

```go
authHeader := c.GetHeader("Authorization")        // must exist
parts := strings.Split(authHeader, " ")           // must be exactly 2 parts
if len(parts) != 2 || parts[0] != "Bearer" { … }  // scheme is case-sensitive
claims, err := auth.ValidateToken(parts[1])       // signature + exp
c.Set("userID", claims.UserID)                    // uint, downstream contract
c.Next()
```

Every rejection path calls `c.Abort()` *and* returns — both are required; omitting
`Abort` would let the handler run after the error response.

The contract established here — **`userID` in the Gin context, typed `uint`** — is
relied upon by every protected handler.

### 4.2 The universal handler skeleton

Six of the seven protected handlers follow the identical shape. Match it exactly when
adding one:

```go
func Something(c *gin.Context) {
    // 1. identity, always first
    userID, exists := c.Get("userID")
    if !exists {
        c.JSON(http.StatusUnauthorized, gin.H{"error": "User ID not found in context"})
        return
    }

    // 2. bind input (write paths only)
    var input SomethingInput
    if err := c.ShouldBindJSON(&input); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
        return
    }

    // 3. query, always scoped by owner
    if err := database.DB.Where("… AND user_id = ?", userID).…; err != nil {
        c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to …"})
        return
    }

    // 4. respond
    c.JSON(http.StatusOK, result)
}
```

The `!exists` branch is defensive: with the middleware in place it is unreachable in
production. It exists so handlers can be unit-tested without the middleware — which is
exactly what `setupGinTestRouter(handler, userID, authenticated=false)` exercises.

`ShouldBindJSON` (not `MustBindWith`) is used everywhere so the 400 response is written by
the handler rather than by Gin's automatic error path.

### 4.3 `auth.go` handlers

- **`Signup`** — bind → `HashPassword` → `DB.Create`. Any create error becomes
  `500 "Failed to create user. Email might already exist."`; the real error is logged.
  The unique-index violation is *not* distinguished from other failures, hence no `409`.
- **`Login`** — `First` by email → `CheckPasswordHash` → `GenerateToken`. Both the
  unknown-email and wrong-password paths return the same `401 "Invalid credentials"`,
  which is correct practice for avoiding account enumeration.
- **`GetUserProfile`** — `DB.First(&user, userID)` and serialise the whole struct;
  `Password` is hidden by its `json:"-"` tag rather than by a DTO.
- **`UpdateUserProfile`** — load, then apply each field **only if the pointer is non-nil**,
  then `DB.Save`. `UpdateProfileInput` uses `*string`/`*int` so absent ("leave unchanged")
  and empty ("clear this") are distinguishable; see
  [API Reference](04-api-reference.md#put-apime). The one guard is `email`, which cannot be
  set to blank because it is the login identifier. `DB.Save` writes **all** columns, so it
  is a full-row UPDATE regardless of how few fields changed.

Note that `Signup` and `Login` share one binding struct, `AuthInput`, while
`UpdateUserProfile` has its own `UpdateProfileInput`. Input structs live in the same file
as their handler, immediately above it — follow that placement.

### 4.4 `subjects.go` handlers

Two binding structs, deliberately different:

- **`CreateSubjectInput`** — value fields, `name` `binding:"required"`.
- **`UpdateSubjectInput`** — **all pointers** (`*string`, `*map[string]int`, `*[]string`),
  nothing required. `nil` means "field absent from the body", which is what makes the
  update a partial merge instead of a replace. This is the durable fix for the old
  description wipe: a client that omits a field can no longer destroy it.

Three shared validators sit above the handlers and are called from both write paths:

| Helper | Rule |
| :----- | :--- |
| `validateStats(map[string]int) error` | Every key must be in `domain.CategoryIDs`; every value in `0..100`. **Missing keys are legal** — an absent key means "not scored", and nothing is zero-filled. |
| `validateTags([]string) ([]string, error)` | Max 12; each entry trimmed, non-empty, ≤ 40 chars. Returns the trimmed slice, which is what gets stored. |
| `validateUncertain([]string, map[string]int) error` | Known ids only, and every id must have a key in the stats it is validated against. |
| `validateGuideAnswers(map[string]map[string]int) error` | Known category ids, integer metric-index keys, answers in `0..3`. The metric *count* per category is frontend-owned, so only the key's shape is checked. |
| `parseSubjectDate(string) (*time.Time, error)` | `time.Parse("2006-01-02", …)`; the error is **returned**, not swallowed. |

`validateUncertain` is the one that needs care: in `UpdateSubject` it runs **after** the
merge, against `subject.Stats` rather than `input.Stats`, so the invariant holds for the row
that will actually be written rather than only for the request that was sent.

Date handling now differs between the two handlers only in what "absent" means:

```go
// CreateSubject: "" means no date; anything unparseable is a 400
if input.Date != "" {
    parsed, err := parseSubjectDate(input.Date)   // 400 on error
    dateParsed = parsed
}

// UpdateSubject: nil means unchanged, "" means clear, otherwise parse strictly
if input.Date != nil {
    if *input.Date == "" { subject.Date = nil } else { /* parse or 400 */ }
}
```

`Name` is `strings.TrimSpace`d in both handlers and rejected when empty after trimming, so
`"Alex "` can no longer split a stack. This applies to new writes only — legacy rows keep
their whitespace.

`DeleteSubject` captures the GORM result and returns `404 {"error":"Subject not found"}`
when `RowsAffected == 0`, so a delete of an unknown or unowned row is reported honestly.

### 4.5 `upload.go`

```go
_, exists := c.Get("userID")               // authentication checked, id then discarded
file, err := c.FormFile("image")           // exact field name
fileType := file.Header.Get("Content-Type")// client-declared, not sniffed
os.MkdirAll("./uploads", os.ModePerm)      // CWD-relative, 0777
filename := fmt.Sprintf("profile_%d%s", time.Now().UnixNano(), filepath.Ext(file.Filename))
c.SaveUploadedFile(file, filepath.Join("./uploads", filename))
c.JSON(200, gin.H{"message": …, "url": "/uploads/" + filename})
```

Implementation notes:

- The local variable `filepath` on line 45 **shadows the imported `path/filepath`
  package** for the remainder of the function. It compiles because the package is not
  referenced again afterwards, but any new `filepath.X` call added below that line will
  fail to build. Rename the variable if you extend this handler.
- The nanosecond timestamp is the sole collision-avoidance mechanism — adequate for one
  process, not guaranteed across a horizontally scaled deployment.
- `os.ModePerm` is `0777`.
- No size cap beyond Gin's default in-memory multipart limit (32 MiB), and no cleanup of
  orphaned files.
- The user id is validated but never used — the file is not namespaced or associated with
  its uploader. Associating it would mean writing `user.ProfilePicture` here rather than
  relying on a follow-up `PUT /api/me`.

### 4.6 `internal/domain` — the shared id contract

[`categories.go`](../backend/internal/domain/categories.go) holds `CategoryIDs` (the seven
stats keys) and `IsCategoryID`. It exists so the handlers can validate `stats` keys without
importing anything HTTP- or storage-shaped.

**Only the ids live here.** Labels, colours, descriptions, and the behavioural metrics stay
in the frontend `CATEGORIES` array by design — the ids are already the documented
cross-tier contract, the prose is not. Adding a category means editing three places:
`CATEGORIES`, `CATEGORY_COLORS`, and `domain.CategoryIDs`.

---

## 5. `internal/database` — connection and migration

Detailed in [Data Model §5](03-data-model.md#5-driver-selection-and-migration). In brief:

- `DB` is a **package-level `*gorm.DB`**. There is no dependency injection; handlers
  reference `database.DB` directly. This is what makes `database.DB = gormDB` a valid test
  seam.
- Driver chosen by presence of `DB_HOST`: Postgres if set, else pure-Go SQLite
  (`github.com/glebarez/sqlite`, CGO-free) writing `alexithymia.db` in the CWD.
- Postgres DSN is assembled by `fmt.Sprintf` with `sslmode=disable TimeZone=UTC`
  hardcoded. TLS to the database is therefore off and not configurable without a code
  change.
- Failures call `log.Fatalf` — no retry, no backoff, no readiness wait.
- `AutoMigrate(&models.User{}, &models.AnalysisSubject{})` runs on every boot. New models
  must be added to this call or their tables will never be created.

---

## 6. Dependencies

Direct requirements ([`go.mod:5-13`](../backend/go.mod#L5-L13)):

| Module | Role |
| :----- | :--- |
| `github.com/gin-gonic/gin` | HTTP router, binding, multipart, static files |
| `gorm.io/gorm` + `gorm.io/driver/postgres` | ORM and Postgres driver |
| `github.com/glebarez/sqlite` | CGO-free SQLite driver for the local fallback |
| `github.com/golang-jwt/jwt/v5` | Token signing and parsing |
| `golang.org/x/crypto` | bcrypt |
| `github.com/DATA-DOG/go-sqlmock` | **Test-only**, but listed as a direct requirement |

There is one `replace` directive pinning `golang.org/x/exp`
([`go.mod:62`](../backend/go.mod#L62)) — a transitive-dependency pin; leave it alone
unless a build failure points at it.

---

## 7. Conventions checklist for new backend code

- Read identity from `c.Get("userID")`; never trust a client-supplied user id.
- Scope every subject query with `AND user_id = ?`. Return `404`, not `403`, on a miss.
- Errors are `gin.H{"error": "…"}`. Bind failures echo `err.Error()`; validation failures
  say precisely which field and why; database failures use a fixed human string and never
  leak SQL.
- One binding struct per operation shape, declared directly above its handler. **Update
  structs use pointer fields** so absent stays distinguishable from empty.
- Reject bad input loudly. Never silently discard an unparseable value.
- Dates on the wire are `YYYY-MM-DD` (`2006-01-02`).
- Register protected routes **inside** the `protected` group.
- Add new models to `AutoMigrate`.
- Additive schema changes only, unless you also ship manual SQL — `AutoMigrate` never
  drops or renames.
- `gofmt` (tab indentation) — the existing files are all gofmt-clean.
