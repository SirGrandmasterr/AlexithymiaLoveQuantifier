import { isNative } from './platform';

/**
 * What this app keeps on the device, and the two scopes that bound it.
 *
 * ---
 *
 * **1. The subject list: last-known-good copy.**
 *
 * The web app treats a failed load as an error and says so, which is right in a browser: the
 * server is one tab away and the user asked for this page just now. A phone is carried out of
 * Wi-Fi range mid-session, and "Could not load your analyses" over an empty screen is a worse
 * answer than the numbers from twenty minutes ago clearly marked as old.
 *
 * Scope, deliberately: **read-through only**. Nothing here queues a snapshot write. A snapshot
 * mutation offline still fails and still surfaces its error, because the alternative — a write
 * queue against a find-or-create write path with server-assigned ids — is a synchronisation
 * feature, not a caching one, and it would need conflict rules this application has never had
 * to define.
 *
 * ---
 *
 * **2. The journal outbox: the one deliberate exception** (design §9.5, session F1).
 *
 * The journal is different in exactly one respect, and it is the respect the paragraph above
 * turns on. A journal entry carries a **client-minted `client_id`**, and `POST
 * /api/journal/entries` is idempotent on it: a second post of the same `client_id` returns
 * `200` with the row already stored rather than `201` with a second one (§7.2). There is
 * therefore no id to conflict and no rule to invent — a retry cannot duplicate — so a check-in
 * saved with no connectivity is queued here and posted later.
 *
 * Scope, equally deliberately, and it is this narrow *because* that is what makes it safe:
 *
 * - **Journal entries only.** It does not queue snapshots. Everything in the paragraph above
 *   still holds for them.
 * - **New records only, never a correction.** An entry carrying `supersedes_id` is an edit of
 *   a row the server already has, and that is the case with no local answer — so there is no
 *   offline edit and no offline delete. A correction of an entry that is *still in this
 *   queue* replaces it here, keyed by `client_id`; anything already synced waits for a
 *   connection.
 * - **Native only**, like the cache above. In a browser a failed save still rejects and the
 *   composer still says so; the tab can be reloaded and the server is one hop away.
 * - **No general sync engine, and no conflict resolution.** The queue is a list of request
 *   bodies posted verbatim, in order, until each is accepted.
 *
 * Under docs/13, the queued body is ciphertext at rest exactly as the row would be — `payload`
 * is opaque to this module either way, and the envelope wraps it before it is handed to
 * `writeOutbox`. (Conditional: E1 has not run, and may never.)
 */

const KEY = 'alq:offline-subjects';

/** Older than this and it is not worth showing; the user is better served by the error. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export const writeCache = (people, relationships) => {
    if (!isNative()) return;
    try {
        window.localStorage.setItem(KEY, JSON.stringify({
            savedAt: Date.now(),
            people,
            relationships
        }));
    } catch {
        // Quota or a locked store. A cache that cannot be written is not an error worth
        // interrupting a successful fetch for.
    }
};

/** `null` when there is nothing usable — absent, malformed, or stale past `MAX_AGE_MS`. */
export const readCache = () => {
    if (!isNative()) return null;
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.people) || !Array.isArray(parsed?.relationships)) return null;
        if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;

        return parsed;
    } catch {
        return null;
    }
};

export const clearCache = () => {
    try {
        window.localStorage.removeItem(KEY);
    } catch {
        // Nothing to do.
    }
};

/* ------------------------------------------------------------------------------------ */
/* The journal outbox (§9.5)                                                              */
/* ------------------------------------------------------------------------------------ */

/** The same store as the cache above, and a key of its own so a logout can drop either. */
const OUTBOX_KEY = 'alq:journal-outbox';

/**
 * The queue, oldest first, or `[]` when there is nothing — never `null`.
 *
 * There is no `MAX_AGE_MS` here and there must not be one. A stale *copy* of the server's
 * data is worth discarding because the server still has the original; a queued entry is the
 * only copy in existence, and an outbox that expired it would be a write the user made and
 * the app silently dropped (invariant 13).
 */
export const readOutbox = () => {
    if (!isNative()) return [];
    try {
        const raw = window.localStorage.getItem(OUTBOX_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];

        // A row with no request is not a check-in that can ever be posted. Dropping it is
        // not discarding the user's input: nothing else in the file could carry it.
        return parsed.filter(item => item && typeof item.client_id === 'string' && item.request);
    } catch {
        return [];
    }
};

/**
 * Replace the queue. Called on every change, so the file on disk and the list in memory
 * cannot drift — which is the whole of "not lost on reload".
 */
export const writeOutbox = (items) => {
    if (!isNative()) return;
    try {
        if (!Array.isArray(items) || items.length === 0) {
            window.localStorage.removeItem(OUTBOX_KEY);
            return;
        }
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch {
        // Quota or a locked store. Unlike the cache above this one is worth noticing: the
        // entry is still in memory and will still be posted on the next flush, but it will
        // not survive a relaunch.
        console.error('Could not persist the journal outbox');
    }
};

/** Logging out must not leave one user's unsent check-ins for the next one to find. */
export const clearOutbox = () => {
    try {
        window.localStorage.removeItem(OUTBOX_KEY);
    } catch {
        // Nothing to do.
    }
};
