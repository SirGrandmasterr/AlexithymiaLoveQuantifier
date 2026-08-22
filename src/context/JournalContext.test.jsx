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

/**
 * Four endpoints now, and one blanket `mockResolvedValue` would feed the same rows to all of
 * them (trap 10c). The shape is `Vault.test.jsx`'s, extended with the two journal reads.
 */
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
        // Only the correction row is in the list, which is what the server returns: the row
        // it replaced is stamped `superseded_at` and never reaches the client. The survivor
        // speaks for the old id through `corrects`.
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
