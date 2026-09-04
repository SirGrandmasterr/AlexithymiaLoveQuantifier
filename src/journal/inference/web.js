import { RUNTIME_IDS, INPUT_MODES, InferenceError, FAILURE_KINDS, TASKS, asProposal } from './contract';
import { WHISPER_TINY, GEMMA_E2B_ONNX, GEMMA_E2B_ONNX_TEXT, PROPOSAL_MODEL, MODEL_BASE_PATH } from './models';
import { createVerifiedCache } from './download';
import { createLightRuntime } from './light';
import { buildPrompt, PROMPT_VERSION } from './prompt';
import { buildRitualPrompt } from './ritual';
import { parseModelJson } from './parse';
import { TARGET_SAMPLE_RATE } from '../recorder';
import { TIERS } from './tier';

import ortWasmUrl from 'alq-ort-wasm';
import ortMjsUrl from 'alq-ort-mjs';

/** What Whisper is asked to do. Transcribe, never translate — the words as they were said. */
const TASK = 'transcribe';

/** transformers.js's own name for "work the language out yourself" (§4.3). */
export const AUTO_LANGUAGE = null;

export const MAX_NEW_TOKENS = 1024;

export const IDLE_UNLOAD_MS = 120_000;

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

export { asProposal } from './contract';

/* The Light tier's transcriber — C3's runtime, unchanged */

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

/* The model that proposes */

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

/* The runtime a screen asks for */

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
