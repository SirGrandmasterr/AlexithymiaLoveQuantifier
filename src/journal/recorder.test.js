import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    createRecorder,
    watchLifecycle,
    decodeToMono16k,
    noiseFloor,
    isNoisyTake,
    pickMimeType,
    MAX_CLIP_MS,
    SILENCE_HOLD_MS,
    METER_INTERVAL_MS,
    SPEECH_LEVEL,
    SILENCE_LEVEL,
    NOISY_FLOOR_LEVEL,
    TARGET_SAMPLE_RATE,
    DISCARD_REASONS,
    ERROR_KINDS
} from './recorder';

/* ------------------------------------------------------------------------------------ */
/* The fakes. No device, no Web Audio, no timers of their own.                             */
/* ------------------------------------------------------------------------------------ */

/** A `MediaRecorder` that records nothing and reports everything. */
const makeFakeMediaRecorder = () => {
    const made = [];

    class FakeMediaRecorder {
        static supported = ['audio/webm;codecs=opus'];

        static isTypeSupported(type) { return FakeMediaRecorder.supported.includes(type); }

        constructor(stream, options) {
            this.stream = stream;
            this.mimeType = options?.mimeType || '';
            this.state = 'inactive';
            this.startCalls = 0;
            this.stopCalls = 0;
            made.push(this);
        }

        start() { this.state = 'recording'; this.startCalls += 1; }

        stop() {
            this.stopCalls += 1;
            this.state = 'inactive';
            this.ondataavailable?.({ data: { size: 128, chunk: `chunk-${this.stopCalls}` } });
            this.onstop?.();
        }
    }

    return { FakeMediaRecorder, made };
};

/** A microphone stream whose tracks remember being stopped. */
const makeFakeStream = () => {
    const track = { kind: 'audio', stopped: 0, stop() { this.stopped += 1; } };
    return { track, getTracks: () => [track] };
};

/** A level meter the test drives by hand: set `.level`, advance the clock. */
const makeFakeMeter = () => {
    const meter = {
        level: 0,
        reads: 0,
        closed: 0,
        read() { meter.reads += 1; return meter.level; },
        close() { meter.closed += 1; }
    };
    return meter;
};

/** One decoded second of 16 kHz mono, distinguishable from silence. */
const decodedAudio = () => Float32Array.from([0.5, -0.5, 0.25, -0.25]);

const setup = (overrides = {}) => {
    const { FakeMediaRecorder, made } = makeFakeMediaRecorder();
    const stream = makeFakeStream();
    const meter = makeFakeMeter();
    const decode = vi.fn(async () => decodedAudio());
    const requestStream = vi.fn(async () => stream);

    const recorder = createRecorder({
        requestStream,
        MediaRecorder: FakeMediaRecorder,
        createMeter: () => meter,
        decode,
        makeBlob: (parts, options) => ({ parts, options }),
        ...overrides
    });

    return { recorder, stream, meter, decode, requestStream, made };
};

/** Let the promises inside `begin` and `settle` land, without moving the clock forward. */
const flush = async () => {
    for (let i = 0; i < 6; i += 1) await vi.advanceTimersByTimeAsync(0);
};

/** Speak for `ms`, at a level the recorder counts as speech. */
const speak = async (meter, ms, level = SPEECH_LEVEL + 0.1) => {
    meter.level = level;
    await vi.advanceTimersByTimeAsync(ms);
};

/** Say nothing for `ms`, at the given room level. */
const quiet = async (meter, ms, level = 0.01) => {
    meter.level = level;
    await vi.advanceTimersByTimeAsync(ms);
};

/** Tap, speak briefly, tap again, and come back with one clip in hand. */
const recordOnce = async (harness) => {
    await harness.recorder.tap();
    await speak(harness.meter, 300);
    await harness.recorder.tap();
    await flush();
};

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/* ------------------------------------------------------------------------------------ */
/* 1. Tap to start, tap to stop                                                           */
/* ------------------------------------------------------------------------------------ */

describe('the tap contract', () => {
    it('starts on a tap and stops on the next one', async () => {
        const harness = setup();
        const { recorder, meter, made } = harness;

        expect(recorder.state()).toBe('idle');

        await recorder.tap();
        expect(recorder.state()).toBe('recording');
        expect(made).toHaveLength(1);
        expect(made[0].startCalls).toBe(1);

        await speak(meter, 500);
        await recorder.tap();
        await flush();

        expect(recorder.state()).toBe('ready');
        expect(made[0].stopCalls).toBe(1);
        expect(recorder.clips()).toHaveLength(1);
        expect(recorder.clips()[0].stopReason).toBe('tap');
        expect(recorder.clips()[0].sampleRate).toBe(TARGET_SAMPLE_RATE);
    });

    it('never opens the microphone before the first tap', async () => {
        const { recorder, requestStream } = setup();
        expect(requestStream).not.toHaveBeenCalled();
        await recorder.tap();
        expect(requestStream).toHaveBeenCalledTimes(1);
    });

    it('hands the device back at every stop, so the recording indicator goes out', async () => {
        const harness = setup();
        await recordOnce(harness);
        expect(harness.stream.track.stopped).toBe(1);
        expect(harness.meter.closed).toBe(1);
    });

    it('reports a refused permission as an error rather than a stuck button', async () => {
        const denied = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
        const { recorder } = setup({ requestStream: vi.fn(async () => { throw denied; }) });

        await recorder.tap();
        await flush();

        expect(recorder.state()).toBe('error');
        expect(recorder.getSnapshot().error.kind).toBe(ERROR_KINDS.permission);
        expect(recorder.clips()).toHaveLength(0);
    });

    it('notifies subscribers on every change and stops when they unsubscribe', async () => {
        const { recorder, meter } = setup();
        const seen = [];
        const off = recorder.subscribe(snapshot => seen.push(snapshot.state));

        await recorder.tap();
        expect(seen).toContain('requesting');
        expect(seen).toContain('recording');

        off();
        const before = seen.length;
        await speak(meter, 200);
        expect(seen).toHaveLength(before);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. The two automatic stops                                                             */
/* ------------------------------------------------------------------------------------ */

describe('stopping without a second tap', () => {
    it('stops after two seconds of silence once something has been said', async () => {
        const { recorder, meter } = setup();

        await recorder.tap();
        await speak(meter, 1_000);
        expect(recorder.state()).toBe('recording');

        await quiet(meter, SILENCE_HOLD_MS - METER_INTERVAL_MS * 2);
        expect(recorder.state()).toBe('recording');

        await quiet(meter, METER_INTERVAL_MS * 3);
        await flush();

        expect(recorder.state()).toBe('ready');
        expect(recorder.clips()[0].stopReason).toBe('silence');
    });

    it('does not stop on silence before anything has been said', async () => {
        const { recorder, meter } = setup();

        await recorder.tap();
        await quiet(meter, SILENCE_HOLD_MS * 3);

        expect(recorder.state()).toBe('recording');
        expect(recorder.clips()).toHaveLength(0);

        // And it still ends normally once there are words and then a pause.
        await speak(meter, 400);
        await quiet(meter, SILENCE_HOLD_MS + METER_INTERVAL_MS * 2);
        await flush();
        expect(recorder.clips()[0].stopReason).toBe('silence');
    });

    it('stops at thirty seconds, the model per-clip limit', async () => {
        const { recorder, meter } = setup();

        await recorder.tap();
        // Loud throughout, so nothing but the limit can end it.
        await speak(meter, MAX_CLIP_MS - METER_INTERVAL_MS * 2);
        expect(recorder.state()).toBe('recording');
        expect(recorder.getSnapshot().remainingMs).toBeLessThanOrEqual(METER_INTERVAL_MS * 2);

        await speak(meter, METER_INTERVAL_MS * 3);
        await flush();

        expect(recorder.state()).toBe('ready');
        expect(recorder.clips()[0].stopReason).toBe('limit');
        expect(recorder.clips()[0].durationMs).toBeLessThanOrEqual(MAX_CLIP_MS);
    });

    it('counts down while it records', async () => {
        const { recorder, meter } = setup();
        await recorder.tap();
        await speak(meter, 5_000);
        expect(recorder.getSnapshot().remainingMs).toBe(MAX_CLIP_MS - 5_000);
        expect(recorder.getSnapshot().elapsedMs).toBe(5_000);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. add more                                                                            */
/* ------------------------------------------------------------------------------------ */

describe('add more', () => {
    it('records a second clip that lands on the same card', async () => {
        const harness = setup();
        const { recorder, meter } = harness;

        await recordOnce(harness);
        const takeId = recorder.getSnapshot().takeId;
        expect(takeId).toBeTruthy();

        await recorder.addMore();
        expect(recorder.state()).toBe('recording');
        await speak(meter, 400);
        await recorder.tap();
        await flush();

        const clips = recorder.clips();
        expect(clips).toHaveLength(2);
        expect(clips.map(clip => clip.index)).toEqual([0, 1]);
        expect(clips.map(clip => clip.takeId)).toEqual([takeId, takeId]);
        expect(clips[0].id).not.toBe(clips[1].id);
    });

    it('is what a tap does once a take is in hand', async () => {
        const harness = setup();
        await recordOnce(harness);

        await harness.recorder.tap();
        expect(harness.recorder.state()).toBe('recording');
        expect(harness.recorder.getSnapshot().takeId).toBe(harness.recorder.clips()[0].takeId);
    });

    it('starts a new take, and drops the old one, when start is called again', async () => {
        const harness = setup();
        await recordOnce(harness);
        const firstTake = harness.recorder.getSnapshot().takeId;

        await harness.recorder.start();
        await speak(harness.meter, 300);
        await harness.recorder.tap();
        await flush();

        expect(harness.recorder.clips()).toHaveLength(1);
        expect(harness.recorder.getSnapshot().takeId).not.toBe(firstTake);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 4. Discarding — the promise that audio is never kept                                   */
/* ------------------------------------------------------------------------------------ */

describe('discarding', () => {
    it.each([
        ['the app going to the background', DISCARD_REASONS.background],
        ['the app lock engaging', DISCARD_REASONS.lock],
        ['the discard button', DISCARD_REASONS.discard]
    ])('drops the take on %s, and the buffer is unreachable afterwards', async (_name, reason) => {
        const harness = setup();
        await recordOnce(harness);

        const held = harness.recorder.clips()[0].audio;
        expect(Array.from(held).some(sample => sample !== 0)).toBe(true);

        harness.recorder.discard(reason);

        expect(harness.recorder.clips()).toHaveLength(0);
        expect(harness.recorder.state()).toBe('idle');
        expect(harness.recorder.getSnapshot().discardReason).toBe(reason);
        // Not merely dropped: overwritten, so a component that kept the reference holds
        // silence rather than a voice.
        expect(Array.from(held)).toEqual([0, 0, 0, 0]);
    });

    it('stops a recording in flight and keeps nothing from it', async () => {
        const harness = setup();
        const { recorder, meter, made, stream } = harness;

        await recorder.tap();
        await speak(meter, 800);

        recorder.discard(DISCARD_REASONS.background);
        await flush();

        expect(made[0].stopCalls).toBe(1);
        expect(recorder.state()).toBe('idle');
        expect(recorder.clips()).toHaveLength(0);
        expect(stream.track.stopped).toBe(1);
    });

    it('keeps nothing when the app leaves while the audio is still decoding', async () => {
        let release;
        const decode = vi.fn(() => new Promise(resolve => { release = resolve; }));
        const harness = setup({ decode });

        await harness.recorder.tap();
        await speak(harness.meter, 400);
        await harness.recorder.tap();
        await flush();
        expect(harness.recorder.state()).toBe('decoding');

        harness.recorder.discard(DISCARD_REASONS.lock);
        release(decodedAudio());
        await flush();

        expect(harness.recorder.clips()).toHaveLength(0);
        expect(harness.recorder.state()).toBe('idle');
    });

    it('writes nothing to storage — the audio lives in memory only', async () => {
        const local = vi.spyOn(Storage.prototype, 'setItem');
        const harness = setup();
        await recordOnce(harness);
        harness.recorder.discard(DISCARD_REASONS.discard);
        expect(local).not.toHaveBeenCalled();
        local.mockRestore();
    });
});

describe('watchLifecycle', () => {
    it('discards when the document is hidden, and lets go on unsubscribe', async () => {
        const harness = setup();
        await recordOnce(harness);

        const stop = watchLifecycle(harness.recorder, { native: () => false });

        const hide = (state) => {
            Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        };

        hide('visible');
        expect(harness.recorder.clips()).toHaveLength(1);

        hide('hidden');
        expect(harness.recorder.clips()).toHaveLength(0);
        expect(harness.recorder.getSnapshot().discardReason).toBe(DISCARD_REASONS.background);

        await recordOnce(harness);
        stop();
        hide('hidden');
        expect(harness.recorder.clips()).toHaveLength(1);
    });

    it('subscribes to the native app state only on a native platform', async () => {
        const appPlugin = { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) };
        const harness = setup();

        watchLifecycle(harness.recorder, { native: () => false, appPlugin });
        expect(appPlugin.addListener).not.toHaveBeenCalled();

        watchLifecycle(harness.recorder, { native: () => true, appPlugin });
        expect(appPlugin.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));

        // And the listener discards when the app is no longer in front.
        await recordOnce(harness);
        appPlugin.addListener.mock.calls[0][1]({ isActive: false });
        expect(harness.recorder.clips()).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 5. The meter, and the flag that comes from it                                          */
/* ------------------------------------------------------------------------------------ */

describe('the level meter', () => {
    it('emits the level it read', async () => {
        const { recorder, meter } = setup();
        await recorder.tap();
        await speak(meter, 200, 0.42);
        expect(recorder.getSnapshot().level).toBeCloseTo(0.42, 5);
        expect(meter.reads).toBeGreaterThan(0);
    });

    it('takes the floor from a low percentile, not from the quietest single frame', () => {
        const mostlyLoud = [0.001, ...Array(19).fill(0.3)];
        expect(noiseFloor(mostlyLoud)).toBe(0.3);
        expect(noiseFloor([0.01, 0.01])).toBeNull();
    });

    it('flags a take as noisy when the room floor is high, and not when it is not', () => {
        expect(isNoisyTake(Array(40).fill(NOISY_FLOOR_LEVEL + 0.01))).toBe(true);
        expect(isNoisyTake(Array(40).fill(0.005))).toBe(false);
    });

    it('sets the noisy flag from the meter and from nothing downstream', async () => {
        // Two takes decoded to byte-identical audio, so nothing after the microphone can be
        // what differs. Only the room does.
        const noisyRun = setup();
        await noisyRun.recorder.tap();
        await speak(noisyRun.meter, 1_000);
        await quiet(noisyRun.meter, 3_000, SILENCE_LEVEL + 0.01);
        noisyRun.recorder.tap();
        await flush();

        const quietRun = setup();
        await quietRun.recorder.tap();
        await speak(quietRun.meter, 1_000);
        await quiet(quietRun.meter, 3_000, 0.002);
        quietRun.recorder.tap();
        await flush();

        expect(noisyRun.recorder.clips()[0].noisy).toBe(true);
        expect(quietRun.recorder.clips()[0].noisy).toBe(false);
        expect(Array.from(noisyRun.recorder.clips()[0].audio))
            .toEqual(Array.from(quietRun.recorder.clips()[0].audio));
        expect(noisyRun.decode).toHaveBeenCalledTimes(1);
    });

    it('a room whose floor never drops below the silence level runs to the limit', async () => {
        // The documented consequence of the two thresholds being the same number: if the
        // room is never quiet, the silence stop cannot fire, and the flag is how the user
        // finds out why the take ran the full thirty seconds.
        const { recorder, meter } = setup();
        await recorder.tap();
        await speak(meter, 1_000);
        await quiet(meter, MAX_CLIP_MS, SILENCE_LEVEL + 0.01);
        await flush();

        expect(recorder.clips()[0].stopReason).toBe('limit');
        expect(recorder.clips()[0].noisy).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 6. The web capture parts                                                               */
/* ------------------------------------------------------------------------------------ */

describe('web capture', () => {
    it('picks the first container the engine actually supports', () => {
        expect(pickMimeType({ isTypeSupported: (type) => type === 'audio/mp4' })).toBe('audio/mp4');
        expect(pickMimeType({ isTypeSupported: () => false })).toBe('');
        expect(pickMimeType(undefined)).toBe('');
    });

    it('decodes to one channel at 16 kHz', async () => {
        const channel = Float32Array.from([0.1, 0.2, 0.3]);
        const rendered = { getChannelData: () => channel };
        const built = [];

        class FakeOfflineAudioContext {
            constructor(channels, length, sampleRate) {
                this.channels = channels;
                this.length = length;
                this.sampleRate = sampleRate;
                this.destination = { id: 'destination' };
                built.push(this);
            }

            decodeAudioData() { return Promise.resolve({ duration: 2, channels: 2 }); }

            createBufferSource() { return { buffer: null, connect: () => { }, start: () => { } }; }

            startRendering() { return Promise.resolve(rendered); }
        }

        const audio = await decodeToMono16k(
            { arrayBuffer: async () => new ArrayBuffer(8) },
            { OfflineAudioContext: FakeOfflineAudioContext }
        );

        expect(built.map(context => context.sampleRate)).toEqual([TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE]);
        expect(built[1].channels).toBe(1);
        expect(built[1].length).toBe(2 * TARGET_SAMPLE_RATE);
        expect(Array.from(audio)).toEqual(Array.from(channel));
        // A copy, not the render buffer's own view — that buffer dies with its context.
        expect(audio).not.toBe(channel);
    });

    it('refuses to decode where there is no Web Audio at all', async () => {
        await expect(decodeToMono16k({ arrayBuffer: async () => new ArrayBuffer(8) }, { OfflineAudioContext: null }))
            .rejects.toThrow(/OfflineAudioContext/);
    });

    it('reports an engine with no MediaRecorder rather than pretending to record', async () => {
        const { recorder } = setup({ MediaRecorder: undefined });
        await recorder.tap();
        await flush();
        expect(recorder.state()).toBe('error');
        expect(recorder.getSnapshot().error.kind).toBe(ERROR_KINDS.unsupported);
    });
});

describe('the numbers the design fixes', () => {
    it('holds the two limits §4.2 states, and the button will read them from here', () => {
        expect(MAX_CLIP_MS).toBe(30_000);
        expect(SILENCE_HOLD_MS).toBe(2_000);
        expect(TARGET_SAMPLE_RATE).toBe(16_000);
    });

    it('leaves room between speech and silence, so a trailing voice does not flicker', () => {
        expect(SPEECH_LEVEL).toBeGreaterThan(SILENCE_LEVEL);
        expect(NOISY_FLOOR_LEVEL).toBe(SILENCE_LEVEL);
    });
});

/* ------------------------------------------------------------------------------------ */
/* C4: on Android the permission prompt is not the background                            */
/* ------------------------------------------------------------------------------------ */

describe('watchLifecycle on Android', () => {
    it('leaves a pending permission request alone, and still discards a recording', async () => {
        // The prompt is an activity of its own: showing it pauses the app and
        // `appStateChange` fires. Nothing has been captured in `requesting`, so a discard
        // there would only cancel the request the user is in the middle of granting.
        let openNow;
        const harness = setup({
            requestStream: () => new Promise(resolve => { openNow = () => resolve(makeFakeStream()); })
        });
        const appPlugin = { addListener: vi.fn(() => Promise.resolve({ remove: vi.fn() })) };
        watchLifecycle(harness.recorder, { doc: null, native: () => true, appPlugin });
        const onState = appPlugin.addListener.mock.calls[0][1];

        harness.recorder.tap();
        await flush();
        expect(harness.recorder.state()).toBe('requesting');

        onState({ isActive: false });
        onState({ isActive: true });
        openNow();
        await flush();
        expect(harness.recorder.state()).toBe('recording');

        // Audio exists now, and it goes.
        onState({ isActive: false });
        expect(harness.recorder.state()).toBe('idle');
        expect(harness.recorder.getSnapshot().discardReason).toBe(DISCARD_REASONS.background);
    });

    it('in a browser still cancels a pending request when the tab hides, as before', async () => {
        let openNow;
        const harness = setup({
            requestStream: () => new Promise(resolve => { openNow = () => resolve(makeFakeStream()); })
        });
        const doc = { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn(), defaultView: null };
        watchLifecycle(harness.recorder, { doc, native: () => false });
        const onVisibility = doc.addEventListener.mock.calls.find(call => call[0] === 'visibilitychange')[1];

        harness.recorder.tap();
        await flush();
        doc.visibilityState = 'hidden';
        onVisibility();
        openNow();
        await flush();

        expect(harness.recorder.state()).toBe('idle');
        expect(harness.recorder.clips()).toEqual([]);
    });
});
