/**
 * The journal's per-device settings: reading and writing the three keys §9.7 gives to 6-A.
 *
 * They live beside `journal.js` rather than inside it because that module's claim about
 * itself — content and pure functions, no React, no network, no `window` — is load-bearing:
 * it is the module the forbidden-word walk and the id-parity test are built around, and both
 * would rather it stayed importable without a DOM. Storage is the one impure thing the
 * settings need, so it is the one thing that moved out.
 *
 * All three are **per device and never sent anywhere** (§9.7), and every read tolerates a
 * value it did not write. A corrupt entry costs a preference, never a screen — the same rule
 * `CadenceNudge` follows for its snoozes, and the reason every reader here has a fallback
 * rather than a `throw`.
 *
 * The other five keys in `JOURNAL_STORAGE_KEYS` — voice, suggestions, embeddings,
 * transcripts, language — belong to 6-C, 6-D and 6-G. **A key with no reader here is a
 * feature that does not exist yet**, and adding one before the feature would put a toggle on
 * the profile screen for something the app cannot do (invariant 2e).
 */

import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_STORAGE_KEYS,
    MAX_OPTIONAL_QUESTIONS,
    isClockTime,
    optionalQuestions
} from './journal';

const readJSON = (key, fallback) => {
    try {
        const stored = window.localStorage.getItem(key);
        return stored === null ? fallback : JSON.parse(stored);
    } catch {
        // Unparseable, or storage refused. Either way the honest answer is the default.
        return fallback;
    }
};

const writeJSON = (key, value) => {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Private mode or a full quota costs the setting, nothing more.
    }
};

/**
 * Whether the ritual is on, and at what time.
 *
 * One key holds both, as §9.7 specifies — the time is meaningless without the switch, and
 * two keys would let them disagree. A bare `true`/`false` is accepted because that is the
 * shape the key held before it carried a time with it, and because `/journal`'s first-run
 * card writes nothing and only ever asks whether the key exists at all.
 */
export const readRitualSetting = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.ritual, null);

    if (stored && typeof stored === 'object') {
        return {
            on: stored.on === true,
            time: isClockTime(stored.time) ? stored.time : DEFAULT_RITUAL_TIME
        };
    }

    return { on: stored === true, time: DEFAULT_RITUAL_TIME };
};

export const writeRitualSetting = ({ on, time } = {}) => writeJSON(JOURNAL_STORAGE_KEYS.ritual, {
    on: on === true,
    time: isClockTime(time) ? time : DEFAULT_RITUAL_TIME
});

/** True until the ritual setting has been written once — `/journal`'s first-run rule (§9.4). */
export const ritualSettingUntouched = () => {
    try {
        return window.localStorage.getItem(JOURNAL_STORAGE_KEYS.ritual) === null;
    } catch {
        return false;
    }
};

/**
 * Which optional questions this device asks.
 *
 * Filtered to ids this build knows and capped on the way *out*, not only on the way in: a
 * list written by a device that had more turned on, or by a build that has since retired a
 * question, must not be able to make tonight's deck longer than the cap or put a card on
 * screen with no text on it.
 */
export const readOptionalQuestions = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.questions, []);
    if (!Array.isArray(stored)) return [];

    const known = new Set(optionalQuestions().map(question => question.id));
    return [...new Set(stored.filter(id => known.has(id)))].slice(0, MAX_OPTIONAL_QUESTIONS);
};

export const writeOptionalQuestions = (ids) => {
    const known = new Set(optionalQuestions().map(question => question.id));
    const clean = [...new Set((Array.isArray(ids) ? ids : []).filter(id => known.has(id)))];
    writeJSON(JOURNAL_STORAGE_KEYS.questions, clean.slice(0, MAX_OPTIONAL_QUESTIONS));
};

/** Off by default: it is a list of names on a screen at bedtime (§3.5). */
export const readAskWho = () => readJSON(JOURNAL_STORAGE_KEYS.askWho, false) === true;

export const writeAskWho = (on) => writeJSON(JOURNAL_STORAGE_KEYS.askWho, on === true);
