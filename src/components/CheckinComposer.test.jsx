import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import Journal from './Journal';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider, BLUR_CLASS } from '../context/DiscretionContext';
import { JOURNAL_COPY, MAX_FEELINGS_PER_CHECKIN, fillCopy } from '../constants/journal';

vi.mock('axios');

/**
 * The composer, driven the way a user drives it: from `/journal`, through the button the day
 * view puts on screen, to the request that reaches `POST /api/journal/entries`.
 *
 * Everything asserted here is asserted on **the request body**, not on component state. The
 * shape in §7.2 is a contract with a Go handler that will reject a wrong one at runtime and
 * pass every unit test in this file if the assertions are made one level too high up.
 */

const TODAY = '2026-08-21';

/** Two people, one of whom is only ever reached through the prefix rule (§4.5 step 2). */
const relationships = [
    { ID: 7, name: 'Lucie M', snapshot_count: 0 },
    { ID: 9, name: 'Noor', snapshot_count: 2 }
];

const triggerEntry = {
    ID: 10,
    client_id: 'trig-1',
    kind: 'trigger',
    day: '2026-08-19',
    at: '2026-08-19T09:00:00Z',
    schema_version: 1,
    payload: { v: 1, label: 'the deadline' },
    mentions: []
};

/** Four endpoints (trap 10c). Copied from `Journal.test.jsx`'s helper. */
const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

/** The server echoes the row it stored; here it echoes the request, which is close enough. */
const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 99, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

const renderJournal = (path = '/journal') => render(
    <MemoryRouter initialEntries={[path]}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal" element={<Journal />} />
                        <Route path="/journal/:day" element={<Journal />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

/* The composer's own handles. Queried by attribute rather than by text, because a feeling's
   label is on screen twice once it is picked — once in the grid and once on its card. */
const gridChip = (id) => document.querySelector(`button[data-feeling="${id}"]`);
const pickedCard = (id) => document.querySelector(`[data-picked="${id}"]`);
const addAbout = (id, kind) => document.querySelector(`[data-add-about="${id}:${kind}"]`);
const sentBody = () => axios.post.mock.calls.at(-1)[1];

const openComposer = async () => {
    await screen.findByText(JOURNAL_COPY.empty.today);
    await userEvent.click(document.querySelector('[data-checkin-open="header"]'));
    return screen.getByRole('dialog');
};

const save = () => userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.checkin.save }));

let originalTZ;

beforeAll(() => {
    // Pinned so `tz_offset_min` and the offset on `at` are real assertions rather than
    // whatever the machine running the suite happens to be. `process.env.TZ` takes effect
    // on the next `Date` call in this Node; the guard case below proves it did.
    originalTZ = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
});

afterAll(() => {
    // Assigning `undefined` sets the *string* "undefined" and leaves the process in a zone
    // that does not exist, so an originally-unset TZ has to be deleted.
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
});

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // Only `Date` is faked, so testing-library's own timers still run.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
    mockFetch();
    echoPost();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the guard on the clock these tests assert against', () => {
    it('really is in a zone two hours east of Greenwich in August', () => {
        // Without this, `tz_offset_min: 120` and the `+02:00` on `at` would pass by
        // asserting nothing in particular about the sign convention.
        expect(new Date('2026-08-21T12:00:00Z').getTimezoneOffset()).toBe(-120);
    });
});

describe('the two ways in, §9.2', () => {
    it('puts a header button above md and a round one over the bottom bar below it', async () => {
        renderJournal();
        await screen.findByText(JOURNAL_COPY.empty.today);

        const header = document.querySelector('[data-checkin-open="header"]');
        const fab = document.querySelector('[data-checkin-open="fab"]');

        expect(header).toBeInTheDocument();
        expect(header.className).toContain('hidden md:flex');
        expect(fab).toBeInTheDocument();
        expect(fab.className).toContain('md:hidden');
        // 64 px, and it goes away with the bar when the soft keyboard comes up.
        expect(fab.className).toContain('h-16 w-16');
        expect(fab.className).toContain('alq-hide-on-keyboard');
        expect(fab.getAttribute('style')).toContain('safe-area-inset-bottom');
    });
});

describe('three taps', () => {
    it('records one feeling at the default strength, from chips, with no uncertainty claimed', async () => {
        renderJournal();

        // Tap one: open. Tap two: a word. Tap three: save.
        await openComposer();
        await userEvent.click(gridChip('calm'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(1));
        const [url, body] = axios.post.mock.calls[0];

        expect(url).toBe('/api/journal/entries');
        expect(body.kind).toBe('checkin');
        expect(body.day).toBe(TODAY);
        expect(body.at).toBe('2026-08-21T14:00:00+02:00');
        expect(body.payload.source).toBe('chips');
        expect(body.payload.tz_offset_min).toBe(120);
        expect(body.payload.feelings).toHaveLength(1);
        expect(body.payload.feelings[0].id).toBe('calm');
        expect(body.payload.feelings[0].intensity).toBe(2);
        // Absent, never `false` — invariant 14 applied to a claim the user never made.
        expect(body.payload.feelings[0]).not.toHaveProperty('uncertain');
    });

    it('closes the composer and shows what was recorded on the day', async () => {
        renderJournal();

        await openComposer();
        await userEvent.click(gridChip('calm'));
        await save();

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(document.querySelector('[data-entry-kind="checkin"]')).toBeInTheDocument();
    });
});

describe('strength', () => {
    it('cycles one, two, three and draws dots rather than digits', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('calm'));

        const dots = () => pickedCard('calm').querySelector('[data-intensity]');

        expect(dots()).toHaveAttribute('data-intensity', '2');
        expect(dots().textContent).toBe('··');

        await userEvent.click(dots());
        expect(dots()).toHaveAttribute('data-intensity', '3');
        expect(dots().textContent).toBe('···');

        await userEvent.click(dots());
        expect(dots()).toHaveAttribute('data-intensity', '1');
        expect(dots().textContent).toBe('·');

        await userEvent.click(dots());
        expect(dots().textContent).toBe('··');

        // The rule, asserted rather than eyeballed: nothing the user reads is a number.
        expect(pickedCard('calm').textContent).not.toMatch(/\d/);
    });

    it('sends the strength the dots are showing', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('calm'));
        await userEvent.click(pickedCard('calm').querySelector('[data-intensity]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().payload.feelings[0].intensity).toBe(3);
    });
});

describe('the unsure toggle', () => {
    it('writes uncertain: true, using the same ≈ the sliders use', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('calm'));

        const toggle = within(pickedCard('calm'))
            .getByLabelText(JOURNAL_COPY.checkin.uncertainLabel);
        expect(toggle.textContent).toBe('≈');

        await userEvent.click(toggle);
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        // Drawn dashed, like every other uncertainty in this app.
        expect(pickedCard('calm').querySelector('[data-feeling]'))
            .toHaveAttribute('data-uncertain', 'true');

        await save();
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().payload.feelings[0].uncertain).toBe(true);
    });
});

describe('a person', () => {
    const pickPerson = async (feeling) => {
        await userEvent.click(gridChip(feeling));
        await userEvent.click(addAbout(feeling, 'person'));
    };

    it('sends relationship_id for someone already known', async () => {
        renderJournal();
        await openComposer();
        await pickPerson('rapport');

        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.mentions).toEqual([{ ref: 0, relationship_id: 7, label: 'Lucie M' }]);
        expect(body.payload.feelings[0].about).toEqual([{ kind: 'person', ref: 0 }]);
    });

    it('sends a name and no id for someone brand new', async () => {
        renderJournal();
        await openComposer();
        await pickPerson('rapport');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.personLabel), 'Ada');
        await userEvent.click(document.querySelector('[data-new-person]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().mentions).toEqual([{ ref: 0, name: 'Ada', label: 'Ada' }]);
        expect(sentBody().mentions[0]).not.toHaveProperty('relationship_id');
    });

    it('offers Lucie M for "Lucie" and selects nothing on its own', async () => {
        renderJournal();
        await openComposer();
        await pickPerson('rapport');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.personLabel), 'Lucie');

        // Offered — and offered beside "new person", because the server would not have
        // matched "Lucie" to "Lucie M" either (§4.5).
        expect(screen.getByText(JOURNAL_COPY.people.candidateHint)).toBeInTheDocument();
        expect(document.querySelector('[data-person-candidate="7"]')).toHaveTextContent('Lucie M');
        expect(document.querySelector('[data-new-person]'))
            .toHaveTextContent(fillCopy(JOURNAL_COPY.people.newPerson, { name: 'Lucie' }));
        // Someone the query does not reach is not on the list at all.
        expect(document.querySelector('[data-person-candidate="9"]')).toBeNull();

        // Nothing has been attached to the feeling: invariant 15, structurally.
        expect(pickedCard('rapport').querySelector('[data-about]')).toBeNull();

        await save();
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().mentions).toEqual([]);
    });

    it('resolves an exact name and does not offer to create it a second time', async () => {
        renderJournal();
        await openComposer();
        await pickPerson('rapport');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.personLabel), 'Noor');

        // §4.5 step 1: this is the comparison `FindOrCreateRelationship` makes, so a
        // "new person: Noor?" beside it would offer something the server cannot do.
        expect(document.querySelector('[data-person-candidate="9"]')).toHaveTextContent('Noor');
        expect(document.querySelector('[data-new-person]')).toBeNull();
        expect(screen.queryByText(JOURNAL_COPY.people.candidateHint)).not.toBeInTheDocument();
    });

    it('makes one mention out of two feelings about the same person', async () => {
        renderJournal();
        await openComposer();
        await pickPerson('rapport');
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));
        await pickPerson('joy');
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.mentions).toHaveLength(1);
        expect(body.payload.feelings.map(feeling => feeling.about)).toEqual([
            [{ kind: 'person', ref: 0 }],
            [{ kind: 'person', ref: 0 }]
        ]);
    });
});

describe('a trigger', () => {
    const pickTrigger = async (feeling) => {
        await userEvent.click(gridChip(feeling));
        await userEvent.click(addAbout(feeling, 'trigger'));
    };

    it('sends the client_id of one the user already has', async () => {
        mockFetch({ entries: [triggerEntry] });
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');

        await userEvent.click(document.querySelector('[data-trigger-candidate="trig-1"]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.triggers).toEqual([{ trigger: 'trig-1' }]);
        expect(body.payload.feelings[0].about).toEqual([{ kind: 'trigger', trigger: 'trig-1' }]);
    });

    it('mints a client_id for a new label, and the feeling names that same id', async () => {
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        const offer = document.querySelector('[data-new-trigger]');
        expect(offer).toHaveTextContent(fillCopy(JOURNAL_COPY.triggers.newTrigger, { label: 'work' }));
        // Dashed until confirmed — nothing dashed has been written.
        expect(offer.className).toContain('border-dashed');

        await userEvent.click(offer);
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.triggers).toHaveLength(1);
        expect(body.triggers[0].label).toBe('work');
        expect(body.triggers[0].client_id).toMatch(/^[0-9a-f-]{36}$/i);
        // The half of §7.2 that is easy to get wrong: `about` names the id `triggers[]`
        // mints, or the server answers 400 for a trigger it was never given.
        expect(body.payload.feelings[0].about)
            .toEqual([{ kind: 'trigger', trigger: body.triggers[0].client_id }]);
    });

    it('mints one trigger for two feelings that name it', async () => {
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        await userEvent.click(document.querySelector('[data-new-trigger]'));
        const minted = document.querySelector('[data-about="trigger"]');
        expect(minted).toHaveTextContent('work');

        // The second feeling reaches the same word from the chip list, because a trigger
        // minted a moment ago is already part of this composer's vocabulary. Typing it
        // again would mint a second id and, on save, a second row with the same label.
        await pickTrigger('stress');
        await userEvent.click(within(pickedCard('stress')).getByRole('button', { name: 'work' }));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.triggers).toHaveLength(1);
        expect(body.triggers[0].label).toBe('work');
        const id = body.triggers[0].client_id;
        expect(body.payload.feelings.map(feeling => feeling.about)).toEqual([
            [{ kind: 'trigger', trigger: id }],
            [{ kind: 'trigger', trigger: id }]
        ]);
    });

    it('offers a word it just minted rather than a second "new trigger" for the same label', async () => {
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        await userEvent.click(document.querySelector('[data-new-trigger]'));

        await pickTrigger('stress');
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');

        // An exact match resolves; it is not offered beside an invitation to duplicate it.
        expect(document.querySelector('[data-trigger-candidate]')).toHaveTextContent('work');
        expect(document.querySelector('[data-new-trigger]')).toBeNull();
    });

    it('offers a trigger it minted last time, once the server has answered for it', async () => {
        // The server creates the trigger as its own row inside the entry's transaction and
        // echoes only the entry, so the provider refetches. Without that, the next check-in
        // has no way to reach the word and would mint a second row with the same label.
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        await userEvent.click(document.querySelector('[data-new-trigger]'));

        const minted = { ...triggerEntry, client_id: 'trig-work', payload: { v: 1, label: 'work' } };
        mockFetch({ entries: [minted] });
        await save();

        await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
            '/api/journal/entries', { params: { from: '2026-08-01', to: '2026-08-31' } }
        ));

        await userEvent.click(document.querySelector('[data-checkin-open="header"]'));
        await pickTrigger('stress');
        await waitFor(() => expect(document.querySelector('[data-trigger-candidate="trig-work"]'))
            .toHaveTextContent('work'));

        await userEvent.click(document.querySelector('[data-trigger-candidate="trig-work"]'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalledTimes(2));
        // The second check-in references the row rather than minting a second one.
        expect(sentBody().triggers).toEqual([{ trigger: 'trig-work' }]);
    });

    it('does not refetch for a check-in that minted no trigger', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('calm'));
        const before = axios.get.mock.calls.length;
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(axios.get.mock.calls.length).toBe(before);
    });

    it('mints nothing for a label the user typed and then took away', async () => {
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        await userEvent.click(document.querySelector('[data-new-trigger]'));
        expect(pickedCard('irritation').querySelector('[data-about="trigger"]')).toBeInTheDocument();

        await userEvent.click(within(pickedCard('irritation'))
            .getByLabelText(fillCopy(JOURNAL_COPY.checkin.remove, { label: 'work' })));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().triggers).toEqual([]);
        expect(sentBody().payload.feelings[0].about).toEqual([]);
    });

    it('mints nothing for a label the user typed and never confirmed', async () => {
        renderJournal();
        await openComposer();
        await pickTrigger('irritation');

        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'work');
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().triggers).toEqual([]);
    });

    it('offers a merged trigger under the surviving label only', async () => {
        // "work" was merged into "the job": the correction row carries the old id in
        // `corrects` and names the survivor in `merged_into`, and the row it replaced is in
        // no list the client holds because the server returns only live rows.
        const merged = {
            ...triggerEntry,
            ID: 11,
            client_id: 'trig-work-2',
            payload: { v: 1, label: 'work', corrects: ['trig-work-1'], merged_into: 'trig-1' }
        };
        mockFetch({ entries: [triggerEntry, merged] });

        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('irritation'));
        await userEvent.click(addAbout('irritation', 'trigger'));

        expect(document.querySelector('[data-trigger-candidate="trig-1"]')).toHaveTextContent('the deadline');
        expect(screen.queryByText('work')).not.toBeInTheDocument();
        expect(document.querySelectorAll('[data-trigger-candidate]')).toHaveLength(1);
    });
});

describe('a context tag', () => {
    it('attaches one of the seven the snapshots already use', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('stress'));
        await userEvent.click(addAbout('stress', 'tag'));

        await userEvent.click(within(pickedCard('stress')).getByRole('button', { name: 'conflict' }));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().payload.feelings[0].about).toEqual([{ kind: 'tag', tag: 'conflict' }]);
    });
});

describe('moving a chip between feelings', () => {
    it('takes it off the one it was on and puts it on the other', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('rapport'));
        await userEvent.click(gridChip('joy'));

        await userEvent.click(addAbout('rapport', 'person'));
        await userEvent.click(document.querySelector('[data-person-candidate="9"]'));

        // Tap the chip, then tap the other feeling.
        await userEvent.click(within(pickedCard('rapport'))
            .getByLabelText(fillCopy(JOURNAL_COPY.checkin.pickUp, { label: 'Noor' })));
        expect(screen.getByText(JOURNAL_COPY.checkin.moveHint)).toBeInTheDocument();
        await userEvent.click(document.querySelector('[data-move-here="joy"]'));

        expect(pickedCard('rapport').querySelector('[data-about]')).toBeNull();
        expect(pickedCard('joy').querySelector('[data-about="person"]')).toBeInTheDocument();

        await save();
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        const body = sentBody();
        expect(body.payload.feelings.find(feeling => feeling.id === 'rapport').about).toEqual([]);
        expect(body.payload.feelings.find(feeling => feeling.id === 'joy').about)
            .toEqual([{ kind: 'person', ref: 0 }]);
    });
});

describe('the cap', () => {
    it('is stated, and stops the sixth word rather than dropping it silently', async () => {
        renderJournal();
        await openComposer();

        const five = ['joy', 'calm', 'stress', 'anger', 'pride'];
        for (const id of five) {
            // Sequential on purpose: each tap depends on the state the last one left.
            // eslint-disable-next-line no-await-in-loop
            await userEvent.click(gridChip(id));
        }

        expect(screen.getByText(
            fillCopy(JOURNAL_COPY.checkin.cap, { max: MAX_FEELINGS_PER_CHECKIN }),
            { exact: false }
        )).toBeInTheDocument();
        expect(gridChip('sadness')).toBeDisabled();
        // The ones already picked stay tappable, or the cap would be a trap.
        expect(gridChip('joy')).not.toBeDisabled();

        await userEvent.click(gridChip('sadness'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().payload.feelings.map(feeling => feeling.id)).toEqual(five);
    });
});

describe("can't tell", () => {
    it('saves on its own', async () => {
        renderJournal();
        await openComposer();

        expect(gridChip('unclear').className).toContain('border-dashed');
        await userEvent.click(gridChip('unclear'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().payload.feelings).toEqual([
            { id: 'unclear', intensity: 2, about: [] }
        ]);
    });

    it('stands alone: picking it puts the others down, and picking another puts it down', async () => {
        renderJournal();
        await openComposer();

        await userEvent.click(gridChip('joy'));
        await userEvent.click(gridChip('unclear'));
        expect(pickedCard('joy')).toBeNull();
        expect(pickedCard('unclear')).toBeInTheDocument();

        await userEvent.click(gridChip('sadness'));
        expect(pickedCard('unclear')).toBeNull();
        expect(pickedCard('sadness')).toBeInTheDocument();
    });
});

describe('a save that fails', () => {
    let quiet;

    beforeEach(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => { }); });
    afterEach(() => { quiet.mockRestore(); });

    it('leaves the composer open with every selection intact, and says so', async () => {
        axios.post.mockRejectedValue({ response: { status: 500, data: {} } });

        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('rapport'));
        await userEvent.click(addAbout('rapport', 'person'));
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));
        await userEvent.click(pickedCard('rapport').querySelector('[data-intensity]'));
        await save();

        expect(await screen.findByRole('alert')).toHaveTextContent(JOURNAL_COPY.checkin.saveError);
        // Trap 4: the sheet is still here and so is everything in it.
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(pickedCard('rapport')).toBeInTheDocument();
        expect(pickedCard('rapport').querySelector('[data-intensity]'))
            .toHaveAttribute('data-intensity', '3');
        expect(pickedCard('rapport').querySelector('[data-about="person"]')).toHaveTextContent('Lucie M');
        // And it can be tried again rather than being stuck behind a spinner.
        expect(screen.getByRole('button', { name: JOURNAL_COPY.checkin.save })).not.toBeDisabled();
    });

    it("shows the server's own message when it sent one", async () => {
        axios.post.mockRejectedValue({ response: { status: 400, data: { error: 'feelings[0] needs an intensity' } } });

        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('calm'));
        await save();

        expect(await screen.findByRole('alert')).toHaveTextContent('feelings[0] needs an intensity');
    });
});

describe('under discretion', () => {
    beforeEach(() => { window.localStorage.setItem('alq:discreet', 'true'); });

    it('shows a person chip as initials and blurs the note field', async () => {
        renderJournal();
        await openComposer();
        await userEvent.click(gridChip('rapport'));
        await userEvent.click(addAbout('rapport', 'person'));
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));

        const chip = pickedCard('rapport').querySelector('[data-about="person"]');
        expect(chip).toHaveTextContent('L. M.');
        expect(chip).not.toHaveTextContent('Lucie');

        expect(document.querySelector('[data-composer-note]').className).toContain(BLUR_CLASS);

        // The mask is the cover, so the name is not also blurred — and the record is
        // unaffected: the request still carries the id and the label.
        await save();
        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        expect(sentBody().mentions).toEqual([{ ref: 0, relationship_id: 7, label: 'Lucie M' }]);
    });
});

describe('the composed request', () => {
    it('matches the §6.3 and §7.2 shape key for key', async () => {
        mockFetch({ entries: [triggerEntry] });
        renderJournal();
        await openComposer();

        // A person, a known trigger, a new trigger, a context tag, an unsure feeling, the
        // context tags of the check-in itself, and a note — one of everything the composer
        // can put in a payload.
        await userEvent.click(gridChip('rapport'));
        await userEvent.click(addAbout('rapport', 'person'));
        await userEvent.click(document.querySelector('[data-person-candidate="7"]'));

        await userEvent.click(gridChip('irritation'));
        await userEvent.click(addAbout('irritation', 'trigger'));
        await userEvent.click(document.querySelector('[data-trigger-candidate="trig-1"]'));
        await userEvent.click(addAbout('irritation', 'tag'));
        await userEvent.click(within(pickedCard('irritation')).getByRole('button', { name: 'conflict' }));

        await userEvent.click(gridChip('stress'));
        await userEvent.click(within(pickedCard('stress')).getByLabelText(JOURNAL_COPY.checkin.uncertainLabel));
        await userEvent.click(addAbout('stress', 'trigger'));
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.triggerLabel), 'the move');
        await userEvent.click(document.querySelector('[data-new-trigger]'));

        await userEvent.click(screen.getAllByRole('button', { name: 'milestone' })[0]);
        await userEvent.type(screen.getByLabelText(JOURNAL_COPY.checkin.noteLabel), 'a long afternoon');

        await save();
        await waitFor(() => expect(axios.post).toHaveBeenCalled());

        const body = sentBody();
        const minted = body.triggers[1].client_id;

        // `toEqual` against a literal: an added key, a dropped key or a renamed one fails
        // here rather than at runtime against a Go validator.
        expect(body).toEqual({
            client_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
            kind: 'checkin',
            at: '2026-08-21T14:00:00+02:00',
            day: '2026-08-21',
            schema_version: 1,
            payload: {
                v: 1,
                // A note was typed, so this is §4.1's typed path rather than its chips path.
                source: 'typed',
                tz_offset_min: 120,
                feelings: [
                    {
                        id: 'rapport',
                        intensity: 2,
                        about: [{ kind: 'person', ref: 0 }]
                    },
                    {
                        id: 'irritation',
                        intensity: 2,
                        about: [
                            { kind: 'trigger', trigger: 'trig-1' },
                            { kind: 'tag', tag: 'conflict' }
                        ]
                    },
                    {
                        id: 'stress',
                        intensity: 2,
                        uncertain: true,
                        about: [{ kind: 'trigger', trigger: minted }]
                    }
                ],
                tags: ['milestone'],
                note: 'a long afternoon'
            },
            mentions: [{ ref: 0, relationship_id: 7, label: 'Lucie M' }],
            triggers: [
                { trigger: 'trig-1' },
                { label: 'the move', client_id: minted }
            ],
            supersedes_id: null
        });
    });
});

describe('deleting a check-in from the day view', () => {
    const stored = {
        ID: 11,
        client_id: 'checkin-1',
        kind: 'checkin',
        day: TODAY,
        at: '2026-08-21T16:42:10Z',
        schema_version: 1,
        payload: {
            v: 1,
            source: 'chips',
            feelings: [
                { id: 'rapport', intensity: 2, about: [{ kind: 'person', ref: 0 }] },
                { id: 'unclear', intensity: 1, about: [] }
            ]
        },
        superseded_at: null,
        supersedes_id: null,
        mentions: [{ ID: 1, entry_id: 11, relationship_id: 7, label: 'Lucie M', ref: 0 }]
    };

    it('states what goes before it goes', async () => {
        mockFetch({ entries: [stored] });
        renderJournal(`/journal/${TODAY}`);
        // The day has drawn. Gated on the row rather than on a feeling's label: since B2 the
        // graph's legend names the same feelings the chips do, so a bare `findByText` for one
        // finds two (both correct).
        await screen.findByLabelText(JOURNAL_COPY.checkin.delete.action);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.checkin.delete.action));

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(JOURNAL_COPY.checkin.delete.title)).toBeInTheDocument();
        // The time it was written, the words it holds, and what survives it.
        expect(dialog).toHaveTextContent('18:42');
        expect(dialog).toHaveTextContent("connectedness, can't tell");
        expect(dialog).toHaveTextContent('The people and triggers it named stay where they are.');
        expect(axios.delete).not.toHaveBeenCalled();
    });

    it('deletes on confirm and takes the card off the day', async () => {
        axios.delete.mockResolvedValue({ data: {} });
        mockFetch({ entries: [stored] });
        renderJournal(`/journal/${TODAY}`);
        // The day has drawn. Gated on the row rather than on a feeling's label: since B2 the
        // graph's legend names the same feelings the chips do, so a bare `findByText` for one
        // finds two (both correct).
        await screen.findByLabelText(JOURNAL_COPY.checkin.delete.action);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.checkin.delete.action));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.checkin.delete.confirm }));

        await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/journal/entries/11'));
        await waitFor(() => expect(screen.queryAllByText('connectedness')).toHaveLength(0));
        expect(screen.getByText(JOURNAL_COPY.empty.today)).toBeInTheDocument();
    });

    it('keeps the check-in when the delete is declined', async () => {
        mockFetch({ entries: [stored] });
        renderJournal(`/journal/${TODAY}`);
        // The day has drawn. Gated on the row rather than on a feeling's label: since B2 the
        // graph's legend names the same feelings the chips do, so a bare `findByText` for one
        // finds two (both correct).
        await screen.findByLabelText(JOURNAL_COPY.checkin.delete.action);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.checkin.delete.action));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.checkin.delete.cancel }));

        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getAllByText('connectedness').length).toBeGreaterThan(0);
        expect(axios.delete).not.toHaveBeenCalled();
    });

    it('keeps the dialog open and says so when the delete fails', async () => {
        const quiet = vi.spyOn(console, 'error').mockImplementation(() => { });
        axios.delete.mockRejectedValue({ response: { status: 500, data: {} } });
        mockFetch({ entries: [stored] });
        renderJournal(`/journal/${TODAY}`);
        // The day has drawn. Gated on the row rather than on a feeling's label: since B2 the
        // graph's legend names the same feelings the chips do, so a bare `findByText` for one
        // finds two (both correct).
        await screen.findByLabelText(JOURNAL_COPY.checkin.delete.action);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.checkin.delete.action));
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.checkin.delete.confirm }));

        expect(await screen.findByRole('alert')).toHaveTextContent(JOURNAL_COPY.checkin.delete.error);
        expect(screen.getAllByText('connectedness').length).toBeGreaterThan(0);
        quiet.mockRestore();
    });
});

describe('a check-in composed while a past day is on screen', () => {
    it('lands on today and takes the screen there, rather than saving out of sight', async () => {
        renderJournal('/journal/2026-08-14');
        await screen.findByText(JOURNAL_COPY.empty.pastDay);

        await userEvent.click(document.querySelector('[data-checkin-open="header"]'));
        await userEvent.click(gridChip('calm'));
        await save();

        await waitFor(() => expect(axios.post).toHaveBeenCalled());
        // `at` is the moment and `day` is the civil day it falls in — neither is the day
        // being read (§6.3).
        expect(sentBody().day).toBe(TODAY);
        await waitFor(() => expect(
            document.querySelector('header time[datetime]').getAttribute('datetime')
        ).toBe(TODAY));
    });
});
