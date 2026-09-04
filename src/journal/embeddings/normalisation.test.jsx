import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import CheckinComposer from '../../components/CheckinComposer';
import JournalTriggers from '../../components/JournalTriggers';
import { DiscretionProvider } from '../../context/DiscretionContext';
import { SubjectsProvider } from '../../context/SubjectsContext';
import { JournalProvider } from '../../context/JournalContext';
import { EmbeddingProvider } from './EmbeddingContext';
import { JOURNAL_COPY, fillCopy } from '../../constants/journal';
import { buildContext } from '../inference';
import { fakeKit, clip } from '../../components/voiceKit.fake';
import { createFakeEmbedder, vectorPair } from './embed.fake';
import { VECTOR_KEY } from './store';

vi.mock('axios');

const TODAY = '2026-08-21';
const WORK_ID = '0b7e4c1a-5d2a-4f0c-9e2f-7f3a8c1d4b6e';
const MONEY_ID = '73c0f1fe-04f9-4a3a-8fb3-319c0671b6cf';

const relationships = [
    { ID: 5, name: 'Lucie', snapshot_count: 1 },
    { ID: 9, name: 'Alex', snapshot_count: 0 }
];

/** The model thinks these two are nearly the same words; it thinks nothing of the third. */
const [WORK_VECTOR, MY_JOB_VECTOR] = vectorPair('work/my-job', 0.93);

const embedder = () => createFakeEmbedder({
    model: 'google/embeddinggemma-300m',
    vectors: { work: WORK_VECTOR, 'my job': MY_JOB_VECTOR, money: MONEY_VECTOR }
});

const MONEY_VECTOR = vectorPair('money', 0.1)[0];

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

const triggerRow = ({ id, label, rowId }) => ({
    ID: rowId,
    client_id: id,
    kind: 'trigger',
    day: '2026-06-01',
    at: '2026-06-01T09:00:00Z',
    schema_version: 1,
    payload: { v: 1, label },
    mentions: []
});

/** A past check-in that names a trigger, and the person it was about. */
const pastCheckin = ({ rowId, triggers, relationshipId = 5, day = '2026-06-02' }) => ({
    ID: rowId,
    client_id: `checkin-${rowId}`,
    kind: 'checkin',
    day,
    at: `${day}T18:00:00Z`,
    schema_version: 1,
    payload: {
        v: 1,
        source: 'chips',
        feelings: [{
            id: 'tired',
            about: [
                ...triggers.map(id => ({ kind: 'trigger', trigger: id })),
                ...(relationshipId ? [{ kind: 'person', ref: 0 }] : [])
            ]
        }]
    },
    mentions: relationshipId ? [{ relationship_id: relationshipId, ref: 0, label: 'Lucie' }] : []
});

const mockFetch = (entries) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: relationships });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
    });
};

const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 99, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

/** *"my job, about Lucie"* — a label §4.5b step 1 finds no exact trigger for. */
const myJobProposal = {
    transcript: 'Long day with the job again, and Lucie noticed.',
    language: 'en',
    feelings: [{
        id: 'tiredness',
        intensity: 2,
        about: [{ kind: 'trigger', label: 'my job' }, { kind: 'person', name: 'Lucie' }]
    }],
    people: [{ name: 'Lucie' }],
    facts: [],
    ambiguity: 'none'
};

const renderCard = async ({ entries, runtime }) => {
    mockFetch(entries);
    echoPost();
    const kit = fakeKit({ fixtures: myJobProposal });
    const context = buildContext({ relationships, triggers: [] });

    render(
        <MemoryRouter initialEntries={['/journal']}>
            <DiscretionProvider>
                <SubjectsProvider>
                    <JournalProvider>
                        <EmbeddingProvider enabled runtime={runtime} backend={memoryBackend()}>
                            <CheckinComposer
                                mode="voice"
                                voiceKit={kit}
                                context={context}
                                onClose={vi.fn()}
                                onSaved={vi.fn()}
                            />
                        </EmbeddingProvider>
                    </JournalProvider>
                </SubjectsProvider>
            </DiscretionProvider>
        </MemoryRouter>
    );

    await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', expect.anything()));
    await act(async () => { });
    act(() => kit.recorder.landTake([clip('clip-1')]));
    await waitFor(() => expect(document.querySelector('[data-proposal-card]')).toBeInTheDocument());
};

/** The history that makes *work* a witnessed candidate: it and Lucie, twice. */
const withWorkHistory = () => [
    triggerRow({ id: WORK_ID, label: 'work', rowId: 10 }),
    pastCheckin({ rowId: 11, triggers: [WORK_ID], relationshipId: 5, day: '2026-06-02' }),
    pastCheckin({ rowId: 12, triggers: [WORK_ID], relationshipId: 5, day: '2026-06-09' })
];

const offerButton = () => document.querySelector(`[data-similar-trigger="${WORK_ID}"]`);
const newTriggerChip = () => screen.queryByText(fillCopy(JOURNAL_COPY.triggers.newTrigger, { label: 'my job' }));

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
});

describe('the card offers a word the user already has', () => {
    it('says "you have called this work before" beside the new trigger, not instead of it', async () => {
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });

        await waitFor(() => expect(offerButton()).toBeInTheDocument());
        expect(offerButton()).toHaveTextContent(fillCopy(JOURNAL_COPY.similar.offer, { label: 'work' }));

        // §5.8's "beside, never instead of": the dashed *new trigger: my job?* chip is still
        // exactly where it was, and its own tap still mints its own id.
        expect(newTriggerChip()).toBeInTheDocument();
    });

    it('shows no number anywhere in what it says', async () => {
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        const strip = document.querySelector('[data-similar-triggers]');
        expect(strip.textContent).not.toMatch(/[0-9]/);
    });

    it('offers nothing when the same words have no person or trigger in common (rule 3)', async () => {
        // Identical vocabulary and identical vectors; the only difference is that the past
        // *work* check-ins were about Alex and this one is about Lucie.
        const entries = [
            triggerRow({ id: WORK_ID, label: 'work', rowId: 10 }),
            pastCheckin({ rowId: 11, triggers: [WORK_ID], relationshipId: 9, day: '2026-06-02' })
        ];
        await renderCard({ entries, runtime: embedder() });

        await act(async () => { });
        expect(document.querySelector('[data-similar-triggers]')).toBeNull();
        expect(newTriggerChip()).toBeInTheDocument();
    });

    it('offers nothing at all with the index turned off, which is every device by default', async () => {
        mockFetch(withWorkHistory());
        echoPost();
        const kit = fakeKit({ fixtures: myJobProposal });

        render(
            <MemoryRouter initialEntries={['/journal']}>
                <DiscretionProvider>
                    <SubjectsProvider>
                        <JournalProvider>
                            <CheckinComposer
                                mode="voice"
                                voiceKit={kit}
                                context={buildContext({ relationships, triggers: [] })}
                                onClose={vi.fn()}
                                onSaved={vi.fn()}
                            />
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </MemoryRouter>
        );

        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', expect.anything()));
        await act(async () => { });
        act(() => kit.recorder.landTake([clip('clip-1')]));
        await waitFor(() => expect(document.querySelector('[data-proposal-card]')).toBeInTheDocument());
        await act(async () => { });

        expect(document.querySelector('[data-similar-triggers]')).toBeNull();
        expect(newTriggerChip()).toBeInTheDocument();
    });
});

describe('declining the offer', () => {
    it('leaves the new trigger, and saving mints it exactly as it would have without the index', async () => {
        const user = userEvent.setup();
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        // Declining is doing nothing: keep the feeling, keep the new trigger, save.
        await user.click(document.querySelector('[data-feeling-toggle="tiredness"]'));
        await user.click(document.querySelector('[data-trigger-keep]'));
        await user.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const [, body] = axios.post.mock.calls.find(([url]) => url === '/api/journal/entries');

        // A brand-new trigger row travels with the check-in, and it is not `work`.
        expect(body.triggers).toHaveLength(1);
        expect(body.triggers[0].label).toBe('my job');
        expect(body.triggers[0].client_id).not.toBe(WORK_ID);
    });
});

describe('accepting the offer', () => {
    it('references the trigger the user already has, and mints nothing', async () => {
        const user = userEvent.setup();
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        await user.click(document.querySelector('[data-feeling-toggle="tiredness"]'));
        await user.click(offerButton());
        await user.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const [, body] = axios.post.mock.calls.find(([url]) => url === '/api/journal/entries');

        // §7.2's two shapes: `{ label, client_id }` mints a row, `{ trigger }` references one
        // the server already has. Accepting the offer must only ever produce the second.
        expect(body.triggers).toEqual([{ trigger: WORK_ID }]);
        expect(body.triggers.some(row => row.label || row.client_id)).toBe(false);

        const about = body.payload.feelings[0].about.find(entry => entry.kind === 'trigger');
        expect(about.trigger).toBe(WORK_ID);
    });

    it('merges nothing: no trigger row is corrected and no `merged_into` is written', async () => {
        const user = userEvent.setup();
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        await user.click(document.querySelector('[data-feeling-toggle="tiredness"]'));
        await user.click(offerButton());
        await user.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        axios.post.mock.calls.forEach(([, body]) => {
            expect(body.supersedes_id ?? null).toBeNull();
            expect(JSON.stringify(body)).not.toContain('merged_into');
            expect(JSON.stringify(body)).not.toContain('corrects');
        });
    });

    it('takes the tap and only the tap — nothing is written before it', async () => {
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        // The offer has been on screen through a full render pass and a sync of the index.
        await act(async () => { });
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.delete).not.toHaveBeenCalled();
    });
});

/* Rule 1: nothing in the index reaches a request body */

const vectorShaped = (value, path = '') => {
    if (ArrayBuffer.isView(value)) return [`${path}: a typed array`];
    if (Array.isArray(value)) {
        if (value.length >= 16 && value.every(item => typeof item === 'number')) {
            return [`${path}: ${value.length} numbers`];
        }
        return value.flatMap((item, at) => vectorShaped(item, `${path}[${at}]`));
    }
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => {
            const here = path ? `${path}.${key}` : key;
            if (['vector', 'embedding', 'embeddings', 'dims', VECTOR_KEY].includes(key)) {
                return [`${here}: an index field`];
            }
            return vectorShaped(item, here);
        });
    }
    return [];
};

describe('rule 1 — vectors live on the device and nowhere else', () => {
    it('catches a vector-shaped body, so the assertions below mean something', () => {
        expect(vectorShaped({ payload: { vector: [1, 2] } })).toHaveLength(1);
        expect(vectorShaped({ q: Array.from({ length: 256 }, () => 0.1) })).toHaveLength(1);
        expect(vectorShaped({ q: new Float32Array(4) })).toHaveLength(1);
        // ...and passes a real check-in body.
        expect(vectorShaped({
            client_id: 'a', kind: 'checkin', day: TODAY,
            payload: { v: 1, feelings: [{ id: 'tired', intensity: 2, about: [] }] }
        })).toEqual([]);
    });

    it('puts none in the body of a check-in that accepted a suggestion', async () => {
        const user = userEvent.setup();
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        await user.click(document.querySelector('[data-feeling-toggle="tiredness"]'));
        await user.click(offerButton());
        await user.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        axios.post.mock.calls.forEach(([url, body]) => {
            expect(vectorShaped(body), `${url} carried a vector`).toEqual([]);
        });
    });

    it('puts none in the body of a check-in that declined one', async () => {
        const user = userEvent.setup();
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());

        await user.click(document.querySelector('[data-feeling-toggle="tiredness"]'));
        await user.click(document.querySelector('[data-trigger-keep]'));
        await user.click(screen.getByRole('button', { name: JOURNAL_COPY.proposal.save }));

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        axios.post.mock.calls.forEach(([, body]) => expect(vectorShaped(body)).toEqual([]));
    });

    it('sends no request of its own: building the index touches the network not at all', async () => {
        await renderCard({ entries: withWorkHistory(), runtime: embedder() });
        await waitFor(() => expect(offerButton()).toBeInTheDocument());
        await act(async () => { });

        // Every GET the app made is one of the four the journal already fetched.
        const urls = [...new Set(axios.get.mock.calls.map(([url]) => url))];
        urls.forEach(url => expect(url).toMatch(/^\/api\/(relationships|subjects|journal\/(entries|days))/));
        expect(axios.post).not.toHaveBeenCalled();
        expect(axios.put).not.toHaveBeenCalled();
    });
});

/* The Triggers view */

const renderTriggers = async ({ entries, runtime }) => {
    mockFetch(entries);
    echoPost();
    render(
        <MemoryRouter initialEntries={['/journal/triggers']}>
            <DiscretionProvider>
                <SubjectsProvider>
                    <JournalProvider>
                        <EmbeddingProvider enabled runtime={runtime} backend={memoryBackend()}>
                            <JournalTriggers />
                        </EmbeddingProvider>
                    </JournalProvider>
                </SubjectsProvider>
            </DiscretionProvider>
        </MemoryRouter>
    );
    await waitFor(() => expect(document.querySelector('[data-journal-view="triggers"]')).toBeInTheDocument());
    await act(async () => { });
};

const MY_JOB_ID = 'aa11bb22-cc33-dd44-ee55-ff6677889900';

/** Two words that look alike, both used around Lucie. */
const twoWords = () => [
    triggerRow({ id: WORK_ID, label: 'work', rowId: 10 }),
    triggerRow({ id: MY_JOB_ID, label: 'my job', rowId: 11 }),
    pastCheckin({ rowId: 12, triggers: [WORK_ID], relationshipId: 5, day: '2026-06-02' }),
    pastCheckin({ rowId: 13, triggers: [MY_JOB_ID], relationshipId: 5, day: '2026-06-09' })
];

describe('the Triggers view offers pairs', () => {
    it('shows "looks similar to…" for two witnessed look-alikes', async () => {
        await renderTriggers({ entries: twoWords(), runtime: embedder() });

        await waitFor(() => expect(document.querySelector('[data-similar-pairs]')).toBeInTheDocument());
        expect(document.querySelector('[data-similar-pairs]')).toHaveTextContent(
            JOURNAL_COPY.similar.pairsHeading.replace('…', '')
        );
    });

    it('shows nothing for two look-alikes with nothing structural in common', async () => {
        const entries = [
            triggerRow({ id: WORK_ID, label: 'work', rowId: 10 }),
            triggerRow({ id: MY_JOB_ID, label: 'my job', rowId: 11 }),
            pastCheckin({ rowId: 12, triggers: [WORK_ID], relationshipId: 5, day: '2026-06-02' }),
            pastCheckin({ rowId: 13, triggers: [MY_JOB_ID], relationshipId: 9, day: '2026-06-09' })
        ];
        await renderTriggers({ entries, runtime: embedder() });

        expect(document.querySelector('[data-similar-pairs]')).toBeNull();
    });

    it('merges nothing by itself — the pair is an offer and the dialog is the merge', async () => {
        const user = userEvent.setup();
        await renderTriggers({ entries: twoWords(), runtime: embedder() });
        await waitFor(() => expect(document.querySelector('[data-similar-pairs]')).toBeInTheDocument());

        // Opening the offer writes nothing.
        await user.click(document.querySelector('[data-similar-merge]'));
        expect(await screen.findByText(JOURNAL_COPY.triggers.merge.title)).toBeInTheDocument();
        expect(axios.post).not.toHaveBeenCalled();

        // Neither does picking a target: the one-way sentence appears first.
        await user.click(screen.getByRole('radio'));
        expect(screen.getByText(JOURNAL_COPY.triggers.merge.oneWay)).toBeInTheDocument();
        expect(axios.post).not.toHaveBeenCalled();

        // Only the confirming tap writes, and what it writes is the ordinary correction.
        await user.click(document.querySelector('[data-merge-confirm]'));
        await waitFor(() => expect(axios.post).toHaveBeenCalled());

        const [, body] = axios.post.mock.calls[0];
        expect(body.kind).toBe('trigger');
        expect(body.payload.merged_into).toBeTruthy();
        expect(vectorShaped(body)).toEqual([]);
    });

    it('shows no number in the pairs block', async () => {
        await renderTriggers({ entries: twoWords(), runtime: embedder() });
        await waitFor(() => expect(document.querySelector('[data-similar-pairs]')).toBeInTheDocument());

        expect(document.querySelector('[data-similar-pairs]').textContent).not.toMatch(/[0-9]/);
    });
});
