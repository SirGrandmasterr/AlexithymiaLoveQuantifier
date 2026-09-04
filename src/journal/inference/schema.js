/**
 * The output contract, §5.2, as data — the model's entire vocabulary of effects.
 *
 * Everything a model in this phase can do to the app is describable by this one object. It
 * cannot produce a sentence the user reads, because the card renders templates from
 * `JOURNAL_COPY` with the slots below dropped in; it cannot name a relationship or a trigger
 * id, because the schema has no slot for one (§5.1) — a person is a `name` and a trigger is
 * a `label`, and resolving either is the client's job (§4.5, §4.5b); and it cannot emit a
 * feeling the app does not know, because `<FEELING_IDS>` and `<CONTEXT_TAGS>` are
 * substituted from the constants here, at build time, rather than typed into a prompt.
 *
 * Two readers. A grammar-capable runtime (LiteRT-LM natively, llama.cpp through GBNF) is
 * handed `PROPOSAL_SCHEMA` and cannot produce tokens outside it. `validateProposal` in
 * `validate.js` runs everywhere regardless — a grammar is a guarantee about tokens, not
 * about meaning, and the web runtime has no grammar at all *(§5.2, still to verify in D3)*.
 *
 * `checkSchema` is the small evaluator that makes the schema the specification rather than
 * a document: the validator's last step and the test suite's first assertion both run it.
 * It covers exactly the keywords this schema uses and **throws on any other**, so a keyword
 * added to the schema without support here fails loudly instead of being silently ignored.
 */

import {
    activeFeelings,
    INTENSITY_LEVELS,
    MAX_FEELINGS_PER_CHECKIN,
    MAX_TRANSCRIPT_LENGTH,
    MAX_TRIGGER_LABEL
} from '../../constants/journal';
import { CONTEXT_TAGS, MAX_TAG_LENGTH } from '../../constants/contextTags';

/* ------------------------------------------------------------------------------------ */
/* 1. The numbers and the enums                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * §4.6's four answers. `none` is the ordinary case; the other three each make the card do
 * something specific, and the validator's fallback for anything it cannot use is `feeling`.
 */
export const AMBIGUITY = Object.freeze(['none', 'feeling', 'target', 'conflict']);

/** The three `about` kinds — the only things a feeling may be attached to. */
export const ABOUT_KINDS = Object.freeze(['person', 'tag', 'trigger']);

/**
 * Every cap in §5.2, taken from the constant that already owns the number where one exists
 * so that the schema, the composer and the server cannot drift apart on it. Lengths are in
 * code points — JSON Schema's `maxLength` and Go's `utf8.RuneCountInString` agree on that,
 * and `String.length` does not.
 */
export const LIMITS = Object.freeze({
    transcript: MAX_TRANSCRIPT_LENGTH,
    language: 8,
    name: 60,
    label: MAX_TRIGGER_LABEL,
    text: 120,
    feelings: MAX_FEELINGS_PER_CHECKIN,
    about: 3,
    people: 6,
    facts: 3
});

/** Length as the schema and the server count it. */
export const codePoints = (value) => Array.from(String(value ?? '')).length;

/* ------------------------------------------------------------------------------------ */
/* 2. The schema                                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * Build the §5.2 schema with the two closed vocabularies substituted.
 *
 * The defaults are the constants — `activeFeelings()`, not `FEELINGS`, because a retired
 * feeling is one the UI has stopped offering and a model proposing it would put back on the
 * card exactly what the retirement removed. Both lists can be overridden so a test can prove
 * the substitution actually happens, and so a context that was deliberately narrowed (a
 * later session's language-specific vocabulary, say) constrains the model to what its own
 * prompt offered.
 */
export const buildSchema = ({ feelingIds, tags } = {}) => {
    const ids = Array.isArray(feelingIds) && feelingIds.length
        ? [...feelingIds]
        : activeFeelings().map(feeling => feeling.id);
    const tagList = Array.isArray(tags) && tags.length ? [...tags] : [...CONTEXT_TAGS];

    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        required: ['transcript', 'language', 'feelings', 'people', 'facts', 'ambiguity'],
        properties: {
            transcript: { type: 'string', maxLength: LIMITS.transcript },
            language: { type: 'string', maxLength: LIMITS.language },
            feelings: {
                type: 'array',
                maxItems: LIMITS.feelings,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'intensity', 'about'],
                    properties: {
                        id: { enum: ids },
                        intensity: { enum: [...INTENSITY_LEVELS] },
                        about: {
                            type: 'array',
                            maxItems: LIMITS.about,
                            items: {
                                oneOf: [
                                    {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['kind', 'name'],
                                        properties: {
                                            kind: { const: 'person' },
                                            name: { type: 'string', maxLength: LIMITS.name }
                                        }
                                    },
                                    {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['kind', 'tag'],
                                        properties: {
                                            kind: { const: 'tag' },
                                            tag: { enum: tagList }
                                        }
                                    },
                                    {
                                        type: 'object',
                                        additionalProperties: false,
                                        required: ['kind', 'label'],
                                        properties: {
                                            kind: { const: 'trigger' },
                                            label: { type: 'string', maxLength: LIMITS.label }
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
            },
            people: {
                type: 'array',
                maxItems: LIMITS.people,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name'],
                    properties: { name: { type: 'string', maxLength: LIMITS.name } }
                }
            },
            facts: {
                type: 'array',
                maxItems: LIMITS.facts,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['person', 'text'],
                    properties: {
                        person: { type: 'string', maxLength: LIMITS.name },
                        text: { type: 'string', maxLength: LIMITS.text }
                    }
                }
            },
            ambiguity: { enum: [...AMBIGUITY] }
        }
    };
};

/**
 * The same contract, shaped for a grammar engine — **and the one difference is measured.**
 *
 * On 2026-09-02 `PROPOSAL_SCHEMA` as written above was handed to LiteRT-LM's constrained
 * decoder (LLGuidance) on a real Gemma 4 E2B bundle, and generation **died mid-answer**:
 *
 * > `Parser Error: token "▁period" doesn't satisfy the grammar; forced bytes: got ' ';`
 * > `applying 'â'` … `Stop: ParserTooComplex`
 *
 * The model was not misbehaving. It was writing `"routine period"` — a real member of
 * `CONTEXT_TAGS` — and the grammar refused it at the space. Gemma's tokeniser carries a
 * leading space inside a token (`▁period`), and LLGuidance's forced-bytes path cannot line
 * that up with an enum member that contains one; it mangles the byte and gives up. **Three of
 * the seven context tags contain a space**, so this is not an edge case, it is most of the
 * vocabulary.
 *
 * So the schema handed to the grammar differs from §5.2's in exactly one place: `tag` is a
 * bounded **string** rather than the closed enum. Everything else is unchanged, and that
 * matters — `id`, `intensity` and `ambiguity` are single-word enums, they bind correctly, and
 * they are the three the model could otherwise do real damage with: a feeling the app does
 * not have, an intensity nobody defined, an ambiguity the card cannot render.
 *
 * **The relaxation is safe because it is not the enforcement.** §5.2 already says a grammar
 * is a guarantee about tokens and not about meaning; `validateProposal` reads every answer
 * against the *strict* schema whatever produced it, and drops an unlisted tag as
 * `unknown_tag`. The same run proved that is not theoretical: the model answered
 * `{ kind: "tag", tag: "work" }`, where *work* is a trigger label and not a context tag, and
 * the validator is what catches it on both platforms.
 *
 * `schema.test.js` holds the two together: the only permitted difference is this one.
 */
export const buildGrammarSchema = (options = {}) => {
    const strict = buildSchema(options);
    const about = strict.properties.feelings.items.properties.about;
    const [person, tag, trigger] = about.items.oneOf;

    return {
        ...strict,
        properties: {
            ...strict.properties,
            feelings: {
                ...strict.properties.feelings,
                items: {
                    ...strict.properties.feelings.items,
                    properties: {
                        ...strict.properties.feelings.items.properties,
                        about: {
                            ...about,
                            items: {
                                oneOf: [
                                    person,
                                    {
                                        ...tag,
                                        properties: {
                                            ...tag.properties,
                                            // The one relaxation. Its members are back in
                                            // force one layer up, in `validateProposal`.
                                            tag: { type: 'string', maxLength: MAX_TAG_LENGTH }
                                        }
                                    },
                                    trigger
                                ]
                            }
                        }
                    }
                }
            }
        }
    };
};

/** The grammar the Android runtime is handed. Same vocabularies but one, which binds. */
export const PROPOSAL_GRAMMAR_SCHEMA = buildGrammarSchema();


/** The schema as the app ships it: today's active feelings, today's context tags. */
export const PROPOSAL_SCHEMA = buildSchema();

/** The feeling ids a schema admits — what a test reads to prove the substitution. */
export const schemaFeelingIds = (schema = PROPOSAL_SCHEMA) => (
    [...schema.properties.feelings.items.properties.id.enum]
);

/** The context tags a schema admits. */
export const schemaTags = (schema = PROPOSAL_SCHEMA) => (
    [...schema.properties.feelings.items.properties.about.items.oneOf[1].properties.tag.enum]
);

/* ------------------------------------------------------------------------------------ */
/* 3. The evaluator                                                                       */
/* ------------------------------------------------------------------------------------ */

const SUPPORTED_KEYWORDS = new Set([
    '$schema', 'type', 'additionalProperties', 'required', 'properties',
    'maxLength', 'maxItems', 'items', 'enum', 'const', 'oneOf'
]);

const typeOf = (value) => {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
};

const hasType = (value, type) => (
    type === 'integer' ? Number.isInteger(value) : typeOf(value) === type
);

/**
 * Check `value` against `schema`. Returns every violation as `{ path, message }`; an empty
 * array means valid.
 *
 * A deliberately small subset of JSON Schema — the keywords §5.2 uses and nothing else. It
 * throws on a keyword it does not know, because a `pattern` or a `minLength` that sits in
 * the schema unenforced is worse than one that is not there: it looks like a rule.
 */
export const checkSchema = (value, schema, path = '') => {
    const errors = [];
    const at = (message) => errors.push({ path: path || '/', message });

    Object.keys(schema).forEach((keyword) => {
        if (!SUPPORTED_KEYWORDS.has(keyword)) {
            throw new Error(`checkSchema: keyword "${keyword}" at ${path || '/'} is not enforced`);
        }
    });

    if (schema.oneOf) {
        const passing = schema.oneOf.filter(branch => checkSchema(value, branch, path).length === 0);
        if (passing.length !== 1) at(`matches ${passing.length} of ${schema.oneOf.length} alternatives`);
        return errors;
    }

    if (schema.const !== undefined && value !== schema.const) at(`must be ${JSON.stringify(schema.const)}`);
    if (schema.enum && !schema.enum.includes(value)) at('not one of the allowed values');

    if (schema.type && !hasType(value, schema.type)) {
        at(`must be ${schema.type}`);
        return errors;
    }

    if (schema.type === 'string' && schema.maxLength !== undefined && codePoints(value) > schema.maxLength) {
        at(`longer than ${schema.maxLength}`);
    }

    if (schema.type === 'array') {
        if (schema.maxItems !== undefined && value.length > schema.maxItems) at(`more than ${schema.maxItems} items`);
        if (schema.items) {
            value.forEach((item, index) => {
                errors.push(...checkSchema(item, schema.items, `${path}[${index}]`));
            });
        }
    }

    if (schema.type === 'object') {
        const properties = schema.properties || {};
        (schema.required || []).forEach((key) => {
            if (!(key in value)) at(`missing ${key}`);
        });
        if (schema.additionalProperties === false) {
            Object.keys(value).forEach((key) => {
                if (!(key in properties)) at(`unexpected ${key}`);
            });
        }
        Object.entries(properties).forEach(([key, sub]) => {
            if (key in value) errors.push(...checkSchema(value[key], sub, path ? `${path}.${key}` : key));
        });
    }

    return errors;
};
