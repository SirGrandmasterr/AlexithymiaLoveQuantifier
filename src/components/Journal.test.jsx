import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';
import Journal from './Journal';
import MobileBottomNav from './MobileBottomNav';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider, BLUR_CLASS } from '../context/DiscretionContext';
import {
    JOURNAL_COPY,
    JOURNAL_RECORD_PATH,
    JOURNAL_STORAGE_KEYS,
    PEOPLE_PATH,
    TRIGGERS_PATH
} from '../constants/journal';
import { fakeKit } from './voiceKit.fake';

vi.mock('axios');

const voiceState = vi.hoisted(() => ({ showMicrophone: false, primed: true }));

vi.mock('./VoiceCheckin', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        useVoiceAvailability: () => ({ ...actual.useVoiceAvailability(), ...voiceState }),
        createVoiceKit: () => voiceState.kit
    };
});

const TODAY = '2026-08-21';

const relationships = [{ ID: 7, name: 'Lucie', snapshot_count: 0 }];

const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

const checkin = {
    ID: 11,
    user_id: 1,
    client_id: 'checkin-1',
    kind: 'checkin',
    day: TODAY,
    at: '2026-08-21T16:42:10Z',
    schema_version: 1,
    payload: {
        v: 1,
        source: 'typed',
        tz_offset_min: 120,
        transcript: 'A slow afternoon, and the thing at work is still there.',
        tags: ['conflict'],
        feelings: [
            { id: 'rapport', intensity: 2, uncertain: false, about: [{ kind: 'person', ref: 0 }] },
            { id: 'irritation', intensity: 1, uncertain: false, about: [{ kind: 'trigger', trigger: 'trig-1' }] },
            { id: 'unclear', about: [] }
        ]
    },
    superseded_at: null,
    supersedes_id: null,
    mentions: [{ ID: 1, entry_id: 11, relationship_id: 7, label: 'Lucie', ref: 0 }]
};

const triggerEntry = {
    ID: 10,
    client_id: 'trig-1',
    kind: 'trigger',
    day: TODAY,
    at: '2026-08-21T09:00:00Z',
    schema_version: 1,
    payload: { v: 1, label: 'the deadline' },
    mentions: []
};

const ritualEntry = {
    ID: 12,
    client_id: 'ritual-1',
    kind: 'ritual',
    day: TODAY,
    at: '2026-08-21T22:30:00Z',
    schema_version: 1,
    payload: {
        v: 1,
        question_set: { version: 1, asked: ['slept_well', 'moved_body', 'with_people'] },
        // `with_people` was shown and left unanswered: absent, never false (invariant 14).
        answers: { slept_well: true, moved_body: false },
        day_word: { id: 'calm', uncertain: false },
        rollover_hour: 4
    },
    mentions: [{ ID: 2, entry_id: 12, relationship_id: 7, label: 'Lucie', ref: 0 }]
};

const renderAt = (path) => render(
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

const dayShown = () => document.querySelector('header time[datetime]')?.getAttribute('datetime');

const rows = async () => {
    await waitFor(() => expect(document.querySelector('[data-entry-kind="checkin"]')).toBeInTheDocument());
    return within(document.querySelector('[data-entry-kind="checkin"]').parentElement);
};

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    // Only `Date` is faked, so testing-library's own timers still run. 12:00 UTC is safely
    // past the 04:00 rollover in every zone this suite could run in.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-21T12:00:00Z'));
    mockFetch();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('the day view', () => {
    it("renders a check-in's feelings, its person chip and its trigger chip", async () => {
        mockFetch({ entries: [triggerEntry, checkin] });

        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        // The label the constant carries, not the id: "rapport" is stored, "connectedness"
        // is shown.
        expect(day.getByText('connectedness')).toBeInTheDocument();
        expect(day.getByText('irritation')).toBeInTheDocument();
        // The person, by the relationship's current name.
        expect(screen.getByText('Lucie')).toBeInTheDocument();
        // The trigger, resolved from the id the check-in stored to the word it means.
        expect(screen.getByText('the deadline')).toBeInTheDocument();
        // And the context tag it carried.
        expect(screen.getByText('conflict')).toBeInTheDocument();
    });

    it('shows the time and the transcript line when there is one', async () => {
        mockFetch({ entries: [checkin] });

        renderAt(`/journal/${TODAY}`);
        await rows();

        expect(document.querySelector(`time[datetime="${checkin.at}"]`)).toBeInTheDocument();
        expect(screen.getByText(checkin.payload.transcript)).toBeInTheDocument();
    });

    it('draws an unclear feeling dashed, and a plain one solid', async () => {
        mockFetch({ entries: [checkin] });

        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        const unclear = day.getByText("can't tell").closest('[data-feeling]');
        expect(unclear).toHaveAttribute('data-uncertain', 'true');
        expect(unclear.className).toContain('border-dashed');

        const solid = day.getByText('connectedness').closest('[data-feeling]');
        expect(solid).toHaveAttribute('data-uncertain', 'false');
        expect(solid.className).not.toContain('border-dashed');
    });

    it('marks a feeling the user was unsure of dashed, and leaves false and absent solid', async () => {
        mockFetch({ entries: [{
            ...checkin,
            payload: { v: 1, feelings: [
                { id: 'calm', uncertain: true, about: [] },
                { id: 'joy', uncertain: false, about: [] },
                { id: 'pride', about: [] }
            ] }
        }] });

        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        expect(day.getByText('calm').closest('[data-feeling]').className).toContain('border-dashed');
        expect(day.getByText('joy').closest('[data-feeling]').className).not.toContain('border-dashed');
        expect(day.getByText('pride').closest('[data-feeling]').className).not.toContain('border-dashed');
    });

    it("renders the ritual's answers as the day's footer, under the check-ins", async () => {
        mockFetch({ entries: [checkin, ritualEntry] });

        renderAt(`/journal/${TODAY}`);
        await screen.findByText(JOURNAL_COPY.day.ritualHeading);

        const ritual = screen.getByText(JOURNAL_COPY.day.ritualHeading).closest('[data-entry-kind]');
        expect(within(ritual).getByText('Slept well last night?')).toBeInTheDocument();
        expect(within(ritual).getByText(JOURNAL_COPY.ritual.yes)).toBeInTheDocument();
        expect(within(ritual).getByText(JOURNAL_COPY.ritual.no)).toBeInTheDocument();
        // Shown and not answered — never rendered as a "no".
        expect(within(ritual).getByText(JOURNAL_COPY.day.unanswered)).toBeInTheDocument();
        // The day word, as a feeling chip like any other.
        expect(within(ritual).getByText('calm')).toBeInTheDocument();

        const kinds = [...document.querySelectorAll('[data-entry-kind]')]
            .map(node => node.getAttribute('data-entry-kind'));
        expect(kinds).toEqual(['checkin', 'ritual']);
    });

    it('draws the day graph by hand, and never through a chart library', async () => {
        mockFetch({ entries: [checkin] });

        renderAt(`/journal/${TODAY}`);
        await rows();

        // A6 left a slot here and B2 filled it. Recharts draws nothing under jsdom, which is
        // why §8.3 keeps it out of this screen — and why the assertion below can be made.
        expect(document.querySelector('svg.recharts-surface')).toBeNull();
        expect(document.querySelector('[data-day-curve]')).toBeInTheDocument();
    });
});

describe('the empty states, §9.4', () => {
    it('says what a check-in is when today has nothing on it', async () => {
        renderAt('/journal');

        expect(await screen.findByText(JOURNAL_COPY.empty.today)).toBeInTheDocument();
    });

    it('offers the ritual once, on a journal that has never been used', async () => {
        renderAt('/journal');

        await screen.findByText(JOURNAL_COPY.empty.today);
        expect(screen.getByText(JOURNAL_COPY.empty.firstRun)).toBeInTheDocument();
    });

    it('stops offering it once the ritual has been decided on this device', async () => {
        window.localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, 'false');

        renderAt('/journal');

        await screen.findByText(JOURNAL_COPY.empty.today);
        expect(screen.queryByText(JOURNAL_COPY.empty.firstRun)).not.toBeInTheDocument();
    });

    it('stops offering it once the journal holds anything at all', async () => {
        mockFetch({ entries: [{ ...checkin, day: '2026-08-19' }] });

        renderAt('/journal');

        await screen.findByText(JOURNAL_COPY.empty.today);
        expect(screen.queryByText(JOURNAL_COPY.empty.firstRun)).not.toBeInTheDocument();
    });

    it('says only that nothing was recorded on a past day', async () => {
        renderAt('/journal/2026-08-14');

        expect(await screen.findByText(JOURNAL_COPY.empty.pastDay)).toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.empty.today)).not.toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.empty.firstRun)).not.toBeInTheDocument();
    });
});

/* The day graph, in the slot A6 left for it (B2) */

describe('the day graph in its slot', () => {
    it('draws the day above the check-ins it was drawn from', async () => {
        mockFetch({ entries: [triggerEntry, checkin] });

        renderAt(`/journal/${TODAY}`);
        await rows();

        const graph = document.querySelector('[data-day-graph]');
        expect(graph).toBeInTheDocument();
        // Three feelings at one moment are three branches leaving the trunk together.
        expect(graph.querySelectorAll('[data-day-curve] path')).toHaveLength(3);

        // Above the list, which is where the slot was: the drawing answers *when*, the row
        // under it answers *what about*.
        const row = document.querySelector('[data-entry-kind="checkin"]');
        expect(graph.compareDocumentPosition(row)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('draws nothing at all on a day with nothing in it', async () => {
        renderAt('/journal');

        await screen.findByText(JOURNAL_COPY.empty.today);
        // Not an empty frame above an empty state: the day says it once.
        expect(document.querySelector('[data-day-graph]')).toBeNull();
    });

    it('rings the check-in a branch came from when the branch is tapped', async () => {
        mockFetch({ entries: [triggerEntry, checkin] });

        renderAt(`/journal/${TODAY}`);
        await rows();

        expect(document.querySelector('[data-entry-kind="checkin"][data-opened]')).toBeNull();

        await userEvent.click(document.querySelector('[data-day-curve] [role="button"]'));

        expect(document.querySelector('[data-entry-kind="checkin"][data-opened="true"]')).toBeInTheDocument();
    });
});

describe('walking the days', () => {
    it('steps back across a month boundary', async () => {
        renderAt('/journal/2026-08-01');
        await screen.findByText(JOURNAL_COPY.empty.pastDay);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.day.previous));

        await waitFor(() => expect(dayShown()).toBe('2026-07-31'));
    });

    it('steps forward across a month boundary', async () => {
        renderAt('/journal/2026-08-31');
        await screen.findByText(JOURNAL_COPY.empty.pastDay);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.day.next));

        await waitFor(() => expect(dayShown()).toBe('2026-09-01'));
    });

    it('reloads the month around the day it moved to', async () => {
        renderAt('/journal/2026-08-01');
        await screen.findByText(JOURNAL_COPY.empty.pastDay);

        await userEvent.click(screen.getByLabelText(JOURNAL_COPY.day.previous));

        await waitFor(() => expect(axios.get).toHaveBeenCalledWith(
            '/api/journal/entries', { params: { from: '2026-07-01', to: '2026-07-31' } }
        ));
    });

    it('offers a way back to today, and does not offer it on today', async () => {
        renderAt('/journal/2026-08-14');
        await screen.findByText(JOURNAL_COPY.empty.pastDay);
        expect(screen.getByText(JOURNAL_COPY.day.today)).toBeInTheDocument();

        await userEvent.click(screen.getByText(JOURNAL_COPY.day.today));

        await waitFor(() => expect(dayShown()).toBe(TODAY));
        expect(screen.queryByText(JOURNAL_COPY.day.today)).not.toBeInTheDocument();
    });

    it('marks the days of the month that have something on them', async () => {
        mockFetch({ days: [
            { day: '2026-08-19', checkins: 2, ritual: false, people: 1 },
            { day: '2026-08-20', checkins: 0, ritual: false, people: 0 }
        ] });

        renderAt(`/journal/${TODAY}`);
        await screen.findByText(JOURNAL_COPY.empty.today);

        const strip = screen.getByRole('navigation', { name: JOURNAL_COPY.day.month });
        expect(within(strip).getByLabelText('2026-08-19').querySelector('[data-marked]')).toBeInTheDocument();
        expect(within(strip).getByLabelText('2026-08-20').querySelector('[data-marked]')).toBeNull();
        // A month has as many cells as it has days.
        expect(within(strip).getAllByRole('link')).toHaveLength(31);
    });

    it('sends a path that is not a day back to today rather than drawing an invalid date', async () => {
        renderAt('/journal/not-a-day');

        await waitFor(() => expect(dayShown()).toBe(TODAY));
    });
});

describe('under discretion', () => {
    beforeEach(() => {
        window.localStorage.setItem('alq:discreet', 'true');
        mockFetch({ entries: [triggerEntry, checkin, ritualEntry] });
    });

    it('masks names to initials and leaves the feelings alone', async () => {
        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        expect(screen.queryByText('Lucie')).not.toBeInTheDocument();
        expect(screen.getAllByText('L.').length).toBeGreaterThan(0);
        // Feelings and their colours are unaffected: the graph and the chips carry no name.
        expect(day.getByText('connectedness')).toBeInTheDocument();
        expect(day.getByText("can't tell")).toBeInTheDocument();
        // And the graph keeps drawing, because it never had a name in it to hide (§9.6).
        expect(document.querySelector('[data-day-curve]')).toBeInTheDocument();
    });

    it('blurs the transcript and the trigger label, not the feeling chips', async () => {
        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        expect(document.querySelector('[data-transcript]').className).toContain(BLUR_CLASS);
        expect(screen.getByText('the deadline').className).toContain(BLUR_CLASS);
        expect(day.getByText('connectedness').closest('[data-feeling]').className)
            .not.toContain(BLUR_CLASS);
    });
});

describe('a load that fails', () => {
    let quiet;

    beforeEach(() => { quiet = vi.spyOn(console, 'error').mockImplementation(() => { }); });
    afterEach(() => { quiet.mockRestore(); });

    it("surfaces the error in the screen's own slot and keeps drawing the day", async () => {
        axios.get.mockImplementation((url) => (
            url.startsWith('/api/journal')
                ? Promise.reject(new Error('network down'))
                : Promise.resolve({ data: url === '/api/relationships' ? relationships : [] })
        ));

        renderAt(`/journal/${TODAY}`);

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(JOURNAL_COPY.day.loadError);
        // The page is not blank: the header, the strip and the empty state are all still here.
        expect(dayShown()).toBe(TODAY);
        expect(screen.getByRole('navigation', { name: JOURNAL_COPY.day.month }).children.length).toBe(31);
        expect(screen.getByText(JOURNAL_COPY.empty.today)).toBeInTheDocument();
    });

    it('can be put away without the day going with it', async () => {
        axios.get.mockImplementation((url) => (
            url.startsWith('/api/journal')
                ? Promise.reject(new Error('network down'))
                : Promise.resolve({ data: url === '/api/relationships' ? relationships : [] })
        ));

        renderAt(`/journal/${TODAY}`);
        await screen.findByRole('alert');

        await userEvent.click(screen.getByText(JOURNAL_COPY.day.dismiss));

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(dayShown()).toBe(TODAY);
    });
});

describe('the way in to the two vocabularies', () => {
    it('links the day to People and to Triggers', async () => {
        renderAt(`/journal/${TODAY}`);
        await screen.findByText(JOURNAL_COPY.empty.today);

        const links = screen.getByRole('navigation', { name: JOURNAL_COPY.nav.label });
        expect(within(links).getByRole('link', { name: JOURNAL_COPY.people.heading }))
            .toHaveAttribute('href', PEOPLE_PATH);
        expect(within(links).getByRole('link', { name: JOURNAL_COPY.triggers.heading }))
            .toHaveAttribute('href', TRIGGERS_PATH);
    });
});

describe('MobileBottomNav', () => {
    const renderNav = (path) => render(
        <MemoryRouter initialEntries={[path]}>
            <MobileBottomNav />
        </MemoryRouter>
    );

    it('has five slots: four destinations and discretion', () => {
        renderNav('/');

        const nav = screen.getByRole('navigation', { name: 'Primary' });
        expect(within(nav).getAllByRole('listitem')).toHaveLength(5);
        expect(within(nav).getByRole('link', { name: JOURNAL_COPY.nav.label })).toBeInTheDocument();
    });

    it('lights Journal on a day path, and nothing else', () => {
        renderNav(`/journal/${TODAY}`);

        const nav = screen.getByRole('navigation', { name: 'Primary' });
        expect(within(nav).getByRole('link', { name: JOURNAL_COPY.nav.label }))
            .toHaveAttribute('aria-current', 'page');
        expect(within(nav).getByRole('link', { name: 'Analysis' })).not.toHaveAttribute('aria-current');
        expect(within(nav).getByRole('link', { name: 'Vault' })).not.toHaveAttribute('aria-current');
    });

    it('lights Journal on every /journal path, not only the day view', () => {
        renderNav('/journal/people/3');

        const nav = screen.getByRole('navigation', { name: 'Primary' });
        expect(within(nav).getByRole('link', { name: JOURNAL_COPY.nav.label }))
            .toHaveAttribute('aria-current', 'page');
    });
});

/* F1 — what a queued entry looks like on the day (§9.5) */

const platformState = vi.hoisted(() => ({ native: false }));

vi.mock('../mobile/platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

const OUTBOX_KEY = 'alq:journal-outbox';

/** One entry in the outbox on the device, as a relaunched app would find it. */
const queued = (overrides = {}) => ({
    client_id: 'queued-1',
    queued_at: 1_755_000_000_000,
    error: null,
    request: {
        client_id: 'queued-1',
        kind: 'checkin',
        at: '2026-08-21T18:42:10Z',
        day: TODAY,
        schema_version: 1,
        payload: {
            v: 1,
            source: 'typed',
            tz_offset_min: 120,
            note: 'On the train, no signal.',
            feelings: [{ id: 'calm', intensity: 2, about: [] }]
        },
        mentions: [],
        triggers: [],
        supersedes_id: null
    },
    ...overrides
});

describe('an entry saved with no connectivity', () => {
    beforeEach(() => {
        platformState.native = true;
    });

    afterEach(() => {
        platformState.native = false;
    });

    it('is on the day, with the not yet synced mark', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        expect(day.getByText('On the train, no signal.')).toBeInTheDocument();
        expect(day.getByText(JOURNAL_COPY.day.notSynced)).toBeInTheDocument();
        expect(document.querySelector('[data-entry-kind="checkin"][data-pending="true"]')).toBeInTheDocument();
    });

    it('is still there after the app is killed and relaunched', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        const first = renderAt(`/journal/${TODAY}`);
        await rows();
        first.unmount();

        // Nothing is handed across: the second mount reads the device, as a cold start does.
        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        expect(day.getByText('On the train, no signal.')).toBeInTheDocument();
        expect(day.getByText(JOURNAL_COPY.day.notSynced)).toBeInTheDocument();
    });

    it('offers no delete control, because there is no offline delete', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        renderAt(`/journal/${TODAY}`);
        await rows();

        const pending = document.querySelector('[data-entry-kind="checkin"][data-pending="true"]');
        expect(within(pending).queryByLabelText(JOURNAL_COPY.checkin.delete.action)).toBeNull();
        expect(within(pending).getByText(JOURNAL_COPY.day.notSynced)).toBeInTheDocument();
    });

    it('keeps the day out of its empty state', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        renderAt(`/journal/${TODAY}`);
        await rows();

        // A day the user wrote a check-in on is not a day with nothing on it, whatever the
        // radio was doing at the time.
        expect(screen.queryByText(JOURNAL_COPY.empty.today)).toBeNull();
        expect(screen.queryByText(JOURNAL_COPY.empty.pastDay)).toBeNull();
    });

    it('marks its day in the month strip', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        renderAt(`/journal/${TODAY}`);
        await rows();

        const cell = screen.getByLabelText(TODAY);
        expect(cell.querySelector('[data-marked]')).toBeInTheDocument();
    });

    it('says what the server said when the server refused it', async () => {
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued({ error: 'unknown feeling id: bliss' })]));

        renderAt(`/journal/${TODAY}`);
        const day = await rows();

        // Not "not yet synced" — that would be a promise the code cannot keep, since this
        // body will be refused again. The entry stays on the screen and says why.
        expect(day.queryByText(JOURNAL_COPY.day.notSynced)).toBeNull();
        expect(day.getByText('Not sent — unknown feeling id: bliss')).toBeInTheDocument();
    });

    it('does not exist on the web, where a failed save says so instead', async () => {
        platformState.native = false;
        window.localStorage.setItem(OUTBOX_KEY, JSON.stringify([queued()]));

        renderAt(`/journal/${TODAY}`);

        await waitFor(() => expect(screen.getByText(JOURNAL_COPY.empty.today)).toBeInTheDocument());
        expect(screen.queryByText(JOURNAL_COPY.day.notSynced)).toBeNull();
    });
});

/* F2 — the launcher's Check in shortcut (§9.2) */

describe('arriving from the launcher shortcut', () => {
    beforeEach(() => {
        mockFetch({});
        voiceState.showMicrophone = false;
        voiceState.primed = true;
        voiceState.kit = fakeKit();
    });

    afterEach(() => {
        voiceState.showMicrophone = false;
        voiceState.primed = true;
    });

    it('arms the recording rather than starting it', async () => {
        voiceState.showMicrophone = true;

        renderAt(JOURNAL_RECORD_PATH);

        // The sheet is up and the microphone is on it, waiting.
        const button = await waitFor(() => {
            const found = document.querySelector('[data-voice-record]');
            expect(found).not.toBeNull();
            return found;
        });
        expect(document.querySelector('[data-voice-block="capture"]')).toBeInTheDocument();
        expect(button).toHaveAttribute('aria-pressed', 'false');

        // Nothing was recorded by arriving. §4.2: the microphone is open only while the
        // button is lit, and a long-press on a home screen is not a decision to record.
        expect(voiceState.kit.recorder.tap).not.toHaveBeenCalled();
        expect(voiceState.kit.recorder.start).not.toHaveBeenCalled();

        // One confirming tap, and then it starts.
        await userEvent.click(button);
        expect(voiceState.kit.recorder.tap).toHaveBeenCalledTimes(1);
    });

    it('opens the chips composer where the device offers no microphone', async () => {
        voiceState.showMicrophone = false;

        renderAt(JOURNAL_RECORD_PATH);

        expect(await screen.findByText(JOURNAL_COPY.checkin.prompt)).toBeInTheDocument();
        expect(document.querySelector('[data-voice-record]')).toBeNull();
    });

    it('waits for the tier before deciding which one to arm', async () => {
        voiceState.primed = false;
        voiceState.showMicrophone = false;

        renderAt(JOURNAL_RECORD_PATH);
        await waitFor(() => expect(screen.getByText(JOURNAL_COPY.empty.today)).toBeInTheDocument());
        expect(screen.queryByText(JOURNAL_COPY.checkin.prompt)).toBeNull();
    });

    it('opens nothing without the parameter', async () => {
        renderAt('/journal');

        await waitFor(() => expect(screen.getByText(JOURNAL_COPY.empty.today)).toBeInTheDocument());
        expect(screen.queryByText(JOURNAL_COPY.checkin.prompt)).toBeNull();
    });

    it('consumes the parameter, so closing the sheet does not re-open it', async () => {
        const Where = () => <output data-where>{useLocation().search}</output>;

        render(
            <MemoryRouter initialEntries={[JOURNAL_RECORD_PATH]}>
                <DiscretionProvider>
                    <SubjectsProvider>
                        <JournalProvider>
                            <Where />
                            <Routes>
                                <Route path="/journal" element={<Journal />} />
                            </Routes>
                        </JournalProvider>
                    </SubjectsProvider>
                </DiscretionProvider>
            </MemoryRouter>
        );

        await screen.findByText(JOURNAL_COPY.checkin.prompt);
        // The query is gone from the URL, so a reload, a back gesture out of the sheet, or a
        // second render of this screen finds an ordinary /journal.
        await waitFor(() => expect(document.querySelector('[data-where]')).toHaveTextContent(''));

        await userEvent.keyboard('{Escape}');
        await waitFor(() => expect(screen.queryByText(JOURNAL_COPY.checkin.prompt)).toBeNull());
    });
});
