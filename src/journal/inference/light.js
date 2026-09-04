/**
 * The Light tier: two models in sequence, behind one `propose`.
 *
 * §5.1 collapsed a transcriber and a text model into one audio-native pass, and then kept the
 * two-model design as the Light tier — *"the honest way to keep the floor low"* (§12.2). This
 * file is that design, and it is deliberately eight lines of logic: a transcriber writes the
 * words down, the proposer reads them, and everything above the boundary sees exactly what it
 * sees on the Full tier.
 *
 * **The record is identical and only `runtime` differs** (§5.5's Light row). That is the
 * promise this file has to keep, and it keeps it by not being clever: the proposal that comes
 * back is the proposer's, with the *transcriber's* words put back into it. The reason the
 * words are restored rather than trusted is the same reason `index.js` echoes them in text
 * mode (§5.2) — the transcript is the user's own speech, and a text-mode model handed a
 * transcript is being asked to label it, never to rewrite it. On this tier that rule protects
 * something specific: Whisper heard the audio and Gemma did not, so Whisper's spelling of a
 * name is the better one, and it is the one the card offers to `personCandidates` (§4.5).
 *
 * **The two halves fail differently, and that asymmetry is the point.** If the transcriber
 * fails there is nothing: no words, no proposal, and the caller gets a failure envelope the
 * card has copy for. If the *proposer* fails the words still exist, and losing them would be
 * the worst outcome this feature has — somebody spoke, the app heard them, and a model nobody
 * asked for threw the sentence away. So a proposer failure degrades to exactly what C3
 * shipped: the transcript, with `ambiguity: "feeling"`, which §4.6 already defines as *words
 * present, no feeling identifiable* and which the card already answers by opening the chip
 * grid with nothing pre-selected.
 *
 * That is not a silent fallback. It is the same answer the Light tier gives on a device where
 * the proposal model was never installed, and the card renders it identically; what changes is
 * only that no chip is dashed. The Full tier has no equivalent, because there the transcript
 * comes from the model that failed.
 */

import { INPUT_MODES, InferenceError, FAILURE_KINDS } from './contract';
import { TIERS } from './tier';

/**
 * Compose a transcriber and a proposer into one Light-tier runtime.
 *
 * Both halves are injected. That is what lets `web.js` and `native.js` build the same
 * composition out of entirely different parts — transformers.js and a Capacitor bridge — and
 * what lets a test drive the composition itself with two fakes and no weights at all.
 */
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
        // What the provenance block names. The proposer's, because it is the model that
        // produced the labels; the transcriber is named in the settings copy beside it, and
        // `runtime` already says a transcriber was in the path.
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
