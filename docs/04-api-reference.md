# 04 — API Reference

Base path: `/api`. All bodies are JSON except `POST /api/upload` (multipart).
Route table: [`backend/cmd/server/main.go:17-35`](../backend/cmd/server/main.go#L17-L35).

---

## 1. Endpoint summary

| Method | Path | Auth | Handler |
| :----- | :--- | :--- | :------ |
| POST | `/api/signup` | — | [`Signup`](../backend/internal/handlers/auth.go#L19-L44) |
| POST | `/api/login` | — | [`Login`](../backend/internal/handlers/auth.go#L46-L71) |
| POST | `/api/refresh` | refresh token in body | [`Refresh`](../backend/internal/handlers/session.go) |
| POST | `/api/logout` | refresh token in body | [`Logout`](../backend/internal/handlers/session.go) |
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
| POST | `/api/journal/entries` | Bearer | [`CreateJournalEntry`](../backend/internal/handlers/journal.go) |
| GET | `/api/journal/entries` | Bearer | [`GetJournalEntries`](../backend/internal/handlers/journal.go) |
| DELETE | `/api/journal/entries/:id` | Bearer | [`DeleteJournalEntry`](../backend/internal/handlers/journal.go) |
| GET | `/api/journal/days` | Bearer | [`GetJournalDays`](../backend/internal/handlers/journal.go) |
| DELETE | `/api/journal/people/:id` | Bearer | [`DeleteJournalPerson`](../backend/internal/handlers/journal.go) |
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

Access token: HS256, claim `user_id`, `exp = now + 24h` (`auth.AccessTokenTTL`), signed
with `$JWT_SECRET` ([`auth.go`](../backend/internal/auth/auth.go)). It is stateless and
therefore **not revocable** — the clock is its only bound, which is why it is short.

Renewal is a separate credential. `POST /api/login` returns a **refresh token** alongside
it, and `POST /api/refresh` exchanges that for a new pair; `POST /api/logout` revokes it.
See [§3.1](#31-session-renewal) for the rules, and
[`session.go`](../backend/internal/handlers/session.go) for the implementation.

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
| `200` | `{"token":"eyJhbGciOi…","refresh_token":"nR7…","expires_in":86400}` | Success. |
| `400` | `{"error":"<validation message>"}` | Missing field. |
| `401` | `{"error":"Invalid credentials"}` | Unknown email **or** wrong password — deliberately indistinguishable. |
| `500` | `{"error":"Failed to generate token"}` | Signing or refresh-token persistence failure. |

`expires_in` is the access token's life **in seconds**. A client that stores it can renew
*before* a request fails, which is the difference between a session that never visibly
expires and one that recovers loudly.

> **Compatibility.** `token` is unchanged and still sufficient on its own. A client that
> ignores the two new fields behaves exactly as it did before this change: signed in for
> 24 hours, then 401.

### 3.1 Session renewal

#### `POST /api/refresh`

Request:

```json
{ "refresh_token": "nR7…" }
```

| Status | Body | When |
| :----- | :--- | :--- |
| `200` | Same shape as login | Renewed. **The submitted token is now dead** — see rotation below. |
| `400` | `{"error":"<validation message>"}` | `refresh_token` absent. |
| `401` | `{"error":"Session expired. Please sign in again."}` | Unknown, expired, already-used, revoked, or naming a deleted account. |
| `500` | `{"error":"Failed to verify session"}` | Database unreachable — deliberately **not** 401, so an outage does not sign everyone out. |

Public by necessity: the access token it exists to replace is, in the ordinary case,
already expired. Every rejection carries the same sentence, so a caller guessing at tokens
learns nothing about which guess was closer.

**Rotation and reuse detection.** Each refresh revokes the token it consumed and issues a
new one, so a stolen copy is good only until the real client next renews. Presenting an
already-revoked token is either a replay or a theft, and the two cannot be told apart —
so **every refresh token the user holds is revoked** and the next request has to sign in.

The consequence worth knowing when writing a client: **refreshes must not be concurrent.**
Two parallel refreshes with the same token trip reuse detection and end the session. The
web client shares one in-flight refresh between all callers for exactly this reason
([`src/auth/session.js`](../src/auth/session.js)).

Storage: `models.RefreshToken` holds a SHA-256 of the token, never the token itself, with
a 60-day expiry (`auth.RefreshTokenTTL`). Expired rows for a user are swept whenever that
user is issued a new session.

#### `POST /api/logout`

Request: same shape as refresh.

| Status | Body | When |
| :----- | :--- | :--- |
| `204` | *(empty)* | Always — including for an unknown, malformed, or absent token. |

Deliberately quiet. There is nothing a caller could do with the difference between "revoked"
and "was not there", and the client's next step — clear local state — is the same either
way, including when it is offline and this request never arrives.

Note that this revokes the *refresh* token only. Any access token already issued stays valid
until its `exp`, at most 24 hours later; that is inherent to stateless tokens, not an
oversight, and it is the trade named at the top of §2.

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
  { "ID": 3, "name": "Alex", "cadence_days": 90, "snapshot_count": 4, "mention_count": 12, "latest_date": "2026-03-01T00:00:00Z" },
  { "ID": 5, "name": "Sam",  "cadence_days": null, "snapshot_count": 1, "mention_count": 0, "latest_date": null }
]
```

- `snapshot_count` and `latest_date` count only **live** snapshots — the soft-delete filter
  sits in the JOIN condition, so a relationship whose snapshots were all deleted still
  appears, honestly reporting `0` and `null`. Hiding it would make it impossible to delete.
- `mention_count` (added in Phase 6) is how many journal mentions of this person sit on
  entries the journal **shows** — not soft-deleted, not superseded. It exists so
  [`DELETE /api/relationships/:id`](#delete-apirelationshipsid)'s confirmation dialog can say
  what will happen *before* it happens, and it is scoped identically to the
  `mentions_detached` that call returns afterwards, so the promise and the outcome are the
  same number. `0` for a person the journal has never named, which is every person on a
  pre-Phase-6 account.
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
**every journal mention of the source moves too**; then the source is soft-deleted.

The mentions need no `Unscoped()` of their own — a `JournalMention` has no soft delete, so
the one `UPDATE` already covers the mentions of soft-deleted *entries*, which is the same
reach and the same reason as the snapshots. A mention left pointing at a retired relationship
is the stranded row this endpoint exists to prevent.

| Status | Body |
| :----- | :--- |
| `200` | The target's relationship summary, with the combined `snapshot_count`, plus `mentions_moved`: `{"ID":2,"name":"Lucie M","cadence_days":null,"snapshot_count":5,"latest_date":null,"mentions_moved":3}`. The summary fields are flat, not nested, so a client that ignores the new field is unaffected. |
| `400` | `{"error":"source_id is required"}` or `{"error":"cannot merge a relationship into itself"}` |
| `404` | `{"error":"Relationship not found"}` — **either** side unknown or not owned, so a merge cannot reach across users. |
| `500` | `{"error":"Failed to merge relationships"}` |

**One-way.** Nothing records which snapshots came from where, which is why the UI states
plainly what will move before asking for confirmation.

### `DELETE /api/relationships/:id`

Deletes the whole history — distinct from `DELETE /api/subjects/:id`, which deletes one
version. Both are soft deletes, so a database backup is still the real undo.

**Journal mentions are counted and then left exactly as they are.** Deleting a person does
not rewrite the user's own record of a day: the entries stay, each mention keeps its row and
its `label` — the name as it was said, which is a quotation and still reads correctly — and
`relationship_id` is left in place, because the relationship it names is soft-deleted so every
join through it drops out on its own. `mentions_detached` exists so the confirmation dialog
can say what will happen before it happens, and it does: the dialog reads `mention_count` off
[`GET /api/relationships`](#get-apirelationships) when it opens and says *"12 journal mentions
of them stay: the entries are still there, and will no longer be linked to a person."* — left
out entirely at zero rather than rendered as "0 journal mentions".

**Both numbers cover the entries the journal shows** — neither soft-deleted nor superseded.
That scope is the point: `mention_count` is read before the delete and `mentions_detached`
returned after it, and if they counted different sets the dialog would promise one number and
the account would change by another. It is also why this count is *not* simply
`SELECT COUNT(*) FROM journal_mentions WHERE relationship_id = ?`, which is what it was
before 2026-08-22 and which over-reported for anyone who had ever corrected an entry.

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"Relationship deleted","snapshots_deleted":4,"mentions_detached":12}` |
| `404` | `{"error":"Relationship not found"}` |
| `500` | `{"error":"Failed to delete relationship"}` |


---

## 5a. Journal endpoints

The emotional journal — check-ins, the nightly ritual, facts about a person, and the trigger
vocabulary — all in one append-only table
([Phase 6 design §7](../product_vision/06-emotional-journal.md)). One write path, two reads,
a delete, and one action that removes a person from the journal without touching them
anywhere else.

Four conventions are specific to this section:

- **There is deliberately no `PUT`.** A journal row is a statement made at a moment, and
  changing it is a new statement. A correction is a `POST` carrying `supersedes_id`, which
  stamps `superseded_at` on the row it replaces in the same transaction. Readers filter on
  that one column instead of walking a chain.
- **A retry is not an error.** The same `client_id` twice answers `200` with the row already
  stored — not `201`, not `409` — which is what lets an offline queue resend blindly.
- **Unknown payload keys are kept.** Only the keys this server knows are validated; anything
  a newer client writes is stored and echoed untouched. Dropping one silently would be the
  same class of bug as a `PUT` that erases a description it was not sent.
- **The trigger vocabulary has no endpoint of its own, and is not going to get one.**
  `GET /api/journal/entries?kind=trigger` lists it; **a rename and a merge are corrections,
  not verbs.** A rename is a `POST /api/journal/entries` of `kind: "trigger"` carrying
  `supersedes_id` and the new `label`; a merge is the same `POST` with `merged_into` in its
  payload naming the surviving trigger's `client_id`. After a merge every reader resolves the
  old id to the survivor, and it is **one-way** — nothing stored knows which of the merged
  entries had belonged to which trigger, so there is no undo to build and the dialog says so.
  Both carry `corrects`: every `client_id` this trigger has been referenced by before, so a
  check-in written before the correction still resolves ([§6.3](../product_vision/06-emotional-journal.md)).
  Giving the vocabulary its own verbs would be a second way to write history that the export,
  the import and every reader would each have to learn.

### `POST /api/journal/entries`

Creates one entry, its mentions, and any trigger it invents — in a single transaction that
either commits whole or writes nothing.

Request ([`CreateJournalEntryInput`](../backend/internal/handlers/journal.go)):

```json
{ "client_id": "6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1", "kind": "checkin",
  "at": "2026-08-21T18:42:10+02:00", "day": "2026-08-21", "schema_version": 1,
  "payload": {
    "v": 1, "source": "voice", "tz_offset_min": 120,
    "transcript": "I had a nice day with Lucie today, even though work was stressful.",
    "feelings": [
      { "id": "rapport", "intensity": 3, "uncertain": false, "about": [{ "kind": "person", "ref": 0 }] },
      { "id": "stress",  "intensity": 2, "uncertain": false, "about": [{ "kind": "trigger", "trigger": "0b7e0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] }
    ],
    "tags": []
  },
  "mentions": [{ "ref": 0, "name": "Lucie", "label": "Lucie" }],
  "triggers": [{ "trigger": "0b7e0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  "supersedes_id": null }
```

| Field | Rules |
| :---- | :---- |
| `client_id` | **Required**, UUID shape (`8-4-4-4-12` hex). Minted by the client before the first write. Unique **per user**, not globally: two people's queues may mint the same uuid and neither is told. |
| `kind` | **Required**, one of `checkin`, `ritual`, `person_fact`, `trigger` (`domain.JournalKinds`). There is no default — an entry that does not say what it is cannot be read back. |
| `at` | **Required**, RFC 3339 **with an offset**; stored UTC. More than 24 h in the future is rejected. The offset the client was in belongs in the payload (`tz_offset_min`), not the row. |
| `day` | **Required**, `YYYY-MM-DD` strictly — the local civil day with the rollover hour applied, so an entry made at 02:00 belongs to the day before. Must sit within 36 h of `at`, measured from the **day's midpoint**: a rollover hour plus a time zone, not a typo. |
| `schema_version` | Optional; `1`, or omitted (which means 1). Anything else is rejected rather than stored unvalidated. |
| `payload` | **Required**, validated per kind (below). Unknown keys are kept. |
| `mentions[]` | Each carries `ref` (its position, which a feeling's `about` points at), a `label` (the name as it was said, ≤ 40 characters), and **exactly one** of `relationship_id` or `name`. |
| `mentions[].relationship_id` | Must be the caller's, else `404` for the whole request and nothing is written. |
| `mentions[].name` | Trimmed, non-blank; resolved through `database.FindOrCreateRelationship` **inside the transaction** — the same function the snapshot path and the backfill use, so a check-in and a snapshot naming one person land on one relationship. The echoed row carries the resolved id, and the `label` defaults to the resolved name. |
| `triggers[]` | Each is either `{"trigger": "<client_id>"}`, naming one of the caller's **live** (neither deleted nor superseded) `kind: "trigger"` entries — else `404` for the whole request — or `{"label": "…", "client_id": "…"}`, a new trigger created as its own entry **before** the one referencing it. Minting is find-or-create: naming the same new trigger twice creates it once. |
| `supersedes_id` | Optional. The entry this one corrects. Must be the caller's (`404`) and not already superseded (`409`); it is stamped with this entry's own `at`, so the pair reads consistently in an export. |

**Payload rules by kind** ([design §6.5](../product_vision/06-emotional-journal.md)). Every
payload needs `"v": 1`.

**Only the keys named below are validated; everything else in a payload travels through
untouched** — `decodePayload` reads the struct's keys and stores the map as it arrived, because
a newer client may write a field this server has never heard of and dropping it silently would
be the description-wipe mistake in a new form. That is what lets the client add provenance
without a server change: `proposal` (§6.3, session D2) and, since G2, **`retrieval`** — the
`from: "retrieval"` block recording what the on-device embedding index offered and what the
user kept. Neither is input to anything: the server validates ids, not opinions.

| `kind` | Validated |
| :----- | :-------- |
| `checkin` | ≤ 5 `feelings`, each `id` a known feeling; `intensity`, **when present**, is 1–3 — an absent one is not a zero, and the ritual's day word (`source: "ritual_word"`) is one tap on one word with no strength in it to record; every `about` is `person` (whose `ref` must index a mention), `tag` (≤ 40 characters) or `trigger` (whose id must appear in `triggers[]`); `tags` under the snapshot tag limits and stored trimmed; `transcript` ≤ 4 000 characters; `proposal.proposed` / `proposal.accepted` are known feeling ids. |
| `ritual` | Every key of `answers` and every entry of `question_set.asked` is a known question id, and every answer is a boolean; `day_word.id` is a known feeling. **A skipped question is absent from `answers`** — never `false` — and its absence is never an error. |
| `person_fact` | Exactly one mention; `text` ≤ 120 characters. |
| `trigger` | `label` trimmed, non-blank, ≤ 40 characters, and stored trimmed; `merged_into`, if present, names one of the caller's live triggers and not this one. |

| Status | Body |
| :----- | :--- |
| `201` | The created row: `ID`, `CreatedAt`, the stored payload, and every mention with its resolved `relationship_id`. |
| `200` | This `client_id` is already stored for this user; body is that row, mentions and all. Nothing else happens. |
| `400` | `{"error":"…"}` naming the field — `unknown feeling id: bliss`, `unknown ritual question: hydrated`, `day must be within 36 hours of at`, `mention 1 needs relationship_id or name`, `feelings[0].intensity must be between 1 and 3`, `unlisted trigger: <id>`, `person_fact needs exactly one mention`, `client_id must be a UUID`, `payload.v must be 1`, `unknown trigger in merged_into: <id>`. Mentions and triggers are numbered from zero, the way `about.ref` addresses them. |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | A `relationship_id`, a `supersedes_id`, or a referenced trigger that is not the caller's. Nothing is written. |
| `409` | `supersedes_id` is already superseded, or the `client_id` is held by a **soft-deleted** entry — a retry after a delete conflicts rather than resurrecting the row. |
| `500` | `{"error":"Failed to create journal entry"}` |

**Everything or nothing.** The order inside the transaction is fixed by what depends on
what: the idempotency lookup first, so a retry costs one query; the correction next, so a
request that cannot be linked writes nothing; the triggers before the entry that references
them; the mentions with the entry itself, in one `Create`, so there is no window in which an
entry exists unmentioned.

---

### `GET /api/journal/entries`

Every entry that is **current** — not deleted, not superseded — in a day range, with its
mentions.

| Parameter | Rules |
| :-------- | :---- |
| `from`, `to` | `YYYY-MM-DD` strictly, both ends **inclusive**. Malformed is `400 {"error":"invalid from, expected YYYY-MM-DD"}`. Omit either and the window defaults to the last **31 days**: `to` becomes today (the server's UTC day) and `from` becomes 30 days before `to`. Since `day` is a civil day the *client* chose, a caller that cares which days it gets sends both — every screen does. |
| `kind` | Optional, one of `checkin`, `ritual`, `person_fact`, `trigger`. Anything else is `400 {"error":"unknown kind: <k>"}`. **`?kind=trigger` is the trigger vocabulary** — there is no separate endpoint for it. |
| `relationship_id` | Optional, numeric or `400 {"error":"relationship_id must be a number"}`. Filters to entries carrying a mention of that person. It is a filter, not an ownership assertion: another user's id matches nothing and returns `[]`, because the query is already scoped to the caller. An entry naming one person twice is still **one** row — the filter is a subquery, not a join. |

Ordered `day ASC, at ASC, id ASC`. The `id` tiebreaker is load-bearing: without it two entries
stamped the same instant swap places between refreshes and the day graph redraws itself
differently each time.

The range comparison is a **string** comparison, which is the whole reason `day` is a
`varchar(10)`: lexical order on `YYYY-MM-DD` is chronological order, on both engines, with no
aggregate to mistype ([trap 10a](10-agent-guide.md#3-traps-that-fail-silently)).

`superseded_at IS NULL` is applied always and is not configurable. A correction stamped the
row it replaced at write time precisely so that a reader never has to walk a chain to find
out what is current. The superseded row is still stored, and the export carries it.

| Status | Body |
| :----- | :--- |
| `200` | An array of entries, each with its `mentions` preloaded. `[]` when nothing matches. |
| `400` | `{"error":"…"}` — a malformed `from`/`to`, an unknown `kind`, a non-numeric `relationship_id`. |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to fetch journal entries"}` |

### `DELETE /api/journal/entries/:id`

Soft delete (`deleted_at` is set), scoped to the caller — the same shape as
[`DELETE /api/subjects/:id`](#delete-apisubjectsid).

| Status | Body |
| :----- | :--- |
| `200` | `{"message":"Journal entry deleted"}` |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | `{"error":"Journal entry not found"}` — nothing matched: unknown id, already deleted, or somebody else's. |
| `500` | `{"error":"Failed to delete journal entry"}` |

The handler reads `RowsAffected`, so a `200` genuinely means one row went away and deleting
the same id twice returns `200` then `404`.

**The mentions stay.** They carry no soft delete of their own because they have no life of
their own; every read that counts them joins through the entry, so a deleted entry's mentions
stop counting without any row being destroyed — and restoring the entry restores them intact.
The `client_id` stays reserved too, which is why a retried `POST` after a delete is `409`
rather than a resurrection.

### `GET /api/journal/days`

One row per day that has something on it, for the month view: enough to draw which days are
occupied without fetching the days themselves.

`from` and `to` behave exactly as they do on `GET /api/journal/entries`, including the 31-day
default.

```json
[ { "day": "2026-08-20", "checkins": 2, "ritual": false, "people": 2 },
  { "day": "2026-08-21", "checkins": 1, "ritual": true,  "people": 0 } ]
```

| Field | Meaning |
| :---- | :------ |
| `day` | `YYYY-MM-DD`. Days with nothing on them are absent from the array rather than present as zeroes. |
| `checkins` | Entries of `kind: "checkin"` that day. A ritual is not a check-in and is not counted here. |
| `ritual` | Whether the ritual was done — a **boolean**, deliberately not a count. The question the month view asks is whether it happened; a number would invite a reader to draw "how many", and this app keeps no such scoreboard. |
| `people` | **Distinct relationships** named that day, not the number of mentions. Two entries both naming Lucie are one person. |

Deleted and superseded entries are excluded, exactly as on the entries endpoint.

One grouped query, `GROUP BY day` over a `varchar(10)` — a string operation that behaves
identically on SQLite and Postgres. The join to mentions makes an entry appear once per person
it names, so the per-kind counts are `COUNT(DISTINCT id)` rather than `COUNT(*)`: without that,
an entry naming two people would count as two check-ins.

| Status | Body |
| :----- | :--- |
| `200` | An array of day rows, ordered by `day`. `[]` for a range with nothing in it. |
| `400` | `{"error":"invalid from, expected YYYY-MM-DD"}` |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to fetch journal days"}` |

### `DELETE /api/journal/people/:id`

Everything the journal holds **about** one person, removed in one action — the button
[§10.6](../product_vision/06-emotional-journal.md) requires on the People detail screen. `:id`
is a `relationship_id`.

Two things happen inside one transaction:

1. Every `person_fact` entry of the caller's that names them is **soft-deleted**. A fact *is*
   a statement about that person; there is nothing left of it once the person is taken out.
2. Every mention of them on the caller's entries is **detached** — `relationship_id` becomes
   `NULL` and `label` is untouched.

```json
{ "message": "Person removed from the journal", "facts_deleted": 2, "mentions_detached": 3 }
```

| Field | Meaning |
| :---- | :------ |
| `facts_deleted` | `person_fact` entries that went. |
| `mentions_detached` | Mentions on entries that **stayed** — check-ins and rituals. Disjoint from `facts_deleted`: a deleted fact's own mention is detached too but is in neither number, so the dialog can state both without counting anything twice. |

**What is acted on and what is counted are two different sets.** The action covers superseded
rows too: they are still statements about this person, and they are still in the export, so a
superseded fact is soft-deleted and a superseded mention is detached like any other. The two
*counts*, though, cover only the entries the journal **shows** — not deleted, not superseded —
because those are the numbers the dialog stated before acting, and it got them by counting
what `GET /api/journal/entries` returned. Before 2026-08-22 the counts included superseded
rows, so a user who had ever corrected an entry was told two facts would go and then saw four.

| Status | Body |
| :----- | :--- |
| `200` | The body above. Both counts are what *happened*, so running it twice reports zeroes the second time rather than repeating itself. |
| `401` | `{"error":"User ID not found in context"}` |
| `404` | `{"error":"Relationship not found"}` — unknown, deleted, non-numeric, or somebody else's. Never `403`. |
| `500` | `{"error":"Failed to remove this person from the journal"}` |

**The check-ins survive, and so does each mention's `label`.** A check-in is the user's own
record of a day, and removing a third party from the journal must not rewrite it — the same
rule [`DELETE /api/relationships/:id`](#delete-apirelationshipsid) follows for its own
mentions. What is left is the name as it was said that day: a quotation, and never enough to
recreate the person.

**This is not a relationship delete.** The relationship, its snapshots and its cadence are
untouched; the two actions live on different screens with different dialogs, and neither
implies the other.

---

## 6. Vault endpoints

Export, import, and the counts behind the Vault page. Everything here is scoped to the
caller; there is no cross-user anything.

### `GET /api/export`

One JSON document containing everything the signed-in user has.

```json
{
  "format": "alq-export",
  "version": 2,
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
  ],
  "journal": {
    "entries": [
      { "client_id": "0b7e5d4c-1a2b-4c3d-8e9f-000000000001", "kind": "trigger",
        "day": "2026-08-19", "at": "2026-08-19T09:00:00Z", "schema_version": 1,
        "payload": { "v": 1, "label": "deadline", "merged_into": null } },
      { "client_id": "6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1", "kind": "checkin",
        "day": "2026-08-21", "at": "2026-08-21T16:42:10Z", "schema_version": 1,
        "payload": { "v": 1, "source": "typed", "tz_offset_min": 120,
                     "transcript": "A long day, and Lucie made it better.",
                     "tags": ["work"],
                     "feelings": [
                       { "id": "rapport", "intensity": 3, "uncertain": false,
                         "about": [{ "kind": "person", "ref": 0 }] },
                       { "id": "stress", "intensity": 2, "uncertain": true,
                         "about": [{ "kind": "trigger",
                                     "trigger": "0b7e5d4c-1a2b-4c3d-8e9f-000000000001" }] }
                     ] },
        "mentions": [{ "relationship": "Lucie", "ref": 0, "label": "Lucie" }],
        "superseded_at": "2026-08-21T17:05:00Z" },
      { "client_id": "6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d2", "kind": "checkin",
        "day": "2026-08-21", "at": "2026-08-21T17:05:00Z", "schema_version": 1,
        "payload": { "v": 1, "source": "chips", "feelings": [] },
        "supersedes": "6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1" }
    ]
  }
}
```

**Version 2** added the `journal` block; version 1 documents have no such key and are still
importable. The journal is the whole record, not the current view of it:

- **Every kind**, including `trigger` rows. A check-in's `about` names a trigger by the
  trigger's own `client_id`, which is stable across export and import, so triggers need no
  name-based resolution on the way back in.
- **Superseded rows, with their link.** `superseded_at` is the instant a correction replaced
  the row; `supersedes` is the *client id* of the row this one replaced, because a row id
  would be the one thing this document does not carry. A reader that wants only what is
  current filters `superseded_at` exactly the way `GET /api/journal/entries` does.
- **Mentions reference the relationship by name**, consistent with the rest of the document.
  `relationship` is **absent** when the mention points at someone the user has since deleted;
  `label` — the name as it was said that day — stays, and the import does not bring the
  person back.
- Entries are ordered `day`, then `at`, then insertion, so two exports of one database are
  byte-identical apart from `exported_at`.

What is **deliberately absent**:

- **The password hash.** `ExportUser` has no such field at all — an omitted `json` tag could
  be added back by accident, a missing field cannot. A test asserts on the raw payload bytes.
- **Internal ids.** A snapshot's identity in this format is its relationship plus its date,
  which is what makes re-import idempotent without carrying database keys around.
- **Soft-deleted rows**, via GORM's default scope: an export is what you have, not what you
  once had.
- **The denormalized snapshot name** — the relationship above it carries the name.
- **Avatar image bytes.** Unsupported; `profile_picture` is a path, and the file is not
  included.
- **Row ids in the journal too.** An entry travels as its `client_id`, a mention as a name,
  and a correction as the `client_id` it replaced — `id`, `entry_id`, `relationship_id` and
  `supersedes_id` appear nowhere in the block.

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

Accepts the same document, version 1 or version 2. `?dry_run=true` reports what *would*
happen and writes nothing.

```json
{ "dry_run": false, "relationships_created": 2, "snapshots_created": 31, "snapshots_skipped": 16,
  "journal_entries_created": 128, "journal_entries_skipped": 0 }
```

Rules, in the order they matter:

1. **`format` and `version` are checked first.** The version must be between 1 and 2
   inclusive; anything else is `400` — this endpoint will not guess at a file it does not
   recognise. A version 1 file carrying a `journal` block is `400` as well: it describes
   itself wrongly, and neither reading the block nor dropping it silently would be honest.
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

And for the journal block, where the rules differ because the data does:

7. **Duplicate detection is the `client_id`, not the content.** A journal entry has a stable
   identity a snapshot lacks, so the check is exact rather than a resemblance test and a
   re-import is a true no-op. The lookup ignores the soft-delete scope: a deleted row still
   holds its `(user_id, client_id)` slot, so re-importing a file does **not** resurrect an
   entry the user deleted — the same answer `POST /api/journal/entries` gives a retried
   write.
8. **Mentions resolve by name** through the same find-or-create as everything else, so an
   entry naming someone the user already has lands on their existing stack. A mention with
   **no** `relationship` is written detached, keeping its `label`: the file is saying that
   person was already deleted, and inventing them again would contradict it.
9. **Order in the file does not matter.** A check-in points at a trigger by client id inside
   its payload, which is opaque to SQL, so nothing needs the trigger row written first;
   `supersedes` is resolved in a second pass over the client ids the import can see, which
   is order-independent too. A `supersedes` naming a row that is neither in the file nor
   already stored is left unlinked rather than refused — the row it corrected was deleted
   before the export was taken, and the correction still stands on its own.
10. **A trigger a check-in names must be in the file.** An export always carries it, so a
    miss means the file was edited or truncated: `400`, naming the id, with nothing written.
    The same applies to a merge's `merged_into`.
11. **The same validators the write path runs.** Kind, day-against-`at`, `schema_version`,
    and the per-kind payload rules of [§5a](#5a-journal-endpoints). An import is not a
    validation bypass here either.

| Status | Body |
| :----- | :--- |
| `200` | The counts above. |
| `400` | `{"error":"unrecognized format …"}`, `{"error":"unsupported export version …"}`, `{"error":"version 1 has no journal block, but this file has one"}`, `{"error":"every relationship needs a name"}`, `{"error":"relationship \"X\" appears twice in the file"}`, `{"error":"journal entry 4 names a trigger this file does not contain: 0b7e…"}`, or any `POST /api/subjects` or `POST /api/journal/entries` validation message prefixed with its position. |
| `401` | `{"error":"User ID not found in context"}` |
| `500` | `{"error":"Failed to import"}` |

### The CSV export

Not an endpoint. The spreadsheet form is built in the browser from data it already has, plus
one call to `GET /api/export` for the journal half, and saved with a blob download —
`src/components/Vault.jsx`. It is **two files**, delivered as two downloads from the one
button, because the two sheets have different columns and no one sheet can hold both:

| File | Grain | Columns |
| :--- | :---- | :------ |
| `alq-export-YYYY-MM-DD.csv` | one row per snapshot | `relationship, date, kind`, one per category, `uncertain, tags, note` |
| `alq-journal-YYYY-MM-DD.csv` | one row per feeling per check-in | `day, at, source, feeling, intensity, uncertain, about_kind, about, tags` |

The journal sheet is written only when there is at least one feeling to write, so an empty
journal produces one file rather than an empty second one. Superseded check-ins are left out,
matching `GET /api/journal/entries`; `about` resolves a person to their label and a trigger
to its word, reading superseded trigger rows too so a renamed trigger still resolves. A
feeling with more than one `about` keeps one row, with both columns space-joined.

**The transcript is deliberately not a column.** The JSON export carries what was said; the
spreadsheet is the form of this data most likely to be opened on a shared screen.

### `GET /api/meta`

Counts for the Vault page. No configuration detail: no DSN, no file paths, no secrets.

```json
{ "db_backend": "sqlite", "relationship_count": 3, "snapshot_count": 47,
  "oldest_snapshot_date": "2025-03-04T00:00:00Z",
  "journal_entry_count": 128, "oldest_journal_day": "2026-07-02" }
```

`db_backend` is GORM's dialector name (`sqlite` or `postgres`); the frontend turns it into a
sentence. `oldest_snapshot_date` is `MIN(date)` scoped to the caller and is `null` when
nothing is dated — it uses the same `aggregateTime` scanner as `latest_date`, for the same
engine-typing reason.

`journal_entry_count` counts every journal row still stored, **superseded ones included**: a
correction does not remove the statement it replaces, the export carries both, and this number
answers "how much of my data is here", not "how many entries are current". Soft-deleted rows
do not count.

`oldest_journal_day` is `MIN(day)`, and it is the one aggregate here that needs **no**
`aggregateTime`: `day` is a `varchar(10)`, so `MIN()` over it is a plain string on both
engines and there is nothing for the aggregate to mistype. That is the payoff of storing the
civil day as text ([trap 10a](10-agent-guide.md#3-traps-that-fail-silently)). It is `null`
when the journal is empty.

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
([Known Issues](11-known-issues.md#uploaded-files-are-publicly-readable)).

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
