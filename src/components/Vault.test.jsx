import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import Vault, { buildCSV, describeBackend } from './Vault';
import { SubjectsProvider } from '../context/SubjectsContext';

vi.mock('axios');

const meta = {
    db_backend: 'sqlite',
    relationship_count: 2,
    snapshot_count: 5,
    oldest_snapshot_date: '2025-03-04T00:00:00Z'
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

const mockFetch = () => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: relationships });
        if (url === '/api/meta') return Promise.resolve({ data: meta });
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
        expect(screen.getByText(/going back to/)).toBeInTheDocument();
    });

    it('states plainly that nothing is sent anywhere and nothing is encrypted', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        // The two claims that have to stay true of the code as written.
        expect(screen.getByText(/Every request goes to this app's own origin/)).toBeInTheDocument();
        expect(screen.getByText(/anyone with\s+access to the server can read it/)).toBeInTheDocument();
        expect(screen.getByText(/There are none, by design/)).toBeInTheDocument();
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
