import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { createNativeTranscriber } from './native';
import { audioInput, textInput, propose, buildContext, RUNTIME_IDS, FAILURE_KINDS } from './index';
import { WHISPER_TINY } from './models';
import { createFakeJournalPlugin } from '../../mobile/journalPlugin.fake';
import { nativeAudio } from '../../mobile/journalPlugin';

vi.mock('axios');

const context = () => buildContext({ relationships: [{ ID: 1, name: 'Lucie' }], triggers: [] });

const nativeClip = (plugin, handle = 'clip-1') => ({
    id: handle,
    takeId: 'take-1',
    audio: nativeAudio({ handle, samples: 16_000, sampleRate: 16_000, durationMs: 1000 }, plugin),
    sampleRate: 16_000,
    durationMs: 1000
});

describe('the native runtime', () => {
    it('declares itself as the native runtime, taking audio', () => {
        const runtime = createNativeTranscriber({ plugin: createFakeJournalPlugin() });
        expect(runtime.id).toBe(RUNTIME_IDS.native);
        expect(runtime.accepts).toEqual(['audio']);
        expect(runtime.model).toBe(WHISPER_TINY);
    });

    it('sends the clip handles to the plugin and comes back with the words, through the seam', async () => {
        const plugin = createFakeJournalPlugin({ transcript: '  Lucie called.  ', language: 'en' });
        const runtime = createNativeTranscriber({ plugin });

        const result = await propose(audioInput([nativeClip(plugin, 'clip-1'), nativeClip(plugin, 'clip-2')]), context(), runtime);

        expect(result.ok).toBe(true);
        expect(result.runtime).toBe(RUNTIME_IDS.native);
        expect(result.proposal).toEqual({
            transcript: 'Lucie called.', language: 'en', feelings: [], people: [], facts: [], ambiguity: 'feeling'
        });

        const call = plugin.calls.find(entry => entry.name === 'transcribe');
        expect(call.args.handles).toEqual(['clip-1', 'clip-2']);
        expect(call.args.language).toBeNull();
        expect(call.args.model.id).toBe(WHISPER_TINY.id);
        expect(call.args.model.files.map(file => file.path)).toEqual(WHISPER_TINY.files.map(file => file.path));
        // Only paths go over: the plugin loads files, it does not verify them here.
        expect(call.args.model.files[0]).not.toHaveProperty('sha256');
    });

    it('pins the language the context carries, and reports it back as the language', async () => {
        const plugin = createFakeJournalPlugin({ language: 'en' });
        const runtime = createNativeTranscriber({ plugin });

        const result = await propose(audioInput([nativeClip(plugin)]), buildContext({ language: 'de' }), runtime);

        expect(plugin.calls.find(entry => entry.name === 'transcribe').args.language).toBe('de');
        expect(result.proposal.language).toBe('de');
    });

    it('refuses text in this build, as a value rather than a throw', async () => {
        const plugin = createFakeJournalPlugin();
        const result = await propose(textInput('Lucie called'), context(), createNativeTranscriber({ plugin }));

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.unavailable);
        expect(plugin.names()).toEqual([]);
    });

    it('refuses a browser buffer: samples have no business crossing the bridge', async () => {
        const plugin = createFakeJournalPlugin();
        const browserClip = { id: 'clip-x', audio: Float32Array.from([0.1, 0.2]), sampleRate: 16_000, durationMs: 100 };

        const result = await propose(audioInput([browserClip]), context(), createNativeTranscriber({ plugin }));

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
        expect(result.failure.cause.kind).toBe(FAILURE_KINDS.input);
        expect(plugin.names()).toEqual([]);
    });

    it('turns a plugin failure into the seam\'s failure envelope', async () => {
        const plugin = createFakeJournalPlugin();
        plugin.transcribe = async () => { throw Object.assign(new Error('the model files are not on this device'), { code: 'model_missing' }); };

        const result = await propose(audioInput([nativeClip(plugin)]), context(), createNativeTranscriber({ plugin }));

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(FAILURE_KINDS.failed);
        expect(result.failure.cause.code).toBe('model_missing');
    });
});

describe('no network', () => {
    let fetchSpy;
    let xhrSpy;

    beforeEach(() => {
        fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);
        xhrSpy = vi.spyOn(globalThis, 'XMLHttpRequest').mockImplementation(function XMLHttpRequest() { });
        axios.get.mockReset();
        axios.post.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        xhrSpy.mockRestore();
    });

    it('makes no request on the way to a transcript', async () => {
        const plugin = createFakeJournalPlugin();
        await propose(audioInput([nativeClip(plugin)]), context(), createNativeTranscriber({ plugin }));

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(xhrSpy).not.toHaveBeenCalled();
        expect(axios.get).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });
});
