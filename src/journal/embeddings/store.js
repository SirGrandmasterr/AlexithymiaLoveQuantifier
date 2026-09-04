/**
 * Where the vectors live, and the rule that they live nowhere else (§5.8, rule 1).
 *
 * A row is `{ entry_client_id, model, dims, vector }` and nothing more. There is no server
 * endpoint for it, no export path through it, and no field on any request body shaped like
 * it — `noVectors.test.js` intercepts `axios` and asserts that on every path that writes.
 * The reason is in §5.8 and it is worth restating where the code is rather than only where
 * the design is: **embeddings are invertible.** vec2text recovers 92 % of 32-token inputs
 * exactly, and full names out of clinical notes. A vector table is a transcript table under
 * another name, and this application's transcripts are verbatim speech about named third
 * parties. So each device builds its own index from the entries it already holds decrypted,
 * and signing out deletes it.
 *
 * **IndexedDB, and not the store the offline cache uses.** §5.8 says *"IndexedDB/OPFS (on
 * native, the same store as the offline cache)"*, written when that cache was expected to be
 * one. It is not: `mobile/offlineCache.js` is `localStorage`, which is a ~5 MB string quota,
 * and §5.8's own sizing is 10 MB of `Float32Array` for a five-year history. So the index is
 * IndexedDB on both platforms — the same *lifetime* as the offline cache, cleared on the
 * same logout, for the same reason, in a store that can actually hold it. Typed arrays
 * survive IndexedDB's structured clone unchanged, which is what makes §5.8's "a typed array,
 * not a vector database" literally true of what is on disk.
 *
 * Under docs/13 this is the ciphertext-only store §6.6's table names. E1 has not run and may
 * never; when it does, the envelope wraps `vector` here and nothing else in this file moves.
 *
 * **This is not a vector database and must not become one.** Brute-force cosine over a typed
 * array is milliseconds at §5.8's ten thousand rows; an HNSW library would start to matter
 * past ~50,000, which is a heavy user's twenty-fifth year.
 */

export const VECTOR_DB_NAME = 'alq:journal-index';
export const VECTOR_DB_VERSION = 1;
export const VECTOR_STORE_NAME = 'vectors';

/** The key path. It is a client id, so it is the same id on every device that holds the row. */
export const VECTOR_KEY = 'entry_client_id';

/* ------------------------------------------------------------------------------------ */
/* 1. The backing store                                                                   */
/* ------------------------------------------------------------------------------------ */

/**
 * IndexedDB behind four async methods, so the index above it can be tested without one.
 *
 * jsdom has no IndexedDB and this repository does not carry a polyfill for it; a backend
 * that is a parameter is both how the tests run and how the native store slots in later
 * without this file learning about platforms.
 *
 * Every method resolves rather than rejects on a store that is simply not there. A browser
 * in private mode, or one whose quota is gone, costs the user a suggestion — never a screen.
 */
export const indexedDbBackend = ({ factory = globalThis.indexedDB } = {}) => {
    const open = () => new Promise((resolve, reject) => {
        if (!factory) {
            resolve(null);
            return;
        }
        let request;
        try {
            request = factory.open(VECTOR_DB_NAME, VECTOR_DB_VERSION);
        } catch (error) {
            reject(error);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(VECTOR_STORE_NAME)) {
                db.createObjectStore(VECTOR_STORE_NAME, { keyPath: VECTOR_KEY });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve(null);
    });

    const withStore = async (mode, run) => {
        const db = await open();
        if (!db) return null;
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction(VECTOR_STORE_NAME, mode);
                const store = transaction.objectStore(VECTOR_STORE_NAME);
                let result;
                try {
                    result = run(store);
                } catch (error) {
                    reject(error);
                    return;
                }
                transaction.oncomplete = () => resolve(result?.result ?? result ?? null);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        } finally {
            db.close();
        }
    };

    return {
        getAll: async () => {
            const rows = await withStore('readonly', store => store.getAll());
            return Array.isArray(rows) ? rows : [];
        },
        putMany: async (rows) => {
            await withStore('readwrite', store => { rows.forEach(row => store.put(row)); });
        },
        deleteMany: async (ids) => {
            await withStore('readwrite', store => { ids.forEach(id => store.delete(id)); });
        },
        clear: async () => {
            await withStore('readwrite', store => store.clear());
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* 2. Rows                                                                                */
/* ------------------------------------------------------------------------------------ */

/** The stored shape, and the only shape this module writes. */
export const vectorRow = ({ entryClientId, model, dims, vector }) => ({
    [VECTOR_KEY]: String(entryClientId),
    model: String(model),
    dims: Number(dims),
    vector: vector instanceof Float32Array ? vector : Float32Array.from(vector ?? [])
});

const readRow = (row) => {
    const id = row && typeof row[VECTOR_KEY] === 'string' ? row[VECTOR_KEY] : null;
    if (!id) return null;
    // A row written by a different build, or half-written, is not a vector. Dropping it
    // costs a re-embed; trusting it would put a wrong-width array into a dot product.
    const vector = row.vector instanceof Float32Array
        ? row.vector
        : (ArrayBuffer.isView(row.vector) || Array.isArray(row.vector)
            ? Float32Array.from(row.vector)
            : null);
    if (!vector || vector.length === 0) return null;
    if (typeof row.model !== 'string' || !row.model) return null;
    if (!Number.isInteger(row.dims) || row.dims !== vector.length) return null;

    return { entryClientId: id, model: row.model, dims: row.dims, vector };
};

/**
 * Which ids need embedding: the ones with no vector, and the ones whose vector was written
 * by a different model or at a different width.
 *
 * **This is what the `model` field is for** (§5.8). A model change does not invalidate
 * anything eagerly and does not block anything: the rows simply stop matching, and the next
 * time something asks for a suggestion the ones it needs are re-embedded. Ten thousand rows
 * at ~20 ms is minutes, and minutes is fine when nothing is waiting on it.
 */
export const staleIds = (rows, wantedIds, { model, dims }) => {
    const current = new Map();
    rows.forEach(row => {
        if (row.model === model && row.dims === dims) current.set(row.entryClientId, row);
    });
    return [...new Set(wantedIds.filter(Boolean).map(String))].filter(id => !current.has(id));
};

/* ------------------------------------------------------------------------------------ */
/* 3. The index                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * The device-local index. Read it, add to it, drop what an entry no longer needs, empty it.
 *
 * There is no `export`, no `sync`, and no method that returns a row in a shape a request
 * body would accept. That is not an oversight to be fixed by a later session: it is rule 1.
 */
export const createVectorIndex = ({ backend = indexedDbBackend() } = {}) => {
    const all = async () => {
        try {
            return (await backend.getAll()).map(readRow).filter(Boolean);
        } catch {
            // A store that cannot be read is a device with no suggestions, which is the
            // default state of every device anyway.
            return [];
        }
    };

    return {
        all,

        /** Everything written by this model at this width, keyed by id — what a scan reads. */
        current: async ({ model, dims }) => {
            const rows = await all();
            const map = new Map();
            rows.forEach(row => {
                if (row.model === model && row.dims === dims) map.set(row.entryClientId, row);
            });
            return map;
        },

        put: async (rows) => {
            const clean = rows.map(vectorRow).filter(row => row[VECTOR_KEY] && row.vector.length);
            if (clean.length === 0) return 0;
            try {
                await backend.putMany(clean);
                return clean.length;
            } catch {
                return 0;
            }
        },

        /** Used when a trigger is merged away: its vector has nothing left to speak for. */
        forget: async (ids) => {
            const clean = [...new Set((ids || []).filter(Boolean).map(String))];
            if (clean.length === 0) return;
            try {
                await backend.deleteMany(clean);
            } catch {
                // Nothing to do. A vector for a row that no longer exists is never scanned
                // against anything, because the scan is driven by the vocabulary, not by
                // what is in here.
            }
        },

        clear: async () => {
            try {
                await backend.clear();
            } catch {
                // Nothing to do.
            }
        }
    };
};

/**
 * Empty the index, from anywhere, without holding one.
 *
 * `JournalContext` calls this on the branch that runs when there is no session — the same
 * branch that drops the outbox, and for a stronger version of the same reason: an unsent
 * check-in is the user's own words, and a vector is those words recoverable by anyone who
 * signs in next. §10.2 promises out loud that these numbers are *"deleted when you sign
 * out"*, so this is a Vault claim with a function under it.
 */
export const clearVectorIndex = async (deps = {}) => {
    await createVectorIndex(deps).clear();
};
