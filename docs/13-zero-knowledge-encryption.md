# 13 — Zero-Knowledge Envelope Encryption

A blueprint for moving this app to client-side envelope encryption (KEK/DEK), such that an
administrator with `psql` and root on the host cannot read a user's relationship data.

Status: **design, not implemented, and not on the roadmap.** Nothing in the product implements
or promises it. Phase 7 item 10 is "encryption, *if* this document is ever confirmed". If a
change needs this document to be true in order to make a claim, the claim is wrong.

Companion reading: [03-data-model.md](03-data-model.md), [05-backend.md](05-backend.md),
[11-known-issues.md](11-known-issues.md).

---

## 0. What is actually secret here

The columns that carry meaning about a human being. All plaintext today.

| Table | Column | Why it is sensitive |
|---|---|---|
| `users` | `name`, `age`, `mbti_type`, `profile_picture` | identifies the account holder |
| `relationships` | `name` | **names a third party who never consented to being in your database** |
| `relationships` | `cadence_days` | reveals attention/intensity |
| `analysis_subjects` | `name` | denormalized copy of the above |
| `analysis_subjects` | `description` | free-text notes |
| `analysis_subjects` | `stats` | the seven category scores |
| `analysis_subjects` | `tags`, `uncertain`, `guide_answers` | context and self-assessment |
| `analysis_subjects` | `date`, `kind` | temporal pattern of attention |
| `journal_entries` | `payload` | **the most sensitive text in the product** — feelings, notes, trigger labels, ritual answers, later a verbatim transcript of speech about named third parties |
| `journal_entries` | `day`, `at` | the same temporal pattern at much higher resolution |
| `journal_mentions` | `label` | a quotation of a name is a name |
| `journal_mentions` | `relationship_id` | equality only — the same fact `analysis_subjects.relationship_id` already carries |

Staying plaintext as structural: `email` (the login identifier, must be indexed), `created_at`,
`updated_at`, `deleted_at`, `user_id`, row counts, and — for journal rows — `kind`,
`schema_version`, `day` and `at`, because the server range-filters and orders on the last two.

**Phase 6's journal rows were given the shape this document needs**, on the reasoning that the
shape is cheap now and expensive later: every entry carries a client-generated `client_id`
(ready as §1.2's `alq:v1:journal:<client_id>` AAD), the sensitive text is one opaque `payload`
blob rather than typed columns, and mentions are an **ids-only** side table so a merge stays one
`UPDATE` and a count stays one query with nothing decrypted.

Two notes for whoever implements it. Person matching needs **no new blind index** — matching
happens on the client against decrypted names and the server only receives ids; the one
server-side resolution, a mention arriving as `{"name": "Lucie"}`, becomes §1.4's `name_hmac`
lookup. And **embedding vectors must never reach the server**: they are invertible to text, so a
vector column is a transcript column under another name.

**The residual metadata leak.** An administrator still learns how many people you track, how
many snapshots each has, when each row was written and edited, and — via §1.4's blind index —
*that* two snapshots concern the same person, without learning who. That is the irreducible cost
of keeping the app's stack/rename/merge behaviour. If it is unacceptable, the app has to stop
modelling relationships as server-side rows, which is a different product.

`AppLock` ([src/components/AppLock.jsx](../src/components/AppLock.jsx)) is honest that it is "a
curtain, not a safe". This document is the safe; AppLock stays as a complementary screen lock.

---

# Section 1 — Target cryptographic & schema architecture

## 1.1 Key hierarchy

```
password ──Argon2id(salt, m=64MiB, t=3, p=1)──> masterSecret (32B)
                          │
     ┌────────────────────┴────────────────────┐
 HKDF("alq:kek:v1")                HKDF("alq:auth-verifier:v1")
     │                                         │
    KEK (AES-256-GCM)                  authVerifier (32B) ──> server stores bcrypt(verifier)
     │
     └── AES-256-GCM wrap ──> wrapped_dek  (users)
                                   ▲
                                  DEK (32 random bytes)
                                   │  ├── HKDF("alq:blind:name:v1") ──> nameHmacKey ── blind index
                                   │  └── AES-256-GCM ──> every row blob
                                   │
     recoveryKEK ──HKDF("alq:recovery-kek:v1")── entropy (32B) ──BIP-39──> 24-word mnemonic
          └── AES-256-GCM wrap ──> recovery_wrapped_dek  (users)
```

Four properties do the work:

1. **The DEK is generated once and never changes.** Everything else wraps it, which is why a
   password change is O(1) rather than O(rows) — §1.6.
2. **The KEK and the auth verifier are siblings, not parent and child.** Possessing the verifier
   (which the server has) gives no path to the KEK. Deriving the verifier *from* the KEK would
   hand the server the wrapping key.
3. **The recovery mnemonic wraps the same DEK independently.** Changing the password does not
   re-issue it; losing the password does not invalidate it.
4. **The DEK never leaves the client** — not at signup, migration, or password change.

### Why these primitives

| Need | Choice | Why not the alternative |
|---|---|---|
| KDF | Argon2id via [`hash-wasm`](https://github.com/Daninet/hash-wasm) | Web Crypto has no Argon2; its PBKDF2 is GPU-friendly and a poor fit for a phone-typed password. ~20 KB of WASM, no native dependency — which matters inside a Capacitor WebView |
| AEAD | AES-256-GCM via Web Crypto | Native, hardware-accelerated on ARMv8, no bundle cost. ChaCha20-Poly1305 needs libsodium.js (~200 KB) and only wins without AES-NI/ARMv8-Crypto, which this app does not target |
| Key wrap | AES-256-GCM, not AES-KW | AES-KW is deterministic and has no AAD. GCM binds the wrap to the salt and key version, detecting an admin swapping one user's `wrapped_dek` for another's |
| Recovery | [`@scure/bip39`](https://github.com/paulmillr/scure-bip39) | Audited, 3 KB, no Buffer/Node shims inside a WebView |
| Blind index | HMAC-SHA256 via Web Crypto | Keyed, so unlike a bare hash of a first name it is not dictionary-attackable |

> **Do not use BIP-39's `mnemonicToSeed`.** Its PBKDF2-HMAC-SHA512 × 2048 is stretching for
> user-chosen passphrases. This mnemonic already carries 256 machine-generated bits, so
> stretching buys nothing and costs a visible pause on a phone. Use `mnemonicToEntropy` and HKDF
> the raw entropy.

### Argon2id parameters

**m=64 MiB, t=3, p=1, 32-byte output, 16-byte random salt** — comfortably above the OWASP floor
(m=19 MiB, t=2, p=1). Stored **per user in the database**, not as a constant, so they can be
raised for new users and lowered for a low-end device without stranding anyone. Budget ~0.5 s on
desktop and 1–3 s on a mid-range phone; measure on the oldest supported device first. Every
reduction directly reduces offline-cracking cost against a stolen `wrapped_dek`.

## 1.2 Envelope format

One self-describing layout everywhere — wrapped DEKs and row payloads alike:

```
version (1B) │ IV (12B) │ ciphertext │ GCM tag (16B)
```

Web Crypto appends the tag to the ciphertext, so the last two are one buffer in code. The
version byte is the sole mechanism for ever changing the format.

Stored as `BYTEA` (SQLite: `BLOB`), not base64 text: base64 costs 33 % of table size, and Go's
`encoding/json` already marshals `[]byte` to base64 on the wire — the JSON-safe representation
comes free at the API boundary and costs nothing at rest.

### AAD binding

Every AEAD operation is bound to associated data, so a blob is valid only in the slot it was
written to. Without it, an administrator can copy row 7's blob over row 8 and the client
decrypts it happily as authentic.

| Blob | AAD |
|---|---|
| `users.wrapped_dek` | `alq:v1:dek:<base64(kdf_salt)>:<key_version>` |
| `users.recovery_wrapped_dek` | `alq:v1:rdek:<base64(kdf_salt)>:<key_version>` |
| `users.profile_blob` | `alq:v1:profile:<client_id>` |
| `relationships.blob` | `alq:v1:relationship:<client_id>` |
| `analysis_subjects.blob` | `alq:v1:subject:<client_id>` |

Not in the AAD: the server-assigned `id`. It does not exist until after the `INSERT`, so it
cannot be an input to encryption that happens before it. Hence every encrypted row gains a
**client-generated `client_id` UUID** — which also makes §3's migration batches idempotent under
retry. The DEK wrap binds to the salt rather than `user_id` for the same reason: at signup the
client does not yet know its `user_id`, and the salt is client-generated and already being sent.

## 1.3 Schema changes (DDL)

`AutoMigrate` ([database.go:60](../backend/internal/database/database.go#L60)) handles additive
columns and does not drop any — so Phase 1 is expressed as model changes, and Phase 3's
destruction is explicit SQL run deliberately.

**Phase 1 — additive, backward compatible.**

| Table | Added |
|---|---|
| `users` | `kdf_algo` (default `argon2id`), `kdf_salt`, `kdf_mem_kib` (65536), `kdf_iterations` (3), `kdf_parallelism` (1); `wrapped_dek`, `recovery_wrapped_dek`, `recovery_created_at`; `key_version` (0), `token_epoch` (0); `encryption_status` (`legacy`\|`migrating`\|`encrypted`, CHECK-constrained); `client_id`, `profile_blob` |
| `relationships` | `client_id`, `blob` (`{name, cadence_days}`), `name_hmac`, `is_encrypted` |
| `analysis_subjects` | `client_id`, `blob`, `is_encrypted`, `schema_version` (1) |

Two constraints carry weight. `key_version` is in the DEK-wrap AAD, so a replayed old
`wrapped_dek` fails authentication instead of silently working. And
`CHECK (encryption_status <> 'encrypted' OR (kdf_salt IS NOT NULL AND wrapped_dek IS NOT NULL))`
turns a botched migration into a failed transaction rather than an unopenable account.

Indexes: `UNIQUE (user_id, name_hmac) WHERE deleted_at IS NULL AND name_hmac IS NOT NULL`;
`UNIQUE (user_id, client_id) WHERE client_id IS NOT NULL` on subjects; and a partial index on
`is_encrypted = FALSE` to drive the migration.

> **On that partial unique index.** [models.go:22-24](../backend/internal/models/models.go#L22-L24)
> left relationship-name uniqueness to the handlers because "soft deletes would need a partial
> unique index, and those are spelled differently on SQLite and Postgres". The
> `CREATE UNIQUE INDEX … WHERE` form is in fact accepted by both (SQLite since 3.8.0, 2013).
> Keep the handler check as the source of the friendly 409 and treat the index as defence in
> depth against a racing double-insert.

**Phase 3 — destructive, only when no `legacy` or `migrating` user remains.** Drop the plaintext
columns listed in §0, then `ALTER … SET NOT NULL` on both `blob` columns. Guard it with a
`DO $$` block that raises unless every user is `encrypted` and every subject `is_encrypted` —
dropping these while one user still needs them destroys their data irrecoverably.

**Three follow-ups, none optional.** `DROP COLUMN` only marks the column dropped in the
catalogue; the bytes stay in the heap until every tuple is rewritten.

1. `VACUUM FULL` (or `pg_repack`) to rewrite the heap. SQLite: `VACUUM;` plus deleting the
   `-wal` and `-shm` sidecars.
2. **Destroy every database backup taken before this point.** A zero-knowledge database with a
   nightly plaintext dump in object storage is a plaintext database with an extra step.
3. Rotate WAL segments and any replica — they carry the old tuples too.

**Model changes.** `users.password` does not move: it holds `bcrypt(password)` while `legacy`
and `bcrypt(verifier)` once `encrypted`, with `EncryptionStatus` saying which — that is what
keeps the legacy login path working untouched during the migration window. Legacy plaintext
fields become `json:"-"` from Phase 2 so a migrated client cannot read a stale value, and are
dropped in Phase 3. A subject's cleartext blob is
`{v, name, kind, date, description, stats, tags, uncertain, guide_answers}` — `name` kept for
export/rollback, with the relationship blob authoritative.

## 1.4 The blind index — how stacks survive encryption

The part specific to *this* codebase, and the part a generic "just encrypt the columns" answer
gets wrong. Three load-bearing behaviours resolve relationships by name **on the server**:
[`FindOrCreateRelationship`](../backend/internal/database/backfill.go#L126) on every snapshot
write, the uniqueness check at
[relationships.go:271](../backend/internal/handlers/relationships.go#L271), and the rename
cascade at [relationships.go:288](../backend/internal/handlers/relationships.go#L288). Encrypt
`name` naively and all three break: AES-GCM is randomized, so `WHERE name = ?` can never match.

```
name_hmac = HMAC-SHA256( HKDF(DEK, "alq:blind:name:v1"), NFC(trim(name)) )
```

The server compares `name_hmac` for equality and enforces uniqueness on `(user_id, name_hmac)`.
It never learns the name.

- **Not dictionary-attackable.** A bare `SHA-256("Alex")` falls to a first-name wordlist in
  milliseconds; the HMAC key comes from the DEK, which the server does not have.
- **Leaks equality only** — that two snapshots concern the same person, which
  `relationship_id` already revealed.
- **Preserves the case policy exactly.** NFC + trim, deliberately *not* lowercase, so "Alex" and
  "alex" remain two people as
  [backfill.go:124-125](../backend/internal/database/backfill.go#L124-L125) specifies. NFC
  matters because a name typed on iOS and on Android can differ byte-for-byte while looking
  identical.
- **Per-user key**, so values are incomparable across accounts.

Rename: re-encrypt the blob, recompute `name_hmac`, `PATCH` both. Merge copies `name_hmac`
instead of `name`.

## 1.5 Authentication without sending the password

Once the KEK derives from the password, sending the password lets a compromised server derive
the KEK and unwrap the DEK — which would make the whole exercise theatre. So login is two round
trips:

```
POST /api/auth/params  { email }
  → { kdf_salt, kdf_mem_kib, kdf_iterations, kdf_parallelism, encryption_status }
  client: masterSecret = Argon2id(password, kdf_salt, params)
          verifier     = HKDF(masterSecret, "alq:auth-verifier:v1")

POST /api/login        { email, verifier }
  → { token, wrapped_dek, key_version, encryption_status }
  client: KEK = HKDF(masterSecret, "alq:kek:v1")
          DEK = AES-GCM-decrypt(KEK, wrapped_dek, aad)
```

The server bcrypts the verifier exactly as it bcrypts the password today, so
[`auth.HashPassword`](../backend/internal/auth/auth.go#L41) and `CheckPasswordHash` are reused
unchanged. Two notes:

- **Lower the bcrypt cost from 14 to 10.** Cost 14 exists to slow brute force against a
  low-entropy human password; the verifier is a 256-bit HKDF output and is not brute-forceable
  at any cost factor. Keeping 14 adds ~1 s of server CPU per login on top of the client's 1–3 s
  of Argon2id.
- **`/api/auth/params` must not become a user-enumeration oracle.** For an unknown email return
  a *deterministic* fake: `kdf_salt = HMAC(server_secret, lower(email))` truncated to 16 bytes,
  default parameters, `encryption_status: "encrypted"`. Determinism matters — a random salt per
  request is detectable by asking twice. Residual: during the migration window a genuine
  `legacy` response proves the account exists, because unknown emails always answer `encrypted`.
  That oracle closes when the last account migrates; rate-limit per IP meanwhile.

## 1.6 Password change protocol

The DEK is immutable, so a password change re-wraps 32 bytes and touches **no** row of user
data, whether the user has 10 snapshots or 100,000.

```
client (session DEK already in memory):
  verifierOld   = HKDF(Argon2id(oldPassword, currentSalt, currentParams), "alq:auth-verifier:v1")
  newSalt       = 16 random bytes
  masterNew     = Argon2id(newPassword, newSalt, currentParams)
  kekNew        = HKDF(masterNew, "alq:kek:v1");  verifierNew = HKDF(masterNew, "alq:auth-verifier:v1")
  wrappedDekNew = AES-GCM(kekNew, DEK, aad="alq:v1:dek:<b64(newSalt)>:<keyVersion+1>")
  POST /api/me/password { verifier_old, kdf_salt, kdf_params, verifier_new, wrapped_dek, expected_key_version }

server, ONE transaction:
  SELECT … FOR UPDATE                    -- serializes two devices
  bcrypt-compare verifier_old            -- 401 on mismatch
  reject if key_version <> expected      -- 409, someone else changed it first
  UPDATE password, kdf_*, wrapped_dek, key_version+1, token_epoch+1
```

- **`recovery_wrapped_dek` is untouched** — the phrase issued at signup still works after any
  number of password changes. Users must be told, or they will assume it is stale and discard it.
- **`key_version` is in the AAD**, so an administrator restoring an old `wrapped_dek` from a
  backup gets an AEAD failure rather than a silently-working old password.
- **`token_epoch` increments**, which is what logs out other devices. Add `epoch` to the JWT
  claims and compare it in [`AuthMiddleware`](../backend/internal/handlers/middleware.go) — that
  makes token validation a DB read per request, the honest price of being able to revoke.
- **The changing device keeps working**; it already holds the DEK and just needs the new token.

Password *reset*, as distinct from change, does not exist and cannot — §4.3.

---

# Section 2 — Implementation

Dependencies: `npm install hash-wasm @scure/bip39` — both dependency-free and WebView-safe,
~25 KB gzipped total. Vite compiles `.ts` with no config change, so the crypto layer can be
TypeScript alongside the existing JSX.

Four modules, and the decisions inside them that are not obvious:

| Module | Surface | The decisions |
|---|---|---|
| `src/crypto/primitives.ts` | `requireSubtle`, `randomBytes`, `wipe`, `toBase64`/`fromBase64`, `hkdf`, `importAesKey`, `importHmacKey`, `seal`/`open`, `sealJson`/`openJson` | The only file that touches `crypto.subtle`. `pack`/`unpack` is the single place the §1.2 layout is written down. HKDF uses an **empty salt** deliberately — the IKM is already 32 uniformly-random bytes, so Expand alone suffices and `info` is what separates branches. Keys import **non-extractable**, so material stays outside the JS heap. `open` throws one indistinguishable error for wrong key, corruption and AAD mismatch, by design |
| `src/crypto/keys.ts` | `DEFAULT_KDF`, `deriveFromPassword`, `createVault`, `unlockVault`, `rewrapForNewPassword`, `VaultKeys {dek, nameHmacKey}` | The blind-index key must be derived while the DEK is still **raw** — once imported non-extractably it can no longer be HKDF input, which is why one `expand()` produces both keys. `createVault` produces password, DEK and phrase in one pass so they can never disagree about which DEK they wrap |
| `src/crypto/vault.ts` | `newClientId`, `blindIndex`, `encrypt`/`decrypt` for subject and relationship, `decryptList` | `blindIndex` is NFC + trim and **not** lowercased, per §1.4. `decryptList` isolates failures via `allSettled`: one unreadable row must not blank the dashboard, and failures are surfaced rather than swallowed |
| `src/crypto/recovery.ts` | `generateRecoveryPhrase`, `isValidRecoveryPhrase`, `normalizePhrase`, `recoveryKekFromMnemonic` | 24 words over 32 CSPRNG bytes: 256 bits plus the checksum that turns a mistyped word into a clean error. HKDF the raw entropy — never `mnemonicToSeed` (§1.1) |

Random 96-bit IVs are safe by a wide margin here: collisions stay negligible below ~2³²
encryptions under one key, and a heavy user produces a few thousand writes in a lifetime. DEK
rotation for nonce exhaustion is not a concern at this scale.

> **One wrinkle.** `rewrapForNewPassword` needs the *raw* DEK, but the session deliberately holds
> a non-extractable key. Either (a) hold the raw DEK in a closure for the session — simpler,
> weaker — or (b) re-derive the old KEK from the old password the user is already typing into
> the change-password form and unwrap again. **Prefer (b):** the cost is invisible and the raw
> DEK never outlives a single function call.

**Recovery flow.** User supplies email + phrase + a new password. The server returns
`recovery_wrapped_dek`, `kdf_salt` and `key_version` (rate-limited hard). The client unwraps with
the recovery KEK, derives a fresh KEK from the new password, re-wraps, and posts the new
`kdf_salt` / `verifier` / `wrapped_dek` with incremented `key_version` and `token_epoch`. Offer
to reissue the phrase there: it has just been typed into a form and may have been in a clipboard.

## 2.5 Session key handling

**Where the DEK lives:** a module-scoped variable inside a React context provider, as a
non-extractable `CryptoKey`. Nowhere else.

**Where it must never live:** `localStorage`/`sessionStorage`; **`@capacitor/preferences`** —
the trap, because it is backed by Android `SharedPreferences`, a **plaintext XML file** readable
on any rooted device or via `adb backup` on a debuggable build; devtools-visible state; error
reports; or a React prop that could reach a serialized error boundary.

**On wiping memory, honestly.** JavaScript cannot guarantee erasure — the GC copies objects,
strings are immutable, and `fill(0)` scrubs only the copy you hold. `wipe()` is risk reduction,
not a guarantee. The real mitigation is the non-extractable `CryptoKey`: that material lives
outside the JS heap, so it survives no heap snapshot and no XSS read.

`lockVault()` drops the keys first — so an in-flight render that tries to decrypt after it fails
closed — then clears the cache and the token. Call it on explicit logout, `AppLock`'s existing
15-minute idle timeout ([AppLock.jsx:14](../src/components/AppLock.jsx#L14)), Capacitor's
`appStateChange` to background, and any `401`.

**Consequence: page refresh logs the user out.** The DEK cannot survive a reload without being
persisted, and every available "somewhere" is plaintext. This is a real UX regression and must be
a deliberate, communicated decision. If it proves intolerable on Android, the only sound fix is
wrapping the DEK with a hardware-backed Android Keystore key
(`setUserAuthenticationRequired(true)`, biometric-unlocked) via a native plugin — meaningful
work, not a config flag. Do not substitute `Preferences`.

**`offlineCache.js` must hold ciphertext, and it now holds two things.** It writes the decrypted
subject list to `localStorage` on native
([offlineCache.js:56](../src/mobile/offlineCache.js#L56)) and, since F1 (2026-09-04), the
**journal outbox** ([offlineCache.js:131](../src/mobile/offlineCache.js#L131)). The cache must
store rows exactly as fetched and decrypt on read; the outbox must be handed a body whose
`payload` is already sealed — easier, because it never inspects `payload`, so the envelope goes
in at `createEntry`. It is also the more urgent of the two, being the one copy of the user's
writing the server has never seen. Otherwise the phone holds a plaintext copy of everything the
server is no longer allowed to see, making the Android build the weakest link in the system.

---

# Section 3 — Migrating existing data

## 3.1 Feasibility

**A server-side background migration is impossible** — and the impossibility is the feature
working. Encrypting a user's rows needs their DEK; the DEK is wrapped by a KEK derived from
their password; the server stores only `bcrypt(...)`, which is one-way. If the server had a
path, so would an administrator.

1. **Migration happens only while a user is logged in with their password in memory** — one
   moment, immediately after a successful login.
2. **It is a client-side data transfer, not a SQL script.** Rows are fetched plaintext,
   encrypted in the browser, written back. Seconds for a heavy user; still a network loop.
3. **Some accounts will never migrate.** Anyone who never logs in again is permanently legacy.

## 3.2 Rollout phases

| Phase | Server | Client | Exit condition |
|---|---|---|---|
| **P0** Schema | Phase 1 DDL. Dual-read: serve `blob` if `is_encrypted`, else plaintext. Accept both write shapes | Unchanged | Deployed, no behaviour change |
| **P1** New accounts | `/api/auth/params`, verifier login, `/api/me/enroll-encryption` | Signup generates DEK + mnemonic; new accounts start `encrypted` | New signups are zero-knowledge |
| **P2** Lazy migration | `/api/migrate/batch`, `/api/me/finalize-encryption` | On-login enrollment + resumable batch loop | `legacy` count trends to zero |
| **P3** Enforcement | Reject plaintext writes. Phase 3 DDL. `VACUUM FULL`. Destroy old backups | Drop all legacy read paths | No plaintext remains |

Do not compress P0 and P1. P0 deployed alone for a release cycle is what proves the dual-read
path works before any data depends on it.

## 3.3 On-login migration

1. User logs in on the legacy path; server returns `encryption_status: "legacy"`.
2. Client enters a **blocking** one-time flow. Blocking is deliberate: a half-migrated account
   edited by a user who dismissed the prompt is the worst reachable state.
3. **"Download a copy of your data first"** — reuse `GET /api/export`
   ([vault.go:91](../backend/internal/handlers/vault.go#L91)). This is the last moment the
   server can produce a plaintext file, and the only backstop that survives every failure below,
   including "user forgets password and loses the phrase".
4. Show the 24-word phrase and **require three randomly-chosen words back**. Not a checkbox:
   this is the single point where irreversible loss of access is created.
5. `POST /api/me/enroll-encryption` → `encryption_status = 'migrating'`. The server **keeps** the
   old `bcrypt(password)`, which is what lets an interrupted migration log in the old way
   tomorrow.
6. The batch loop below — resumable, idempotent.
7. `POST /api/me/finalize-encryption`, in one transaction: verify zero unencrypted subjects and
   relationships, set `password = bcrypt(verifier)` (legacy login dies here),
   `encryption_status = 'encrypted'`, `token_epoch + 1`. A finalize that finds one unmigrated row
   must 409, not "mostly succeed".

**The batch loop is two-phase, and that is the crux.** Batches of 50, relationships first — a
snapshot's blind index depends on its relationship's name, so migrating subjects against
unmigrated relationships would need a second pass.

- **Phase A** `/api/migrate/batch` writes the ciphertext, leaving the plaintext columns intact.
- **Phase B** `/api/migrate/verify` re-fetches what the server actually stored, the client
  decrypts it to prove it round-trips, and only then `/api/migrate/commit` nulls the plaintext.

A single-phase "encrypt and overwrite" is one dropped connection from a row whose plaintext is
gone and whose ciphertext never arrived. Two-phase means every intermediate state is readable by
someone: after A the plaintext is still authoritative, after B the ciphertext is proven.

`commit` is the only statement that destroys anything, and its `WHERE` carries
`blob IS NOT NULL` — structurally preventing a commit from clearing plaintext on a row that
never received ciphertext, whatever ids the client sends. It uses `UpdateColumns` rather than
`Updates`, matching [backfill.go:78](../backend/internal/database/backfill.go#L78): a mechanical
migration should not make every row look freshly edited. Retries are idempotent by construction.

**Run the relationship backfill first.**
[`BackfillRelationships`](../backend/internal/database/backfill.go#L35) groups legacy snapshots
by `TRIM(name)` to assign `relationship_id`, and it reads plaintext names — so **after
encryption it can never run again**. Confirm it has completed and reported zero on every
deployment *before* P2 begins. A snapshot reaching encryption with `relationship_id IS NULL`
becomes permanently unlinkable.

## 3.4 Inactive accounts

Generic SaaS advice does not apply: this app has **no scheduler, no email, and no push**
([models.go:29-33](../backend/internal/models/models.go#L29-L33)), so there is no way to notify a
dormant user, and adding one is a larger project than this migration. More importantly it is
**self-hosted** — the operator and the user are usually the same person, and "inactive accounts"
means "the test account I made in February".

**For the self-hosted case:** add `GET /api/admin/encryption-status` returning
`{legacy, migrating, encrypted}` counts; leave `legacy` accounts working indefinitely (they are
no worse off than today); surface the state honestly on the Vault page; and gate P3 on the count
reaching zero, which the `DO $$` guard enforces mechanically.

**Multi-tenant** has only three options, none free: wait indefinitely (plaintext persists, P3
never runs); export stragglers to an archive keyed by a server-held key, then purge — honest,
but those accounts are *not* zero-knowledge and must be labelled so; or delete after a stated
notice period, which is clean but needs the notification channel you do not have. Pick one and
document it, because "undecided" resolves in practice to the first.

## 3.5 Data-loss edge cases

| # | Scenario | Guard |
|---|---|---|
| 1 | User forgets password, never saved the phrase | **Unrecoverable — accept it.** Mitigated by the forced three-word confirmation and the pre-migration export. The cost of the feature, not a bug in it |
| 2 | Network drops mid-batch | Two-phase commit. After Phase A the plaintext is still authoritative; the loop resumes from `/api/migrate/pending` |
| 3 | Ciphertext written, plaintext cleared, blob later fails to open | Phase B decrypts a server round-trip *before* commit, so an unreadable blob never reaches commit |
| 4 | Two devices migrate concurrently | `enroll-encryption` rejects unless `encryption_status = 'legacy'` under `SELECT … FOR UPDATE`. The loser gets 409. Two DEKs for one account is the unrecoverable case this prevents |
| 5 | Old Android APK hits a migrated account | **Side-loaded APKs cannot be force-updated.** Require an `X-ALQ-Client` version header and return **426 Upgrade Required**. Without it an old client reads `blob` as absent and renders an empty vault, which users report as data loss |
| 6 | Password changed mid-migration | Reject `/api/me/password` with 409 while `migrating` |
| 7 | `offlineCache` holds pre-migration plaintext | `clearCache()` on enroll, then re-fetch ([offlineCache.js:87](../src/mobile/offlineCache.js#L87)) |
| 7b | The **journal outbox** holds pre-migration plaintext | It cannot simply be cleared — its rows exist nowhere else. Flush it before enrolling and refuse to enrol while non-empty, or re-seal each queued body. `clearOutbox()` ([offlineCache.js:148](../src/mobile/offlineCache.js#L148)) is the wrong tool |
| 8 | User imports an old plaintext export after migrating | Import moves client-side. [`ImportVault`](../backend/internal/handlers/vault.go#L173) must reject plaintext bodies from encrypted accounts rather than storing them |
| 9 | Half-migrated account, user edits a snapshot | Block writes while `migrating`; server also rejects plaintext writes when `encryption_status <> 'legacy'` |
| 10 | Backups still contain plaintext after P3 | §1.3 — destroy them; they bypass everything above |
| 11 | `crypto.subtle` unavailable (insecure origin) | Fail closed with an explicit error. Never fall back to plaintext — a silent downgrade is worse than a hard failure |

---

# Section 4 — Trade-off & risk audit

## 4.1 Search and indexing

**Lost:** any server-side filter on content, and ordering by `date` —
[`GetSubjects`](../backend/internal/handlers/subjects.go#L266) sorts on `date DESC`,
[`summaryQuery`](../backend/internal/handlers/relationships.go#L124) computes `MAX(date)`, and
[`GetMeta`](../backend/internal/handlers/vault.go#L416) computes `MIN(date)`. All three move to
the client.

**Actual cost: close to nothing.** There is no server-side search today; every filter in
`Dashboard.jsx` runs client-side over a fully-loaded array, and
[subjects.go:263](../backend/internal/handlers/subjects.go#L263) states pagination is
deliberately absent because the dashboard would need ~500 snapshots before the payload mattered.
The client already holds every row, so this is a relocation, not a loss.

**Foreclosed:** server-side pagination, full-text search, and any "not scored in a while" query
in SQL. Blind indexes extend to equality only; substring search over encrypted data means
order-revealing encryption, which leaks enough to reconstruct plaintext. `COUNT(*)` survives —
cardinality is already visible metadata.

## 4.2 Background jobs and analytics

**Effectively free, because there are none.** Cadence reminders are already computed in the
browser, and `models.go` says why: "there is no scheduler, no email, and no push… which is what
keeps 'nothing leaves this machine' true." The app was built against this constraint before it
was one.

**Permanently impossible:** server-side aggregate analytics derived from stored data (only the
separate opt-in channel of [§5](#section-5--anonymized-analytics-over-the-userbase) remains);
server-sent reminders of any kind that require the server to know *what* it is reminding you
about — client-scheduled local notifications still work; server-side import dedup
([`isDuplicateSnapshot`](../backend/internal/handlers/vault.go#L370) compares dates and stats,
both inside the blob); server-side export
([`ExportVault`](../backend/internal/handlers/vault.go#L91)), which becomes client-side assembly
— arguably where "the app's promise that the data is yours" belonged anyway; and operator-side
debugging of a data complaint, which becomes unfalsifiable from the server. Budget for that in
support.

## 4.3 Password reset and recovery

**Password reset by email is gone, permanently.** There is only *change* (§1.6, needs the old
password) and *recovery* (§2.4, needs the mnemonic). An administrator with root cannot help a
user who has lost both. That is the guarantee working, and it will still generate angry tickets.

- **The recovery phrase is a bearer secret.** Anyone holding those 24 words has full access
  forever, without the password. A screenshot in a cloud photo library defeats the entire
  system, and the UI must say so at the moment it displays the phrase.
- **No phrase rotation without the DEK** — reissuing needs an unlocked session. Offer rotation in
  Settings and after every recovery.
- **Single-factor by construction.** No second factor can gate decryption, because decryption
  happens client-side from the password alone.
- **Argon2id cost is a UX/security dial with a hard floor** — see §1.1.

## 4.4 Pre-existing issues this change surfaces

Not caused by this refactor, but they undercut its promise and should be fixed alongside it:

1. **`/uploads` is served unauthenticated.** [main.go:30](../backend/cmd/server/main.go#L30)
   registers `r.Static("/uploads", "./uploads")` *outside* the protected group, and
   [upload.go](../backend/internal/handlers/upload.go) names files `profile_<UnixNano>.<ext>` —
   guessable within a narrow window and enumerable if the directory is listable. Encrypting the
   database while serving avatars from an open directory is an inconsistent promise.
2. **`offlineCache` writes plaintext to `localStorage` on Android** — the subject list and, since
   F1, the journal outbox. Covered in §2.5; restated because if only one thing here is
   implemented late, this is the one that turns the exercise into theatre on the platform the
   data is most likely to be carried around on.

---

# Section 5 — Anonymized analytics over the userbase

**Short answer: yes, but it cannot be derived from what is stored.** The server holds ciphertext
and no key, so there is nothing to aggregate. Analytics must be a *second, separate channel* the
client computes from plaintext it already has and submits under opt-in. The failure mode is not
a leak of the vault — it is slowly reintroducing exactly the trust relationship §1–§4 exists to
remove, inside a subsystem nobody audits because it is "just telemetry".

## 5.1 The design rule

> **Assume every analytics submission will be attributed to a named account. Design the payload
> so that it is still safe under that assumption.**

If the operator is the adversary — the premise of this document — they also control Nginx, the
TLS terminator, the logs and the database. Even with a perfect payload they see the **IP and
timing** (an unauthenticated POST fourteen seconds after an authenticated session from the same
address is not anonymous), the **arrival order** (a `BIGSERIAL` encodes it, and so does `ctid`
without one — aligning that against the auth log re-links submissions to sessions), and the
**deployment shape** (on an instance with three users, "anonymous" is a one-in-three guess).

Batching, random delay, stripping IPs at the edge and shuffled inserts all work against an
*honest* operator; **none constrain a dishonest one**, because all are implemented on
infrastructure the adversary controls. Genuinely breaking the link needs a third party the
operator does not run — an Oblivious HTTP relay or a trusted aggregator — which is almost
certainly out of scope.

## 5.2 What can and cannot be sent

| Signal | Safe? | Why |
|---|---|---|
| Per-category score, bucketed to deciles | ✅ with noise (§5.4) | One number out of ten, per category, reported independently |
| Relationship count as a band (`1`, `2–4`, `5–9`, `10+`) | ✅ with noise | Coarse, low-cardinality |
| Median days between snapshots, as a band | ✅ with noise | Behavioural, not content |
| Which categories were marked `uncertain` (7 bits) | ✅ with noise | Fixed low-cardinality domain |
| Guide-answer distribution (0–3 scale) | ✅ with noise | Coarse by construction |
| Preset context tags, from the fixed list only | ⚠️ carefully | The fixed vocabulary is fine; a *combination* of several rare tags is not |
| **The full 7-category score vector** | ❌ | §5.3 |
| Free-text `description` | ❌ never | Unbounded text is inherently re-identifying |
| Relationship names, or any hash of them | ❌ never | A blind index is unlinkable *to the server*; a name hash sent alongside analytics is a join key |
| Exact dates | ❌ | Coarsen to month at most |
| Age, MBTI type, email domain | ❌ | Classic quasi-identifiers; three together identify almost anyone |

## 5.3 The tension that decides how useful this can be

**Marginals are defensible. Joint distributions are re-identifying.** Seven categories at 0–100
gives 10¹⁴ possible vectors; bucketed hard to deciles it is still 10⁷. With a thousand users
essentially every submitted vector is unique — and a unique record is a pseudonym: observe the
same account twice and you have a trajectory, and a trajectory plus one external fact identifies
a person. So each category must be reported **as an independent marginal**, never as a vector
sharing a submission.

Answerable: the distribution of a single category, how many people a typical user tracks, which
category is most often uncertain. Not answerable: any correlation between two categories (needs
the joint), drift over months (needs longitudinal linkage, i.e. a pseudonym), or "do weekly
checkers report higher Trust" (needs two fields joined per user). Pairwise marginals are possible
with the budget split across 21 pairs, at which point accuracy collapses — treat correlation
analysis as unavailable.

## 5.4 Local differential privacy — the part that is not optional

Coarsening and minimum-user thresholds share a fatal property: **the client has to trust the
server about how much protection it is getting.** A client that refuses to submit unless the
deployment has 1,000 users is asking the adversary how many users the adversary has.

LDP inverts that — noise is added **on the device, before the value leaves**, so the guarantee
holds no matter what the server does, including publishing every row next to a username. It is
the only mechanism here that does not reduce to trusting the operator.

Randomized response (Warner, 1965) is about fifteen lines: with probability
`p = e^ε/(1+e^ε)` report the true bit, otherwise flip it; the k-ary form for a decile bucket uses
`p = e^ε/(e^ε + k − 1)`. Two things are non-obvious and both are load-bearing:

- **`Math.random()` is not acceptable.** It is not a CSPRNG and its state is recoverable from a
  modest number of outputs — recovering it would let an observer undo the randomization and read
  the true bits back. Use `crypto.getRandomValues`. The privacy guarantee is exactly as strong as
  this coin.
- **ε is a real, spendable budget.** k independent bits about the same user cost k·ε in the worst
  case. Pick the per-submission total first, then divide it across questions.

Server-side recovery is a debiasing step, not a `COUNT`:
`trueFraction = (observed − (1 − p)) / (2p − 1)`. Reading the raw stored fraction as the answer
is the most likely misuse — at ε=1 a true rate of 10 % reports as roughly 27 %.

At ε = 1 the standard error is roughly `1.08/√n`:

| Users submitting | Accuracy on a yes/no question (ε = 1) |
|---|---|
| 100 | ±11 points — useless |
| 1,000 | ±3.4 points — marginal |
| 10,000 | ±1.1 points — usable |

A 10-bucket histogram is far hungrier at the same ε — budget roughly an order of magnitude more
users, or a looser ε, or coarser buckets. Decide which of the three you are spending *before*
building the pipeline.

## 5.5 The reality check for this app

**This app is self-hosted.** On such an instance the "userbase" is one person, so an aggregate
*is* that person's plaintext — and the operator and user are the same party, so there is no
adversary and no question worth answering. The feature only becomes meaningful with a hosted
multi-tenant instance of thousands of accounts. Both facts follow: it is only useful at scale,
and only safe at scale. Below roughly a thousand submitting users an LDP pipeline returns noise
and a non-LDP pipeline returns identifiable data. There is no useful configuration between.

If what you want is *"let users see how their scores compare to typical"*, **ship a static
reference distribution** in the client and compare locally. The user gets the comparison,
nothing is collected, and the privacy claim stays absolute.

## 5.6 If you build it anyway

A table physically separate from user data — no `user_id`, no foreign key, no join path back:
`analytics_reports (id UUID PK, received_on DATE, schema_version INT, epsilon REAL, payload
JSONB)`. A random UUID rather than `BIGSERIAL` because a sequence encodes arrival order, and
`DATE` rather than `TIMESTAMPTZ` because hour+minute re-links to sessions. Physical row order
still encodes arrival via `ctid`; buffer and shuffle-insert if that matters, noting per §5.1 that
it constrains an honest operator only.

Non-negotiables:

1. **Opt-in, default off, unchecked.** Not opt-out, not pre-ticked, not bundled into terms.
2. **Show the exact payload before the first submission.** This audience will read it.
3. **Never route it through an authenticated request.** No JWT, separate endpoint, separate table.
4. **Submissions are irrevocable.** With no user id there is nothing to delete on request — fine
   under GDPR *only if* the data is genuinely anonymous. If it is merely pseudonymous, Article 17
   applies and you cannot comply. A second, independent reason to insist on real LDP rather than
   "we removed the id".
5. **Version the schema and record ε per row.** A mis-recorded ε silently invalidates the
   debiasing.
6. **Update the product copy.** [models.go:29-33](../backend/internal/models/models.go#L29-L33)
   and the Vault page both say having no scheduler "is what keeps 'nothing leaves this machine'
   true". Ship telemetry without rewriting that and the codebase asserts something false about
   itself.

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
- [ ] `offlineCache` stores ciphertext — both the subject cache and the journal outbox
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
