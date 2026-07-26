# 04 — API Reference

Base path: `/api`. All bodies are JSON except `POST /api/upload` (multipart).
Route table: [`backend/cmd/server/main.go:17-35`](../backend/cmd/server/main.go#L17-L35).

---

## 1. Endpoint summary

| Method | Path | Auth | Handler |
| :----- | :--- | :--- | :------ |
| POST | `/api/signup` | — | [`Signup`](../backend/internal/handlers/auth.go#L19-L44) |
| POST | `/api/login` | — | [`Login`](../backend/internal/handlers/auth.go#L46-L71) |
| GET | `/api/me` | Bearer | [`GetUserProfile`](../backend/internal/handlers/auth.go) |
| PUT | `/api/me` | Bearer | [`UpdateUserProfile`](../backend/internal/handlers/auth.go) |
| POST | `/api/upload` | Bearer | [`UploadProfilePicture`](../backend/internal/handlers/upload.go#L13-L59) |
| GET | `/api/subjects` | Bearer | [`GetSubjects`](../backend/internal/handlers/subjects.go) |
| POST | `/api/subjects` | Bearer | [`CreateSubject`](../backend/internal/handlers/subjects.go) |
| PUT | `/api/subjects/:id` | Bearer | [`UpdateSubject`](../backend/internal/handlers/subjects.go) |
| DELETE | `/api/subjects/:id` | Bearer | [`DeleteSubject`](../backend/internal/handlers/subjects.go) |
| GET | `/uploads/<filename>` | **none** | `r.Static` — note: not under `/api` |

> The root `README.md` API table predates `/me` (PUT), `/upload`, and the static
> `/uploads` route. This document is the current one.

---

## 2. Authentication contract

Every protected route sits inside a Gin group wrapped by
[`AuthMiddleware`](../backend/internal/handlers/middleware.go#L12-L39), which requires:

```
Authorization: Bearer <jwt>
```

Rejections, all `401` with a distinct message:

| Condition | Body |
| :-------- | :--- |
| Header absent | `{"error":"Authorization header required"}` |
| Not exactly two space-separated parts, or first part ≠ `Bearer` | `{"error":"Invalid authorization header format"}` |
| Signature invalid, malformed, or `exp` passed | `{"error":"Invalid or expired token"}` |

The scheme check is case-sensitive: `bearer <jwt>` is rejected.

On success the middleware sets `userID` (a `uint`) in the Gin context; handlers read it
with `c.Get("userID")` and assert `userID.(uint)`. **Any new protected handler must read
the user id from the context — never from the request body or a query parameter.**

Token: HS256, claim `user_id`, `exp = now + 24h`, signed with `$JWT_SECRET`
([`auth.go:29-40`](../backend/internal/auth/auth.go#L29-L40)). There is no refresh
endpoint and no revocation; logout is client-side only.

---

## 3. Auth endpoints

### `POST /api/signup`

Request — both fields `binding:"required"`:

```json
{ "email": "user@example.com", "password": "correct horse battery staple" }
```

| Status | Body | When |
| :----- | :--- | :--- |
| `201` | `{"message":"User created successfully"}` | Created. **No token returned.** |
| `400` | `{"error":"<gin validation message>"}` | Missing `email` or `password`. |
| `500` | `{"error":"Failed to hash password"}` | bcrypt failure. |
| `500` | `{"error":"Failed to create user. Email might already exist."}` | Any insert error, including the unique-email violation. |

Notes for implementers:

- **No email-format validation** (`binding:"required"` only — not `required,email`) and
  **no password-strength or length rules**. `{"email":"x","password":"y"}` creates a user.
- A duplicate email is reported as `500`, not `409`. The real cause is logged server-side
  (`log.Println("Details: ", err)`); the client sees the generic message.
- Because no token is issued, the client must call `/api/login` next. `Auth.jsx` handles
  this by switching itself back to the login view.

### `POST /api/login`

Request: same shape as signup.

| Status | Body | When |
| :----- | :--- | :--- |
| `200` | `{"token":"eyJhbGciOi…"}` | Success. |
| `400` | `{"error":"<validation message>"}` | Missing field. |
| `401` | `{"error":"Invalid credentials"}` | Unknown email **or** wrong password — deliberately indistinguishable. |
| `500` | `{"error":"Failed to generate token"}` | Signing failure. |

### `GET /api/me`

Returns the serialised `User`. `password` is omitted by its `json:"-"` tag.

```json
{
  "ID": 1, "CreatedAt": "2026-02-19T20:03:11.42Z", "UpdatedAt": "2026-02-20T08:12:55.9Z", "DeletedAt": null,
  "email": "user@example.com", "name": "Jane Doe", "age": 31,
  "mbti_type": "INTJ", "profile_picture": "/uploads/profile_1771820375781154800.jpg"
}
```

`404 {"error":"User not found"}` if the token's `user_id` no longer resolves.

### `PUT /api/me`

Request — every field optional
([`UpdateProfileInput`](../backend/internal/handlers/auth.go)):

```json
{ "name": "Jane Doe", "age": 31, "mbti_type": "INTJ", "profile_picture": "/uploads/profile_1771820375781154800.jpg", "email": "new@example.com" }
```

**Absent means "leave unchanged"; present means "write this".** Every field is a pointer
(`*string`, `*int`) and is assigned only when non-nil, so `{"name": ""}` blanks the name,
`{"age": 0}` resets the age, and `{"profile_picture": ""}` removes the avatar — while a
body that omits those keys leaves them alone.

The one exception is `email`: it is the login identifier, so an explicitly empty value is
rejected with `400 {"error":"email cannot be empty"}`. Otherwise `email` is still written
with no format validation, no uniqueness pre-check, and no verification flow — the code
comments acknowledge this. A collision surfaces as a `500` from the unique index.

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"Profile updated successfully","user":{…full user…}}` |
| `400` | `{"error":"<binding error>"}` or `{"error":"email cannot be empty"}` |
| `404` | `{"error":"User not found"}` |
| `500` | `{"error":"Failed to update profile"}` |

Response shape note: `PUT /api/me` wraps the user in `{"message","user"}` while
`GET /api/me` returns the user unwrapped. Subject endpoints return bare objects. This
inconsistency is real — match the endpoint you are calling.

---

## 4. Subject endpoints

### `GET /api/subjects`

Returns a **bare JSON array** of every non-soft-deleted subject owned by the caller.

```json
[
  { "ID": 7, "CreatedAt": "…", "UpdatedAt": "…", "DeletedAt": null,
    "user_id": 1, "name": "Alex", "description": "Rough month — we argued about the move.",
    "date": "2026-02-20T00:00:00Z",
    "stats": { "eros": 85, "storge": 40, "pragma": 10, "mania": 60, "agape": 55, "selflessness": 5 },
    "tags": ["conflict", "distance"],
    "uncertain": ["mania"],
    "guide_answers": { "mania": { "0": 3, "2": 1 } } }
]
```

- **No ordering** — no `ORDER BY` clause. Sorting is entirely client-side.
- **No pagination or filtering.** Every row, every request.
- Empty result is `[]`, not `null` — the slice is initialised by `Find`.
- `tags`, `uncertain`, and `guide_answers` are `null` for rows written before those columns
  existed. Treat null and empty alike.
- Note `ludus` is absent from `stats` above: that snapshot **skipped** the category. An
  absent key is not a zero — see [Concepts](01-concepts.md#skipped-and-unsure--two-kinds-of-i-dont-know).
- `500 {"error":"Failed to fetch subjects"}` on query error.

### `POST /api/subjects`

Request ([`CreateSubjectInput`](../backend/internal/handlers/subjects.go)):

```json
{ "name": "Alex", "description": "Rough month — we argued about the move.", "date": "2026-02-20",
  "stats": { "eros": 85, "storge": 40, "pragma": 10, "mania": 60, "agape": 55, "selflessness": 5 },
  "tags": ["conflict", "distance"],
  "uncertain": ["mania"],
  "guide_answers": { "mania": { "0": 3, "2": 1 } } }
```

| Field | Rules |
| :---- | :---- |
| `name` | **Required** (`binding:"required"`). Trimmed server-side; empty after trimming → `400 {"error":"name is required"}`. Not length-limited. |
| `description` | Optional string — the snapshot note. No length limit, no validation. |
| `date` | Optional string, layout **`YYYY-MM-DD`** exactly (Go layout `2006-01-02`). A malformed value is **rejected**: `400 {"error":"invalid date, expected YYYY-MM-DD"}`. Full RFC3339 timestamps are *not* accepted here. Omitted or `""` → stored as `null`. |
| `stats` | Optional `map[string]int`. Every key must be one of the seven category ids and every value must be `0..100`; **missing keys are legal and mean "not scored"**. See [Data Model](03-data-model.md#stats-is-validated-against-the-seven-ids). Omitted → `null`. |
| `tags` | Optional `[]string` — the context capsule. Max 12; each entry is trimmed and must be non-empty and ≤ 40 characters. Omitted → `null`. |
| `uncertain` | Optional `[]string` — category ids scored but not trusted. Each must be a known id **and** must have a key in `stats`. Omitted → `null`. |
| `guide_answers` | Optional nested object: category id → metric index (string) → scale index `0..3`. Unknown ids, non-integer index keys, and out-of-range answers are rejected. Omitted → `null`. |

`user_id` is taken from the JWT and cannot be set by the client; a `user_id` in the body
is ignored (the binding struct has no such field).

| Status | Body |
| :----- | :--- |
| `201` | The created subject, including its `ID`. |
| `400` | `{"error":"…"}` — unparseable JSON, missing/blank `name`, `unknown stats key: <k>`, `stats.<k> must be between 0 and 100`, `invalid date, expected YYYY-MM-DD`, `too many tags, maximum is 12`, `tags must not be empty`, `tag exceeds 40 characters: <t>`, `unknown category id in uncertain: <k>`, `cannot mark <k> uncertain: it has no score`, `unknown category id in guide_answers: <k>`, `guide_answers.<k> has a non-index key: <i>`, `guide_answers.<k>.<i> must be between 0 and 3`. |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to create subject"}` |

**Versioning uses this endpoint.** A "new version" is an ordinary POST reusing an
existing `name` with a later `date`. There is no dedicated versioning route.

### `PUT /api/subjects/:id`

Uses its own binding struct,
[`UpdateSubjectInput`](../backend/internal/handlers/subjects.go), whose fields are all
pointers. **This endpoint is a partial merge, not a replace.**

| Field in body | Behaviour |
| :------------ | :-------- |
| absent | Left exactly as stored. |
| present | Validated by the same rules as `POST`, then written — including empty values. |

Concretely:

| Field | Absent | `""` / `[]` / `0` | Value |
| :---- | :----- | :---------------- | :---- |
| `name` | unchanged | `400 "name is required"` | trimmed, then written |
| `description` | unchanged | note cleared | written |
| `date` | unchanged | date set to `null` | parsed strictly, or `400` |
| `stats` | unchanged | `{}` stored | validated, then written |
| `tags` | unchanged | tags cleared | trimmed + validated, then written |
| `uncertain` | unchanged | flags cleared | validated against the **resulting** stats, then written |
| `guide_answers` | unchanged | answers cleared | validated, then written |

> This is the durable fix for the old description wipe: a client that omits a field can no
> longer destroy it, even if a future field is added to the model before the form knows
> about it. `PersonForm` sends the complete object
> (`{name, date, stats, description, tags, uncertain, guide_answers}`) regardless.

The **uncertain invariant is checked after the merge**, so a body that sends only `stats`
and drops a category the stored row still flags unsure returns
`400 {"error":"cannot mark <k> uncertain: it has no score"}` rather than storing a
contradiction. Send `uncertain` alongside `stats` whenever you change which categories are
scored.

The "add a note" action on the What Changed screen uses this endpoint with a body of just
`{"description": …, "tags": […]}` — the scores it was reporting on are left untouched.

Ownership: the row is loaded with `WHERE id = ? AND user_id = ?`, so another user's id
yields `404`, never `403`.

| Status | Body |
| :----- | :--- |
| `200` | The updated subject. |
| `400` | `{"error":"…"}` — bad JSON, blank `name`, or any of the `POST` validation messages. |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | `{"error":"Subject not found"}` — unknown id *or* not owned by caller. |
| `500` | `{"error":"Failed to update subject"}` |

### `DELETE /api/subjects/:id`

Soft delete (`deleted_at` is set). Deletes exactly one version, not a whole stack.

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"Subject deleted"}` |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | `{"error":"Subject not found"}` — nothing matched: unknown id, already deleted, or owned by someone else. |
| `500` | `{"error":"Failed to delete subject"}` |

The handler inspects `RowsAffected`, so the `200` genuinely means one row was deleted.
Deleting the same id twice therefore returns `200` and then `404`.

---

## 5. Upload endpoints

### `POST /api/upload`

`Content-Type: multipart/form-data`, single file under field name **`image`**.

Validation is a **client-declared MIME allowlist** — the part's `Content-Type` header is
compared against `image/jpeg`, `image/png`, `image/webp`
([`upload.go:29-33`](../backend/internal/handlers/upload.go#L29-L33)). **No magic-byte
sniffing, no image decode, and no size limit** beyond Gin's default multipart memory
cap. A renamed executable declaring `image/png` is accepted; the E2E test relies on this
by uploading the literal bytes `fake image data`.

Stored as `./uploads/profile_<UnixNano><ext>`, where `ext` comes from
`filepath.Ext(file.Filename)` — so the extension is attacker-controlled while the
basename is not. A file with no extension produces `profile_<nanos>` with none.

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"File uploaded successfully","url":"/uploads/profile_1771820375781154800.jpg"}` |
| `400` | `{"error":"No file is received"}` — no part named `image`. |
| `400` | `{"error":"Invalid file type. Only JPEG, PNG, and WEBP are allowed"}` |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to create upload directory"}` or `{"error":"upload file err: …"}` |

Two behaviours to know:

1. **The upload is not attached to the user.** The handler checks authentication, then
   ignores the id. The returned `url` becomes the user's avatar only when the client
   subsequently calls `PUT /api/me` with `profile_picture` set. Orphaned files accumulate
   whenever a user uploads and never saves.
2. **The filename is not namespaced per user**, so listing the directory reveals all
   avatars.

### `GET /uploads/<filename>`

`r.Static("/uploads", "./uploads")`, registered **outside** the protected group at
[`main.go:22`](../backend/cmd/server/main.go#L22): avatars are **publicly readable by
anyone who knows or guesses the filename**. Filenames are nanosecond timestamps — hard to
brute-force, trivial to enumerate with directory access.

Note this path is *not* under `/api`, which is why it needs its own Vite proxy rule and
why the container Nginx config misses it
([Known Issues](11-known-issues.md#uploads-is-not-proxied-in-the-container-setup)).

---

## 6. Cross-cutting conventions

**Error shape.** Every error is `{"error": "<human string>"}`. There are no error codes,
no field-level error maps, and messages are not stable — do not match on their text
outside of tests.

**Success shape.** Inconsistent by design accident:
- bare resource — `GET /api/me`, all subject reads/writes
- `{"message"}` — signup, delete
- `{"message","user"}` — `PUT /api/me`
- `{"message","url"}` — upload

**CORS.** No CORS middleware exists. Both supported deployments are same-origin (Vite
proxy in dev, Nginx in prod). A cross-origin client will be blocked by the browser with
nothing logged server-side.

**Rate limiting.** None, on any endpoint — including `/api/login`.

**Content negotiation.** Handlers use `c.ShouldBindJSON`, which requires a JSON body; the
`Content-Type` header is not strictly enforced but sending non-JSON yields `400`.
