import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import Vault, { buildCSV, buildJournalCSV, describeBackend } from './Vault';
import { SubjectsProvider } from '../context/SubjectsContext';

vi.mock('axios');

const meta = {
    db_backend: 'sqlite',
    relationship_count: 2,
    snapshot_count: 5,
    oldest_snapshot_date: '2025-03-04T00:00:00Z',
    journal_entry_count: 11,
    oldest_journal_day: '2026-08-01'
};

const subjects = [
    {
        ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-10T00:00:00Z', kind: 'full',
        stats: { eros: 40, mania: 70 }, uncertain: ['mania'], tags: ['conflict'], description: 'rough month'
    },
    {
        ID: 2, relationship_id: 1, name: 'Alex', date: '2026-02-10T00:00:00Z', kind: 'pulse',
        stats: { eros: 45 }, uncertain: [], tags: [], description: ''
    }
];

const relationships = [{ ID: 1, name: 'Alex', snapshot_count: 2, cadence_days: 30 }];

const mockFetch = (metaResponse = meta) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: relationships });
        if (url === '/api/meta') return Promise.resolve({ data: metaResponse });
        return Promise.resolve({ data: subjects });
    });
};

const renderVault = () => render(
    <MemoryRouter>
        <SubjectsProvider>
            <Vault />
        </SubjectsProvider>
    </MemoryRouter>
);

describe('buildCSV', () => {
    const stacks = [{
        relationship: { ID: 1, name: 'Alex' },
        versions: subjects
    }];

    it('writes one row per snapshot with a column per category', () => {
        const lines = buildCSV(stacks).split('\n');

        expect(lines[0]).toBe(
            'relationship,date,kind,eros,ludus,storge,pragma,mania,agape,selflessness,uncertain,tags,note'
        );
        expect(lines).toHaveLength(3);
    });

    it('leaves a skipped category empty rather than writing a zero', () => {
        const [, first, second] = buildCSV(stacks).split('\n');

        // eros 40, mania 70, everything else skipped — empty cells, not zeros.
        expect(first).toBe('Alex,2026-01-10,full,40,,,,70,,,mania,conflict,rough month');
        // The pulse scored only eros.
        expect(second).toBe('Alex,2026-02-10,pulse,45,,,,,,,,,');
    });

    it('quotes a note containing a comma or a quote', () => {
        const rows = buildCSV([{
            relationship: { ID: 1, name: 'Alex' },
            versions: [{ ID: 1, date: '2026-01-01T00:00:00Z', kind: 'full', stats: {}, description: 'we talked, then "it" happened' }]
        }]).split('\n');

        expect(rows[1]).toContain('"we talked, then ""it"" happened"');
    });

    it('handles an undated snapshot without inventing a date', () => {
        const rows = buildCSV([{
            relationship: { ID: 1, name: 'Alex' },
            versions: [{ ID: 1, date: null, stats: { eros: 10 } }]
        }]).split('\n');

        expect(rows[1]).toBe('Alex,,full,10,,,,,,,,,');
    });
});

describe('buildJournalCSV', () => {
    // The journal half of an export document, in the shape GET /api/export returns it.
    const journal = {
        entries: [
            {
                client_id: 'aaaa-1', kind: 'trigger', day: '2026-08-19',
                at: '2026-08-19T09:00:00Z', payload: { v: 1, label: 'deadline, again' }
            },
            {
                client_id: 'bbbb-1', kind: 'checkin', day: '2026-08-21',
                at: '2026-08-21T16:42:10Z',
                payload: {
                    v: 1, source: 'typed', tags: ['work'],
                    transcript: 'A long day, and Lucie made it better.',
                    feelings: [
                        { id: 'rapport', intensity: 3, uncertain: false, about: [{ kind: 'person', ref: 0 }] },
                        {
                            id: 'stress', intensity: 2, uncertain: true,
                            about: [{ kind: 'trigger', trigger: 'aaaa-1' }, { kind: 'tag', tag: 'conflict' }]
                        }
                    ]
                },
                mentions: [{ relationship: 'Lucie', ref: 0, label: 'Lucie' }]
            },
            {
                // Superseded: replaced by a correction, so it is in the JSON and not the sheet.
                client_id: 'bbbb-0', kind: 'checkin', day: '2026-08-20',
                at: '2026-08-20T10:00:00Z', superseded_at: '2026-08-20T11:00:00Z',
                payload: { v: 1, source: 'chips', feelings: [{ id: 'calm', intensity: 1, uncertain: false }] }
            },
            {
                // A ritual is not a check-in, and has no feelings of its own to write.
                client_id: 'cccc-1', kind: 'ritual', day: '2026-08-21',
                at: '2026-08-21T22:30:00Z', payload: { v: 1, answers: { slept_well: true } }
            }
        ]
    };

    it('writes one row per feeling, and no transcript column', () => {
        const lines = buildJournalCSV(journal).split('\n');

        expect(lines[0]).toBe('day,at,source,feeling,intensity,uncertain,about_kind,about,tags');
        // Two feelings on the one current check-in — the superseded row and the ritual
        // contribute nothing.
        expect(lines).toHaveLength(3);
        expect(buildJournalCSV(journal)).not.toContain('transcript');
        expect(buildJournalCSV(journal)).not.toContain('Lucie made it better');
    });

    it('names the person and resolves the trigger to its label', () => {
        const [, first, second] = buildJournalCSV(journal).split('\n');

        expect(first).toBe('2026-08-21,2026-08-21T16:42:10Z,typed,rapport,3,false,person,Lucie,work');
        // A label with a comma in it is quoted, like any other field.
        expect(second).toBe(
            '2026-08-21,2026-08-21T16:42:10Z,typed,stress,2,true,trigger tag,"deadline, again conflict",work'
        );
    });

    it('leaves an unanswered intensity or uncertainty empty rather than inventing one', () => {
        const rows = buildJournalCSV({
            entries: [{
                client_id: 'bbbb-2', kind: 'checkin', day: '2026-08-22', at: '2026-08-22T08:00:00Z',
                payload: { v: 1, source: 'chips', feelings: [{ id: 'unclear' }] }
            }]
        }).split('\n');

        expect(rows[1]).toBe('2026-08-22,2026-08-22T08:00:00Z,chips,unclear,,,,,');
    });

    it('writes nothing at all when there is no journal to write', () => {
        expect(buildJournalCSV(undefined)).toBe('');
        expect(buildJournalCSV({ entries: [] })).toBe('');
        // A journal of triggers and rituals has no feelings, and so no sheet.
        expect(buildJournalCSV({ entries: [journal.entries[3]] })).toBe('');
    });
});

describe('describeBackend', () => {
    it('says where the data is in plain words', () => {
        expect(describeBackend('sqlite')).toMatch(/SQLite file on the machine/);
        expect(describeBackend('postgres')).toMatch(/PostgreSQL/);
        expect(describeBackend(undefined)).toBe('your database');
    });
});

describe('Vault page', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockFetch();
    });

    it('reports what is stored and where', async () => {
        renderVault();

        expect(await screen.findByText(/SQLite file on the machine running this app/)).toBeInTheDocument();
        expect(screen.getByText(/relationships and/)).toHaveTextContent(
            '2 relationships and 5 snapshots, going back to March 2025.'
        );
    });

    it('counts the journal alongside the snapshots, and dates it from its own day column', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        // "Everything you have written is stored in…" is only true if the count under it
        // includes the journal. The number is every stored row, superseded ones included.
        expect(screen.getByText(/journal entries/)).toHaveTextContent(
            '11 journal entries — check-ins, evening questions, the words you name things after, '
            + 'and anything you have since corrected, going back to August 2026.'
        );
    });

    it('says nothing about a journal that has nothing in it', async () => {
        mockFetch({ ...meta, journal_entry_count: 0, oldest_journal_day: null });
        renderVault();
        await screen.findByText(/SQLite file/);

        // A clause whose count is zero is left out rather than rendered as "0 journal entries".
        // Anchored on the digit: the "Put it back" section says "a journal entry is matched by
        // the id it was written with" and must keep saying it.
        expect(screen.queryByText(/\d+ journal entr/)).not.toBeInTheDocument();
    });

    it('states plainly that nothing is sent anywhere and nothing is encrypted', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        // The two claims that have to stay true of the code as written.
        expect(screen.getByText(/Every request goes to this app's own origin/)).toBeInTheDocument();
        expect(screen.getByText(/anyone with\s+access to the server can read it/)).toBeInTheDocument();
        expect(screen.getByText(/There are none, by design/)).toBeInTheDocument();

        // 6-A stores the journal in the clear like everything else, and the sentence names it
        // in the journal's own words rather than leaving it under "notes" (Phase 6 §6.6). This
        // must not promise encryption later: docs/13 is an unconfirmed option, not a schedule.
        expect(screen.getByText(/Passwords are hashed/)).toHaveTextContent(
            'Passwords are hashed, but your notes, scores, and everything in the journal — the words '
            + 'you tapped, what you typed, the people and things you named, and your answers to the '
            + 'evening questions — are not.'
        );
    });

    it('says "never" until an export has happened', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/Last export: never/)).toBeInTheDocument();
    });

    it('always dry-runs an import before writing, and only writes on confirmation', async () => {
        const exportDocument = { format: 'alq-export', version: 1, relationships: [] };
        axios.post.mockImplementation((url) => Promise.resolve({
            data: url.includes('dry_run')
                ? { dry_run: true, relationships_created: 2, snapshots_created: 31, snapshots_skipped: 16 }
                : { dry_run: false, relationships_created: 2, snapshots_created: 31, snapshots_skipped: 16 }
        }));

        renderVault();
        await screen.findByText(/SQLite file/);

        const file = new File([JSON.stringify(exportDocument)], 'export.json', { type: 'application/json' });
        await userEvent.upload(screen.getByLabelText('Choose an export file'), file);

        // The preview is the dry run, and it says nothing has been written yet.
        expect(await screen.findByText(/Would create 2 relationships and 31 snapshots; skip 16 already here\./))
            .toBeInTheDocument();
        expect(screen.getByText('Nothing has been written yet.')).toBeInTheDocument();
        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(axios.post).toHaveBeenCalledWith('/api/import?dry_run=true', exportDocument);

        await userEvent.click(screen.getByRole('button', { name: 'Import' }));

        await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/import', exportDocument));
        expect(await screen.findByRole('alert')).toHaveTextContent(/Imported 31 snapshots into 2 new relationships/);
    });

    it('refuses a file it cannot read without touching the server twice', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        const file = new File(['this is not json'], 'notes.txt', { type: 'application/json' });
        await userEvent.upload(screen.getByLabelText('Choose an export file'), file);

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not be read as an export/);
        expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();
    });

    it('is honest that the lock does not encrypt anything', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/It does not encrypt the database/)).toBeInTheDocument();
        expect(screen.getByText(/There is no recovery/)).toBeInTheDocument();
    });
});
