/**
 * The fake runtime. Every component test in this phase uses it, and none of them loads a
 * model to do it (§5.7).
 *
 * It is a fixture table with a matcher in front: given a request, find the rule that claims
 * it and return that rule's proposal — or throw that rule's error, because "the runtime
 * failed" is a path the card has to render too (§4.6) and a fake that can only succeed cannot
 * test it.
 *
 * **This module is not imported by anything the app ships.** `inference/index.js` deliberately
 * does not re-export it, so it stays out of the bundle graph rather than relying on a
 * tree-shake to notice. Tests import it directly.
 *
 * What it is not: a model. It has no opinion about language, it does not read the audio, and
 * it will happily return a proposal that D1's validator would reject — which is the point.
 * The fixtures that describe what a *real* model may emit are D1's `golden/`; these are
 * scaffolding for the screens.
 */

// From `contract.js` rather than `index.js`: importing the barrel would pull the real
// web runtime — and Vite's `?url` asset imports inside it — into every test that only
// wanted a fake.
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

/**
 * Fixtures may be written three ways, because three different tests want three different
 * amounts of ceremony:
 *
 * - **one proposal** — always returned, for a test that only cares that a card renders;
 * - **a map** of `{ 'some words': proposal }` — matched as a case-insensitive substring;
 * - **an array** of `{ match, proposal, error }` — the full form, and the only one that can
 *   script a failure or match on the request itself.
 */
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

/**
 * A proposal in the shape §5.2 specifies, with everything overridable.
 *
 * Its defaults are the §4.7 sentence the design traces end to end, so a test that needs "a
 * proposal, any proposal" gets one that resembles what the product is actually for rather
 * than `{}`.
 */
export const proposalFixture = (overrides = {}) => ({
    transcript: 'Lucie called and I felt lighter afterwards.',
    language: 'en',
    feelings: [{ id: 'rapport', intensity: 2, about: [{ kind: 'person', name: 'Lucie' }] }],
    people: [{ name: 'Lucie' }],
    facts: [],
    ambiguity: 'none',
    ...overrides
});

/**
 * Build a fake runtime.
 *
 * `options.accepts` is how a test reproduces a tier: `['text']` is the Light tier's proposal
 * model, `[]` is a device with nothing on it, and the default is both.
 */
export const createFakeRuntime = (fixtures = null, options = {}) => {
    const {
        id = RUNTIME_IDS.fake,
        tier = 'fake',
        accepts = [INPUT_MODES.audio, INPUT_MODES.text],
        latencyMs = 0,
        fallback = null,
        // What the provenance block (§6.3) records about who proposed. A real runtime
        // declares both; a test that asserts the §4.7 payload byte for byte sets them to
        // the names that example uses.
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
                // Louder than returning nothing: an unmatched request is nearly always a
                // test whose fixture and whose input drifted apart, and finding that from a
                // blank card costs an afternoon.
                throw new Error(`fake runtime: no fixture matched ${JSON.stringify(requestText(request)).slice(0, 80)}`);
            }
            if (rule.error) throw rule.error;
            return rule.proposal === null ? null : copy(rule.proposal);
        },
        reset: () => { calls.length = 0; }
    };
};
