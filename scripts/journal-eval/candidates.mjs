export const CANDIDATES = {
    'full-android': {
        id: 'full-android',
        tier: 'full',
        label: 'Full tier, Android — Gemma 4 E2B, one pass over audio',
        model: 'google/gemma-4-E2B-it',
        packaging: 'LiteRT-LM bundle, mixed 2/4/8-bit',
        modelSet: 'gemma-4-e2b-litertlm',
        file: 'litert-community/gemma-4-E2B-it-litert-lm/gemma-4-E2B-it.litertlm',
        runtime: 'litert-lm',
        mode: 'audio',
        transcriber: null,
        grammar: 'PROPOSAL_GRAMMAR_SCHEMA',
        appRuntimeId: 'native',
        device: 'the reference phone (§5.5); state the model and the SoC in the report',
        isDefaultFor: 'full'
    },

    'full-web': {
        id: 'full-web',
        tier: 'full',
        label: 'Full tier, desktop browser — Gemma 4 E2B, one pass over audio',
        model: 'google/gemma-4-E2B-it',
        packaging: 'ONNX, q4f16, four sessions',
        modelSet: 'gemma-4-e2b-onnx',
        file: 'onnx-community/gemma-4-E2B-it-ONNX',
        runtime: 'llama-mtmd-cli',
        mode: 'audio',
        transcriber: null,
        grammar: 'PROPOSAL_SCHEMA',
        appRuntimeId: 'web',
        device: 'the reference desktop; state CPU, RAM and GPU in the report',
        isDefaultFor: 'full',
        caveat: 'The app runs these weights under transformers.js over WebGPU, which has no '
            + 'grammar and no CLI. A pass here is evidence about the model, not about the web '
            + 'runtime; the web path stays unmeasured until it can be driven (D3 warning).'
    },

    'light-web': {
        id: 'light-web',
        tier: 'light',
        label: 'Light tier — Whisper tiny writes the words, Gemma 4 E2B reads them',
        model: 'google/gemma-4-E2B-it',
        packaging: 'ONNX, q4f16, text sessions only',
        modelSet: 'gemma-4-e2b-onnx',
        file: 'onnx-community/gemma-4-E2B-it-ONNX',
        runtime: 'llama-mtmd-cli',
        mode: 'text',
        transcriber: {
            model: 'openai/whisper-tiny',
            packaging: 'ONNX, int8',
            modelSet: 'whisper-tiny',
            runtime: 'whisper-cli'
        },
        grammar: 'PROPOSAL_SCHEMA',
        appRuntimeId: 'web-light',
        device: 'the reference desktop; state CPU and RAM in the report',
        isDefaultFor: 'light'
    },

    'desktop-e4b': {
        id: 'desktop-e4b',
        tier: 'full',
        label: 'Desktop tier — Gemma 4 E4B, one pass over audio',
        model: 'google/gemma-4-E4B-it',
        packaging: 'to be pinned; state the quantisation in the report',
        modelSet: 'gemma-4-e4b-onnx',
        file: null,
        runtime: 'llama-mtmd-cli',
        mode: 'audio',
        transcriber: null,
        grammar: 'PROPOSAL_SCHEMA',
        appRuntimeId: 'web',
        device: 'the reference desktop',
        isDefaultFor: null,
        open_question: 'Is E4B a desktop-tier default? (§12.5)',
        caveat: 'E4B is not in the Makefile manifest and not in `models.js`. Running this '
            + 'candidate means pinning it there first — a revision and a SHA-256 per file, '
            + 'like every other row — and the report says which revision it ran.'
    },

    'light-android-whisper': {
        id: 'light-android-whisper',
        tier: 'light',
        label: 'Light tier, Android — Whisper tiny on the device',
        model: 'google/gemma-4-E2B-it',
        packaging: 'LiteRT-LM bundle, text mode',
        modelSet: 'gemma-4-e2b-litertlm',
        file: 'litert-community/gemma-4-E2B-it-litert-lm/gemma-4-E2B-it.litertlm',
        runtime: 'replay',
        mode: 'text',
        transcriber: { model: 'openai/whisper-tiny', packaging: 'ONNX, int8', modelSet: 'whisper-tiny', runtime: 'onnxruntime-android' },
        grammar: 'PROPOSAL_GRAMMAR_SCHEMA',
        appRuntimeId: 'native-light',
        device: 'the reference phone',
        isDefaultFor: 'light',
        open_question: 'Is the Android Light-tier transcriber Whisper or the platform recogniser? (§12.5)',
        caveat: 'Android has no CLI to drive. This candidate is scored from a replay file '
            + 'captured on the device — see README.md §"Running a candidate that lives on a phone".'
    },

    'light-android-platform': {
        id: 'light-android-platform',
        tier: 'light',
        label: 'Light tier, Android — the platform SpeechRecognizer (API 31+)',
        model: 'google/gemma-4-E2B-it',
        packaging: 'LiteRT-LM bundle, text mode',
        modelSet: 'gemma-4-e2b-litertlm',
        file: 'litert-community/gemma-4-E2B-it-litert-lm/gemma-4-E2B-it.litertlm',
        runtime: 'replay',
        mode: 'text',
        transcriber: { model: 'android.speech.SpeechRecognizer', packaging: 'on-device, vendor', modelSet: null, runtime: 'platform' },
        grammar: 'PROPOSAL_GRAMMAR_SCHEMA',
        appRuntimeId: 'native-light',
        device: 'the reference phone; state the Android version and the OEM',
        isDefaultFor: null,
        open_question: 'Is the Android Light-tier transcriber Whisper or the platform recogniser? (§12.5)',
        caveat: 'The platform recogniser is a different model on every phone and its result is '
            + 'a fact about that handset. It is also not offered by the app today (C4, §5.5 '
            + 'option D). A pass here is evidence, not a shipping decision.'
    },

    reference: {
        id: 'reference',
        tier: 'none',
        label: 'The golden references themselves — a self-check of the harness',
        model: null,
        packaging: null,
        modelSet: null,
        file: null,
        runtime: 'reference',
        mode: 'text',
        transcriber: null,
        grammar: 'PROPOSAL_SCHEMA',
        appRuntimeId: null,
        device: 'wherever the harness runs; no weights are loaded',
        isDefaultFor: null,
        caveat: 'Not a model. This candidate answers every case with the hand-written reference '
            + 'from the golden suite, so a perfect score means the harness arithmetic is wired '
            + 'up — and means nothing whatever about any model.'
    }
};

/** The candidates §5.7's gate is actually about: one default per tier. */
export const TIER_DEFAULTS = Object.values(CANDIDATES).filter(candidate => candidate.isDefaultFor);

export const candidateById = (id) => CANDIDATES[id] || null;
