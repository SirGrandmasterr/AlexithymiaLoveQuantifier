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

/* 1. The fixture user, as rows the app's readers accept */

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

/* 2. Scoring */

const inTopN = (results, wanted, n) => {
    const top = results.slice(0, n).map(doc => doc.id);
    return { found: wanted.filter(id => top.includes(id)), top };
};

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
