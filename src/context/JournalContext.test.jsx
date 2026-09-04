import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import axios from 'axios';
import { SubjectsProvider } from './SubjectsContext';
import { JournalProvider, useJournal, defaultJournalRange } from './JournalContext';
import { JOURNAL_COPY, civilDay, monthBounds } from '../constants/journal';

vi.mock('axios');

const relationships = [
    { ID: 7, name: 'Lucie', snapshot_count: 0 },
    { ID: 8, name: 'Sam', snapshot_count: 1 }
];

const mockFetch = ({
    subjects = [],
    relationships: rels = relationships,
    entries = [],
    days = []
} = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: subjects });
    });
};

/** The journal endpoints fail; the subject list still loads, as it would in life. */
const mockJournalFailure = (error) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: relationships });
        if (url.startsWith('/api/journal')) return Promise.reject(error);
        return Promise.resolve({ data: [] });
    });
};

const checkin = (overrides = {}) => ({
    ID: 11,
    user_id: 1,
    client_id: 'checkin-1',
    kind: 'checkin',
    day: '2026-08-21',
    at: '2026-08-21T16:42:10Z',
    schema_version: 1,
    payload: { v: 1, feelings: [{ id: 'calm' }] },
    superseded_at: null,
    supersedes_id: null,
    mentions: [],
    ...overrides
});

const trigger = (clientId, label, extra = {}) => ({
    ID: Number(String(clientId).replace(/\D/g, '')) || 1,
    client_id: clientId,
    kind: 'trigger',
    day: '2026-08-21',
    at: '2026-08-21T09:00:00Z',
    schema_version: 1,
    payload: { v: 1, label, ...extra },
    mentions: []
});

/** The live context value, captured on every render so a test can call into it. */
let latest = null;

const Probe = () => {
    latest = useJournal();
    return (
        <div>
            <span data-testid="range">{`${latest.range.from}..${latest.range.to}`}</span>
            <span data-testid="entries">{latest.entries.length}</span>
            <span data-testid="error">{latest.loadError ?? ''}</span>
        </div>
    );
};

const renderJournal = (props = {}) => render(
    <SubjectsProvider>
        <JournalProvider {...props}><Probe /></JournalProvider>
    </SubjectsProvider>
);

/** Waits for the first load to settle, whichever way it went. */
const settled = () => waitFor(() => expect(latest.loading).toBe(false));

beforeEach(() => {
    vi.clearAllMocks();
    latest = null;
    mockFetch();
});

describe('useJournal', () => {
    it('throws outside its provider, the way useSubjects does', () => {
        const Orphan = () => {
            useJournal();
            return null;
        };
        // React logs the thrown render error; the assertion is the throw itself.
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => { });

        expect(() => render(<Orphan />)).toThrow(/useJournal must be used inside a JournalProvider/);

        quiet.mockRestore();
    });
});

describe('defaultJournalRange', () => {
    it('is the month the current civil day falls in', () => {
        expect(defaultJournalRange()).toEqual(monthBounds(civilDay()));
    });
});

describe('JournalProvider — loading', () => {
    it('loads entries and days for the default range through the global axios', async () => {
        mockFetch({ entries: [checkin()], days: [{ day: '2026-08-21', checkins: 1, ritual: false, people: 0 }] });

        renderJournal();
        await settled();

        const bounds = monthBounds(civilDay());
        expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', { params: bounds });
        expect(axios.get).toHaveBeenCalledWith('/api/journal/days', { params: bounds });
        expect(screen.getByTestId('entries')).toHaveTextContent('1');
        expect(screen.getByTestId('range')).toHaveTextContent(`${bounds.from}..${bounds.to}`);
    });

    it('never fetches the relationships itself — it reads them from useSubjects', async () => {
        renderJournal();
        await settled();

        // Invariant 17: one fetch, and it belongs to SubjectsProvider. A second copy of the
        // list is the stale-copy bug that context exists to kill.
        const relationshipCalls = axios.get.mock.calls.filter(([url]) => url === '/api/relationships');
        expect(relationshipCalls).toHaveLength(1);
    });

    it('fetches nothing while signed out, and holds nothing', async () => {
        renderJournal({ enabled: false });

        await waitFor(() => expect(latest.loading).toBe(false));
        expect(axios.get).not.toHaveBeenCalledWith('/api/journal/entries', expect.anything());
        expect(latest.entries).toEqual([]);
    });

    it('refetches when loadRange moves the window', async () => {
        renderJournal();
        await settled();

        await act(async () => { latest.loadRange('2026-07-01', '2026-07-31'); });

        await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
            '/api/journal/entries', { params: { from: '2026-07-01', to: '2026-07-31' } }
        ));
        expect(screen.getByTestId('range')).toHaveTextContent('2026-07-01..2026-07-31');
    });

    it('ignores a range that is not one, rather than fetching nonsense', async () => {
        renderJournal();
        await settled();
        const before = axios.get.mock.calls.length;

        await act(async () => {
            latest.loadRange('2026-13-01', '2026-13-31');
            latest.loadRange('2026-08-31', '2026-08-01');
        });

        expect(axios.get.mock.calls).toHaveLength(before);
    });
});

describe('JournalProvider — a load that fails', () => {
    let quiet;

    beforeEach(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => { }); });
    afterEach(() => { quiet.mockRestore(); });

    it('holds a written sentence the screen can render, and does not throw', async () => {
        mockJournalFailure(new Error('network down'));

        renderJournal();

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent(JOURNAL_COPY.day.loadError));
        expect(latest.entries).toEqual([]);
        expect(latest.loading).toBe(false);
    });

    it("prefers the server's own message when there is one", async () => {
        mockJournalFailure({ response: { data: { error: 'to must be YYYY-MM-DD' } } });

        renderJournal();

        await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('to must be YYYY-MM-DD'));
    });

    it('can be dismissed without losing the range', async () => {
        mockJournalFailure(new Error('network down'));
        renderJournal();
        await waitFor(() => expect(latest.loadError).not.toBeNull());

        await act(async () => { latest.dismissLoadError(); });

        expect(latest.loadError).toBeNull();
        expect(latest.range).toEqual(monthBounds(civilDay()));
    });
});

describe('createEntry', () => {
    it('mints a client_id when the caller did not bring one', async () => {
        renderJournal();
        await settled();
        axios.post.mockImplementation((url, body) => Promise.resolve({ data: checkin({ client_id: body.client_id }) }));

        await act(async () => { await latest.createEntry({ kind: 'checkin', day: '2026-08-21' }); });

        const [url, body] = axios.post.mock.calls[0];
        expect(url).toBe('/api/journal/entries');
        expect(body.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(latest.entries).toHaveLength(1);
    });

    it("keeps the caller's client_id, which is what makes a retry idempotent", async () => {
        renderJournal();
        await settled();
        axios.post.mockResolvedValue({ data: checkin({ client_id: 'from-the-outbox' }) });

        await act(async () => {
            await latest.createEntry({ client_id: 'from-the-outbox', kind: 'checkin', day: '2026-08-21' });
        });

        expect(axios.post.mock.calls[0][1].client_id).toBe('from-the-outbox');
    });

    it('draws a replayed post once, not twice', async () => {
        renderJournal();
        await settled();
        axios.post.mockResolvedValue({ data: checkin({ client_id: 'same-id' }) });

        await act(async () => {
            await latest.createEntry({ client_id: 'same-id', kind: 'checkin', day: '2026-08-21' });
            await latest.createEntry({ client_id: 'same-id', kind: 'checkin', day: '2026-08-21' });
        });

        expect(latest.entries).toHaveLength(1);
    });

    it('drops the row a correction replaced, because readers show only what is current', async () => {
        mockFetch({ entries: [checkin({ ID: 11, client_id: 'first' })] });
        renderJournal();
        await settled();
        axios.post.mockResolvedValue({
            data: checkin({ ID: 12, client_id: 'second', supersedes_id: 11 })
        });

        await act(async () => {
            await latest.createEntry({ client_id: 'second', kind: 'checkin', day: '2026-08-21', supersedes_id: 11 });
        });

        expect(latest.entries.map(entry => entry.ID)).toEqual([12]);
    });
});

describe('deleteEntry', () => {
    it('removes the row it deleted', async () => {
        mockFetch({ entries: [checkin({ ID: 11 }), checkin({ ID: 12, client_id: 'checkin-2' })] });
        renderJournal();
        await settled();
        axios.delete.mockResolvedValue({ data: { message: 'Journal entry deleted' } });

        await act(async () => { await latest.deleteEntry(11); });

        expect(axios.delete).toHaveBeenCalledWith('/api/journal/entries/11');
        expect(latest.entries.map(entry => entry.ID)).toEqual([12]);
    });
});

describe('the vocabulary the provider resolves', () => {
    it('answers for a renamed trigger by the id the old check-ins still hold', async () => {
        mockFetch({ entries: [trigger('trig-2', 'the deadline', { corrects: ['trig-1'] })] });
        renderJournal();
        await settled();

        expect(latest.resolveTrigger('trig-1').label).toBe('the deadline');
        expect(latest.resolveTrigger('trig-1').live).toBe('trig-2');
    });

    it('offers only the triggers that have not been merged away', async () => {
        mockFetch({
            entries: [
                trigger('trig-1', 'work', { merged_into: 'trig-2' }),
                trigger('trig-2', 'the deadline')
            ]
        });
        renderJournal();
        await settled();

        expect(latest.triggers.map(row => row.label)).toEqual(['the deadline']);
    });

    it("shows a mention under the relationship's current name, not the name it quoted", async () => {
        renderJournal();
        await settled();

        expect(latest.personName({ relationship_id: 7, label: 'Lucy' })).toBe('Lucie');
    });

    it('falls back to the quoted label when the relationship is gone', async () => {
        renderJournal();
        await settled();

        expect(latest.personName({ relationship_id: null, label: 'Lucie' })).toBe('Lucie');
    });
});

describe('markedDays', () => {
    it('marks a day the counts endpoint reported', async () => {
        mockFetch({ days: [
            { day: '2026-08-19', checkins: 2, ritual: false, people: 1 },
            { day: '2026-08-20', checkins: 0, ritual: true, people: 0 },
            { day: '2026-08-18', checkins: 0, ritual: false, people: 0 }
        ] });
        renderJournal();
        await settled();

        expect([...latest.markedDays].sort()).toEqual(['2026-08-19', '2026-08-20']);
    });

    it('marks a day an entry written since the last fetch landed on', async () => {
        renderJournal();
        await settled();
        axios.post.mockResolvedValue({ data: checkin({ day: '2026-08-21' }) });

        await act(async () => { await latest.createEntry({ kind: 'checkin', day: '2026-08-21' }); });

        expect(latest.markedDays.has('2026-08-21')).toBe(true);
    });

    it('does not mark a day whose only entry is a trigger — vocabulary is not an event', async () => {
        mockFetch({ entries: [trigger('trig-1', 'work')] });
        renderJournal();
        await settled();

        expect(latest.markedDays.has('2026-08-21')).toBe(false);
    });
});

/* F1 — the outbox (§9.5) */

const platformState = vi.hoisted(() => ({ native: false }));

vi.mock('../mobile/platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

const capacitor = vi.hoisted(() => ({ listeners: new Map() }));

vi.mock('@capacitor/app', () => ({
    App: {
        addListener: (event, listener) => {
            const registered = capacitor.listeners.get(event) ?? new Set();
            registered.add(listener);
            capacitor.listeners.set(event, registered);
            return Promise.resolve({ remove: () => registered.delete(listener) });
        }
    }
}));

const OUTBOX_KEY = 'alq:journal-outbox';

/** A transport failure: nothing answered, so nothing can have been stored. */
const offline = () => new Error('Network Error');

/** The server answered, and refused the body. */
const refused = (status, message) => Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: message } }
});

const checkinRequest = (overrides = {}) => ({
    client_id: 'queued-1',
    kind: 'checkin',
    at: '2026-08-21T18:42:10+02:00',
    day: '2026-08-21',
    schema_version: 1,
    payload: { v: 1, source: 'chips', feelings: [{ id: 'calm', intensity: 2, about: [] }] },
    mentions: [],
    triggers: [],
    supersedes_id: null,
    ...overrides
});

/** Queue one entry the way a user in a tunnel does: by saving it and having nothing answer. */
const queueOffline = async (request = checkinRequest()) => {
    axios.post.mockRejectedValue(offline());
    let result;
    await act(async () => { result = await latest.createEntry(request); });
    return result;
};

const postsFor = (clientId) => axios.post.mock.calls.filter(
    ([url, body]) => url === '/api/journal/entries' && body?.client_id === clientId
);

const fireResume = async () => {
    await act(async () => {
        (capacitor.listeners.get('resume') ?? new Set()).forEach(listener => listener());
    });
};

describe('the outbox', () => {
    beforeEach(() => {
        platformState.native = true;
        capacitor.listeners.clear();
        window.localStorage.clear();
        // The provider logs the queued write and the refused one; both are deliberate and
        // neither is what these tests are reading.
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        platformState.native = false;
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('keeps a check-in saved with no connectivity, marked and on the day it belongs to', async () => {
        renderJournal();
        await settled();

        const saved = await queueOffline();

        // The composer closes on this. It has to be a row shaped like an entry, with the day
        // the caller wrote, or the screen cannot follow the save to its day.
        expect(saved.pending).toBe(true);
        expect(saved.day).toBe('2026-08-21');
        expect(saved.ID).toBeUndefined();

        expect(latest.outbox).toHaveLength(1);
        expect(latest.pendingForDay('2026-08-21')).toHaveLength(1);
        expect(latest.pendingForDay('2026-08-20')).toEqual([]);
        // It marks its day in the month strip, because it is the user's record of that day
        // whether or not a server has heard about it yet.
        expect(latest.markedDays.has('2026-08-21')).toBe(true);
        // And it is not in `entries`: that list is what the server holds, and half the app
        // reads it through a row id this entry has not got.
        expect(latest.entries).toHaveLength(0);
    });

    it('is not lost when the app is killed and relaunched', async () => {
        const { unmount } = renderJournal();
        await settled();
        await queueOffline();

        expect(JSON.parse(window.localStorage.getItem(OUTBOX_KEY))).toHaveLength(1);

        unmount();
        // A cold start: a new provider, reading the device rather than remembering anything.
        axios.post.mockRejectedValue(offline());
        renderJournal();
        await settled();

        expect(latest.outbox).toHaveLength(1);
        expect(latest.pendingForDay('2026-08-21')).toHaveLength(1);
        expect(latest.outbox[0].request.payload.feelings[0].id).toBe('calm');
    });

    it('posts once per client_id across a retry, a resume and a pull-to-refresh', async () => {
        renderJournal();
        await settled();
        await queueOffline();

        // The connection is back. Everything below is a *signal*, not a second entry.
        axios.post.mockReset();
        axios.post.mockResolvedValue({ status: 201, data: checkin({ ID: 42, client_id: 'queued-1' }) });

        // 1. A retry — the flush asked for directly.
        await act(async () => { await latest.flushOutbox(); });
        await waitFor(() => expect(latest.outbox).toHaveLength(0));
        expect(latest.entries.map(row => row.ID)).toEqual([42]);
        // 2. `resume`: the phone comes back to the foreground.
        await fireResume();
        // 3. Pull-to-refresh, which is `refresh` and nothing else — the gesture in
        //    `usePullToRefresh` calls exactly this function.
        await act(async () => { await latest.refresh(); });

        expect(postsFor('queued-1')).toHaveLength(1);
        expect(latest.outbox).toEqual([]);
    });

    it('posts on the next successful fetch, without being asked', async () => {
        renderJournal();
        await settled();
        await queueOffline();

        axios.post.mockReset();
        axios.post.mockResolvedValue({ status: 201, data: checkin({ ID: 42, client_id: 'queued-1' }) });

        await act(async () => { await latest.refresh(); });

        await waitFor(() => expect(postsFor('queued-1')).toHaveLength(1));
        expect(latest.outbox).toHaveLength(0);
    });

    it('treats a 200 — already stored — exactly as it treats a 201', async () => {
        renderJournal();
        await settled();
        await queueOffline();

        axios.post.mockReset();
        axios.post.mockResolvedValue({ status: 200, data: checkin({ ID: 42, client_id: 'queued-1' }) });

        await act(async () => { await latest.flushOutbox(); });

        await waitFor(() => expect(latest.outbox).toHaveLength(0));
        expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
        // And the row the server echoed is the one the day now reads, spliced exactly once.
        expect(latest.entries.map(row => row.ID)).toEqual([42]);
    });
});

describe('the outbox — new people, new triggers, and what it will not do', () => {
    beforeEach(() => {
        platformState.native = true;
        capacitor.listeners.clear();
        window.localStorage.clear();
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    afterEach(() => {
        platformState.native = false;
        window.localStorage.clear();
        vi.restoreAllMocks();
    });

    it('posts a new trigger in the same request as the check-in that references it', async () => {
        renderJournal();
        await settled();

        // §7.2's second `triggers[]` shape: a label and a client-minted id, which the server
        // turns into its own row inside the same transaction as the check-in.
        await queueOffline(checkinRequest({
            triggers: [{ label: 'the deadline', client_id: 'trig-new' }],
            payload: {
                v: 1,
                source: 'chips',
                feelings: [{ id: 'irritation', intensity: 2, about: [{ kind: 'trigger', trigger: 'trig-new' }] }]
            }
        }));

        axios.post.mockReset();
        axios.post.mockResolvedValue({ status: 201, data: checkin({ ID: 42, client_id: 'queued-1' }) });

        await act(async () => { await latest.flushOutbox(); });
        await waitFor(() => expect(latest.outbox).toHaveLength(0));

        const posts = axios.post.mock.calls.filter(([url]) => url === '/api/journal/entries');
        expect(posts).toHaveLength(1);
        expect(posts[0][1].triggers).toEqual([{ label: 'the deadline', client_id: 'trig-new' }]);
        expect(posts[0][1].payload.feelings[0].about[0].trigger).toBe('trig-new');

        // And the refetch that follows a minted trigger, for the reason `createEntry` gives:
        // the response echoes the check-in and not the trigger row beside it.
        await waitFor(() => {
            const reads = axios.get.mock.calls.filter(([url]) => url === '/api/journal/entries');
            expect(reads.length).toBeGreaterThan(1);
        });
    });

    it('carries a new person as a name, so the server resolves it when the post lands', async () => {
        renderJournal();
        await settled();

        await queueOffline(checkinRequest({
            mentions: [{ ref: 0, name: 'Noor', label: 'Noor' }]
        }));

        expect(latest.outbox[0].request.mentions[0]).toEqual({ ref: 0, name: 'Noor', label: 'Noor' });
        expect(latest.outbox[0].request.mentions[0].relationship_id).toBeUndefined();
    });

    it('replaces an unsynced entry rather than queueing a second one', async () => {
        renderJournal();
        await settled();

        await queueOffline(checkinRequest({ payload: { v: 1, source: 'typed', note: 'the first words' } }));
        await queueOffline(checkinRequest({ payload: { v: 1, source: 'typed', note: 'what was meant' } }));

        expect(latest.outbox).toHaveLength(1);
        expect(latest.outbox[0].request.payload.note).toBe('what was meant');
        expect(JSON.parse(window.localStorage.getItem(OUTBOX_KEY))).toHaveLength(1);
    });

    it('refuses to queue a correction of an entry the server already holds', async () => {
        renderJournal();
        await settled();
        axios.post.mockRejectedValue(offline());

        // A rename in the Triggers view: `supersedes_id` is a row id, so this is an edit of
        // something stored, and §9.5 says an edit waits for a connection rather than queueing.
        await expect(latest.createEntry({
            client_id: 'rename-1', kind: 'trigger', day: '2026-08-21', supersedes_id: 10
        })).rejects.toThrow('Network Error');

        expect(latest.outbox).toEqual([]);
    });

    it('queues nothing on the web, where a failed save still says so', async () => {
        platformState.native = false;
        renderJournal();
        await settled();
        axios.post.mockRejectedValue(offline());

        await expect(latest.createEntry(checkinRequest())).rejects.toThrow('Network Error');

        expect(latest.outbox).toEqual([]);
        expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    });

    it('keeps an entry the server refused, and stops posting it', async () => {
        renderJournal();
        await settled();
        await queueOffline();

        axios.post.mockReset();
        axios.post.mockRejectedValue(refused(404, 'relationship not found'));

        await act(async () => { await latest.flushOutbox(); });
        await waitFor(() => expect(latest.outbox[0].error).toBe('relationship not found'));

        // Still on the screen and still on the device — the user wrote it, and an app that
        // dropped it silently would be worse than one that says it did not land.
        expect(latest.pendingForDay('2026-08-21')[0].outbox_error).toBe('relationship not found');

        // And not posted again: the server read this body and will read it the same way.
        await act(async () => { await latest.flushOutbox(); });
        await fireResume();
        expect(postsFor('queued-1')).toHaveLength(1);
    });

    it('stops the flush at the first entry that finds no connection, and keeps the rest', async () => {
        renderJournal();
        await settled();
        await queueOffline(checkinRequest({ client_id: 'queued-1' }));
        await queueOffline(checkinRequest({ client_id: 'queued-2' }));

        axios.post.mockReset();
        axios.post.mockRejectedValue(offline());

        await act(async () => { await latest.flushOutbox(); });

        // One attempt, not one per queued row: the second would fail the same way, and both
        // are still here for the next signal.
        expect(axios.post.mock.calls.filter(([url]) => url === '/api/journal/entries')).toHaveLength(1);
        expect(latest.outbox.map(row => row.client_id)).toEqual(['queued-1', 'queued-2']);
    });

    it('is cleared on logout, from memory and from the device', async () => {
        const { rerender } = renderJournal();
        await settled();
        await queueOffline();

        expect(window.localStorage.getItem(OUTBOX_KEY)).not.toBeNull();

        // What `App.jsx` does when the user signs out, and what it now also does when a
        // session dies: the provider is disabled.
        await act(async () => {
            rerender(
                <SubjectsProvider>
                    <JournalProvider enabled={false}><Probe /></JournalProvider>
                </SubjectsProvider>
            );
        });

        expect(latest.outbox).toEqual([]);
        expect(window.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    });
});
