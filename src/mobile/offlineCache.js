import { isNative } from './platform';

/**
 * Last-known-good copy of the subject list.
 *
 * The web app treats a failed load as an error and says so, which is right in a browser: the
 * server is one tab away and the user asked for this page just now. A phone is carried out of
 * Wi-Fi range mid-session, and "Could not load your analyses" over an empty screen is a worse
 * answer than the numbers from twenty minutes ago clearly marked as old.
 *
 * Scope, deliberately: **read-through only**. Nothing here queues writes. A mutation offline
 * still fails and still surfaces its error, because the alternative — a write queue against a
 * find-or-create write path with server-assigned ids — is a synchronisation feature, not a
 * caching one, and it would need conflict rules this application has never had to define.
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
