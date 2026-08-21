# 13 — Zero-Knowledge Envelope Encryption

A blueprint for moving this app from server-readable storage to client-side envelope
encryption (KEK/DEK), such that an administrator with `psql` and root on the host cannot
read or deduce a user's relationship data.

Status: **design, not yet implemented.** Written against the code as of `feature/encryption`.

Companion reading: [03-data-model.md](03-data-model.md), [05-backend.md](05-backend.md),
[11-known-issues.md](11-known-issues.md).

---

## 0. What is actually secret here

Before the crypto, the inventory. These are the columns that carry meaning about a human
being, and they are all plaintext today:

| Table | Column | Why it is sensitive |
|---|---|---|
| `users` | `name`, `age`, `mbti_type`, `profile_picture` | identifies the account holder |
| `relationships` | `name` | **names a third party who never consented to being in your database** |
| `relationships` | `cadence_days` | reveals attention/intensity |
| `analysis_subjects` | `name` | denormalized copy of the above |
| `analysis_subjects` | `description` | free-text notes — the highest-sensitivity field in the app |
| `analysis_subjects` | `stats` | the seven category scores |
| `analysis_subjects` | `tags`, `uncertain`, `guide_answers` | context and self-assessment |
| `analysis_subjects` | `date`, `kind` | temporal pattern of attention |

`email` stays plaintext: it is the login identifier and the server must index it. `created_at`,
`updated_at`, `deleted_at`, `user_id` and row counts stay plaintext — they are structural.

**The residual metadata leak, stated up front.** After this change an administrator still
learns: how many people you track, how many snapshots each has, when each row was written and
last edited, and — via the blind index in §1.4 — *that* two snapshots concern the same person,
without learning who. That is the irreducible cost of keeping the app's existing stack/rename/
merge behaviour. If that leak is unacceptable, the app has to stop modelling relationships as
server-side rows, which is a different product.

`AppLock` ([src/components/AppLock.jsx](../src/components/AppLock.jsx)) is honest that it is
"a curtain, not a safe". This document is the safe. AppLock stays as a separate,
complementary screen lock.

---

# Section 1 — Target cryptographic & schema architecture

## 1.1 Key hierarchy

```
password ──Argon2id(salt, m=64MiB, t=3, p=1)──> masterSecret (32B)
                                                     │
                        ┌────────────────────────────┴────────────────────────────┐
              HKDF-SHA256(info="alq:kek:v1")                HKDF-SHA256(info="alq:auth-verifier:v1")
                        │                                                          │
                       KEK (AES-256-GCM)                                   authVerifier (32B)
                        │                                                          │
                        │                                          sent to server; stored as bcrypt(verifier)
                        │                                          server never sees the password
            AES-256-GCM wrap
                        │
                        ▼
                 wrapped_dek  ──stored in users──┐
                                                 │
     DEK (32 random bytes) ──────────────────────┤
        │                                        │
        │                            recovery_wrapped_dek ──stored in users──┐
        │                                        ▲                           │
        │                          AES-256-GCM wrap                          │
        │                                        │                           │
        │                          recoveryKEK ──HKDF(info="alq:recovery-kek:v1")
        │                                        ▲
        │                              entropy (32 random bytes)
        │                                        │
        │                              BIP-39 ──> 24-word mnemonic (shown once, never stored)
        │
        ├── HKDF(info="alq:blind:name:v1") ──> nameHmacKey (HMAC-SHA256) ── blind index
        └── AES-256-GCM ──> every row blob
```

Four properties are doing the work:

1. **The DEK is generated once and never changes.** Everything else wraps it. This is why a
   password change is O(1) rather than O(rows) — see §1.6.
2. **The KEK and the auth verifier are siblings, not parent and child.** The verifier is a
   sibling HKDF branch, so possessing the verifier (which the server has) gives no path back to
   the KEK. Deriving the verifier *from* the KEK would hand the server the wrapping key.
3. **The recovery mnemonic wraps the same DEK independently.** Losing the password does not
   invalidate the recovery phrase, and changing the password does not require re-issuing it.
4. **The DEK never leaves the client.** Not at signup, not during migration, not during
   password change.

### Why these primitives

| Need | Choice | Why not the alternative |
|---|---|---|
| KDF | Argon2id via [`hash-wasm`](https://github.com/Daninet/hash-wasm) | Web Crypto has no Argon2. PBKDF2 (which Web Crypto does have) is GPU-friendly and a poor fit for a phone-typed password. `hash-wasm` is ~20 KB of WASM and has no native dependency, which matters inside a Capacitor WebView. |
| AEAD | AES-256-GCM via Web Crypto | Native, hardware-accelerated on ARMv8 (every Android target), no bundle cost. ChaCha20-Poly1305 would need libsodium.js (~200 KB WASM) and is only faster on hardware without AES-NI/ARMv8-Crypto, which this app does not target. |
| Key wrap | AES-256-GCM (not AES-KW) | AES-KW is deterministic and has no AAD. GCM lets the wrap be bound to the salt and key version (§1.3), which detects an admin swapping one user's `wrapped_dek` for another's. |
| Recovery | [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) | Audited, 3 KB, no Buffer/Node shims — the reason to prefer it over `bip39` inside a WebView. |
| Blind index | HMAC-SHA256 via Web Crypto | Keyed, so it is not dictionary-attackable the way a bare hash of a first name would be. |

> **Do not use BIP-39's `mnemonicToSeed`.** It runs PBKDF2-HMAC-SHA512 at 2048 iterations, which
> is stretching designed for user-chosen passphrases. Our mnemonic already carries 256 bits of
> machine-generated entropy, so stretching adds latency and no security. Use
> `mnemonicToEntropy` and HKDF the raw entropy. See §2.4.

### Argon2id parameters

Start at **m=64 MiB, t=3, p=1, 32-byte output, 16-byte random salt** — comfortably above the
OWASP floor (m=19 MiB, t=2, p=1).

The parameters are stored **per user, in the database**, not as a constant. Two reasons: you can
raise them for new users without breaking old ones, and you can lower them for a user whose
low-end Android device takes an unacceptable time. Budget ~0.5 s on a desktop and 1–3 s on a
mid-range phone; measure on the oldest device you intend to support before committing to 64 MiB.

## 1.2 Envelope format

One self-describing binary layout everywhere — wrapped DEKs and row payloads alike:

```
┌─────────┬──────────────┬───────────────────────┬─────────────┐
│ version │      IV      │      ciphertext       │  GCM tag    │
│  1 byte │   12 bytes   │       variable        │  16 bytes   │
└─────────┴──────────────┴───────────────────────┴─────────────┘
```

Web Crypto appends the tag to the ciphertext automatically, so the last two fields are one
buffer in code. The version byte is what lets you introduce a new cipher later without
guessing at the format of existing rows.

Stored as `BYTEA`. Not base64 text: base64 costs 33 % of the table size, and Go's
`encoding/json` already marshals `[]byte` to a base64 string on the wire, so you get the
JSON-safe representation for free at the API boundary and pay nothing at rest. Under the SQLite
fallback `BYTEA` becomes `BLOB`; GORM handles both from a plain `[]byte` field.

### AAD binding

Every AEAD operation is bound to associated data, so a blob is only valid in the exact slot it
was written to. Without this, an administrator can copy row 7's blob over row 8 — the client
decrypts it happily and shows the wrong data as authentic.

| Blob | AAD |
|---|---|
| `users.wrapped_dek` | `alq:v1:dek:<base64(kdf_salt)>:<key_version>` |
| `users.recovery_wrapped_dek` | `alq:v1:rdek:<base64(kdf_salt)>:<key_version>` |
| `users.profile_blob` | `alq:v1:profile:<client_id>` |
| `relationships.blob` | `alq:v1:relationship:<client_id>` |
| `analysis_subjects.blob` | `alq:v1:subject:<client_id>` |

Note what is **not** in the AAD: the server-assigned `id`. It does not exist until after the
`INSERT`, so it cannot be an input to encryption that happens before it. That is why every
encrypted row gains a **client-generated `client_id` UUID** — a stable identity the client knows
at encrypt time. It pays for itself twice, since it also makes the migration batches in §3
idempotent under retry.

The DEK wrap is bound to the salt rather than to `user_id` for the same reason: at signup the
client does not yet know its `user_id`, and the salt is client-generated, unique, and already
being sent.

## 1.3 Schema changes (DDL)

The server runs `AutoMigrate` on boot ([database.go:60](../backend/internal/database/database.go#L60)),
which handles additive columns. It does **not** drop columns, and you would not want it to
mid-migration. So: additive DDL is expressed as model changes and let `AutoMigrate` apply it;
the destructive step in Phase 3 is explicit SQL you run deliberately.

Both forms are given below because you need the raw SQL anyway for staging rehearsal and for
the `-check` path in `cmd/migrate`.

### Phase 1 DDL — additive, backward compatible

```sql
BEGIN;

-- ── users ────────────────────────────────────────────────────────────────────
-- KDF parameters are per-user so they can be tuned per device class and raised
-- over time without invalidating existing accounts.
ALTER TABLE users ADD COLUMN kdf_algo         TEXT    NOT NULL DEFAULT 'argon2id';
ALTER TABLE users ADD COLUMN kdf_salt         BYTEA;
ALTER TABLE users ADD COLUMN kdf_mem_kib      INTEGER NOT NULL DEFAULT 65536;
ALTER TABLE users ADD COLUMN kdf_iterations   INTEGER NOT NULL DEFAULT 3;
ALTER TABLE users ADD COLUMN kdf_parallelism  INTEGER NOT NULL DEFAULT 1;

-- The envelope. wrapped_dek is the password path, recovery_wrapped_dek the mnemonic
-- path; both wrap the identical DEK.
ALTER TABLE users ADD COLUMN wrapped_dek           BYTEA;
ALTER TABLE users ADD COLUMN recovery_wrapped_dek  BYTEA;
ALTER TABLE users ADD COLUMN recovery_created_at   TIMESTAMPTZ;

-- key_version increments on every password change; it is in the DEK-wrap AAD, so a
-- replayed old wrapped_dek fails authentication instead of silently working.
ALTER TABLE users ADD COLUMN key_version  INTEGER NOT NULL DEFAULT 0;

-- token_epoch invalidates every outstanding JWT on password change or recovery.
ALTER TABLE users ADD COLUMN token_epoch  INTEGER NOT NULL DEFAULT 0;

-- 'legacy' -> 'migrating' -> 'encrypted'. Drives both the login flow and the
-- server's willingness to accept plaintext writes.
ALTER TABLE users ADD COLUMN encryption_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE users ADD CONSTRAINT users_encryption_status_check
    CHECK (encryption_status IN ('legacy', 'migrating', 'encrypted'));

-- An encrypted account must actually have the material to decrypt itself. This
-- constraint is what turns a botched migration into a failed transaction rather
-- than an unopenable account.
ALTER TABLE users ADD CONSTRAINT users_encrypted_requires_keys
    CHECK (encryption_status <> 'encrypted'
           OR (kdf_salt IS NOT NULL AND wrapped_dek IS NOT NULL));

ALTER TABLE users ADD COLUMN client_id    VARCHAR(36);
ALTER TABLE users ADD COLUMN profile_blob BYTEA;   -- {name, age, mbti_type, profile_picture}

-- ── relationships ────────────────────────────────────────────────────────────
ALTER TABLE relationships ADD COLUMN client_id    VARCHAR(36);
ALTER TABLE relationships ADD COLUMN blob         BYTEA;   -- {name, cadence_days}
ALTER TABLE relationships ADD COLUMN name_hmac    BYTEA;   -- blind index, see 1.4
ALTER TABLE relationships ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;

-- ── analysis_subjects ────────────────────────────────────────────────────────
ALTER TABLE analysis_subjects ADD COLUMN client_id      VARCHAR(36);
ALTER TABLE analysis_subjects ADD COLUMN blob           BYTEA;
ALTER TABLE analysis_subjects ADD COLUMN is_encrypted   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE analysis_subjects ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;

-- ── indexes ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_relationships_user_name_hmac
    ON relationships (user_id, name_hmac)
    WHERE deleted_at IS NULL AND name_hmac IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subjects_user_client_id
    ON analysis_subjects (user_id, client_id)
    WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_unmigrated
    ON analysis_subjects (user_id) WHERE is_encrypted = FALSE;

COMMIT;
```

> **On that partial unique index.** [models.go:22-24](../backend/internal/models/models.go#L22-L24)
> notes that relationship-name uniqueness was left to the handlers because "soft deletes would
> need a partial unique index, and those are spelled differently on SQLite and Postgres".
> The `CREATE UNIQUE INDEX ... WHERE` form above is in fact accepted by both (SQLite has
> supported partial indexes since 3.8.0, 2013). Keep the handler check as the source of the
> friendly 409 — it produces a much better error than a constraint violation — and treat the
> index as defence in depth against a racing double-insert.

### Phase 3 DDL — destructive, run only when no `legacy` or `migrating` user remains

```sql
BEGIN;

-- Refuse to proceed if anyone is unmigrated. A DO block is used because a bare
-- ALTER cannot express a precondition, and dropping these columns while a single
-- user still needs them destroys their data irrecoverably.
DO $$
DECLARE stragglers INTEGER;
BEGIN
    SELECT COUNT(*) INTO stragglers FROM users WHERE encryption_status <> 'encrypted';
    IF stragglers > 0 THEN
        RAISE EXCEPTION 'refusing to drop plaintext columns: % user(s) not yet encrypted', stragglers;
    END IF;
    SELECT COUNT(*) INTO stragglers FROM analysis_subjects WHERE is_encrypted = FALSE;
    IF stragglers > 0 THEN
        RAISE EXCEPTION 'refusing to drop plaintext columns: % snapshot(s) not yet encrypted', stragglers;
    END IF;
END $$;

ALTER TABLE analysis_subjects
    DROP COLUMN name,
    DROP COLUMN description,
    DROP COLUMN stats,
    DROP COLUMN tags,
    DROP COLUMN uncertain,
    DROP COLUMN guide_answers,
    DROP COLUMN date,
    DROP COLUMN kind;

ALTER TABLE relationships
    DROP COLUMN name,
    DROP COLUMN cadence_days;

ALTER TABLE users
    DROP COLUMN name,
    DROP COLUMN age,
    DROP COLUMN mbti_type,
    DROP COLUMN profile_picture;

ALTER TABLE analysis_subjects ALTER COLUMN blob SET NOT NULL;
ALTER TABLE relationships     ALTER COLUMN blob SET NOT NULL;

COMMIT;

-- DROP COLUMN only marks the column dropped in the catalogue. The bytes stay in
-- the heap until every tuple is rewritten. Until this finishes, `psql` cannot see
-- the plaintext but a forensic read of the data files still can.
VACUUM FULL analysis_subjects;
VACUUM FULL relationships;
VACUUM FULL users;
```

**This is the step people forget.** Nulling a column does not erase it. Three follow-ups are
mandatory, and none of them are optional-if-you-are-busy:

1. `VACUUM FULL` (or `pg_repack` if you cannot take the exclusive lock) to rewrite the heap.
2. **Destroy every database backup taken before this point.** They contain full plaintext. A
   zero-knowledge database with a nightly plaintext dump in object storage is not
   zero-knowledge; it is a plaintext database with an extra step.
3. WAL segments and any replica carry the old tuples too — rotate them.

Under the SQLite fallback the equivalent is `VACUUM;` on `alexithymia.db`, plus deleting the
`-wal` and `-shm` sidecars.

### Model changes

```go
// backend/internal/models/models.go

type User struct {
	gorm.Model
	Email string `gorm:"uniqueIndex;not null" json:"email"`

	// Password is the bcrypt of the *auth verifier* once the account is encrypted, and
	// the bcrypt of the raw password while it is still legacy. The column does not move
	// so that the legacy login path keeps working untouched during the migration window;
	// EncryptionStatus is what says which of the two it currently holds.
	Password string `gorm:"not null" json:"-"`

	ClientID string `gorm:"type:varchar(36)" json:"client_id"`

	KDFAlgo        string `gorm:"default:'argon2id'" json:"kdf_algo"`
	KDFSalt        []byte `json:"-"`
	KDFMemKiB      int    `gorm:"default:65536" json:"-"`
	KDFIterations  int    `gorm:"default:3" json:"-"`
	KDFParallelism int    `gorm:"default:1" json:"-"`

	// Marshalled to base64 by encoding/json automatically — no explicit encoding step.
	WrappedDEK         []byte     `json:"wrapped_dek,omitempty"`
	RecoveryWrappedDEK []byte     `json:"-"` // only ever returned by the recovery endpoint
	RecoveryCreatedAt  *time.Time `json:"recovery_created_at"`

	KeyVersion       int    `gorm:"default:0" json:"key_version"`
	TokenEpoch       int    `gorm:"default:0" json:"-"`
	EncryptionStatus string `gorm:"default:'legacy';index" json:"encryption_status"`

	ProfileBlob []byte `json:"profile_blob,omitempty"`

	// Legacy plaintext. Dropped in Phase 3; `json:"-"` from Phase 2 so a migrated
	// client cannot accidentally read a stale value.
	Name           string `json:"-"`
	Age            int    `json:"-"`
	MBTIType       string `json:"-"`
	ProfilePicture string `json:"-"`
}

type Relationship struct {
	gorm.Model
	UserID   uint   `gorm:"index;not null" json:"user_id"`
	ClientID string `gorm:"type:varchar(36)" json:"client_id"`

	// NameHMAC is the blind index: HMAC-SHA256(HKDF(DEK, "alq:blind:name:v1"), NFC(name)).
	// It is what keeps FindOrCreateRelationship and the uniqueness check working without
	// the server ever holding a name. Deterministic by design — see docs 13 §1.4 for
	// exactly what that does and does not leak.
	NameHMAC []byte `gorm:"index" json:"name_hmac"`

	Blob        []byte `json:"blob"` // {name, cadence_days}
	IsEncrypted bool   `gorm:"default:false;index" json:"is_encrypted"`

	Name        string `json:"-"` // legacy
	CadenceDays *int   `json:"-"` // legacy
}

type AnalysisSubject struct {
	gorm.Model
	UserID         uint          `json:"user_id"`
	RelationshipID *uint         `gorm:"index" json:"relationship_id"`
	Relationship   *Relationship `gorm:"foreignKey:RelationshipID" json:"-"`

	ClientID      string `gorm:"type:varchar(36);index" json:"client_id"`
	Blob          []byte `json:"blob"`
	IsEncrypted   bool   `gorm:"default:false;index" json:"is_encrypted"`
	SchemaVersion int    `gorm:"default:1" json:"schema_version"`

	// Legacy plaintext, dropped in Phase 3.
	Name         string                    `gorm:"" json:"-"`
	Kind         string                    `json:"-"`
	Description  string                    `json:"-"`
	Date         *time.Time                `json:"-"`
	Stats        map[string]int            `gorm:"serializer:json" json:"-"`
	Tags         []string                  `gorm:"serializer:json" json:"-"`
	Uncertain    []string                  `gorm:"serializer:json" json:"-"`
	GuideAnswers map[string]map[string]int `gorm:"serializer:json" json:"-"`
}
```

The cleartext blob a subject encrypts to:

```jsonc
{
  "v": 1,
  "name": "Alex",              // kept for export/rollback; the relationship blob is authoritative
  "kind": "full",
  "date": "2026-03-01",        // null for undated
  "description": "…",
  "stats": { "trust": 72 },
  "tags": ["after the trip"],
  "uncertain": ["trust"],
  "guide_answers": { "trust": { "0": 2 } }
}
```

## 1.4 The blind index — how stacks survive encryption

This is the part of the design that is specific to *this* codebase, and the part a generic
"just encrypt the columns" answer gets wrong.

Three load-bearing behaviours resolve relationships by name **on the server**:

- [`FindOrCreateRelationship`](../backend/internal/database/backfill.go#L126) on every snapshot write
- the uniqueness check at [relationships.go:271](../backend/internal/handlers/relationships.go#L271)
- the rename cascade at [relationships.go:288](../backend/internal/handlers/relationships.go#L288)

Encrypt `name` naively and all three break: AES-GCM is randomized, so the same name encrypts to
a different blob every time and `WHERE name = ?` can never match.

The fix is a **keyed blind index**:

```
name_hmac = HMAC-SHA256( HKDF(DEK, "alq:blind:name:v1"), NFC(trim(name)) )
```

The server compares `name_hmac` for equality and enforces uniqueness on
`(user_id, name_hmac)`. It never learns the name.

- **Not dictionary-attackable.** A bare `SHA-256("Alex")` would fall to a first-name wordlist in
  milliseconds. The HMAC key is derived from the DEK, which the server does not have, so there
  is nothing to brute force against.
- **Leaks equality only** — that two snapshots concern the same person. The server already knew
  that from `relationship_id`, so this adds nothing to the existing leak.
- **Preserves the documented case policy exactly.** Normalization is NFC + trim, deliberately
  *not* lowercase, so "Alex" and "alex" remain two people as
  [backfill.go:124-125](../backend/internal/database/backfill.go#L124-L125) specifies.
- **Per-user key**, so `name_hmac` values are incomparable across accounts. Two users tracking
  the same person produce different values.

Rename becomes: client re-encrypts the blob, recomputes `name_hmac`, `PATCH`es both. Merge is
unchanged apart from copying `name_hmac` instead of `name`.

## 1.5 Authentication without sending the password

Today [`Login`](../backend/internal/handlers/auth.go#L47) receives the raw password. Once the
KEK is derived from that password, sending it means a malicious or compromised server can
derive the KEK and unwrap the DEK — which would make the whole exercise theatre.

So login becomes two round trips:

```
POST /api/auth/params   { email }
  → { kdf_salt, kdf_mem_kib, kdf_iterations, kdf_parallelism, encryption_status }

  client: masterSecret = Argon2id(password, kdf_salt, params)
          verifier     = HKDF(masterSecret, "alq:auth-verifier:v1")

POST /api/login         { email, verifier }
  → { token, wrapped_dek, key_version, encryption_status }

  client: KEK = HKDF(masterSecret, "alq:kek:v1")
          DEK = AES-GCM-decrypt(KEK, wrapped_dek, aad)
```

The server bcrypts the verifier exactly as it bcrypts the password today, so
[`auth.HashPassword`](../backend/internal/auth/auth.go#L41) and `CheckPasswordHash` are reused
unchanged. Two notes on that:

- **Lower the bcrypt cost from 14 to 10.** Cost 14 exists to slow brute force against a
  low-entropy human password. The verifier is a 256-bit HKDF output — it is not brute-forceable
  at any cost factor. Keeping 14 adds ~1 s of server CPU to every login on top of the 1–3 s of
  Argon2id the client just spent. Cost 10 is still a sound defence-in-depth hash of a
  high-entropy secret.
- **`/api/auth/params` is unauthenticated and must not become a user-enumeration oracle.** For
  an unknown email, return a *deterministic* fake: `kdf_salt = HMAC(server_secret, lower(email))`
  truncated to 16 bytes, with default parameters and `encryption_status: "encrypted"`. Determinism
  matters — a random salt per request is detectable by asking twice.

  Be clear-eyed about the residual: during the migration window a genuine `legacy` response
  proves the account exists, because unknown emails always answer `encrypted`. That oracle
  closes by itself when the last account migrates. Rate-limit the endpoint per IP in the
  meantime; do not pretend the gap is not there.

## 1.6 Password change protocol

The DEK is immutable, so changing a password re-wraps 32 bytes and touches **no** row of user
data. This holds whether the user has 10 snapshots or 100,000.

```
client, with the current session's DEK already in memory:
  1. verifierOld    = HKDF(Argon2id(oldPassword, currentSalt, currentParams), "alq:auth-verifier:v1")
  2. newSalt        = 16 random bytes
  3. masterNew      = Argon2id(newPassword, newSalt, currentParams)
  4. kekNew         = HKDF(masterNew, "alq:kek:v1")
     verifierNew    = HKDF(masterNew, "alq:auth-verifier:v1")
  5. wrappedDekNew  = AES-GCM(kekNew, DEK, aad="alq:v1:dek:<b64(newSalt)>:<keyVersion+1>")
  6. POST /api/me/password { verifier_old, kdf_salt, kdf_params, verifier_new, wrapped_dek, expected_key_version }

server, in ONE transaction:
  a. SELECT ... FOR UPDATE               -- serializes concurrent changes from two devices
  b. bcrypt-compare verifier_old         -- 401 on mismatch
  c. reject if key_version <> expected_key_version   -- 409, someone else changed it first
  d. UPDATE users SET password = bcrypt(verifier_new),
                      kdf_salt = ..., kdf_mem_kib = ..., kdf_iterations = ..., kdf_parallelism = ...,
                      wrapped_dek = ...,
                      key_version = key_version + 1,
                      token_epoch = token_epoch + 1
  e. COMMIT
```

Four consequences worth stating explicitly:

- **`recovery_wrapped_dek` is untouched.** It wraps the same DEK under a different KEK, so the
  recovery phrase issued at signup still works after any number of password changes. Users must
  be told this, or they will assume the phrase is stale and discard it.
- **`key_version` is in the AAD**, so an administrator who restores an old `wrapped_dek` from a
  backup gets an AEAD authentication failure rather than a silently-working old password.
- **`token_epoch` increments**, which is what actually logs out other devices. Add `epoch` to the
  JWT claims and compare it in [`AuthMiddleware`](../backend/internal/handlers/middleware.go).
  That turns token validation into a DB read per request — acceptable for a self-hosted app of
  this size, and the honest price of being able to revoke.
- **The old session keeps working on the device that made the change**, because that device
  already holds the DEK. It just needs the new token.

Password *reset* — as distinct from change — does not exist and cannot. See §4.3.

---

# Section 2 — Implementation

Dependencies:

```bash
npm install hash-wasm @scure/bip39
```

Both are dependency-free and WebView-safe. `hash-wasm` ships WASM inline (no separate asset
fetch, which matters under Capacitor's `https://localhost` origin). Total added bundle: ~25 KB
gzipped.

The project is `.jsx`, but Vite compiles `.ts` with no configuration change, so the crypto layer
is written in TypeScript for the type safety — it sits alongside the existing JSX untouched.

## 2.1 Primitives — `src/crypto/primitives.ts`

```ts
/**
 * The only file in the app that talks to crypto.subtle directly.
 *
 * Everything here is deliberately small and boring. The envelope layout is fixed by
 * docs/13 §1.2 and the version byte is the sole mechanism for ever changing it, so
 * `pack`/`unpack` must stay the single point where that layout is written down.
 */

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;   // 96-bit nonce, the only size AES-GCM is proven at
const KEY_BYTES = 32;  // AES-256

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Absent outside a secure context. Capacitor is configured with androidScheme "https",
 * so the WebView origin is https://localhost and this holds on device — but a dev server
 * reached over plain http:// from a phone will fail here, which is a configuration error
 * worth reporting loudly rather than degrading around.
 */
export function requireSubtle(): SubtleCrypto {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error(
            'Web Crypto is unavailable. The app must be served over https:// or localhost; ' +
            'encryption cannot run in an insecure context.'
        );
    }
    return subtle;
}

export function randomBytes(length: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/** Best-effort scrub. See §2.6 for what this does and does not guarantee in JS. */
export function wipe(...buffers: (Uint8Array | null | undefined)[]): void {
    for (const buffer of buffers) buffer?.fill(0);
}

export const toBase64 = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes));

export const fromBase64 = (text: string): Uint8Array =>
    Uint8Array.from(atob(text), char => char.charCodeAt(0));

/** version || iv || ciphertext+tag */
function pack(iv: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    const out = new Uint8Array(1 + IV_BYTES + ciphertext.length);
    out[0] = ENVELOPE_VERSION;
    out.set(iv, 1);
    out.set(ciphertext, 1 + IV_BYTES);
    return out;
}

function unpack(envelope: Uint8Array): { iv: Uint8Array; ciphertext: Uint8Array } {
    if (envelope.length < 1 + IV_BYTES + 16) {
        throw new Error('Ciphertext is truncated.');
    }
    if (envelope[0] !== ENVELOPE_VERSION) {
        throw new Error(
            `Unsupported ciphertext version ${envelope[0]}; this client understands ${ENVELOPE_VERSION}.`
        );
    }
    return {
        iv: envelope.subarray(1, 1 + IV_BYTES),
        ciphertext: envelope.subarray(1 + IV_BYTES)
    };
}

/**
 * HKDF-SHA256. The salt is empty on purpose: the input keying material is already
 * either a 32-byte Argon2id output or 32 bytes of CSPRNG entropy, so it is uniformly
 * random and HKDF-Expand alone would do. `info` is what separates the branches, and
 * every caller must pass a distinct, versioned label.
 */
export async function hkdf(ikm: Uint8Array, info: string, length = KEY_BYTES): Promise<Uint8Array> {
    const subtle = requireSubtle();
    const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const bits = await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: encoder.encode(info) },
        base,
        length * 8
    );
    return new Uint8Array(bits);
}

/**
 * Import raw bytes as a NON-EXTRACTABLE AES-GCM key. Non-extractable is the whole point:
 * the browser keeps the key material outside the JS heap, so it cannot be read back by
 * a later XSS, cannot land in a heap snapshot, and cannot be serialized into an error
 * report. The caller wipes the raw bytes immediately afterwards.
 */
export async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
    return requireSubtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function importHmacKey(raw: Uint8Array): Promise<CryptoKey> {
    return requireSubtle().importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/**
 * AES-256-GCM with a fresh random 96-bit IV per call.
 *
 * Random IVs are safe here by a wide margin: collision probability stays negligible below
 * ~2^32 encryptions under one key, and a heavy user of this app produces a few thousand
 * writes in a lifetime. DEK rotation for nonce exhaustion is not a concern at this scale.
 */
export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<Uint8Array> {
    const iv = randomBytes(IV_BYTES);
    const ciphertext = await requireSubtle().encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 },
        key,
        plaintext
    );
    return pack(iv, new Uint8Array(ciphertext));
}

/** Throws on a wrong key, a corrupted blob, or an AAD mismatch — all indistinguishable, by design. */
export async function open(key: CryptoKey, envelope: Uint8Array, aad: string): Promise<Uint8Array> {
    const { iv, ciphertext } = unpack(envelope);
    try {
        const plaintext = await requireSubtle().decrypt(
            { name: 'AES-GCM', iv, additionalData: encoder.encode(aad), tagLength: 128 },
            key,
            ciphertext
        );
        return new Uint8Array(plaintext);
    } catch {
        throw new Error('Decryption failed: wrong key, altered data, or a record moved between rows.');
    }
}

export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<Uint8Array> {
    return seal(key, encoder.encode(JSON.stringify(value)), aad);
}

export async function openJson<T>(key: CryptoKey, envelope: Uint8Array, aad: string): Promise<T> {
    return JSON.parse(decoder.decode(await open(key, envelope, aad))) as T;
}
```

## 2.2 Key derivation — `src/crypto/keys.ts`

```ts
import { argon2id } from 'hash-wasm';
import {
    fromBase64, hkdf, importAesKey, importHmacKey,
    open, randomBytes, seal, toBase64, wipe
} from './primitives';

export interface KdfParams {
    memKiB: number;
    iterations: number;
    parallelism: number;
}

/**
 * Above the OWASP floor (m=19 MiB, t=2, p=1) with headroom. Stored per user rather than
 * applied as a constant, so this can be raised for new accounts and lowered for a device
 * that cannot afford 64 MiB without stranding anyone.
 */
export const DEFAULT_KDF: KdfParams = { memKiB: 65536, iterations: 3, parallelism: 1 };

const SALT_BYTES = 16;
const DEK_BYTES = 32;

/** The live session's key material. Every field is a non-extractable CryptoKey. */
export interface VaultKeys {
    dek: CryptoKey;          // encrypts every row payload
    nameHmacKey: CryptoKey;  // computes the relationship blind index
}

const dekAad = (saltB64: string, keyVersion: number) => `alq:v1:dek:${saltB64}:${keyVersion}`;
const recoveryAad = (saltB64: string, keyVersion: number) => `alq:v1:rdek:${saltB64}:${keyVersion}`;

async function argon2(password: string, salt: Uint8Array, params: KdfParams): Promise<Uint8Array> {
    return argon2id({
        password,
        salt,
        parallelism: params.parallelism,
        iterations: params.iterations,
        memorySize: params.memKiB,   // KiB
        hashLength: 32,
        outputType: 'binary'
    });
}

/**
 * The password branch of the hierarchy. Returns the KEK (for unwrapping the DEK) and the
 * verifier (for proving identity to the server) as siblings — neither is derivable from
 * the other, which is what stops the server's copy of the verifier being a path to the KEK.
 */
export async function deriveFromPassword(
    password: string,
    salt: Uint8Array,
    params: KdfParams
): Promise<{ kek: CryptoKey; verifier: string }> {
    const master = await argon2(password, salt, params);
    const kekBytes = await hkdf(master, 'alq:kek:v1');
    const verifierBytes = await hkdf(master, 'alq:auth-verifier:v1');
    wipe(master);

    const kek = await importAesKey(kekBytes);
    wipe(kekBytes);

    const verifier = toBase64(verifierBytes);
    wipe(verifierBytes);

    return { kek, verifier };
}

/**
 * Expand a raw DEK into the session's key set, then destroy the raw bytes.
 *
 * The blind-index key must be derived here, while the DEK is still raw: once imported
 * non-extractably it can no longer be used as HKDF input. That constraint is the reason
 * this function exists rather than two independent derivations.
 */
async function expand(rawDek: Uint8Array): Promise<VaultKeys> {
    const nameKeyBytes = await hkdf(rawDek, 'alq:blind:name:v1');
    const keys: VaultKeys = {
        dek: await importAesKey(rawDek),
        nameHmacKey: await importHmacKey(nameKeyBytes)
    };
    wipe(nameKeyBytes);
    return keys;
}

export interface EnrollmentPayload {
    kdfSalt: string;             // base64
    kdfParams: KdfParams;
    verifier: string;            // base64
    wrappedDek: string;          // base64
    recoveryWrappedDek: string;  // base64
    keyVersion: number;
}

/**
 * Everything a brand-new (or newly-migrating) account needs, produced in one pass so the
 * password, the DEK and the recovery phrase can never disagree about which DEK they wrap.
 *
 * The mnemonic is returned to be shown to the user exactly once and never persisted.
 */
export async function createVault(
    password: string,
    params: KdfParams = DEFAULT_KDF
): Promise<{ keys: VaultKeys; mnemonic: string; enrollment: EnrollmentPayload }> {
    const { generateRecoveryPhrase, recoveryKekFromMnemonic } = await import('./recovery');

    const salt = randomBytes(SALT_BYTES);
    const saltB64 = toBase64(salt);
    const keyVersion = 1;

    const { kek, verifier } = await deriveFromPassword(password, salt, params);

    const rawDek = randomBytes(DEK_BYTES);
    const wrappedDek = await seal(kek, rawDek, dekAad(saltB64, keyVersion));

    const mnemonic = generateRecoveryPhrase();
    const recoveryKek = await recoveryKekFromMnemonic(mnemonic);
    const recoveryWrappedDek = await seal(recoveryKek, rawDek, recoveryAad(saltB64, keyVersion));

    const keys = await expand(rawDek);
    wipe(rawDek);

    return {
        keys,
        mnemonic,
        enrollment: {
            kdfSalt: saltB64,
            kdfParams: params,
            verifier,
            wrappedDek: toBase64(wrappedDek),
            recoveryWrappedDek: toBase64(recoveryWrappedDek),
            keyVersion
        }
    };
}

/** The login path: unwrap the DEK that already exists. */
export async function unlockVault(
    kek: CryptoKey,
    wrappedDekB64: string,
    kdfSaltB64: string,
    keyVersion: number
): Promise<VaultKeys> {
    const rawDek = await open(kek, fromBase64(wrappedDekB64), dekAad(kdfSaltB64, keyVersion));
    const keys = await expand(rawDek);
    wipe(rawDek);
    return keys;
}

/** Re-wrap the same DEK under a new password. No user data is touched. */
export async function rewrapForNewPassword(
    currentKeys: VaultKeys,
    rawDek: Uint8Array,
    newPassword: string,
    nextKeyVersion: number,
    params: KdfParams = DEFAULT_KDF
): Promise<Omit<EnrollmentPayload, 'recoveryWrappedDek'>> {
    const salt = randomBytes(SALT_BYTES);
    const saltB64 = toBase64(salt);
    const { kek, verifier } = await deriveFromPassword(newPassword, salt, params);
    const wrappedDek = await seal(kek, rawDek, dekAad(saltB64, nextKeyVersion));

    return {
        kdfSalt: saltB64,
        kdfParams: params,
        verifier,
        wrappedDek: toBase64(wrappedDek),
        keyVersion: nextKeyVersion
    };
}
```

> **One wrinkle to be honest about.** `rewrapForNewPassword` needs the *raw* DEK, but the session
> deliberately holds a non-extractable key. Two ways out, pick one and write it down:
> (a) hold the raw DEK in a closure alongside the CryptoKey for the session's lifetime — simpler,
> slightly weaker; or (b) re-derive the old KEK from the old password the user types into the
> change-password form and unwrap `wrapped_dek` again — no long-lived raw material, one extra
> Argon2id run. **Prefer (b).** The user is typing their old password on that screen anyway, so
> the cost is invisible and the raw DEK never outlives a single function call.

## 2.3 Payload encryption — `src/crypto/vault.ts`

```ts
import { fromBase64, openJson, sealJson, toBase64, requireSubtle } from './primitives';
import type { VaultKeys } from './keys';

export interface SubjectPlain {
    v: 1;
    name: string;
    kind: 'full' | 'pulse';
    date: string | null;
    description: string;
    stats: Record<string, number>;
    tags: string[];
    uncertain: string[];
    guide_answers: Record<string, Record<string, number>>;
}

export interface RelationshipPlain {
    v: 1;
    name: string;
    cadence_days: number | null;
}

const subjectAad = (clientId: string) => `alq:v1:subject:${clientId}`;
const relationshipAad = (clientId: string) => `alq:v1:relationship:${clientId}`;

export const newClientId = (): string => globalThis.crypto.randomUUID();

/**
 * The blind index for a relationship name.
 *
 * NFC + trim, and deliberately NOT lowercased: "Alex" and "alex" have been two different
 * people since Phase 1 (see backfill.go), and the index must reproduce that rule exactly
 * or renaming would silently merge two stacks. NFC matters because a name typed on iOS and
 * the same name typed on Android can differ byte-for-byte while looking identical.
 */
export async function blindIndex(keys: VaultKeys, name: string): Promise<string> {
    const normalized = name.normalize('NFC').trim();
    const mac = await requireSubtle().sign(
        'HMAC', keys.nameHmacKey, new TextEncoder().encode(normalized)
    );
    return toBase64(new Uint8Array(mac));
}

export async function encryptSubject(
    keys: VaultKeys, clientId: string, plain: SubjectPlain
): Promise<string> {
    return toBase64(await sealJson(keys.dek, plain, subjectAad(clientId)));
}

export async function decryptSubject(
    keys: VaultKeys, clientId: string, blobB64: string
): Promise<SubjectPlain> {
    return openJson<SubjectPlain>(keys.dek, fromBase64(blobB64), subjectAad(clientId));
}

export async function encryptRelationship(
    keys: VaultKeys, clientId: string, plain: RelationshipPlain
): Promise<string> {
    return toBase64(await sealJson(keys.dek, plain, relationshipAad(clientId)));
}

export async function decryptRelationship(
    keys: VaultKeys, clientId: string, blobB64: string
): Promise<RelationshipPlain> {
    return openJson<RelationshipPlain>(keys.dek, fromBase64(blobB64), relationshipAad(clientId));
}

/**
 * Decrypt a fetched list, isolating failures.
 *
 * One unreadable row must not blank the dashboard: a row that fails to open is far more
 * likely to be a half-finished migration than an attack, and the user needs to see the
 * other 200 snapshots while that is sorted out. Failures are surfaced, never swallowed.
 */
export async function decryptList<T>(
    rows: { client_id: string; blob: string }[],
    decrypt: (clientId: string, blob: string) => Promise<T>
): Promise<{ items: T[]; failed: string[] }> {
    const settled = await Promise.allSettled(
        rows.map(row => decrypt(row.client_id, row.blob))
    );

    const items: T[] = [];
    const failed: string[] = [];
    settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') items.push(outcome.value);
        else failed.push(rows[index].client_id);
    });
    return { items, failed };
}
```

## 2.4 Recovery — `src/crypto/recovery.ts`

```ts
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { hkdf, importAesKey, randomBytes, wipe } from './primitives';

/**
 * A 24-word BIP-39 phrase over 32 bytes of CSPRNG entropy: 256 bits, plus the checksum
 * that makes a mistyped word a clean error instead of a silent wrong key.
 *
 * BIP-39's own mnemonicToSeed is NOT used. It runs PBKDF2-HMAC-SHA512 for 2048 rounds,
 * which is stretching aimed at low-entropy user-chosen passphrases. This entropy is
 * machine-generated and already full-strength, so stretching would buy nothing and cost
 * a visible pause on a phone. HKDF over the raw entropy is the correct construction here.
 */
export function generateRecoveryPhrase(): string {
    const entropy = randomBytes(32);
    const mnemonic = entropyToMnemonic(entropy, wordlist);
    wipe(entropy);
    return mnemonic;
}

export function isValidRecoveryPhrase(mnemonic: string): boolean {
    return validateMnemonic(normalizePhrase(mnemonic), wordlist);
}

/** BIP-39 is lowercase, single-space separated; users paste all sorts of things. */
export function normalizePhrase(mnemonic: string): string {
    return mnemonic.normalize('NFKD').trim().toLowerCase().split(/\s+/).join(' ');
}

export async function recoveryKekFromMnemonic(mnemonic: string): Promise<CryptoKey> {
    const normalized = normalizePhrase(mnemonic);
    if (!validateMnemonic(normalized, wordlist)) {
        throw new Error('That recovery phrase is not valid — check for a mistyped or missing word.');
    }
    const entropy = mnemonicToEntropy(normalized, wordlist);
    const kekBytes = await hkdf(entropy, 'alq:recovery-kek:v1');
    wipe(entropy);
    const kek = await importAesKey(kekBytes);
    wipe(kekBytes);
    return kek;
}
```

**Recovery flow.** The user supplies email + phrase + a new password. The server returns
`recovery_wrapped_dek`, `kdf_salt` and `key_version` (rate-limited hard — this endpoint is a
brute-force target, though 256 bits makes guessing hopeless). The client unwraps the DEK with
the recovery KEK, derives a fresh KEK from the new password, re-wraps, and posts the new
`kdf_salt` / `verifier` / `wrapped_dek` with an incremented `key_version` and `token_epoch`.

Offer to reissue the phrase at that point: the old one has just been typed into a form, may
have been in a clipboard, and the user has proven they will need it again.

## 2.5 Session key handling

**Where the DEK lives:** in a module-scoped variable inside a React context provider, as a
non-extractable `CryptoKey`. Nowhere else.

**Where it must never live:**

- `localStorage` / `sessionStorage` — readable by any XSS, and persists across sessions.
- **`@capacitor/preferences`** — this one is a trap. It is backed by Android `SharedPreferences`,
  which is a **plaintext XML file** in the app sandbox. It is not encrypted, and it is readable
  on any rooted device or via `adb backup` on a debuggable build. The plugin is already a
  dependency for other settings; do not reach for it here.
- Redux/Zustand devtools-visible state, error reports, or analytics breadcrumbs.
- The React tree as a prop that could end up in a serialized error boundary.

**On wiping memory — the honest version.** JavaScript cannot guarantee erasure. The GC copies
objects during compaction, strings are immutable, and a `Uint8Array.fill(0)` only scrubs the
copy you happen to hold a reference to. `wipe()` above is genuine risk reduction, not a
guarantee.

The real mitigation is **non-extractable `CryptoKey`s**: the browser holds that key material
outside the JS heap entirely, so it survives no heap snapshot and no XSS read. That is why every
key in §2.2 is imported with `extractable: false`, and why raw bytes exist only inside a single
function body.

```ts
// src/context/VaultContext.tsx  (sketch of the lifecycle contract)

let sessionKeys: VaultKeys | null = null;   // module scope — never in React state

export function setSessionKeys(keys: VaultKeys | null) { sessionKeys = keys; }
export function requireSessionKeys(): VaultKeys {
    if (!sessionKeys) throw new Error('Vault is locked.');
    return sessionKeys;
}

/**
 * Teardown. Order matters: drop the keys first, so any in-flight render that tries to
 * decrypt after this point fails closed rather than racing against a half-cleared cache.
 */
export function lockVault() {
    sessionKeys = null;
    clearCache();                                  // src/mobile/offlineCache.js
    window.localStorage.removeItem('alq:token');
}
```

Call `lockVault()` on: explicit logout, `AppLock`'s existing 15-minute idle timeout
([AppLock.jsx:14](../src/components/AppLock.jsx#L14)), Capacitor's `appStateChange` to
background (add to [useNativeShell.js](../src/mobile/useNativeShell.js)), and any `401`.

**Consequence: page refresh logs the user out.** The DEK cannot survive a reload without being
persisted somewhere, and every available "somewhere" is plaintext. This is a real UX regression
and must be a deliberate, communicated decision. If it proves intolerable on Android, the only
sound fix is wrapping the DEK with a hardware-backed key from the Android Keystore
(`setUserAuthenticationRequired(true)`, unlocked by biometric) via a native plugin — a
meaningful piece of work, not a config flag. Do not substitute `Preferences` for it.

**`offlineCache.js` must be updated.** It currently writes the fully decrypted subject list to
`localStorage` on native ([offlineCache.js:25](../src/mobile/offlineCache.js#L25)). Under this
design it must cache the *ciphertext* rows exactly as fetched; decryption happens on read, in
memory. Otherwise the phone holds a plaintext copy of everything the server is no longer allowed
to see — which would make the Android build the weakest link in the entire system.

---

# Section 3 — Migrating existing data

## 3.1 Feasibility: what is and is not possible

**A server-side background migration is impossible.** Not difficult — impossible, and the
impossibility is the feature working correctly.

Encrypting a user's existing rows requires their DEK. The DEK is wrapped by a KEK derived from
their password via Argon2id. The server stores only `bcrypt(password)`, which is one-way. So at
rest, with no user present, the server has no path to the DEK. If it did, so would an
administrator, and the design would be pointless.

Three consequences that shape everything below:

1. **Migration only happens while a user is logged in with their password in memory.** There is
   exactly one moment this is true: immediately after a successful login, before the password
   variable goes out of scope.
2. **Migration is a client-side data transfer**, not a SQL script. Rows must be fetched in
   plaintext, encrypted in the browser, and written back. For a heavy user with a few thousand
   snapshots this is seconds; it is still a loop over the network.
3. **Some accounts will never migrate.** Anyone who never logs in again is permanently legacy.
   §3.4 is about accepting that rather than pretending otherwise.

## 3.2 Rollout phases

| Phase | Server | Client | Exit condition |
|---|---|---|---|
| **P0** Schema | Phase 1 DDL. Dual-read: serve `blob` if `is_encrypted`, else plaintext. Accept both write shapes. | Unchanged. | Deployed, no behaviour change. |
| **P1** New accounts | `/api/auth/params`, verifier login, `/api/me/enroll-encryption`. | Signup generates DEK + mnemonic. New accounts start `encrypted`. | New signups are zero-knowledge. |
| **P2** Lazy migration | `/api/migrate/batch`, `/api/me/finalize-encryption`. | On-login enrollment + resumable batch loop. | `legacy` count trends to zero. |
| **P3** Enforcement | Reject plaintext writes. Phase 3 DDL. `VACUUM FULL`. Destroy old backups. | Drop all legacy read paths. | No plaintext remains. |

Do not compress P0 and P1. P0 deployed alone, and left alone for a release cycle, is what proves
the dual-read path works before any data depends on it.

## 3.3 On-login migration

```
1. User logs in normally (legacy path: email + password).
   Server returns { token, encryption_status: "legacy" }.

2. Client sees "legacy" and enters a BLOCKING one-time flow. Blocking is deliberate:
   a half-migrated account edited by a user who dismissed the prompt is the worst state
   available, and it is reachable in one click if the dialog is dismissible.

3. "Download a copy of your data first" — reuse the existing GET /api/export
   (vault.go:91) to hand the user a plaintext JSON file. This is the last moment the
   server can produce one, and it is the only backstop that survives every failure
   mode below, including "user forgets password and loses the phrase".

4. Show the 24-word recovery phrase. REQUIRE confirmation by asking for three
   randomly-chosen words back. Do not proceed on a checkbox: this is the single point
   where an irreversible loss of access is created, and the user must have engaged
   with it.

5. POST /api/me/enroll-encryption
     { kdf_salt, kdf_params, verifier, wrapped_dek, recovery_wrapped_dek, client_id }
   Server: encryption_status = 'migrating'. It KEEPS the old bcrypt(password) in
   users.password. That is what lets an interrupted migration still log in the old
   way tomorrow.

6. Batch loop (see below), resumable, idempotent.

7. POST /api/me/finalize-encryption
   Server, in one transaction:
     - verify COUNT(*) FROM analysis_subjects WHERE user_id = ? AND is_encrypted = FALSE  == 0
     - verify the same for relationships
     - users.password = bcrypt(verifier)     <- the swap; legacy login dies here
     - encryption_status = 'encrypted'
     - token_epoch = token_epoch + 1
   A finalize that finds even one unmigrated row must 409, not "mostly succeed".
```

### The batch loop, and why it is two-phase

```ts
// src/migration/migrate.ts

const BATCH = 50;

/**
 * Encrypt one user's history in place.
 *
 * Two-phase per batch, and this is the crux of the whole migration:
 *
 *   Phase A  write the ciphertext, leave the plaintext columns intact
 *   Phase B  re-fetch, decrypt, verify it round-trips, and only THEN null the plaintext
 *
 * A single-phase "encrypt and overwrite" is one dropped connection away from a row whose
 * plaintext is gone and whose ciphertext never arrived. Two-phase means every intermediate
 * state is readable by someone: after A the plaintext is still authoritative, after B the
 * ciphertext is proven. There is no window in which a row is unreadable.
 */
export async function migrateAccount(keys: VaultKeys, onProgress: (done: number, total: number) => void) {
    const { data: pending } = await axios.get('/api/migrate/pending');
    let done = 0;

    // Relationships first: a snapshot's blind index depends on its relationship's name,
    // so migrating subjects against unmigrated relationships would need a second pass.
    for (const chunk of batches(pending.relationships, BATCH)) {
        const prepared = await Promise.all(chunk.map(async (row) => {
            const clientId = row.client_id ?? newClientId();
            return {
                id: row.ID,
                client_id: clientId,
                name_hmac: await blindIndex(keys, row.name),
                blob: await encryptRelationship(keys, clientId, {
                    v: 1, name: row.name, cadence_days: row.cadence_days
                })
            };
        }));

        // Phase A — ciphertext lands, plaintext untouched.
        await axios.post('/api/migrate/batch', { kind: 'relationships', rows: prepared });

        // Phase B — server re-reads what it stored; we prove it opens before anything is lost.
        const { data: stored } = await axios.post('/api/migrate/verify', {
            kind: 'relationships', ids: prepared.map(r => r.id)
        });
        for (const row of stored.rows) {
            await decryptRelationship(keys, row.client_id, row.blob);  // throws => abort, plaintext intact
        }
        await axios.post('/api/migrate/commit', {
            kind: 'relationships', ids: prepared.map(r => r.id)
        });

        done += chunk.length;
        onProgress(done, pending.total);
    }

    // ... identical shape for subjects ...
}
```

Server side, `commit` is the only statement that destroys anything:

```go
// Idempotent by construction: a retried commit re-nulls already-null columns and
// re-sets an already-true flag. A client that loses its response mid-batch retries
// the whole batch safely.
err := tx.Model(&models.AnalysisSubject{}).
    Where("user_id = ? AND id IN ? AND blob IS NOT NULL", userID, ids).
    UpdateColumns(map[string]interface{}{
        "is_encrypted":  true,
        "name":          "",
        "description":   "",
        "date":          nil,
        "kind":          "",
        "stats":         nil,
        "tags":          nil,
        "uncertain":     nil,
        "guide_answers": nil,
    }).Error
```

Note `blob IS NOT NULL` in the `WHERE`. It makes it structurally impossible for a commit to
clear plaintext on a row that never received ciphertext, regardless of what ids the client sends.

`UpdateColumns` rather than `Updates`, matching the reasoning already established at
[backfill.go:78](../backend/internal/database/backfill.go#L78): a mechanical migration should not
make every row in the database look freshly edited.

### Run the relationship backfill first

[`BackfillRelationships`](../backend/internal/database/backfill.go#L35) groups legacy snapshots by
`TRIM(name)` to assign `relationship_id`. It reads plaintext names. **After encryption it can
never run again.**

So: confirm it has completed and reported zero on every deployment *before* P2 begins. A snapshot
that reaches encryption with `relationship_id IS NULL` becomes permanently unlinkable — the
server can no longer group it and the client has no way to ask it to.

## 3.4 Inactive accounts

Generic SaaS advice ("email them three times, then delete") does not apply cleanly here, and it
is worth being precise about why: this app has **no scheduler, no email, and no push**, as
[models.go:29-33](../backend/internal/models/models.go#L29-L33) states plainly. There is no
mechanism to notify a dormant user, and adding one is a larger project than this migration.

More importantly, it is **self-hosted**. In the common deployment the operator and the user are
the same person, and "inactive accounts" means "the test account I made in February". Sizing this
problem like a multi-tenant SaaS would be solving someone else's problem.

**Recommended policy for the self-hosted case:**

1. Add a `GET /api/admin/encryption-status` returning `{legacy, migrating, encrypted}` counts.
   The operator can see exactly who is outstanding.
2. Leave `legacy` accounts working indefinitely. They are no worse off than today.
3. Surface the state in the app: the Vault page already explains where data lives — add an
   honest banner saying this account's data is *not* encrypted and one login will fix it.
4. Gate P3 on the count reaching zero, which the DDL's `DO $$` block enforces mechanically.

**If you are running this multi-tenant**, the options are only these three, and none is free:

| Option | Cost |
|---|---|
| Wait indefinitely | Plaintext persists; P3 never runs; the promise is never fully delivered. |
| Hard cutoff — export to an encrypted archive keyed by a server-held key, then purge the rows | Those specific accounts are *not* zero-knowledge and must be labelled as such. Honest, but it is an asterisk on the claim. |
| Hard cutoff — delete after a stated notice period | Clean and truthful. Requires the notification channel you do not have. |

Pick one and document it in the privacy policy. Do not leave it undecided, because "undecided"
resolves in practice to option one.

## 3.5 Data-loss edge cases

| # | Scenario | Guard |
|---|---|---|
| 1 | User forgets password, never saved the phrase | **Unrecoverable — accept it.** Mitigated by the forced three-word confirmation (§3.3 step 4) and the pre-migration export (step 3). This is the cost of the feature, not a bug in it. |
| 2 | Network drops mid-batch | Two-phase commit (§3.3). After Phase A the plaintext is still authoritative; the loop resumes from `/api/migrate/pending`. No row is ever in an unreadable state. |
| 3 | Ciphertext written, plaintext cleared, blob later fails to open | Phase B decrypts a server round-trip *before* commit. A blob that cannot be read back never reaches commit. |
| 4 | Two devices migrate the same account concurrently | `enroll-encryption` rejects unless `encryption_status = 'legacy'` under `SELECT ... FOR UPDATE`. The loser gets 409 and re-logs in against the now-`migrating` account. Two different DEKs for one account is the unrecoverable case this prevents. |
| 5 | Old Android APK hits a migrated account | **Side-loaded APKs cannot be force-updated.** Require an `X-ALQ-Client` version header; return **426 Upgrade Required** when an encrypted account is accessed by a client below the minimum. Without this, an old client reads `blob` as an absent field and cheerfully renders an empty vault — which users will report as data loss. |
| 6 | Password changed mid-migration | Reject `/api/me/password` with 409 while `encryption_status = 'migrating'`. |
| 7 | `offlineCache` holds pre-migration plaintext | `clearCache()` on enroll, and re-fetch. Already exported from [offlineCache.js:53](../src/mobile/offlineCache.js#L53). |
| 8 | User imports an old plaintext export after migrating | Import moves client-side: parse, encrypt, POST ciphertext. The server's [`ImportVault`](../backend/internal/handlers/vault.go#L173) must reject plaintext bodies from encrypted accounts rather than silently storing them. |
| 9 | Half-migrated account, user edits a snapshot | Block writes while `migrating` (the flow is blocking anyway). Belt and braces: server rejects a plaintext write when `encryption_status <> 'legacy'`. |
| 10 | Backups still contain plaintext after P3 | §1.3. Destroy pre-migration backups; they are a complete bypass of everything above. |
| 11 | `crypto.subtle` unavailable (insecure origin) | Fail closed with the explicit error from `requireSubtle()`. Never fall back to storing plaintext — a silent downgrade is worse than a hard failure. |

---

# Section 4 — Trade-off & risk audit

## 4.1 Search and indexing

**What is lost:** any future `WHERE description LIKE ...` or server-side filter on content.
Ordering by `date` goes with it — [`GetSubjects`](../backend/internal/handlers/subjects.go#L266)
sorts on `date DESC`, [`summaryQuery`](../backend/internal/handlers/relationships.go#L124) computes
`MAX(date)`, and [`GetMeta`](../backend/internal/handlers/vault.go#L416) computes `MIN(date)`. All
three must move to the client.

**What it actually costs this app: close to nothing.** There is no server-side search today —
every filter in `Dashboard.jsx` runs client-side over a fully-loaded array, and
[subjects.go:263](../backend/internal/handlers/subjects.go#L263) states that pagination is
deliberately absent because the dashboard would need ~500 snapshots before the payload mattered.
The client already holds every row, so sorting and searching there is a straight relocation, not
a loss of capability.

**What it forecloses:** server-side pagination, server-side full-text search, and any
"relationships you have not scored in a while" query computed in SQL. If the product ever
outgrows load-everything, that is the moment this decision becomes expensive. Blind indexes
extend to equality only; substring search over encrypted data means order-revealing encryption,
which leaks enough to reconstruct plaintext and should not be used here.

`COUNT(*)` survives and stays server-side — cardinality is already visible metadata.

## 4.2 Background jobs and analytics

**Effectively free, because there are none.** Cadence reminders are already computed in the
browser from the latest snapshot date, and `models.go` says why: "there is no scheduler, no
email, and no push... which is what keeps 'nothing leaves this machine' true." The app was built
against this constraint before it was a constraint.

**What becomes permanently impossible:**

- Server-side aggregate analytics *derived from stored data*. Analytics is still reachable, but
  only as a separate opt-in channel that the client feeds deliberately — see
  [§5](#section-5--anonymized-analytics-over-the-userbase), which is a harder problem than it
  looks and is not solved by "strip the user id".
- Server-sent reminders — including email digests, push notifications about a due check-in, or
  anything else that requires the server to know *what* it is reminding you about. Client-scheduled
  local notifications via `@capacitor/local-notifications` still work, since the client knows.
- Server-side deduplication on import. [`isDuplicateSnapshot`](../backend/internal/handlers/vault.go#L370)
  compares dates and stats maps; both are inside the blob. Import dedup moves client-side.
- Server-side export. [`ExportVault`](../backend/internal/handlers/vault.go#L91) assembles the
  document from plaintext. It becomes a client-side assembly over decrypted rows — which is
  arguably where a document described as "the app's promise that the data is yours" belonged
  anyway.
- Operator-side debugging of a data complaint. "My scores look wrong" becomes unfalsifiable from
  the server. Budget for that in support.

## 4.3 Password reset and recovery

**Password reset by email is gone, permanently.** There is no reset — only *change* (§1.6, requires
the old password) and *recovery* (§2.4, requires the mnemonic). An administrator with root on the
database and the host cannot help a user who has lost both. That is the guarantee working, and it
will still generate angry support tickets.

Specific risks:

- **The recovery phrase is a bearer secret.** Anyone holding those 24 words has full access,
  forever, without the password. A screenshot in a cloud photo library defeats the entire system.
  The UI must say this at the moment it displays the phrase.
- **No phrase rotation without the DEK.** Reissuing requires an unlocked session, so a user who
  suspects their phrase was exposed must log in to fix it. Offer rotation in Settings and after
  every recovery.
- **Single-factor by construction.** There is no second factor that can gate decryption, because
  decryption happens client-side with material derived from the password alone.
- **Argon2id cost is a UX/security dial with a hard floor.** 64 MiB × 3 iterations may take 2–3 s
  on a low-end Android device. Per-user parameters (§1.1) let you lower it for those devices, but
  every reduction directly reduces offline-cracking cost against a stolen `wrapped_dek`. Measure
  on your oldest supported device before shipping.

## 4.4 Pre-existing issues this change surfaces

Two things found while reading the code that are not caused by this refactor but that undercut
its promise, and should be fixed alongside it:

1. **`/uploads` is served unauthenticated.** [main.go:30](../backend/cmd/server/main.go#L30)
   registers `r.Static("/uploads", "./uploads")` *outside* the protected group, and
   [upload.go](../backend/internal/handlers/upload.go) names files
   `profile_<UnixNano>.<ext>` — guessable within a narrow time window and enumerable if the
   directory is listable. Profile pictures are currently readable by anyone who can reach the
   server. Encrypting the database while serving avatars from an open directory is an
   inconsistent promise. Fix: move uploads behind `AuthMiddleware`, or encrypt them client-side
   and store the blob (the honest option, and the one consistent with everything above).

2. **`offlineCache` writes plaintext to `localStorage` on Android** ([offlineCache.js:25](../src/mobile/offlineCache.js#L25)).
   Covered in §2.5 — restating it here because if only one thing from this document gets
   implemented late, this is the one that turns the whole exercise into theatre on the platform
   the data is most likely to be carried around on.

---

# Section 5 — Anonymized analytics over the userbase

**Short answer: yes, but it cannot be derived from what is stored.** The server holds ciphertext
and no key, so there is nothing to aggregate. Analytics has to be a *second, separate channel*
that the client computes from plaintext it already has and submits deliberately, under opt-in.

That channel is easy to build and easy to build wrong. The failure mode is not a leak of the
whole vault — it is a slow reintroduction of exactly the trust relationship §1–§4 exists to
remove, in a subsystem nobody is auditing because it is "just telemetry".

## 5.1 The design rule

> **Assume every analytics submission will be attributed to a named account. Design the payload
> so that it is still safe under that assumption.**

This is not paranoia, it is the honest reading of the threat model. If the operator is the
adversary — which is the premise of this entire document — then the operator also controls
Nginx, the TLS terminator, the application logs and the database. Consider what they see even
with a perfect payload:

- **IP address and timing.** An unauthenticated `POST /api/analytics` from `1.2.3.4` fourteen
  seconds after an authenticated session from `1.2.3.4` is not anonymous in any useful sense.
- **Arrival order.** A `BIGSERIAL` primary key encodes insertion sequence. So does physical row
  order (`ctid`) even without one. Aligning that sequence against the auth log re-links
  submissions to sessions.
- **Deployment shape.** On a self-hosted instance with three users, "anonymous" is a
  one-in-three guess.

The standard mitigations — batching, random delay, stripping IPs at the edge, shuffled inserts —
all work against an *honest* operator who wants to avoid accidentally learning things. **None of
them constrain a dishonest one**, because they are all implemented on infrastructure the
adversary controls. Genuinely breaking the network link requires a third party the operator does
not run: an Oblivious HTTP relay, a trusted aggregator, or equivalent. That is real
infrastructure, and almost certainly out of scope here.

Hence the rule. The payload must survive attribution, because attribution is probably available.

## 5.2 What can and cannot be sent

| Signal | Safe? | Why |
|---|---|---|
| Per-category score, bucketed to deciles | ✅ with noise (§5.4) | One number out of ten, per category, reported independently |
| Count of relationships tracked, as a band (`1`, `2–4`, `5–9`, `10+`) | ✅ with noise | Coarse, low-cardinality |
| Median days between snapshots, as a band | ✅ with noise | Behavioural, not content |
| Which categories were marked `uncertain` (7 bits) | ✅ with noise | Fixed low-cardinality domain |
| Guide-answer distribution (already a 0–3 scale) | ✅ with noise | Coarse by construction |
| Preset context tags, from the fixed `ContextCapsule` list only | ⚠️ carefully | Fixed vocabulary is fine; the *combination* of several rare tags is not |
| **The full 7-category score vector** | ❌ | See §5.3 — this is the big one |
| Free-text `description` | ❌ never | Unbounded text is inherently re-identifying, and the highest-sensitivity field in the app |
| Relationship names, or any hash of them | ❌ never | A blind index is unlinkable *to the server*; a name hash submitted alongside analytics is a join key |
| Exact dates | ❌ | Coarsen to month at most; a precise date is a near-unique fingerprint |
| Age, MBTI type, email domain | ❌ | Classic quasi-identifiers; three of them together identify almost anyone |

## 5.3 The tension that decides how useful this can be

**Marginals are defensible. Joint distributions are re-identifying.** This is the constraint
that determines whether the feature is worth building.

Seven categories at 0–100 gives 10<sup>14</sup> possible score vectors. Bucketed hard to deciles
it is still 10<sup>7</sup> — ten million combinations. With a thousand users, essentially every
submitted vector is unique. A unique record is a pseudonym: observe the same account twice and
you have a trajectory, and a trajectory plus one external fact identifies a person.

So each category must be reported **as an independent marginal**, never as a vector sharing a
submission.

That is a genuine capability loss, and it lands squarely on the most interesting questions:

| Question | Answerable? |
|---|---|
| "What does the distribution of Trust scores look like?" | ✅ marginal |
| "How many people does a typical user track?" | ✅ marginal |
| "Which category is most often marked uncertain?" | ✅ marginal |
| "Do people who score high on Eros also score high on Ludus?" | ❌ needs the joint |
| "Do scores drift up or down over months?" | ❌ needs longitudinal linkage — i.e. a pseudonym |
| "Do users who check in weekly report higher Trust?" | ❌ needs two fields joined per user |

Pairwise marginals can be released with the privacy budget split across pairs, but with 21
pairs the per-pair budget — and therefore the accuracy — collapses. Treat correlation analysis
as unavailable.

## 5.4 Local differential privacy — the part that is not optional

Coarsening and minimum-user thresholds share a fatal property: **the client has to trust the
server about how much protection it is getting.** A client that refuses to submit unless the
deployment has 1,000 users is asking the adversary how many users the adversary has.

Local differential privacy inverts that. Noise is added **on the device, before the value
leaves**, so the guarantee holds no matter what the server does with it — including publishing
every row next to a username. It is the only mechanism in this section that does not reduce to
trusting the operator, which makes it the only one consistent with the rest of the document.

For binary or small-domain signals, randomized response is sufficient and is about fifteen lines:

```ts
// src/analytics/ldp.ts

/**
 * Randomized response (Warner, 1965) — local differential privacy for one bit.
 *
 * With probability p = e^ε/(1+e^ε) the true bit is reported; otherwise it is flipped.
 * The report is therefore plausibly deniable on its own, while the population-level
 * frequency is still recoverable by the estimator below.
 *
 * ε is a real, spendable budget: submitting k independent bits about the same user
 * costs k·ε in the worst case. Pick the per-submission total first, then divide it
 * across the questions — do not pick ε per question and let it accumulate silently.
 */
export function randomizedBit(trueBit: boolean, epsilon: number): boolean {
    const p = Math.exp(epsilon) / (1 + Math.exp(epsilon));
    return unbiasedCoin(p) ? trueBit : !trueBit;
}

/**
 * Math.random() is not acceptable here. It is not a CSPRNG, its state is recoverable
 * from a modest number of outputs, and recovering it would let an observer undo the
 * randomization and read the true bits back out. The privacy guarantee is exactly as
 * strong as this coin.
 */
function unbiasedCoin(probability: number): boolean {
    const draw = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    return draw / 0x100000000 < probability;
}

/** k-ary randomized response, for a decile bucket (k = 10). */
export function randomizedBucket(trueBucket: number, k: number, epsilon: number): number {
    const p = Math.exp(epsilon) / (Math.exp(epsilon) + k - 1);
    if (unbiasedCoin(p)) return trueBucket;
    const others = [...Array(k).keys()].filter(b => b !== trueBucket);
    return others[globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % others.length];
}
```

Recovering the true frequency server-side is a debiasing step, not a raw `COUNT`:

```go
// trueFraction inverts randomized response. Reading the raw stored fraction as if it
// were the answer is the single most likely way to misuse this table: at ε=1 a true
// rate of 10% reports as roughly 27%.
func trueFraction(observed float64, epsilon float64) float64 {
    p := math.Exp(epsilon) / (1 + math.Exp(epsilon))
    return (observed - (1 - p)) / (2*p - 1)
}
```

**How many users this needs, concretely.** At ε = 1, the standard error of the debiased estimate
is roughly `1.08/√n`:

| Users submitting | Accuracy on a yes/no question (ε = 1) |
|---|---|
| 100 | ±11 points — useless |
| 1,000 | ±3.4 points — marginal |
| 10,000 | ±1.1 points — usable |

A 10-bucket histogram is far hungrier than a single bit — the per-report signal is much weaker at
the same ε — so budget for roughly an order of magnitude more users, or a looser ε, or coarser
buckets. Decide which of the three you are spending *before* building the pipeline.

## 5.5 The reality check for this app

**This app is self-hosted.** `docker-compose.yml` and [12-android-app.md](12-android-app.md)
describe a deployment where one person runs the server for themselves. On such an instance:

- The "userbase" is one person, so an aggregate *is* that person's plaintext.
- The operator and the user are the same party, so there is no adversary — and also no analytics
  question worth answering.

The feature only becomes meaningful if you also run a **hosted multi-tenant instance** with
thousands of accounts. Both facts follow from that: it is only useful at scale, and it is only
safe at scale. Below roughly a thousand submitting users, an LDP pipeline returns noise, and a
non-LDP pipeline returns identifiable data. There is no useful configuration in between.

If what you actually want is *"let users see how their scores compare to typical"*, there is a
much better answer that costs nothing here: **ship a static reference distribution** in the
client — from published research, or from a one-off consented study — and compare locally. The
user gets the comparison, nothing is collected, and the privacy claim stays absolute.

## 5.6 If you build it anyway

```sql
-- Physically separate from user data. No user_id, no foreign key, no join path back.
-- A random UUID rather than BIGSERIAL: a sequence encodes arrival order, which is a
-- correlation key against the auth log.
CREATE TABLE analytics_reports (
    id             UUID PRIMARY KEY,
    received_on    DATE   NOT NULL,   -- DATE, not TIMESTAMPTZ: hour+minute re-links to sessions
    schema_version INT    NOT NULL,
    epsilon        REAL   NOT NULL,   -- record the budget the client actually spent
    payload        JSONB  NOT NULL
);

-- Physical row order still encodes arrival order via ctid. Buffer and shuffle-insert on
-- an interval if that matters to you — noting, per §5.1, that this constrains an honest
-- operator only.
```

Non-negotiables:

1. **Opt-in, default off, unchecked.** Not "opt-out", not a pre-ticked box, not bundled into the
   terms. The rest of this document is a promise that the product does not collect; anything
   less than affirmative consent breaks it.
2. **Show the exact payload before the first submission.** A "preview what is sent" button. The
   audience for this app has already chosen a tool that encrypts their relationship notes; they
   will read it, and they should be able to.
3. **Never route it through an authenticated request.** No JWT, no session cookie, separate
   endpoint, separate table.
4. **Submissions are irrevocable.** There is no user id, so there is nothing to delete on
   request. Under GDPR this is fine *only if* the data is genuinely anonymous — if it is merely
   pseudonymous, Article 17 applies and you cannot comply. This is a second, independent reason
   to insist on real LDP rather than "we removed the id".
5. **Version the schema and record ε per row.** Changing either later without a marker makes
   every historical row uninterpretable, and a mis-recorded ε silently invalidates the
   debiasing.
6. **Update the product copy.** [models.go:29-33](../backend/internal/models/models.go#L29-L33)
   currently states that having no server-side scheduler "is what keeps 'nothing leaves this
   machine' true", and the Vault page tells users the same thing. Ship telemetry without
   rewriting that copy and the codebase is asserting something false about itself.

---

## Appendix — implementation checklist

**P0 — schema**
- [ ] Phase 1 DDL + model changes; `make migrate-check` clean
- [ ] Dual-read in `GetSubjects` / `GetRelationships` / `ExportVault`
- [ ] Confirm `BackfillRelationships` reports zero on every deployment

**P1 — new accounts**
- [ ] `POST /api/auth/params` with the deterministic fake-salt path
- [ ] Verifier login; bcrypt cost 14 → 10
- [ ] `token_epoch` claim + middleware check
- [ ] `src/crypto/*` with round-trip and tamper-detection tests
- [ ] Signup: DEK, mnemonic, forced three-word confirmation

**P2 — migration**
- [ ] `/api/migrate/{pending,batch,verify,commit}`, `/api/me/{enroll,finalize}-encryption`
- [ ] Two-phase client loop with resume
- [ ] `X-ALQ-Client` version gate returning 426
- [ ] `offlineCache` stores ciphertext
- [ ] Export/import move client-side
- [ ] `POST /api/me/password` re-wrap
- [ ] Recovery flow

**P3 — enforcement**
- [ ] Reject plaintext writes from non-`legacy` accounts
- [ ] Phase 3 DDL (with the `DO $$` guard)
- [ ] `VACUUM FULL` / SQLite `VACUUM`
- [ ] **Destroy every pre-migration backup, WAL segment, and replica**
- [ ] Fix `/uploads` exposure
- [ ] Rewrite the Vault page copy — it can finally say the strong thing truthfully
