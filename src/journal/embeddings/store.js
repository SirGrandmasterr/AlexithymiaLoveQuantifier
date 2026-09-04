export const VECTOR_DB_NAME = 'alq:journal-index';
export const VECTOR_DB_VERSION = 1;
export const VECTOR_STORE_NAME = 'vectors';

/** The key path. It is a client id, so it is the same id on every device that holds the row. */
export const VECTOR_KEY = 'entry_client_id';

/* 1. The backing store */

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

/* 2. Rows */

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

export const staleIds = (rows, wantedIds, { model, dims }) => {
    const current = new Map();
    rows.forEach(row => {
        if (row.model === model && row.dims === dims) current.set(row.entryClientId, row);
    });
    return [...new Set(wantedIds.filter(Boolean).map(String))].filter(id => !current.has(id));
};

/* 3. The index */

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

export const clearVectorIndex = async (deps = {}) => {
    await createVectorIndex(deps).clear();
};
