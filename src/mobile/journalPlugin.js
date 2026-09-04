import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { getServerUrl } from './serverUrl';
import { MAX_CLIP_MS } from '../journal/recorder';
import { setNativeTierReport } from '../journal/inference/tier';
import { emptyProgress } from '../journal/inference/download';
import { totalBytes } from '../journal/inference/models';

/** Registered by name; Capacitor finds the Android class through `capacitor.plugins.json`. */
export const AlqJournal = registerPlugin('AlqJournal');

export const MICROPHONE_ALIAS = 'microphone';

/* 1. The tier report */

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

/* 2. Capture, as the recorder's `deps` */

/** A clip's audio, as the recorder holds it on Android: a handle, not the samples. */
export const nativeAudio = (clip, plugin) => ({
    native: true,
    handle: clip.handle,
    length: Number(clip.samples) || 0,
    sampleRate: Number(clip.sampleRate) || 16_000,
    durationMs: Number(clip.durationMs) || 0,
    fill() {
        plugin.releaseClip({ handle: clip.handle }).catch(() => { /* already gone */ });
        return this;
    }
});

export const isNativeAudio = (audio) => Boolean(audio && audio.native === true && typeof audio.handle === 'string');

const removeListener = (handle) => Promise.resolve(handle).then(listener => listener?.remove?.()).catch(() => { });

export const nativeCaptureDeps = (plugin = AlqJournal) => {
    let latestLevel = 0;

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

/* 3. The download manager, over the plugin's weight store */

const KNOWN_KINDS = ['checksum', 'length', 'network', 'storage', 'unsupported'];

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
