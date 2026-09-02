/**
 * The Android runtimes: Gemma 4 E2B through LiteRT-LM on the Full tier, Whisper tiny through
 * ONNX Runtime on the Light one, both behind the C2 boundary and both inside the plugin.
 *
 * What is different here from the web is not the model — it is the same model, the same
 * prompt and the same schema — but where the bytes live. **Audio never crosses the bridge**
 * (§4.2): the samples stay in the plugin's `ClipStore` and this file sends *handles*, so a
 * 30 s clip is a string on the JavaScript side and a `float[]` on the native one. The same
 * is true of the answer's cost: the model is opened, held and unloaded by Java, because Java
 * is where the 2.6 GB is.
 *
 * **Android is the platform with the grammar.** LiteRT-LM takes a JSON Schema natively
 * (`ResponseFormat.json`, LLGuidance underneath), so the model cannot emit tokens outside it
 * — while on the web, which has no grammar at all, the same contract is carried in the prompt
 * and enforced afterwards.
 *
 * What is handed down is `PROPOSAL_GRAMMAR_SCHEMA` and not `PROPOSAL_SCHEMA`, and the one
 * difference between them is a measurement rather than a preference: LLGuidance cannot bind an
 * enum member containing a space against Gemma's tokeniser, and three of the seven context
 * tags contain one. `schema.js` carries the error it produced and the reasoning; the short
 * version is that `tag` reaches the grammar as a bounded string and reaches the card as a
 * member of `CONTEXT_TAGS`, because **a grammar is a guarantee about tokens and not about
 * meaning**. The same run proved that is not theoretical: the model answered
 * `{ kind: "tag", tag: "work" }` — a trigger label, not a context tag — and
 * `validateProposal` is what drops it, on both platforms.
 *
 * The plugin is injected so a test can stand a fake in front of it — the same rail that keeps
 * `npm test` free of weights everywhere else (§5.7). The default is the real one.
 */

import { RUNTIME_IDS, INPUT_MODES, FAILURE_KINDS, InferenceError, TASKS, asProposal } from './contract';
import { WHISPER_TINY, GEMMA_E2B_LITERTLM, PROPOSAL_MODEL } from './models';
import { createLightRuntime } from './light';
import { buildPrompt, PROMPT_VERSION } from './prompt';
import { buildRitualPrompt, buildRitualSchema } from './ritual';
import { PROPOSAL_GRAMMAR_SCHEMA } from './schema';
import { parseModelJson } from './parse';
import { AlqJournal, isNativeAudio } from '../../mobile/journalPlugin';
import { MAX_NEW_TOKENS, IDLE_UNLOAD_MS } from './web';
import { TIERS } from './tier';

/** Clip handles for a request, or a refusal naming what was wrong. */
const handlesOf = (clips) => {
    const handles = (clips || []).map(clip => (isNativeAudio(clip.audio) ? clip.audio.handle : null));
    if (handles.length === 0 || handles.some(handle => handle === null)) {
        // A browser buffer has no business here: it would have crossed the bridge.
        throw new InferenceError('the native runtime takes clips the plugin recorded', FAILURE_KINDS.input);
    }
    return handles;
};

/* ------------------------------------------------------------------------------------ */
/* The Light tier's transcriber — C4's runtime, unchanged                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * Whisper tiny through the plugin: the same pinned ONNX export the web loads, run through
 * ONNX Runtime Android with the spectrogram, tokeniser and decode loop written in Java.
 *
 * It writes words down and proposes nothing, so every result carries `ambiguity: "feeling"`
 * (§4.6) — which on the Light tier is never seen, because `createLightRuntime` hands the
 * words straight to Gemma. It is seen when the proposal model is not installed, and it is
 * then exactly the honest answer.
 */
export const createNativeTranscriber = (options = {}) => {
    const { plugin = AlqJournal, model = WHISPER_TINY, language = null } = options;

    return {
        id: RUNTIME_IDS.native,
        tier: TIERS.light,
        accepts: [INPUT_MODES.audio],
        model,

        propose: async (request) => {
            if (request.kind !== INPUT_MODES.audio) {
                throw new InferenceError('the transcriber takes audio only', FAILURE_KINDS.unavailable);
            }
            const handles = handlesOf(request.clips);
            const pinned = request.context?.language || language || null;
            const out = await plugin.transcribe({
                handles,
                language: pinned,
                model: { id: model.id, files: model.files.map(file => ({ path: file.path })) }
            });
            return asProposal(out?.text, pinned || out?.language || '');
        },

        /**
         * Nothing to do here: the plugin closes its session when the app leaves the screen
         * and when the files are removed, and a killed process takes it with it.
         */
        unload: async () => { }
    };
};

/* ------------------------------------------------------------------------------------ */
/* The model that proposes                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * Gemma 4 E2B through LiteRT-LM — the runtime that answers §5.2 on a phone.
 *
 * One bundle serves both tiers, because LiteRT-LM loads the audio encoder on demand: a Full
 * tier session is created with an audio backend and given a clip, a Light tier one is created
 * without and given a transcript, and the file on disk is the same 2.6 GB either way. That is
 * the one place Android is simpler than the web, where the two tiers are genuinely different
 * downloads.
 *
 * `unload` is not decoration. §12.1's battery row asks for the model to be let go when idle,
 * and the plugin runs its own timer for the case this object is garbage before it can call —
 * a WebView that is torn down mid-check-in must not leave two gigabytes resident. This
 * `unload` is the deliberate half of the same thing.
 */
export const createNativeProposer = (options = {}) => {
    const {
        plugin = AlqJournal,
        model = GEMMA_E2B_LITERTLM,
        tier = TIERS.full,
        language = null,
        idleUnloadMs = IDLE_UNLOAD_MS,
        maxTokens = MAX_NEW_TOKENS
    } = options;

    const audioNative = tier === TIERS.full;

    return {
        id: audioNative ? RUNTIME_IDS.native : RUNTIME_IDS.nativeLight,
        tier,
        accepts: audioNative ? [INPUT_MODES.audio, INPUT_MODES.text] : [INPUT_MODES.text],
        // What `payload.proposal` records (§6.3, D2). The bundle this phone opened is a
        // deployment detail; which model answered is not.
        model: PROPOSAL_MODEL.id,
        promptVersion: PROMPT_VERSION,
        /** The record the plugin and the download manager need. Not provenance. */
        weights: model,

        /** Open the engine without asking it anything, so the first check-in is not the wait. */
        load: async () => plugin.loadProposer({
            model: { id: model.id, bundle: model.bundle },
            audio: audioNative,
            idleUnloadMs
        }),

        unload: async () => { await plugin.releaseProposer(); },

        propose: async (request) => {
            if (request.kind === INPUT_MODES.audio && !audioNative) {
                throw new InferenceError(
                    'this tier runs the model in text mode; a transcriber writes the words',
                    FAILURE_KINDS.unavailable
                );
            }

            const ritual = request.task === TASKS.ritual;
            const questions = request.questions || [];
            const system = ritual
                ? buildRitualPrompt(questions, request.context || {})
                : buildPrompt(request.context || {});
            // The grammar. LiteRT-LM refuses tokens outside it; `validateProposal` still
            // reads what comes back, because the two are answering different questions.
            const schema = ritual
                ? buildRitualSchema(questions.map(question => question?.id ?? question))
                : PROPOSAL_GRAMMAR_SCHEMA;

            const pinned = request.context?.language || language || null;

            const out = await plugin.propose({
                ...(request.kind === INPUT_MODES.audio
                    ? { handles: handlesOf(request.clips) }
                    : { text: String(request.text ?? '') }),
                system,
                schema: JSON.stringify(schema),
                language: pinned,
                maxTokens,
                idleUnloadMs,
                model: { id: model.id, bundle: model.bundle },
                audio: audioNative
            });

            const { value, repairs, error } = parseModelJson(out?.text ?? '');
            if (value === null) {
                // With a grammar in force this should not happen, and that is exactly why it
                // is reported rather than repaired: it would mean the grammar did not bind.
                throw new InferenceError(error || 'the model did not answer with JSON', FAILURE_KINDS.empty);
            }
            return repairs.length ? { ...value, __repairs: repairs } : value;
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* The runtime a screen asks for                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * The plugin's runtime for a tier — Gemma over the audio on Full, Whisper then Gemma on
 * Light, and the same shape as the web's so that nothing above this line can tell a phone
 * from a browser.
 */
export const createNativeRuntime = (options = {}) => {
    const { tier = TIERS.full } = options;

    if (tier !== TIERS.light) return createNativeProposer({ ...options, tier: TIERS.full });

    return createLightRuntime({
        id: RUNTIME_IDS.nativeLight,
        transcriber: options.transcriber || createNativeTranscriber({
            plugin: options.plugin,
            model: options.transcriberModel || WHISPER_TINY,
            language: options.language
        }),
        proposer: options.proposer || createNativeProposer({ ...options, tier: TIERS.light })
    });
};
