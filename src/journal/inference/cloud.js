/**
 * The Gemini runtime (§5.5b): the same contract every other runtime implements, with the
 * model somewhere else.
 *
 * **Why this exists.** §5.5 puts a device on one of three tiers by what it can run, and the
 * bottom one — text-only — is a phone or a browser that cannot host three gigabytes of
 * weights. Those devices lose voice entirely. This runtime is the opt-in that gives it back:
 * one pass over the recording, the same prompt, the same output contract, and no model on the
 * device at all. A Full-tier machine can choose it too, for the reason anyone chooses a
 * bigger model.
 *
 * **The recording goes up as a recording.** Gemini is natively multimodal, so there is no
 * transcriber in front of it and no `createLightRuntime` composition: the WAV is the input
 * and the JSON is the output, exactly as the Full tier's audio-native pass works locally.
 * The transcript in the answer is the model's own, which is why §5.2's `transcript` field is
 * read from it here rather than echoed from the input the way text mode does.
 *
 * **What it does not do.** It does not talk to Google. The request goes to this app's own
 * origin — `connect-src 'self'` is unchanged, and the key belongs to the server (see
 * `backend/internal/handlers/gemini.go`). It does not parse, validate or trust: the answer
 * goes through `parseModelJson` and then the same `validateProposal` every other runtime's
 * answer goes through, because a model that ran somewhere else is not a model that earned
 * more credit.
 */

import axios from 'axios';
import { RUNTIME_IDS, INPUT_MODES, InferenceError, FAILURE_KINDS, TASKS } from './contract';
import { buildPrompt, PROMPT_VERSION } from './prompt';
import { buildRitualPrompt } from './ritual';
import { parseModelJson } from './parse';
import { GEMINI_MODEL } from './models';
import { TARGET_SAMPLE_RATE } from '../recorder';
import { WAV_MIME_TYPE, wavBase64 } from './wav';
import { canCapture } from './tier';
import { readCloudProposals } from '../../constants/journalSettings';
import { isNative } from '../../mobile/platform';

/** The relay, and the question the settings screen asks before it offers the toggle. */
export const PROPOSE_PATH = '/api/journal/propose';
export const PROPOSE_STATUS_PATH = '/api/journal/propose/status';

/**
 * Whether this server will relay a proposal, and which model it would use.
 *
 * Never throws: a server that is down, old, or without a key all mean the same thing to the
 * screen that asks — the option is not on offer here.
 */
export const cloudProposalStatus = async (client = axios) => {
    try {
        const { data } = await client.get(PROPOSE_STATUS_PATH);
        return {
            available: data?.available === true,
            model: typeof data?.model === 'string' && data.model ? data.model : GEMINI_MODEL.id
        };
    } catch {
        return { available: false, model: GEMINI_MODEL.id };
    }
};

/**
 * The server's answer, cached for the session, because a key does not come and go inside
 * one. Every screen that asks — the check-in kit, the settings page, the Vault page — reads
 * this rather than making its own request, so two screens cannot disagree about what is on
 * offer. `null` until the answer is back.
 */
let cloudStatus = null;
let cloudProbe = null;

export const cloudReport = () => cloudStatus;

/** For tests, and for a settings screen reopened after the operator restarted the server. */
export const setCloudReport = (report) => {
    cloudStatus = report && typeof report === 'object' ? { ...report } : null;
    cloudProbe = null;
};

export const primeCloudStatus = (client = axios) => {
    if (cloudStatus) return Promise.resolve(cloudStatus);
    if (cloudProbe) return cloudProbe;

    cloudProbe = cloudProposalStatus(client).then((report) => {
        cloudStatus = report;
        cloudProbe = null;
        return report;
    });
    return cloudProbe;
};

/** What the server said it would call, for the copy and for provenance. */
export const cloudModelName = () => cloudStatus?.model ?? GEMINI_MODEL.id;

/**
 * Whether this device is actually sending its check-ins to Gemini.
 *
 * Three answers and not one, and all three are needed. The user's switch, because it is
 * their decision. The server's, because a switch left on by a browser talking to a server
 * that has since lost its key would put a microphone in front of someone for a path that
 * 503s. And the device's ability to record, because with no microphone there is nothing to
 * send — the *rest* of what §5.5 asks of a device is about hosting weights, and none of it
 * applies here, which is exactly why this option reaches the text-only floor.
 */
export const cloudIsOn = ({ native = isNative(), view = globalThis } = {}) => (
    readCloudProposals(cloudStatus?.available === true) && canCapture(view, { native })
);

/** Several clips are one take and one card (§4.2), so they are one file. */
export const concatClips = (clips) => {
    if (clips.length === 1) return clips[0].audio;

    const total = clips.reduce((sum, clip) => sum + clip.audio.length, 0);
    const joined = new Float32Array(total);
    let at = 0;
    clips.forEach(clip => { joined.set(clip.audio, at); at += clip.audio.length; });
    return joined;
};

/**
 * An HTTP failure, said in the vocabulary §5's callers already handle.
 *
 * The distinction that matters on the card is between *this will not work until something
 * changes* and *try again*: a server with no key, a spent quota and a blocked note are all
 * `unavailable` or `empty`, and the card's own copy covers each. Everything else is `failed`.
 */
const asInferenceError = (error) => {
    const status = error?.response?.status ?? null;
    const said = error?.response?.data?.error;
    const message = typeof said === 'string' && said ? said : (error?.message || 'the relay failed');

    if (status === 503 || status === 429) {
        return new InferenceError(message, FAILURE_KINDS.unavailable, error);
    }
    if (status === 422) {
        return new InferenceError(message, FAILURE_KINDS.empty, error);
    }
    if (status === 400 || status === 413) {
        return new InferenceError(message, FAILURE_KINDS.input, error);
    }
    return new InferenceError(message, FAILURE_KINDS.failed, error);
};

/**
 * @param {object} options
 * @param {string} [options.language] the pinned language, or nothing for "work it out"
 * @param {object} [options.client] an axios-shaped client, injected by the tests
 * @param {string} [options.model] what the server said it would call, for provenance
 */
export const createCloudRuntime = (options = {}) => {
    const {
        language = null,
        client = axios,
        sampleRate = TARGET_SAMPLE_RATE
    } = options;

    // What goes in the provenance block. The server is the authority on which model actually
    // answered, so a status probe's answer overrides the default the moment one arrives.
    let model = options.model || GEMINI_MODEL.id;

    const ask = async ({ system, text, audio }) => {
        let data;
        try {
            ({ data } = await client.post(PROPOSE_PATH, {
                system,
                text,
                ...(audio ? { audio: { mime_type: WAV_MIME_TYPE, data: audio } } : {})
            }));
        } catch (error) {
            throw asInferenceError(error);
        }

        if (typeof data?.model === 'string' && data.model) model = data.model;
        return typeof data?.text === 'string' ? data.text : '';
    };

    return {
        id: RUNTIME_IDS.cloud,
        // Deliberately not one of §5.5's three: those describe what a device can host, and
        // this runtime hosts nothing. A screen that wants the device's tier asks `detectTier`.
        tier: null,
        // Both, and audio on every device: the encoder is a RIFF header, not a gigabyte of
        // weights, so the text-only floor is a floor for local models only.
        accepts: [INPUT_MODES.audio, INPUT_MODES.text],
        promptVersion: PROMPT_VERSION,
        /** No weights, so nothing to warm and nothing to let go of. */
        weights: null,
        load: async () => null,
        unload: async () => { },

        get model() { return model; },

        propose: async (request) => {
            const ritual = request.task === TASKS.ritual;
            const system = ritual
                ? buildRitualPrompt(request.questions || [], request.context || {})
                : buildPrompt(request.context || {});

            const pinned = request.context?.language || language;
            const spoken = pinned ? `The note is in ${pinned}.` : 'Answer for the note below.';

            const audio = request.kind === INPUT_MODES.audio
                ? wavBase64(concatClips(request.clips), sampleRate)
                : null;

            const answer = await ask({
                system,
                audio,
                text: audio
                    ? `${spoken} Listen to the note and answer with the JSON object.`
                    : `${spoken} The note is:\n\n${request.text}`
            });

            const { value, repairs, error } = parseModelJson(answer);
            if (value === null) {
                throw new InferenceError(error || 'the model did not answer with JSON', FAILURE_KINDS.empty);
            }
            return repairs.length ? { ...value, __repairs: repairs } : value;
        }
    };
};

/**
 * A downloader for a runtime with nothing to download.
 *
 * `VoiceCapture` asks its downloader whether the model is on the device before it offers the
 * microphone, and shows the download block when it is not. With the model on a server the
 * honest answer is *yes, there is nothing to fetch* — so this is a downloader-shaped object
 * that says `ready` and refuses to do anything, rather than a second branch through the
 * component for the case where a download is not a concept.
 */
export const createCloudDownloader = () => {
    const snapshot = {
        state: 'ready',
        file: null,
        filesDone: 0,
        filesTotal: 0,
        loaded: 0,
        total: 0,
        error: null
    };

    return {
        model: null,
        models: [],
        getSnapshot: () => snapshot,
        subscribe: () => () => { },
        start: async () => true,
        cancel: () => { },
        isDownloaded: async () => true,
        remove: async () => true,
        storedBytes: async () => 0
    };
};
