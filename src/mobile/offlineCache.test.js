import { clearOutbox, readOutbox, writeOutbox } from './offlineCache';

const platformState = vi.hoisted(() => ({ native: true }));

vi.mock('./platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

const KEY = 'alq:journal-outbox';

const item = (clientId, overrides = {}) => ({
    client_id: clientId,
    request: { client_id: clientId, kind: 'checkin', day: '2026-08-21', payload: { v: 1 } },
    queued_at: 1_755_000_000_000,
    error: null,
    ...overrides
});

beforeEach(() => {
    platformState.native = true;
    window.localStorage.clear();
    vi.restoreAllMocks();
});

describe('the outbox store', () => {
    it('round-trips a queue through the device', () => {
        writeOutbox([item('a'), item('b')]);

        expect(readOutbox().map(row => row.client_id)).toEqual(['a', 'b']);
    });

    it('is empty rather than null when there is nothing queued', () => {
        // Every caller treats the result as a list. `null` would be a second empty case and
        // the one that throws on `.map`.
        expect(readOutbox()).toEqual([]);
    });

    it('removes the key rather than storing an empty list', () => {
        writeOutbox([item('a')]);
        writeOutbox([]);

        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(readOutbox()).toEqual([]);
    });

    it('clears the key outright, which is what a logout does', () => {
        writeOutbox([item('a')]);
        clearOutbox();

        expect(window.localStorage.getItem(KEY)).toBeNull();
    });

    it('never expires a queued entry, however old it is', () => {
        writeOutbox([item('a', { queued_at: 0 })]);

        expect(readOutbox()).toHaveLength(1);
    });

    it('drops a row that could never be posted and keeps the rest', () => {
        window.localStorage.setItem(KEY, JSON.stringify([
            item('a'),
            { client_id: 'b' },
            { request: { kind: 'checkin' } },
            null
        ]));

        expect(readOutbox().map(row => row.client_id)).toEqual(['a']);
    });

    it('survives a store holding something that is not a queue', () => {
        window.localStorage.setItem(KEY, '{ not json');
        expect(readOutbox()).toEqual([]);

        window.localStorage.setItem(KEY, '{"client_id":"a"}');
        expect(readOutbox()).toEqual([]);
    });

    it('does nothing at all on the web', () => {
        platformState.native = false;

        writeOutbox([item('a')]);

        expect(window.localStorage.getItem(KEY)).toBeNull();
        expect(readOutbox()).toEqual([]);
    });

    it('says so rather than throwing when the store refuses a write', () => {
        // The entry is still in memory and will still be posted; what it will not do is
        // survive a relaunch, and that is worth a line in the log.
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => { });
        // On the prototype, not on the instance: jsdom's `localStorage` is a proxy, and a
        // spy installed on the object itself is not the function the module ends up calling.
        const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        expect(() => writeOutbox([item('a')])).not.toThrow();
        expect(quiet).toHaveBeenCalled();

        blocked.mockRestore();
        quiet.mockRestore();
    });
});
