import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import ProposalCard from '../../components/ProposalCard';
import JournalSearch from '../../components/JournalSearch';
import { DiscretionProvider } from '../../context/DiscretionContext';
import { SubjectsProvider } from '../../context/SubjectsContext';
import { JournalProvider } from '../../context/JournalContext';
import { EmbeddingProvider } from './EmbeddingContext';
import { JOURNAL_COPY, feelingById, fillCopy } from '../../constants/journal';
import { createFakeEmbedder, vectorPair } from './embed.fake';
import { useSubjects } from '../../context/SubjectsContext';
import { useJournal } from '../../context/JournalContext';
import { VECTOR_KEY } from './store';

vi.mock('axios');

const relationships = [
    { ID: 5, name: 'Lucie', snapshot_count: 1 },
    { ID: 7, name: 'Alex Weber', snapshot_count: 0 },
    { ID: 8, name: 'Alex Berger', snapshot_count: 0 }
];

const WORK_ID = '0b7e4c1a-5d2a-4f0c-9e2f-7f3a8c1d4b6e';

/** The sentence in front of the user, and a past entry the model thinks it is like. */
const [NOW_VECTOR, PAST_VECTOR] = vectorPair('long-day', 0.94);
/** Which Alex this sentence sounds like: the one on the climbing wall. */
const [CLIMB_QUERY, CLIMB_ENTRY] = vectorPair('climbing', 0.95);

const memoryBackend = () => {
    const rows = new Map();
    return {
        rows,
        getAll: async () => [...rows.values()],
        putMany: async (items) => { items.forEach(item => rows.set(item[VECTOR_KEY], item)); },
        deleteMany: async (ids) => { ids.forEach(id => rows.delete(id)); },
        clear: async () => { rows.clear(); }
    };
};

const triggerRow = () => ({
    ID: 1, client_id: WORK_ID, kind: 'trigger', day: '2026-06-01', at: '2026-06-01T09:00:00Z',
    schema_version: 1, payload: { v: 1, label: 'work' }, mentions: []
});

const past = ({ rowId, clientId, day, transcript, feelings, triggers = [], relationshipId = null, label = 'Lucie' }) => ({
    ID: rowId,
    client_id: clientId,
    kind: 'checkin',
    day,
    at: `${day}T18:00:00Z`,
    schema_version: 1,
    payload: {
        v: 1,
        source: 'voice',
        transcript,
        transcript_kept: true,
        language: 'de',
        feelings: feelings.map(id => ({
            id,
            intensity: 2,
            about: [
                ...triggers.map(trigger => ({ kind: 'trigger', trigger })),
                ...(relationshipId ? [{ kind: 'person', ref: 0 }] : [])
            ]
        }))
    },
    mentions: relationshipId ? [{ relationship_id: relationshipId, ref: 0, label }] : []
});

const mockFetch = (entries, snapshots = []) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: relationships });
        if (url === '/api/subjects') return Promise.resolve({ data: snapshots });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
    });
};

const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 99, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

const WhenLoaded = ({ children }) => {
    const { relationships: loaded } = useSubjects();
    const { triggers, loading } = useJournal();
    if (loaded.length === 0 || loading) return null;
    return typeof children === 'function' ? children({ triggers }) : children;
};

const wrap = (children, { runtime, enabled = true, backend = memoryBackend(), gated = false }) => (
    <MemoryRouter initialEntries={['/journal/search']}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <EmbeddingProvider enabled={enabled} runtime={runtime} backend={backend}>
                        {gated ? <WhenLoaded>{children}</WhenLoaded> : children}
                    </EmbeddingProvider>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
});

/* 1. "Words you chose before" — §5.8's second use */

describe('the past-entry chips', () => {
    const transcript = 'Wieder ein langer Tag, und ich bin ziemlich durch.';

    const entries = [
        triggerRow(),
        past({
            rowId: 2, clientId: 'past-1', day: '2026-06-02',
            transcript: 'Der Tag im Büro war lang.',
            feelings: ['tiredness', 'stress'], triggers: [WORK_ID], relationshipId: 5
        }),
        past({
            rowId: 3, clientId: 'past-2', day: '2026-06-09',
            transcript: 'Noch ein langer Tag im Büro.',
            feelings: ['tiredness'], triggers: [WORK_ID], relationshipId: 5
        })
    ];

    /** The model proposed one word; the check-in names *work*, which the past entries do too. */
    const proposal = {
        transcript,
        language: 'de',
        feelings: [{ id: 'irritation', intensity: 2, about: [{ kind: 'trigger', label: 'work' }] }],
        people: [],
        facts: [],
        ambiguity: 'none'
    };

    const embedder = () => createFakeEmbedder({
        model: 'google/embeddinggemma-300m',
        vectors: {
            [transcript]: NOW_VECTOR,
            'Lucie · Der Tag im Büro war lang. · work': PAST_VECTOR,
            'Lucie · Noch ein langer Tag im Büro. · work': PAST_VECTOR
        }
    });

    const renderCard = async ({ enabled = true, onSave = vi.fn() } = {}) => {
        mockFetch(entries);
        echoPost();

        render(wrap(
            <ProposalCard
                result={{ ok: true, proposal, provenance: { dropped_by_filter: 0 }, runtime: 'web' }}
                context={{}}
                runtime={null}
                source={{ model: 'gemma', promptVersion: 1 }}
                onSave={onSave}
                onDiscard={vi.fn()}
                onRerecord={vi.fn()}
                onChips={vi.fn()}
            />,
            { runtime: embedder(), enabled, gated: true }
        ));

        return { onSave };
    };

    it('offers the words the user chose on entries that share a trigger', async () => {
        await renderCard();

        const group = await screen.findByText(JOURNAL_COPY.similar.past.heading);
        expect(group).toBeInTheDocument();

        await waitFor(() => {
            expect(document.querySelector('[data-past-feeling="tiredness"]')).not.toBeNull();
        });
    });

    it('draws them dashed, and pre-confirms nothing', async () => {
        await renderCard();

        const chip = await waitFor(() => {
            const found = document.querySelector('[data-past-feeling="tiredness"]');
            expect(found).not.toBeNull();
            return found;
        });

        expect(chip.className).toContain('border-dashed');
        // A word that is only offered is not a word on the card.
        expect(document.querySelector('[data-proposed="tiredness"]')).toBeNull();
    });

    it('carries `from: "retrieval"` and the ids of the entries it was read from', async () => {
        await renderCard();

        const chip = await waitFor(() => {
            const found = document.querySelector('[data-past-feeling="tiredness"]');
            expect(found).not.toBeNull();
            return found;
        });

        expect(chip.getAttribute('data-retrieval-from')).toBe('retrieval');
        const ids = chip.getAttribute('data-retrieval-entries').split(' ').sort();
        expect(ids).toEqual(['past-1', 'past-2']);
    });

    it('records a kept word as `from: "retrieval"` in the provenance, with those ids', async () => {
        const onSave = vi.fn().mockResolvedValue({ day: '2026-08-21' });
        await renderCard({ onSave });

        const chip = await waitFor(() => {
            const found = document.querySelector('[data-past-feeling="tiredness"]');
            expect(found).not.toBeNull();
            return found;
        });

        await userEvent.click(chip);
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const body = onSave.mock.calls[0][0];

        expect(body.payload.retrieval.from).toBe('retrieval');
        expect(body.payload.retrieval.accepted.feelings).toContain('tiredness');
        const offered = body.payload.retrieval.offered.feelings.find(row => row.id === 'tiredness');
        expect([...offered.entries].sort()).toEqual(['past-1', 'past-2']);

        expect(body.payload.proposal.proposed).toEqual(['irritation']);
        expect(body.payload.proposal.accepted).toContain('tiredness');
        expect(body.payload.proposal.accepted).not.toContain('irritation');
    });

    it('writes nothing about retrieval when nothing was kept but something was offered', async () => {
        const onSave = vi.fn().mockResolvedValue({ day: '2026-08-21' });
        await renderCard({ onSave });

        await waitFor(() => {
            expect(document.querySelector('[data-past-feeling="tiredness"]')).not.toBeNull();
        });

        // Keep only what the model proposed, and save.
        await userEvent.click(screen.getByRole('button', {
            name: fillCopy(JOURNAL_COPY.proposal.keep, { label: feelingById('irritation').label })
        }));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const body = onSave.mock.calls[0][0];

        expect(body.payload.retrieval.accepted.feelings).toEqual([]);
        expect(body.payload.feelings.map(feeling => feeling.id)).toEqual(['irritation']);
    });

    it('offers nothing at all with the index off, and writes no retrieval key', async () => {
        const onSave = vi.fn().mockResolvedValue({ day: '2026-08-21' });
        await renderCard({ enabled: false, onSave });

        await screen.findByRole('button', { name: JOURNAL_COPY.proposal.save });
        expect(screen.queryByText(JOURNAL_COPY.similar.past.heading)).toBeNull();

        await userEvent.click(screen.getByRole('button', {
            name: fillCopy(JOURNAL_COPY.proposal.keep, { label: feelingById('irritation').label })
        }));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(onSave).toHaveBeenCalled());
        expect(onSave.mock.calls[0][0].payload).not.toHaveProperty('retrieval');
    });

    it('sends no vector anywhere on the path that writes', async () => {
        const onSave = vi.fn().mockResolvedValue({ day: '2026-08-21' });
        await renderCard({ onSave });

        const chip = await waitFor(() => {
            const found = document.querySelector('[data-past-feeling="tiredness"]');
            expect(found).not.toBeNull();
            return found;
        });
        await userEvent.click(chip);
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));
        await waitFor(() => expect(onSave).toHaveBeenCalled());

        const body = JSON.stringify(onSave.mock.calls[0][0]);
        expect(body).not.toMatch(/"vector"|"embedding"|"dims"/);
        // A run of sixteen or more numbers is what a leaked vector looks like.
        expect(body).not.toMatch(/(-?\d+\.\d+,\s*){16,}/);
    });
});

/* 2. Recall — §5.8's third use */

describe('search', () => {
    const entries = [
        triggerRow(),
        past({
            rowId: 2, clientId: 'de-1', day: '2026-03-02',
            transcript: 'Der Tag im Büro war wieder lang, und ich bin völlig erschöpft.',
            feelings: ['stress'], triggers: [WORK_ID]
        }),
        past({
            rowId: 3, clientId: 'en-1', day: '2026-03-03',
            transcript: 'Another long day at the office, and I came home with nothing left.',
            feelings: ['stress'], triggers: [WORK_ID]
        }),
        past({
            rowId: 4, clientId: 'de-2', day: '2026-04-12',
            transcript: 'Beim Fußball im Park war ich zum ersten Mal seit Wochen gelöst.',
            feelings: ['pleasure']
        })
    ];

    const snapshots = [
        { ID: 3, relationship_id: 5, name: 'Lucie', date: '2026-05-01', description: 'Ruhiger Monat, viel gemeinsam gekocht.', tags: [] }
    ];

    const renderSearch = ({ enabled = true } = {}) => {
        mockFetch(entries, snapshots);
        render(wrap(<JournalSearch />, { runtime: createFakeEmbedder(), enabled }));
    };

    const type = async (text) => {
        const box = await screen.findByLabelText(JOURNAL_COPY.similar.search.label);
        await userEvent.type(box, text);
        return box;
    };

    it('finds an entry by a German phrase, umlaut typed or not', async () => {
        renderSearch();
        await type('Buro');

        await waitFor(() => {
            expect(document.querySelector('[data-search-result="de-1"]')).not.toBeNull();
        });
        expect(document.querySelector('[data-search-result="en-1"]')).toBeNull();
    });

    it('finds an entry by an English phrase over the same index', async () => {
        renderSearch();
        await type('office');

        await waitFor(() => {
            expect(document.querySelector('[data-search-result="en-1"]')).not.toBeNull();
        });
        expect(document.querySelector('[data-search-result="de-1"]')).toBeNull();
    });

    it('finds a German compound and a ß by their folded forms', async () => {
        renderSearch();
        await type('Fussball');

        await waitFor(() => {
            expect(document.querySelector('[data-search-result="de-2"]')).not.toBeNull();
        });
    });

    it('searches snapshot notes as well as entries', async () => {
        renderSearch();
        await type('gemeinsam gekocht');

        await waitFor(() => {
            expect(document.querySelector('[data-search-result="snapshot:3"]')).not.toBeNull();
        });
    });

    it('answers with entries and never with prose about them', async () => {
        renderSearch();
        await type('Buro');

        const result = await waitFor(() => {
            const found = document.querySelector('[data-search-result="de-1"]');
            expect(found).not.toBeNull();
            return found;
        });

        // The row is the day, the time, the user's own words, and the words they filed it
        // under — a link to that day and nothing that interprets it.
        expect(within(result).getByText('2026-03-02')).toBeInTheDocument();
        expect(result.textContent).toContain('Der Tag im Büro war wieder lang');
        expect(result.querySelector('a').getAttribute('href')).toBe('/journal/2026-03-02');
    });

    it('shows no number anywhere on the screen', async () => {
        renderSearch();
        await type('Buro');

        await waitFor(() => {
            expect(document.querySelector('[data-search-result="de-1"]')).not.toBeNull();
        });

        // The days and the times are dates, which are what the rows are *for*; nothing else
        // on the screen may carry a digit. Everything the app says here is walked.
        const said = [
            ...document.querySelectorAll('h1, h2, label, [data-search-prompt], [data-search-empty]')
        ].map(node => node.textContent);

        said.forEach(text => expect(text).not.toMatch(/[0-9]/));
        expect(document.body.textContent).not.toMatch(/%|match|score/i);
    });

    it('stops working when the index is gone: the screen says so and names the switch', async () => {
        const store = globalThis.indexedDB;
        globalThis.indexedDB = {};

        try {
            renderSearch({ enabled: false });

            await waitFor(() => expect(document.querySelector('[data-search-off]')).not.toBeNull());
            expect(document.querySelector('[data-search-off]').textContent)
                .toBe(JOURNAL_COPY.similar.search.off);
            expect(screen.queryByLabelText(JOURNAL_COPY.similar.search.label)).toBeNull();
        } finally {
            globalThis.indexedDB = store;
        }
    });

    it('says why on a device that could not keep an index at all', async () => {
        renderSearch({ enabled: false });

        await waitFor(() => expect(document.querySelector('[data-search-off]')).not.toBeNull());
        expect(document.querySelector('[data-search-off]').textContent)
            .toBe(JOURNAL_COPY.similar.search.unavailable);
    });

    it('says nothing was found rather than inventing something', async () => {
        renderSearch();
        await type('Kletterwand');

        await waitFor(() => {
            expect(document.querySelector('[data-search-empty]')).not.toBeNull();
        });
        expect(document.querySelector('[data-search-empty]').textContent)
            .toBe(JOURNAL_COPY.similar.search.empty);
    });

    it('makes no request of its own — search is entirely on this device', async () => {
        renderSearch();
        await type('Buro');
        await waitFor(() => {
            expect(document.querySelector('[data-search-result="de-1"]')).not.toBeNull();
        });

        expect(axios.post).not.toHaveBeenCalled();
        const urls = axios.get.mock.calls.map(call => call[0]);
        urls.forEach(url => expect(url).not.toMatch(/search|vector|embed/i));
    });
});

/* 3. Namesakes — §5.8's fifth use */

describe('namesake candidates', () => {
    const transcript = 'Mit Alex an der Kletterwand, dreimal probiert und dann saß es.';

    const entries = [
        past({
            rowId: 2, clientId: 'desk', day: '2026-05-03',
            transcript: 'Alex hat den Bericht ohne ein Wort umgeschrieben.',
            feelings: ['irritation'], relationshipId: 7, label: 'Alex'
        }),
        past({
            rowId: 3, clientId: 'wall', day: '2026-05-09',
            transcript: 'Mit Alex an der Kletterwand gewesen.',
            feelings: ['joy'], relationshipId: 8, label: 'Alex'
        })
    ];

    /** *Alex* matches neither name exactly, so §4.5 offers both as prefix candidates. */
    const proposal = {
        transcript,
        language: 'de',
        feelings: [{ id: 'joy', intensity: 2, about: [{ kind: 'person', name: 'Alex' }] }],
        people: [{ name: 'Alex' }],
        facts: [],
        ambiguity: 'none'
    };

    const embedder = () => createFakeEmbedder({
        model: 'google/embeddinggemma-300m',
        vectors: {
            [transcript]: CLIMB_QUERY,
            'Alex Berger · Mit Alex an der Kletterwand gewesen.': CLIMB_ENTRY
        }
    });

    const renderCard = async ({ enabled = true, onSave = vi.fn() } = {}) => {
        mockFetch(entries);
        echoPost();

        render(wrap(
            <ProposalCard
                result={{ ok: true, proposal, provenance: { dropped_by_filter: 0 }, runtime: 'web' }}
                context={{}}
                runtime={null}
                source={{ model: 'gemma', promptVersion: 1 }}
                onSave={onSave}
                onDiscard={vi.fn()}
                onRerecord={vi.fn()}
                onChips={vi.fn()}
            />,
            { runtime: embedder(), enabled, gated: true }
        ));
        return { onSave };
    };

    const candidateIds = () => [...document.querySelectorAll('[data-person-candidate]')]
        .map(node => Number(node.getAttribute('data-person-candidate')));

    it('leaves §4.5\'s order alone with the index off', async () => {
        await renderCard({ enabled: false });
        await waitFor(() => expect(candidateIds()).toEqual([7, 8]));
        expect(document.querySelector('[data-namesake-note]')).toBeNull();
    });

    it('changes the order when the sentence sounds like one of them', async () => {
        await renderCard();
        await waitFor(() => expect(candidateIds()).toEqual([8, 7]));
    });

    it('says out loud that it is an order and not a choice', async () => {
        await renderCard();
        await waitFor(() => expect(document.querySelector('[data-namesake-note]')).not.toBeNull());
        expect(document.querySelector('[data-namesake-note]').textContent)
            .toBe(JOURNAL_COPY.similar.namesake);
    });

    it('never selects one: the person is unresolved until a tap, and the body says so', async () => {
        const onSave = vi.fn().mockResolvedValue({ day: '2026-08-21' });
        await renderCard({ onSave });
        await waitFor(() => expect(candidateIds()).toEqual([8, 7]));

        // Both candidates are still on offer and the row is still dashed.
        expect(document.querySelector('[data-person-confirmed="false"]')).not.toBeNull();
        expect(candidateIds()).toHaveLength(2);

        // Keep the feeling and save without touching the picker: the person the ordering
        // put first is in nothing that was written.
        await userEvent.click(screen.getByRole('button', {
            name: fillCopy(JOURNAL_COPY.proposal.keep, { label: feelingById('joy').label })
        }));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(onSave).toHaveBeenCalled());
        const body = onSave.mock.calls[0][0];
        expect(body.mentions ?? []).toEqual([]);
        expect(JSON.stringify(body)).not.toContain('"relationship_id"');
    });
});
