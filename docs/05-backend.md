# 05 — Backend Implementation

Go 1.24.1 · Gin 1.11 · GORM 1.31 · `golang-jwt/v5` · `golang.org/x/crypto/bcrypt`
Module: `alexithymia-backend` ([`backend/go.mod`](../backend/go.mod))

---

## 1. Package layout

```
backend/
├── cmd/server/main.go              composition root, ~39 lines
├── internal/
│   ├── auth/
│   │   ├── auth.go                 bcrypt + JWT primitives (HTTP-agnostic)
│   │   └── auth_test.go            secret loading, token round-trip, forgery
│   ├── database/
│   │   ├── database.go             driver selection, global DB, AutoMigrate, backfill
│   │   ├── backfill.go             find-or-create + the Phase 4 relationship backfill
│   │   ├── database_test.go        SQLite integration + migration tests
│   │   └── backfill_test.go        backfill grouping, idempotency, soft deletes
│   ├── domain/categories.go        the seven stats-key ids (validation allowlist)
│   ├── handlers/
│   │   ├── middleware.go           AuthMiddleware
│   │   ├── auth.go                 Signup, Login, GetUserProfile, UpdateUserProfile
│   │   ├── subjects.go             CRUD for AnalysisSubject (one snapshot)
│   │   ├── relationships.go        list, update, merge, delete (a whole stack)
│   │   ├── vault.go                export, import, meta
│   │   ├── upload.go               UploadProfilePicture
│   │   ├── subjects_test.go        sqlmock table-driven handler tests
│   │   ├── relationships_test.go   real-SQLite behaviour tests
│   │   ├── vault_test.go           export/import round-trip tests
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

[`auth.go`](../backend/internal/auth/auth.go), no HTTP: password hashing, access tokens,
and the two helpers that mint and hash a refresh token.

```go
var jwtKey = []byte(os.Getenv("JWT_SECRET"))

// LoadSecret re-reads JWT_SECRET and reports whether tokens can be signed safely.
// main() calls it first and exits on failure.
func LoadSecret() error

type Claims struct {
	UserID uint `json:"user_id"`
	jwt.RegisteredClaims
}
```

| Function | Behaviour |
| :------- | :-------- |
| `HashPassword(string) (string, error)` | `bcrypt.GenerateFromPassword(…, 14)`. **Cost 14** — deliberately high; ~1s per hash on typical hardware, which shapes signup/login latency and slows test suites that hash for real. |
| `CheckPasswordHash(password, hash) bool` | `CompareHashAndPassword` — errors collapse to `false`, so a malformed stored hash is indistinguishable from a wrong password. |
| `GenerateToken(userID uint) (string, error)` | HS256, `exp = now + AccessTokenTTL` (24h). No `iat`, `nbf`, `sub`, `iss`, or `jti`. |
| `ValidateToken(string) (*Claims, error)` | `jwt.ParseWithClaims` + explicit `token.Valid` check. |
| `NewRefreshToken() (string, error)` | 32 bytes from `crypto/rand`, base64url. Opaque, **not** a JWT: a signed refresh token still needs server state to be revocable, and it would carry claims a client could read. |
| `HashRefreshToken(string) string` | SHA-256, hex. Unsalted and unstretched **on purpose** — the input is 32 uniformly random bytes, so there is no dictionary to run, and this keeps the lookup a single indexed equality. |

`AccessTokenTTL` (24h) and `RefreshTokenTTL` (60 days) are the two numbers that decide how
often a user is asked for a passphrase. The access token stays short because it is stateless
and therefore unrevocable; the refresh token can be long because it is neither. Renewal
itself lives in [`handlers/session.go`](../backend/internal/handlers/session.go) — this
package deliberately holds no database access.

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
database.DB.Select("id").First(&user, claims.UserID)  // the account must still exist
c.Set("userID", claims.UserID)                    // uint, downstream contract
c.Next()
```

Every rejection path calls `c.Abort()` *and* returns — both are required; omitting
`Abort` would let the handler run after the error response.

**Why the extra SELECT.** A token stays valid for its full 24 hours regardless of what
happens to the row behind it, so a dropped volume or a deleted account leaves a browser
holding a signature that verifies perfectly against a user id that names nobody. Without
this lookup the request proceeded: `/api/me` answered `404` and the list endpoints answered
`[]`, and no client could tell either from a genuinely empty account. `gorm.ErrRecordNotFound`
is a `401` — the response the frontend's interceptor already acts on — while any other error
is a `500`, so a database blip does not sign every user out.

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
- **`Login`** — `First` by email → `CheckPasswordHash` → `issueSession`. Both the
  unknown-email and wrong-password paths return the same `401 "Invalid credentials"`,
  which is correct practice for avoiding account enumeration. It answers with a
  `sessionPayload` (access token, refresh token, `expires_in`) rather than a bare token; the
  `token` field is unchanged, so a client that ignores the rest behaves exactly as before.
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

### 4.3a `session.go` — issuing, rotating, and revoking

Three functions and two public handlers, all of them about one question: how does a client
get a new access token without the password?

| Symbol | Behaviour |
| :----- | :-------- |
| `issueSession(db, userID)` | Mints the pair, stores the refresh half as a hash, sweeps that user's expired rows, and returns the payload. The **only** writer of `models.RefreshToken` rows. |
| `revokeAllForUser(db, userID)` | The answer to a replay: every live token for that user is revoked at once. |
| `Refresh` | Look up by hash → reject if revoked (and revoke the family), expired, or naming a deleted account → atomically claim the row → issue the replacement. |
| `Logout` | Revoke one token. Always `204`. |

Three details that are easy to get wrong if this is ever rewritten:

1. **Claim the token before spending it**, with one conditional
   `UPDATE … WHERE id = ? AND revoked_at IS NULL`, and treat `RowsAffected == 0` as a replay.
   The read that precedes it is not enough on its own: two requests carrying the same token
   can both pass it and both issue a session, which is exactly the reuse this design exists
   to catch. The `WHERE` clause is what makes exactly one caller able to rotate a token.
2. **A database error is `500`, never `401`.** Saying 401 here would sign every client out
   over an outage — the same distinction `AuthMiddleware` draws for the same reason.
3. **The account check is repeated here.** A session outlives the account behind it when a
   volume is dropped or a user deleted; renewing without checking would hand out an access
   token naming nobody, which is precisely the dead-session case the middleware exists to
   refuse.

Both routes are public, because the access token they concern is — in the ordinary case —
already expired. Nginx rate-limits `/api/refresh` in the same zone as login and signup:
it takes a credential from an unauthenticated caller and answers with a live session, so
leaving it in the generic `/api/` block would make it the one unmetered way to guess at one.

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
`"Alex "` can no longer split a stack. Since Phase 4 the trimmed name is also what
find-or-create resolves against, and the startup backfill has normalized the legacy rows
that used to keep their whitespace.

`DeleteSubject` captures the GORM result and returns `404 {"error":"Subject not found"}`
when `RowsAffected == 0`, so a delete of an unknown or unowned row is reported honestly. It
deletes one version; the relationship survives even if that was its last snapshot.

**Both write paths resolve a relationship**, inside a transaction with the row write:

```go
// CreateSubject — one transaction, so a failed insert leaves no empty relationship
err = database.DB.Transaction(func(tx *gorm.DB) error {
    relationship, err := database.FindOrCreateRelationship(tx, subject.UserID, name)
    if err != nil { return err }
    subject.RelationshipID = &relationship.ID
    return tx.Create(&subject).Error
})

// UpdateSubject — only when the name actually changed, or the row arrived unlinked
needsRelationship := subject.RelationshipID == nil ||
    (input.Name != nil && subject.Name != originalName)
```

The `subject.RelationshipID == nil` half matters: it links a legacy row on its way through
an edit, so a database whose backfill has not run cannot save a row back still unlinked.

### 4.4a `relationships.go` — the stack as a whole

Four handlers, all sharing one grouped query and one ownership rule.

`summaryQuery(userID)` is the single source of the `{ID, name, snapshot_count, latest_date}`
shape — the list endpoint orders it, rename and merge re-read one row through it, so every
response has the same shape. The join is `LEFT` with `deleted_at IS NULL` **in the join
condition** rather than a `WHERE`, so soft-deleted snapshots drop out of the count without
dropping their relationship from the result.

```go
func findOwnedRelationship(tx *gorm.DB, relationshipID uint, userID uint) (*models.Relationship, error)
```

Every mutating route calls it, on **both** sides of a merge — which is what stops a merge
reaching across users. A miss is `404`, never `403`.

Two details that are easy to get wrong:

- **Rename syncs the denormalized name `Unscoped()`**, so a soft-deleted snapshot does not
  keep a stale name it would come back under if restored. Merge moves soft-deleted snapshots
  for the same reason: nothing should still point at a retired relationship.
- **`errNameTaken` and `errSameRelationship` are sentinel errors** returned *out* of the
  transaction closure, so the 409 and the 400 are decided outside it. Writing the response
  inside the closure would leave the transaction to commit around an already-sent error.

`aggregateTime` handles `MAX(date)`: SQLite returns a string (the aggregate drops the
column's declared type) where Postgres returns a `time.Time`. It also implements `Value()`,
unused, because GORM refuses to scan into a struct field that implements only half of the
`Valuer`/`Scanner` pair.

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

### 4.5a `vault.go` — export, import, meta

The export document is the app's promise that the data is yours, so its shape is chosen for
a human reading the file: no internal ids, dates in `YYYY-MM-DD`, and optional fields
omitted when empty.

**The password is absent by construction.** `ExportUser` has no such field, rather than a
field with `json:"-"`. A tag can be removed by accident; a field that does not exist cannot
leak. The test asserts on the raw response bytes for the same reason.

Import is three phases, and the split is the point:

```go
prepared, err := prepareImport(document)   // validate everything, touch nothing
err = database.DB.Transaction(func(tx *gorm.DB) error {
    if err := applyImport(tx, userID, prepared, &result); err != nil { return err }
    if dryRun { return errDryRun }         // same path, then roll back
    return nil
})
```

- **Validation before any write** means one bad value rejects the file whole. `prepareImport`
  reuses `validateStats`, `validateTags`, `validateUncertain`, `validateGuideAnswers`,
  `normalizeKind` and `parseSubjectDate` — an import must never be a way around the rules the
  create endpoint enforces.
- **`errDryRun` rolls back after doing the work**, so the preview and the real run cannot
  disagree. Reporting what a *different* code path would have done is how preview features
  start lying.
- **Duplicate detection is date + stats together** (`isDuplicateSnapshot`). Date alone would
  reject two genuine readings from one day; stats alone would reject an unchanged
  relationship snapshotted months apart, which is the signal the app exists to record.

`GetMeta` returns counts and `database.DB.Dialector.Name()`. Deliberately no DSN, no paths,
no configuration — the Vault page needs to say *where* the data is, not how to reach it.

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
- `AutoMigrate(Models()...)` runs on every boot, over
  `{User, Relationship, AnalysisSubject, RefreshToken}`. New models must be added to
  `Models()` or their tables will never be created — and note that the handler tests migrate
  from the same list, so a table cannot be present in the server and missing from the tests.
- `BackfillRelationships(DB)` runs immediately after, on every boot, and logs one summary
  line. It is idempotent — it only touches rows with `relationship_id IS NULL` — so the
  second and every later boot report `0, 0`. See
  [Deployment §5](09-deployment.md#5-the-phase-4-relationship-migration) for the backup step
  and what a healthy log looks like.
- `FindOrCreateRelationship` lives in `backfill.go` beside the backfill **on purpose**: the
  write path and the migration must resolve a name to a relationship by the same rule, or a
  stack splits in half.

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
