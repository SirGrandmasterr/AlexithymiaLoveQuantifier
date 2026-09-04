export const RUNTIME_IDS = {
    /** Full tier, Android: Gemma 4 E2B through LiteRT-LM, audio in, JSON out, one pass. */
    native: 'native',
    /** Full tier, web: the same model through transformers.js over WebGPU. */
    web: 'web',
    /** Light tier, Android: Whisper tiny writes the words, Gemma reads them. */
    nativeLight: 'native-light',
    /** Light tier, web: the same pair, in the browser. */
    webLight: 'web-light',
    /** Tests only. Never in the app's import graph — see `fake.js`. */
    fake: 'fake'
};

export const TASKS = {
    checkin: 'checkin',
    ritual: 'ritual'
};

/** What a request may be. `audio` on the Full tier, `text` on Light and after an edit (§4.3). */
export const INPUT_MODES = {
    audio: 'audio',
    text: 'text'
};

export const FAILURE_KINDS = {
    /** No runtime, or one that cannot take this kind of input. The text-only tier lives here. */
    unavailable: 'runtime_unavailable',
    /** The runtime was there and it threw. The original error travels on `cause`. */
    failed: 'runtime_failed',
    /** The caller passed something that is neither audio nor text. */
    input: 'invalid_input',
    /** The context is missing the closed vocabularies the model is constrained to. */
    context: 'invalid_context',
    /** The runtime returned nothing at all. Distinct from "it returned something wrong". */
    empty: 'empty_output'
};

export const asProposal = (text, language) => ({
    transcript: String(text ?? '').trim(),
    language: language || '',
    // No model looked for a feeling, so none was found — which is precisely §4.6's `feeling`
    // ambiguity, and the card opens the vocabulary grid with nothing pre-selected.
    feelings: [],
    people: [],
    facts: [],
    ambiguity: 'feeling'
});

/** Thrown by a runtime factory that cannot build one here. Never rendered; never caught by luck. */
export class InferenceError extends Error {
    constructor(message, kind = FAILURE_KINDS.unavailable, cause = null) {
        super(message);
        this.name = 'InferenceError';
        this.kind = kind;
        this.cause = cause;
    }
}
