import { activeFeelings, INTENSITY_LEVELS } from '../../constants/journal';
import { CONTEXT_TAGS } from '../../constants/contextTags';
import { FORBIDDEN_WORDS } from '../../constants/forbiddenWords';
import { buildSchema, checkSchema, codePoints, LIMITS, AMBIGUITY } from './schema';
import { parseModelJson } from './parse';

/* 1. The vocabulary of drops */

export const DROP_REASONS = Object.freeze({
    /** Not an object, or a required scalar missing or of the wrong type. */
    shape: 'shape',
    /** A feeling id the app does not know — including a retired one. */
    unknown_id: 'unknown_id',
    /** A context tag that is not in `CONTEXT_TAGS`. */
    unknown_tag: 'unknown_tag',
    /** An `about` whose kind is not person, tag or trigger. */
    unknown_kind: 'unknown_kind',
    /** Over the cap for its slot, or empty after trimming. */
    length: 'length',
    /** A label or a fact text containing a word from `FORBIDDEN_WORDS`. */
    forbidden_word: 'forbidden_word',
    /** Resembles a URL, markup, or an instruction addressed to the model. */
    unsafe: 'unsafe',
    /** A fact naming a person the proposal did not list. */
    orphan_fact: 'orphan_fact',
    /** Beyond `maxItems` for its array. */
    over_cap: 'over_cap',
    /** A second feeling with the same id, or a second person with the same name. */
    duplicate: 'duplicate',
    /** A feeling listed under `ambiguity: "feeling"`. */
    inconsistent: 'inconsistent'
});

/* 2. Text */

const span = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const INVISIBLE = new RegExp(`[${span(0x200B, 0x200F)}${span(0x202A, 0x202E)}${span(0x2060, 0x2064)}${String.fromCodePoint(0xFEFF)}]`, 'g');
// C0 and C1 controls, minus tab, newline and carriage return, which `\s` collapses.
const CONTROL = new RegExp(`[${span(0x0000, 0x0008)}${span(0x000B, 0x000C)}${span(0x000E, 0x001F)}${span(0x007F, 0x009F)}]`, 'g');

export const cleanSlot = (value) => (
    String(value ?? '').replace(INVISIBLE, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
);

const foldForWords = (value) => (
    cleanSlot(value).normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
);

/** True when the text contains a forbidden word, matched exactly as the copy walk matches. */
export const isForbidden = (value) => {
    const folded = foldForWords(value);
    return FORBIDDEN_WORDS.some(word => folded.includes(word));
};

const URL_PATTERNS = [
    /[a-z][a-z0-9+.-]*:\/\//i,
    /\bwww\./i,
    /\b(?:mailto|javascript|data|file|ftp|tel):/i,
    /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|de|at|ch|eu|uk|fr|es|it|nl|app|dev|me|info|co|xyz|ai)\b/i,
    /\S+@\S+\.\S+/
];

const MARKUP_PATTERNS = [
    /<\/?[a-z!?][^>]*>/i,
    /&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i,
    /!?\[[^\]]*\]\([^)]*\)/,
    /`|[*_~]{2,}/,
    /\{\{|\}\}|\$\{/,
    /^#{1,6}\s/,
    /<\|[^|]*\|>|<\/?(?:start|end)_of_turn>|\[\/?INST\]/i
];

const INSTRUCTION_PATTERNS = [
    /\b(?:ignore|disregard|forget|override|bypass|skip)\b[^.]*\b(?:instruction|rule|list|schema|prompt|above|previous|prior|earlier|everything|all)\b/i,
    /\b(?:system|assistant|developer|user)\s*(?:prompt|message|instruction|role)s?\b/i,
    /\bas an? (?:ai|assistant|language model|llm|model)\b/i,
    /\byou (?:are|must|should|will|need to|have to|can now)\b/i,
    /\b(?:write|output|return|respond|generate|print|produce|emit|reply)\b[^.]*\b(?:paragraph|json|essay|text|list|story|poem|response|answer|sentence)\b/i,
    /\b(?:mark|label|flag|rate|score|classify|tag|record|register)\s+(?:me|them|him|her|us|the user|this person|this)\s+as\b/i,
    /^\s*(?:note|instruction|prompt|system|assistant|task|command|important)\s*:/i,
    /\bnew (?:instruction|task|prompt|rule)s?\b/i,
    // The user base speaks German (§12.1); an injected sentence may too.
    /\b(?:ignorier|missacht|vergiss|übergeh|umgeh)\w*\b[^.]*\b(?:anweisung|regel|liste|schema|prompt|oben|vorherig|bisherig|alles)\w*/i,
    /\b(?:schreib|gib|erzeug|generier|antwort)\w*\b[^.]*\b(?:absatz|text|liste|json|geschichte|gedicht|satz)\b/i,
    /\bdu (?:bist|musst|sollst|wirst|kannst jetzt)\b/i,
    /\b(?:markier|kennzeichn|stuf|bewert)\w*\s+(?:mich|ihn|sie|uns|den nutzer|die nutzerin)\s+als\b/i
];

const matchesAny = (patterns, value) => patterns.some(pattern => pattern.test(value));

export const looksUnsafe = (value) => {
    const cleaned = cleanSlot(value);
    const folded = foldForWords(value);
    if (matchesAny(URL_PATTERNS, cleaned) || matchesAny(URL_PATTERNS, folded)) return 'url';
    if (matchesAny(MARKUP_PATTERNS, cleaned) || matchesAny(MARKUP_PATTERNS, folded)) return 'markup';
    if (matchesAny(INSTRUCTION_PATTERNS, cleaned) || matchesAny(INSTRUCTION_PATTERNS, folded)) return 'instruction';
    return null;
};

export const truncateTranscript = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (codePoints(trimmed) <= LIMITS.transcript) return trimmed;
    return Array.from(trimmed).slice(0, LIMITS.transcript).join('');
};

// A language is a short tag — letters, digits, hyphens. Anything else was not a language.
const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[a-z0-9]{1,4})*$/i;

const cleanLanguage = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    return LANGUAGE_TAG.test(trimmed) && codePoints(trimmed) <= LIMITS.language ? trimmed : '';
};

// The same fold `personCandidates` uses to decide two spellings are one person (§4.5): a
// fact about *lucie* is about *Lucie*, and both are kept under the listed spelling.
const foldName = (value) => cleanSlot(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/* 3. Parsing */

export const parseRaw = (raw) => {
    let value = raw;
    if (typeof value === 'string') {
        value = parseModelJson(value).value;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value;
};

/** The proposal the card gets when nothing usable came back (§4.6): the words, and the grid. */
export const emptyProposal = (transcript = '', language = '') => ({
    transcript: truncateTranscript(transcript),
    language: cleanLanguage(language),
    feelings: [],
    people: [],
    facts: [],
    ambiguity: 'feeling'
});

/* 4. The validator */

const feelingIdsOf = (context) => {
    const fromContext = Array.isArray(context?.feelings)
        ? context.feelings.map(feeling => feeling?.id).filter(id => typeof id === 'string')
        : [];
    return fromContext.length ? fromContext : activeFeelings().map(feeling => feeling.id);
};

const tagsOf = (context) => (
    Array.isArray(context?.tags) && context.tags.length ? context.tags : [...CONTEXT_TAGS]
);

export const validateProposal = (raw, context = {}) => {
    const feelingIds = feelingIdsOf(context);
    const tags = tagsOf(context);

    const schema = buildSchema({ feelingIds, tags });
    const knownIds = new Set(feelingIds);
    const knownTags = new Set(tags);
    const drops = [];
    const drop = (path, reason) => drops.push({ path, reason });
    const done = (proposal, schemaValid) => ({
        proposal,
        provenance: { schema_valid: schemaValid, dropped_by_filter: drops.length, drops }
    });

    const parsed = parseRaw(raw);
    if (!parsed) {
        drop('', DROP_REASONS.shape);
        return done(emptyProposal(), false);
    }
    const schemaValid = checkSchema(parsed, schema).length === 0;

    const transcript = truncateTranscript(parsed.transcript);
    const language = cleanLanguage(parsed.language);

    /* ---- people ---------------------------------------------------------------------- */

    const people = [];
    const seenPeople = new Map();
    const admitPerson = (name, path) => {
        const cleaned = cleanSlot(name);
        if (typeof name !== 'string' || !cleaned) { drop(path, DROP_REASONS.shape); return null; }
        if (codePoints(cleaned) > LIMITS.name) { drop(path, DROP_REASONS.length); return null; }
        if (looksUnsafe(cleaned)) { drop(path, DROP_REASONS.unsafe); return null; }
        const key = foldName(cleaned);
        if (seenPeople.has(key)) return seenPeople.get(key);
        if (people.length >= LIMITS.people) { drop(path, DROP_REASONS.over_cap); return null; }
        people.push({ name: cleaned });
        seenPeople.set(key, cleaned);
        return cleaned;
    };

    (Array.isArray(parsed.people) ? parsed.people : []).forEach((entry, index) => {
        const path = `people[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { drop(path, DROP_REASONS.shape); return; }
        const cleaned = cleanSlot(entry.name);
        if (typeof entry.name === 'string' && cleaned && seenPeople.has(foldName(cleaned))) {
            drop(path, DROP_REASONS.duplicate);
            return;
        }
        admitPerson(entry.name, path);
    });

    /* ---- feelings -------------------------------------------------------------------- */

    const admitAbout = (entry, path) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { drop(path, DROP_REASONS.shape); return null; }
        switch (entry.kind) {
            case 'person': {
                const name = admitPerson(entry.name, path);
                return name === null ? null : { kind: 'person', name };
            }
            case 'tag': {
                if (!knownTags.has(entry.tag)) { drop(path, DROP_REASONS.unknown_tag); return null; }
                return { kind: 'tag', tag: entry.tag };
            }
            case 'trigger': {
                const label = cleanSlot(entry.label);
                if (typeof entry.label !== 'string' || !label) { drop(path, DROP_REASONS.shape); return null; }
                if (codePoints(label) > LIMITS.label) { drop(path, DROP_REASONS.length); return null; }
                if (isForbidden(label)) { drop(path, DROP_REASONS.forbidden_word); return null; }
                if (looksUnsafe(label)) { drop(path, DROP_REASONS.unsafe); return null; }
                return { kind: 'trigger', label };
            }
            default:
                drop(path, DROP_REASONS.unknown_kind);
                return null;
        }
    };

    const feelings = [];
    const seenIds = new Set();
    (Array.isArray(parsed.feelings) ? parsed.feelings : []).forEach((entry, index) => {
        const path = `feelings[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { drop(path, DROP_REASONS.shape); return; }
        if (!knownIds.has(entry.id)) { drop(path, DROP_REASONS.unknown_id); return; }
        if (!INTENSITY_LEVELS.includes(entry.intensity)) { drop(path, DROP_REASONS.shape); return; }
        if (seenIds.has(entry.id)) { drop(path, DROP_REASONS.duplicate); return; }
        if (feelings.length >= LIMITS.feelings) { drop(path, DROP_REASONS.over_cap); return; }

        const about = [];
        (Array.isArray(entry.about) ? entry.about : []).forEach((item, aboutIndex) => {
            const aboutPath = `${path}.about[${aboutIndex}]`;
            if (about.length >= LIMITS.about) { drop(aboutPath, DROP_REASONS.over_cap); return; }
            const admitted = admitAbout(item, aboutPath);
            if (admitted) about.push(admitted);
        });

        seenIds.add(entry.id);
        feelings.push({ id: entry.id, intensity: entry.intensity, about, rawIndex: index });
    });

    /* ---- facts ----------------------------------------------------------------------- */

    const facts = [];
    (Array.isArray(parsed.facts) ? parsed.facts : []).forEach((entry, index) => {
        const path = `facts[${index}]`;
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { drop(path, DROP_REASONS.shape); return; }
        const text = cleanSlot(entry.text);
        if (typeof entry.text !== 'string' || !text || typeof entry.person !== 'string') { drop(path, DROP_REASONS.shape); return; }
        const person = seenPeople.get(foldName(entry.person));
        if (!person) { drop(path, DROP_REASONS.orphan_fact); return; }
        if (codePoints(text) > LIMITS.text) { drop(path, DROP_REASONS.length); return; }
        if (isForbidden(text)) { drop(path, DROP_REASONS.forbidden_word); return; }
        if (looksUnsafe(text)) { drop(path, DROP_REASONS.unsafe); return; }
        if (facts.length >= LIMITS.facts) { drop(path, DROP_REASONS.over_cap); return; }
        facts.push({ person, text });
    });

    /* ---- ambiguity, and the invariant that ties it to the feelings ------------------- */

    let ambiguity = AMBIGUITY.includes(parsed.ambiguity) ? parsed.ambiguity : 'feeling';
    let kept = feelings;
    if (ambiguity === 'feeling' && kept.length) {
        kept.forEach(feeling => drop(`feelings[${feeling.rawIndex}]`, DROP_REASONS.inconsistent));
        kept = [];
    }
    if (!kept.length) ambiguity = 'feeling';

    const proposal = {
        transcript,
        language,
        feelings: kept.map(({ id, intensity, about }) => ({ id, intensity, about })),
        people,
        facts,
        ambiguity
    };

    // Belt and braces. Every rule above was written to make this pass; if a later edit
    // breaks one, the card still gets something it can draw rather than something it cannot.
    if (checkSchema(proposal, schema).length) {
        drop('', DROP_REASONS.shape);
        return done(emptyProposal(transcript, language), false);
    }

    return done(proposal, schemaValid);
};
