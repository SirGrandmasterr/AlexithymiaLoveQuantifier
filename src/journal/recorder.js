/**
 * The voice check-in's recorder: a state machine over a microphone, and nothing else.
 *
 * It holds audio in memory, hands it out as 16 kHz mono `Float32Array`s, and throws it away
 * on every exit that is not a confirm. There is no model here, no transcript, no network and
 * no storage — the whole module can be driven by a fake `MediaRecorder` and a scripted level
 * meter, which is the only reason its rules (2 s of silence, 30 s, discard on background) can
 * be tested at all. Everything the browser actually provides arrives through `deps`.
 *
 * Three rules from the design (§4.2) are structural here rather than remembered:
 *
 * 1. **Tap to start, tap to stop.** Never hold. `tap()` is the whole button contract.
 * 2. **Audio is never persisted.** It lives in `clips` until confirm, discard, lock or
 *    background — whichever is first. Discarding does not merely drop the reference: it
 *    zero-fills the buffer first, so a component that kept one holds silence rather than a
 *    voice. A voice is a biometric; a transcript is not (§6.6).
 * 3. **The noisy-take flag comes from the meter and from nowhere else.** It is arithmetic on
 *    the levels this module sampled while recording, decided before any transcriber exists —
 *    so it can never quietly become "the model was unsure", which is a different claim.
 *
 * What this module does **not** do: ask for permission at launch (only `start()` touches the
 * device), keep the stream open between clips (the browser's recording indicator goes out
 * while the card is on screen), or render anything. C3 puts a button on top of it.
 */

import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '../mobile/platform';

/* ------------------------------------------------------------------------------------ */
/* 1. The numbers                                                                         */
/* ------------------------------------------------------------------------------------ */

/**
 * The model's per-clip limit (§5.5: Gemma 4 E2B takes 30 s of audio per clip), and therefore
 * the recorder's. It is exported because the button's countdown copy has to say the same
 * number — C3 interpolates this constant rather than writing "30" into a sentence.
 */
export const MAX_CLIP_MS = 30_000;

/** Silence that ends a take, once something has been said. */
export const SILENCE_HOLD_MS = 2_000;

/** How often the meter is read. 20 Hz is smooth enough to draw and cheap enough to ignore. */
export const METER_INTERVAL_MS = 50;

/**
 * The two level thresholds, as RMS over the raw stream (0…1), with deliberate hysteresis:
 * between them the recorder calls the room neither speaking nor silent, so a voice trailing
 * off does not restart the silence clock on every other frame.
 */
export const SPEECH_LEVEL = 0.08;
export const SILENCE_LEVEL = 0.04;

/**
 * A take is noisy when its *quiet* parts are not quiet. The threshold is `SILENCE_LEVEL` on
 * purpose and not by coincidence: a floor that never drops below it is exactly the condition
 * under which the silence stop can never fire, and the user should be told that the room —
 * not the app — is what will make the words wrong (§4.2).
 */
export const NOISY_FLOOR_LEVEL = SILENCE_LEVEL;

/** The floor is a low percentile rather than the minimum: one quiet frame is not a quiet room. */
export const FLOOR_PERCENTILE = 0.2;

/** Below this many samples a floor is noise about noise, and the flag stays off. */
export const MIN_FLOOR_SAMPLES = 5;

/** What the model wants, and what `decodeToMono16k` produces (§4.2, §5.5). */
export const TARGET_SAMPLE_RATE = 16_000;

/** The recorder's states. `ready` means "clips in memory, waiting for the card". */
export const RECORDER_STATES = ['idle', 'requesting', 'recording', 'decoding', 'ready', 'error'];

/** Why a clip stopped. Kept on the clip, because C3's copy differs per reason. */
export const STOP_REASONS = ['tap', 'silence', 'limit', 'ended'];

/**
 * Why audio was thrown away. All three are the same operation; they differ only in what the
 * screen says next, and in the fact that two of them are not the user's decision.
 */
export const DISCARD_REASONS = {
    discard: 'discard',
    lock: 'lock',
    background: 'background'
};

/** What went wrong, when the state is `error`. `permission` is the ordinary one. */
export const ERROR_KINDS = {
    permission: 'permission',
    unsupported: 'unsupported',
    capture: 'capture',
    decode: 'decode'
};

/**
 * The constraints the capture asks for — and every one of them is off on purpose.
 *
 * The meter reads the same stream the recorder writes, so any processing the browser applies
 * changes both. With noise suppression or automatic gain in the path the flag would describe
 * a recording nobody is going to transcribe, and the absolute thresholds above would drift
 * under a moving gain — which fails silently, as "the silence stop stopped working".
 */
export const CAPTURE_CONSTRAINTS = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
};

/** Preferred container, most-wanted first. Opus is what every target engine has. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/* ------------------------------------------------------------------------------------ */
/* 2. The web capture parts                                                               */
/* ------------------------------------------------------------------------------------ */

/** The first container this engine will actually record, or `''` for "let it choose". */
export const pickMimeType = (Ctor) => {
    if (!Ctor || typeof Ctor.isTypeSupported !== 'function') return '';
    return MIME_CANDIDATES.find(type => Ctor.isTypeSupported(type)) || '';
};

/**
 * `getUserMedia` with the constraints above. Separated so a test never needs a device and so
 * the one place that touches the microphone is greppable.
 */
export const requestMicrophone = async (constraints = CAPTURE_CONSTRAINTS) => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
        throw Object.assign(new Error('no microphone API'), { name: 'NotSupportedError' });
    }
    return media.getUserMedia({ audio: constraints });
};

/**
 * An RMS level meter over a live stream.
 *
 * `getFloatTimeDomainData` gives the waveform rather than the spectrum, and the root mean
 * square of it is the only number this module needs: loud enough to be speech, quiet enough
 * to be silence, and how quiet the quiet parts were. `fftSize` at 1024 is ~21 ms at 48 kHz,
 * comfortably shorter than the 50 ms tick.
 */
export const createStreamMeter = (stream, deps = {}) => {
    const Ctor = deps.AudioContext || globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return { read: () => 0, close: () => { } };

    const context = new Ctor();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    // The analyser is a tap, not a stage: it is deliberately not connected to the
    // destination, or the user would hear themselves at a one-buffer delay.
    source.connect(analyser);

    const frame = new Float32Array(analyser.fftSize);

    return {
        read: () => {
            analyser.getFloatTimeDomainData(frame);
            let sum = 0;
            for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
            return Math.sqrt(sum / frame.length);
        },
        close: () => {
            try { source.disconnect(); } catch { /* already torn down */ }
            if (typeof context.close === 'function') context.close().catch(() => { });
        }
    };
};

/**
 * A recorded blob → 16 kHz mono `Float32Array`, which is the only format the model layer
 * accepts (§4.2).
 *
 * Two passes, and both are needed. `decodeAudioData` resamples to the context's rate, so the
 * decode context is created *at* 16 kHz; but it preserves the channel count, and a stereo
 * buffer is not mono. Rendering through a one-channel `OfflineAudioContext` is what performs
 * the downmix — the same spec rule that makes a stereo file audible on a mono speaker.
 */
export const decodeToMono16k = async (blob, deps = {}) => {
    const Offline = deps.OfflineAudioContext
        || globalThis.OfflineAudioContext
        || globalThis.webkitOfflineAudioContext;
    if (!Offline) throw Object.assign(new Error('no OfflineAudioContext'), { name: 'NotSupportedError' });

    const bytes = await blob.arrayBuffer();
    const decoded = await new Offline(1, 1, TARGET_SAMPLE_RATE).decodeAudioData(bytes);

    const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
    const render = new Offline(1, frames, TARGET_SAMPLE_RATE);
    const source = render.createBufferSource();
    source.buffer = decoded;
    source.connect(render.destination);
    source.start(0);

    const rendered = await render.startRendering();
    // A copy, not the rendered buffer's own view: the context is about to be collected, and
    // this array outlives it inside the clip.
    return Float32Array.from(rendered.getChannelData(0));
};

/* ------------------------------------------------------------------------------------ */
/* 3. The meter's arithmetic                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * How quiet the quiet parts of a take were. Exported because the noisy flag is a claim about
 * the user's room, and a claim wants its own test.
 */
export const noiseFloor = (levels) => {
    if (!Array.isArray(levels) || levels.length < MIN_FLOOR_SAMPLES) return null;
    const sorted = [...levels].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * FLOOR_PERCENTILE));
    return sorted[index];
};

/** The flag itself: the floor, compared with the level below which a room counts as quiet. */
export const isNoisyTake = (levels) => {
    const floor = noiseFloor(levels);
    return floor !== null && floor >= NOISY_FLOOR_LEVEL;
};

/* ------------------------------------------------------------------------------------ */
/* 4. The recorder                                                                        */
/* ------------------------------------------------------------------------------------ */

let clipCounter = 0;
let takeCounter = 0;

const emptySnapshot = () => ({
    state: 'idle',
    takeId: null,
    clips: [],
    level: 0,
    noisy: false,
    elapsedMs: 0,
    remainingMs: MAX_CLIP_MS,
    stopReason: null,
    discardReason: null,
    error: null
});

/**
 * Build a recorder.
 *
 * Every browser API it uses is a `deps` entry with a real default, so a test supplies a fake
 * `MediaRecorder`, a scripted meter and a stub decoder and never touches a device. The clock
 * is *not* injected — `Date.now`, `setInterval` and `clearInterval` are used directly, and
 * the tests fake them with `vi.useFakeTimers()`, which is less machinery for the same reach.
 */
export const createRecorder = (deps = {}) => {
    const {
        requestStream = requestMicrophone,
        MediaRecorder: MediaRecorderCtor = globalThis.MediaRecorder,
        createMeter = createStreamMeter,
        decode = decodeToMono16k,
        makeBlob = (parts, options) => new Blob(parts, options)
    } = deps;

    const listeners = new Set();
    let snapshot = emptySnapshot();

    // Live capture state. All of it is cleared by `release()`; none of it is exposed.
    let stream = null;
    let meter = null;
    let recorder = null;
    let ticker = null;
    let chunks = [];
    let levels = [];
    let startedAt = 0;
    let spokeAt = null;
    let silenceSince = null;
    let pendingReason = null;
    let aborted = false;
    let cancelledRequest = false;

    const emit = () => {
        const frozen = snapshot;
        listeners.forEach(listener => {
            try { listener(frozen); } catch { /* a subscriber's fault is not the mic's */ }
        });
    };

    const set = (patch) => {
        snapshot = { ...snapshot, ...patch };
        emit();
    };

    const stopTicker = () => {
        if (ticker !== null) clearInterval(ticker);
        ticker = null;
    };

    /** Let go of the device. Called at every stop, not only at the end of a take. */
    const release = () => {
        stopTicker();
        if (meter) { meter.close(); meter = null; }
        if (stream) {
            stream.getTracks?.().forEach(track => { try { track.stop(); } catch { /* gone */ } });
            stream = null;
        }
        recorder = null;
        chunks = [];
    };

    /**
     * Forget the audio, loudly enough that a retained reference is useless. `fill(0)` is the
     * difference between "we dropped the pointer" and "the samples are gone" — and the second
     * is what §4.2 promises.
     */
    const wipeClips = () => {
        snapshot.clips.forEach(clip => { try { clip.audio.fill(0); } catch { /* not ours */ } });
    };

    const fail = (kind, cause) => {
        release();
        set({
            state: 'error',
            level: 0,
            elapsedMs: 0,
            remainingMs: MAX_CLIP_MS,
            error: { kind, name: cause?.name || null, message: cause?.message || null }
        });
    };

    /** The blob is in; decode it, keep it, and go back to waiting for the user. */
    const settle = async () => {
        const reason = pendingReason || 'ended';
        const durationMs = Math.min(MAX_CLIP_MS, Date.now() - startedAt);
        const takenLevels = levels;
        const parts = chunks;
        const type = recorder?.mimeType || '';

        pendingReason = null;
        release();

        if (aborted) return;

        set({ state: 'decoding' });

        let audio;
        try {
            audio = await decode(makeBlob(parts, type ? { type } : undefined));
        } catch (cause) {
            if (aborted) return;
            fail(ERROR_KINDS.decode, cause);
            return;
        }

        // A discard that landed while the decoder was working wins: the user has already left.
        if (aborted) { try { audio.fill(0); } catch { /* not ours */ } return; }

        clipCounter += 1;
        const clip = {
            id: `clip-${clipCounter}`,
            takeId: snapshot.takeId,
            index: snapshot.clips.length,
            audio,
            sampleRate: TARGET_SAMPLE_RATE,
            durationMs,
            stopReason: reason,
            levels: takenLevels,
            floor: noiseFloor(takenLevels),
            noisy: isNoisyTake(takenLevels)
        };

        set({
            state: 'ready',
            clips: [...snapshot.clips, clip],
            level: 0,
            elapsedMs: 0,
            remainingMs: MAX_CLIP_MS,
            stopReason: reason,
            noisy: snapshot.noisy || clip.noisy
        });
    };

    /** End the clip that is running. The blob arrives asynchronously, through `settle`. */
    const finish = (reason) => {
        if (snapshot.state !== 'recording') return;
        pendingReason = reason;
        stopTicker();
        try {
            recorder.stop();
        } catch (cause) {
            fail(ERROR_KINDS.capture, cause);
        }
    };

    /**
     * One 50 ms tick: read the level, decide whether anything has been said, and apply the
     * two stops. Silence is checked before the limit because it is the more specific reason
     * for the same event, and the clip carries which one it was.
     */
    const tick = () => {
        const at = Date.now();
        const level = meter ? meter.read() : 0;
        levels.push(level);

        if (level >= SPEECH_LEVEL) {
            if (spokeAt === null) spokeAt = at;
            silenceSince = null;
        } else if (level < SILENCE_LEVEL) {
            if (silenceSince === null) silenceSince = at;
        } else {
            silenceSince = null;
        }

        const elapsedMs = at - startedAt;
        set({
            level,
            elapsedMs,
            remainingMs: Math.max(0, MAX_CLIP_MS - elapsedMs),
            noisy: isNoisyTake(levels)
        });

        // Silence only ends a take that has something in it. Before the first word the user
        // is still deciding what to say, and a recorder that gives up after two seconds of
        // that is a recorder nobody uses twice.
        if (spokeAt !== null && silenceSince !== null && at - silenceSince >= SILENCE_HOLD_MS) {
            finish('silence');
            return;
        }
        if (elapsedMs >= MAX_CLIP_MS) finish('limit');
    };

    /** Ask for the device and start a clip. Shared by `start` and `addMore`. */
    const begin = async (takeId) => {
        if (!MediaRecorderCtor) {
            fail(ERROR_KINDS.unsupported, new Error('no MediaRecorder'));
            return;
        }

        aborted = false;
        cancelledRequest = false;
        set({ state: 'requesting', takeId, error: null, discardReason: null, stopReason: null });

        let opened;
        try {
            opened = await requestStream();
        } catch (cause) {
            if (cancelledRequest) { set({ state: snapshot.clips.length ? 'ready' : 'idle' }); return; }
            const kind = cause?.name === 'NotSupportedError' ? ERROR_KINDS.unsupported : ERROR_KINDS.permission;
            fail(kind, cause);
            return;
        }

        // A tap, a lock or a background while the permission prompt was up: the user is no
        // longer here, so the device is handed straight back rather than opened.
        if (cancelledRequest) {
            opened.getTracks?.().forEach(track => { try { track.stop(); } catch { /* gone */ } });
            set({ state: snapshot.clips.length ? 'ready' : 'idle' });
            return;
        }

        stream = opened;
        meter = createMeter(stream);
        chunks = [];
        levels = [];
        spokeAt = null;
        silenceSince = null;
        pendingReason = null;
        startedAt = Date.now();

        const mimeType = pickMimeType(MediaRecorderCtor);
        try {
            recorder = new MediaRecorderCtor(stream, mimeType ? { mimeType } : undefined);
        } catch (cause) {
            fail(ERROR_KINDS.capture, cause);
            return;
        }

        recorder.ondataavailable = (event) => {
            if (event?.data && (event.data.size === undefined || event.data.size > 0)) chunks.push(event.data);
        };
        recorder.onstop = () => { settle(); };
        recorder.onerror = (event) => { fail(ERROR_KINDS.capture, event?.error || event); };

        try {
            recorder.start();
        } catch (cause) {
            fail(ERROR_KINDS.capture, cause);
            return;
        }

        ticker = setInterval(tick, METER_INTERVAL_MS);
        set({ state: 'recording', level: 0, elapsedMs: 0, remainingMs: MAX_CLIP_MS, noisy: false });
    };

    const api = {
        /** The current snapshot. Stable between changes, so `useSyncExternalStore` is happy. */
        getSnapshot: () => snapshot,

        state: () => snapshot.state,

        /** The clips of the current take, in the order they were spoken. */
        clips: () => snapshot.clips,

        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },

        /**
         * The button. One tap starts, the next stops, and after a take it records a second
         * clip onto the same card — so the screen needs no state of its own to know which.
         */
        tap: () => {
            if (snapshot.state === 'recording') return api.stop();
            if (snapshot.state === 'ready') return api.addMore();
            if (snapshot.state === 'requesting' || snapshot.state === 'decoding') return undefined;
            return api.start();
        },

        /** Begin a new take. Anything held from a previous one is discarded first. */
        start: () => {
            if (snapshot.state === 'recording' || snapshot.state === 'requesting') return undefined;
            if (snapshot.clips.length) api.discard(DISCARD_REASONS.discard);
            takeCounter += 1;
            return begin(`take-${takeCounter}`);
        },

        stop: () => {
            if (snapshot.state === 'requesting') { cancelledRequest = true; return undefined; }
            finish('tap');
            return undefined;
        },

        /**
         * A second clip on the same card (§4.2). It carries the take's id, so everything
         * downstream groups by that rather than by the order things arrived.
         */
        addMore: () => {
            if (snapshot.state !== 'ready') return undefined;
            return begin(snapshot.takeId);
        },

        /**
         * Throw the audio away. The only three callers are the discard button, the app lock
         * and the lifecycle watcher, and the reason is kept only so the screen can say the
         * right sentence afterwards — the effect is identical for all three.
         */
        discard: (reason = DISCARD_REASONS.discard) => {
            aborted = true;
            cancelledRequest = true;
            if (recorder && snapshot.state === 'recording') {
                try { recorder.stop(); } catch { /* it was already going down */ }
            }
            release();
            wipeClips();
            snapshot = { ...emptySnapshot(), discardReason: reason };
            emit();
        },

        /** Discard and forget the subscribers. For an unmounting component. */
        destroy: () => {
            api.discard(DISCARD_REASONS.discard);
            listeners.clear();
        }
    };

    return api;
};

/* ------------------------------------------------------------------------------------ */
/* 5. Lifecycle                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * Wire the two events that mean "the user is no longer looking at this": the tab going
 * hidden, and the Android app going to the background. Both discard (§4.2, §9.6).
 *
 * The app **lock** is the third exit and it is deliberately not here: the lock is React state
 * in `App.jsx`, so the component that owns it calls `discard(DISCARD_REASONS.lock)` itself.
 * Guessing at it from a global would mean two owners for one rule.
 *
 * Returns an unsubscribe. Native listeners are only attached on a native platform, so the web
 * build is unaffected — the same short-circuit every module under `src/mobile/` uses.
 */
export const watchLifecycle = (recorder, options = {}) => {
    const {
        doc = typeof document === 'undefined' ? null : document,
        appPlugin = CapacitorApp,
        native = isNative
    } = options;

    const drop = () => {
        // On Android the permission prompt is an activity of its own, so the first tap of
        // the microphone takes the app out of the foreground — `appStateChange` fires, and
        // on some devices the WebView reports itself hidden too. Nothing has been captured
        // in `requesting`, so there is nothing to throw away, and a discard here would
        // cancel the very request the user is in the middle of granting. Native only: in a
        // browser a prompt hides nothing, and the old behaviour stands.
        if (native() && recorder.getSnapshot?.()?.state === 'requesting') return;
        recorder.discard(DISCARD_REASONS.background);
    };

    const onVisibility = () => { if (doc.visibilityState === 'hidden') drop(); };

    if (doc) {
        doc.addEventListener('visibilitychange', onVisibility);
        // `pagehide` covers the cases `visibilitychange` does not: a navigation away, and
        // iOS putting the tab into the back/forward cache.
        doc.defaultView?.addEventListener?.('pagehide', drop);
    }

    let nativeHandle = null;
    if (native() && appPlugin?.addListener) {
        nativeHandle = appPlugin.addListener('appStateChange', (state) => { if (!state?.isActive) drop(); });
    }

    return () => {
        if (doc) {
            doc.removeEventListener('visibilitychange', onVisibility);
            doc.defaultView?.removeEventListener?.('pagehide', drop);
        }
        if (nativeHandle) Promise.resolve(nativeHandle).then(listener => listener?.remove?.()).catch(() => { });
    };
};
