/**
 * The browser's runtimes: Gemma 4 E2B on the Full tier, Whisper tiny on the Light one, both
 * behind the C2 boundary and both on this device.
 *
 * Until D3 this file held one runtime that wrote words down and proposed nothing. It now
 * holds two, and the difference between them is the difference between the tiers (§5.5):
 *
 * - **`createWebProposer`** is Gemma 4 E2B through transformers.js over WebGPU. On the Full
 *   tier it takes the audio directly and returns the transcript *and* the labels from one
 *   pass (§5.1). In text mode it takes words — a typed note, an edited transcript, or the
 *   Light tier's Whisper output — and returns the labels for them.
 * - **`createWebTranscriber`** is C3's Whisper tiny, unchanged: 45 MB, WASM, words only.
 * - **`createWebRuntime`** is the one a screen asks for. It hands back the proposer on the
 *   Full tier and the two of them composed on the Light tier, and nothing above it can tell
 *   which it is holding.
 *
 * **Four things here are load-bearing for the Vault page, and each is a line of code rather
 * than an intention:**
 *
 * 1. `env.allowRemoteModels = false` — the library is forbidden the Hugging Face Hub. There
 *    is no fallback to it, and `connect-src 'self'` would refuse one a layer lower anyway.
 * 2. `env.localModelPath = '/models/'` — the weights come from this app's own origin, out of
 *    the volume the operator filled with `make models-fetch` (§5.6, C1).
 * 3. `env.customCache` is the **verified** cache: the only writer is the download manager,
 *    which hashes before it keeps. The library reads through it and can never see a byte
 *    nothing checked.
 * 4. `wasmPaths` points at this origin too. Left alone, transformers.js sets ONNX Runtime's
 *    WASM path to `https://cdn.jsdelivr.net/...`, which would put a CDN request in the
 *    network tab of a page that says every request goes to this app's own origin. The `.wasm`
 *    and its loader are emitted into the build by Vite from the pinned npm package instead,
 *    so they are same-origin assets with the same provenance as the rest of the code.
 *
 * `env.useWasmCache = false` is the fifth, and it is about the CSP rather than the network.
 * With it on, the library fetches the ONNX loader and re-serves it to itself **as a blob
 * URL**, which `script-src 'self' 'wasm-unsafe-eval'` refuses — the same shape of problem C1
 * measured for `worker-src` and left for C3. Turning it off makes the loader a plain
 * same-origin module import, which needs no policy change at all.
 *
 * **There is no grammar on this path, and that is measured rather than assumed.**
 * `@huggingface/transformers` 4.2.0 exposes fourteen logits processors — forced tokens,
 * suppressed tokens, n-gram and repetition penalties, temperature, top-k, top-p — and no way
 * to constrain generation to a JSON Schema; `logits_processor` accepts a custom list, which
 * is an extension point and not a feature. So on the web the §5.2 contract is enforced by
 * `validateProposal` alone (D3, 2026-09-02, closing §5.2's `(verify)`), and the schema is
 * carried into the prompt in words instead. Android is the platform that gets the grammar.
 *
 * The heavy import is **dynamic**, so none of transformers.js reaches the main chunk. A user
 * who never turns voice on never downloads a byte of it.
 */

import { RUNTIME_IDS, INPUT_MODES, InferenceError, FAILURE_KINDS, TASKS, asProposal } from './contract';
import { WHISPER_TINY, GEMMA_E2B_ONNX, GEMMA_E2B_ONNX_TEXT, PROPOSAL_MODEL, MODEL_BASE_PATH } from './models';
import { createVerifiedCache } from './download';
import { createLightRuntime } from './light';
import { buildPrompt, PROMPT_VERSION } from './prompt';
import { buildRitualPrompt } from './ritual';
import { parseModelJson } from './parse';
import { TARGET_SAMPLE_RATE } from '../recorder';
import { TIERS } from './tier';

// ONNX Runtime's WebAssembly, emitted into the build as same-origin assets. The two
// `alq-ort-*` specifiers are aliases in `vite.config.js`, which also carries the reason
// they exist; `?url` gives back the hashed path rather than the module, which is what
// ONNX Runtime wants and what keeps 22 MB of binary out of the JavaScript chunk.
//
// The **plain** pair, not the `asyncify` one transformers.js defaults to, and that is a
// measurement rather than a preference — see `configureEnvironment` below.
import ortWasmUrl from 'alq-ort-wasm';
import ortMjsUrl from 'alq-ort-mjs';

/** What Whisper is asked to do. Transcribe, never translate — the words as they were said. */
const TASK = 'transcribe';

/** transformers.js's own name for "work the language out yourself" (§4.3). */
export const AUTO_LANGUAGE = null;

/**
 * Enough tokens for the largest answer §5.2 admits, and not one more.
 *
 * A 1,000-character transcript, six people, three facts and five feelings with their `about`
 * lists is about 700 tokens of JSON at Gemma's tokeniser. 1,024 leaves room and still stops
 * a model that has started repeating itself before it has spent a minute doing it — the cap
 * is a latency promise as much as a memory one.
 */
export const MAX_NEW_TOKENS = 1024;

/**
 * Let the weights go this long after the last question (§12.1's battery row).
 *
 * Two minutes is chosen against the shape of a check-in rather than against a battery
 * curve: the *This isn't it* loop and a transcript edit both re-ask within seconds, and
 * reloading three gigabytes to answer a correction would make the correction the slow part
 * of the feature. A second check-in five minutes later pays the load again, which is the
 * right way round — nobody is holding a phone waiting for it.
 */
export const IDLE_UNLOAD_MS = 120_000;

/**
 * Point the library at this origin, once.
 *
 * Split out and exported because it is the part the Vault page's truth rests on, and a test
 * can assert it against a fake `env` object without loading a gigabyte of model.
 *
 * `device` is the caller's, not this function's: the two runtimes want different backends for
 * measured reasons, and a helper that decided for both would have to be wrong for one.
 */
export const configureEnvironment = (env, { cache, device = 'wasm' } = {}) => {
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = MODEL_BASE_PATH;

    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = cache;

    // See the header: this is what keeps the ONNX loader a same-origin module rather than a
    // blob URL the CSP refuses.
    env.useWasmCache = false;

    const onnx = env.backends?.onnx;
    if (onnx?.wasm) {
        onnx.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
        // One thread. Multi-threaded ONNX spawns its pool from a URL the policy has opinions
        // about, and Whisper transcribing one sentence is not where threading pays. Gemma
        // does not use this path at all: WebGPU is mandatory for it.
        onnx.wasm.numThreads = 1;
        onnx.wasm.proxy = false;
    }

    return { device };
};

/** Whether this browser can run the Full tier at all. Mandatory for Gemma, with no fallback. */
export const hasWebGpu = (view = globalThis) => Boolean(view.navigator?.gpu);

/** Whisper wants one continuous stretch; two clips of one take are two turns of one note. */
export const concatClips = (clips) => {
    const total = clips.reduce((sum, clip) => sum + clip.audio.length, 0);
    if (clips.length === 1) return clips[0].audio;

    const joined = new Float32Array(total);
    let at = 0;
    clips.forEach(clip => { joined.set(clip.audio, at); at += clip.audio.length; });
    return joined;
};

/**
 * What Whisper hands back, turned into the §5.2 object the rest of the app already reads.
 * Since C4 it lives in `contract.js`, because the native runtime returns the same shape and
 * two copies of it would be two chances to disagree; re-exported here so nothing that
 * imported it from this file has to move.
 */
export { asProposal } from './contract';

/* ------------------------------------------------------------------------------------ */
/* The Light tier's transcriber — C3's runtime, unchanged                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Whisper tiny, in a browser. Forty-five megabytes, WASM, and words only.
 *
 * **WASM and not WebGPU, and that is a measurement.** On 2026-08-31 the WebGPU backend
 * loaded this pipeline in 1.2 s and then failed at inference — `OrtRun` → `GetReducedShape`
 * inside the WebGPU execution provider — while plain WASM loads the model in 2.2 s and
 * transcribes a 30 s clip in 2.2 s. A backend that loads and then throws is worse than one
 * that was never offered. Gemma's export is a different one and does use WebGPU; the two
 * runtimes disagreeing about the backend is the reason `configureEnvironment` stopped
 * deciding for them.
 *
 * Nothing is loaded here. The 45 MB arrives on the first `propose`, and only if the download
 * manager already verified it into the cache — this runtime never downloads anything itself,
 * which is what keeps "size and cancel before anything moves" true of the code rather than
 * of the screen that usually shows it.
 */
export const createWebTranscriber = (options = {}) => {
    const {
        model = WHISPER_TINY,
        cache = createVerifiedCache(),
        language = AUTO_LANGUAGE,
        // Injected so the runtime can be exercised without the real library.
        loadPipeline = null
    } = options;

    let pipe = null;
    let loading = null;

    const load = async (onProgress) => {
        if (pipe) return pipe;
        if (loading) return loading;

        loading = (async () => {
            if (loadPipeline) {
                pipe = await loadPipeline({ model, cache, onProgress });
                return pipe;
            }

            // The one dynamic import. Everything above this line is a few hundred bytes;
            // everything below it is megabytes that a text-only device never fetches.
            const { pipeline, env } = await import('@huggingface/transformers');
            const { device } = configureEnvironment(env, { cache, device: 'wasm' });

            pipe = await pipeline('automatic-speech-recognition', model.id, {
                dtype: model.dtype,
                device,
                progress_callback: onProgress
            });
            return pipe;
        })();

        try {
            return await loading;
        } finally {
            loading = null;
        }
    };

    return {
        id: RUNTIME_IDS.web,
        tier: TIERS.light,
        accepts: [INPUT_MODES.audio],
        model,

        /** Warm the model without asking it anything. The settings screen uses it after a download. */
        load,

        propose: async (request) => {
            if (request.kind !== INPUT_MODES.audio) {
                throw new InferenceError('the transcriber takes audio only', FAILURE_KINDS.unavailable);
            }

            const transcriber = await load();
            const audio = concatClips(request.clips);
            const pinned = request.context?.language || language;

            const output = await transcriber(audio, {
                task: TASK,
                // `null` means "detect it", which is §4.3's default; a pinned language is the
                // setting for people whose notes mix languages the detector gets wrong.
                language: pinned || null,
                // Whisper's own frame rate. The recorder already produces exactly this, and
                // stating it here means a change on either side fails loudly rather than
                // resampling something silently.
                sampling_rate: TARGET_SAMPLE_RATE,
                return_timestamps: false
            });

            return asProposal(output?.text, pinned || output?.language || '');
        },

        /** Let the weights go. Called when the user turns voice off or removes the files. */
        unload: async () => {
            if (pipe?.dispose) await pipe.dispose().catch(() => { });
            pipe = null;
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* The model that proposes                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * Gemma 4 E2B through transformers.js — the runtime that answers §5.2.
 *
 * **Which model class is asked for is the tier.** transformers.js opens one ONNX session per
 * part of the architecture, and it decides which parts from the class: asking for
 * `Gemma4ForConditionalGeneration` opens the embedding table, the decoder, the audio encoder
 * and the vision encoder; asking for `Gemma4ForCausalLM` against the same repository puts the
 * library in its text-only mode, where the map is the embedding table and the decoder and
 * nothing else. That is 3.4 GB against 3.1 GB on disk, and it is why the Light tier's
 * download is a real subset of the Full tier's rather than the same files with two of them
 * ignored (`GEMMA_E2B_ONNX_TEXT`, `models.js`).
 *
 * **WebGPU is mandatory with no fallback** (§5.5). A browser without it is text-only, and the
 * settings screen says so in words rather than offering a model that would take minutes per
 * token on WASM. This runtime refuses to load rather than degrading, because a degradation
 * nobody chose is a promise nobody made.
 */
export const createWebProposer = (options = {}) => {
    const {
        tier = TIERS.full,
        cache = createVerifiedCache(),
        language = AUTO_LANGUAGE,
        idleUnloadMs = IDLE_UNLOAD_MS,
        // Injected so the runtime can be exercised without three gigabytes of weights.
        loadModel = null,
        view = globalThis
    } = options;

    const audioNative = tier === TIERS.full;
    const model = options.model || (audioNative ? GEMMA_E2B_ONNX : GEMMA_E2B_ONNX_TEXT);

    let held = null;
    let loading = null;
    let idleTimer = null;

    const clearIdle = () => {
        if (idleTimer === null) return;
        clearTimeout(idleTimer);
        idleTimer = null;
    };

    const unload = async () => {
        clearIdle();
        const previous = held;
        held = null;
        if (previous?.instance?.dispose) await previous.instance.dispose().catch(() => { });
    };

    /**
     * Start the idle countdown (§12.1's battery row).
     *
     * `unref` where the host has it, because in Node — which is where a test runs — a live
     * timer keeps the process alive and a two-minute one would hold a suite open for two
     * minutes after it finished asserting.
     */
    const touch = () => {
        clearIdle();
        if (!Number.isFinite(idleUnloadMs) || idleUnloadMs <= 0) return;
        idleTimer = setTimeout(() => { idleTimer = null; unload(); }, idleUnloadMs);
        if (typeof idleTimer?.unref === 'function') idleTimer.unref();
    };

    const load = async (onProgress) => {
        if (held) return held;
        if (loading) return loading;

        loading = (async () => {
            if (loadModel) {
                held = await loadModel({ model, tier, cache, onProgress });
                return held;
            }

            if (!hasWebGpu(view)) {
                throw new InferenceError(
                    'this browser has no WebGPU, which the proposal model requires',
                    FAILURE_KINDS.unavailable
                );
            }

            const transformers = await import('@huggingface/transformers');
            configureEnvironment(transformers.env, { cache, device: 'webgpu' });

            const ModelClass = audioNative
                ? transformers.Gemma4ForConditionalGeneration
                : transformers.Gemma4ForCausalLM;

            const [processor, instance] = await Promise.all([
                transformers.AutoProcessor.from_pretrained(model.id),
                ModelClass.from_pretrained(model.id, {
                    dtype: model.dtype,
                    device: 'webgpu',
                    progress_callback: onProgress
                })
            ]);

            held = { processor, instance };
            return held;
        })();

        try {
            return await loading;
        } finally {
            loading = null;
        }
    };

    /**
     * One turn: a system prompt, a user turn that may carry audio, and the model's answer as
     * a string.
     *
     * The generated tokens are sliced off the end of the sequence before decoding. Without
     * that slice the "answer" is the whole conversation including the system prompt, and the
     * parser would find the *schema description's* braces first — a failure that looks like
     * a model that ignored its instructions and is not one.
     */
    const generate = async ({ system, audio, text }) => {
        const { processor, instance } = await load();

        const content = [];
        if (audio) content.push({ type: 'audio' });
        content.push({ type: 'text', text });

        const rendered = processor.apply_chat_template([
            { role: 'system', content: [{ type: 'text', text: system }] },
            { role: 'user', content }
        ], { add_generation_prompt: true, tokenize: false });

        const inputs = await processor(rendered, null, audio ? [audio] : null);
        const promptLength = inputs.input_ids.dims.at(-1);

        const sequences = await instance.generate({
            ...inputs,
            max_new_tokens: MAX_NEW_TOKENS,
            // Greedy. A proposal the user is about to confirm should be the same proposal
            // twice for the same words: `do_sample: true` would make the *This isn't it*
            // loop a slot machine, and D4's golden suite unrepeatable.
            do_sample: false
        });

        const [answer] = processor.batch_decode(
            sequences.slice(null, [promptLength, null]),
            { skip_special_tokens: true }
        );
        return answer ?? '';
    };

    return {
        id: audioNative ? RUNTIME_IDS.web : RUNTIME_IDS.webLight,
        tier,
        // Text on both tiers: §4.3's edited transcript, §4.1's typed note, and the Light
        // tier's whole path go through it. Audio only where the encoder was downloaded.
        accepts: audioNative ? [INPUT_MODES.audio, INPUT_MODES.text] : [INPUT_MODES.text],
        // **A runtime declares itself** (D2): these two are what `payload.proposal` records
        // as `model` and `prompt_version` (§6.3). `model` is the upstream model and not
        // this export of it, so two devices that ran the same model through different
        // runtimes produce comparable provenance — `runtime` is the field that differs.
        model: PROPOSAL_MODEL.id,
        promptVersion: PROMPT_VERSION,
        /** The record the download manager and the loader need. Not provenance. */
        weights: model,
        load,
        unload,

        propose: async (request) => {
            if (request.kind === INPUT_MODES.audio && !audioNative) {
                throw new InferenceError(
                    'this tier runs the model in text mode; a transcriber writes the words',
                    FAILURE_KINDS.unavailable
                );
            }

            const ritual = request.task === TASKS.ritual;
            const system = ritual
                ? buildRitualPrompt(request.questions || [], request.context || {})
                : buildPrompt(request.context || {});

            const pinned = request.context?.language || language;
            const spoken = pinned ? `The note is in ${pinned}.` : 'Answer for the note below.';

            let answer;
            try {
                answer = await generate({
                    system,
                    audio: request.kind === INPUT_MODES.audio ? concatClips(request.clips) : null,
                    text: request.kind === INPUT_MODES.audio
                        ? `${spoken} Listen to the note and answer with the JSON object.`
                        : `${spoken} The note is:\n\n${request.text}`
                });
            } finally {
                // Whatever happened, the clock starts now: a failed pass holds the same
                // three gigabytes a successful one does.
                touch();
            }

            const { value, repairs, error } = parseModelJson(answer);
            if (value === null) {
                throw new InferenceError(error || 'the model did not answer with JSON', FAILURE_KINDS.empty);
            }
            // The repairs travel so D4 can count them; the validator is what decides whether
            // any of it is usable.
            return repairs.length ? { ...value, __repairs: repairs } : value;
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* The runtime a screen asks for                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * The browser's runtime for a tier.
 *
 * Full is one model over the audio. Light is Whisper writing the words and Gemma reading
 * them — two models, one call, one card, and a different `runtime` id on the record so the
 * two are told apart later (§5.1, `contract.js`). Text-only has no runtime at all, and that
 * is the caller's `null` rather than an object here that refuses everything.
 */
export const createWebRuntime = (options = {}) => {
    const { tier = TIERS.full } = options;

    if (tier !== TIERS.light) return createWebProposer({ ...options, tier: TIERS.full });

    return createLightRuntime({
        id: RUNTIME_IDS.webLight,
        transcriber: options.transcriber || createWebTranscriber({
            model: options.transcriberModel || WHISPER_TINY,
            cache: options.cache,
            language: options.language,
            loadPipeline: options.loadPipeline
        }),
        proposer: options.proposer || createWebProposer({ ...options, tier: TIERS.light })
    });
};
