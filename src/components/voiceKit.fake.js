import { vi } from 'vitest';
import { createFakeRuntime, proposalFixture } from '../journal/inference/fake';
import { PROPOSAL_MODEL, WHISPER_TINY, formatBytes, setBytes, setLabel, tierModels } from '../journal/inference/models';
import { TIERS } from '../journal/inference/tier';

/**
 * The three things a voice kit holds, faked for tests: a recorder store with the real one's
 * surface and a `landTake` to put a finished take in its hand, a downloader that already
 * has the files, and C2's fake runtime. `VoiceCheckin.test.jsx` carries its own copies of
 * the first two; this module exists so the proposal card's tests can build the same kit
 * without a second definition of what a recorder looks like.
 *
 * **Tests only.** Nothing the app ships imports this file.
 */

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

/**
 * A kit whose runtime answers with `fixtures` (any of the fake's three forms).
 *
 * Since D3 a kit also carries the tier it was built for and the download line's two strings,
 * because the real one does: a Light-tier device downloads two models and a Full-tier one
 * downloads one, and the sentence on screen is built from that list rather than from a model
 * this fake picked. `tier` and `models` are overridable so a test can render either.
 */
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
