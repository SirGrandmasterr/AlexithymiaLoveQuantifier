import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import Vault, { AI_CLAIM, OUTBOX_CLAIM, SIMILAR_CLAIM, buildCSV, buildJournalCSV, describeBackend } from './Vault';
import { JOURNAL_COPY, JOURNAL_STORAGE_KEYS } from '../constants/journal';
import { MAX_CLIP_MS, SILENCE_HOLD_MS } from '../journal/recorder';
import { IDLE_LIMIT_MS } from './AppLock';
import * as tier from '../journal/inference/tier';
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

        expect(screen.queryByText(/\d+ journal entr/)).not.toBeInTheDocument();
    });

    const claims = async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/Every request goes to this app's own origin/)).toHaveTextContent(
            "Nothing. Every request goes to this app's own origin — you can check that in your "
            + "browser's network tab. There is no analytics, no telemetry, and no third-party "
            + 'script. If you turn on voice check-ins, the speech and language model files are downloaded once, '
            + 'from this same server, and run here.'
        );

        // §4.2's numbers, read off the recorder's own constants rather than retyped.
        expect(screen.getByText(/Only while the record button is lit/)).toHaveTextContent(
            'Only while the record button is lit. There is no wake word, no background capture, '
            + `and recording stops when you tap, after ${Math.round(SILENCE_HOLD_MS / 1000)} seconds `
            + `of silence, or at ${Math.round(MAX_CLIP_MS / 1000)} seconds.`
        );

        expect(screen.getByText(/Passwords are hashed/)).toHaveTextContent(
            'Passwords are hashed, but your notes, scores, and everything in the journal — the words '
            + 'you tapped, what you typed, the people and things you named, your answers to the '
            + 'evening questions, and journal transcripts — are not.'
        );
    };

    /** The `**bold**` markers are formatting, not words; the page renders them as `<strong>`. */
    const plain = (text) => text.replace(/\*\*/g, '');

    it('states every privacy claim verbatim with voice off — the default', async () => {
        await claims();
        expect(screen.getByText(/None are running/)).toHaveTextContent(plain(AI_CLAIM.off));
        expect(screen.queryByText(/Whisper tiny/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Gemma/)).not.toBeInTheDocument();
    });

    /* G1 — the seventh claim */

    it('states the similar-entry answer verbatim with the index off — the default', async () => {
        await claims();

        const answer = document.querySelector('[data-similar-claim]');
        expect(answer).toHaveAttribute('data-similar-claim', 'off');
        expect(answer).toHaveTextContent(plain(SIMILAR_CLAIM.off));
        expect(screen.getByText(/What about the similar-entry suggestions\?/)).toBeInTheDocument();
        // Nothing on the page claims a second model on a device that has not made one number.
        expect(answer.textContent).not.toContain('EmbeddingGemma');
    });

    it('states it verbatim with the index on, naming the model and its terms', async () => {
        vi.stubGlobal('indexedDB', { open: () => ({}) });
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.embeddings, 'true');

        await claims();

        const answer = document.querySelector('[data-similar-claim]');
        expect(answer).toHaveAttribute('data-similar-claim', 'on');
        expect(answer).toHaveTextContent(plain(SIMILAR_CLAIM.on));

        vi.unstubAllGlobals();
    });

    it('names EmbeddingGemma and the Gemma terms rather than Apache, which is §5.6 rule', () => {
        expect(SIMILAR_CLAIM.on).toContain('EmbeddingGemma');
        expect(SIMILAR_CLAIM.on).toContain('Gemma Terms of Use');
        expect(SIMILAR_CLAIM.on).toContain('rather than Apache');
        // The three promises the index has code under: same origin, device-only, cleared.
        expect(SIMILAR_CLAIM.on).toContain('downloaded once from this server');
        expect(SIMILAR_CLAIM.on).toContain('kept only on this device');
        expect(SIMILAR_CLAIM.on).toContain('deleted when you sign out');
    });

    it('says the key is off in the off variant, which is the clause that cannot be in both', () => {
        expect(SIMILAR_CLAIM.off).toContain('it is off until you turn it on');
        expect(SIMILAR_CLAIM.on).not.toContain('it is off until you turn it on');
    });

    it('names search in both variants, because the switch now opens a search screen', () => {
        expect(SIMILAR_CLAIM.off).toContain('cannot be searched');
        expect(SIMILAR_CLAIM.on).toContain('search the journal');
        expect(SIMILAR_CLAIM.on).toContain('asks the server nothing');
        expect(SIMILAR_CLAIM.on).toContain('search finds nothing until this device');
    });

    it('keeps the settings toggle and this page saying the same thing (§9.7)', () => {
        expect(JOURNAL_COPY.settings.embeddings.label).toContain('search');
        expect(JOURNAL_COPY.settings.embeddings.description).toContain('kept only on this device');
        expect(JOURNAL_COPY.settings.embeddings.description).toContain('deleted when you sign out');
    });

    it('states the Full tier "voice on" paragraph verbatim — one model, named, with its licence', async () => {
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.voice, 'true');
        // The page asks the device as well as the key: a `true` alone is not enough, because
        // jsdom cannot record and this page may only describe what is running here.
        vi.spyOn(tier, 'detectTier').mockReturnValue('full');

        await claims();
        expect(screen.getByText(/One model, and it runs on this device/)).toHaveTextContent(plain(AI_CLAIM.on));
        expect(screen.queryByText(/None are running/)).not.toBeInTheDocument();
        // The Light tier's sentence describes two models. A Full-tier device runs one, and
        // saying otherwise would be false in the direction this page exists to get right.
        expect(screen.queryByText(/One small model writes the words down/)).not.toBeInTheDocument();
    });

    it('states the Light tier "voice on" paragraph verbatim — two models, both named', async () => {
        // §5.6 asks the Vault's model line to name every model and every licence. This is
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.voice, 'true');
        vi.spyOn(tier, 'detectTier').mockReturnValue('light');

        await claims();
        expect(screen.getByText(/One small model writes the words down/))
            .toHaveTextContent(plain(AI_CLAIM.onLight));
        expect(screen.queryByText(/None are running/)).not.toBeInTheDocument();
        expect(screen.queryByText(/One model, and it runs on this device/)).not.toBeInTheDocument();
    });

    it('names a licence for every model it names, on both tiers', async () => {
        // the operator's own server needs the licence to travel with them, and the page that
        // names the model is where the user is told which licence that is.
        [AI_CLAIM.on, AI_CLAIM.onLight].forEach((claim) => {
            if (claim.includes('Gemma 4 E2B')) expect(claim).toContain('Apache 2.0');
            if (claim.includes('Whisper tiny')) expect(claim).toContain('Apache 2.0');
        });
        expect(AI_CLAIM.onLight).toContain('Whisper tiny and Gemma 4 E2B');
    });

    it('says a model is not running on a device that could not run one', async () => {
        // The stale-`true` case: another browser on the same profile turned voice on. This
        // page must still say none are running, because none are running *here*.
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.voice, 'true');
        vi.spyOn(tier, 'detectTier').mockReturnValue('text-only');

        await claims();
        expect(screen.getByText(/None are running/)).toBeInTheDocument();
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

/* F1 — the outbox, stated on the page (invariant 2e) */

const platformState = vi.hoisted(() => ({ native: false }));

vi.mock('../mobile/platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

describe('what the page says about the journal outbox', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockFetch();
    });

    afterEach(() => {
        platformState.native = false;
    });

    it('names the exception verbatim on a phone', async () => {
        platformState.native = true;
        renderVault();

        const claim = await screen.findByText(/One exception, on this phone/);
        expect(claim).toHaveTextContent(OUTBOX_CLAIM.replace(/\*\*/g, ''));
    });

    it('claims no such thing in a browser, where there is no queue', async () => {
        renderVault();

        await waitFor(() => expect(screen.getByText(/Everything you have written is stored/)).toBeInTheDocument());
        expect(screen.queryByText(/One exception, on this phone/)).not.toBeInTheDocument();
    });

    it('states the scope, not only the existence', async () => {
        // The three things that make the exception safe to state at all: it is sent once, the
        // analyses are never queued, and a sign-out takes it with them.
        expect(OUTBOX_CLAIM).toContain('sent once when the connection is back');
        expect(OUTBOX_CLAIM).toContain('your analyses are never queued');
        expect(OUTBOX_CLAIM).toContain('signing out clears it');
        // And that it is not encrypted here either, which the section below says of the
        // database and which would otherwise be silently untrue of the device.
        expect(OUTBOX_CLAIM).toContain('plain text');
    });
});

/* Z — the closeout audit of invariant 2e */

describe('every other sentence on the Vault page (invariant 2e, discharged)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockFetch();
    });

    it('says who can see this, and the answer is the per-query user scope', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/Whoever can reach the server/)).toHaveTextContent(
            'Whoever can reach the server it runs on and sign in as you. There are no other '
            + "accounts, no sharing, and no way for one user to see another's analyses."
        );
    });

    it('describes the export as complete, including what Phase 6 added to it', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/A complete copy/)).toHaveTextContent(
            'A complete copy — every relationship, every snapshot, notes, tags, uncertainty '
            + 'flags and guided answers included, and every journal entry with the people it '
            + 'names, the triggers it leans on, and anything you have since corrected.'
        );
    });

    it('promises two CSV sheets and no transcript in them', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/The JSON file is the one that can be imported again/))
            .toHaveTextContent(
                'The JSON file is the one that can be imported again; the CSV is for '
                + 'spreadsheets, and arrives as two sheets when there is a journal to write — '
                + 'one row per snapshot, one row per feeling. What was said stays in the JSON.'
            );
    });

    it('promises an idempotent import, by the id the entry was written with', async () => {
        // True because `applyJournal` matches on `client_id` against rows already scoped to
        // this user, and `minImportVersion` still accepts a v1 file — "the one before it".
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/Import a JSON export/)).toHaveTextContent(
            'Import a JSON export, from this version of the app or the one before it. '
            + 'Snapshots already here are skipped, and a journal entry is matched by the id '
            + 'it was written with, so importing the same file twice changes nothing.'
        );
    });

    it('states the lock\'s scope and its idle limit from the constant that enforces it', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/An optional passphrase/)).toHaveTextContent(
            'An optional passphrase that covers the app on this device, asked for on load '
            + `and after ${IDLE_LIMIT_MS / 60000} minutes idle.`
        );
    });

    it('says the lock is unavailable where the hashing it needs is, and offers no form', async () => {
        const subtle = globalThis.crypto.subtle;
        Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });

        try {
            renderVault();
            await screen.findByText(/SQLite file/);

            expect(screen.getByText(/Unavailable here/)).toHaveTextContent(
                'Unavailable here — the browser only offers the hashing this needs over HTTPS '
                + 'or on localhost.'
            );
            expect(screen.queryByLabelText('New passphrase')).not.toBeInTheDocument();
        } finally {
            Object.defineProperty(globalThis.crypto, 'subtle', { value: subtle, configurable: true });
        }
    });

    it('counts what this browser session actually loaded, and nothing more', async () => {
        renderVault();
        await screen.findByText(/SQLite file/);

        expect(screen.getByText(/loaded in this browser session/)).toHaveTextContent(
            `${subjects.length} snapshots loaded in this browser session.`
        );
    });
});
