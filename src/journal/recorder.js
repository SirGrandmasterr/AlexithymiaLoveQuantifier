import { App as CapacitorApp } from '@capacitor/app';
import { isNative } from '../mobile/platform';

/* 1. The numbers */

export const MAX_CLIP_MS = 30_000;

/** Silence that ends a take, once something has been said. */
export const SILENCE_HOLD_MS = 2_000;

/** How often the meter is read. 20 Hz is smooth enough to draw and cheap enough to ignore. */
export const METER_INTERVAL_MS = 50;

export const SPEECH_LEVEL = 0.08;
export const SILENCE_LEVEL = 0.04;

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

export const CAPTURE_CONSTRAINTS = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
};

/** Preferred container, most-wanted first. Opus is what every target engine has. */
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/* 2. The web capture parts */

/** The first container this engine will actually record, or `''` for "let it choose". */
export const pickMimeType = (Ctor) => {
    if (!Ctor || typeof Ctor.isTypeSupported !== 'function') return '';
    return MIME_CANDIDATES.find(type => Ctor.isTypeSupported(type)) || '';
};

export const requestMicrophone = async (constraints = CAPTURE_CONSTRAINTS) => {
    const media = globalThis.navigator?.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
        throw Object.assign(new Error('no microphone API'), { name: 'NotSupportedError' });
    }
    return media.getUserMedia({ audio: constraints });
};

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

/* 3. The meter's arithmetic */

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

/* 4. The recorder */

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

        addMore: () => {
            if (snapshot.state !== 'ready') return undefined;
            return begin(snapshot.takeId);
        },

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

/* 5. Lifecycle */

export const watchLifecycle = (recorder, options = {}) => {
    const {
        doc = typeof document === 'undefined' ? null : document,
        appPlugin = CapacitorApp,
        native = isNative
    } = options;

    const drop = () => {
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
