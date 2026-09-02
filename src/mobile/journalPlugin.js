import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { getServerUrl } from './serverUrl';
import { MAX_CLIP_MS } from '../journal/recorder';
import { setNativeTierReport } from '../journal/inference/tier';
import { emptyProgress } from '../journal/inference/download';
import { totalBytes } from '../journal/inference/models';

/**
 * The JavaScript side of the journal's native plugin, and the adapters that make C2's
 * recorder and C3's download manager drive it without either of them knowing.
 *
 * The plugin is deliberately narrow (§5.5, §12.2): record, transcribe, propose (a stub
 * until D3), embed (a stub until G1), and report memory and tier — plus the weight store
 * `transcribe` cannot work without. Everything above it is the one React app, which is
 * why this file contains adapters and not a second recorder: `createRecorder(deps)` takes
 * every browser API it uses as an injected default, and on Android those defaults are the
 * plugin. The state machine, the silence stop, the thirty-second limit, *add more* and the
 * discard rules run unchanged.
 *
 * **Audio never crosses the bridge** (§4.2). What the recorder holds as `clip.audio` on
 * Android is a handle — an object that quacks like a `Float32Array` for exactly the two
 * things the recorder does with one, `length` and `fill(0)` — and the samples stay in the
 * plugin's memory until `fill(0)` releases them. The native runtime hands the handles to
 * `transcribe`; no base64 string, no blob, no file.
 *
 * **The permission is asked on the first tap and never at launch.** `requestStream` is
 * the only place that asks, it runs inside the recorder's `start()`, and it asks in the
 * order Capacitor expects: `checkPermissions`, then `requestPermissions` only if needed,
 * then `startCapture` — which the native side refuses without the grant regardless. A
 * denial rejects with `NotAllowedError`, which the recorder already reads as its
 * `permission` error and the screen already answers with the typed path (§4.2).
 */

/** Registered by name; Capacitor finds the Android class through `capacitor.plugins.json`. */
export const AlqJournal = registerPlugin('AlqJournal');

export const MICROPHONE_ALIAS = 'microphone';

/* ------------------------------------------------------------------------------------ */
/* 1. The tier report                                                                     */
/* ------------------------------------------------------------------------------------ */

/**
 * Ask the device how much memory it has and hand the answer to `tier.js`, which decides.
 *
 * Called once from the app shell on a native platform. It reads a number; it asks for no
 * permission and opens no device, so "nothing at launch" still holds for the microphone.
 */
export const primeNativeTier = async (plugin = AlqJournal, { native = isNative } = {}) => {
    if (!native()) return null;
    try {
        const report = await plugin.tier();
        setNativeTierReport(report);
        return report;
    } catch {
        // A read that fails is not a small device: whatever was known before stands, and
        // with nothing known `tier.js` falls back to what the WebView says about itself.
        return null;
    }
};

/* ------------------------------------------------------------------------------------ */
/* 2. Capture, as the recorder's `deps`                                                   */
/* ------------------------------------------------------------------------------------ */

/** A clip's audio, as the recorder holds it on Android: a handle, not the samples. */
export const nativeAudio = (clip, plugin) => ({
    native: true,
    handle: clip.handle,
    length: Number(clip.samples) || 0,
    sampleRate: Number(clip.sampleRate) || 16_000,
    durationMs: Number(clip.durationMs) || 0,
    /**
     * The recorder's discard calls `audio.fill(0)`; here that releases the native buffer,
     * which the plugin zero-fills before it forgets. Idempotent on both sides.
     */
    fill() {
        plugin.releaseClip({ handle: clip.handle }).catch(() => { /* already gone */ });
        return this;
    }
});

export const isNativeAudio = (audio) => Boolean(audio && audio.native === true && typeof audio.handle === 'string');

const removeListener = (handle) => Promise.resolve(handle).then(listener => listener?.remove?.()).catch(() => { });

/**
 * The recorder's `deps` for Android. Pass the result to `createRecorder`.
 *
 * `plugin` is injectable so `npm test` can drive the whole permission flow with a fake and
 * assert the order of calls — the one thing a device could not be made to prove on demand.
 */
export const nativeCaptureDeps = (plugin = AlqJournal) => {
    let latestLevel = 0;

    /**
     * What `createRecorder` sees as `MediaRecorder`. `start()` is a no-op because the
     * capture began inside `requestStream`; `stop()` asks the plugin for the clip and
     * fires the two events the recorder waits for. If the native limit ended the capture
     * first, the plugin's `captureEnded` event delivers the same clip, and whichever
     * arrives first wins.
     */
    class NativeRecorder {
        static isTypeSupported() { return false; }

        constructor(stream, options) {
            this.stream = stream;
            this.mimeType = options?.mimeType || 'audio/native';
            this.state = 'inactive';
            this.delivered = false;
            this.ended = plugin.addListener('captureEnded', (clip) => this.deliver(clip));
        }

        start() { this.state = 'recording'; }

        stop() {
            this.state = 'inactive';
            plugin.stopCapture()
                .then(clip => this.deliver(clip))
                .catch(error => {
                    if (this.delivered) return;
                    this.delivered = true;
                    removeListener(this.ended);
                    this.onerror?.({ error });
                });
        }

        deliver(clip) {
            if (this.delivered || !clip) return;
            this.delivered = true;
            removeListener(this.ended);
            this.ondataavailable?.({ data: { size: Number(clip.samples) || 0, clip } });
            this.onstop?.();
        }
    }

    return {
        /**
         * The first tap, and only the first tap, gets here with the permission unasked.
         * The order is the contract: check, then request only if needed, then open.
         */
        requestStream: async () => {
            const { microphone } = await plugin.checkPermissions();
            let state = microphone;
            if (state !== 'granted') {
                ({ microphone: state } = await plugin.requestPermissions({ permissions: [MICROPHONE_ALIAS] }));
            }
            if (state !== 'granted') {
                throw Object.assign(new Error('the microphone was not allowed'), { name: 'NotAllowedError' });
            }
            await plugin.startCapture({ maxMs: MAX_CLIP_MS });
            return {
                native: true,
                // The recorder stops every track at every release. On a capture that has
                // already been handed over this is a no-op; on one abandoned mid-request
                // (a tap or a background while the prompt was up) it drops the audio.
                getTracks: () => [{ kind: 'audio', stop: () => { plugin.abortCapture().catch(() => { }); } }]
            };
        },

        MediaRecorder: NativeRecorder,

        /** The plugin emits an RMS every 50 ms; the recorder's tick reads the latest. */
        createMeter: () => {
            latestLevel = 0;
            const handle = plugin.addListener('level', ({ rms }) => { latestLevel = Number(rms) || 0; });
            return {
                read: () => latestLevel,
                close: () => { latestLevel = 0; removeListener(handle); }
            };
        },

        /** No blob and no decoding: the "blob" carries the clip the plugin described. */
        makeBlob: (parts) => ({ native: true, parts }),

        decode: async (blob) => {
            const clip = blob?.parts?.find(part => part?.clip)?.clip;
            if (!clip || typeof clip.handle !== 'string') {
                throw Object.assign(new Error('no native clip to hand over'), { name: 'DataError' });
            }
            return nativeAudio(clip, plugin);
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* 3. The download manager, over the plugin's weight store                                */
/* ------------------------------------------------------------------------------------ */

const KNOWN_KINDS = ['checksum', 'length', 'network', 'storage', 'unsupported'];

/**
 * The same store surface as `createModelDownloader` — `getSnapshot`, `subscribe`, `start`,
 * `cancel`, `isDownloaded`, `remove` — so `VoiceCheckin` and the settings screen cannot
 * tell which one they hold.
 *
 * The files come from the configured server's `/models/` (§5.6), fetched natively into
 * the app's private files directory, and the pins go *in*: `models.js` stays the one
 * manifest, and the plugin hashes what it is told to hash. A wrong sum is reported as
 * `checksum` and nothing is kept, exactly as on the web.
 */
export const createNativeDownloader = (model, options = {}) => {
    const { plugin = AlqJournal, baseUrl = getServerUrl } = options;

    const listeners = new Set();
    let snapshot = emptyProgress(model);
    let running = false;

    const emit = () => {
        const frozen = snapshot;
        listeners.forEach(listener => { try { listener(frozen); } catch { /* not ours */ } });
    };
    const set = (patch) => { snapshot = { ...snapshot, ...patch }; emit(); };

    const files = () => model.files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));

    const start = async () => {
        if (running) return false;
        const server = typeof baseUrl === 'function' ? baseUrl() : baseUrl;
        if (!server) {
            set({ state: 'error', error: { kind: 'network', message: 'no server is configured' } });
            return false;
        }

        running = true;
        set({ ...emptyProgress(model), state: 'downloading' });
        const progress = plugin.addListener('fetchProgress', (event) => {
            if (event?.id !== model.id) return;
            set({
                file: event.path ?? null,
                filesDone: Number(event.filesDone) || 0,
                loaded: Number(event.loaded) || 0
            });
        });

        try {
            const result = await plugin.fetchModel({ id: model.id, baseUrl: server, files: files() });
            if (result?.state === 'cancelled') {
                set({ state: 'cancelled', file: null });
                return false;
            }
            set({ state: 'ready', file: null, filesDone: model.files.length, loaded: totalBytes(model) });
            return true;
        } catch (error) {
            const kind = KNOWN_KINDS.includes(error?.code) ? error.code : 'network';
            set({
                state: 'error',
                file: error?.data?.path || snapshot.file,
                error: { kind, message: error?.message || 'the download stopped' }
            });
            return false;
        } finally {
            running = false;
            removeListener(progress);
        }
    };

    return {
        model,
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        start,
        cancel: () => {
            if (running) plugin.cancelFetch({ id: model.id }).catch(() => { });
        },
        isDownloaded: async () => {
            try {
                const { ready } = await plugin.modelStatus({ id: model.id, files: files() });
                return ready === true;
            } catch {
                return false;
            }
        },
        remove: async () => {
            try {
                await plugin.removeModel({ id: model.id, files: files() });
                snapshot = emptyProgress(model);
                emit();
                return true;
            } catch {
                return false;
            }
        }
    };
};
