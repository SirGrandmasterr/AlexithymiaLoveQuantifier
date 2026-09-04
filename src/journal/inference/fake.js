import { RUNTIME_IDS, INPUT_MODES } from './contract';

/** A structural copy, so a caller that edits a proposal cannot rewrite the fixture behind it. */
const copy = (value) => (
    typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
);

/** The text a matcher tests against: the words for a typed note, the clip ids for a spoken one. */
const requestText = (request) => {
    if (request?.kind === INPUT_MODES.text) return String(request.text ?? '');
    return (request?.clips || []).map(clip => clip?.id ?? '').join(' ');
};

const toMatcher = (match) => {
    if (typeof match === 'function') return match;
    if (match instanceof RegExp) return (request) => match.test(requestText(request));
    if (typeof match === 'string') {
        const needle = match.toLowerCase();
        return (request) => requestText(request).toLowerCase().includes(needle);
    }
    // No matcher at all means "this fixture answers everything", which is what a single
    // proposal handed to `createFakeRuntime` should do.
    return () => true;
};

export const normalizeFixtures = (fixtures) => {
    if (!fixtures) return [];
    if (Array.isArray(fixtures)) {
        return fixtures.map(entry => ({
            matches: toMatcher(entry?.match),
            proposal: entry?.proposal ?? null,
            error: entry?.error ?? null
        }));
    }
    if (typeof fixtures === 'object') {
        const looksLikeAProposal = 'transcript' in fixtures || 'feelings' in fixtures || 'ambiguity' in fixtures;
        if (looksLikeAProposal) return [{ matches: () => true, proposal: fixtures, error: null }];
        return Object.entries(fixtures).map(([match, proposal]) => ({
            matches: toMatcher(match),
            proposal,
            error: null
        }));
    }
    return [];
};

export const proposalFixture = (overrides = {}) => ({
    transcript: 'Lucie called and I felt lighter afterwards.',
    language: 'en',
    feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Lucie' }] }],
    people: [{ name: 'Lucie' }],
    facts: [],
    ambiguity: 'none',
    ...overrides
});

export const createFakeRuntime = (fixtures = null, options = {}) => {
    const {
        id = RUNTIME_IDS.fake,
        tier = 'fake',
        accepts = [INPUT_MODES.audio, INPUT_MODES.text],
        latencyMs = 0,
        fallback = null,
        model = null,
        promptVersion = null
    } = options;

    const rules = normalizeFixtures(fixtures);
    const calls = [];

    return {
        id,
        tier,
        accepts,
        model,
        promptVersion,
        /** Every request this runtime was given, in order. Assert on it, do not guess. */
        calls,
        propose: async (request) => {
            calls.push(request);

            if (latencyMs > 0) {
                await new Promise(resolve => { setTimeout(resolve, latencyMs); });
            }

            const rule = rules.find(entry => entry.matches(request));
            if (!rule) {
                if (fallback) return copy(fallback);
                throw new Error(`fake runtime: no fixture matched ${JSON.stringify(requestText(request)).slice(0, 80)}`);
            }
            if (rule.error) throw rule.error;
            return rule.proposal === null ? null : copy(rule.proposal);
        },
        reset: () => { calls.length = 0; }
    };
};
