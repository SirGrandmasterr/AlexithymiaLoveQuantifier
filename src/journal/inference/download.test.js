import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
    createModelDownloader,
    createVerifiedCache,
    sha256Hex,
    toHex,
    DOWNLOAD_ERRORS
} from './download';
import { modelFileUrl, MODEL_CACHE_NAME } from './models';

/* Fakes: no network, no Cache Storage, no WebCrypto */

const bytesFor = (text) => new TextEncoder().encode(text).buffer;
const sha256Of = (text) => createHash('sha256').update(text).digest('hex');

/** A model whose "weights" are three short strings, so a whole run fits in a test. */
const model = (() => {
    const contents = { 'a.json': 'alpha', 'b.json': 'beta', 'onnx/c.onnx': 'gamma-weights' };
    return {
        id: 'fake/model',
        label: 'Fake tiny',
        files: Object.entries(contents).map(([name, text]) => ({
            path: `fake/model/${name}`,
            bytes: new TextEncoder().encode(text).length,
            sha256: sha256Of(text)
        })),
        contents
    };
})();

const contentFor = (url) => model.contents[url.replace('/models/fake/model/', '')];

/** Node's WebCrypto, which is the same algorithm the browser runs. */
const subtle = { digest: async (_name, data) => createHash('sha256').update(Buffer.from(data)).digest().buffer };

const makeCache = () => {
    const held = new Map();
    return {
        held,
        cache: {
            match: async (key) => held.get(key),
            put: async (key, response) => { held.set(key, response); },
            delete: async (key) => held.delete(key)
        }
    };
};

const setup = (overrides = {}) => {
    const { held, cache } = makeCache();
    const fetchImpl = vi.fn(async (url) => {
        const text = contentFor(url);
        if (text === undefined) return { ok: false, status: 404 };
        return { ok: true, status: 200, arrayBuffer: async () => bytesFor(text) };
    });

    const downloader = createModelDownloader(model, {
        fetch: fetchImpl,
        subtle,
        caches: { open: async () => cache },
        ...overrides
    });

    return { downloader, held, fetchImpl, cache };
};

describe('sha256Hex', () => {
    it('is hex, lower case, the form every sum in the Makefile is written in', async () => {
        expect(await sha256Hex(bytesFor('alpha'), subtle)).toBe(sha256Of('alpha'));
        expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff');
    });

    it('refuses rather than skipping where there is no WebCrypto', async () => {
        await expect(sha256Hex(bytesFor('alpha'), null)).rejects.toMatchObject({
            kind: DOWNLOAD_ERRORS.unsupported
        });
    });
});

describe('the download manager', () => {
    it('says the size before anything moves', () => {
        const { downloader, fetchImpl } = setup();
        expect(downloader.getSnapshot()).toMatchObject({
            state: 'idle', filesDone: 0, filesTotal: 3, loaded: 0, total: 22
        });
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('fetches, verifies and keeps every file', async () => {
        const { downloader, held, fetchImpl } = setup();

        expect(await downloader.start()).toBe(true);
        expect(downloader.getSnapshot()).toMatchObject({ state: 'ready', filesDone: 3, error: null });
        expect(fetchImpl).toHaveBeenCalledTimes(3);
        model.files.forEach(file => expect(held.has(modelFileUrl(file))).toBe(true));
        expect(await downloader.isDownloaded()).toBe(true);
    });

    it('reports progress one file at a time', async () => {
        const { downloader } = setup();
        const seen = [];
        downloader.subscribe(snapshot => seen.push(snapshot.loaded));
        await downloader.start();
        // Monotonic, and it ends at the total it promised.
        expect(seen[seen.length - 1]).toBe(22);
        expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    });

    it('keeps nothing when a checksum does not match, and never falls back', async () => {
        const tampered = vi.fn(async (url) => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => bytesFor(url.endsWith('c.onnx') ? 'gamma-weightz' : contentFor(url))
        }));
        const { downloader, held } = setup({ fetch: tampered });

        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot()).toMatchObject({
            state: 'error',
            file: 'fake/model/onnx/c.onnx',
            error: { kind: DOWNLOAD_ERRORS.checksum }
        });
        // The clean files before it are kept — they hashed clean and are still what they
        // claim to be — but the file that failed is not, and the run does not continue.
        expect(held.has(modelFileUrl(model.files[2]))).toBe(false);
        expect(await downloader.isDownloaded()).toBe(false);
    });

    it('catches a wrong length before it hashes, which is what an HTML error page looks like', async () => {
        const html = vi.fn(async () => ({
            ok: true, status: 200, arrayBuffer: async () => bytesFor('<!doctype html><html>…')
        }));
        const { downloader, held } = setup({ fetch: html });

        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot().error).toMatchObject({ kind: DOWNLOAD_ERRORS.length });
        expect(held.size).toBe(0);
    });

    it('reports a refusal from the server rather than caching the refusal', async () => {
        const { downloader, held } = setup({ fetch: vi.fn(async () => ({ ok: false, status: 404 })) });
        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot().error).toMatchObject({ kind: DOWNLOAD_ERRORS.network });
        expect(held.size).toBe(0);
    });

    it('cancels in flight, and leaves the cache exactly as it found it', async () => {
        let release;
        const held = makeCache();
        const abort = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
        const slow = vi.fn((url, options) => new Promise((resolve, reject) => {
            // A signal that was aborted before the request was made never fires `abort`,
            // and a fake that only listens would hang forever waiting for it.
            if (options.signal.aborted) { reject(abort()); return; }
            release = () => resolve({ ok: true, status: 200, arrayBuffer: async () => bytesFor(contentFor(url)) });
            options.signal.addEventListener('abort', () => reject(abort()));
        }));

        const downloader = createModelDownloader(model, {
            fetch: slow, subtle, caches: { open: async () => held.cache }
        });

        const run = downloader.start();
        // Let `start` get past opening the cache and into the first request.
        await vi.waitFor(() => expect(slow).toHaveBeenCalled());
        downloader.cancel();

        expect(await run).toBe(false);
        expect(downloader.getSnapshot().state).toBe('cancelled');
        // A file is only kept after its whole body has hashed clean, so a cancelled download
        // leaves no partial entry behind to clean up.
        expect(held.held.size).toBe(0);
        expect(release).toBeTypeOf('function');
    });

    it('skips what is already there, so a resumed run costs nothing for the files it has', async () => {
        const { downloader, held, fetchImpl } = setup();
        await downloader.start();
        expect(fetchImpl).toHaveBeenCalledTimes(3);

        held.delete(modelFileUrl(model.files[1]));
        fetchImpl.mockClear();
        await downloader.start();

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe(modelFileUrl(model.files[1]));
    });

    it('removes every file when asked, and says the model is gone', async () => {
        const { downloader, held } = setup();
        await downloader.start();
        expect(await downloader.remove()).toBe(true);
        expect(held.size).toBe(0);
        expect(await downloader.isDownloaded()).toBe(false);
        expect(downloader.getSnapshot().state).toBe('idle');
    });

    it('reports a browser with nowhere to keep the model rather than downloading into nothing', async () => {
        const { downloader } = setup({ caches: undefined });
        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot().error).toMatchObject({ kind: DOWNLOAD_ERRORS.unsupported });
    });

    it('is not downloaded when only some of it is', async () => {
        const { downloader, held } = setup();
        await downloader.start();
        held.delete(modelFileUrl(model.files[0]));
        expect(await downloader.isDownloaded()).toBe(false);
    });
});

describe('the verified cache transformers.js reads through', () => {
    it('serves what the downloader kept, under the path the library asks for', async () => {
        const { held, cache } = makeCache();
        held.set('/models/fake/model/a.json', 'the response');

        const verified = createVerifiedCache({ caches: { open: async () => cache }, cacheName: MODEL_CACHE_NAME });
        expect(await verified.match('/models/fake/model/a.json')).toBe('the response');
        expect(await verified.match('/models/fake/model/missing.json')).toBeUndefined();
    });

    it('refuses to be written to, because the only writer hashes first', async () => {
        const { held, cache } = makeCache();
        const verified = createVerifiedCache({ caches: { open: async () => cache } });

        await verified.put('/models/anything', 'unverified bytes');

        // A library that could write into this cache could cache something nothing checked.
        expect(held.size).toBe(0);
    });

    it('answers undefined rather than throwing where there is no Cache Storage', async () => {
        const verified = createVerifiedCache({ caches: undefined });
        expect(await verified.match('/models/anything')).toBeUndefined();
    });
});
