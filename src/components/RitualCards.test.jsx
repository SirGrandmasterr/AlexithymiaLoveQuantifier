import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';

import RitualCards, { gestureIntent } from './RitualCards';
import Dashboard from './Dashboard';
import Journal from './Journal';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider } from '../context/DiscretionContext';
import {
    FEELINGS,
    JOURNAL_COPY,
    JOURNAL_STORAGE_KEYS,
    RITUAL_QUESTIONS,
    coreQuestions
} from '../constants/journal';

vi.mock('axios');

// jsdom has no vibration motor and no AudioContext, and what is worth asserting is *when* a
// tick fires and when it must not — the same reason `VaultKnob.test.jsx` mocks this module.
vi.mock('../mobile/knobFeedback', () => ({
    startTurn: vi.fn(),
    detent: vi.fn(),
    endTurn: vi.fn()
}));

import { detent } from '../mobile/knobFeedback';

const NIGHT = new Date('2026-08-21T21:00:00Z');
const EVENING_BEFORE_THE_HOUR = new Date('2026-08-21T15:00:00Z');
const TODAY = '2026-08-21';

let originalTZ;

beforeAll(() => {
    originalTZ = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
});

afterAll(() => {
    // Assigning `undefined` sets the *string* "undefined" and leaves the process in a zone
    // that does not exist, so an originally-unset TZ has to be deleted (A5's warning).
    if (originalTZ === undefined) delete process.env.TZ;
    else process.env.TZ = originalTZ;
});

// A guard on the pin itself: without it every offset assertion below would pass on a runner
// that already sits at +02:00, while proving nothing.
it('runs with the time zone this file pins', () => {
    expect(new Date('2026-08-21T21:00:00Z').getTimezoneOffset()).toBe(-120);
});

const relationships = [
    { ID: 7, name: 'Lucie M', snapshot_count: 0 },
    { ID: 9, name: 'Noor', snapshot_count: 2 }
];

const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

const echoPost = () => axios.post.mockImplementation((url, body) => Promise.resolve({
    data: { ID: 99, user_id: 1, superseded_at: null, ...body, mentions: [] }
}));

const renderRitual = () => render(
    <MemoryRouter initialEntries={['/journal/ritual']}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal" element={<Journal />} />
                        <Route path="/journal/ritual" element={<RitualCards />} />
                        <Route path="/journal/:day" element={<Journal />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const card = () => document.querySelector('[data-ritual-card]');
const stepId = () => document.querySelector('[data-ritual-step]')?.getAttribute('data-ritual-step');
const posted = (kind) => axios.post.mock.calls.map(call => call[1]).filter(body => body.kind === kind);

/** 200 px in a direction — past the 48 px floor the threshold falls back to when unmeasured. */
const swipe = (direction) => {
    const target = card();
    const [dx, dy] = { right: [200, 0], left: [-200, 0], up: [0, -200], down: [0, 200] }[direction];

    fireEvent.pointerDown(target, { pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(target, { pointerId: 1, clientX: dx / 2, clientY: dy / 2 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: dx, clientY: dy });
};

const tapCard = () => {
    const target = card();
    fireEvent.pointerDown(target, { pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.pointerUp(target, { pointerId: 1, clientX: 40, clientY: 40 });
    fireEvent.click(target);
};

const pressKey = (key) => fireEvent.keyDown(window, { key });

/** Swipe through the five core questions, answering each the same way. */
const answerCoreFive = (direction = 'right') => {
    coreQuestions().forEach(() => swipe(direction));
};

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    // Only `Date`: `setTimeout` stays real, or `userEvent` and `waitFor` stop working
    // (A6's warning).
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NIGHT);
    mockFetch();
    echoPost();
});

afterEach(() => {
    vi.useRealTimers();
});

/* The deck */

describe('the question set', () => {
    it('asks the five core questions in the fixed order', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        const seen = [];
        coreQuestions().forEach(() => {
            seen.push(stepId());
            swipe('right');
        });

        expect(seen).toEqual([
            'question:slept_well',
            'question:moved_body',
            'question:daylight',
            'question:with_people',
            'question:ate_regularly'
        ]);
    });

    it('appends exactly the optional questions this device turned on', async () => {
        // Stored in the order they were switched on; asked in the set's own order, because a
        // deck that reorders itself cannot be swiped with the eyes closed.
        localStorage.setItem(JOURNAL_STORAGE_KEYS.questions, JSON.stringify(['water', 'alcohol']));

        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        const seen = [];
        for (let i = 0; i < 7; i += 1) {
            seen.push(stepId());
            swipe('right');
        }

        expect(seen.slice(5)).toEqual(['question:alcohol', 'question:water']);
        expect(stepId()).toBe('word');
    });

    it('records every question it showed in `asked`, optional ones included', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.questions, JSON.stringify(['alcohol', 'water']));

        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        for (let i = 0; i < 7; i += 1) swipe('right');
        swipe('up'); // skip the closing card

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].payload.question_set).toEqual({
            version: 1,
            asked: [
                'slept_well', 'moved_body', 'daylight', 'with_people', 'ate_regularly',
                'alcohol', 'water'
            ]
        });
    });
});

/* The three gestures */

describe('the three gestures', () => {
    it('reads right as yes, left as no, and up as no answer at all', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        swipe('right');   // slept_well
        swipe('left');    // moved_body
        swipe('up');      // daylight — skipped
        swipe('right');   // with_people
        swipe('left');    // ate_regularly
        swipe('up');      // the closing card

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        const { payload } = posted('ritual')[0];

        expect(payload.answers).toEqual({
            slept_well: true,
            moved_body: false,
            with_people: true,
            ate_regularly: false
        });
        expect('daylight' in payload.answers).toBe(false);
        expect(payload.question_set.asked).toContain('daylight');
    });

    it('records nothing and does not advance when the card is tapped', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        tapCard();
        tapCard();

        expect(stepId()).toBe('question:slept_well');
        expect(detent).not.toHaveBeenCalled();
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('springs back rather than committing on a drag that did not travel far enough', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        fireEvent.pointerDown(card(), { pointerId: 1, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(card(), { pointerId: 1, clientX: 20, clientY: 0 });
        fireEvent.pointerUp(card(), { pointerId: 1, clientX: 20, clientY: 0 });

        expect(stepId()).toBe('question:slept_well');
    });

    it('reads a diagonal by which axis it leans on', () => {
        // The arithmetic on its own, because a tap is the case a DOM-level gesture test is
        // least likely to reproduce faithfully and it is the one that must record nothing.
        expect(gestureIntent(0, 0, 48)).toBe(null);
        expect(gestureIntent(20, 0, 48)).toBe(null);
        expect(gestureIntent(200, -30, 48)).toBe('yes');
        expect(gestureIntent(-200, -30, 48)).toBe('no');
        expect(gestureIntent(30, -200, 48)).toBe('skip');
        expect(gestureIntent(0, 200, 48)).toBe(null);
    });
});

/* The other two ways in */

describe('the buttons and the arrow keys', () => {
    const expected = {
        slept_well: true,
        moved_body: false,
        with_people: true,
        ate_regularly: false
    };

    it('answers exactly as the gestures do, from the buttons', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        await userEvent.click(document.querySelector('[data-ritual-yes]'));
        await userEvent.click(document.querySelector('[data-ritual-no]'));
        await userEvent.click(document.querySelector('[data-ritual-skip]'));
        await userEvent.click(document.querySelector('[data-ritual-yes]'));
        await userEvent.click(document.querySelector('[data-ritual-no]'));
        await userEvent.click(document.querySelector('[data-ritual-skip]'));

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].payload.answers).toEqual(expected);
    });

    it('answers exactly as the gestures do, from the keyboard', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        pressKey('ArrowRight');
        pressKey('ArrowLeft');
        pressKey('ArrowUp');
        pressKey('ArrowRight');
        pressKey('ArrowLeft');
        pressKey('ArrowUp');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].payload.answers).toEqual(expected);
    });
});

/* The closing card */

describe('the closing card', () => {
    it('is last, and is the only one that is not a yes or a no', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();

        expect(stepId()).toBe('word');
        expect(screen.getByText(JOURNAL_COPY.ritual.dayWord)).toBeInTheDocument();
        // "can't tell" is a chip like any other here — declining is `skip`, and the two are
        // different records.
        expect(document.querySelector('[data-day-word="unclear"]')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-day-word]')).toHaveLength(FEELINGS.length);
    });

    it('writes the word twice: on the ritual, and as its own check-in at the same moment', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();

        await userEvent.click(document.querySelector('[data-day-word="calm"]'));

        await waitFor(() => expect(posted('checkin')).toHaveLength(1));
        const ritual = posted('ritual')[0];
        const checkin = posted('checkin')[0];

        expect(ritual.payload.day_word).toEqual({ id: 'calm' });
        // Absent, never `false`: the ritual has no affordance for "I am unsure of this word",
        // so there is no statement to record (invariant 14).
        expect('uncertain' in ritual.payload.day_word).toBe(false);

        expect(checkin.payload.source).toBe('ritual_word');
        expect(checkin.payload.feelings).toEqual([{ id: 'calm', about: [] }]);
        // One tap, no strength — and no invented middle number (invariant 15).
        expect('intensity' in checkin.payload.feelings[0]).toBe(false);

        // The same instant and the same day, which is what lets the day graph end on it.
        expect(checkin.at).toBe(ritual.at);
        expect(checkin.day).toBe(ritual.day);
        expect(ritual.day).toBe(TODAY);
        expect(ritual.at).toBe('2026-08-21T23:00:00+02:00');
        expect(checkin.payload.tz_offset_min).toBe(120);
    });

    it('writes neither when it is skipped', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();

        swipe('up');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('checkin')).toHaveLength(0);
        expect('day_word' in posted('ritual')[0].payload).toBe(false);
    });

    it('carries the rollover hour and how long the night took', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();
        swipe('up');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        const { payload } = posted('ritual')[0];

        expect(payload.rollover_hour).toBe(4);
        expect(typeof payload.duration_ms).toBe('number');
        expect(payload.v).toBe(1);
    });

    it('says so, and offers the day it landed on', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();
        swipe('up');

        expect(await screen.findByText(JOURNAL_COPY.ritual.done)).toBeInTheDocument();
        expect(screen.getByText(JOURNAL_COPY.nav.back)).toBeInTheDocument();
    });
});

/* Who */

describe('a yes to "spent time with someone"', () => {
    const runToWithPeople = async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        swipe('right');  // slept_well
        swipe('right');  // moved_body
        swipe('right');  // daylight
    };

    it('shows Who? only when the setting is on, and writes the mentions', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');
        await runToWithPeople();

        swipe('right');  // with_people → yes
        expect(stepId()).toBe('who');

        await userEvent.click(document.querySelector('[data-who="7"]'));
        await userEvent.click(document.querySelector('[data-who="9"]'));
        await userEvent.click(document.querySelector('[data-who="9"]'));  // and off again
        await userEvent.click(document.querySelector('[data-ritual-who-done]'));

        expect(stepId()).toBe('question:ate_regularly');
        swipe('right');
        swipe('up');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].mentions).toEqual([
            { ref: 0, relationship_id: 7, label: 'Lucie M' }
        ]);
    });

    it('does not ask when the setting is off', async () => {
        await runToWithPeople();

        swipe('right');  // with_people → yes
        expect(stepId()).toBe('question:ate_regularly');
    });

    it('does not ask after a no, even with the setting on', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');
        await runToWithPeople();

        swipe('left');   // with_people → no
        expect(stepId()).toBe('question:ate_regularly');
    });

    it('writes no mentions when the card is skipped', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');
        await runToWithPeople();

        swipe('right');
        expect(stepId()).toBe('who');
        swipe('up');

        swipe('right');  // ate_regularly
        swipe('up');     // the closing card

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].mentions).toEqual([]);
    });
});

/* Haptics, and the axis */

describe('the selection tick', () => {
    it('fires once per commit', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        swipe('right');
        expect(detent).toHaveBeenCalledTimes(1);

        swipe('left');
        swipe('up');
        expect(detent).toHaveBeenCalledTimes(3);
    });

    it('does not fire at all in discretion mode', async () => {
        localStorage.setItem('alq:discreet', 'true');
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        answerCoreFive();
        swipe('up');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(detent).not.toHaveBeenCalled();
    });

    it('masks the names on the Who? card without masking what is stored', async () => {
        localStorage.setItem('alq:discreet', 'true');
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');

        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        swipe('right'); swipe('right'); swipe('right'); swipe('right');

        expect(stepId()).toBe('who');
        expect(document.querySelector('[data-who="7"]').textContent).toBe('L. M.');
        // The `aria-label` keeps the real name: hiding it from a screen reader would harm a
        // user without protecting them from anyone looking at the screen.
        expect(document.querySelector('[data-who="7"]')).toHaveAttribute('aria-label', 'Lucie M');

        await userEvent.click(document.querySelector('[data-who="7"]'));
        await userEvent.click(document.querySelector('[data-ritual-who-done]'));
        swipe('right');
        swipe('up');

        await waitFor(() => expect(posted('ritual')).toHaveLength(1));
        expect(posted('ritual')[0].mentions[0].label).toBe('Lucie M');
    });
});

describe('touch-axis ownership (invariant 2g)', () => {
    it('claims both axes on the card, and on nothing above it', async () => {
        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        expect(card().style.touchAction).toBe('none');

        for (let node = card().parentElement; node; node = node.parentElement) {
            expect(node.style.touchAction).toBe('');
            // Nor through a utility class, which is the other way the claim could be made.
            expect(node.className || '').not.toMatch(/touch-/);
        }
    });
});

/* A missed night */

describe('a night with no ritual', () => {
    it('leaves no row, no count, and nothing on the day after', async () => {
        const checkin = {
            ID: 1,
            client_id: 'c-1',
            kind: 'checkin',
            day: TODAY,
            at: '2026-08-21T18:00:00+02:00',
            schema_version: 1,
            payload: { v: 1, source: 'chips', feelings: [{ id: 'calm', intensity: 2 }] },
            mentions: []
        };
        mockFetch({ entries: [checkin], days: [{ day: TODAY, checkins: 1, ritual: false, people: 0 }] });

        render(
            <MemoryRouter initialEntries={[`/journal/${TODAY}`]}>
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

        // `findAllBy`: the graph's legend names `calm` beside the chip that records it.
        await screen.findAllByText('calm');

        // Not a row, not a heading, not a zero, not a placeholder saying it is absent.
        expect(document.querySelector('[data-entry-kind="ritual"]')).toBeNull();
        expect(screen.queryByText(JOURNAL_COPY.day.ritualHeading)).not.toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.day.unanswered)).not.toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.ritual.dayWord)).not.toBeInTheDocument();
        expect(document.body.textContent).not.toMatch(/didn'?t|did not|yesterday|last night/i);
        expect(document.body.textContent).not.toMatch(/\b0\b/);
    });
});

/* The prompt line (§3.6, invariant 2c) */

describe('the web prompt line', () => {
    const sixtyDaysAgo = new Date(NIGHT.getTime() - 60 * 86400000).toISOString();
    const cadenceDue = [{ ID: 1, relationship_id: 1, name: 'Alex', date: sixtyDaysAgo, stats: { eros: 40 } }];
    const cadenceRels = [{ ID: 1, name: 'Alex', cadence_days: 30 }];

    const mockDashboard = ({ entries = [] } = {}) => {
        axios.get.mockImplementation((url) => {
            if (url === '/api/relationships') return Promise.resolve({ data: cadenceRels });
            if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
            if (url === '/api/journal/days') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: cadenceDue });
        });
    };

    const renderDashboard = () => render(
        <MemoryRouter initialEntries={['/']}>
            <DiscretionProvider>
                <SubjectsProvider>
                    <JournalProvider>
                        <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/journal/ritual" element={<RitualCards />} />
                        </Routes>
                    </JournalProvider>
                </SubjectsProvider>
            </DiscretionProvider>
        </MemoryRouter>
    );

    const turnRitualOn = () => localStorage.setItem(
        JOURNAL_STORAGE_KEYS.ritual,
        JSON.stringify({ on: true, time: '22:30' })
    );

    const cadenceLine = () => screen.queryByText(/since your last snapshot of Alex/);

    it('stays quiet before the chosen hour, and lets the cadence banner have the slot', async () => {
        turnRitualOn();
        vi.setSystemTime(EVENING_BEFORE_THE_HOUR);
        mockDashboard();

        renderDashboard();

        expect(await screen.findByText(/since your last snapshot of Alex/)).toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.ritual.prompt)).not.toBeInTheDocument();
    });

    it('says its one sentence after it, and never beside the cadence banner', async () => {
        turnRitualOn();
        mockDashboard();

        renderDashboard();

        expect(await screen.findByText(JOURNAL_COPY.ritual.prompt)).toBeInTheDocument();
        // Two calm sentences stacked are a to-do list (§3.6, invariant 2c).
        expect(cadenceLine()).not.toBeInTheDocument();
    });

    it('stays quiet when the ritual is off, whatever the hour', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, JSON.stringify({ on: false, time: '22:30' }));
        mockDashboard();

        renderDashboard();

        expect(await screen.findByText(/since your last snapshot of Alex/)).toBeInTheDocument();
        expect(screen.queryByText(JOURNAL_COPY.ritual.prompt)).not.toBeInTheDocument();
    });

    it('stays quiet once tonight is already on the day', async () => {
        turnRitualOn();
        mockDashboard({
            entries: [{
                ID: 5, client_id: 'r-1', kind: 'ritual', day: TODAY,
                at: '2026-08-21T23:00:00+02:00', schema_version: 1,
                payload: { v: 1, question_set: { version: 1, asked: [] }, answers: {} },
                mentions: []
            }]
        });

        renderDashboard();

        await screen.findByText('Alex');
        expect(screen.queryByText(JOURNAL_COPY.ritual.prompt)).not.toBeInTheDocument();
    });

    it('does not come back this session after "Not tonight", and neither does the cadence banner', async () => {
        turnRitualOn();
        mockDashboard();

        const first = renderDashboard();
        await screen.findByText(JOURNAL_COPY.ritual.prompt);
        await userEvent.click(document.querySelector('[data-ritual-not-tonight]'));

        expect(screen.queryByText(JOURNAL_COPY.ritual.prompt)).not.toBeInTheDocument();
        expect(cadenceLine()).not.toBeInTheDocument();

        // A fresh mount inside the same session: still gone, and the slot is still the
        // ritual's — the cadence banner waits for the next session (§3.6).
        first.unmount();
        renderDashboard();
        await screen.findByText('Alex');
        expect(screen.queryByText(JOURNAL_COPY.ritual.prompt)).not.toBeInTheDocument();
        expect(cadenceLine()).not.toBeInTheDocument();
    });

    it('takes Start to the cards', async () => {
        turnRitualOn();
        mockDashboard();

        renderDashboard();
        await screen.findByText(JOURNAL_COPY.ritual.prompt);
        await userEvent.click(document.querySelector('[data-ritual-start]'));

        expect(await screen.findByText(coreQuestions()[0].text)).toBeInTheDocument();
    });
});

/* The copy rail */

/** Every string anywhere inside a value — A5's walk, reused here over what reached a screen. */
const walkStrings = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(walkStrings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(walkStrings);
    return [];
};

const allowed = new Set([
    ...walkStrings(JOURNAL_COPY),
    ...RITUAL_QUESTIONS.flatMap(question => [question.text, question.note]),
    ...FEELINGS.map(feeling => feeling.label),
    ...relationships.map(person => person.name),
    '←', '→'
]);

const wordsOnScreen = () => [...document.querySelectorAll('body *')]
    .flatMap(element => [...element.childNodes])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .filter(text => /[A-Za-z]{2,}/.test(text));

const proseOnScreen = () => wordsOnScreen().filter(text => !allowed.has(text));

describe('no bare strings (Appendix B item 3)', () => {
    it('says nothing on any of its cards that is not in JOURNAL_COPY or a closed vocabulary', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');
        localStorage.setItem(JOURNAL_STORAGE_KEYS.questions, JSON.stringify(['alcohol']));

        renderRitual();
        await screen.findByText(coreQuestions()[0].text);

        // A guard on the walk itself: an empty screen would satisfy every assertion below
        // while proving nothing, and a planted sentence proves the filter really looks.
        expect(wordsOnScreen().length).toBeGreaterThan(4);
        const planted = document.createElement('p');
        planted.textContent = 'A sentence nobody put in JOURNAL_COPY.';
        document.body.appendChild(planted);
        expect(proseOnScreen()).toEqual(['A sentence nobody put in JOURNAL_COPY.']);
        planted.remove();

        // A question card, the Who? card, and the closing card — every state that renders.
        expect(proseOnScreen()).toEqual([]);
        swipe('right'); swipe('right'); swipe('right'); swipe('right');
        expect(stepId()).toBe('who');
        expect(proseOnScreen()).toEqual([]);

        await userEvent.click(document.querySelector('[data-ritual-who-done]'));
        swipe('right');  // ate_regularly
        swipe('right');  // alcohol
        expect(stepId()).toBe('word');
        expect(proseOnScreen()).toEqual([]);

        await userEvent.click(document.querySelector('[data-day-word="calm"]'));
        await screen.findByText(JOURNAL_COPY.ritual.done);
        expect(proseOnScreen()).toEqual([]);
    });

    it('says nothing of its own when the write fails, and keeps the cards where they are', async () => {
        axios.post.mockRejectedValue({ response: { status: 500, data: {} } });

        renderRitual();
        await screen.findByText(coreQuestions()[0].text);
        answerCoreFive();
        swipe('up');

        expect(await screen.findByText(JOURNAL_COPY.ritual.saveError)).toBeInTheDocument();
        expect(proseOnScreen()).toEqual([]);
        // Trap 4: the closing card is still on screen, and so is everything tapped so far.
        expect(stepId()).toBe('word');

        echoPost();
        await userEvent.click(document.querySelector('[data-ritual-retry]'));
        expect(await screen.findByText(JOURNAL_COPY.ritual.done)).toBeInTheDocument();
    });
});
