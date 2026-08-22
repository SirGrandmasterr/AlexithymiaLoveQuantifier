import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import JournalTriggers from './JournalTriggers';
import Journal from './Journal';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider, BLUR_CLASS } from '../context/DiscretionContext';
import {
    FEELINGS,
    JOURNAL_COPY,
    RITUAL_QUESTIONS,
    countCopy,
    fillCopy,
    mergeTriggerRequest,
    renameTriggerRequest
} from '../constants/journal';

vi.mock('axios');

/**
 * `/journal/triggers` — the vocabulary, and the two corrections it needs.
 *
 * Both corrections are `POST /api/journal/entries` with `supersedes_id` (§7.1), so the
 * assertions here are on **the request body**: there is no rename endpoint to mock and no
 * merge endpoint to mock, and a test that checked what the component thinks it holds would
 * pass over a payload the Go validator rejects.
 */

const relationships = [{ ID: 7, name: 'Lucie', snapshot_count: 0 }];

// Row ids are the server's, and they are what `supersedes_id` names. Distinct per row on
// purpose: two fixtures sharing one id made a merge look like it removed both of them.
let nextRowId = 1;

const trigger = ({ id, label, corrects, mergedInto = null, day = '2026-08-01', rowId }) => ({
    ID: rowId ?? nextRowId++,
    client_id: id,
    kind: 'trigger',
    day,
    at: `${day}T09:00:00Z`,
    schema_version: 1,
    payload: {
        v: 1,
        label,
        merged_into: mergedInto,
        ...(corrects ? { corrects } : {}),
        created_from: 'checkin-0'
    },
    superseded_at: null,
    supersedes_id: null,
    mentions: []
});

let nextId = 500;

/** A check-in whose feelings point at trigger ids — the id as it was written that day. */
const checkin = ({ day, feelings, transcript = null }) => ({
    ID: nextId++,
    client_id: `checkin-${nextId}`,
    kind: 'checkin',
    day,
    at: `${day}T09:00:00Z`,
    schema_version: 1,
    payload: {
        v: 1,
        source: transcript ? 'typed' : 'chips',
        transcript,
        feelings: feelings.map(([feelingId, triggerId]) => ({
            id: feelingId,
            intensity: 2,
            about: triggerId ? [{ kind: 'trigger', trigger: triggerId }] : []
        }))
    },
    superseded_at: null,
    supersedes_id: null,
    mentions: []
});

const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

/** The server echoes the row it stored, with the row id only it can mint. */
const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 9001, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

const renderTriggers = () => render(
    <MemoryRouter initialEntries={['/journal/triggers']}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal/triggers" element={<JournalTriggers />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const renderDay = (day) => render(
    <MemoryRouter initialEntries={[`/journal/${day}`]}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal/:day" element={<Journal />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const rows = () => [...document.querySelectorAll('[data-trigger-row]')];
const row = (id) => document.querySelector(`[data-trigger-row="${id}"]`);
const sentBody = () => axios.post.mock.calls.at(-1)[1];

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
    mockFetch();
    echoPost();
    nextId = 500;
    nextRowId = 1;
});

afterEach(() => {
    vi.useRealTimers();
});

/* ------------------------------------------------------------------------------------ */
/* The list                                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the Triggers view', () => {
    it('counts the check-ins that name a trigger and names its two most-attached feelings', async () => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-work', label: 'work' }),
                trigger({ id: 'trig-move', label: 'the move' }),
                // Two feelings on one check-in about the same trigger: one entry, two
                // feelings counted.
                checkin({ day: '2026-08-02', feelings: [['stress', 'trig-work'], ['anxiety', 'trig-work']] }),
                checkin({ day: '2026-08-03', feelings: [['stress', 'trig-work']] }),
                // Attached to nothing, so it belongs to no trigger's summary.
                checkin({ day: '2026-08-04', feelings: [['joy', null]] }),
                checkin({ day: '2026-08-05', feelings: [['calm', 'trig-move']] })
            ]
        });

        renderTriggers();
        await screen.findByText('work');

        expect(within(row('trig-work')).getByText(countCopy(2, JOURNAL_COPY.triggers.entryCount)))
            .toBeInTheDocument();
        expect(within(row('trig-work')).getByText(
            fillCopy(JOURNAL_COPY.triggers.attached, { feelings: 'stress · anxiety' })
        )).toBeInTheDocument();
        expect(within(row('trig-move')).getByText(countCopy(1, JOURNAL_COPY.triggers.entryCount)))
            .toBeInTheDocument();
    });

    it('breaks a tie by taxonomy order rather than by the order they were written', async () => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-work', label: 'work' }),
                checkin({
                    day: '2026-08-02',
                    feelings: [['anger', 'trig-work'], ['anxiety', 'trig-work'], ['joy', 'trig-work']]
                })
            ]
        });

        renderTriggers();
        await screen.findByText('work');

        const order = FEELINGS.map(feeling => feeling.id);
        expect(order.indexOf('joy')).toBeLessThan(order.indexOf('anxiety'));
        expect(order.indexOf('anxiety')).toBeLessThan(order.indexOf('anger'));
        expect(within(row('trig-work')).getByText(
            fillCopy(JOURNAL_COPY.triggers.attached, { feelings: 'joy · anxiety' })
        )).toBeInTheDocument();
    });

    it('lists the entries that name a trigger when the row is opened', async () => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-work', label: 'work' }),
                checkin({
                    day: '2026-08-02',
                    feelings: [['stress', 'trig-work']],
                    transcript: 'The deadline moved and everything moved with it.'
                }),
                checkin({ day: '2026-08-03', feelings: [['joy', null]] })
            ]
        });

        renderTriggers();
        await screen.findByText('work');

        expect(document.querySelector('[data-trigger-detail]')).toBeNull();
        await userEvent.click(within(row('trig-work')).getByRole('button', {
            name: fillCopy(JOURNAL_COPY.triggers.expand, { label: 'work' })
        }));

        const detail = document.querySelector('[data-trigger-detail]');
        expect(detail).toBeInTheDocument();
        // Only the check-in that names it; the other one is about nothing in particular.
        expect(within(detail).getAllByText(/2026-08-/)).toHaveLength(1);
        expect(within(detail).getByText('2026-08-02')).toBeInTheDocument();
        expect(within(detail).getByText('stress')).toBeInTheDocument();
        expect(within(detail).getByText('The deadline moved and everything moved with it.'))
            .toBeInTheDocument();
    });

    it('offers no delete — a rename or a merge, and nothing that could strand a reference', async () => {
        mockFetch({ entries: [trigger({ id: 'trig-work', label: 'work' })] });

        renderTriggers();
        await screen.findByText('work');

        expect(within(row('trig-work')).getByText(JOURNAL_COPY.triggers.renameAction)).toBeInTheDocument();
        expect(within(row('trig-work')).getByText(JOURNAL_COPY.triggers.mergeAction)).toBeInTheDocument();
        expect(within(row('trig-work')).queryByText(/delete/i)).toBeNull();
    });

    it('blurs every label under discretion', async () => {
        window.localStorage.setItem('alq:discreet', 'true');
        mockFetch({ entries: [trigger({ id: 'trig-work', label: 'work' })] });

        renderTriggers();
        await screen.findByText('work');

        expect(document.querySelector('[data-trigger-label]')).toHaveClass(...BLUR_CLASS.split(' '));
    });
});

/* ------------------------------------------------------------------------------------ */
/* The merge chain                                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * `a → b → c`, as the client actually sees it.
 *
 * Each merge is a **correction row with its own client id**: the row it replaced was
 * superseded server-side and `GET /api/journal/entries` never returns it, so the only link
 * back is `corrects`. Walking one hop at a time would find `m2` and then hit a gap, and every
 * check-in written before the first merge would resolve to nothing.
 */
const twoDeepChain = [
    trigger({ id: 'm1', label: 'work', corrects: ['a'], mergedInto: 'b' }),
    trigger({ id: 'm2', label: 'Arbeit', corrects: ['b'], mergedInto: 'c' }),
    trigger({ id: 'c', label: 'the job' })
];

describe('a two-deep merge chain', () => {
    const withChain = () => mockFetch({
        entries: [
            ...twoDeepChain,
            // Written before the first merge, pointing at the id that was live that day.
            checkin({ day: '2026-08-02', feelings: [['stress', 'a']], transcript: 'Long day.' }),
            // Written between the merges.
            checkin({ day: '2026-08-03', feelings: [['tiredness', 'b']] }),
            checkin({ day: '2026-08-04', feelings: [['stress', 'c']] })
        ]
    });

    it('resolves to the survivor and does not list the merged ids', async () => {
        withChain();
        renderTriggers();

        expect(await screen.findByText('the job')).toBeInTheDocument();
        expect(rows()).toHaveLength(1);
        expect(row('c')).toBeInTheDocument();
        // The two ids that were merged away are not rows, under any label.
        expect(screen.queryByText('work')).not.toBeInTheDocument();
        expect(screen.queryByText('Arbeit')).not.toBeInTheDocument();
        expect(row('m1')).toBeNull();
        expect(row('m2')).toBeNull();
    });

    it('gathers every entry along the chain under the survivor', async () => {
        withChain();
        renderTriggers();
        await screen.findByText('the job');

        // All three, whichever id they were written with.
        expect(within(row('c')).getByText(countCopy(3, JOURNAL_COPY.triggers.entryCount)))
            .toBeInTheDocument();

        await userEvent.click(within(row('c')).getByRole('button', {
            name: fillCopy(JOURNAL_COPY.triggers.expand, { label: 'the job' })
        }));
        const detail = document.querySelector('[data-trigger-detail]');
        expect(within(detail).getByText('2026-08-02')).toBeInTheDocument();
        expect(within(detail).getByText('2026-08-03')).toBeInTheDocument();
        expect(within(detail).getByText('2026-08-04')).toBeInTheDocument();
    });

    it('is resolved by the day view too (A6), since it calls the same reader', async () => {
        withChain();
        renderDay('2026-08-02');

        // The chip reads the survivor's label, not the one the entry was written with.
        // `findAllBy`, because since B2 the day graph's legend names the feeling too.
        expect(await screen.findAllByText('stress')).not.toHaveLength(0);
        expect(document.querySelector('[data-chip="trigger"]')).toHaveTextContent('the job');
        expect(screen.queryByText('work')).not.toBeInTheDocument();
    });

    it('is resolved by the composer too (A7), which offers only the survivor', async () => {
        withChain();
        renderDay('2026-08-21');

        await screen.findByText(JOURNAL_COPY.empty.today);
        await userEvent.click(document.querySelector('[data-checkin-open="header"]'));
        await userEvent.click(document.querySelector('button[data-feeling="stress"]'));
        await userEvent.click(document.querySelector('[data-add-about="stress:trigger"]'));

        // One candidate, and it is the survivor's live id — a new check-in must reference a
        // live trigger or the server answers 404 (§6.3).
        expect(document.querySelector('[data-trigger-candidate="c"]')).toHaveTextContent('the job');
        expect(document.querySelectorAll('[data-trigger-candidate]')).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Rename                                                                                 */
/* ------------------------------------------------------------------------------------ */

describe('rename', () => {
    const openRename = async () => {
        renderTriggers();
        await screen.findByText('work');
        await userEvent.click(within(row('trig-work')).getByText(JOURNAL_COPY.triggers.renameAction));
        return screen.getByRole('dialog');
    };

    beforeEach(() => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-work', label: 'work' }),
                checkin({ day: '2026-08-02', feelings: [['stress', 'trig-work']] })
            ]
        });
    });

    it('posts a correction carrying supersedes_id and the new label', async () => {
        await openRename();

        const field = screen.getByLabelText(JOURNAL_COPY.triggers.rename.label);
        await userEvent.clear(field);
        await userEvent.type(field, 'the job');
        await userEvent.click(document.querySelector('[data-rename-confirm]'));

        await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
        expect(axios.post.mock.calls[0][0]).toBe('/api/journal/entries');

        const body = sentBody();
        expect(body.kind).toBe('trigger');
        // The row-level link, which is a database id the client never mints.
        expect(body.supersedes_id).toBe(1);
        expect(body.payload.label).toBe('the job');
        expect(body.payload.merged_into).toBeNull();
        // Its own client id, and the old one carried in `corrects` so a check-in written
        // before today still resolves.
        expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(body.client_id).not.toBe('trig-work');
        expect(body.payload.corrects).toEqual(['trig-work']);
        // A trigger row mints nothing and names nobody.
        expect(body.triggers).toEqual([]);
        expect(body.mentions).toEqual([]);
    });

    it('updates the list without refetching the subject list', async () => {
        await openRename();

        const before = axios.get.mock.calls.filter(([url]) => url === '/api/subjects').length;

        const field = screen.getByLabelText(JOURNAL_COPY.triggers.rename.label);
        await userEvent.clear(field);
        await userEvent.type(field, 'the job');
        await userEvent.click(document.querySelector('[data-rename-confirm]'));

        // The echoed correction is spliced in and the row it replaced leaves, so the label
        // changes from the response alone.
        expect(await screen.findByText('the job')).toBeInTheDocument();
        expect(screen.queryByText('work')).not.toBeInTheDocument();
        // A trigger is not a person. Nothing about the subject list changed, and asking it
        // again would be a round trip that could only return the same thing.
        expect(axios.get.mock.calls.filter(([url]) => url === '/api/subjects')).toHaveLength(before);
        expect(axios.get.mock.calls.filter(([url]) => url === '/api/relationships')).toHaveLength(before);
    });

    it('keeps the dialog and the typed name when the write fails (trap 4)', async () => {
        axios.post.mockRejectedValue({ response: { status: 500, data: {} } });
        await openRename();

        const field = screen.getByLabelText(JOURNAL_COPY.triggers.rename.label);
        await userEvent.clear(field);
        await userEvent.type(field, 'the job');
        await userEvent.click(document.querySelector('[data-rename-confirm]'));

        expect(await screen.findByRole('alert')).toHaveTextContent(JOURNAL_COPY.triggers.rename.error);
        expect(screen.getByLabelText(JOURNAL_COPY.triggers.rename.label)).toHaveValue('the job');
    });
});

/* ------------------------------------------------------------------------------------ */
/* Merge                                                                                  */
/* ------------------------------------------------------------------------------------ */

describe('merge', () => {
    const openMerge = async () => {
        renderTriggers();
        await screen.findByText('my job');
        await userEvent.click(within(row('trig-mine')).getByText(JOURNAL_COPY.triggers.mergeAction));
        return screen.getByRole('dialog');
    };

    beforeEach(() => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-mine', label: 'my job' }),
                trigger({ id: 'trig-work', label: 'work' }),
                checkin({ day: '2026-08-02', feelings: [['stress', 'trig-mine']] }),
                checkin({ day: '2026-08-03', feelings: [['tiredness', 'trig-mine']] })
            ]
        });
    });

    it('states the count and that it cannot be split apart again', async () => {
        await openMerge();

        // Neither sentence is shown before a target is chosen: "this cannot be undone" is
        // only a sentence about something once there is something.
        expect(document.querySelector('[data-merge-warning]')).toBeNull();

        await userEvent.click(screen.getByRole('radio', { name: /work/ }));

        const warning = document.querySelector('[data-merge-warning]');
        expect(warning).toHaveTextContent(fillCopy(JOURNAL_COPY.triggers.merge.body, {
            from: 'my job', into: 'work', count: 2
        }));
        expect(warning).toHaveTextContent(JOURNAL_COPY.triggers.merge.oneWay);
        expect(JOURNAL_COPY.triggers.merge.oneWay).toContain('cannot be split apart again');
    });

    it('posts a correction naming the survivor in merged_into', async () => {
        await openMerge();
        await userEvent.click(screen.getByRole('radio', { name: /work/ }));
        await userEvent.click(document.querySelector('[data-merge-confirm]'));

        await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
        const body = sentBody();
        expect(body.kind).toBe('trigger');
        expect(body.payload.merged_into).toBe('trig-work');
        // The label is carried, not invented: the user asked to merge, not to rename.
        expect(body.payload.label).toBe('my job');
        expect(body.payload.corrects).toEqual(['trig-mine']);
        expect(body.supersedes_id).toBe(1);
    });

    it('leaves one row, and the merge cannot be undone from the UI', async () => {
        await openMerge();
        await userEvent.click(screen.getByRole('radio', { name: /work/ }));
        await userEvent.click(document.querySelector('[data-merge-confirm]'));

        await waitFor(() => expect(rows()).toHaveLength(1));
        expect(row('trig-work')).toBeInTheDocument();
        expect(screen.queryByText('my job')).not.toBeInTheDocument();
        // Everything that named it now names the survivor.
        expect(within(row('trig-work')).getByText(countCopy(2, JOURNAL_COPY.triggers.entryCount)))
            .toBeInTheDocument();
        // And there is no control anywhere on this screen that would take it apart again.
        expect(screen.queryByText(/unmerge/i)).toBeNull();
        expect(screen.queryByText(/split/i)).toBeNull();
    });

    it('says so when there is nothing to merge into', async () => {
        mockFetch({ entries: [trigger({ id: 'trig-mine', label: 'my job' })] });

        await openMerge();

        expect(screen.getByText(JOURNAL_COPY.triggers.merge.alone)).toBeInTheDocument();
        expect(document.querySelector('[data-merge-confirm]')).toBeDisabled();
    });
});

/* ------------------------------------------------------------------------------------ */
/* The request builders, on their own                                                     */
/* ------------------------------------------------------------------------------------ */

describe('the correction builders', () => {
    const readRow = {
        clientId: 'b',
        label: 'Arbeit',
        live: 'b',
        corrects: ['a'],
        createdFrom: 'checkin-0',
        raw: { ID: 42, client_id: 'b', payload: { v: 1, label: 'Arbeit', corrects: ['a'] } }
    };

    it('carries the predecessor list plus the predecessor, deduped', () => {
        const request = renameTriggerRequest({ trigger: readRow, label: '  the job  ' });

        // Two renames deep: the middle row is superseded and in no list the client holds,
        // so both ids have to travel forward on this row.
        expect(request.payload.corrects).toEqual(['a', 'b']);
        expect(request.payload.label).toBe('the job');
        expect(request.payload.created_from).toBe('checkin-0');
        expect(request.supersedes_id).toBe(42);
        expect(request.schema_version).toBe(1);
        expect(request.payload.v).toBe(1);
    });

    it('names the survivor by its live id, not by the id it was first written with', () => {
        const request = mergeTriggerRequest({
            trigger: readRow,
            // A survivor that has itself been renamed since: `clientId` is what it was
            // looked up as and `live` is what a new row must reference.
            into: { clientId: 'c-old', live: 'c-new', label: 'the job' }
        });

        expect(request.payload.merged_into).toBe('c-new');
        expect(request.payload.label).toBe('Arbeit');
    });
});

/* ------------------------------------------------------------------------------------ */
/* The copy rail (Appendix B item 3)                                                      */
/* ------------------------------------------------------------------------------------ */

const walkStrings = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(walkStrings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(walkStrings);
    return [];
};

/**
 * Everything these screens are allowed to say: the copy object, the closed vocabularies, the
 * words the user themself typed, and the day strings — which are not copy, and are the one
 * thing on screen that is neither a sentence nor a label.
 */
const allowed = (extra = []) => new Set([
    ...walkStrings(JOURNAL_COPY),
    ...FEELINGS.map(feeling => feeling.label),
    ...RITUAL_QUESTIONS.map(question => question.text),
    ...extra
]);

/**
 * A `fillCopy` result cannot be matched against the template it came from — the cost of
 * A5's decision to use templates rather than functions. Rather than listing every filling a
 * test happens to produce, each template becomes a pattern with `.+` where its placeholders
 * were, so the rail still catches a sentence nobody wrote in `JOURNAL_COPY` while a number
 * or a label dropped into one passes.
 */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const filledTemplates = walkStrings(JOURNAL_COPY)
    .filter(text => /\{\w+\}/.test(text))
    .map(text => new RegExp('^' + escapeRegExp(text).replace(/\\\{\w+\\\}/g, '.+') + '$'));

const isFilledTemplate = (text) => filledTemplates.some(pattern => pattern.test(text));

const wordsOnScreen = () => [...document.querySelectorAll('body *')]
    .flatMap(element => [...element.childNodes])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .filter(text => /[A-Za-z]{2,}/.test(text));

describe('no bare strings', () => {
    it('says nothing on the list, the detail or either dialog that is not in JOURNAL_COPY', async () => {
        mockFetch({
            entries: [
                trigger({ id: 'trig-mine', label: 'my job' }),
                trigger({ id: 'trig-work', label: 'work' }),
                checkin({ day: '2026-08-02', feelings: [['stress', 'trig-mine']], transcript: 'A said thing.' }),
                checkin({ day: '2026-08-03', feelings: [['tiredness', 'trig-mine']] })
            ]
        });

        renderTriggers();
        await screen.findByText('my job');

        const labels = ['my job', 'work', 'A said thing.'];
        const prose = () => wordsOnScreen()
            .filter(text => !allowed(labels).has(text) && !isFilledTemplate(text));

        // A guard on the walk itself, and a planted sentence proving the filter looks.
        expect(wordsOnScreen().length).toBeGreaterThan(6);
        const planted = document.createElement('p');
        planted.textContent = 'A sentence nobody put in JOURNAL_COPY.';
        document.body.appendChild(planted);
        expect(prose()).toEqual(['A sentence nobody put in JOURNAL_COPY.']);
        planted.remove();

        expect(prose()).toEqual([]);

        // The detail.
        await userEvent.click(within(row('trig-mine')).getByRole('button', {
            name: fillCopy(JOURNAL_COPY.triggers.expand, { label: 'my job' })
        }));
        expect(prose()).toEqual([]);

        // The rename dialog.
        await userEvent.click(within(row('trig-mine')).getByText(JOURNAL_COPY.triggers.renameAction));
        expect(prose()).toEqual([]);
        await userEvent.click(screen.getByText(JOURNAL_COPY.triggers.rename.cancel));

        // The merge dialog, including the count and the one-way sentence — the two the
        // prompt names, walked here rather than only asserted above.
        await userEvent.click(within(row('trig-mine')).getByText(JOURNAL_COPY.triggers.mergeAction));
        expect(prose()).toEqual([]);
        await userEvent.click(screen.getByRole('radio', { name: /work/ }));
        expect(document.querySelector('[data-merge-warning]')).toBeInTheDocument();
        expect(prose()).toEqual([]);
    });
});
