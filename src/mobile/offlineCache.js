import { isNative } from './platform';

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

/* The journal outbox (§9.5) */

/** The same store as the cache above, and a key of its own so a logout can drop either. */
const OUTBOX_KEY = 'alq:journal-outbox';

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

export const writeOutbox = (items) => {
    if (!isNative()) return;
    try {
        if (!Array.isArray(items) || items.length === 0) {
            window.localStorage.removeItem(OUTBOX_KEY);
            return;
        }
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
    } catch {
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
