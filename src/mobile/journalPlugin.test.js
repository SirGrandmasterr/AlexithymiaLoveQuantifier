import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecorder, watchLifecycle, MAX_CLIP_MS, METER_INTERVAL_MS, ERROR_KINDS } from '../journal/recorder';
import { createNativeDownloader, nativeCaptureDeps, nativeAudio, isNativeAudio, primeNativeTier } from './journalPlugin';
import { createFakeJournalPlugin, createFakeAppPlugin } from './journalPlugin.fake';
import { WHISPER_TINY, totalBytes } from '../journal/inference/models';
import { nativeTierReport, setNativeTierReport, detectTier, TIERS } from '../journal/inference/tier';

/** Let the promises inside `begin` and `settle` land without moving the clock. */
const flush = async () => {
    for (let i = 0; i < 8; i += 1) await vi.advanceTimersByTimeAsync(0);
};

const recorderOver = (plugin) => createRecorder(nativeCaptureDeps(plugin));

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); setNativeTierReport(null); });

/* 1. The permission, and when it is asked */

describe('the microphone permission', () => {
    it('is asked for nothing at construction, at mount, or while the app is idle', async () => {
        const plugin = createFakeJournalPlugin();
        const recorder = recorderOver(plugin);
        const app = createFakeAppPlugin();
        const stop = watchLifecycle(recorder, { doc: null, appPlugin: app, native: () => true });
        await flush();

        expect(plugin.names()).toEqual([]);
        expect(recorder.state()).toBe('idle');
        stop();
    });

    it('is checked, then requested, then the device opened — in that order, on the first tap', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'prompt' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();

        expect(plugin.names()).toEqual(['checkPermissions', 'requestPermissions', 'startCapture']);
        expect(plugin.calls[1].args).toEqual({ permissions: ['microphone'] });
        expect(plugin.calls[2].args).toEqual({ maxMs: MAX_CLIP_MS });
        expect(recorder.state()).toBe('recording');
    });

    it('does not ask again once granted', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        expect(plugin.names()).toEqual(['checkPermissions', 'startCapture']);

        recorder.tap();       // stop
        await flush();
        recorder.tap();       // add more, on the same take
        await flush();

        expect(plugin.names().filter(name => name === 'requestPermissions')).toEqual([]);
        expect(plugin.names().filter(name => name === 'startCapture')).toHaveLength(2);
    });

    it('turns a refusal into the recorder\'s permission error, and never opens the device', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'prompt', grant: false });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();

        expect(plugin.names()).toEqual(['checkPermissions', 'requestPermissions']);
        expect(recorder.state()).toBe('error');
        expect(recorder.getSnapshot().error.kind).toBe(ERROR_KINDS.permission);
        expect(recorder.getSnapshot().error.name).toBe('NotAllowedError');
        // No throw reached anyone: the state is the whole of the outcome.
        expect(recorder.clips()).toEqual([]);
    });
});

/* 2. The audio stays on the native side */

describe('a clip recorded through the plugin', () => {
    it('is a handle the recorder holds, not samples that crossed the bridge', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        recorder.tap();
        await flush();

        expect(recorder.state()).toBe('ready');
        const [clip] = recorder.clips();
        expect(isNativeAudio(clip.audio)).toBe(true);
        expect(clip.audio.handle).toBe('clip-1');
        expect(clip.audio.length).toBe(16_000);
        expect(clip.audio).not.toBeInstanceOf(Float32Array);
        expect(plugin.clips.has('clip-1')).toBe(true);
    });

    it('is released on the native side when the recorder discards', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        recorder.tap();
        await flush();
        recorder.discard();
        await flush();

        expect(plugin.names()).toContain('releaseClip');
        expect(plugin.clips.size).toBe(0);
        expect(recorder.state()).toBe('idle');
    });

    it('reads the level the plugin reports', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        plugin.setLevel(0.5);
        await vi.advanceTimersByTimeAsync(METER_INTERVAL_MS * 2);

        expect(recorder.getSnapshot().level).toBe(0.5);
    });

    it('takes the clip the native limit produced without asking for a second one', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        plugin.endCaptureAtLimit();
        await flush();

        expect(recorder.state()).toBe('ready');
        expect(recorder.clips()).toHaveLength(1);
        expect(recorder.clips()[0].audio.handle).toBe('clip-1');
        expect(plugin.names().filter(name => name === 'stopCapture')).toEqual([]);
    });

    it('hands the device back if the take was abandoned while the prompt was up', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'prompt', deferGrant: true });
        const recorder = recorderOver(plugin);

        recorder.tap();
        await flush();
        expect(recorder.state()).toBe('requesting');
        // A tap is deliberately ignored while the prompt is up (the recorder's contract);
        // `stop()` is what the discard button and the lock call, and it cancels the request.
        recorder.stop();
        plugin.grantNow();
        await flush();

        expect(recorder.state()).toBe('idle');
        expect(plugin.names()).toContain('abortCapture');
        expect(plugin.isCapturing()).toBe(false);
    });
});

/* 3. The permission prompt is not the background */

describe('the app leaving the foreground', () => {
    it('during the permission prompt does not cancel the request the user is granting', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'prompt', deferGrant: true });
        const recorder = recorderOver(plugin);
        const app = createFakeAppPlugin();
        const stop = watchLifecycle(recorder, { doc: null, appPlugin: app, native: () => true });
        await flush();

        recorder.tap();
        await flush();
        expect(recorder.state()).toBe('requesting');

        // The prompt is an activity of its own: Android pauses the app to show it.
        app.background();
        app.foreground();
        plugin.grantNow();
        await flush();

        expect(recorder.state()).toBe('recording');
        stop();
    });

    it('while recording still throws the audio away', async () => {
        const plugin = createFakeJournalPlugin({ permission: 'granted' });
        const recorder = recorderOver(plugin);
        const app = createFakeAppPlugin();
        const stop = watchLifecycle(recorder, { doc: null, appPlugin: app, native: () => true });
        await flush();

        recorder.tap();
        await flush();
        expect(recorder.state()).toBe('recording');

        app.background();
        await flush();

        expect(recorder.state()).toBe('idle');
        expect(recorder.getSnapshot().discardReason).toBe('background');
        expect(plugin.names()).toContain('abortCapture');
        stop();
    });
});

/* 4. The weight store */

describe('the native downloader', () => {
    const server = () => 'http://192.168.1.10:8082';

    it('has the download manager\'s surface and starts idle with the size known', () => {
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin: createFakeJournalPlugin(), baseUrl: server });
        expect(downloader.getSnapshot()).toMatchObject({ state: 'idle', loaded: 0, total: totalBytes(WHISPER_TINY), filesTotal: 13 });
        ['start', 'cancel', 'isDownloaded', 'remove', 'subscribe'].forEach(name => expect(typeof downloader[name]).toBe('function'));
    });

    it('hands the plugin the server and the pins, and reports progress on the way', async () => {
        const plugin = createFakeJournalPlugin({
            fetchProgress: [{ path: 'a', filesDone: 1, filesTotal: 13, loaded: 1000, total: 45 }]
        });
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin, baseUrl: server });
        const seen = [];
        downloader.subscribe(snapshot => seen.push(snapshot.state + ':' + snapshot.loaded));

        expect(await downloader.start()).toBe(true);

        const call = plugin.calls.find(entry => entry.name === 'fetchModel');
        expect(call.args.baseUrl).toBe(server());
        expect(call.args.id).toBe(WHISPER_TINY.id);
        expect(call.args.files).toHaveLength(13);
        expect(call.args.files[0]).toEqual({ path: WHISPER_TINY.files[0].path, bytes: WHISPER_TINY.files[0].bytes, sha256: WHISPER_TINY.files[0].sha256 });
        expect(seen).toContain('downloading:1000');
        expect(downloader.getSnapshot()).toMatchObject({ state: 'ready', loaded: totalBytes(WHISPER_TINY), filesDone: 13 });
    });

    it('reports a wrong sum as checksum and keeps nothing on screen but the error', async () => {
        const plugin = createFakeJournalPlugin({ fetchOutcome: 'checksum' });
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin, baseUrl: server });

        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot().state).toBe('error');
        expect(downloader.getSnapshot().error.kind).toBe('checksum');
        expect(downloader.getSnapshot().file).toBe(WHISPER_TINY.files[0].path);
    });

    it('cancels through the plugin and ends cancelled', async () => {
        const plugin = createFakeJournalPlugin({ fetchOutcome: 'cancelled' });
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin, baseUrl: server });

        const started = downloader.start();
        downloader.cancel();
        expect(await started).toBe(false);

        expect(plugin.names()).toContain('cancelFetch');
        expect(downloader.getSnapshot().state).toBe('cancelled');
    });

    it('asks the plugin whether the files are on the device, and removes them through it', async () => {
        const plugin = createFakeJournalPlugin({ downloaded: true });
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin, baseUrl: server });

        expect(await downloader.isDownloaded()).toBe(true);
        expect(await downloader.remove()).toBe(true);
        expect(await downloader.isDownloaded()).toBe(false);
        expect(plugin.names()).toEqual(['modelStatus', 'removeModel', 'modelStatus']);
    });

    it('refuses to start with no server configured', async () => {
        const plugin = createFakeJournalPlugin();
        const downloader = createNativeDownloader(WHISPER_TINY, { plugin, baseUrl: () => '' });
        expect(await downloader.start()).toBe(false);
        expect(downloader.getSnapshot().state).toBe('error');
        expect(plugin.names()).toEqual([]);
    });
});

/* 5. The tier report */

describe('primeNativeTier', () => {
    it('does nothing in a browser', async () => {
        const plugin = createFakeJournalPlugin();
        expect(await primeNativeTier(plugin, { native: () => false })).toBeNull();
        expect(plugin.names()).toEqual([]);
        expect(nativeTierReport()).toBeNull();
    });

    it('reads the memory report once and hands it to the tier module', async () => {
        // A "4 GB" phone, as the kernel reports it.
        const plugin = createFakeJournalPlugin({ tier: { totalMemoryBytes: 3.6 * 1024 ** 3, lowRamDevice: false } });
        const report = await primeNativeTier(plugin, { native: () => true });

        expect(report.totalMemoryBytes).toBeCloseTo(3.6 * 1024 ** 3, -3);
        expect(plugin.names()).toEqual(['tier']);
        expect(detectTier()).toBe(TIERS.light);
        // Reads a number; asks for nothing.
        expect(plugin.names()).not.toContain('requestPermissions');
    });

    it('keeps an earlier report when the read fails rather than downgrading the device', async () => {
        setNativeTierReport({ totalMemoryBytes: 8 * 1024 ** 3 });
        const plugin = createFakeJournalPlugin();
        plugin.tier = async () => { throw new Error('no plugin'); };

        expect(await primeNativeTier(plugin, { native: () => true })).toBeNull();
        expect(detectTier()).toBe(TIERS.full);
    });
});

describe('nativeAudio', () => {
    it('quacks like a buffer for the two things the recorder does with one', () => {
        const plugin = createFakeJournalPlugin();
        const audio = nativeAudio({ handle: 'clip-9', samples: 480_000, sampleRate: 16_000, durationMs: 30_000 }, plugin);
        expect(audio.length).toBe(480_000);
        expect(audio.fill(0)).toBe(audio);
        expect(plugin.calls[0]).toEqual({ name: 'releaseClip', args: { handle: 'clip-9' } });
    });
});
