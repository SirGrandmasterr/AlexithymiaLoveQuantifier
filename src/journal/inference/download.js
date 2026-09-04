import { MODEL_CACHE_NAME, modelFileUrl, totalBytes } from './models';

export const DOWNLOAD_STATES = ['idle', 'downloading', 'ready', 'cancelled', 'error'];

/** Why a download stopped. `checksum` is the one that must never be recoverable. */
export const DOWNLOAD_ERRORS = {
    checksum: 'checksum',
    length: 'length',
    network: 'network',
    unsupported: 'unsupported',
    storage: 'storage'
};

/** Hex, lower case, from an ArrayBuffer — the form every sum in the Makefile is written in. */
export const toHex = (buffer) => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');

export const sha256Hex = async (bytes, subtle = globalThis.crypto?.subtle) => {
    if (!subtle || typeof subtle.digest !== 'function') {
        throw Object.assign(new Error('no WebCrypto in this context'), { kind: DOWNLOAD_ERRORS.unsupported });
    }
    return toHex(await subtle.digest('SHA-256', bytes));
};

/** A store's snapshot before anything moved. Shared with the native downloader (C4). */
export const emptyProgress = (model) => ({
    state: 'idle',
    file: null,
    filesDone: 0,
    filesTotal: model.files.length,
    loaded: 0,
    total: totalBytes(model),
    error: null
});

export const createModelDownloader = (model, deps = {}) => {
    const {
        fetch: fetchImpl = globalThis.fetch?.bind(globalThis),
        subtle = globalThis.crypto?.subtle,
        caches: cacheStorage = globalThis.caches,
        cacheName = MODEL_CACHE_NAME
    } = deps;

    const listeners = new Set();
    let snapshot = emptyProgress(model);
    let controller = null;

    const emit = () => {
        const frozen = snapshot;
        listeners.forEach(listener => { try { listener(frozen); } catch { /* not ours */ } });
    };
    const set = (patch) => { snapshot = { ...snapshot, ...patch }; emit(); };

    const openCache = async () => {
        if (!cacheStorage || typeof cacheStorage.open !== 'function') {
            throw Object.assign(new Error('no Cache Storage'), { kind: DOWNLOAD_ERRORS.unsupported });
        }
        return cacheStorage.open(cacheName);
    };

    /** Every file present in the cache — the only definition of "downloaded" this app has. */
    const isDownloaded = async () => {
        try {
            const cache = await openCache();
            const found = await Promise.all(model.files.map(file => cache.match(modelFileUrl(file))));
            return found.every(Boolean);
        } catch {
            return false;
        }
    };

    const remove = async () => {
        try {
            const cache = await openCache();
            await Promise.all(model.files.map(file => cache.delete(modelFileUrl(file))));
            snapshot = emptyProgress(model);
            emit();
            return true;
        } catch {
            return false;
        }
    };

    const fail = (kind, message, file = null) => {
        controller = null;
        set({ state: 'error', file, error: { kind, message } });
        return false;
    };

    const start = async () => {
        if (snapshot.state === 'downloading') return false;
        if (!fetchImpl) return fail(DOWNLOAD_ERRORS.unsupported, 'no fetch in this environment');

        controller = new AbortController();
        const { signal } = controller;
        set({ ...emptyProgress(model), state: 'downloading' });

        let cache;
        try {
            cache = await openCache();
        } catch (cause) {
            return fail(cause?.kind || DOWNLOAD_ERRORS.storage, cause?.message || 'no storage for the model');
        }

        let loaded = 0;
        for (let index = 0; index < model.files.length; index += 1) {
            const file = model.files[index];
            const url = modelFileUrl(file);
            set({ file: file.path, filesDone: index, loaded });

            if (await cache.match(url)) {
                loaded += file.bytes;
                set({ filesDone: index + 1, loaded });
                continue;
            }

            let bytes;
            let response;
            try {
                response = await fetchImpl(url, { signal, cache: 'no-store' });
                if (!response.ok) {
                    return fail(DOWNLOAD_ERRORS.network, `${url} answered ${response.status}`, file.path);
                }
                bytes = await response.arrayBuffer();
            } catch (cause) {
                if (signal.aborted) {
                    controller = null;
                    set({ state: 'cancelled', file: null });
                    return false;
                }
                return fail(DOWNLOAD_ERRORS.network, cause?.message || 'the download stopped', file.path);
            }

            if (bytes.byteLength !== file.bytes) {
                return fail(
                    DOWNLOAD_ERRORS.length,
                    `${file.path} is ${bytes.byteLength} bytes, expected ${file.bytes}`,
                    file.path
                );
            }

            let digest;
            try {
                digest = await sha256Hex(bytes, subtle);
            } catch (cause) {
                return fail(cause?.kind || DOWNLOAD_ERRORS.unsupported, cause?.message || 'cannot verify', file.path);
            }

            if (digest !== file.sha256) {
                // Nothing is written. This is the branch the whole module exists for.
                return fail(
                    DOWNLOAD_ERRORS.checksum,
                    `${file.path} does not match its published checksum`,
                    file.path
                );
            }

            try {
                await cache.put(url, new Response(bytes, {
                    headers: { 'content-length': String(bytes.byteLength) }
                }));
            } catch (cause) {
                return fail(DOWNLOAD_ERRORS.storage, cause?.message || 'could not store the model', file.path);
            }

            loaded += file.bytes;
            set({ filesDone: index + 1, loaded });
        }

        controller = null;
        set({ state: 'ready', file: null, loaded: totalBytes(model) });
        return true;
    };

    const cancel = () => {
        if (controller) controller.abort();
        else if (snapshot.state === 'downloading') set({ state: 'cancelled' });
    };

    return {
        model,
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        start,
        cancel,
        isDownloaded,
        remove
    };
};

export const createModelSetDownloader = (models, deps = {}) => {
    const { createDownloader = createModelDownloader, ...rest } = deps;
    const parts = models.map(model => createDownloader(model, rest));
    const listeners = new Set();

    const filesTotal = models.reduce((sum, model) => sum + model.files.length, 0);
    const total = models.reduce((sum, model) => sum + totalBytes(model), 0);

    const combine = () => {
        const snapshots = parts.map(part => part.getSnapshot());
        const failed = snapshots.find(one => one.state === 'error');
        const cancelled = snapshots.find(one => one.state === 'cancelled');
        const running = snapshots.find(one => one.state === 'downloading');

        const state = failed ? 'error'
            : cancelled ? 'cancelled'
                : running ? 'downloading'
                    : snapshots.every(one => one.state === 'ready') ? 'ready' : 'idle';

        return {
            state,
            file: running?.file ?? failed?.file ?? null,
            filesDone: snapshots.reduce((sum, one) => sum + one.filesDone, 0),
            filesTotal,
            loaded: snapshots.reduce((sum, one) => sum + one.loaded, 0),
            total,
            error: failed?.error ?? null
        };
    };

    let snapshot = combine();
    const emit = () => {
        snapshot = combine();
        const frozen = snapshot;
        listeners.forEach(listener => { try { listener(frozen); } catch { /* not ours */ } });
    };
    parts.forEach(part => part.subscribe(emit));

    return {
        // The set has no single model, and callers that want a name ask `setLabel(models)`.
        model: null,
        models,
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },

        start: async () => {
            for (const part of parts) {
                // Sequential, for the reason the single downloader is: one progress line that
                // counts one thing at a time.
                if (!await part.start()) { emit(); return false; }
            }
            emit();
            return true;
        },

        cancel: () => { parts.forEach(part => part.cancel()); emit(); },

        isDownloaded: async () => {
            const each = await Promise.all(parts.map(part => part.isDownloaded()));
            return each.every(Boolean);
        },

        remove: async () => {
            const each = await Promise.all(parts.map(part => part.remove()));
            emit();
            return each.every(Boolean);
        }
    };
};

export const createVerifiedCache = (deps = {}) => {
    const { caches: cacheStorage = globalThis.caches, cacheName = MODEL_CACHE_NAME } = deps;

    return {
        match: async (key) => {
            if (!cacheStorage?.open) return undefined;
            const cache = await cacheStorage.open(cacheName);
            return cache.match(key);
        },
        put: async () => { /* verified writes only, and the downloader is the only writer */ }
    };
};
