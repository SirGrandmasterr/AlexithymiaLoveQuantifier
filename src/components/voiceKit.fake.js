import { vi } from 'vitest';
import { createFakeRuntime, proposalFixture } from '../journal/inference/fake';
import { PROPOSAL_MODEL, WHISPER_TINY, formatBytes, setBytes, setLabel, tierModels } from '../journal/inference/models';
import { TIERS } from '../journal/inference/tier';

export const fakeRecorder = () => {
    const listeners = new Set();
    let snapshot = {
        state: 'idle', takeId: null, clips: [], level: 0, noisy: false,
        elapsedMs: 0, remainingMs: 30_000, stopReason: null, discardReason: null, error: null
    };
    const emit = () => { const frozen = snapshot; listeners.forEach(listener => listener(frozen)); };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        tap: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addMore: vi.fn(),
        discard: vi.fn(() => { snapshot = { ...snapshot, state: 'idle', clips: [] }; emit(); }),
        destroy: vi.fn(),
        /** Put a finished take in the recorder's hand, as the real one does after a stop. */
        landTake: (clips) => {
            snapshot = { ...snapshot, state: 'ready', takeId: `take-${clips[0]?.id ?? '1'}`, clips };
            emit();
        },
        setState: (patch) => { snapshot = { ...snapshot, ...patch }; emit(); }
    };
};

export const clip = (id, { noisy = false } = {}) => ({
    id, takeId: 'take-1', index: 0, audio: Float32Array.from([0.2, -0.2]),
    sampleRate: 16_000, durationMs: 1_500, stopReason: 'tap', noisy, floor: noisy ? 0.05 : 0.01
});

export const fakeDownloader = (downloaded = true) => {
    const listeners = new Set();
    let snapshot = { state: 'idle', file: null, filesDone: 0, filesTotal: 13, loaded: 0, total: 45_245_009, error: null };
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        start: vi.fn(async () => true),
        cancel: vi.fn(),
        remove: vi.fn(async () => true),
        isDownloaded: vi.fn(async () => downloaded),
        setState: (patch) => {
            snapshot = { ...snapshot, ...patch };
            const frozen = snapshot;
            listeners.forEach(listener => listener(frozen));
        }
    };
};

export const fakeKit = ({
    fixtures = null, runtime = null, options = {}, downloaded = true,
    tier = TIERS.light, models = null
} = {}) => {
    const set = models || tierModels(tier);
    return {
        tier,
        models: set,
        model: set.find(one => one.label === PROPOSAL_MODEL.label) || set[0] || WHISPER_TINY,
        label: setLabel(set),
        size: formatBytes(setBytes(set)),
        recorder: fakeRecorder(),
        downloader: fakeDownloader(downloaded),
        runtime: runtime || createFakeRuntime(fixtures ?? proposalFixture(), options)
    };
};
