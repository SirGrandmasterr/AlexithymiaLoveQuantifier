import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import JournalPeople, { JournalPerson } from './JournalPeople';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider, BLUR_CLASS, initials } from '../context/DiscretionContext';
import {
    FEELINGS,
    JOURNAL_COPY,
    JOURNAL_HISTORY_FROM,
    countCopy,
    fillCopy
} from '../constants/journal';

vi.mock('axios');

const relationships = [
    // The journal-only one. The dashboard will not draw her; this screen must.
    { ID: 7, name: 'Lucie', snapshot_count: 0 },
    { ID: 9, name: 'Noor Hassan', snapshot_count: 3 }
];

const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

let nextId = 100;

const checkin = ({ day, at, relationshipId, label = 'Lucie', feelings = [], loose = [], transcript = null }) => ({
    ID: nextId++,
    client_id: `checkin-${nextId}`,
    kind: 'checkin',
    day,
    at: at ?? `${day}T09:00:00Z`,
    schema_version: 1,
    payload: {
        v: 1,
        source: transcript ? 'typed' : 'chips',
        transcript,
        feelings: [
            ...feelings.map(id => ({ id, intensity: 2, about: [{ kind: 'person', ref: 0 }] })),
            ...loose.map(id => ({ id, intensity: 2, about: [] }))
        ]
    },
    superseded_at: null,
    supersedes_id: null,
    mentions: [{ ID: nextId + 500, entry_id: nextId, relationship_id: relationshipId, label, ref: 0 }]
});

const ritual = ({ day, relationshipId, label = 'Lucie' }) => ({
    ID: nextId++,
    client_id: `ritual-${nextId}`,
    kind: 'ritual',
    day,
    at: `${day}T22:30:00Z`,
    schema_version: 1,
    payload: { v: 1, question_set: { version: 1, asked: ['slept_well'] }, answers: { slept_well: true } },
    superseded_at: null,
    supersedes_id: null,
    mentions: [{ ID: nextId + 500, entry_id: nextId, relationship_id: relationshipId, label, ref: 0 }]
});

const personFact = ({ day, relationshipId, text, label = 'Lucie' }) => ({
    ID: nextId++,
    client_id: `fact-${nextId}`,
    kind: 'person_fact',
    day,
    at: `${day}T09:00:00Z`,
    schema_version: 1,
    payload: { v: 1, text, source: 'voice' },
    superseded_at: null,
    supersedes_id: null,
    mentions: [{ ID: nextId + 500, entry_id: nextId, relationship_id: relationshipId, label, ref: 0 }]
});

const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal/people" element={<JournalPeople />} />
                        <Route path="/journal/people/:id" element={<JournalPerson />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const row = (id) => document.querySelector(`[data-person-row="${id}"]`);
const attachedIn = (element) => element?.querySelector('[data-attached-feelings]')?.textContent;

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
    mockFetch();
    nextId = 100;
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the People view', () => {
    it('lists a relationship with no snapshot, and does not link it to a timeline', async () => {
        renderAt('/journal/people');

        expect(await screen.findByText('Lucie')).toBeInTheDocument();

        // Listed. §2.2: the dashboard is snapshot-driven and this screen is not.
        const journalOnly = row(7);
        expect(journalOnly).toBeInTheDocument();
        expect(journalOnly).toHaveAttribute('data-journal-only', 'true');
        // And not linked to a stack that does not exist.
        expect(journalOnly.querySelector('[data-timeline-link]')).toBeNull();
        expect(within(journalOnly).getByText(JOURNAL_COPY.people.journalOnly)).toBeInTheDocument();

        // The one with snapshots gets the link, so the absence above is a decision about
        // this person rather than a feature nobody built.
        const withStack = row(9);
        expect(withStack).toHaveAttribute('data-journal-only', 'false');
        expect(withStack.querySelector('[data-timeline-link]'))
            .toHaveAttribute('href', '/relationships/9/timeline');
    });

    it('loads the whole history rather than the month the day view left behind', async () => {
        renderAt('/journal/people');
        await screen.findByText('Lucie');

        // The counts on this screen are counts of the record. A month's window would make
        // the row — and the remove dialog's sentence — quietly wrong.
        await waitFor(() => {
            expect(axios.get).toHaveBeenCalledWith('/api/journal/entries', {
                params: { from: JOURNAL_HISTORY_FROM, to: '2026-08-21' }
            });
        });
    });

    it('counts the entries that name a person, whatever kind they are', async () => {
        mockFetch({
            entries: [
                checkin({ day: '2026-07-02', relationshipId: 7, feelings: ['calm'] }),
                checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['calm'] }),
                ritual({ day: '2026-08-02', relationshipId: 7 }),
                personFact({ day: '2026-08-03', relationshipId: 7, text: 'moved to Lyon' }),
                // Somebody else's entry does not count towards hers.
                checkin({ day: '2026-08-04', relationshipId: 9, label: 'Noor Hassan', feelings: ['joy'] })
            ]
        });

        renderAt('/journal/people');
        await screen.findByText('Lucie');

        expect(within(row(7)).getByText(countCopy(4, JOURNAL_COPY.people.mentionCount))).toBeInTheDocument();
        expect(within(row(9)).getByText(countCopy(1, JOURNAL_COPY.people.mentionCount))).toBeInTheDocument();
    });

    it('says "1 entry", not "1 entries"', async () => {
        mockFetch({ entries: [checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['calm'] })] });

        renderAt('/journal/people');
        await screen.findByText('Lucie');

        expect(within(row(7)).getByText('1 entry names this person.')).toBeInTheDocument();
        expect(within(row(9)).getByText('0 entries name this person.')).toBeInTheDocument();
    });

    it('names the two feelings most often attached, and only those attached to them', async () => {
        mockFetch({
            entries: [
                checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['irritation', 'calm'] }),
                checkin({ day: '2026-08-02', relationshipId: 7, feelings: ['irritation', 'joy'] }),
                // `loose` is felt on the same day and attached to nobody. It must not reach
                // the summary, or the row would put words in her mouth.
                checkin({ day: '2026-08-03', relationshipId: 7, feelings: ['irritation'], loose: ['anger', 'anger'] })
            ]
        });

        renderAt('/journal/people');
        await screen.findByText('Lucie');

        // irritation ×3 leads; calm and joy are tied at one and the taxonomy breaks it —
        // `joy` is the first entry in FEELINGS and `calm` the eighth.
        expect(attachedIn(row(7))).toBe(fillCopy(JOURNAL_COPY.people.attached, { feelings: 'irritation · joy' }));
    });

    it('breaks a tie by taxonomy order, the same way on every render', async () => {
        // Four feelings, each attached exactly once, deliberately listed back to front.
        const reversed = ['anger', 'anxiety', 'joy', 'excitement'];
        mockFetch({ entries: [checkin({ day: '2026-08-01', relationshipId: 7, feelings: reversed })] });

        renderAt('/journal/people');
        await screen.findByText('Lucie');

        // FEELINGS order, not payload order and not alphabetical.
        const order = FEELINGS.map(feeling => feeling.id);
        expect(order.indexOf('joy')).toBeLessThan(order.indexOf('excitement'));
        expect(attachedIn(row(7))).toBe(fillCopy(JOURNAL_COPY.people.attached, { feelings: 'joy · excitement' }));
    });

    it('says nothing about feelings for a person nothing has been attached to', async () => {
        mockFetch({ entries: [ritual({ day: '2026-08-02', relationshipId: 7 })] });

        renderAt('/journal/people');
        await screen.findByText('Lucie');

        // An empty summary is a claim the screen could not make; it makes none instead.
        expect(row(7).querySelector('[data-attached-feelings]')).toBeNull();
    });

    it('masks every name under discretion', async () => {
        window.localStorage.setItem('alq:discreet', 'true');

        renderAt('/journal/people');

        expect(await screen.findByText(initials('Lucie'))).toBeInTheDocument();
        expect(screen.getByText(initials('Noor Hassan'))).toBeInTheDocument();
        expect(screen.queryByText('Lucie')).not.toBeInTheDocument();
        expect(screen.queryByText('Noor Hassan')).not.toBeInTheDocument();
    });
});

describe('one person', () => {
    const withHistory = () => mockFetch({
        entries: [
            checkin({
                day: '2026-08-01', relationshipId: 7, feelings: ['calm'],
                transcript: 'A long walk, and it was easy the whole way.'
            }),
            personFact({ day: '2026-08-02', relationshipId: 7, text: 'moved to Lyon' }),
            checkin({
                day: '2026-08-03', relationshipId: 7, feelings: ['irritation'],
                transcript: 'The call went badly and I said so.'
            })
        ]
    });

    it('is keyed by id, so it survives a rename made mid-session', async () => {
        withHistory();
        const { rerender } = renderAt('/journal/people/7');

        expect(await screen.findByRole('heading', { name: 'Lucie' })).toBeInTheDocument();
        expect(document.querySelectorAll('[data-mention-entry]')).toHaveLength(2);

        mockFetch({
            rels: [{ ID: 7, name: 'Lucie Moreau', snapshot_count: 0 }, relationships[1]],
            entries: [
                checkin({ day: '2026-08-01', relationshipId: 7, label: 'Lucie', feelings: ['calm'] }),
                personFact({ day: '2026-08-02', relationshipId: 7, label: 'Lucie', text: 'moved to Lyon' }),
                checkin({ day: '2026-08-03', relationshipId: 7, label: 'Lucie', feelings: ['irritation'] })
            ]
        });
        rerender(
            <MemoryRouter initialEntries={['/journal/people/7']}>
                <DiscretionProvider>
                    <SubjectsProvider reloadKey={1}>
                        <JournalProvider reloadKey={1}>
                            <Routes>
                                <Route path="/journal/people/:id" element={<JournalPerson />} />
                            </Routes>
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </MemoryRouter>
        );

        expect(await screen.findByRole('heading', { name: 'Lucie Moreau' })).toBeInTheDocument();
        // The same two mentions and the same one fact — the entries did not move.
        await waitFor(() => expect(document.querySelectorAll('[data-mention-entry]')).toHaveLength(2));
        expect(document.querySelectorAll('[data-fact-entry]')).toHaveLength(1);
    });

    it('lists mentions newest first, with the line that named them, and the facts with their dates', async () => {
        withHistory();
        renderAt('/journal/people/7');

        await screen.findByRole('heading', { name: 'Lucie' });

        const mentions = [...document.querySelectorAll('[data-mention-entry]')];
        expect(mentions).toHaveLength(2);
        expect(within(mentions[0]).getByText('2026-08-03')).toBeInTheDocument();
        expect(within(mentions[0]).getByText('irritation')).toBeInTheDocument();
        expect(within(mentions[0]).getByText('The call went badly and I said so.')).toBeInTheDocument();
        expect(within(mentions[1]).getByText('2026-08-01')).toBeInTheDocument();

        // A fact is not a mention: it goes whole when the person is removed, so it is
        // counted and shown separately.
        const facts = [...document.querySelectorAll('[data-fact-entry]')];
        expect(facts).toHaveLength(1);
        expect(within(facts[0]).getByText('moved to Lyon')).toBeInTheDocument();
        expect(within(facts[0]).getByText('2026-08-02')).toBeInTheDocument();
    });

    it('points at the dashboard for rename, merge and delete rather than repeating them', async () => {
        withHistory();
        renderAt('/journal/people/7');

        expect(await screen.findByText(JOURNAL_COPY.people.stackActions)).toBeInTheDocument();
        // Not a second copy of the stack menu's dialogs.
        expect(screen.queryByText('Rename relationship')).not.toBeInTheDocument();
        expect(screen.queryByText('Merge into…')).not.toBeInTheDocument();
        expect(screen.queryByText('Delete relationship')).not.toBeInTheDocument();
    });

    it('masks the name and blurs the transcript under discretion', async () => {
        window.localStorage.setItem('alq:discreet', 'true');
        withHistory();
        renderAt('/journal/people/7');

        expect(await screen.findByRole('heading', { name: initials('Lucie') })).toBeInTheDocument();
        expect(screen.queryByText('Lucie')).not.toBeInTheDocument();
        expect(document.querySelector('[data-transcript]')).toHaveClass(...BLUR_CLASS.split(' '));
        expect(document.querySelector('[data-fact]')).toHaveClass(...BLUR_CLASS.split(' '));
    });
});

describe('remove this person from the journal', () => {
    const withTwoFactsAndThreeMentions = () => mockFetch({
        entries: [
            checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['calm'] }),
            personFact({ day: '2026-08-02', relationshipId: 7, text: 'moved to Lyon' }),
            checkin({ day: '2026-08-03', relationshipId: 7, feelings: ['irritation'] }),
            personFact({ day: '2026-08-04', relationshipId: 7, text: 'started a new job' }),
            ritual({ day: '2026-08-05', relationshipId: 7 })
        ]
    });

    const openDialog = async () => {
        renderAt('/journal/people/7');
        await screen.findByRole('heading', { name: 'Lucie' });
        await userEvent.click(document.querySelector('[data-remove-person]'));
        return document.querySelector('[data-remove-body]');
    };

    it('states the exact count of what goes, and what stays', async () => {
        withTwoFactsAndThreeMentions();

        const body = await openDialog();

        // Two facts and three entries that merely name her — disjoint, and both stated
        // before anything happens.
        expect(body).toHaveTextContent('2 facts kept about Lucie go.');
        expect(body).toHaveTextContent('3 entries stop being linked to Lucie.');
        expect(screen.getByText(JOURNAL_COPY.people.remove.stays)).toBeInTheDocument();
    });

    it('agrees with its own number — each clause carries its verb', async () => {
        // The bug one run of the real screen found and eleven green tests did not: a single
        // template cannot agree with two counts, and it read "1 entry stop being linked".
        mockFetch({
            entries: [
                checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['calm'] }),
                personFact({ day: '2026-08-02', relationshipId: 7, text: 'moved to Lyon' })
            ]
        });

        const body = await openDialog();

        expect(body).toHaveTextContent('1 fact kept about Lucie goes.');
        expect(body).toHaveTextContent('1 entry stops being linked to Lucie.');
    });

    it('leaves out a clause with nothing to count rather than saying zero', async () => {
        mockFetch({ entries: [checkin({ day: '2026-08-01', relationshipId: 7, feelings: ['calm'] })] });

        const body = await openDialog();

        expect(body).toHaveTextContent('1 entry stops being linked to Lucie.');
        expect(body.textContent).not.toMatch(/0 /);
        expect(body.textContent.trim()).toBe('1 entry stops being linked to Lucie.');
    });

    it('is not offered at all when the journal holds nothing about them', async () => {
        // Reachable: somebody with snapshots who has never been named in a check-in. A
        // button whose dialog would have to say "nothing goes" is worse than no button.
        mockFetch({ entries: [] });

        renderAt('/journal/people/9');
        await screen.findByRole('heading', { name: 'Noor Hassan' });

        expect(document.querySelector('[data-remove-person]')).toBeNull();
    });

    it('issues the right call on confirm', async () => {
        withTwoFactsAndThreeMentions();
        axios.delete.mockResolvedValue({ data: { facts_deleted: 2, mentions_detached: 3 } });

        await openDialog();
        await userEvent.click(document.querySelector('[data-remove-confirm]'));

        // One call, to the journal's own route. Not `DELETE /api/relationships/7`, which
        // is a different action with a different dialog on the dashboard.
        await waitFor(() => expect(axios.delete).toHaveBeenCalledTimes(1));
        expect(axios.delete).toHaveBeenCalledWith('/api/journal/people/7');
        // And the screen reloads what it was showing, because the change is spread across
        // three kinds of entry and a column this client does not hold.
        await waitFor(() => expect(document.querySelector('[data-remove-body]')).toBeNull());
    });

    it('issues nothing when it is cancelled', async () => {
        withTwoFactsAndThreeMentions();

        await openDialog();
        await userEvent.click(screen.getByText(JOURNAL_COPY.people.remove.cancel));

        expect(axios.delete).not.toHaveBeenCalled();
        expect(document.querySelector('[data-remove-body]')).toBeNull();
        // Everything is still on screen.
        expect(document.querySelectorAll('[data-fact-entry]')).toHaveLength(2);
    });

    it('keeps the dialog and its sentence when the write fails (trap 4)', async () => {
        withTwoFactsAndThreeMentions();
        axios.delete.mockRejectedValue({ response: { status: 500, data: {} } });

        await openDialog();
        await userEvent.click(document.querySelector('[data-remove-confirm]'));

        expect(await screen.findByRole('alert')).toHaveTextContent(JOURNAL_COPY.people.remove.error);
        expect(document.querySelector('[data-remove-body]')).toBeInTheDocument();
    });

    it('masks the name in the dialog under discretion', async () => {
        window.localStorage.setItem('alq:discreet', 'true');
        withTwoFactsAndThreeMentions();

        renderAt('/journal/people/7');
        await screen.findByRole('heading', { name: initials('Lucie') });
        await userEvent.click(document.querySelector('[data-remove-person]'));

        expect(document.querySelector('[data-remove-body]')).toHaveTextContent(initials('Lucie'));
    });
});
