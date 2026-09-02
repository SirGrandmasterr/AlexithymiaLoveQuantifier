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
 * **Three more arrived with C3** — voice, keep-transcripts and language, plus the tier
 * override §9.7 did not originally list. The rule the header states still holds and is
 * worth restating rather than deleting: **a key with no reader here is a feature that does
 * not exist yet.** `embeddings` still has no reader, because there is no index that searches;
 * adding one before the feature would put a toggle on the profile screen for something the
 * app cannot do (invariant 2e). `suggestions` gained its reader in D2, with the card it
 * governs.
 *
 * `voice` has a second rule of its own, and it is the one that keeps the Vault page true:
 * **it may only be turned on where the device could actually run it.** The reader below is
 * deliberately not the place that decides — `voiceAvailability` in `journal/inference/tier.js`
 * is — but the writer refuses a `true` it was handed for a device that cannot record, so a
 * stale `true` written by a better browser on the same profile cannot make the page claim a
 * model is running here.
 */

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

/* ------------------------------------------------------------------------------------ */
/* C3: voice, transcripts, language, and the tier a user may pin                          */
/* ------------------------------------------------------------------------------------ */

/**
 * Whether voice check-ins are on. **Off by default and off wherever they could not work.**
 *
 * `capable` is passed in rather than looked up, so this module keeps its promise to be
 * storage and nothing else — the decision lives in `voiceAvailability`. Reading `false` on a
 * device that cannot record is not a lie about the preference; it is the honest answer to
 * "is a model running here", which is the question the Vault page asks this key.
 */
export const readVoiceSetting = (capable = true) => (
    capable === true && readJSON(JOURNAL_STORAGE_KEYS.voice, false) === true
);

/** Returns what was actually stored, so a caller can tell a refusal from a change. */
export const writeVoiceSetting = (on, capable = true) => {
    const next = on === true && capable === true;
    writeJSON(JOURNAL_STORAGE_KEYS.voice, next);
    return next;
};

/**
 * Keep the words, or keep only the structure (§9.7).
 *
 * On by default, which is the one setting in this file whose default is `true`: a journal
 * that drops what you said by default is a journal that quietly decides your sentence was
 * less worth keeping than the chips you tapped about it.
 */
export const readKeepTranscripts = () => readJSON(JOURNAL_STORAGE_KEYS.keepTranscripts, true) !== false;

export const writeKeepTranscripts = (on) => writeJSON(JOURNAL_STORAGE_KEYS.keepTranscripts, on !== false);

/**
 * The language to transcribe in, or `null` for "work it out" (§4.3).
 *
 * Stored as the two-letter code the model takes. Anything else is read as `null` rather than
 * handed to the model, because a pinned language the model does not know is a worse outcome
 * than no pin at all — and §12.1 says this setting matters most for exactly the users whose
 * notes mix languages.
 */
export const readLanguage = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.language, null);
    return typeof stored === 'string' && /^[a-z]{2}$/.test(stored) ? stored : null;
};

export const writeLanguage = (code) => writeJSON(
    JOURNAL_STORAGE_KEYS.language,
    typeof code === 'string' && /^[a-z]{2}$/.test(code) ? code : null
);

/** The tier the user pinned, or `null` for "whatever this device reports" (§5.5, C3). */
export const readTierOverride = () => {
    const stored = readJSON(JOURNAL_STORAGE_KEYS.tier, null);
    return isTier(stored) ? stored : null;
};

export const writeTierOverride = (tier) => writeJSON(
    JOURNAL_STORAGE_KEYS.tier,
    isTier(tier) ? tier : null
);

/* ------------------------------------------------------------------------------------ */
/* D2: the proposal card                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Whether the card shows what a model proposed (§9.7). **On by default** — the row reads *on
 * when voice is on* — and only ever consulted by a composer that a microphone opened: with
 * voice off there is no proposal to show or hide. Off means voice still writes the words
 * down and the user tags them with chips, which is the sentence beside the toggle.
 */
export const readSuggestions = () => readJSON(JOURNAL_STORAGE_KEYS.suggestions, true) !== false;

export const writeSuggestions = (on) => writeJSON(JOURNAL_STORAGE_KEYS.suggestions, on !== false);
