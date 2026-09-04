/**
 * `validateProposal(raw, context)` — the filter that stands between the model and the user.
 *
 * Pure, exported, and the whole defence (§5.4). Whatever a runtime hands back — a parsed
 * object, a string of JSON, a string of prose, nothing — comes out of here as an object that
 * satisfies §5.2's schema, carries no forbidden word in any slot a model authored, and can
 * be handed to the card without the card checking anything. The user never sees a parse
 * error: a proposal that cannot be used becomes `ambiguity: "feeling"` (§4.6), which the
 * card already knows how to draw — the transcript stays, the grid opens, nothing is
 * pre-selected.
 *
 * Two levels of failure, and the difference matters:
 *
 * - **Structural** — not an object, not JSON, an `ambiguity` value the app does not know.
 *   The whole proposal is replaced by the empty one. Nothing is salvaged from prose.
 * - **Item-level** — a feeling with an id the app does not know, a label with a forbidden
 *   word in it, a fact about nobody, a seventh person. The item is dropped and **counted**;
 *   the rest of the proposal survives. Every drop is on the provenance block as
 *   `dropped_by_filter`, with a path and a reason, so the eval (D4) can see how often the
 *   model says something the app refuses and the entry's provenance (§6.3) can carry the
 *   number. A container that is missing is an empty container; a required scalar that is
 *   missing or of the wrong type drops its item. Nothing is ever *invented* to fill a gap —
 *   no default intensity, no default person — because that would be the filter authoring a
 *   value, and invariant 15 is about who authors.
 *
 * **The one carve-out: the transcript is exempt from word filtering.** It is trimmed and cut
 * at the cap, and otherwise passes through as it came — forbidden words, angle brackets, a
 * URL somebody said out loud. It is the user's own speech, and a journal that censors the
 * word *bad* out of someone's own sentence is not keeping a record. The three model-authored
 * slots — `name`, `label`, `text` — are the whole attack surface for register (§5.2), and
 * they are the only strings this file reads against the list.
 *
 * One more rule this file adds and the card can rely on: **`ambiguity === "feeling"` if and
 * only if `feelings` is empty.** A proposal that loses every feeling becomes `feeling`, as
 * §5.4 says; and a proposal that declares `feeling` while listing feelings has its list
 * cleared (counted as `inconsistent`), because §4.6 says that card pre-selects nothing and
 * a contract the card has to second-guess is not a contract.
 */

import { activeFeelings, INTENSITY_LEVELS } from '../../constants/journal';
import { CONTEXT_TAGS } from '../../constants/contextTags';
import { FORBIDDEN_WORDS } from '../../constants/forbiddenWords';
import { buildSchema, checkSchema, codePoints, LIMITS, AMBIGUITY } from './schema';
import { parseModelJson } from './parse';

/* ------------------------------------------------------------------------------------ */
/* 1. The vocabulary of drops                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Why an item was dropped. Each is a thing the eval report can count; none carries the
 * text that was dropped, because a forbidden word has no business on a provenance block
 * either.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 2. Text                                                                                */
/* ------------------------------------------------------------------------------------ */

// Characters that render as nothing and would let a word hide from the list — a zero-width
// space between *un* and *healthy* — plus the C0/C1 controls that have no place on a chip.
// Built from code points rather than written as escapes, so the class is reviewable in
// any editor: U+200B-200F and U+202A-202E (zero-width and bidi controls), U+2060-2064
// (word joiner and invisible operators), U+FEFF (the byte-order mark).
const span = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
const INVISIBLE = new RegExp(`[${span(0x200B, 0x200F)}${span(0x202A, 0x202E)}${span(0x2060, 0x2064)}${String.fromCodePoint(0xFEFF)}]`, 'g');
// C0 and C1 controls, minus tab, newline and carriage return, which `\s` collapses.
const CONTROL = new RegExp(`[${span(0x0000, 0x0008)}${span(0x000B, 0x000C)}${span(0x000E, 0x001F)}${span(0x007F, 0x009F)}]`, 'g');

/**
 * A model-authored slot, made fit for a chip: invisible and control characters removed,
 * whitespace collapsed to single spaces, trimmed. Normalisation, not censorship — nothing
 * a reader could see is changed.
 */
export const cleanSlot = (value) => (
    String(value ?? '').replace(INVISIBLE, '').replace(CONTROL, '').replace(/\s+/g, ' ').trim()
);

/**
 * The form a slot is read in when it is held against the list: compatibility-normalised so
 * a full-width letter is its ASCII self, stripped of combining marks so an accent cannot
 * disguise a word, lower-cased. Only ever used for the predicate; what is kept is `cleanSlot`.
 */
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

/**
 * `'url'`, `'markup'` or `'instruction'` when the text resembles one; `null` when it is
 * plain words. Read on the cleaned slot, and on its folded form as well so that a
 * full-width `＜b＞` is a tag too.
 */
export const looksUnsafe = (value) => {
    const cleaned = cleanSlot(value);
    const folded = foldForWords(value);
    if (matchesAny(URL_PATTERNS, cleaned) || matchesAny(URL_PATTERNS, folded)) return 'url';
    if (matchesAny(MARKUP_PATTERNS, cleaned) || matchesAny(MARKUP_PATTERNS, folded)) return 'markup';
    if (matchesAny(INSTRUCTION_PATTERNS, cleaned) || matchesAny(INSTRUCTION_PATTERNS, folded)) return 'instruction';
    return null;
};

/**
 * The transcript, as the record keeps it: trimmed, cut at the cap in code points (the
 * measure the server uses), and otherwise untouched. No list is read over it. Not
 * `cleanSlot` either — a newline somebody's transcriber put between two sentences is not
 * this file's to remove.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 3. Parsing                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Whatever the runtime returned, as an object or `null`.
 *
 * A string goes through `parseModelJson` (`parse.js`), which is where the framing repairs
 * live — a code fence, or prose either side of the object. **Prose instead of an object is
 * never salvaged**: that is the model failing to answer, not failing to format. The repair
 * counts are dropped here because this function's callers do not carry provenance; the two
 * runtimes call `parseModelJson` directly and record them.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 4. The validator                                                                       */
/* ------------------------------------------------------------------------------------ */

const feelingIdsOf = (context) => {
    const fromContext = Array.isArray(context?.feelings)
        ? context.feelings.map(feeling => feeling?.id).filter(id => typeof id === 'string')
        : [];
    return fromContext.length ? fromContext : activeFeelings().map(feeling => feeling.id);
};

const tagsOf = (context) => (
    Array.isArray(context?.tags) && context.tags.length ? context.tags : [...CONTEXT_TAGS]
);

/**
 * Validate one raw model output against the contract, in the context it was proposed in.
 *
 * Returns `{ proposal, provenance }`:
 *
 * - `proposal` satisfies `buildSchema` for this context — the last thing this function
 *   does is check that, and if it somehow does not, the empty proposal goes out instead;
 * - `provenance.schema_valid` says whether the *raw* output obeyed the schema before any
 *   filtering — the honest measure of whether a runtime's grammar is doing its job;
 * - `provenance.dropped_by_filter` counts every item removed, and `provenance.drops` says
 *   where and why, without carrying the text.
 *
 * `context` is what `buildContext` produces. Its feeling ids and tags are the enums the
 * model was constrained to; when it carries none, the constants are used.
 */
export const validateProposal = (raw, context = {}) => {
    // Read once each. The schema and the two membership sets are the *same* two vocabularies
    // — that is the point of building the schema from the context — and reading them twice
    // invites the day the schema is built from one list and the checks run against another.
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
