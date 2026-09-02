import { describe, it, expect, vi } from 'vitest';
import { createWebTranscriber, configureEnvironment, concatClips, asProposal } from './web';
import { audioInput, propose, buildContext, INPUT_MODES, RUNTIME_IDS, FAILURE_KINDS } from './index';
import { MODEL_BASE_PATH, WHISPER_TINY } from './models';
import { TARGET_SAMPLE_RATE } from '../recorder';

/** transformers.js's `env`, in the shape the real one has before anything touches it. */
const freshEnv = () => ({
    allowRemoteModels: true,
    allowLocalModels: true,
    localModelPath: '/models/',
    useBrowserCache: true,
    useCustomCache: false,
    customCache: null,
    useWasmCache: true,
    backends: { onnx: { wasm: { wasmPaths: undefined, numThreads: 4, proxy: true } } }
});

const clip = (id, samples = [0.1, 0.2]) => ({
    id, takeId: 'take-1', audio: Float32Array.from(samples), sampleRate: TARGET_SAMPLE_RATE, durationMs: 900
});

const context = () => buildContext({ relationships: [{ ID: 1, name: 'Lucie' }], triggers: [] });

/* ------------------------------------------------------------------------------------ */
/* 1. The four settings the Vault page's truth rests on                                   */
/* ------------------------------------------------------------------------------------ */

describe('configureEnvironment', () => {
    it('forbids the model hub outright', () => {
        const env = freshEnv();
        configureEnvironment(env, { cache: {} });

        // Not "prefers local" — forbidden. There is no fallback to the hub, and
        // `connect-src 'self'` would refuse one a layer lower anyway.
        expect(env.allowRemoteModels).toBe(false);
        expect(env.allowLocalModels).toBe(true);
        expect(env.localModelPath).toBe(MODEL_BASE_PATH);
    });

    it('reads only through the verified cache', () => {
        const env = freshEnv();
        const cache = { match: () => { }, put: () => { } };
        configureEnvironment(env, { cache });

        expect(env.useCustomCache).toBe(true);
        expect(env.customCache).toBe(cache);
        // The browser cache is turned off with it: two caches would mean one of them holds
        // bytes nothing hashed.
        expect(env.useBrowserCache).toBe(false);
    });

    it('points ONNX Runtime at this origin, never at a CDN', () => {
        const env = freshEnv();
        configureEnvironment(env, { cache: {} });

        const { wasm, mjs } = env.backends.onnx.wasm.wasmPaths;
        [wasm, mjs].forEach(url => {
            expect(url).toBeTruthy();
            expect(url).not.toContain('cdn.jsdelivr.net');
            expect(url).not.toMatch(/^https?:\/\//);
        });
    });

    it('keeps the ONNX loader a same-origin module rather than a blob the CSP refuses', () => {
        // With `useWasmCache` on, transformers.js re-serves the loader to itself as a blob
        // URL, which `script-src 'self' 'wasm-unsafe-eval'` refuses. C1 measured the same
        // shape of problem for `worker-src` and left the choice here; not needing to widen
        // the policy is the better half of it.
        const env = freshEnv();
        configureEnvironment(env, { cache: {} });
        expect(env.useWasmCache).toBe(false);
        expect(env.backends.onnx.wasm.numThreads).toBe(1);
        expect(env.backends.onnx.wasm.proxy).toBe(false);
    });

    it('asks for WASM whatever the browser reports, because WebGPU does not run this model', () => {
        // Measured against the real stack on 2026-08-31: the WebGPU backend loads and then
        // fails at inference with the quantised Whisper export (`OrtRun` → `GetReducedShape`
        // in the WebGPU EP), while plain WASM does a 30 s clip in ~1.6 s. A backend that
        // loads and then throws is worse than one that was never offered.
        expect(configureEnvironment(freshEnv(), { cache: {}, webgpu: true }).device).toBe('wasm');
        expect(configureEnvironment(freshEnv(), { cache: {}, webgpu: false }).device).toBe('wasm');
    });

    it('survives an env with no onnx backend rather than throwing on the way in', () => {
        const env = freshEnv();
        delete env.backends;
        expect(() => configureEnvironment(env, { cache: {} })).not.toThrow();
        expect(env.allowRemoteModels).toBe(false);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. Audio in, a §5.2 object out                                                         */
/* ------------------------------------------------------------------------------------ */

describe('concatClips', () => {
    it('joins a take add more produced into one continuous stretch', () => {
        const joined = concatClips([clip('a', [1, 2]), clip('b', [3, 4, 5])]);
        expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5]);
    });

    it('hands a single clip back untouched rather than copying it', () => {
        const only = clip('a', [1, 2]);
        expect(concatClips([only])).toBe(only.audio);
    });
});

describe('asProposal', () => {
    it('says plainly that it found no feeling, which is what §4.6 calls ambiguity: feeling', () => {
        // Not a placeholder for D3's work: it is the true description of what a transcriber
        // knows, and the card already answers it by opening the grid with nothing chosen.
        expect(asProposal('  Lucie called.  ', 'en')).toEqual({
            transcript: 'Lucie called.',
            language: 'en',
            feelings: [],
            people: [],
            facts: [],
            ambiguity: 'feeling'
        });
    });

    it('never invents a language it was not given', () => {
        expect(asProposal('hi', null).language).toBe('');
        expect(asProposal(undefined, undefined).transcript).toBe('');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. The runtime, behind the C2 boundary and with the library faked                      */
/* ------------------------------------------------------------------------------------ */

describe('the web runtime', () => {
    const withPipeline = (transcribe) => createWebTranscriber({
        loadPipeline: async () => transcribe
    });

    it('declares itself as the web runtime, taking audio', () => {
        const runtime = withPipeline(vi.fn());
        expect(runtime.id).toBe(RUNTIME_IDS.web);
        expect(runtime.accepts).toEqual([INPUT_MODES.audio]);
        expect(runtime.model).toBe(WHISPER_TINY);
    });

    it('loads nothing until it is asked something', async () => {
        const loadPipeline = vi.fn(async () => vi.fn());
        const runtime = createWebTranscriber({ loadPipeline });
        expect(loadPipeline).not.toHaveBeenCalled();

        await propose(audioInput([clip('a')]), context(), runtime);
        expect(loadPipeline).toHaveBeenCalledTimes(1);
    });

    it('loads once, however many takes it is given', async () => {
        const loadPipeline = vi.fn(async () => vi.fn(async () => ({ text: 'words' })));
        const runtime = createWebTranscriber({ loadPipeline });

        await Promise.all([
            propose(audioInput([clip('a')]), context(), runtime),
            propose(audioInput([clip('b')]), context(), runtime)
        ]);
        await propose(audioInput([clip('c')]), context(), runtime);

        expect(loadPipeline).toHaveBeenCalledTimes(1);
    });

    it('transcribes, never translates, and asks for Whisper own frame rate', async () => {
        const transcribe = vi.fn(async () => ({ text: 'Lucie called.', language: 'en' }));
        const result = await propose(audioInput([clip('a')]), context(), withPipeline(transcribe));

        expect(result.ok).toBe(true);
        expect(result.proposal.transcript).toBe('Lucie called.');
        expect(result.proposal.ambiguity).toBe('feeling');

        const [audio, options] = transcribe.mock.calls[0];
        expect(audio).toBeInstanceOf(Float32Array);
        expect(options).toMatchObject({
            task: 'transcribe',
            sampling_rate: TARGET_SAMPLE_RATE,
            return_timestamps: false
        });
    });

    it('detects the language by default and pins it when the setting says to', async () => {
        const transcribe = vi.fn(async () => ({ text: 'hallo', language: 'de' }));

        const auto = await propose(audioInput([clip('a')]), context(), withPipeline(transcribe));
        expect(transcribe.mock.calls[0][1].language).toBeNull();
        expect(auto.proposal.language).toBe('de');

        const pinned = buildContext({ language: 'de' });
        await propose(audioInput([clip('b')]), pinned, withPipeline(transcribe));
        expect(transcribe.mock.calls[1][1].language).toBe('de');
    });

    it('surfaces a load failure as a typed failure rather than an escaping exception', async () => {
        const runtime = createWebTranscriber({
            loadPipeline: async () => { throw new Error('out of memory'); }
        });
        const result = await propose(audioInput([clip('a')]), context(), runtime);

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
        expect(result.failure.runtime).toBe(RUNTIME_IDS.web);
    });

    it('refuses text, because this build has no model that reads words', async () => {
        const result = await propose('a typed note', context(), withPipeline(vi.fn()));
        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.unavailable);
    });
});
