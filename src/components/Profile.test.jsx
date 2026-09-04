import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';

import Profile from './Profile';
import {
    EMBEDDING_GEMMA_ONNX, EMBEDDING_MODEL, PROPOSAL_MODEL,
    formatBytes, modelSize, setBytes, setLabel, tierModels
} from '../journal/inference/models';
import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_COPY,
    JOURNAL_STORAGE_KEYS,
    MAX_OPTIONAL_QUESTIONS,
    RITUAL_QUESTIONS,
    TRANSCRIPTION_LANGUAGES,
    fillCopy,
    optionalQuestions
} from '../constants/journal';
import {
    readAskWho,
    readEmbeddings,
    readOptionalQuestions,
    readRitualSetting
} from '../constants/journalSettings';
import { setNativeTierReport } from '../journal/inference/tier';

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

        // Absent here for one reason now, not two: voice, transcripts, language and — since
        // D2 — suggestions are the voice block, which a plain jsdom run cannot render because
        // it is not a secure context with a microphone. The Android block below renders it.
        [
            JOURNAL_COPY.settings.voice.label,
            JOURNAL_COPY.settings.suggestions.label,
            JOURNAL_COPY.settings.keepTranscripts.label,
            JOURNAL_COPY.settings.language.label
        ].forEach(label => {
            expect(screen.queryByText(label)).not.toBeInTheDocument();
        });
    });

    /**
     * G1's toggle. It is **not** in the voice block: EmbeddingGemma is its own model, its own
     * download and its own licence, and a second model folded in under a heading about voice
     * would be a second download agreed to by agreeing to something else.
     */
    it('offers the similar-entry toggle, off by default, with its own licence named', async () => {
        await renderProfile();

        expect(control('embeddings')).toBeInTheDocument();
        expect(control('embeddings')).toHaveAttribute('aria-pressed', 'false');
        expect(readEmbeddings()).toBe(false);

        // The terms are not Apache, and the difference is on screen before the choice.
        expect(document.querySelector('[data-embeddings-licence]')).toHaveTextContent(
            fillCopy(JOURNAL_COPY.settings.embeddings.licence, {
                label: EMBEDDING_MODEL.label, licence: EMBEDDING_MODEL.licence
            })
        );

        // Nothing about the size or the download until it is asked for.
        expect(document.querySelector('[data-embeddings-size]')).toBeNull();
    });

    /**
     * jsdom has no IndexedDB, which is exactly the device this rule is about: the toggle may
     * only be turned on where an index could exist, so here it is refused and says so.
     */
    it('refuses to turn on where there is nowhere to keep an index, and names the refusal', async () => {
        await renderProfile();
        await userEvent.click(control('embeddings'));

        expect(control('embeddings')).toBeDisabled();
        expect(control('embeddings')).toHaveAttribute('aria-pressed', 'false');
        expect(readEmbeddings()).toBe(false);
        expect(document.querySelector('[data-embeddings-unavailable]')).toHaveTextContent(
            JOURNAL_COPY.settings.embeddings.unavailable
        );
    });

    it('says the size before anything moves, and only once it is turned on', async () => {
        // A device that has somewhere to keep one. The stub is the whole capability: this
        // block never opens it, because `EmbeddingProvider` is what holds the index.
        vi.stubGlobal('indexedDB', { open: () => ({}) });

        await renderProfile();
        await userEvent.click(control('embeddings'));

        expect(control('embeddings')).toHaveAttribute('aria-pressed', 'true');
        expect(readEmbeddings()).toBe(true);
        expect(document.querySelector('[data-embeddings-size]')).toHaveTextContent(
            fillCopy(JOURNAL_COPY.settings.embeddings.size, {
                label: EMBEDDING_MODEL.label, size: modelSize(EMBEDDING_GEMMA_ONNX)
            })
        );
        // §5.6: the number is in front of the user while the choice is still theirs.
        expect(document.querySelector('[data-embeddings-start]')).toBeInTheDocument();

        vi.unstubAllGlobals();
    });

    it('carries §9.7\'s row in full, now that both halves of it exist', () => {
        // G1 narrowed this to *"Similar-entry suggestions"*, because a toggle may not
        // promise a screen the build does not have (invariant 2e). G2 built that screen —
        // `/journal/search`, behind this same switch — so the row is whole again, and this
        // is still the guard: if search were ever removed, the label would have to shrink
        // with it and this test is what would say so.
        expect(JOURNAL_COPY.settings.embeddings.label).toBe('Similar-entry suggestions and search');
        expect(JOURNAL_COPY.settings.embeddings.description).toContain('search what you have written');
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
    fillCopy(JOURNAL_COPY.settings.questions.atLimit, { max: MAX_OPTIONAL_QUESTIONS }),
    // C3's two, for every tier name, because which one renders depends on what the test
    // environment reports about itself — jsdom has no MediaRecorder, so it reads
    // `text-only`, and a change to that should not be able to slip a bare string in.
    ...Object.values(JOURNAL_COPY.settings.tier.names).flatMap(tier => [
        fillCopy(JOURNAL_COPY.settings.tier.detected, { tier }),
        fillCopy(JOURNAL_COPY.settings.tier.pinned, { tier })
    ]),
    ...['full', 'light'].flatMap(tier => [true, false].map((native) => {
        const models = tierModels(tier, { native });
        return fillCopy(JOURNAL_COPY.settings.voice.size, {
            label: setLabel(models), size: formatBytes(setBytes(models))
        });
    })),
    // G1's three filled sentences: the licence line, which is always on screen, and the two
    // the download offer shows once the toggle is on.
    fillCopy(JOURNAL_COPY.settings.embeddings.licence, {
        label: EMBEDDING_MODEL.label, licence: EMBEDDING_MODEL.licence
    }),
    fillCopy(JOURNAL_COPY.settings.embeddings.size, {
        label: EMBEDDING_MODEL.label, size: modelSize(EMBEDDING_GEMMA_ONNX)
    }),
    fillCopy(JOURNAL_COPY.settings.embeddings.downloadOffer, {
        label: EMBEDDING_MODEL.label, size: modelSize(EMBEDDING_GEMMA_ONNX)
    })
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

/* ------------------------------------------------------------------------------------ */
/* C4: on Android                                                                        */
/* ------------------------------------------------------------------------------------ */

const platformState = vi.hoisted(() => ({ native: false }));

vi.mock('../mobile/platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

/**
 * F2 — the nightly reminder follows the ritual toggle. Faked with a store rather than a spy
 * for `ritualReminder.test.js`'s reason: what matters is what is pending afterwards.
 */
const notifications = vi.hoisted(() => {
    const state = { pending: new Map(), permission: 'granted' };
    return {
        state,
        plugin: {
            checkPermissions: vi.fn(async () => ({ display: state.permission })),
            requestPermissions: vi.fn(async () => ({ display: state.permission })),
            schedule: vi.fn(async ({ notifications: list }) => {
                list.forEach(one => state.pending.set(one.id, one));
            }),
            cancel: vi.fn(async ({ notifications: list }) => {
                list.forEach(({ id }) => state.pending.delete(id));
            }),
            getPending: vi.fn(async () => ({ notifications: [...state.pending.values()] }))
        }
    };
});

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications.plugin }));

vi.mock('../mobile/journalPlugin', async (importOriginal) => ({
    ...(await importOriginal()),
    // The shell primes the report; here the test sets it directly and the prime is a no-op.
    primeNativeTier: vi.fn(async () => null),
    createNativeDownloader: () => ({
        getSnapshot: () => ({ state: 'idle' }),
        subscribe: () => () => { },
        start: async () => false,
        cancel: () => { },
        isDownloaded: async () => false,
        remove: async () => true
    })
}));

describe('on Android', () => {
    beforeEach(() => {
        platformState.native = true;
        setNativeTierReport({ totalMemoryBytes: 7.6 * 1024 ** 3, lowRamDevice: false });
    });
    afterEach(() => {
        platformState.native = false;
        setNativeTierReport(null);
    });

    const names = JOURNAL_COPY.settings.tier.names;

    it('reports the tier from the phone\'s memory, says the number, and lets it be pinned down', async () => {
        await renderProfile();

        expect(screen.getByText(JOURNAL_COPY.settings.tier.descriptionNative)).toBeInTheDocument();
        expect(screen.getByText(fillCopy(JOURNAL_COPY.settings.tier.detected, { tier: names.full }))).toBeInTheDocument();
        expect(screen.getByText(fillCopy(JOURNAL_COPY.settings.tier.memory, { gb: 8 }))).toBeInTheDocument();
        expect(control('voice')).toBeInTheDocument();

        await userEvent.selectOptions(control('tier'), 'light');
        expect(screen.getByText(fillCopy(JOURNAL_COPY.settings.tier.pinned, { tier: names.light }))).toBeInTheDocument();
        expect(control('voice')).toBeInTheDocument();

        await userEvent.selectOptions(control('tier'), 'text-only');
        expect(control('voice')).toBeNull();
        expect(screen.getByText(JOURNAL_COPY.empty.voiceUnavailable)).toBeInTheDocument();
    });

    it('offers Show suggestions only under a voice that is on, on by default, and names the model', async () => {
        await renderProfile();
        expect(control('suggestions')).toBeNull();

        await userEvent.click(control('voice'));
        expect(control('voice')).toHaveAttribute('aria-pressed', 'true');
        expect(control('suggestions')).toBeInTheDocument();
        expect(control('suggestions')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByText(JOURNAL_COPY.settings.suggestions.description)).toBeInTheDocument();
        // Invariant 2e, on the profile screen. Until D3 this said that nothing on this
        // device proposes anything — the sentence a toggle called *suggestions* owes its
        // reader when there is no model behind it. There is one now, and the line names it
        // and its licence rather than leaving the label to imply what it likes.
        expect(screen.getByText(fillCopy(JOURNAL_COPY.settings.suggestions.model, {
            label: PROPOSAL_MODEL.label, licence: PROPOSAL_MODEL.licence
        }))).toBeInTheDocument();

        await userEvent.click(control('suggestions'));
        expect(control('suggestions')).toHaveAttribute('aria-pressed', 'false');
        expect(JSON.parse(localStorage.getItem('alq:journal-suggestions'))).toBe(false);

        await userEvent.click(control('voice'));
        expect(control('suggestions')).toBeNull();
    });

    it('says nothing the forbidden-word walk cannot reach', async () => {
        await renderProfile();
        // The voice block renders here, which it cannot in a plain jsdom run: the language
        // pin's options are the two-letter codes, a vocabulary rather than copy.
        const allowedHere = new Set([
            ...allowed,
            ...TRANSCRIPTION_LANGUAGES,
            fillCopy(JOURNAL_COPY.settings.tier.memory, { gb: 8 }),
            // Two filled templates: the model line under the suggestions toggle and the
            // download line, both built from `JOURNAL_COPY` with names and sizes dropped in.
            // The template is in the walk; the model's name and the byte count are not copy.
            fillCopy(JOURNAL_COPY.settings.suggestions.model, {
                label: PROPOSAL_MODEL.label, licence: PROPOSAL_MODEL.licence
            })
        ]);
        expect(wordsInSection().length).toBeGreaterThan(10);
        expect(wordsInSection().filter(text => !allowedHere.has(text))).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* F2 — the nightly reminder follows the toggle (§3.6)                                    */
/* ------------------------------------------------------------------------------------ */

describe('the nightly reminder', () => {
    beforeEach(() => {
        platformState.native = true;
        notifications.state.pending.clear();
        notifications.state.permission = 'granted';
    });
    afterEach(() => {
        platformState.native = false;
    });

    const pending = () => [...notifications.state.pending.values()];

    it('is scheduled when the ritual is turned on, at the hour on screen', async () => {
        await renderProfile();

        await userEvent.click(control('ritual'));

        await waitFor(() => expect(pending()).toHaveLength(1));
        expect(pending()[0].body).toBe(JOURNAL_COPY.ritual.notification);
        expect(pending()[0].schedule.on).toEqual({ hour: 22, minute: 30 });
        // Asked for at the moment the user opts in, and never at launch.
        expect(notifications.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('moves with the hour rather than adding a second one', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, JSON.stringify({ on: true, time: '22:30' }));
        await renderProfile();

        await userEvent.clear(control('ritual-time'));
        await userEvent.type(control('ritual-time'), '21:15');

        await waitFor(() => expect(pending()[0]?.schedule.on).toEqual({ hour: 21, minute: 15 }));
        expect(pending()).toHaveLength(1);
    });

    it('is cancelled when the ritual is turned off', async () => {
        localStorage.setItem(JOURNAL_STORAGE_KEYS.ritual, JSON.stringify({ on: true, time: '22:30' }));
        await renderProfile();

        await userEvent.click(control('ritual'));

        await waitFor(() => expect(pending()).toHaveLength(0));
        expect(readRitualSetting().on).toBe(false);
    });

    it('costs the reminder and not the setting when the permission is refused', async () => {
        notifications.state.permission = 'denied';
        await renderProfile();

        await userEvent.click(control('ritual'));

        await waitFor(() => expect(control('ritual')).toHaveAttribute('aria-pressed', 'true'));
        // The ritual is a screen; being reminded of it is the part Android has a say in.
        expect(readRitualSetting()).toEqual({ on: true, time: DEFAULT_RITUAL_TIME });
        expect(pending()).toHaveLength(0);
    });

    it('schedules nothing on the web, where §3.6 gives the dashboard a line instead', async () => {
        platformState.native = false;
        await renderProfile();

        await userEvent.click(control('ritual'));

        expect(readRitualSetting().on).toBe(true);
        expect(notifications.plugin.schedule).not.toHaveBeenCalled();
        expect(notifications.plugin.requestPermissions).not.toHaveBeenCalled();
    });
});
