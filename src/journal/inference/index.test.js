import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import {
    propose,
    buildContext,
    normalizeInput,
    isUsableContext,
    textInput,
    audioInput,
    createNativeRuntime,
    createWebRuntime,
    proposeRitual,
    InferenceError,
    FAILURE_KINDS,
    INPUT_MODES,
    RUNTIME_IDS
} from './index';
import { createNativeProposer } from './native';
import { createFakeRuntime, proposalFixture, normalizeFixtures } from './fake';
import { activeFeelings } from '../../constants/journal';
import { CONTEXT_TAGS } from '../../constants/contextTags';

vi.mock('axios');

const context = () => buildContext({
    relationships: [{ ID: 41, name: 'Lucie' }, { ID: 42, name: 'Alex' }],
    triggers: [{ id: 'trg-1', label: 'work' }]
});

const clip = (id = 'clip-1') => ({
    id,
    takeId: 'take-1',
    audio: Float32Array.from([0.1, -0.1, 0.2]),
    sampleRate: 16_000,
    durationMs: 1_200
});

/* ------------------------------------------------------------------------------------ */
/* 1. The fake runtime answers, and the answer is the fixture                             */
/* ------------------------------------------------------------------------------------ */

describe('propose, with the fake runtime', () => {
    it('returns the fixture for a typed note', async () => {
        const fixture = proposalFixture({ transcript: 'Lucie called.', ambiguity: 'none' });
        const runtime = createFakeRuntime(fixture);

        const result = await propose(textInput('Lucie called.'), context(), runtime);

        expect(result.ok).toBe(true);
        expect(result.proposal).toEqual(fixture);
        expect(result.runtime).toBe(RUNTIME_IDS.fake);
        expect(result.mode).toBe(INPUT_MODES.text);
    });

    it('returns the fixture for a spoken take, and hands the runtime the clips', async () => {
        const runtime = createFakeRuntime(proposalFixture());
        const clips = [clip('clip-1'), clip('clip-2')];

        const result = await propose(audioInput(clips), context(), runtime);

        expect(result.ok).toBe(true);
        expect(result.mode).toBe(INPUT_MODES.audio);
        expect(runtime.calls).toHaveLength(1);
        expect(runtime.calls[0].clips).toHaveLength(2);
        expect(runtime.calls[0].context.feelings.length).toBeGreaterThan(0);
    });

    it('selects the fixture that matches the words', async () => {
        const runtime = createFakeRuntime({
            'not angry': proposalFixture({ transcript: 'not angry, just tired', feelings: [{ id: 'tiredness', intensity: 2, about: [] }] }),
            'Lucie': proposalFixture({ transcript: 'Lucie called' })
        });

        const tired = await propose('I am not angry, just tired', context(), runtime);
        const lucie = await propose('Lucie called this evening', context(), runtime);

        expect(tired.proposal.feelings[0].id).toBe('tiredness');
        // The fixture's transcript is not what comes back: in text mode the transcript is
        // the input, echoed (§5.2). The fixture is told apart by its feeling instead.
        expect(lucie.proposal.feelings[0].id).toBe('rapport');
        expect(lucie.proposal.transcript).toBe('Lucie called this evening');
    });

    it('echoes the typed words as the transcript, whatever the runtime said they were', async () => {
        const runtime = createFakeRuntime(proposalFixture({ transcript: 'Lucy called.' }));

        const result = await propose('Lucie called.', context(), runtime);

        expect(result.proposal.transcript).toBe('Lucie called.');
    });

    it('keeps the runtime transcript for a spoken take — there is nothing else to echo', async () => {
        const runtime = createFakeRuntime(proposalFixture({ transcript: 'Lucie called.' }));

        const result = await propose(audioInput([clip()]), context(), runtime);

        expect(result.proposal.transcript).toBe('Lucie called.');
    });

    it('validates what the runtime returns: an unusable proposal reaches the caller as the feeling ambiguity, never as an error', async () => {
        const runtime = createFakeRuntime({
            transcript: 'Lucie called.',
            language: 'en',
            feelings: [{ id: 'not-a-feeling', intensity: 2, about: [] }],
            people: [],
            facts: [],
            ambiguity: 'none'
        });

        const result = await propose('Lucie called.', context(), runtime);

        expect(result.ok).toBe(true);
        expect(result.proposal.ambiguity).toBe('feeling');
        expect(result.proposal.feelings).toEqual([]);
        expect(result.provenance.dropped_by_filter).toBe(1);
        expect(result.provenance.schema_valid).toBe(false);
    });

    it('carries the filter\'s provenance beside a clean proposal too', async () => {
        const runtime = createFakeRuntime(proposalFixture());

        const result = await propose('Lucie called.', context(), runtime);

        expect(result.provenance).toEqual({ schema_valid: true, dropped_by_filter: 0, drops: [] });
    });

    it('hands out a copy, so a caller editing a proposal cannot rewrite the fixture', async () => {
        const runtime = createFakeRuntime(proposalFixture());

        const first = await propose('anything', context(), runtime);
        first.proposal.feelings.push({ id: 'anger', intensity: 3, about: [] });
        const second = await propose('anything', context(), runtime);

        expect(second.proposal.feelings).toHaveLength(1);
    });

    it('records every request it was given', async () => {
        const runtime = createFakeRuntime(proposalFixture());
        await propose('one', context(), runtime);
        await propose('two', context(), runtime);
        expect(runtime.calls.map(call => call.text)).toEqual(['one', 'two']);
        runtime.reset();
        expect(runtime.calls).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. Failure is a value, never an escaping exception                                     */
/* ------------------------------------------------------------------------------------ */

describe('when the runtime fails', () => {
    it('surfaces a typed failure instead of letting the exception escape', async () => {
        const boom = new Error('the model died');
        const runtime = {
            id: 'exploding',
            propose: () => { throw boom; }
        };

        const result = await propose(textInput('anything'), context(), runtime);

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
        expect(result.failure.message).toBe('the model died');
        expect(result.failure.cause).toBe(boom);
        expect(result.failure.runtime).toBe('exploding');
    });

    it('does the same for a rejected promise', async () => {
        const runtime = { id: 'async-boom', propose: async () => { throw new Error('out of memory'); } };
        const result = await propose(textInput('anything'), context(), runtime);
        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
    });

    it('surfaces a scripted failure from the fake, so the card can be tested against one', async () => {
        const runtime = createFakeRuntime([{ match: /noisy/, error: new Error('decode failed') }]);
        const result = await propose('a noisy take', context(), runtime);
        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
    });

    it('reports a runtime that returned nothing separately from one that failed', async () => {
        const runtime = { id: 'silent', propose: async () => null };
        const result = await propose(textInput('anything'), context(), runtime);
        expect(result.failure.kind).toBe(FAILURE_KINDS.empty);
    });

    it('reports the absence of a runtime as unavailable — the text-only tier', async () => {
        expect((await propose(textInput('hi'), context(), null)).failure.kind).toBe(FAILURE_KINDS.unavailable);
        expect((await propose(textInput('hi'), context(), {})).failure.kind).toBe(FAILURE_KINDS.unavailable);
    });

    it('reports a runtime that does not take this kind of input', async () => {
        const lightTier = createFakeRuntime(proposalFixture(), { accepts: [INPUT_MODES.text] });
        const spoken = await propose(audioInput([clip()]), context(), lightTier);
        const typed = await propose(textInput('typed instead'), context(), lightTier);

        expect(spoken.ok).toBe(false);
        expect(spoken.failure.kind).toBe(FAILURE_KINDS.unavailable);
        expect(spoken.failure.mode).toBe(INPUT_MODES.audio);
        expect(typed.ok).toBe(true);
    });

    it('refuses input that is neither audio nor text, by name', async () => {
        const runtime = createFakeRuntime(proposalFixture());
        for (const bad of [null, undefined, '', '   ', {}, [], { kind: 'audio', clips: [] }, 42]) {
            const result = await propose(bad, context(), runtime);
            expect(result.ok).toBe(false);
            expect(result.failure.kind).toBe(FAILURE_KINDS.input);
        }
        expect(runtime.calls).toHaveLength(0);
    });

    it('refuses a context with no feeling vocabulary', async () => {
        const runtime = createFakeRuntime(proposalFixture());
        const result = await propose(textInput('hi'), { feelings: [] }, runtime);
        expect(result.failure.kind).toBe(FAILURE_KINDS.context);
        expect(runtime.calls).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. The runtimes                                                                        */
/* ------------------------------------------------------------------------------------ */

describe('the runtimes', () => {
    it('builds the native one without touching the plugin', () => {
        // Building calls nothing: the plugin is first spoken to on `propose` or `load`,
        // and until then a Full-tier phone has opened no file and allocated no model.
        const calls = [];
        const plugin = new Proxy({}, { get: (_target, name) => (...args) => { calls.push(String(name)); return Promise.resolve(args); } });
        const runtime = createNativeRuntime({ plugin });

        expect(runtime.id).toBe(RUNTIME_IDS.native);
        expect(calls).toEqual([]);
    });

    it('builds the web one without loading anything', () => {
        // The 3.4 GB arrives on the first `propose`, and only out of the cache the download
        // manager verified.
        const runtime = createWebRuntime({ loadModel: async () => ({ processor: null, instance: null }) });
        expect(runtime.id).toBe(RUNTIME_IDS.web);
    });

    it('takes audio and text on the Full tier, which is what the card needs after an edit', () => {
        // D2 left this as the requirement: a transcript edit re-runs the proposal in text
        // mode through the same runtime. A Full-tier runtime that took audio only would send
        // the card back to keeping the chips, which is what both Whisper runtimes did.
        const web = createWebRuntime({ loadModel: async () => ({}) });
        const native = createNativeRuntime({ plugin: {} });

        expect(web.accepts).toEqual([INPUT_MODES.audio, INPUT_MODES.text]);
        expect(native.accepts).toEqual([INPUT_MODES.audio, INPUT_MODES.text]);
    });

    it('takes audio and text on the Light tier too, by composing two models', () => {
        // The transcriber takes the audio and the proposer takes the words. Everything above
        // this line sees one runtime that takes both (§5.1).
        const light = createNativeRuntime({
            tier: 'light',
            transcriber: { propose: async () => ({ transcript: 'Lucie called.', language: 'en' }) },
            proposer: { propose: async () => ({}) }
        });

        expect(light.id).toBe(RUNTIME_IDS.nativeLight);
        expect(light.accepts).toEqual([INPUT_MODES.audio, INPUT_MODES.text]);
    });

    it('gives the two tiers different runtime ids, because the record has to tell them apart', () => {
        // §5.5's Light row: "The card and the record are identical; only `proposal.runtime`
        // differs." This is that sentence as an assertion.
        const full = createWebRuntime({ loadModel: async () => ({}) });
        const light = createWebRuntime({
            tier: 'light',
            transcriber: { propose: async () => ({ transcript: 'x' }) },
            proposer: { propose: async () => ({}) }
        });

        expect(full.id).not.toBe(light.id);
        expect([full.id, light.id]).toEqual([RUNTIME_IDS.web, RUNTIME_IDS.webLight]);
    });

    it('refuses audio on a text-mode proposer with a kind, so a caller can tell it apart', async () => {
        // The Light tier's proposer never downloaded an audio encoder. Asked for audio
        // directly — around the composition rather than through it — it says so by name
        // rather than failing somewhere inside transformers.js.
        const proposer = createNativeProposer({ plugin: {}, tier: 'light' });
        try {
            await proposer.propose({ kind: INPUT_MODES.audio, clips: [] });
            throw new Error('should not reach here');
        } catch (error) {
            expect(error).toBeInstanceOf(InferenceError);
            expect(error.kind).toBe(FAILURE_KINDS.unavailable);
        }
    });
});

/* ------------------------------------------------------------------------------------ */
/* 4. The context: closed vocabularies in, ids out                                        */
/* ------------------------------------------------------------------------------------ */

describe('buildContext', () => {
    it('carries both closed vocabularies', () => {
        const built = context();
        expect(built.feelings.map(feeling => feeling.id)).toEqual(activeFeelings().map(feeling => feeling.id));
        expect(built.tags).toEqual(CONTEXT_TAGS);
        expect(isUsableContext(built)).toBe(true);
    });

    it('carries the user relationship names and trigger labels', () => {
        const built = context();
        expect(built.people).toEqual(['Lucie', 'Alex']);
        expect(built.triggers).toEqual(['work']);
    });

    it('carries no relationship id and no trigger id — the model may not name one', () => {
        const serialized = JSON.stringify(context());
        expect(serialized).not.toContain('"ID"');
        expect(serialized).not.toContain('41');
        expect(serialized).not.toContain('42');
        expect(serialized).not.toContain('trg-1');
    });

    it('drops blanks and duplicates, and takes bare strings too', () => {
        const built = buildContext({
            relationships: ['Lucie', { name: 'Lucie' }, { name: '  ' }, { name: 'Alex' }, null],
            triggers: ['work', { label: 'work' }, { label: 'the commute' }]
        });
        expect(built.people).toEqual(['Lucie', 'Alex']);
        expect(built.triggers).toEqual(['work', 'the commute']);
    });

    it('is usable with nothing but the vocabularies — a first run has no people yet', () => {
        const built = buildContext();
        expect(built.people).toEqual([]);
        expect(isUsableContext(built)).toBe(true);
    });

    it('refuses a context that is not one', () => {
        [null, undefined, {}, { feelings: 'joy' }, { feelings: [] }].forEach((bad) => {
            expect(isUsableContext(bad)).toBe(false);
        });
    });
});

describe('normalizeInput', () => {
    it('takes a bare string, a text input, a clip, and an array of clips', () => {
        expect(normalizeInput('spoken words').kind).toBe(INPUT_MODES.text);
        expect(normalizeInput(textInput('typed')).text).toBe('typed');
        expect(normalizeInput(clip()).clips).toHaveLength(1);
        expect(normalizeInput([clip('a'), clip('b')]).clips).toHaveLength(2);
        expect(normalizeInput(audioInput(clip())).kind).toBe(INPUT_MODES.audio);
    });

    it('drops clips with no samples in them', () => {
        const empty = { id: 'x', audio: new Float32Array(0), sampleRate: 16_000 };
        expect(normalizeInput([empty])).toBeNull();
        expect(normalizeInput([empty, clip()]).clips).toHaveLength(1);
    });
});

describe('normalizeFixtures', () => {
    it('reads a lone proposal, a map, and the full array form', () => {
        expect(normalizeFixtures(proposalFixture())).toHaveLength(1);
        expect(normalizeFixtures({ one: proposalFixture(), two: proposalFixture() })).toHaveLength(2);
        expect(normalizeFixtures([{ match: /x/, proposal: proposalFixture() }])).toHaveLength(1);
        expect(normalizeFixtures(null)).toEqual([]);
    });

    it('matches on the request itself when given a function', async () => {
        const runtime = createFakeRuntime([
            { match: (request) => request.clips?.length === 2, proposal: proposalFixture({ transcript: 'two clips' }) },
            { match: () => true, proposal: proposalFixture({ transcript: 'anything else' }) }
        ]);

        const two = await propose(audioInput([clip('a'), clip('b')]), context(), runtime);
        const one = await propose(audioInput([clip('a')]), context(), runtime);

        expect(two.proposal.transcript).toBe('two clips');
        expect(one.proposal.transcript).toBe('anything else');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 5. The claim the Vault page rests on: nothing here reaches the network                 */
/* ------------------------------------------------------------------------------------ */

describe('propose never touches the network', () => {
    let fetchSpy;
    let xhrSpy;

    beforeEach(() => {
        vi.clearAllMocks();
        fetchSpy = vi.fn(() => Promise.reject(new Error('the network is not available here')));
        globalThis.fetch = fetchSpy;
        xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open');
    });

    afterEach(() => {
        xhrSpy.mockRestore();
        delete globalThis.fetch;
    });

    it('makes no request on the success path', async () => {
        const runtime = createFakeRuntime(proposalFixture());

        const spoken = await propose(audioInput([clip()]), context(), runtime);
        const typed = await propose(textInput('a typed note'), context(), runtime);

        expect(spoken.ok).toBe(true);
        expect(typed.ok).toBe(true);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(xhrSpy).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.request).not.toHaveBeenCalled();
    });

    it('makes no request on any failure path either', async () => {
        await propose(textInput('hi'), context(), null);
        await propose(null, context(), createFakeRuntime(proposalFixture()));
        await propose(textInput('hi'), context(), { id: 'boom', propose: async () => { throw new Error('no'); } });
        // Building either real runtime touches nothing either — no probe, no warm-up fetch.
        createNativeRuntime({ plugin: {} });
        createWebRuntime({ loadPipeline: async () => () => { } });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(xhrSpy).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });
});
