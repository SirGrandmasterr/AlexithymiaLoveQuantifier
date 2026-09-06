import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_STORAGE_KEYS,
    MAX_OPTIONAL_QUESTIONS,
    isClockTime,
    optionalQuestions
} from './journal';
import { isTier } from '../journal/inference/tier';

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

/* C3: voice, transcripts, language, and the tier a user may pin */

export const readVoiceSetting = (capable = true) => (
    capable === true && readJSON(JOURNAL_STORAGE_KEYS.voice, false) === true
);

/** Returns what was actually stored, so a caller can tell a refusal from a change. */
export const writeVoiceSetting = (on, capable = true) => {
    const next = on === true && capable === true;
    writeJSON(JOURNAL_STORAGE_KEYS.voice, next);
    return next;
};

export const readKeepTranscripts = () => readJSON(JOURNAL_STORAGE_KEYS.keepTranscripts, true) !== false;

export const writeKeepTranscripts = (on) => writeJSON(JOURNAL_STORAGE_KEYS.keepTranscripts, on !== false);

export const readLanguage = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.language, null);
    return typeof stored === 'string' && /^[a-z]{2}$/.test(stored) ? stored : null;
};

export const writeLanguage = (code) => writeJSON(
    JOURNAL_STORAGE_KEYS.language,
    typeof code === 'string' && /^[a-z]{2}$/.test(code) ? code : null
);

/* §5.5b: the Gemini option */

/**
 * Whether this device sends its check-ins to Gemini through the server (§5.5b).
 *
 * Off by default, and — like the voice and index toggles — it may only be **on** where it
 * could do something. `available` is the server's answer (`cloudProposalStatus`), so a
 * device whose server lost its key reads `false` here without anything having to rewrite the
 * key: the toggle goes off on the screen, and the Vault page stops claiming a hop that is not
 * happening.
 */
export const readCloudProposals = (available = true) => (
    available === true && readJSON(JOURNAL_STORAGE_KEYS.cloud, false) === true
);

/** Returns what was actually stored, so a caller can tell a refusal from a change. */
export const writeCloudProposals = (on, available = true) => {
    const next = on === true && available === true;
    writeJSON(JOURNAL_STORAGE_KEYS.cloud, next);
    return next;
};

/** The tier the user pinned, or `null` for "whatever this device reports" (§5.5, C3). */
export const readTierOverride = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.tier, null);
    return isTier(stored) ? stored : null;
};

export const writeTierOverride = (tier) => writeJSON(
    JOURNAL_STORAGE_KEYS.tier,
    isTier(tier) ? tier : null
);

/* D2: the proposal card */

export const readSuggestions = () => readJSON(JOURNAL_STORAGE_KEYS.suggestions, true) !== false;

export const writeSuggestions = (on) => writeJSON(JOURNAL_STORAGE_KEYS.suggestions, on !== false);

/* G1: the embedding index */

export const readEmbeddings = (capable = true) => (
    capable === true && readJSON(JOURNAL_STORAGE_KEYS.embeddings, false) === true
);

/** Returns what was actually stored, so a caller can tell a refusal from a change. */
export const writeEmbeddings = (on, capable = true) => {
    const next = on === true && capable === true;
    writeJSON(JOURNAL_STORAGE_KEYS.embeddings, next);
    return next;
};
