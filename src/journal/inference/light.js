import { INPUT_MODES, InferenceError, FAILURE_KINDS } from './contract';
import { TIERS } from './tier';

export const createLightRuntime = ({ id, transcriber, proposer, model = null }) => {
    if (!transcriber || typeof transcriber.propose !== 'function') {
        throw new InferenceError('the Light tier needs a transcriber', FAILURE_KINDS.unavailable);
    }
    if (!proposer || typeof proposer.propose !== 'function') {
        throw new InferenceError('the Light tier needs a proposer', FAILURE_KINDS.unavailable);
    }

    return {
        id,
        tier: TIERS.light,
        // Audio, because the transcriber takes it; text, because the proposer does. The
        // composition is the only reason the first is true.
        accepts: [INPUT_MODES.audio, INPUT_MODES.text],
        model: model || proposer.model || null,
        promptVersion: proposer.promptVersion ?? null,
        weights: proposer.weights ?? null,

        /** Warm both, in order. The settings screen calls it after a download. */
        load: async (onProgress) => {
            if (transcriber.load) await transcriber.load(onProgress);
            if (proposer.load) await proposer.load(onProgress);
        },

        unload: async () => {
            if (transcriber.unload) await transcriber.unload();
            if (proposer.unload) await proposer.unload();
        },

        propose: async (request) => {
            if (request.kind === INPUT_MODES.text) {
                return proposer.propose(request);
            }

            const heard = await transcriber.propose(request);
            const transcript = String(heard?.transcript ?? '').trim();
            if (!transcript) {
                // Nothing was said, or nothing was heard. §4.6 has copy for it and the card
                // opens the grid; what it must not do is ask the proposer to label silence.
                throw new InferenceError('the transcriber heard no words', FAILURE_KINDS.empty);
            }

            let proposed;
            try {
                proposed = await proposer.propose({
                    ...request,
                    kind: INPUT_MODES.text,
                    text: transcript,
                    clips: undefined
                });
            } catch {
                // The words survive the model. See the header: this is C3's answer, which the
                // card has always known how to draw.
                return heard;
            }

            return {
                ...proposed,
                // Whisper heard the audio; the proposer only ever saw a string. Where the two
                // disagree about the words, the one that listened wins.
                transcript,
                language: heard?.language || proposed?.language || ''
            };
        }
    };
};
