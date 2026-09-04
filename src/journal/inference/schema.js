import {
    activeFeelings,
    INTENSITY_LEVELS,
    MAX_FEELINGS_PER_CHECKIN,
    MAX_TRANSCRIPT_LENGTH,
    MAX_TRIGGER_LABEL
} from '../../constants/journal';
import { CONTEXT_TAGS, MAX_TAG_LENGTH } from '../../constants/contextTags';

/* 1. The numbers and the enums */

export const AMBIGUITY = Object.freeze(['none', 'feeling', 'target', 'conflict']);

/** The three `about` kinds — the only things a feeling may be attached to. */
export const ABOUT_KINDS = Object.freeze(['person', 'tag', 'trigger']);

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

/* 2. The schema */

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

/* 3. The evaluator */

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
