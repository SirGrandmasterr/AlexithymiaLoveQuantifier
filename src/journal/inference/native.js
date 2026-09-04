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

/* The Light tier's transcriber — C4's runtime, unchanged */

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

        unload: async () => { }
    };
};

/* The model that proposes */

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

/* The runtime a screen asks for */

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
