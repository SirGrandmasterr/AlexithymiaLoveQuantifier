/**
 * A fake of the journal plugin, with the real one's surface, so `npm test` can drive the
 * whole native path — the permission order, capture, the clip handles, transcription, the
 * weight store and the tier report — with no device (§5.7's rail, applied to the bridge).
 *
 * It records every call in order, which is the one thing a device could not be made to
 * prove on demand: that nothing is asked at launch and that the first tap asks before it
 * opens. Like `inference/fake.js` it is imported by tests only.
 */

const failure = (code, message = code, data = undefined) => Object.assign(new Error(message), { code, data });

export const createFakeJournalPlugin = (options = {}) => {
    const {
        permission = 'prompt',
        grant = true,
        transcript = 'Lucie called and I felt lighter afterwards.',
        language = 'en',
        tier = { totalMemoryBytes: 8 * 1024 ** 3, availableMemoryBytes: 4 * 1024 ** 3, lowRamDevice: false, apiLevel: 34, model: 'Fake', manufacturer: 'Test', androidVersion: '14' },
        downloaded = false,
        fetchOutcome = 'ready',            // 'ready' | 'cancelled' | a failure kind
        fetchProgress = [],                // events emitted before the outcome
        deferGrant = false,                // hold the prompt open until `grantNow()`
        // D3: what the proposal model answers, as the JSON string the real plugin returns.
        // `null` keeps C4's behaviour — a plugin with no proposal model, which refuses.
        proposal = null
    } = options;

    let state = permission;
    let capturing = false;
    let clipCounter = 0;
    let onDevice = downloaded;
    let fetching = null;
    const calls = [];
    const clips = new Map();
    const listeners = new Map();

    const record = (name, args) => { calls.push({ name, args }); };
    const emit = (event, data) => { (listeners.get(event) || new Set()).forEach(listener => listener(data)); };

    const clip = (reason) => {
        clipCounter += 1;
        const handle = `clip-${clipCounter}`;
        clips.set(handle, 16_000);
        return { handle, samples: 16_000, durationMs: 1000, sampleRate: 16_000, reason };
    };

    const plugin = {
        // ── test controls ──────────────────────────────────────────────────────────
        calls,
        clips,
        names: () => calls.map(call => call.name),
        permissionState: () => state,
        isCapturing: () => capturing,
        setLevel: (rms) => emit('level', { rms }),
        /** The native thirty-second cap: the capture ends itself and says so. */
        endCaptureAtLimit: () => {
            if (!capturing) return null;
            capturing = false;
            const ended = clip('limit');
            plugin.pending = ended;
            emit('captureEnded', ended);
            return ended;
        },
        pending: null,

        // ── the real surface ───────────────────────────────────────────────────────
        addListener: async (event, listener) => {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event).add(listener);
            return { remove: async () => { listeners.get(event)?.delete(listener); } };
        },
        checkPermissions: async () => { record('checkPermissions'); return { microphone: state }; },
        requestPermissions: async (args) => {
            record('requestPermissions', args);
            if (deferGrant) {
                // The prompt is on screen; the test decides when the user answers it.
                return new Promise(resolve => {
                    plugin.grantNow = () => {
                        state = grant ? 'granted' : 'denied';
                        resolve({ microphone: state });
                    };
                });
            }
            state = grant ? 'granted' : 'denied';
            return { microphone: state };
        },
        grantNow: () => { },
        startCapture: async (args) => {
            record('startCapture', args);
            if (state !== 'granted') throw failure('denied', 'the microphone permission was not granted');
            if (capturing) throw failure('busy');
            capturing = true;
            plugin.pending = null;
            return {};
        },
        stopCapture: async () => {
            record('stopCapture');
            if (capturing) { capturing = false; return clip('tap'); }
            if (plugin.pending) { const ended = plugin.pending; plugin.pending = null; return ended; }
            throw failure('idle', 'nothing is being captured');
        },
        abortCapture: async () => { record('abortCapture'); capturing = false; plugin.pending = null; return {}; },
        releaseClip: async ({ handle } = {}) => { record('releaseClip', { handle }); clips.delete(handle); return {}; },
        transcribe: async (args) => {
            record('transcribe', args);
            return { text: transcript, language, tokens: 3, durationMs: 5 };
        },
        propose: async (args) => {
            record('propose', args);
            if (proposal === null) throw failure('unavailable');
            return {
                text: typeof proposal === 'string' ? proposal : JSON.stringify(proposal),
                durationMs: 7,
                loadMs: 0
            };
        },
        loadProposer: async (args) => { record('loadProposer', args); return { loaded: proposal !== null }; },
        releaseProposer: async () => { record('releaseProposer'); return {}; },
        embed: async () => { record('embed'); throw failure('unavailable'); },
        tier: async () => { record('tier'); return { ...tier }; },
        fetchModel: async (args) => {
            record('fetchModel', args);
            fetching = { id: args.id, cancelled: false };
            for (const event of fetchProgress) emit('fetchProgress', { id: args.id, ...event });
            await Promise.resolve();
            const cancelled = fetching.cancelled;
            fetching = null;
            if (cancelled || fetchOutcome === 'cancelled') return { state: 'cancelled' };
            if (fetchOutcome === 'ready') { onDevice = true; return { state: 'ready' }; }
            throw failure(fetchOutcome, `${fetchOutcome} while fetching`, { path: args.files?.[0]?.path });
        },
        cancelFetch: async ({ id } = {}) => { record('cancelFetch', { id }); if (fetching && fetching.id === id) fetching.cancelled = true; return {}; },
        modelStatus: async (args) => { record('modelStatus', args); return { ready: onDevice }; },
        removeModel: async (args) => { record('removeModel', args); onDevice = false; return { removed: true }; }
    };

    return plugin;
};

/** Capacitor's App plugin, reduced to the one event `watchLifecycle` listens for. */
export const createFakeAppPlugin = () => {
    const listeners = new Set();
    return {
        addListener: async (event, listener) => {
            if (event === 'appStateChange') listeners.add(listener);
            return { remove: async () => listeners.delete(listener) };
        },
        background: () => listeners.forEach(listener => listener({ isActive: false })),
        foreground: () => listeners.forEach(listener => listener({ isActive: true }))
    };
};
