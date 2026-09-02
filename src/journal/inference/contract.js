/**
 * The vocabulary the boundary is written in: what a runtime is called, what it can be asked,
 * and what can go wrong.
 *
 * It lives in its own module for one structural reason. `index.js` exports the real
 * `createWebRuntime` by re-exporting `web.js`, and `web.js` needs these names — so if they
 * stayed in `index.js` the two files would import each other. A cycle that happens to work
 * under one bundler is not a design, and this vocabulary is exactly the kind of thing both
 * ends should depend on rather than trade.
 *
 * Everything here is re-exported from `index.js`, so `import { INPUT_MODES } from './index'`
 * keeps working and nothing outside this directory has to know the file exists.
 */

/**
 * Which runtime answered. Recorded on the result, and on the entry's provenance (§6.3).
 *
 * Four real ones since D3, because the tier is not a detail of the same runtime: the Full
 * tier is **one model doing one pass over audio** and the Light tier is **two models in
 * sequence**, and an entry proposed by the second should not claim to have been proposed by
 * the first. §3.7 and §5.1 both rest on that difference, and the eval report (D4) reads this
 * field to tell the two apart.
 *
 * The `web` and `native` ids kept their names through D3's change of what they mean, and
 * that is safe rather than lucky: before D3 no runtime proposed anything, so no row in any
 * database carries a `proposal.runtime` at all — the field arrives with the model.
 */
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

/**
 * What a runtime is being asked for.
 *
 * `checkin` is §5.2's proposal. `ritual` is §3.7's *ritual in one breath* — the same single
 * pass over the same audio, with the night's question ids in the prompt and the ritual
 * payload as the output schema. It is a second **task**, not a second model and not a second
 * download, which is the whole reason §3.7 costs what it costs.
 */
export const TASKS = {
    checkin: 'checkin',
    ritual: 'ritual'
};

/** What a request may be. `audio` on the Full tier, `text` on Light and after an edit (§4.3). */
export const INPUT_MODES = {
    audio: 'audio',
    text: 'text'
};

/**
 * Why a proposal did not happen. Each is a thing a screen can say a sentence about; none of
 * them is an exception the caller has to know exists.
 *
 * **`kind` is what a screen branches on; `message` is for a developer and a log, and must
 * never be rendered.** The sentence a user reads comes from `JOURNAL_COPY` like every other
 * sentence in this feature (§4.6), which is what keeps it inside the forbidden-word walk —
 * the strings below are not, and *"the runtime failed"* is exactly the register that walk
 * exists to keep off the screen.
 */
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

/**
 * What a transcriber hands back, as the §5.2 object the rest of the app already reads.
 *
 * Shared by the web and the native runtime so the two cannot disagree about the shape. The
 * transcript is trimmed and nothing else is touched: it is the user's own speech and the
 * one field D1's filter is forbidden to censor, and this is the earliest point that rule
 * could be broken, so it is worth saying here too.
 */
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
