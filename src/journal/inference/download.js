/**
 * The download manager: size and cancel before anything moves, SHA-256 before anything is
 * kept, and an error rather than a fallback when the sum is wrong (§5.6).
 *
 * A weight file is code that runs on the user's device. "The download looked plausible" is
 * not a check, which is why the operator's `make models-fetch` verifies on the way in and
 * this module verifies again on the way out — the two ends of the same wire, neither
 * trusting the other. What a wrong sum means here is deliberately narrow: **nothing is
 * cached and the error is shown.** There is no repair, no retry-with-a-different-source and
 * no "use it anyway", because every one of those turns a tampering signal into a warning
 * nobody reads.
 *
 * Cancel is a real cancel. It aborts the request in flight, and because a file is only put
 * in the cache *after* its whole body has hashed clean, a cancelled download leaves the
 * cache exactly as it found it — there are no partial entries to clean up.
 *
 * Everything the browser provides arrives through `deps`, the way `recorder.js` takes its
 * `MediaRecorder`: the tests need no network, no Cache Storage and no WebCrypto.
 */

import { MODEL_CACHE_NAME, modelFileUrl, totalBytes } from './models';

/** Where a download is. `verifying` is its own state because it is the slow part of a big file. */
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

/**
 * SHA-256 of the bytes as fetched.
 *
 * `crypto.subtle` exists **only in a secure context**, which for this self-hosted app is not
 * a technicality: reached over plain `http://` on a home network it is simply undefined, and
 * so is `getUserMedia`. Both go missing together, so a device that cannot verify a model is
 * also a device that cannot record — which is why `voiceAvailability` refuses on the same
 * condition rather than letting an unverified download happen.
 */
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

/**
 * Build a downloader for one model.
 *
 * It is a store like the recorder's — `getSnapshot`/`subscribe` — because the two things on
 * screen while it runs (a progress line and a cancel button) are the same shape of problem.
 */
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

    /**
     * Fetch, verify, keep — in that order, one file at a time.
     *
     * Sequential rather than parallel on purpose: a progress line that means anything has to
     * count one thing at a time, and thirteen parallel requests for 45 MB on the LAN this
     * product runs on is not faster in any way the user can see.
     */
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

            // Length first: it is free, and a `/models/` path that fell through to the SPA
            // answers 200 with a page of HTML, which is a corrupt model rather than a
            // missing one (C1's warning). The length catches that before the hash does, and
            // says something more useful when it fires.
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

/**
 * Several models as one download — the Light tier's two, behind one line and one button.
 *
 * §5.5's Light tier is a transcriber *and* a proposer (§5.1), so a Light-tier device has two
 * models to fetch and a screen with two progress bars and two cancel buttons would be two
 * decisions where the user has one: *do I want this feature*. This composes any number of
 * downloaders into one that reports the same snapshot shape, so nothing above it changes.
 *
 * **The parts are the same downloaders**, not a re-implementation: each still verifies each
 * file against its own pin, each still refuses on a mismatch without caching anything, and
 * `remove` still goes through each. What this adds is arithmetic — summed bytes, summed file
 * counts — and one rule about failure: **the first refusal ends the whole set.** A Light tier
 * with Whisper installed and Gemma missing is not a working Light tier, and reporting it as a
 * partial success would put a microphone on screen that produces words and no card.
 */
export const createModelSetDownloader = (models, deps = {}) => {
    // `createDownloader` is how Android reuses this: the plugin's downloader has the same
    // store contract and a different back end, so the composition does not need to know
    // which one it is holding — the same rail the runtimes are built on.
    const { createDownloader = createModelDownloader, ...rest } = deps;
    const parts = models.map(model => createDownloader(model, rest));
    const listeners = new Set();

    const filesTotal = models.reduce((sum, model) => sum + model.files.length, 0);
    const total = models.reduce((sum, model) => sum + totalBytes(model), 0);

    /**
     * The set's state, from the parts'.
     *
     * The order is what makes it honest: an error anywhere is the set's state, then a cancel,
     * then "still going", and `ready` only when every part is. A set that reported `ready`
     * because the last part finished would be a set that lies about the one that failed.
     */
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

/**
 * The cache transformers.js reads through, so it can only ever see verified bytes.
 *
 * `env.customCache` is a documented extension point taking `match(key)` and `put(key, res)`.
 * The keys transformers.js uses are the local paths it resolves against `env.localModelPath`
 * — `/models/onnx-community/whisper-tiny/config.json` — which is exactly what the downloader
 * above wrote, so the library finds every file and never reaches for the network at all.
 *
 * `put` is a **no-op on purpose.** The only writer is the downloader, which hashes first; a
 * library that could write into this cache could cache something nothing verified.
 */
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
