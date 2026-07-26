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
| GET | `/api/relationships` | Bearer | [`GetRelationships`](../backend/internal/handlers/relationships.go) |
| PATCH | `/api/relationships/:id` | Bearer | [`UpdateRelationship`](../backend/internal/handlers/relationships.go) |
| POST | `/api/relationships/:id/merge` | Bearer | [`MergeRelationship`](../backend/internal/handlers/relationships.go) |
| DELETE | `/api/relationships/:id` | Bearer | [`DeleteRelationship`](../backend/internal/handlers/relationships.go) |
| GET | `/api/export` | Bearer | [`ExportVault`](../backend/internal/handlers/vault.go) |
| POST | `/api/import` | Bearer | [`ImportVault`](../backend/internal/handlers/vault.go) |
| GET | `/api/meta` | Bearer | [`GetMeta`](../backend/internal/handlers/vault.go) |
| GET | `/uploads/<filename>` | **none** | `r.Static` — note: not under `/api` |

> The root `README.md` API table predates `/me` (PUT), `/upload`, the static `/uploads`
> route, and all four `/relationships` routes. This document is the current one.

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
| Signature valid but the `user_id` names no live account | `{"error":"Invalid or expired token"}` |

The scheme check is case-sensitive: `bearer <jwt>` is rejected.

The last row is deliberately indistinguishable from an expired token: a token outlives the
account it names — a dropped volume, a `docker compose down -v`, a deleted user — and the
client's only useful response to either is to end the session. A database error during that
lookup is `500 {"error":"Failed to verify session"}`, not `401`, so an outage does not sign
everyone out.

On success the middleware sets `userID` (a `uint`) in the Gin context; handlers read it
with `c.Get("userID")` and assert `userID.(uint)`. **Any new protected handler must read
the user id from the context — never from the request body or a query parameter.**

Token: HS256, claim `user_id`, `exp = now + 24h`, signed with `$JWT_SECRET`
([`auth.go`](../backend/internal/auth/auth.go)). There is no refresh endpoint and no
revocation; logout is client-side only.

**`JWT_SECRET` must be set or the server refuses to start.** `main()` calls
`auth.LoadSecret()` before anything else and exits on failure. An empty key is the dangerous
case rather than a broken one: HS256 signs and verifies with it happily, so the application
would work normally while every token was forgeable by anyone.

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

`404 {"error":"User not found"}` if the token's `user_id` no longer resolves — unreachable
in practice since `AuthMiddleware` answers `401` for that case first; it survives as a guard
against a deletion racing this request.

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
    "user_id": 1, "relationship_id": 3, "name": "Alex", "kind": "full",
    "description": "Rough month — we argued about the move.",
    "date": "2026-02-20T00:00:00Z",
    "stats": { "eros": 85, "storge": 40, "pragma": 10, "mania": 60, "agape": 55, "selflessness": 5 },
    "tags": ["conflict", "distance"],
    "uncertain": ["mania"],
    "guide_answers": { "mania": { "0": 3, "2": 1 } } }
]
```

- **Ordered newest first**: `ORDER BY date IS NULL, date DESC, id DESC`. `date IS NULL`
  sorts false before true on both engines, which is the portable spelling of `NULLS LAST` —
  SQLite has no such clause. The `id` tiebreaker keeps same-day snapshots stably ordered.
- **Optional filter**: `?relationship_id=<n>` narrows to one stack. A non-numeric value is
  `400 {"error":"relationship_id must be a number"}`. No other filters exist.
- **No pagination**, deliberately — see [Data Model §6](03-data-model.md#6-the-relationship-entity).
- `relationship_id` is present on every row. It is nullable in the schema only so the column
  could be added to an existing table; the startup backfill and find-or-create between them
  leave no unlinked rows.
- Empty result is `[]`, not `null` — the slice is initialised by `Find`.
- `tags`, `uncertain`, and `guide_answers` are `null` for rows written before those columns
  existed. Treat null and empty alike.
- Note `ludus` is absent from `stats` above: that snapshot **skipped** the category. An
  absent key is not a zero — see [Concepts](01-concepts.md#skipped-and-unsure--two-kinds-of-i-dont-know).
- `500 {"error":"Failed to fetch subjects"}` on query error.

### `POST /api/subjects`

Request ([`CreateSubjectInput`](../backend/internal/handlers/subjects.go)):

```json
{ "name": "Alex", "description": "Rough month — we argued about the move.", "date": "2026-02-20", "kind": "full",
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
| `kind` | Optional, `"full"` (default) or `"pulse"`. Anything else is `400 {"error":"kind must be \"full\" or \"pulse\""}`. A pulse is a real version taken through the 60-second path — the distinction only changes how the timeline draws it. |

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

**Find-or-create.** After validation the handler resolves the relationship from the trimmed
name, creating it if the name is new, and sets `relationship_id` on the row — both writes in
one transaction, so a failed insert cannot leave an empty relationship behind. This is the
compatibility contract: a client that knows nothing about relationships still lands its
snapshot in the right stack. `{"name": "  Alex  "}` reuses the `Alex` relationship;
`{"name": "alex"}` creates a new one.

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
| `kind` | unchanged | `""` → `"full"` | `"full"` or `"pulse"`, else `400` |

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

**Renaming one version re-resolves its relationship.** If `name` is present and differs from
what is stored, find-or-create runs again and the row detaches to the relationship of the new
name — the same split this has always caused, now visible as a `relationship_id` change
rather than emerging from two strings no longer matching. Resending the *same* name, which
the edit form does on every save, changes nothing. To rename the whole stack use
[`PATCH /api/relationships/:id`](#patch-apirelationshipsid).

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

Deleting the last version of a stack leaves its `Relationship` behind, reporting
`snapshot_count: 0`. To remove the whole history use
[`DELETE /api/relationships/:id`](#delete-apirelationshipsid).

---

## 5. Relationship endpoints

A **relationship** is the person a stack of snapshots is about
([Data Model §6](03-data-model.md#6-the-relationship-entity)). These four routes act on the
stack as a whole; the `/subjects` routes act on one version.

All of them share two conventions:

- **Ownership failures are `404`, never `403`** — whether a relationship exists is not
  another user's business. Every mutating route re-checks `user_id` on both sides of the
  operation inside its transaction.
- **A non-numeric or zero `:id` is `404`**, not `400`: a garbage id names no relationship
  the caller has.

### `GET /api/relationships`

One grouped query; returns a bare array, ordered most-recently-dated first with undated
relationships last, ties broken by name.

```json
[
  { "ID": 3, "name": "Alex", "cadence_days": 90, "snapshot_count": 4, "latest_date": "2026-03-01T00:00:00Z" },
  { "ID": 5, "name": "Sam",  "cadence_days": null, "snapshot_count": 1, "latest_date": null }
]
```

- `snapshot_count` and `latest_date` count only **live** snapshots — the soft-delete filter
  sits in the JOIN condition, so a relationship whose snapshots were all deleted still
  appears, honestly reporting `0` and `null`. Hiding it would make it impossible to delete.
- `latest_date` is `MAX(date)`. Because `MAX()` drops a column's declared type, SQLite
  returns a string here while Postgres returns a timestamp; the handler's `aggregateTime`
  absorbs both and serializes a plain nullable timestamp either way.
- `500 {"error":"Failed to fetch relationships"}` on query error.

### `PATCH /api/relationships/:id`

A partial update of the stack as a whole: its name, its check-in rhythm, or both.

```json
{ "name": "  Alexandra  ", "cadence_days": 90 }
```

**Renaming** moves every version with it — the action that was impossible before
relationships existed. The name is trimmed before use; in one transaction the relationship is
renamed and the denormalized `name` on all of its snapshots is synced (including soft-deleted
ones, so a restore cannot resurrect a stale name). Renaming to the name it already has is a
**no-op `200`**, not a self-collision.

**`cadence_days`** is the opt-in check-in rhythm, and it is the one field in this API with a
three-way distinction:

| In the body | Meaning |
| :---------- | :------ |
| absent | Leave the rhythm exactly as it is. |
| `null` | Turn reminders off. |
| `7`–`365` | Remind after that many days. |
| anything else | `400` |

> Implementation note, because it looks like a convention break: this handler decodes the
> body into a raw map rather than a binding struct. `encoding/json` collapses *absent* and
> *null* into a nil pointer at every pointer depth — verified, not assumed — so presence can
> only be read from the keys themselves.

Nothing on the server acts on a cadence. There is no scheduler, no email, and no push; the
due date is computed in the browser from the latest snapshot's date, which is what keeps
"nothing leaves this machine" literally true.

| Status | Body |
| :----- | :--- |
| `200` | The relationship summary, same shape as the list endpoint. |
| `400` | `{"error":"name is required"}`, `{"error":"name must be a string"}`, `{"error":"cadence_days must be a whole number of days, or null"}`, or `{"error":"cadence_days must be between 7 and 365, or null to turn reminders off"}` |
| `404` | `{"error":"Relationship not found"}` — unknown id or not owned by caller. |
| `409` | `{"error":"You already have a relationship with that name. Merge them instead."}` |
| `500` | `{"error":"Failed to update relationship"}` |

### `POST /api/relationships/:id/merge`

Moves every snapshot of the source into `:id` and retires the source. `:id` is the
**target** — the stack that survives.

```json
{ "source_id": 5 }
```

In one transaction: every snapshot of the source (soft-deleted ones included, so nothing is
left pointing at a retired relationship) moves to the target and takes the target's name;
then the source is soft-deleted.

| Status | Body |
| :----- | :--- |
| `200` | The target's relationship summary, with the combined `snapshot_count`. |
| `400` | `{"error":"source_id is required"}` or `{"error":"cannot merge a relationship into itself"}` |
| `404` | `{"error":"Relationship not found"}` — **either** side unknown or not owned, so a merge cannot reach across users. |
| `500` | `{"error":"Failed to merge relationships"}` |

**One-way.** Nothing records which snapshots came from where, which is why the UI states
plainly what will move before asking for confirmation.

### `DELETE /api/relationships/:id`

Deletes the whole history — distinct from `DELETE /api/subjects/:id`, which deletes one
version. Both are soft deletes, so a database backup is still the real undo.

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"Relationship deleted","snapshots_deleted":4}` |
| `404` | `{"error":"Relationship not found"}` |
| `500` | `{"error":"Failed to delete relationship"}` |


---

## 6. Vault endpoints

Export, import, and the counts behind the Vault page. Everything here is scoped to the
caller; there is no cross-user anything.

### `GET /api/export`

One JSON document containing everything the signed-in user has.

```json
{
  "format": "alq-export",
  "version": 1,
  "exported_at": "2026-07-26T03:34:14Z",
  "user": { "email": "you@example.com", "name": "Jane", "age": 31, "mbti_type": "INTJ" },
  "relationships": [
    { "name": "Alex", "cadence_days": 90,
      "snapshots": [
        { "date": "2026-01-10", "kind": "full",
          "stats": { "eros": 40, "mania": 70 },
          "description": "rough month", "tags": ["conflict"], "uncertain": ["mania"],
          "guide_answers": { "eros": { "0": 2 } },
          "created_at": "2026-01-10T09:12:00Z" }
      ] }
  ]
}
```

What is **deliberately absent**:

- **The password hash.** `ExportUser` has no such field at all — an omitted `json` tag could
  be added back by accident, a missing field cannot. A test asserts on the raw payload bytes.
- **Internal ids.** A snapshot's identity in this format is its relationship plus its date,
  which is what makes re-import idempotent without carrying database keys around.
- **Soft-deleted rows**, via GORM's default scope: an export is what you have, not what you
  once had.
- **The denormalized snapshot name** — the relationship above it carries the name.
- **Avatar image bytes.** Unsupported in version 1; `profile_picture` is a path, and the file
  is not included.

Shape notes: `date` is `YYYY-MM-DD` (the same format `POST /api/subjects` takes) and is
always present, `null` when the snapshot is undated. The optional content fields
(`stats`, `description`, `tags`, `uncertain`, `guide_answers`) are omitted when empty, so a
pre-Phase-2 database exports cleanly rather than as a wall of nulls. Relationships are
ordered by name; snapshots oldest-first, undated last.

| Status | Body |
| :----- | :--- |
| `200` | The document above. |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | `{"error":"User not found"}` |
| `500` | `{"error":"Failed to export"}` |

### `POST /api/import`

Accepts the same document. `?dry_run=true` reports what *would* happen and writes nothing.

```json
{ "dry_run": false, "relationships_created": 2, "snapshots_created": 31, "snapshots_skipped": 16 }
```

Rules, in the order they matter:

1. **`format` and `version` are checked first.** Anything else is `400` — this endpoint will
   not guess at a file it does not recognise.
2. **The whole document is validated before anything is written**, reusing the same
   validators as `POST /api/subjects`. An import is not a validation bypass. One bad value
   rejects the file whole rather than leaving half of it applied, and the message names the
   position: `Alex, snapshot 4: stats.eros must be between 0 and 100`.
3. **Relationships resolve by find-or-create on the trimmed name**, so an import merges into
   the stacks the user already has instead of shadowing them.
4. **A snapshot is skipped when its relationship, date and stats all match** one already
   stored. Date alone would reject two genuine readings from the same day; stats alone would
   reject an unchanged relationship snapshotted months apart — which is exactly the signal
   this app exists to record. Duplicates *within one file* are caught too.
5. **A cadence in the file only fills a gap.** If the relationship already has a rhythm set
   here, the file does not overwrite it: the file describes the past, the app holds the
   present.
6. **Everything runs in one transaction.** A dry run walks the identical code path and then
   rolls back on a sentinel error, so the preview cannot disagree with the real run.

| Status | Body |
| :----- | :--- |
| `200` | The counts above. |
| `400` | `{"error":"unrecognized format …"}`, `{"error":"unsupported export version …"}`, `{"error":"every relationship needs a name"}`, `{"error":"relationship \"X\" appears twice in the file"}`, or any `POST /api/subjects` validation message prefixed with its position. |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to import"}` |

### `GET /api/meta`

Counts for the Vault page. No configuration detail: no DSN, no file paths, no secrets.

```json
{ "db_backend": "sqlite", "relationship_count": 3, "snapshot_count": 47, "oldest_snapshot_date": "2025-03-04T00:00:00Z" }
```

`db_backend` is GORM's dialector name (`sqlite` or `postgres`); the frontend turns it into a
sentence. `oldest_snapshot_date` is `MIN(date)` scoped to the caller and is `null` when
nothing is dated — it uses the same `aggregateTime` scanner as `latest_date`, for the same
engine-typing reason.

---

## 7. Upload endpoints

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

## 8. Cross-cutting conventions

**Error shape.** Every error is `{"error": "<human string>"}`. There are no error codes,
no field-level error maps, and messages are not stable — do not match on their text
outside of tests.

**Success shape.** Inconsistent by design accident:
- bare resource — `GET /api/me`, all subject reads/writes, relationship update and merge, export, import, meta
- `{"message"}` — signup, subject delete
- `{"message", …}` — relationship delete adds `snapshots_deleted`
- `{"message","user"}` — `PUT /api/me`
- `{"message","url"}` — upload

**Ownership.** Every protected handler scopes by the `userID` the middleware put in the Gin
context, and reports a miss as `404`. There is no `403` anywhere in the API.

**CORS.** No CORS middleware exists. Both supported deployments are same-origin (Vite
proxy in dev, Nginx in prod). A cross-origin client will be blocked by the browser with
nothing logged server-side.

**Rate limiting.** None, on any endpoint — including `/api/login`.

**Content negotiation.** Handlers use `c.ShouldBindJSON`, which requires a JSON body; the
`Content-Type` header is not strictly enforced but sending non-JSON yields `400`.
