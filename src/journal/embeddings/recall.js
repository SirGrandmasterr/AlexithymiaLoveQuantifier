import { readCheckin, readPersonFact, readRitual } from '../../constants/journal';
import { MAX_SIMILAR, SIMILARITY_FLOOR, cosine, witnessAgrees } from './similar';

/* 1. Folding and tokens */

export const foldSearch = (value) => (
    String(value ?? '')
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/ß/g, 'ss')
);

/** Below this a token is punctuation or an article, in every language this has to serve. */
export const MIN_TOKEN_LENGTH = 2;

/** Folded words, in order, with the short ones dropped. Never language-specific. */
export const tokenise = (text) => (
    foldSearch(text)
        .split(/[^\p{L}\p{N}]+/u)
        .filter(token => token.length >= MIN_TOKEN_LENGTH)
);

/* 2. What a search reads */

/** How many results a search shows. Longer than three, because the user asked for these. */
export const MAX_RESULTS = 20;

/** How many semantic neighbours may follow the lexical matches. */
export const MAX_SEMANTIC = 5;

const clean = (value) => String(value ?? '').trim();

export const journalDocument = (entry, { resolveTrigger = (id) => ({ live: id, label: '' }), personName = () => '' } = {}) => {
    if (!entry?.client_id || !entry.kind) return null;

    const parts = [];
    const feelings = [];
    const triggers = new Set();
    const people = new Set();

    (Array.isArray(entry.mentions) ? entry.mentions : []).forEach(mention => {
        if (Number.isFinite(mention?.relationship_id)) people.add(mention.relationship_id);
        const name = clean(personName(mention) || mention?.label);
        if (name) parts.push(name);
    });

    if (entry.kind === 'checkin') {
        const payload = readCheckin(entry.payload);
        if (payload.transcript) parts.push(payload.transcript);
        if (payload.note) parts.push(payload.note);

        const filed = new Set();
        payload.tags.forEach(tag => filed.add(clean(tag)));
        payload.feelings.forEach(feeling => {
            feelings.push(feeling.id);
            feeling.about.forEach(about => {
                if (about.kind === 'tag' && about.tag) filed.add(clean(about.tag));
                if (about.kind !== 'trigger' || !about.trigger) return;
                const resolved = resolveTrigger(about.trigger);
                if (resolved?.live) triggers.add(resolved.live);
                filed.add(clean(resolved?.label));
            });
        });
        filed.forEach(label => { if (label) parts.push(label); });
    } else if (entry.kind === 'ritual') {
        const payload = readRitual(entry.payload);
        if (payload.dayWord?.id) feelings.push(payload.dayWord.id);
    } else if (entry.kind === 'person_fact') {
        const text = clean(readPersonFact(entry.payload).text);
        if (text) parts.push(text);
    } else {
        return null;
    }

    return {
        id: entry.client_id,
        rowId: Number.isFinite(entry.ID) ? entry.ID : null,
        kind: entry.kind,
        day: entry.day ?? null,
        at: entry.at ?? null,
        text: parts.join(' · '),
        feelings,
        triggers: [...triggers],
        people: [...people]
    };
};

export const snapshotDocument = (subject) => {
    if (!subject || !Number.isFinite(subject.ID)) return null;

    const description = clean(subject.description);
    if (!description) return null;

    const parts = [clean(subject.name), description];
    (Array.isArray(subject.tags) ? subject.tags : []).forEach(tag => parts.push(clean(tag)));

    const text = parts.filter(Boolean).join(' · ');

    return {
        id: `snapshot:${subject.ID}`,
        rowId: subject.ID,
        kind: 'snapshot',
        day: typeof subject.date === 'string' ? subject.date.slice(0, 10) : null,
        at: subject.date ?? null,
        text,
        feelings: [],
        triggers: [],
        people: Number.isFinite(subject.relationship_id) ? [subject.relationship_id] : [],
        relationshipId: Number.isFinite(subject.relationship_id) ? subject.relationship_id : null
    };
};

export const buildDocuments = ({ entries = [], snapshots = [], resolveTrigger, personName } = {}) => {
    const docs = [];

    (Array.isArray(entries) ? entries : []).forEach(entry => {
        const doc = journalDocument(entry, { resolveTrigger, personName });
        if (doc) docs.push(doc);
    });
    (Array.isArray(snapshots) ? snapshots : []).forEach(subject => {
        const doc = snapshotDocument(subject);
        if (doc) docs.push(doc);
    });

    return docs.map(doc => ({ ...doc, folded: foldSearch(doc.text), tokens: new Set(tokenise(doc.text)) }));
};

/* 3. The lexical half */

export const tokenWeights = (docs) => {
    const total = Math.max(1, docs.length);
    const frequency = new Map();

    docs.forEach(doc => {
        doc.tokens.forEach(token => frequency.set(token, (frequency.get(token) ?? 0) + 1));
    });

    return (token) => {
        const seen = frequency.get(token) ?? 0;
        return Math.max(0.05, Math.log(total / (1 + seen)));
    };
};

const tokenHit = (doc, token) => {
    if (doc.tokens.has(token)) return 1;
    return doc.folded.includes(token) ? 0.75 : 0;
};

export const LEXICAL_FLOOR = 0.25;
export const RELATIVE_FLOOR = 0.3;

export const lexicalRank = (query, docs, { weights = null } = {}) => {
    const tokens = [...new Set(tokenise(query))];
    if (tokens.length === 0 || docs.length === 0) return [];

    const weightOf = weights ?? tokenWeights(docs);
    const total = tokens.reduce((sum, token) => sum + weightOf(token), 0);
    if (total <= 0) return [];

    const phrase = foldSearch(query);
    const phrased = phrase.includes(' ');

    const hits = [];
    docs.forEach(doc => {
        let score = 0;
        tokens.forEach(token => { score += weightOf(token) * tokenHit(doc, token); });
        if (score <= 0) return;

        let share = score / total;
        if (phrased && doc.folded.includes(phrase)) share = Math.min(1, share + 0.25);
        hits.push({ doc, score: share });
    });

    // Ties break on recency and then on id, so two runs over the same journal agree and the
    // more recent of two equally good answers is the one nearer the top.
    hits.sort((a, b) => (
        b.score - a.score
        || String(b.doc.at ?? '').localeCompare(String(a.doc.at ?? ''))
        || a.doc.id.localeCompare(b.doc.id)
    ));

    const best = hits[0]?.score ?? 0;
    return hits.filter(hit => hit.score >= LEXICAL_FLOOR && hit.score >= best * RELATIVE_FLOOR);
};

/* 4. Search */

export const recall = ({
    query,
    docs = [],
    queryVector = null,
    vectors = new Map(),
    limit = MAX_RESULTS,
    semanticLimit = MAX_SEMANTIC,
    floor = SIMILARITY_FLOOR
} = {}) => {
    const matched = lexicalRank(query, docs).slice(0, limit).map(hit => hit.doc);

    if (!queryVector || queryVector.length === 0 || vectors.size === 0) {
        return { matched, similar: [] };
    }

    const already = new Set(matched.map(doc => doc.id));
    const neighbours = [];
    docs.forEach(doc => {
        if (already.has(doc.id)) return;
        const stored = vectors.get(doc.id);
        if (!stored) return;
        const similarity = cosine(queryVector, stored.vector);
        if (similarity >= floor) neighbours.push({ doc, similarity });
    });

    neighbours.sort((a, b) => b.similarity - a.similarity || a.doc.id.localeCompare(b.doc.id));

    return { matched, similar: neighbours.slice(0, semanticLimit).map(hit => hit.doc) };
};

/* 5. "Your past entries" */

export const pastEntryOffers = ({
    queryVector = null,
    docs = [],
    vectors = new Map(),
    context = {},
    exclude = [],
    limit = MAX_SIMILAR,
    floor = SIMILARITY_FLOOR
} = {}) => {
    if (!queryVector || queryVector.length === 0 || vectors.size === 0) return [];

    const people = context.people instanceof Set ? context.people : new Set(context.people || []);
    const triggers = context.triggers instanceof Set ? context.triggers : new Set(context.triggers || []);
    if (people.size === 0 && triggers.size === 0) return [];

    const skip = new Set(exclude.filter(Boolean).map(String));

    const hits = [];
    docs.forEach(doc => {
        if (doc.kind !== 'checkin' || doc.feelings.length === 0) return;
        const stored = vectors.get(doc.id);
        if (!stored) return;

        const similarity = cosine(queryVector, stored.vector);
        if (similarity < floor) return;

        // The witness sides are the entry's own structure and the card's, so this is the
        // same intersection `witnessAgrees` performs for a trigger — one function, one rule.
        const witness = { people: new Set(doc.people), triggers: new Set(doc.triggers) };
        if (!witnessAgrees(witness, { people, triggers })) return;

        hits.push({ doc, similarity });
    });

    const byFeeling = new Map();
    hits.forEach(({ doc, similarity }) => {
        new Set(doc.feelings).forEach(id => {
            if (skip.has(id)) return;
            if (!byFeeling.has(id)) byFeeling.set(id, { id, entryClientIds: [], count: 0, best: 0 });
            const row = byFeeling.get(id);
            row.entryClientIds.push(doc.id);
            row.count += 1;
            row.best = Math.max(row.best, similarity);
        });
    });

    return [...byFeeling.values()]
        .sort((a, b) => b.count - a.count || b.best - a.best || a.id.localeCompare(b.id))
        .slice(0, limit)
        // The similarity and the count are dropped here, on `similar.js`'s rule: what leaves
        // this module has no number on it for a component to render by accident.
        .map(row => ({ id: row.id, entryClientIds: row.entryClientIds }));
};

/* 6. Namesakes */

export const orderNamesakes = (candidates = [], {
    queryVector = null,
    docs = [],
    vectors = new Map(),
    floor = SIMILARITY_FLOOR
} = {}) => {
    const rows = Array.isArray(candidates) ? [...candidates] : [];
    if (rows.length < 2 || !queryVector || queryVector.length === 0 || vectors.size === 0) return rows;

    /** The best similarity of this sentence to anything the user said about one person. */
    const best = new Map();
    docs.forEach(doc => {
        const stored = vectors.get(doc.id);
        if (!stored || doc.people.length === 0) return;
        const similarity = cosine(queryVector, stored.vector);
        if (similarity < floor) return;
        doc.people.forEach(id => {
            if (!best.has(id) || best.get(id) < similarity) best.set(id, similarity);
        });
    });

    if (best.size === 0) return rows;

    // A stable sort over the original positions: equal evidence — including no evidence at
    // all on either side — leaves the two candidates in the order §4.5 put them in.
    return rows
        .map((candidate, at) => ({ candidate, at, score: best.get(candidate?.relationshipId) ?? -1 }))
        .sort((a, b) => b.score - a.score || a.at - b.at)
        .map(row => row.candidate);
};

/* 7. "Already known?" */

export const OVERLAP_FLOOR = 0.5;

export const alreadyKnown = (text, existing = [], { relationshipId = null, floor = OVERLAP_FLOOR } = {}) => {
    const tokens = new Set(tokenise(text));
    if (tokens.size === 0) return null;

    let best = null;
    (Array.isArray(existing) ? existing : []).forEach(row => {
        if (relationshipId != null && row?.relationshipId != null && row.relationshipId !== relationshipId) return;

        const other = new Set(tokenise(row?.text));
        if (other.size === 0) return;

        let shared = 0;
        tokens.forEach(token => { if (other.has(token)) shared += 1; });
        // Jaccard rather than a one-sided share: *"moved to Lyon"* against a paragraph that
        // happens to contain those three words is not the same statement twice.
        const overlap = shared / (tokens.size + other.size - shared);
        if (overlap >= floor && (!best || overlap > best.overlap)) best = { row, overlap };
    });

    return best ? best.row : null;
};

/* 8. Context for the proposal model */

export const RETRIEVAL_K = 5;

export const retrievalVocabulary = ({
    queryVector = null,
    docs = [],
    vectors = new Map(),
    people = [],
    triggers = [],
    relationshipName = () => '',
    triggerLabel = () => '',
    k = RETRIEVAL_K,
    floor = SIMILARITY_FLOOR
} = {}) => {
    const known = { people: [...people], triggers: [...triggers] };
    if (!queryVector || queryVector.length === 0 || vectors.size === 0) return known;

    const hits = [];
    docs.forEach(doc => {
        if (doc.kind !== 'checkin') return;
        const stored = vectors.get(doc.id);
        if (!stored) return;
        const similarity = cosine(queryVector, stored.vector);
        if (similarity >= floor) hits.push({ doc, similarity });
    });

    hits.sort((a, b) => b.similarity - a.similarity || a.doc.id.localeCompare(b.doc.id));

    const wantedPeople = new Set();
    const wantedTriggers = new Set();
    hits.slice(0, k).forEach(({ doc }) => {
        doc.people.forEach(id => {
            const name = clean(relationshipName(id));
            if (name) wantedPeople.add(name);
        });
        doc.triggers.forEach(id => {
            const label = clean(triggerLabel(id));
            if (label) wantedTriggers.add(label);
        });
    });

    /** Front the ones retrieval surfaced; keep every other word, in the order it came. */
    const front = (list, wanted) => [
        ...list.filter(value => wanted.has(value)),
        ...list.filter(value => !wanted.has(value))
    ];

    return {
        people: front(known.people, wantedPeople),
        triggers: front(known.triggers, wantedTriggers)
    };
};
