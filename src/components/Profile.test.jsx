import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';

import Profile from './Profile';
import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_COPY,
    JOURNAL_STORAGE_KEYS,
    MAX_OPTIONAL_QUESTIONS,
    RITUAL_QUESTIONS,
    fillCopy,
    optionalQuestions
} from '../constants/journal';
import {
    readAskWho,
    readOptionalQuestions,
    readRitualSetting
} from '../constants/journalSettings';

vi.mock('axios');

/**
 * The Journal section of the profile screen (§9.7).
 *
 * Three settings, not eight. Voice, suggestions, embeddings, transcripts and language are
 * described in `JOURNAL_COPY.settings` and must **not** be on this screen until the features
 * behind them exist — a toggle for something the app cannot do makes a Vault claim false
 * (invariant 2e), and a test is the only thing that keeps that from arriving by accident.
 */

const mockProfile = () => axios.get.mockResolvedValue({
    data: { name: 'Sam', email: 'sam@example.test', age: 30, mbti_type: 'INFP', profile_picture: '' }
});

const renderProfile = async () => {
    const result = render(<Profile />);
    await screen.findByDisplayValue('Sam');
    return result;
};

const section = () => document.querySelector('[data-journal-settings]');
const control = (name) => document.querySelector(`[data-setting="${name}"]`);
const questionButton = (id) => document.querySelector(`[data-question="${id}"]`);

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockProfile();
});

describe('the Journal settings section', () => {
    it('sits on the screen with its three controls and nothing more', async () => {
        await renderProfile();

        expect(screen.getByText(JOURNAL_COPY.settings.heading)).toBeInTheDocument();
        expect(screen.getByText(JOURNAL_COPY.settings.subheading)).toBeInTheDocument();
        expect(control('ritual')).toBeInTheDocument();
        expect(control('ask-who')).toBeInTheDocument();
        expect(document.querySelectorAll('[data-question]')).toHaveLength(optionalQuestions().length);

        // The five settings whose features do not exist yet (6-C, 6-D, 6-G).
        [
            JOURNAL_COPY.settings.voice.label,
            JOURNAL_COPY.settings.suggestions.label,
            JOURNAL_COPY.settings.embeddings.label,
            JOURNAL_COPY.settings.keepTranscripts.label,
            JOURNAL_COPY.settings.language.label
        ].forEach(label => {
            expect(screen.queryByText(label)).not.toBeInTheDocument();
        });
    });

    it('starts with everything off and no time chosen', async () => {
        await renderProfile();

        expect(control('ritual')).toHaveAttribute('aria-pressed', 'false');
        expect(control('ask-who')).toHaveAttribute('aria-pressed', 'false');
        expect(control('ritual-time')).toBeNull();
        expect(readRitualSetting()).toEqual({ on: false, time: DEFAULT_RITUAL_TIME });
        expect(readAskWho()).toBe(false);
        expect(readOptionalQuestions()).toEqual([]);
    });

    it('turns the ritual on at 22:30 and lets the hour be moved', async () => {
        await renderProfile();

        await userEvent.click(control('ritual'));

        expect(control('ritual')).toHaveAttribute('aria-pressed', 'true');
        expect(readRitualSetting()).toEqual({ on: true, time: '22:30' });
        expect(control('ritual-time')).toHaveValue('22:30');

        await userEvent.clear(control('ritual-time'));
        await userEvent.type(control('ritual-time'), '21:15');

        expect(readRitualSetting()).toEqual({ on: true, time: '21:15' });
    });

    it('keeps the chosen hour when the ritual is turned off and on again', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, JSON.stringify({ on: true, time: '23:45' }));
        await renderProfile();

        await userEvent.click(control('ritual'));
        expect(readRitualSetting()).toEqual({ on: false, time: '23:45' });

        await userEvent.click(control('ritual'));
        expect(readRitualSetting()).toEqual({ on: true, time: '23:45' });
    });

    it('offers the eight optional questions with the note that says why each is there', async () => {
        await renderProfile();

        optionalQuestions().forEach(question => {
            expect(screen.getByText(question.text)).toBeInTheDocument();
            expect(screen.getByText(question.note)).toBeInTheDocument();
        });

        // The honest one, kept honest: it says its own evidence is weak.
        expect(screen.getByText(/evidence as a mood predictor is weak/)).toBeInTheDocument();
    });

    it('stops at three, and says so rather than refusing silently', async () => {
        await renderProfile();

        await userEvent.click(questionButton('alcohol'));
        await userEvent.click(questionButton('in_pain'));
        await userEvent.click(questionButton('water'));

        expect(readOptionalQuestions()).toEqual(['alcohol', 'in_pain', 'water']);
        expect(screen.getByText(
            fillCopy(JOURNAL_COPY.settings.questions.atLimit, { max: MAX_OPTIONAL_QUESTIONS })
        )).toBeInTheDocument();
        expect(questionButton('cycle')).toBeDisabled();
        // The chosen three stay tappable, so the way out of the cap is the obvious one.
        expect(questionButton('alcohol')).not.toBeDisabled();

        await userEvent.click(questionButton('alcohol'));
        expect(readOptionalQuestions()).toEqual(['in_pain', 'water']);
        expect(questionButton('cycle')).not.toBeDisabled();
    });

    it('loses neither of two chips toggled inside one task', async () => {
        // A thumb cannot do this and a script can, which is how it was found: both handlers
        // read the same render's list and the first choice was overwritten by the second.
        await renderProfile();

        // One `act`, two clicks: both land inside the same task, which is the whole point.
        act(() => {
            questionButton('alcohol').click();
            questionButton('cycle').click();
        });

        expect(readOptionalQuestions()).toEqual(['alcohol', 'cycle']);
    });

    it('turns "ask who I was with" on, and it stays off until it is asked for', async () => {
        await renderProfile();

        expect(readAskWho()).toBe(false);
        await userEvent.click(control('ask-who'));

        expect(control('ask-who')).toHaveAttribute('aria-pressed', 'true');
        expect(readAskWho()).toBe(true);
    });

    it('reads back what another visit wrote', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, JSON.stringify({ on: true, time: '21:00' }));
        localStorage.setItem(JOURNAL_STORAGE_KEYS.questions, JSON.stringify(['conflict', 'cycle']));
        localStorage.setItem(JOURNAL_STORAGE_KEYS.askWho, 'true');

        await renderProfile();

        expect(control('ritual')).toHaveAttribute('aria-pressed', 'true');
        expect(control('ritual-time')).toHaveValue('21:00');
        expect(questionButton('conflict')).toHaveAttribute('aria-pressed', 'true');
        expect(questionButton('cycle')).toHaveAttribute('aria-pressed', 'true');
        expect(questionButton('water')).toHaveAttribute('aria-pressed', 'false');
        expect(control('ask-who')).toHaveAttribute('aria-pressed', 'true');
    });

    it('survives a value it did not write rather than taking the screen down with it', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, 'not json at all');
        localStorage.setItem(JOURNAL_STORAGE_KEYS.questions, '{"not":"a list"}');

        await renderProfile();

        expect(control('ritual')).toHaveAttribute('aria-pressed', 'false');
        expect(readOptionalQuestions()).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* The copy rail                                                                          */
/* ------------------------------------------------------------------------------------ */

const walkStrings = (value) => {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(walkStrings);
    if (value && typeof value === 'object') return Object.values(value).flatMap(walkStrings);
    return [];
};

/**
 * What this section is allowed to say: `JOURNAL_COPY`, the question vocabulary, and the two
 * sentences whose numbers are filled in at render time.
 *
 * The filled versions have to be listed because `fillCopy` produces a string the walk over
 * the template cannot match — which is the point of templates rather than functions (A5): the
 * template is what the forbidden-word test reads, and this is what the screen shows.
 */
const allowed = new Set([
    ...walkStrings(JOURNAL_COPY),
    ...RITUAL_QUESTIONS.flatMap(question => [question.text, question.note]),
    fillCopy(JOURNAL_COPY.settings.ritual.description, { time: DEFAULT_RITUAL_TIME }),
    fillCopy(JOURNAL_COPY.settings.questions.description, { max: MAX_OPTIONAL_QUESTIONS }),
    fillCopy(JOURNAL_COPY.settings.questions.atLimit, { max: MAX_OPTIONAL_QUESTIONS })
]);

const wordsInSection = () => [...section().querySelectorAll('*')]
    .flatMap(element => [...element.childNodes])
    .filter(node => node.nodeType === Node.TEXT_NODE)
    .map(node => node.textContent.trim())
    .filter(text => /[A-Za-z]{2,}/.test(text));

describe('no bare strings in the Journal section (Appendix B item 3)', () => {
    it('says nothing the forbidden-word walk cannot reach', async () => {
        await renderProfile();
        await userEvent.click(control('ritual'));
        await userEvent.click(questionButton('alcohol'));
        await userEvent.click(questionButton('in_pain'));
        await userEvent.click(questionButton('water'));

        // The guard: an empty section would satisfy the assertion below while proving nothing.
        expect(wordsInSection().length).toBeGreaterThan(10);
        expect(wordsInSection().filter(text => !allowed.has(text))).toEqual([]);
    });
});
