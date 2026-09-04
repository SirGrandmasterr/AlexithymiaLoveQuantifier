import React from 'react';
import { render, screen, waitFor, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import CheckinComposer from './CheckinComposer';
import {
    resolvePerson,
    resolveTriggerLabel,
    cardStateFromProposal,
    mergeProposal,
    confirmedPicked,
    buildProvenance,
    ambiguitySentence
} from './ProposalCard';
import { DiscretionProvider, BLUR_CLASS } from '../context/DiscretionContext';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { JOURNAL_COPY, JOURNAL_STORAGE_KEYS, FEELINGS, fillCopy } from '../constants/journal';
import { CONTEXT_TAGS } from '../constants/contextTags';
import { buildContext } from '../journal/inference';
import { createFakeRuntime } from '../journal/inference/fake';
import { fakeKit, clip } from './voiceKit.fake';
import transcripts from '../journal/inference/golden/transcripts.json';

vi.mock('axios');

/**
 * The proposal card, driven the way a user drives it: a composer the microphone opened, a
 * take landing in the fake recorder, the fake runtime answering with a proposal, and the
 * card that draws it — down to the request that reaches `POST /api/journal/entries`.
 *
 * Everything asserted about the record is asserted on **the request body**, because the
 * shape in §7.2 is a contract with a Go handler. The first test is the invariant-15 one.
 */

/** §4.7 stage 3, from the golden suite rather than retyped here. */
const LUCIE = transcripts.find(entry => entry.id === 'lucie.en').reference;

const TODAY = '2026-08-21';
const WORK_ID = '0b7e4c1a-5d2a-4f0c-9e2f-7f3a8c1d4b6e';
const UUID = /^[0-9a-f-]{36}$/i;

const lucieRelationships = [
    { ID: 5, name: 'Lucie', snapshot_count: 1 },
    { ID: 9, name: 'Alex', snapshot_count: 0 }
];

const workTrigger = {
    ID: 10,
    client_id: WORK_ID,
    kind: 'trigger',
    day: '2026-08-19',
    at: '2026-08-19T09:00:00Z',
    schema_version: 1,
    payload: { v: 1, label: 'work' },
    mentions: []
};

/** Four endpoints (trap 10c), the shape `Journal.test.jsx` and the composer's suite use. */
const mockFetch = ({ entries = [], rels = lucieRelationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: [] });
        return Promise.resolve({ data: [] });
    });
};

const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 99, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

const proposal = (overrides = {}) => ({
    transcript: 'Something was said.',
    language: 'en',
    feelings: [],
    people: [],
    facts: [],
    ambiguity: 'none',
    ...overrides
});

/** A kit whose runtime answers every request with `fixture` (or follows the rules given). */
const kitFor = (fixture, options = {}) => fakeKit({ fixtures: fixture, options });

const renderComposer = ({ kit, rels = lucieRelationships, entries = [], onClose = vi.fn(), onSaved = vi.fn() } = {}) => {
    mockFetch({ rels, entries });
    const context = buildContext({
        relationships: rels,
        triggers: entries.filter(entry => entry.kind === 'trigger').map(entry => ({ label: entry.payload.label }))
    });
    const result = render(
        <MemoryRouter initialEntries={['/journal']}>
            <DiscretionProvider>
                <SubjectsProvider>
                    <JournalProvider>
                        <CheckinComposer mode="voice" voiceKit={kit} context={context} onClose={onClose} onSaved={onSaved} />
                    </JournalProvider>
                </SubjectsProvider>
            </DiscretionProvider>
        </MemoryRouter>
    );
    return { ...result, onClose, onSaved };
};

/** Land a take once the providers have their lists, and wait for the card. */
const landAndOpen = async (kit, id = 'clip-1') => {
    await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', expect.anything()));
    await act(async () => { });
    act(() => kit.recorder.landTake([clip(id)]));
    await waitFor(() => expect(card()).toBeInTheDocument());
    return card();
};

const card = () => document.querySelector('[data-proposal-card]');
const row = (id) => document.querySelector(`[data-proposed="${id}"]`);
const toggle = (id) => document.querySelector(`[data-feeling-toggle="${id}"]`);
const gridChip = (id) => document.querySelector(`[data-card-grid] button[data-feeling="${id}"]`);
const personRow = (key) => document.querySelector(`[data-person="${key}"]`);
const saveButton = () => document.querySelector('[data-card-save]');
const sentBody = () => axios.post.mock.calls.at(-1)[1];
const save = async () => {
    await userEvent.click(saveButton());
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
};

let originalTZ;

beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
});

afterAll(() => {
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
});

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    // 18:42:10 in Berlin — §4.7 stage 6's `at`.
    vi.setSystemTime(new Date('2026-08-21T16:42:10Z'));
    echoPost();
});

afterEach(() => {
    vi.useRealTimers();
});

/* ------------------------------------------------------------------------------------ */
/* 1. Invariant 15 — dashed is not saved, solid is                                        */
/* ------------------------------------------------------------------------------------ */

describe('dashed chips are not saved; solid ones are', () => {
    it('writes exactly the feelings the user kept, and nothing the model only proposed', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        // Three chips, all proposed, none saved — and nothing to save yet.
        ['pleasure', 'rapport', 'stress'].forEach(id => {
            expect(row(id)).toHaveAttribute('data-confirmed', 'false');
            expect(toggle(id).className).toContain('border-dashed');
        });
        expect(saveButton()).toBeDisabled();

        await userEvent.click(toggle('pleasure'));
        expect(row('pleasure')).toHaveAttribute('data-confirmed', 'true');
        expect(toggle('pleasure').className).toContain('border-solid');
        expect(saveButton()).not.toBeDisabled();

        await save();

        const body = sentBody();
        expect(body.payload.feelings).toEqual([
            { id: 'pleasure', intensity: 2, about: [{ kind: 'person', ref: 0 }] }
        ]);
        expect(body.mentions).toEqual([{ ref: 0, relationship_id: 5, label: 'Lucie' }]);
        // The dashed trigger under the dashed `stress` never reached the body either.
        expect(body.triggers).toEqual([]);
        expect(JSON.stringify(body.payload.feelings)).not.toMatch(/rapport|stress/);
    });

    it('tapping a kept chip again puts it down, and it goes with everything under it', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        await userEvent.click(toggle('stress'));
        expect(row('stress')).toHaveAttribute('data-confirmed', 'true');
        await userEvent.click(toggle('stress'));
        expect(row('stress')).toBeNull();
        expect(saveButton()).toBeDisabled();
    });

    it('does not write a person nobody confirmed, even under a kept feeling', async () => {
        const kit = kitFor(proposal({
            feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Nora' }] }],
            people: [{ name: 'Nora' }]
        }));
        renderComposer({ kit });
        await landAndOpen(kit);

        await userEvent.click(toggle('rapport'));
        expect(personRow('nora')).toHaveAttribute('data-person-state', 'new');
        expect(personRow('nora')).toHaveAttribute('data-person-confirmed', 'false');
        expect(row('rapport').querySelector('[data-about="person"]')).toHaveAttribute('data-resolved', 'false');

        await save();
        expect(sentBody().mentions).toEqual([]);
        expect(sentBody().payload.feelings).toEqual([{ id: 'rapport', intensity: 2, about: [] }]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. Provenance — what was proposed, kept, replaced                                     */
/* ------------------------------------------------------------------------------------ */

describe('the provenance block', () => {
    it('records a replaced feeling under replaced, and an added one under accepted only', async () => {
        const kit = kitFor(LUCIE, { id: 'fake-rt', model: 'fake-model', promptVersion: 7 });
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        await userEvent.click(toggle('pleasure'));
        await userEvent.click(toggle('rapport'));
        // Stress was really irritation: the change keeps its strength and its trigger.
        await userEvent.click(document.querySelector('[data-feeling-change="stress"]'));
        await userEvent.click(within(document.querySelector('[data-change-grid="stress"]')).getByRole('button', { name: 'irritation' }));
        expect(row('stress')).toBeNull();
        expect(row('irritation')).toHaveAttribute('data-confirmed', 'true');
        expect(row('irritation').querySelector('[data-about="trigger"]')).toHaveTextContent('work');
        // And one word the model never said.
        await userEvent.click(document.querySelector('[data-add-word]'));
        await userEvent.click(gridChip('calm'));

        await save();

        expect(sentBody().payload.proposal).toEqual({
            model: 'fake-model',
            runtime: 'fake-rt',
            prompt_version: 7,
            proposed: ['pleasure', 'rapport', 'stress'],
            accepted: ['pleasure', 'rapport', 'irritation', 'calm'],
            replaced: { stress: 'irritation' },
            dropped_by_filter: 0,
            ambiguity: 'none',
            edited_transcript: false
        });
    });

    it('carries the filter\'s count when the model said something the app refused', async () => {
        const kit = kitFor({
            ...LUCIE,
            feelings: [...LUCIE.feelings, { id: 'burnout', intensity: 2, about: [] }]
        });
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        expect(row('burnout')).toBeNull();
        await userEvent.click(toggle('pleasure'));
        await save();

        expect(sentBody().payload.proposal.dropped_by_filter).toBe(1);
        expect(sentBody().payload.proposal.proposed).toEqual(['pleasure', 'rapport', 'stress']);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. Facts — not offered, by S0's decision                                              */
/* ------------------------------------------------------------------------------------ */

describe('facts', () => {
    it('are neither shown nor written: no UI writes a person_fact until 6-E (S0, 2026-08-22)', async () => {
        const kit = kitFor(proposal({
            feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Lucie' }] }],
            people: [{ name: 'Lucie' }],
            facts: [{ person: 'Lucie', text: 'moved to Lyon' }]
        }));
        renderComposer({ kit });
        await landAndOpen(kit);

        expect(screen.queryByText(/moved to Lyon/)).not.toBeInTheDocument();
        await userEvent.click(toggle('rapport'));
        await save();

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect(sentBody().kind).toBe('checkin');
        expect(JSON.stringify(sentBody())).not.toContain('moved to Lyon');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 4. The four ambiguity values, and a proposal the filter could not use                  */
/* ------------------------------------------------------------------------------------ */

describe('ambiguity', () => {
    const exits = () => document.querySelector('[data-card-exits]');

    it('none: chips pre-selected, no sentence, the exits folded away', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        expect(document.querySelector('[data-ambiguity-sentence]')).toBeNull();
        expect(exits()).toBeNull();
        expect(document.querySelectorAll('[data-proposed]')).toHaveLength(3);
    });

    it('feeling: no chip pre-selected, the vocabulary open, the transcript kept, the template shown', async () => {
        const kit = kitFor(proposal({ transcript: 'Went to the shop.', feelings: [], ambiguity: 'feeling' }));
        renderComposer({ kit });
        await landAndOpen(kit);

        expect(screen.getByText(JOURNAL_COPY.proposal.ambiguity.feeling)).toBeInTheDocument();
        expect(document.querySelectorAll('[data-proposed]')).toHaveLength(0);
        expect(document.querySelector('[data-card-grid]')).toBeInTheDocument();
        expect(screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel)).toHaveValue('Went to the shop.');
        expect(exits()).toBeInTheDocument();

        await userEvent.click(gridChip('boredom'));
        await save();
        expect(sentBody().payload.feelings).toEqual([{ id: 'boredom', intensity: 2, about: [] }]);
        expect(sentBody().payload.proposal.ambiguity).toBe('feeling');
        expect(sentBody().payload.proposal.proposed).toEqual([]);
    });

    it('target: feelings pre-selected and unattached, with the mentions in the sentence and a hint to attach', async () => {
        const kit = kitFor(proposal({
            feelings: [{ id: 'anxiety', intensity: 2, about: [] }],
            people: [{ name: 'Sam' }],
            ambiguity: 'target'
        }));
        renderComposer({ kit, rels: [{ ID: 3, name: 'Sam', snapshot_count: 0 }] });
        await landAndOpen(kit);

        expect(screen.getByText('Was that about Sam, or something else?')).toBeInTheDocument();
        expect(row('anxiety')).toHaveAttribute('data-confirmed', 'false');
        expect(row('anxiety').querySelector('[data-attach-hint]')).toHaveTextContent(JOURNAL_COPY.proposal.attachHint);
        expect(exits()).toBeInTheDocument();

        // Attaching is the ordinary picker, and the person it names is the matched one.
        await userEvent.click(toggle('anxiety'));
        await userEvent.click(document.querySelector('[data-add-about="anxiety:person"]'));
        await userEvent.click(document.querySelector('[data-person-candidate="3"]'));
        await save();
        expect(sentBody().payload.feelings[0].about).toEqual([{ kind: 'person', ref: 0 }]);
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 3, label: 'Sam' }]);
    });

    it('target with nobody named falls back to the shorter question', async () => {
        const kit = kitFor(proposal({ feelings: [{ id: 'anxiety', intensity: 2, about: [] }], ambiguity: 'target' }));
        renderComposer({ kit });
        await landAndOpen(kit);
        expect(screen.getByText(JOURNAL_COPY.proposal.ambiguity.targetUnknown)).toBeInTheDocument();
    });

    it('conflict: both readings as alternatives, neither pre-selected, one tap decides', async () => {
        const kit = kitFor(proposal({
            feelings: [
                { id: 'irritation', intensity: 2, about: [{ kind: 'person', name: 'Alex' }] },
                { id: 'sadness', intensity: 2, about: [{ kind: 'person', name: 'Alex' }] }
            ],
            people: [{ name: 'Alex' }],
            ambiguity: 'conflict'
        }));
        renderComposer({ kit });
        await landAndOpen(kit);

        expect(screen.getByText(JOURNAL_COPY.proposal.ambiguity.conflict)).toBeInTheDocument();
        expect(document.querySelectorAll('[data-proposed]')).toHaveLength(0);
        expect(document.querySelectorAll('[data-alternative]')).toHaveLength(2);
        expect(saveButton()).toBeDisabled();

        await userEvent.click(document.querySelector('[data-alternative="sadness"]'));
        expect(row('sadness')).toHaveAttribute('data-confirmed', 'true');
        expect(row('irritation')).toBeNull();
        await save();
        expect(sentBody().payload.feelings.map(feeling => feeling.id)).toEqual(['sadness']);
        expect(sentBody().payload.proposal).toMatchObject({ ambiguity: 'conflict', proposed: ['irritation', 'sadness'], accepted: ['sadness'] });
    });

    it('a proposal the filter could not use takes the feeling path, and no parse error is ever shown', async () => {
        // The array form is the only one that can hand back a string: the fake reads a
        // bare string fixture as a matcher, not as an answer.
        const kit = fakeKit({ fixtures: [{ match: () => true, proposal: 'Sure! Here is a paragraph about your day instead of JSON.' }] });
        renderComposer({ kit });
        await landAndOpen(kit);

        expect(card()).toHaveAttribute('data-ambiguity', 'feeling');
        expect(screen.getByText(JOURNAL_COPY.proposal.ambiguity.feeling)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(document.body.textContent).not.toMatch(/parse|schema|invalid|JSON|error/i);
        // The model's prose is not on the screen either.
        expect(document.body.textContent).not.toContain('paragraph');
    });
});

/* ------------------------------------------------------------------------------------ */
/* 5. Triggers — new ones dashed, minted only on save                                    */
/* ------------------------------------------------------------------------------------ */

describe('a new trigger', () => {
    const examProposal = proposal({
        feelings: [{ id: 'stress', intensity: 3, about: [{ kind: 'trigger', label: 'the exam' }] }]
    });

    it('renders dashed, is not written until kept, and is minted only on save', async () => {
        const kit = kitFor(examProposal);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        const chip = row('stress').querySelector('[data-about="trigger"]');
        expect(chip).toHaveAttribute('data-resolved', 'false');
        expect(chip).toHaveTextContent(fillCopy(JOURNAL_COPY.triggers.newTrigger, { label: 'the exam' }));

        await userEvent.click(toggle('stress'));
        await save();
        // Kept feeling, unkept trigger: the feeling is written about nothing.
        expect(sentBody().triggers).toEqual([]);
        expect(sentBody().payload.feelings).toEqual([{ id: 'stress', intensity: 3, about: [] }]);
    });

    it('once kept, travels as a label with a client id, once, and the about references it', async () => {
        const kit = kitFor(examProposal);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        await userEvent.click(toggle('stress'));
        await userEvent.click(row('stress').querySelector('[data-trigger-keep]'));
        expect(row('stress').querySelector('[data-about="trigger"]')).toHaveAttribute('data-resolved', 'true');
        expect(row('stress').querySelector('[data-about="trigger"]')).toHaveTextContent('the exam');

        await save();
        const minted = sentBody().triggers[0].client_id;
        expect(minted).toMatch(UUID);
        expect(sentBody().triggers).toEqual([{ label: 'the exam', client_id: minted }]);
        expect(sentBody().payload.feelings[0].about).toEqual([{ kind: 'trigger', trigger: minted }]);
    });

    it('resolves a label the user already has to the live trigger, under the vocabulary\'s spelling', async () => {
        const kit = kitFor(proposal({ feelings: [{ id: 'stress', intensity: 2, about: [{ kind: 'trigger', label: 'Work' }] }] }));
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        const chip = row('stress').querySelector('[data-about="trigger"]');
        expect(chip).toHaveAttribute('data-resolved', 'true');
        expect(chip).toHaveTextContent('work');
        await userEvent.click(toggle('stress'));
        await save();
        expect(sentBody().triggers).toEqual([{ trigger: WORK_ID }]);
    });

    it('discarding mints nothing — no request of any kind', async () => {
        const kit = kitFor(examProposal);
        const { onClose } = renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        await userEvent.click(toggle('stress'));
        await userEvent.click(row('stress').querySelector('[data-trigger-keep]'));
        await userEvent.click(document.querySelector('[data-card-discard]'));

        expect(onClose).toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 6. The transcript — editing re-runs the proposal in text mode                         */
/* ------------------------------------------------------------------------------------ */

describe('editing the transcript', () => {
    const heard = (name) => proposal({
        transcript: `${name} called and I felt lighter afterwards.`,
        feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name }] }],
        people: [{ name }]
    });

    const kitHearingLucy = () => fakeKit({
        fixtures: [
            { match: (request) => request.kind === 'audio', proposal: heard('Lucy') },
            { match: (request) => request.kind === 'text' && /Lucie/.test(request.text), proposal: heard('Lucie') },
            { match: (request) => request.kind === 'text', proposal: heard('Lucy') }
        ]
    });

    it('re-runs in text mode, and Lucy becomes the relationship Lucie rather than a second person', async () => {
        const kit = kitHearingLucy();
        renderComposer({ kit });
        await landAndOpen(kit);

        // Misheard: no relationship is called Lucy, so the card offers a new person.
        expect(personRow('lucy')).toHaveAttribute('data-person-state', 'new');
        expect(personRow('lucy')).toHaveAttribute('data-person-confirmed', 'false');
        await userEvent.click(toggle('rapport'));

        const box = screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel);
        await userEvent.clear(box);
        await userEvent.type(box, 'Lucie called and I felt lighter afterwards.');
        await userEvent.tab();

        await waitFor(() => expect(personRow('lucie')).toBeInTheDocument());
        expect(kit.runtime.calls.at(-1).kind).toBe('text');
        expect(kit.runtime.calls.at(-1).text).toContain('Lucie');
        expect(personRow('lucy')).toBeNull();
        expect(personRow('lucie')).toHaveAttribute('data-person-state', 'matched');
        expect(personRow('lucie')).toHaveAttribute('data-person-confirmed', 'true');
        // The confirmation made before the edit survives the re-proposal.
        expect(row('rapport')).toHaveAttribute('data-confirmed', 'true');

        await save();
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 5, label: 'Lucie' }]);
        expect(sentBody().payload.transcript).toBe('Lucie called and I felt lighter afterwards.');
        expect(sentBody().payload.proposal.edited_transcript).toBe(true);
    });

    it('keeps the edit and the chips when the runtime does not take text — the Light tier today', async () => {
        const kit = fakeKit({ fixtures: heard('Lucy'), options: { accepts: ['audio'] } });
        renderComposer({ kit });
        await landAndOpen(kit);
        await userEvent.click(toggle('rapport'));

        const box = screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel);
        await userEvent.clear(box);
        await userEvent.type(box, 'Lucie called.');
        await userEvent.tab();

        expect(row('rapport')).toHaveAttribute('data-confirmed', 'true');
        await save();
        expect(sentBody().payload.transcript).toBe('Lucie called.');
        expect(sentBody().payload.proposal.edited_transcript).toBe(true);
    });

    it('does not re-run for a blur that changed nothing', async () => {
        const kit = kitHearingLucy();
        renderComposer({ kit });
        await landAndOpen(kit);
        const before = kit.runtime.calls.length;

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel));
        await userEvent.tab();

        expect(kit.runtime.calls).toHaveLength(before);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 7. Candidates — offered, never selected                                                */
/* ------------------------------------------------------------------------------------ */

describe('personCandidates on the card', () => {
    const lucieProposal = proposal({
        feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Lucie' }] }],
        people: [{ name: 'Lucie' }]
    });
    const onlyLucieM = [{ ID: 7, name: 'Lucie M', snapshot_count: 0 }];

    it('offers Lucie M? beside a heard Lucie and selects nothing', async () => {
        const kit = kitFor(lucieProposal);
        renderComposer({ kit, rels: onlyLucieM });
        await landAndOpen(kit);

        expect(personRow('lucie')).toHaveAttribute('data-person-state', 'candidates');
        expect(personRow('lucie')).toHaveAttribute('data-person-confirmed', 'false');
        expect(document.querySelector('[data-person-candidate="7"]')).toHaveTextContent('Lucie M?');
        expect(screen.getByText(JOURNAL_COPY.proposal.people.unresolved)).toBeInTheDocument();

        await userEvent.click(toggle('rapport'));
        await save();
        // Nothing dashed is written: no mention, and no new "Lucie" beside "Lucie M".
        expect(sentBody().mentions).toEqual([]);
    });

    it('binds the mention to the candidate the user tapped, under the spoken name', async () => {
        const kit = kitFor(lucieProposal);
        renderComposer({ kit, rels: onlyLucieM });
        await landAndOpen(kit);

        await userEvent.click(toggle('rapport'));
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));
        expect(personRow('lucie')).toHaveAttribute('data-person-confirmed', 'true');
        expect(personRow('lucie')).toHaveTextContent(fillCopy(JOURNAL_COPY.proposal.people.linked, { name: 'Lucie', match: 'Lucie M' }));

        await save();
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 7, label: 'Lucie' }]);
    });

    it('creates a new person only from the tap that says so', async () => {
        const kit = kitFor(lucieProposal);
        renderComposer({ kit, rels: onlyLucieM });
        await landAndOpen(kit);

        await userEvent.click(toggle('rapport'));
        await userEvent.click(document.querySelector('[data-person-keep-new]'));
        expect(personRow('lucie')).toHaveTextContent(fillCopy(JOURNAL_COPY.proposal.people.added, { name: 'Lucie' }));

        await save();
        expect(sentBody().mentions).toEqual([{ ref: 0, name: 'Lucie', label: 'Lucie' }]);
    });

    it('lets a name with no candidate be linked to any existing person through pick existing', async () => {
        const kit = kitFor(proposal({
            feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Lu' }] }],
            people: [{ name: 'Lu' }]
        }));
        renderComposer({ kit, rels: lucieRelationships });
        await landAndOpen(kit);

        // "Lu" is not a token prefix of "Lucie" (§4.5 step 2 stops at a word boundary), so
        // there is no candidate at all — and *pick existing…* is still there.
        expect(personRow('lu')).toHaveAttribute('data-person-state', 'new');
        await userEvent.click(toggle('rapport'));
        await userEvent.click(document.querySelector('[data-person-pick-existing]'));
        await userEvent.click(document.querySelector('[data-person-existing="9"]'));

        await save();
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 9, label: 'Lu' }]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 8. §4.7, byte for byte                                                                 */
/* ------------------------------------------------------------------------------------ */

describe('the §4.7 payload', () => {
    it('is stage 6, key for key, after the stage-5 taps on the stage-3 proposal', async () => {
        const kit = kitFor(LUCIE, { id: 'litert-lm/android', model: 'gemma-4-E2B-it', promptVersion: 3 });
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        // Stage 5: confirm two, decide stress was really irritation, save.
        await userEvent.click(toggle('pleasure'));
        await userEvent.click(toggle('rapport'));
        await userEvent.click(document.querySelector('[data-feeling-change="stress"]'));
        await userEvent.click(within(document.querySelector('[data-change-grid="stress"]')).getByRole('button', { name: 'irritation' }));
        await save();

        // A literal, so an added key, a dropped key or a renamed one fails here rather than
        // against the Go validator. Two departures from the design document's stage-6 block,
        // both A7's and both recorded in §4.7 since D2: `uncertain` is written only when
        // true (invariant 14), and `tags` is absent rather than empty; `tz_offset_min`,
        // `transcript_kept` and `supersedes_id` are §7.2's and were never in the sketch.
        expect(sentBody()).toEqual({
            client_id: expect.stringMatching(UUID),
            kind: 'checkin',
            at: '2026-08-21T18:42:10+02:00',
            day: '2026-08-21',
            schema_version: 1,
            payload: {
                v: 1,
                source: 'voice',
                tz_offset_min: 120,
                transcript: LUCIE.transcript,
                transcript_kept: true,
                language: 'en',
                feelings: [
                    { id: 'pleasure', intensity: 2, about: [{ kind: 'person', ref: 0 }] },
                    { id: 'rapport', intensity: 3, about: [{ kind: 'person', ref: 0 }] },
                    { id: 'irritation', intensity: 2, about: [{ kind: 'trigger', trigger: WORK_ID }] }
                ],
                proposal: {
                    model: 'gemma-4-E2B-it',
                    runtime: 'litert-lm/android',
                    prompt_version: 3,
                    proposed: ['pleasure', 'rapport', 'stress'],
                    accepted: ['pleasure', 'rapport', 'irritation'],
                    replaced: { stress: 'irritation' },
                    dropped_by_filter: 0,
                    ambiguity: 'none',
                    edited_transcript: false
                }
            },
            mentions: [{ ref: 0, relationship_id: 5, label: 'Lucie' }],
            triggers: [{ trigger: WORK_ID }],
            supersedes_id: null
        });
    });
});

/* ------------------------------------------------------------------------------------ */
/* 9. This isn't it — the three exits, from every state                                  */
/* ------------------------------------------------------------------------------------ */

describe("This isn't it", () => {
    const states = {
        none: LUCIE,
        feeling: proposal({ feelings: [], ambiguity: 'feeling' }),
        target: proposal({ feelings: [{ id: 'anxiety', intensity: 2, about: [] }], ambiguity: 'target' }),
        conflict: proposal({ feelings: [{ id: 'irritation', intensity: 2, about: [] }, { id: 'sadness', intensity: 2, about: [] }], ambiguity: 'conflict' })
    };

    Object.entries(states).forEach(([name, fixture]) => {
        it(`from ${name} returns to the three exits`, async () => {
            const kit = kitFor(fixture);
            renderComposer({ kit, entries: [workTrigger] });
            await landAndOpen(kit);

            await userEvent.click(document.querySelector('[data-card-not-it]'));

            const exits = document.querySelector('[data-card-exits]');
            expect(exits).toBeInTheDocument();
            expect(within(exits).getByText(JOURNAL_COPY.proposal.exits.edit)).toBeInTheDocument();
            expect(within(exits).getByText(JOURNAL_COPY.proposal.exits.rerecord)).toBeInTheDocument();
            expect(within(exits).getByText(JOURNAL_COPY.proposal.exits.chips)).toBeInTheDocument();
        });
    });

    it('edit the words focuses the transcript', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);
        await userEvent.click(document.querySelector('[data-card-not-it]'));
        await userEvent.click(document.querySelector('[data-exit="edit"]'));
        expect(document.activeElement).toBe(screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel));
    });

    it('say it again drops the card and brings the microphone back', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);
        await userEvent.click(document.querySelector('[data-card-not-it]'));
        await userEvent.click(document.querySelector('[data-exit="rerecord"]'));

        expect(card()).toBeNull();
        expect(document.querySelector('[data-voice-record]')).toBeInTheDocument();
        expect(axios.post).not.toHaveBeenCalled();

        // And a second take makes a second card.
        act(() => kit.recorder.landTake([clip('clip-2')]));
        await waitFor(() => expect(card()).toBeInTheDocument());
    });

    it('tap words instead keeps the words and hands them to the grid the chips path has always used', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);
        await userEvent.click(document.querySelector('[data-card-not-it]'));
        await userEvent.click(document.querySelector('[data-exit="chips"]'));

        expect(card()).toBeNull();
        expect(document.querySelector('[data-voice-transcript-input]')).toHaveValue(LUCIE.transcript);
        expect(document.querySelector('button[data-feeling="rapport"]')).toBeInTheDocument();
        expect(axios.post).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 10. Every word on the card is a template                                              */
/* ------------------------------------------------------------------------------------ */

const walkStrings = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(walkStrings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(walkStrings);
    return [];
};

/** A template with `{x}` becomes a pattern with `.+` in its place (ledger, A9). */
const templatePatterns = walkStrings(JOURNAL_COPY)
    .filter(text => text.includes('{'))
    .map(text => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[a-z]+\\\}/g, '.+')}$`));

describe('no bare strings on the card (Appendix B item 3)', () => {
    it('renders nothing the forbidden-word walk cannot reach', async () => {
        const kit = kitFor(proposal({
            ...LUCIE,
            feelings: [
                ...LUCIE.feelings,
                { id: 'calm', intensity: 1, about: [{ kind: 'tag', tag: 'routine period' }, { kind: 'trigger', label: 'the exam' }] }
            ],
            people: [{ name: 'Lucie' }, { name: 'Nora' }],
            ambiguity: 'target'
        }));
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);
        await userEvent.click(toggle('pleasure'));
        await userEvent.click(document.querySelector('[data-feeling-change="stress"]'));
        await userEvent.click(document.querySelector('[data-card-not-it]'));
        await userEvent.click(document.querySelector('[data-add-word]'));

        const allowed = new Set([
            ...walkStrings(JOURNAL_COPY),
            ...FEELINGS.flatMap(feeling => [feeling.label, feeling.gloss]),
            ...CONTEXT_TAGS,
            'Lucie', 'Nora', 'work', 'the exam', LUCIE.transcript
        ]);
        const words = Array.from(card().querySelectorAll('*'))
            .flatMap(node => Array.from(node.childNodes))
            .filter(node => node.nodeType === Node.TEXT_NODE)
            .map(node => node.textContent.trim())
            .filter(text => /[A-Za-z]{2,}/.test(text));

        expect(words.length).toBeGreaterThan(20);
        expect(words.filter(text => !allowed.has(text) && !templatePatterns.some(pattern => pattern.test(text)))).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 11. Discretion                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('under discretion', () => {
    beforeEach(() => { window.localStorage.setItem('alq:discreet', 'true'); });

    it('blurs the transcript and the trigger labels, and masks the names', async () => {
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        // The transcript is blurred, not masked (§9.6): the words stay the words. Names
        // everywhere else on the card collapse to initials.
        expect(screen.getByLabelText(JOURNAL_COPY.voice.transcriptLabel).className).toContain(BLUR_CLASS);
        expect(row('stress').querySelector('[data-about="trigger"] button').className).toContain(BLUR_CLASS);
        expect(row('pleasure').querySelector('[data-about="person"]')).toHaveTextContent('L.');
        expect(row('pleasure').querySelector('[data-about="person"]')).not.toHaveTextContent('Lucie');
        expect(personRow('lucie')).toHaveTextContent('L. — matches your relationship "L."');
        expect(personRow('lucie')).not.toHaveTextContent('Lucie');

        // The mask is the cover; the record is unaffected.
        await userEvent.click(toggle('pleasure'));
        await save();
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 5, label: 'Lucie' }]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 12. Two rules of the composer's that the card keeps                                    */
/* ------------------------------------------------------------------------------------ */

describe('rules the card keeps', () => {
    it('makes can\'t tell exclusive: keeping either side puts the other down', async () => {
        const both = proposal({ feelings: [{ id: 'unclear', intensity: 2, about: [] }, { id: 'joy', intensity: 2, about: [] }] });

        const kit = kitFor(both);
        renderComposer({ kit });
        await landAndOpen(kit);
        await userEvent.click(toggle('joy'));
        expect(row('unclear')).toBeNull();
        expect(row('joy')).toHaveAttribute('data-confirmed', 'true');
    });

    it('and the other way round', async () => {
        const both = proposal({ feelings: [{ id: 'unclear', intensity: 2, about: [] }, { id: 'joy', intensity: 2, about: [] }] });
        const kit = kitFor(both);
        renderComposer({ kit });
        await landAndOpen(kit);
        await userEvent.click(toggle('unclear'));
        expect(row('joy')).toBeNull();
        expect(row('unclear')).toHaveAttribute('data-confirmed', 'true');
    });

    it('keeps the card, with every confirmation on it, when the save fails (trap 4)', async () => {
        axios.post.mockRejectedValueOnce({ response: { data: { error: 'the server said no' } } });
        const kit = kitFor(LUCIE);
        const { onClose } = renderComposer({ kit, entries: [workTrigger] });
        await landAndOpen(kit);

        await userEvent.click(toggle('pleasure'));
        await userEvent.click(saveButton());

        await screen.findByRole('alert');
        expect(screen.getByRole('alert')).toHaveTextContent('the server said no');
        expect(card()).toBeInTheDocument();
        expect(row('pleasure')).toHaveAttribute('data-confirmed', 'true');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows no card when Show suggestions is off — the words land in the grid as in C3', async () => {
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.suggestions, 'false');
        const kit = kitFor(LUCIE);
        renderComposer({ kit, entries: [workTrigger] });
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', expect.anything()));
        act(() => kit.recorder.landTake([clip('clip-1')]));

        await waitFor(() => expect(document.querySelector('[data-voice-transcript-input]')).toHaveValue(LUCIE.transcript));
        expect(card()).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 13. The pure functions                                                                 */
/* ------------------------------------------------------------------------------------ */

describe('resolvePerson', () => {
    it('matches exactly, offers candidates, or says new — and confirms only the match', () => {
        expect(resolvePerson('Lucie', lucieRelationships)).toMatchObject({ state: 'matched', relationshipId: 5, confirmed: true });
        expect(resolvePerson('Lucie', [{ ID: 7, name: 'Lucie M' }])).toMatchObject({ state: 'candidates', relationshipId: null, confirmed: false });
        expect(resolvePerson('Lucie', [{ ID: 7, name: 'Lucie M' }]).candidates.map(c => c.relationshipId)).toEqual([7]);
        expect(resolvePerson('Nora', lucieRelationships)).toMatchObject({ state: 'new', candidates: [], confirmed: false });
    });
});

describe('resolveTriggerLabel', () => {
    const live = [{ live: WORK_ID, clientId: WORK_ID, label: 'work' }];

    it('resolves exact and case-insensitive labels to the live id and leaves the rest new', () => {
        expect(resolveTriggerLabel('work', live)).toMatchObject({ live: WORK_ID, isNew: false, confirmed: true, label: 'work' });
        expect(resolveTriggerLabel('WORK', live)).toMatchObject({ live: WORK_ID, isNew: false, confirmed: true, label: 'work' });
        expect(resolveTriggerLabel('the exam', live)).toMatchObject({ live: null, isNew: true, confirmed: false, clientId: null });
    });
});

describe('cardStateFromProposal and confirmedPicked', () => {
    it('starts with everything proposed and nothing confirmed, and writes nothing until a tap', () => {
        const state = cardStateFromProposal(LUCIE, { relationships: lucieRelationships, triggers: [{ live: WORK_ID, label: 'work' }] });

        expect(state.feelings.map(f => [f.id, f.proposed, f.confirmed])).toEqual([
            ['pleasure', true, false], ['rapport', true, false], ['stress', true, false]
        ]);
        expect(state.people).toHaveLength(1);
        expect(state.people[0]).toMatchObject({ name: 'Lucie', state: 'matched', relationshipId: 5 });
        expect(state.triggers[0]).toMatchObject({ label: 'work', live: WORK_ID, confirmed: true });
        expect(confirmedPicked(state)).toEqual([]);

        const kept = { ...state, feelings: state.feelings.map(f => (f.id === 'stress' ? { ...f, confirmed: true } : f)) };
        expect(confirmedPicked(kept)).toEqual([
            { id: 'stress', intensity: 2, uncertain: false, about: [{ kind: 'trigger', clientId: WORK_ID, label: 'work', isNew: false }] }
        ]);
    });

    it('drops an about whose person or trigger is unresolved', () => {
        const state = cardStateFromProposal(proposal({
            feelings: [{ id: 'stress', intensity: 1, about: [{ kind: 'person', name: 'Nora' }, { kind: 'trigger', label: 'the exam' }, { kind: 'tag', tag: 'conflict' }] }],
            people: [{ name: 'Nora' }]
        }), { relationships: [], triggers: [] });
        const kept = { ...state, feelings: state.feelings.map(f => ({ ...f, confirmed: true })) };
        expect(confirmedPicked(kept)[0].about).toEqual([{ kind: 'tag', tag: 'conflict' }]);
    });
});

describe('mergeProposal', () => {
    it('keeps confirmations, strengths and additions across a re-proposal', () => {
        const lists = { relationships: lucieRelationships, triggers: [] };
        const first = cardStateFromProposal(LUCIE, lists);
        const decided = {
            ...first,
            feelings: [
                ...first.feelings.map(f => (f.id === 'pleasure' ? { ...f, confirmed: true, intensity: 3 } : f)),
                { key: 'added', id: 'calm', intensity: 1, uncertain: false, proposed: false, confirmed: true, replaces: null, about: [] }
            ]
        };

        const merged = mergeProposal(decided, { ...LUCIE, feelings: LUCIE.feelings.slice(0, 2) }, lists);

        expect(merged.feelings.map(f => [f.id, f.confirmed, f.intensity])).toEqual([
            ['pleasure', true, 3], ['rapport', false, 3], ['calm', true, 1]
        ]);
        expect(merged.proposedIds).toEqual(['pleasure', 'rapport']);
    });
});

describe('buildProvenance', () => {
    it('reports proposed, accepted, replaced and the edit, and nothing the user did not do', () => {
        const state = cardStateFromProposal(LUCIE, { relationships: lucieRelationships, triggers: [] });
        state.feelings[0].confirmed = true;
        state.feelings[2] = { ...state.feelings[2], id: 'irritation', confirmed: true, replaces: 'stress' };

        expect(buildProvenance(state, {
            runtime: 'web', model: 'm', promptVersion: 1,
            provenance: { dropped_by_filter: 2 }, originalTranscript: LUCIE.transcript
        })).toEqual({
            model: 'm', runtime: 'web', prompt_version: 1,
            proposed: ['pleasure', 'rapport', 'stress'],
            accepted: ['pleasure', 'irritation'],
            replaced: { stress: 'irritation' },
            dropped_by_filter: 2,
            ambiguity: 'none',
            edited_transcript: false
        });
    });
});

describe('ambiguitySentence', () => {
    it('fills the target template from the people and triggers the model found', () => {
        const state = cardStateFromProposal(proposal({
            feelings: [{ id: 'anxiety', intensity: 2, about: [{ kind: 'trigger', label: 'work' }] }],
            people: [{ name: 'Lucie' }],
            ambiguity: 'target'
        }), { relationships: [], triggers: [] });
        expect(ambiguitySentence(state)).toBe('Was that about Lucie, about work, or something else?');
        expect(ambiguitySentence(state, () => 'L.')).toBe('Was that about L., about work, or something else?');
        expect(ambiguitySentence({ ...state, ambiguity: 'none' })).toBeNull();
    });
});
