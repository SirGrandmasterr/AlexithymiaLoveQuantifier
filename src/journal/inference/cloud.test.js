import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    PROPOSE_PATH, PROPOSE_STATUS_PATH, cloudIsOn, cloudModelName, cloudProposalStatus,
    cloudReport, createCloudDownloader, createCloudRuntime, primeCloudStatus, setCloudReport
} from './cloud';
import { audioInput, buildContext, propose, textInput } from './index';
import { FAILURE_KINDS, INPUT_MODES, RUNTIME_IDS } from './contract';
import { GEMINI_MODEL } from './models';
import { PROMPT_VERSION } from './prompt';
import { TARGET_SAMPLE_RATE } from '../recorder';
import { JOURNAL_STORAGE_KEYS } from '../../constants/journal';
import { writeCloudProposals } from '../../constants/journalSettings';

const clip = (id, samples = [0.1, -0.2]) => ({
    id, takeId: 'take-1', audio: Float32Array.from(samples), sampleRate: TARGET_SAMPLE_RATE, durationMs: 900
});

const context = () => buildContext({
    relationships: [{ ID: 1, name: 'Lucie' }],
    triggers: [{ label: 'work', role: 'entity' }]
});

/** A proposal the validator will accept, so a test about the transport is about the transport. */
const goodAnswer = JSON.stringify({
    transcript: 'I had a nice day with Lucie',
    language: 'en',
    feelings: [{ id: 'pleasure', intensity: 2, quote: 'a nice day with Lucie', about: [{ kind: 'person', name: 'Lucie' }] }],
    people: [{ name: 'Lucie' }],
    facts: [],
    ambiguity: 'none'
});

const okClient = (text = goodAnswer, model = 'gemini-2.5-flash') => ({
    post: vi.fn().mockResolvedValue({ data: { text, model } }),
    get: vi.fn().mockResolvedValue({ data: { available: true, model } })
});

const refusing = (status, message = 'no') => ({
    post: vi.fn().mockRejectedValue({ response: { status, data: { error: message } } }),
    get: vi.fn()
});

beforeEach(() => {
    setCloudReport(null);
    window.localStorage.clear();
});

/* 1. The recording goes up as a recording */

describe('createCloudRuntime, in audio mode', () => {
    it('sends the take as one WAV file and never a transcript', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client });

        const result = await propose(audioInput([clip('a')]), context(), runtime);

        expect(result.ok).toBe(true);
        expect(client.post).toHaveBeenCalledTimes(1);

        const [path, body] = client.post.mock.calls[0];
        expect(path).toBe(PROPOSE_PATH);
        expect(body.audio.mime_type).toBe('audio/wav');
        expect(body.audio.data.length).toBeGreaterThan(0);
        // The header, base64-decoded. Nothing wrote the words down first: this is the file.
        expect(atob(body.audio.data).slice(0, 4)).toBe('RIFF');
    });

    it('joins several clips into one file, because they are one take and one card', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client });

        await propose(audioInput([clip('a', [0.1, 0.2]), clip('b', [0.3])]), context(), runtime);

        const { audio } = client.post.mock.calls[0][1];
        // 44 header bytes plus three samples at two bytes each.
        expect(atob(audio.data).length).toBe(44 + 6);
    });

    it('carries the same prompt the on-device runtimes are given', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client });

        await propose(audioInput([clip('a')]), context(), runtime);

        const { system } = client.post.mock.calls[0][1];
        // The closed vocabularies (§5.3) and this user's own names, which is the whole
        // reason the prompt is built on the client and forwarded rather than built upstream.
        expect(system).toContain('pleasure');
        expect(system).toContain('Lucie');
        expect(system).toContain('work');
    });

    it('names the language when one is pinned', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client, language: 'de' });

        await propose(audioInput([clip('a')]), buildContext({}), runtime);

        expect(client.post.mock.calls[0][1].text).toContain('The note is in de.');
    });

    it('takes the model name from the server rather than guessing it', async () => {
        const client = okClient(goodAnswer, 'gemini-2.5-pro');
        const runtime = createCloudRuntime({ client });

        expect(runtime.model).toBe(GEMINI_MODEL.id);
        await propose(audioInput([clip('a')]), context(), runtime);
        // What lands in the provenance block on the entry (§6.3): the model that answered.
        expect(runtime.model).toBe('gemini-2.5-pro');
    });
});

/* 2. Text mode, which is the edited transcript and the typed note */

describe('createCloudRuntime, in text mode', () => {
    it('sends the words with no audio part', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client });

        const result = await propose(textInput('Work was stressful today'), context(), runtime);

        expect(result.ok).toBe(true);
        const body = client.post.mock.calls[0][1];
        expect(body.audio).toBeUndefined();
        expect(body.text).toContain('Work was stressful today');
    });

    it('keeps the user\'s own words as the transcript, not the model\'s echo', async () => {
        const client = okClient();
        const runtime = createCloudRuntime({ client });

        const result = await propose(textInput('Work was stressful today'), context(), runtime);
        expect(result.proposal.transcript).toBe('Work was stressful today');
    });
});

/* 3. The contract, and what the validator still gets to say */

describe('the runtime contract', () => {
    it('identifies itself as the one runtime that is not a tier', () => {
        const runtime = createCloudRuntime({ client: okClient() });

        expect(runtime.id).toBe(RUNTIME_IDS.cloud);
        expect(runtime.tier).toBeNull();
        expect(runtime.weights).toBeNull();
        expect(runtime.promptVersion).toBe(PROMPT_VERSION);
    });

    it('takes both audio and text on any device, because it hosts nothing', () => {
        const runtime = createCloudRuntime({ client: okClient() });
        expect(runtime.accepts).toEqual([INPUT_MODES.audio, INPUT_MODES.text]);
    });

    it('records the runtime and the mode on a successful pass', async () => {
        const runtime = createCloudRuntime({ client: okClient() });
        const result = await propose(audioInput([clip('a')]), context(), runtime);

        expect(result.runtime).toBe(RUNTIME_IDS.cloud);
        expect(result.mode).toBe(INPUT_MODES.audio);
    });

    it('drops a feeling the vocabulary does not contain, exactly as it would on device', async () => {
        const client = okClient(JSON.stringify({
            transcript: 'a day',
            language: 'en',
            feelings: [{ id: 'not-a-feeling', intensity: 2, about: [] }],
            people: [], facts: [], ambiguity: 'none'
        }));

        const result = await propose(audioInput([clip('a')]), context(), createCloudRuntime({ client }));

        // A model that ran on someone else's machine gets no more credit than one that ran
        // here: the validator is the same validator.
        expect(result.ok).toBe(true);
        expect(result.proposal.feelings).toEqual([]);
    });

    it('unwraps a fenced answer and counts the repair', async () => {
        const client = okClient('```json\n' + goodAnswer + '\n```');
        const result = await propose(audioInput([clip('a')]), context(), createCloudRuntime({ client }));

        expect(result.ok).toBe(true);
        expect(result.proposal.feelings).toHaveLength(1);
    });

    it('is empty rather than wrong when the answer is not JSON', async () => {
        const client = okClient('I cannot help with that.');
        const result = await propose(audioInput([clip('a')]), context(), createCloudRuntime({ client }));

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
    });
});

/* 4. Refusals, said in the vocabulary the card already handles */

describe('when the relay refuses', () => {
    it('reads a server with no key as unavailable', async () => {
        const result = await propose(
            audioInput([clip('a')]), context(), createCloudRuntime({ client: refusing(503) })
        );
        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
        expect(result.failure.cause?.kind).toBe(FAILURE_KINDS.unavailable);
    });

    it('carries the server\'s own sentence rather than inventing one', async () => {
        const result = await propose(
            audioInput([clip('a')]), context(),
            createCloudRuntime({ client: refusing(429, 'Quota exceeded.') })
        );
        expect(result.failure.message).toBe('Quota exceeded.');
    });

    it('never leaves the audio in flight as an exception', async () => {
        const client = { post: vi.fn().mockRejectedValue(new Error('network down')), get: vi.fn() };
        const result = await propose(audioInput([clip('a')]), context(), createCloudRuntime({ client }));

        expect(result.ok).toBe(false);
        expect(result.failure.message).toBe('network down');
    });
});

/* 5. The status probe, and the switch it gates */

describe('cloudProposalStatus', () => {
    it('reports what the server said', async () => {
        const client = { get: vi.fn().mockResolvedValue({ data: { available: true, model: 'gemini-2.5-pro' } }) };
        await expect(cloudProposalStatus(client)).resolves.toEqual({ available: true, model: 'gemini-2.5-pro' });
        expect(client.get).toHaveBeenCalledWith(PROPOSE_STATUS_PATH);
    });

    it('answers "not on offer" for a server that is down or too old to know the route', async () => {
        const client = { get: vi.fn().mockRejectedValue(new Error('404')) };
        await expect(cloudProposalStatus(client)).resolves.toEqual({
            available: false, model: GEMINI_MODEL.id
        });
    });
});

describe('primeCloudStatus', () => {
    it('asks once and shares the answer', async () => {
        const client = { get: vi.fn().mockResolvedValue({ data: { available: true, model: 'gemini-2.5-flash' } }) };

        const [first, second] = await Promise.all([primeCloudStatus(client), primeCloudStatus(client)]);

        expect(client.get).toHaveBeenCalledTimes(1);
        expect(first).toBe(second);
        expect(cloudReport()?.available).toBe(true);
        expect(cloudModelName()).toBe('gemini-2.5-flash');
    });
});

describe('cloudIsOn', () => {
    const recording = {
        isSecureContext: true,
        navigator: { mediaDevices: { getUserMedia: () => { } } },
        MediaRecorder: function MediaRecorder() { },
        OfflineAudioContext: function OfflineAudioContext() { }
    };

    it('is off until the user turns it on, even where the server offers it', () => {
        setCloudReport({ available: true, model: 'gemini-2.5-flash' });
        expect(cloudIsOn({ native: false, view: recording })).toBe(false);
    });

    it('is on when the user asked and the server offers it', () => {
        setCloudReport({ available: true, model: 'gemini-2.5-flash' });
        writeCloudProposals(true, true);
        expect(cloudIsOn({ native: false, view: recording })).toBe(true);
    });

    it('is off when the server has no key, whatever this device last stored', () => {
        // The switch survives; the claim does not. A device whose server lost its key must
        // not go on saying the recording is being sent.
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.cloud, 'true');
        setCloudReport({ available: false, model: 'gemini-2.5-flash' });
        expect(cloudIsOn({ native: false, view: recording })).toBe(false);
    });

    it('is off before the server has been asked', () => {
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.cloud, 'true');
        expect(cloudIsOn({ native: false, view: recording })).toBe(false);
    });

    it('is off on a device that cannot hold a microphone open', () => {
        setCloudReport({ available: true, model: 'gemini-2.5-flash' });
        writeCloudProposals(true, true);
        expect(cloudIsOn({ native: false, view: { isSecureContext: false, navigator: {} } })).toBe(false);
    });
});

/* 6. The downloader that downloads nothing */

describe('createCloudDownloader', () => {
    it('says the model is here, because there is nothing to fetch', async () => {
        const downloader = createCloudDownloader();

        await expect(downloader.isDownloaded()).resolves.toBe(true);
        expect(downloader.getSnapshot().state).toBe('ready');
        expect(downloader.getSnapshot().total).toBe(0);
        expect(downloader.models).toEqual([]);
    });

    it('unsubscribes cleanly, so a card that mounts it can unmount it', () => {
        const downloader = createCloudDownloader();
        expect(() => downloader.subscribe(() => { })()).not.toThrow();
    });
});
