/**
 * The retrieval golden set, and the one function that scores it (§5.8, session G2).
 *
 *     given these entries, query x returns y in the top three — in German and in English
 *
 * §5.8 asks for exactly that and G1 did not build it, because G1 offers *labels* and this is
 * about *entries*. It is the thing that keeps `SIMILARITY_FLOOR` honest and the thing a
 * later session moves that constant against.
 *
 * ---
 *
 * **One suite, two modes, and the difference is what a case actually proves.**
 *
 * A **lexical** case is answered by words: *Fussball* finds *Fußball*, *Nebenkosten* finds
 * *Nebenkostenabrechnung*, *Umzug* finds a day that never says it because it is filed under
 * a trigger whose label does. Those need no model and no vectors, so they run inside
 * `npm test` against the search the app actually ships — real evidence, not a fake's.
 *
 * A **semantic** case shares no content word with its answer: *"Wann war ich zuletzt so
 * ausgelaugt von meinem Job?"* has to reach an entry about being *erschöpft* after a day in
 * the *Büro*. Nothing but the embedding model can do that. `npm test` therefore records
 * those as **skipped**, by name, with the reason — never as passes — and
 * `scripts/journal-eval/retrieval.mjs` is what scores them on a machine with the weights.
 *
 * Reporting a skip as a skip is the whole point. A suite that quietly graded the semantic
 * half against a hashed-n-gram stand-in would report a number about the stand-in and put it
 * in a document beside numbers that are about a model.
 *
 * ---
 *
 * **The suite goes through the app's own readers.** `expand` turns each fixture row into the
 * §6.3 payload the server would have stored, and `suiteDocuments` hands those to
 * `buildDocuments` — the same function the search screen calls. A suite with its own private
 * idea of what an entry is would pass on the day the readers changed underneath it.
 */

import { PAYLOAD_VERSION, indexTriggers, readTrigger } from '../../constants/journal';
import { buildDocuments, recall } from './recall';
import suite from './golden/retrieval.json';

export const RETRIEVAL_SUITE = suite;

/** *"…returns y in the **top three**"*, from §5.8. The only number the suite has. */
export const TOP_N = 3;

export const RETRIEVAL_MODES = Object.freeze({ lexical: 'lexical', semantic: 'semantic' });

export const RETRIEVAL_STATUS = Object.freeze({
    pass: 'pass',
    fail: 'fail',
    /** Scoreable only with an embedder, and none was supplied. Never counted as a pass. */
    skipped: 'skipped'
});

/* ------------------------------------------------------------------------------------ */
/* 1. The fixture user, as rows the app's readers accept                                  */
/* ------------------------------------------------------------------------------------ */

/** One `kind: "trigger"` row per label the fixture names (§6.3). */
export const suiteTriggerEntries = (source = suite) => source.triggers.map((trigger, index) => ({
    ID: 1000 + index,
    client_id: trigger.client_id,
    kind: 'trigger',
    day: '2026-01-01',
    at: '2026-01-01T09:00:00+01:00',
    payload: { v: PAYLOAD_VERSION, label: trigger.label, merged_into: null, corrects: [] },
    mentions: []
}));

/** One `kind: "checkin"` row per fixture entry, in the §6.3 shape the server stores. */
export const suiteCheckinEntries = (source = suite) => source.entries.map((entry, index) => ({
    ID: index + 1,
    client_id: entry.client_id,
    kind: 'checkin',
    day: entry.day,
    at: entry.at,
    payload: {
        v: PAYLOAD_VERSION,
        source: 'voice',
        transcript: entry.transcript,
        transcript_kept: true,
        language: entry.language,
        feelings: entry.feelings.map(feeling => ({
            id: feeling.id,
            intensity: 2,
            uncertain: false,
            about: feeling.about
        })),
        tags: []
    },
    mentions: entry.mentions.map((mention, at) => ({ ...mention, ref: at }))
}));

export const suiteEntries = (source = suite) => [
    ...suiteTriggerEntries(source),
    ...suiteCheckinEntries(source)
];

/**
 * The suite as the search screen would see it.
 *
 * Trigger resolution goes through `indexTriggers`/`readTrigger` rather than a local map, so
 * a fixture whose vocabulary was renamed or merged would be read exactly as a real one is.
 */
export const suiteDocuments = (source = suite) => {
    const entries = suiteEntries(source);
    const index = indexTriggers(entries.filter(entry => entry.kind === 'trigger'));
    const names = new Map(source.relationships.map(person => [person.ID, person.name]));

    return buildDocuments({
        entries: entries.filter(entry => entry.kind !== 'trigger'),
        snapshots: source.snapshots,
        resolveTrigger: (id) => readTrigger(id, index),
        personName: (mention) => names.get(mention?.relationship_id) ?? mention?.label ?? ''
    });
};

/** Every text the index would hold a vector for, keyed by the id it is stored under. */
export const suiteTexts = (source = suite) => {
    const texts = new Map();
    suiteDocuments(source).forEach(doc => { texts.set(doc.id, doc.text); });
    return texts;
};

/* ------------------------------------------------------------------------------------ */
/* 2. Scoring                                                                             */
/* ------------------------------------------------------------------------------------ */

const inTopN = (results, wanted, n) => {
    const top = results.slice(0, n).map(doc => doc.id);
    return { found: wanted.filter(id => top.includes(id)), top };
};

/**
 * Score one case.
 *
 * `vectors` is the index as `recall` takes it and `queryVector` is the embedded query; both
 * absent is the lexical run. A semantic case with no vectors is `skipped` and says why — it
 * is not run and failed, and it is certainly not run and passed.
 *
 * A case passes when **every** id it names is in the top three and none of its `must_not`
 * ids is. The second half matters as much as the first: a search that answers a question
 * about loneliness with the walk by the river has not half-succeeded.
 */
export const scoreRetrievalCase = (testCase, { docs, vectors = new Map(), queryVector = null } = {}) => {
    const base = {
        id: testCase.id,
        language: testCase.language,
        mode: testCase.mode,
        query: testCase.query,
        expect: testCase.expect,
        must_not: testCase.must_not ?? []
    };

    if (testCase.mode === RETRIEVAL_MODES.semantic && !queryVector) {
        return {
            ...base,
            status: RETRIEVAL_STATUS.skipped,
            reason: 'needs the embedding model: this query shares no content word with its answer',
            top: [],
            found: [],
            missing: [...testCase.expect]
        };
    }

    const { matched, similar } = recall({
        query: testCase.query,
        docs,
        vectors,
        queryVector,
        limit: TOP_N * 2,
        semanticLimit: TOP_N * 2
    });

    // The order the screen draws: what was found, then what looks alike. A semantic case is
    // answered out of the second list and a lexical one out of the first, and the top three
    // is over the two of them read as one column, which is what a reader's eye does.
    const results = [...matched, ...similar];
    const { found, top } = inTopN(results, testCase.expect, TOP_N);
    const forbidden = base.must_not.filter(id => top.includes(id));

    return {
        ...base,
        status: found.length === testCase.expect.length && forbidden.length === 0
            ? RETRIEVAL_STATUS.pass
            : RETRIEVAL_STATUS.fail,
        top,
        found,
        missing: testCase.expect.filter(id => !found.includes(id)),
        forbidden
    };
};

/**
 * Score the whole suite.
 *
 * `embed` is optional and is `(texts, kind) => Promise<vectors>` — the same two-kind
 * boundary `embedTexts` presents, because the prefixes are mandatory and a harness that
 * embedded a query as a document would be measuring the wrong space (§5.8, G1's second
 * finding). Without it every semantic case is skipped and the summary says how many.
 */
export const runRetrievalSuite = async ({ source = suite, embed = null } = {}) => {
    const docs = suiteDocuments(source);

    let vectors = new Map();
    if (embed) {
        const ids = docs.map(doc => doc.id);
        const stored = await embed(docs.map(doc => doc.text), 'document');
        ids.forEach((id, at) => {
            if (stored[at]) vectors.set(id, { vector: stored[at] });
        });
    }

    const cases = [];
    for (const testCase of source.cases) {
        let queryVector = null;
        if (embed && testCase.mode === RETRIEVAL_MODES.semantic) {
            queryVector = (await embed([testCase.query], 'query'))[0] ?? null;
        }
        cases.push(scoreRetrievalCase(testCase, { docs, vectors, queryVector }));
    }

    const count = (status, mode = null) => cases.filter(row => (
        row.status === status && (mode === null || row.mode === mode)
    )).length;

    return {
        documents: docs.length,
        cases,
        summary: {
            total: cases.length,
            pass: count(RETRIEVAL_STATUS.pass),
            fail: count(RETRIEVAL_STATUS.fail),
            skipped: count(RETRIEVAL_STATUS.skipped),
            lexical: {
                total: source.cases.filter(row => row.mode === RETRIEVAL_MODES.lexical).length,
                pass: count(RETRIEVAL_STATUS.pass, RETRIEVAL_MODES.lexical),
                fail: count(RETRIEVAL_STATUS.fail, RETRIEVAL_MODES.lexical)
            },
            semantic: {
                total: source.cases.filter(row => row.mode === RETRIEVAL_MODES.semantic).length,
                pass: count(RETRIEVAL_STATUS.pass, RETRIEVAL_MODES.semantic),
                fail: count(RETRIEVAL_STATUS.fail, RETRIEVAL_MODES.semantic),
                skipped: count(RETRIEVAL_STATUS.skipped, RETRIEVAL_MODES.semantic)
            },
            byLanguage: ['de', 'en'].reduce((all, language) => ({
                ...all,
                [language]: {
                    total: cases.filter(row => row.language === language).length,
                    pass: cases.filter(row => row.language === language && row.status === RETRIEVAL_STATUS.pass).length,
                    fail: cases.filter(row => row.language === language && row.status === RETRIEVAL_STATUS.fail).length
                }
            }), {})
        }
    };
};
