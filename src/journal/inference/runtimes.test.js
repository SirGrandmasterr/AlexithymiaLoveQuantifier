import { describe, it, expect, vi } from 'vitest';
import { createWebRuntime, createWebProposer, createWebTranscriber } from './web';
import { createNativeRuntime, createNativeProposer, createNativeTranscriber } from './native';
import { createLightRuntime } from './light';
import { createModelSetDownloader, emptyProgress } from './download';
import { parseModelJson, firstObject, REPAIRS } from './parse';
import { PROPOSAL_SCHEMA, PROPOSAL_GRAMMAR_SCHEMA, checkSchema, schemaFeelingIds, schemaTags } from './schema';
import { TIERS, effectiveTier, tierFromMemory, FULL_TIER_NEEDS_64_BIT } from './tier';
import { RUNTIME_IDS, INPUT_MODES } from './contract';
import { GEMMA_E4B_ONNX, GEMMA_E4B_ONNX_TEXT, WHISPER_TINY, tierModels } from './models';
import { CONTEXT_TAGS } from '../../constants/contextTags';

/* 1. Which runtime a tier gets */

describe('the tier picks the runtime', () => {
    const web = (tier) => createWebRuntime({
        tier,
        loadModel: async () => ({}),
        transcriber: { propose: async () => ({ transcript: 'x' }) },
        proposer: { propose: async () => ({}), model: 'google/gemma-4-E4B-it' }
    });
    const native = (tier) => createNativeRuntime({
        tier,
        plugin: {},
        transcriber: { propose: async () => ({ transcript: 'x' }) },
        proposer: { propose: async () => ({}), model: 'google/gemma-4-E4B-it' }
    });

    it('gives the Full tier one model over the audio, on both platforms', () => {
        expect(web(TIERS.full).id).toBe(RUNTIME_IDS.web);
        expect(native(TIERS.full).id).toBe(RUNTIME_IDS.native);
        expect(web(TIERS.full).accepts).toContain(INPUT_MODES.audio);
        expect(native(TIERS.full).accepts).toContain(INPUT_MODES.audio);
    });

    it('gives the Light tier the composition, and a different id on the record', () => {
        expect(web(TIERS.light).id).toBe(RUNTIME_IDS.webLight);
        expect(native(TIERS.light).id).toBe(RUNTIME_IDS.nativeLight);
        expect(web(TIERS.light).tier).toBe(TIERS.light);
    });

    it('downloads what the tier runs, and no more', () => {
        expect(tierModels(TIERS.full)).toEqual([GEMMA_E4B_ONNX]);
        expect(tierModels(TIERS.light)).toEqual([WHISPER_TINY, GEMMA_E4B_ONNX_TEXT]);
        expect(tierModels(TIERS.textOnly)).toEqual([]);

        const lightFiles = GEMMA_E4B_ONNX_TEXT.files.map(file => file.path);
        expect(lightFiles.some(path => path.includes('audio_encoder'))).toBe(false);
        expect(lightFiles.some(path => path.includes('vision_encoder'))).toBe(false);
        // And it is a strict subset, so a device promoted to Full re-uses every verified byte.
        expect(GEMMA_E4B_ONNX.files.map(file => file.path)).toEqual(expect.arrayContaining(lightFiles));
    });
});

describe('the override', () => {
    it('wins when it asks for less', () => {
        expect(effectiveTier(TIERS.full, TIERS.light)).toEqual({ tier: TIERS.light, override: TIERS.light, refused: null });
        expect(effectiveTier(TIERS.full, TIERS.textOnly).tier).toBe(TIERS.textOnly);
        expect(effectiveTier(TIERS.light, TIERS.textOnly).tier).toBe(TIERS.textOnly);
    });

    it('is refused when it asks for more, and the refusal is reported rather than swallowed', () => {
        // §9.7's "overridable" exists so somebody on a hot laptop can choose to do less. A
        // pin upwards would make the settings screen promise a model that cannot load.
        expect(effectiveTier(TIERS.light, TIERS.full)).toEqual({ tier: TIERS.light, override: null, refused: TIERS.full });
        expect(effectiveTier(TIERS.textOnly, TIERS.full).refused).toBe(TIERS.full);
    });

    it('changes which runtime is built, which is the whole point of it', () => {
        const detected = TIERS.full;
        const pinned = effectiveTier(detected, TIERS.light).tier;
        const runtime = createWebRuntime({
            tier: pinned,
            transcriber: { propose: async () => ({ transcript: 'x' }) },
            proposer: { propose: async () => ({}) }
        });
        expect(runtime.id).toBe(RUNTIME_IDS.webLight);
        expect(tierModels(pinned)).toEqual([WHISPER_TINY, GEMMA_E4B_ONNX_TEXT]);
    });

    it('keeps a 32-bit phone off the Full tier whatever its memory says', () => {
        // LiteRT-LM ships arm64-v8a and x86_64 only. This is a fact about the runtime, and a
        // user with an override cannot pin their way past it — the pin only goes down.
        expect(FULL_TIER_NEEDS_64_BIT).toBe(true);
        const eightGb = 8 * 1024 ** 3;
        expect(tierFromMemory({ totalMemoryBytes: eightGb, abi64: true })).toBe(TIERS.full);
        expect(tierFromMemory({ totalMemoryBytes: eightGb, abi64: false })).toBe(TIERS.light);
        // A report written before D3 has no `abi64`, and an absent field is not a "no".
        expect(tierFromMemory({ totalMemoryBytes: eightGb })).toBe(TIERS.full);
    });
});

/* 2. The Light tier's composition */

describe('the Light tier composition', () => {
    const parts = ({ heard = 'Lucie called.', proposal = { feelings: [], ambiguity: 'none' }, fail = null } = {}) => {
        const transcriber = { propose: vi.fn(async () => ({ transcript: heard, language: 'en', feelings: [], people: [], facts: [], ambiguity: 'feeling' })) };
        const proposer = {
            model: 'google/gemma-4-E4B-it',
            promptVersion: 1,
            propose: vi.fn(async () => { if (fail) throw new Error(fail); return proposal; })
        };
        return { transcriber, proposer, runtime: createLightRuntime({ id: RUNTIME_IDS.webLight, transcriber, proposer }) };
    };

    it('transcribes, then proposes over the words', async () => {
        const { transcriber, proposer, runtime } = parts();
        await runtime.propose({ kind: INPUT_MODES.audio, clips: [{ audio: new Float32Array(8) }], context: {} });

        expect(transcriber.propose).toHaveBeenCalledOnce();
        expect(proposer.propose.mock.calls[0][0].kind).toBe(INPUT_MODES.text);
        expect(proposer.propose.mock.calls[0][0].text).toBe('Lucie called.');
    });

    it('keeps the words of the model that listened, not the one that read them', async () => {
        // Whisper heard the audio and Gemma only ever saw a string, so a name Gemma tidied is
        // a name the card must not offer to `personCandidates`.
        const { runtime } = parts({ proposal: { transcript: 'Lucy called.', feelings: [], ambiguity: 'none' } });
        const out = await runtime.propose({ kind: INPUT_MODES.audio, clips: [{ audio: new Float32Array(8) }], context: {} });
        expect(out.transcript).toBe('Lucie called.');
    });

    it('goes straight to the proposer in text mode, with no transcriber in the path', async () => {
        const { transcriber, proposer, runtime } = parts();
        await runtime.propose({ kind: INPUT_MODES.text, text: 'a typed note', context: {} });

        expect(transcriber.propose).not.toHaveBeenCalled();
        expect(proposer.propose).toHaveBeenCalledOnce();
    });

    it('keeps the words when the proposer will not answer', async () => {
        const { runtime } = parts({ fail: 'the engine died' });
        const out = await runtime.propose({ kind: INPUT_MODES.audio, clips: [{ audio: new Float32Array(8) }], context: {} });

        expect(out.transcript).toBe('Lucie called.');
        expect(out.ambiguity).toBe('feeling');
        expect(out.feelings).toEqual([]);
    });

    it('refuses to ask the proposer to label silence', async () => {
        const { proposer, runtime } = parts({ heard: '   ' });
        await expect(runtime.propose({ kind: INPUT_MODES.audio, clips: [{ audio: new Float32Array(8) }], context: {} }))
            .rejects.toThrow();
        expect(proposer.propose).not.toHaveBeenCalled();
    });

    it('reports the proposer as the model and carries its prompt version', async () => {
        const { runtime } = parts();
        expect(runtime.model).toBe('google/gemma-4-E4B-it');
        expect(runtime.promptVersion).toBe(1);
    });

    it('unloads both halves, because both hold memory', async () => {
        const transcriber = { propose: async () => ({}), unload: vi.fn() };
        const proposer = { propose: async () => ({}), unload: vi.fn() };
        await createLightRuntime({ id: 'x', transcriber, proposer }).unload();
        expect(transcriber.unload).toHaveBeenCalled();
        expect(proposer.unload).toHaveBeenCalled();
    });
});

/* 3. Parsing what a model without a grammar emits */

describe('parsing the answer', () => {
    it('takes a plain object as it comes, with no repairs', () => {
        expect(parseModelJson('{"a":1}')).toEqual({ value: { a: 1 }, repairs: [] });
    });

    it('unwraps a code fence, and counts it', () => {
        const out = parseModelJson('```json\n{"a":1}\n```');
        expect(out.value).toEqual({ a: 1 });
        expect(out.repairs).toEqual([REPAIRS.fence]);
    });

    it('drops prose either side of the object, and counts that too', () => {
        const out = parseModelJson('Here is the JSON:\n{"a":1}\nHope that helps.');
        expect(out.value).toEqual({ a: 1 });
        expect(out.repairs).toEqual([REPAIRS.prose]);
    });

    it('does not read a brace inside a transcript as the end of the object', () => {
        // Not hypothetical: the transcript carries whatever was said, and it is the one field
        // where a user's own words could break the parse.
        const raw = '{"transcript":"she said } and left","ambiguity":"none"}';
        expect(parseModelJson(raw).value.transcript).toBe('she said } and left');
        expect(firstObject('{"a":"}"}')).toBe('{"a":"}"}');
    });

    it('refuses a truncated object rather than closing it', () => {
        // A cut-off generation is a proposal nobody made. `validateProposal` turning the
        // refusal into `ambiguity: "feeling"` is the honest outcome (§4.6).
        const out = parseModelJson('{"transcript":"Lucie called","feelings":[');
        expect(out.value).toBeNull();
        expect(out.error).toBeTruthy();
    });

    it('refuses prose with no object in it at all', () => {
        expect(parseModelJson('I am sorry, I cannot help with that.').value).toBeNull();
        expect(parseModelJson('').value).toBeNull();
        expect(parseModelJson('[1,2,3]').value).toBeNull();
    });
});

/* 4. The grammar schema — one relaxation, and it is measured */

describe('the grammar schema', () => {
    it('keeps every closed vocabulary the model could otherwise invent', () => {
        expect(schemaFeelingIds(PROPOSAL_GRAMMAR_SCHEMA)).toEqual(schemaFeelingIds(PROPOSAL_SCHEMA));
        expect(PROPOSAL_GRAMMAR_SCHEMA.properties.feelings.items.properties.intensity)
            .toEqual(PROPOSAL_SCHEMA.properties.feelings.items.properties.intensity);
        expect(PROPOSAL_GRAMMAR_SCHEMA.properties.ambiguity).toEqual(PROPOSAL_SCHEMA.properties.ambiguity);
    });

    it('relaxes the context tag to a string, and nothing else', () => {
        // Measured on 2026-09-02: LLGuidance cannot bind an enum member containing a space
        // against Gemma's tokeniser, and three of the seven context tags contain one.
        const grammarTag = PROPOSAL_GRAMMAR_SCHEMA.properties.feelings.items.properties.about.items.oneOf[1];
        const strictTag = PROPOSAL_SCHEMA.properties.feelings.items.properties.about.items.oneOf[1];

        expect(strictTag.properties.tag.enum).toEqual([...CONTEXT_TAGS]);
        expect(grammarTag.properties.tag.enum).toBeUndefined();
        expect(grammarTag.properties.tag.type).toBe('string');

        // Everything else about the three `about` shapes is byte-for-byte the strict one.
        const grammarAbout = PROPOSAL_GRAMMAR_SCHEMA.properties.feelings.items.properties.about.items.oneOf;
        const strictAbout = PROPOSAL_SCHEMA.properties.feelings.items.properties.about.items.oneOf;
        expect(grammarAbout[0]).toEqual(strictAbout[0]);
        expect(grammarAbout[2]).toEqual(strictAbout[2]);
    });

    it('has at least one tag with a space in it, which is why the relaxation exists', () => {
        // If this ever stops being true the relaxation can be reverted, and this assertion is
        // where a later session finds out.
        expect(CONTEXT_TAGS.some(tag => tag.includes(' '))).toBe(true);
    });

    it('admits everything the strict schema admits', () => {
        const valid = {
            transcript: 'Lucie called.',
            language: 'en',
            feelings: [{ id: schemaFeelingIds()[0], intensity: 2, about: [{ kind: 'tag', tag: schemaTags()[0] }] }],
            people: [{ name: 'Lucie' }],
            facts: [],
            ambiguity: 'none'
        };
        expect(checkSchema(valid, PROPOSAL_SCHEMA)).toEqual([]);
        expect(checkSchema(valid, PROPOSAL_GRAMMAR_SCHEMA)).toEqual([]);
    });

    it('lets a tag through that the strict schema refuses — which the validator then drops', () => {
        const answer = {
            transcript: 'x',
            language: 'en',
            feelings: [{ id: schemaFeelingIds()[0], intensity: 2, about: [{ kind: 'tag', tag: 'work' }] }],
            people: [],
            facts: [],
            ambiguity: 'none'
        };
        expect(checkSchema(answer, PROPOSAL_GRAMMAR_SCHEMA)).toEqual([]);
        expect(checkSchema(answer, PROPOSAL_SCHEMA).length).toBeGreaterThan(0);
    });
});

/* 5. Two models, one download line */

describe('the model set downloader', () => {
    const fakePart = (model, { ready = false } = {}) => {
        let snapshot = { ...emptyProgress(model), state: ready ? 'ready' : 'idle', loaded: ready ? 10 : 0 };
        const listeners = new Set();
        return {
            model,
            getSnapshot: () => snapshot,
            subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
            start: vi.fn(async () => {
                snapshot = { ...snapshot, state: model.__fails ? 'error' : 'ready', error: model.__fails ? { kind: 'checksum' } : null };
                listeners.forEach(listener => listener(snapshot));
                return !model.__fails;
            }),
            cancel: vi.fn(),
            isDownloaded: vi.fn(async () => ready),
            remove: vi.fn(async () => true)
        };
    };

    const setOf = (models, options = {}) => {
        const made = [];
        const downloader = createModelSetDownloader(models, {
            createDownloader: (model) => { const part = fakePart(model, options); made.push(part); return part; }
        });
        return { downloader, made };
    };

    it('promises the whole set size, and counts every file in it', () => {
        const models = tierModels(TIERS.light);
        const { downloader } = setOf(models);
        const snapshot = downloader.getSnapshot();

        expect(snapshot.total).toBe(models.reduce((sum, model) => sum + model.files.reduce((n, f) => n + f.bytes, 0), 0));
        expect(snapshot.filesTotal).toBe(models.reduce((sum, model) => sum + model.files.length, 0));
    });

    it('downloads one model at a time, so the progress line means something', async () => {
        const { downloader, made } = setOf(tierModels(TIERS.light));
        await downloader.start();
        made.forEach(part => expect(part.start).toHaveBeenCalledOnce());
        expect(downloader.getSnapshot().state).toBe('ready');
    });

    it('stops the whole set at the first refusal, and says so', async () => {
        const [first, second] = tierModels(TIERS.light);
        const { downloader, made } = setOf([{ ...first, __fails: true }, second]);

        expect(await downloader.start()).toBe(false);
        expect(made[0].start).toHaveBeenCalledOnce();
        expect(made[1].start).not.toHaveBeenCalled();
        expect(downloader.getSnapshot().state).toBe('error');
        expect(downloader.getSnapshot().error.kind).toBe('checksum');
    });

    it('is downloaded only when every part is', async () => {
        const { downloader } = setOf(tierModels(TIERS.light), { ready: true });
        expect(await downloader.isDownloaded()).toBe(true);

        const mixed = createModelSetDownloader(tierModels(TIERS.light), {
            createDownloader: (model, _deps) => fakePart(model, { ready: model === WHISPER_TINY })
        });
        expect(await mixed.isDownloaded()).toBe(false);
    });

    it('removes every part, which is what *remove downloaded files* has to mean', async () => {
        const { downloader, made } = setOf(tierModels(TIERS.light), { ready: true });
        expect(await downloader.remove()).toBe(true);
        made.forEach(part => expect(part.remove).toHaveBeenCalledOnce());
    });

    it('cancels every part in flight', () => {
        const { downloader, made } = setOf(tierModels(TIERS.light));
        downloader.cancel();
        made.forEach(part => expect(part.cancel).toHaveBeenCalledOnce());
    });
});

/* 6. The transcribers are still what C3 and C4 shipped */

describe('the transcribers, unchanged by D3', () => {
    it('still take audio only and still carry Whisper', () => {
        const web = createWebTranscriber({ loadPipeline: async () => () => { } });
        const native = createNativeTranscriber({ plugin: {} });

        expect(web.accepts).toEqual([INPUT_MODES.audio]);
        expect(native.accepts).toEqual([INPUT_MODES.audio]);
        expect(web.model).toBe(WHISPER_TINY);
        expect(native.model).toBe(WHISPER_TINY);
    });

    it('are not what a Full-tier device builds', () => {
        // The Full tier has no transcriber at all: one model does both jobs in one pass, and
        // an extra 45 MB on that device would be 45 MB nothing runs.
        expect(tierModels(TIERS.full).some(model => model === WHISPER_TINY)).toBe(false);
    });
});

describe('the proposers hold and let go', () => {
    it('unloads the web one after idle, so a phone is not holding gigabytes overnight', async () => {
        vi.useFakeTimers();
        try {
            const dispose = vi.fn(async () => { });
            const runtime = createWebProposer({
                idleUnloadMs: 1000,
                loadModel: async () => ({
                    processor: {
                        apply_chat_template: () => 'prompt',
                        batch_decode: () => ['{"transcript":"x","language":"en","feelings":[],"people":[],"facts":[],"ambiguity":"none"}']
                    },
                    instance: { generate: async () => ({ slice: () => ({}) }), dispose }
                })
            });
            // The processor is called as a function by the runtime; a plain object is not,
            // so the pass is driven only far enough to start the clock.
            await runtime.propose({ kind: INPUT_MODES.text, text: 'a note', context: {} }).catch(() => { });
            expect(dispose).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1100);
            expect(dispose).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it('asks the plugin to let the native one go, and the plugin runs its own timer too', async () => {
        const calls = [];
        const plugin = {
            releaseProposer: async () => { calls.push('releaseProposer'); },
            loadProposer: async (args) => { calls.push(`loadProposer:${args.idleUnloadMs}`); return { loaded: true }; }
        };
        const runtime = createNativeProposer({ plugin, idleUnloadMs: 4321 });

        await runtime.load();
        await runtime.unload();
        // The timer travels with the request: JavaScript states the policy, Java enforces it,
        // and a WebView torn down mid-check-in cannot leave the model resident.
        expect(calls).toEqual(['loadProposer:4321', 'releaseProposer']);
    });
});
