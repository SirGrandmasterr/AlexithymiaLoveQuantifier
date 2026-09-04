/**
 * Recall — the one question a journal is for (§5.8's use table), and the four smaller uses
 * that share its machinery.
 *
 * Everything here is pure: no storage, no model, no React, no `axios`. What it takes is a
 * list of entries the client already holds and a map of vectors the device already built;
 * what it gives back is **entries**, in an order, with no number on any of them.
 *
 * ---
 *
 * **Two halves, and the difference between them is the whole design.**
 *
 * A *lexical* match is a fact: the word is in the entry, and the user can see it there. A
 * *semantic* match is a guess: this device thinks two sentences are alike. So the two are
 * kept apart all the way to the screen — `recall` returns `matched` and `similar` as two
 * lists, the screen labels them differently, and a semantic hit can never be presented as
 * though the user's words were found in it. That is rule 2 applied to search: similarity
 * may propose, and may not claim.
 *
 * It is also what makes search **work at all on a device with the index off**, which is
 * every device by default. The lexical half needs no model, no weights and no vectors; the
 * semantic half is the part that arrives with the download. `retrieval.json`'s lexical
 * cases are therefore real evidence about the shipped feature rather than about a fake.
 *
 * **Why inverse document frequency and not a stopword list.** *"Wann habe ich mich zuletzt
 * so wegen der Arbeit gefühlt?"* is mostly words that are in every entry. Ranking by how
 * many query words a document contains would put the whole journal at the top. A stopword
 * list would fix it in one language and break it in the next — and §12.1 says this feature
 * matters most for the users whose notes mix languages. So a token's weight is computed
 * from **this user's own entries**: a word in half of them is worth almost nothing, a word
 * in one is worth a lot. No language is named anywhere in this file.
 *
 * **Folding is German-aware in exactly one place beyond the app's usual fold.** `ß` is not
 * a diacritic and `normalize('NFD')` leaves it standing, so *Fußball* and *Fussball* would
 * be two words; the one extra `replace` is what makes them one. Substring matching does the
 * rest of German's work: *Arbeit* finds *Arbeitstag* without a compound splitter, because a
 * compound contains its parts.
 *
 * ---
 *
 * **Rule 3 still applies to everything that becomes a suggestion.** `recall` is search — the
 * user typed the query, reads the results and decides, so geometry is allowed to speak. But
 * `pastEntryOffers`, `orderNamesakes` and `alreadyKnown` all put something in front of a
 * user who did not ask for it, and each of those goes through the same structural gate the
 * card's trigger offers do: a shared person or a shared trigger, or nothing.
 */

import { readCheckin, readPersonFact, readRitual } from '../../constants/journal';
import { MAX_SIMILAR, SIMILARITY_FLOOR, cosine, witnessAgrees } from './similar';

/* ------------------------------------------------------------------------------------ */
/* 1. Folding and tokens                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The comparison form of a string: no case, no diacritics, no `ß`.
 *
 * Wider than `constants/journal.js`'s `fold`, which exists to compare *one name against
 * one name* and is right not to touch `ß` — a person spelling their own name with one has
 * not spelled it *ss*. Search is the other case: the user is remembering a word, not
 * naming a person, and *Fussball* has to find *Fußball*.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 2. What a search reads                                                                 */
/* ------------------------------------------------------------------------------------ */

/** How many results a search shows. Longer than three, because the user asked for these. */
export const MAX_RESULTS = 20;

/** How many semantic neighbours may follow the lexical matches. */
export const MAX_SEMANTIC = 5;

const clean = (value) => String(value ?? '').trim();

/**
 * One entry as something searchable: its own words, the words it is filed under, and the
 * two structural facts rule 3 weighs.
 *
 * `id` is the **entry client id**, which is what a retrieval chip's provenance carries and
 * what the vector index is keyed on — the same id on every device that holds the row.
 *
 * A `trigger` row is not here. Triggers are vocabulary rather than events, and §5.8's use
 * table says results are *entries*: a search that answered with the word *work* rather than
 * with the days it was said on would be answering a different question.
 */
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

        // Each label appears **once**, however many feelings name it. Two feelings about
        // *work* is one word about the day, and repeating it would tilt both halves of
        // retrieval: the lexical score would count it twice, and the embedding of a
        // sentence ending *"· work · work"* is a different point from the one for the same
        // day recorded with one feeling.
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

/**
 * One love snapshot as something searchable — §5.8's *"and snapshot notes"*.
 *
 * The note and the context chips, never the seven numbers: a search that ranked a day by a
 * score would be the hidden math the roadmap forbids, and the numbers are not words anyway.
 * Its id is prefixed so it can never collide with an entry client id, and so a caller that
 * forgets which kind it is holding gets a string it cannot mistake for one.
 *
 * There is no vector for a snapshot. The index is built from *journal entries* (§5.8 rule
 * 1, *"from the entries it already holds decrypted"*), so a snapshot can be found by its
 * words and never by similarity — which is stated rather than hidden, because a user who
 * searched for a feeling and got no snapshot back should be able to know why.
 */
export const snapshotDocument = (subject) => {
    if (!subject || !Number.isFinite(subject.ID)) return null;

    // A snapshot with no note has nothing to search: the seven numbers are not words, and
    // ranking a day by a score would be the hidden math the roadmap forbids. Guarded before
    // the parts are assembled rather than after, so the refusal reads as the rule it is.
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

/**
 * Everything one user can search, with each document's tokens computed once.
 *
 * Built once per set of rows rather than per query: a user typing into a search box
 * produces a query per keystroke, and re-tokenising the whole journal for each of them is
 * the difference between a screen that answers as you type and one that does not.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 3. The lexical half                                                                    */
/* ------------------------------------------------------------------------------------ */

/**
 * How much one token is worth, computed from this user's own corpus.
 *
 * `log(total / (1 + df))`, floored at a small positive number so that a word in *every*
 * entry still counts for something rather than for nothing — a one-word query for a word
 * the user uses constantly should still return their entries, in date order, rather than
 * an empty screen.
 */
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

/**
 * Where a query token is found in a document: as a whole word, inside one, or not at all.
 *
 * A whole word is worth its full weight and a substring three-quarters of it. The substring
 * rule is what makes German compounds work without a splitter — *Arbeit* is inside
 * *Arbeitstag* — and the discount is what stops *rot* from beating *rot* in a document that
 * merely contains *Brot*.
 */
const tokenHit = (doc, token) => {
    if (doc.tokens.has(token)) return 1;
    return doc.folded.includes(token) ? 0.75 : 0;
};

/**
 * How much of a query's weight a document must account for before it is a *find* at all.
 *
 * Both floors exist because the golden set caught what happens without them, and each
 * catches a case the other does not.
 *
 * **The absolute floor** is for a question. *"Wann habe ich mich zuletzt einsam gefühlt?"*
 * is seven words of which one matters; an entry that contains only *habe* is not an answer,
 * and without this it would sit in `matched` — above the semantically right entry, which is
 * in `similar` — for no better reason than that `haben` contains `habe`. Weighting alone
 * cannot fix that: a weak hit still outranks a list it is not in.
 *
 * **The relative floor** is for a phrase. *"the move"* would otherwise return most of the
 * journal, because *the* is in most of it and two thirds of a two-word query is a large
 * share. Measured against the best hit rather than against nothing, those rows disappear.
 *
 * Neither is a similarity threshold and neither is ever shown. They decide what counts as
 * containing the words, which is a question about the query rather than about the user.
 */
export const LEXICAL_FLOOR = 0.25;
export const RELATIVE_FLOOR = 0.3;

/**
 * The documents whose words overlap the query, best first.
 *
 * The score is the share of the query's *weight* the document accounts for, so a query of
 * one rare word and four common ones is answered by the rare one. A document containing the
 * whole query as a phrase gets a bounded bonus, because *"nicht wütend, nur müde"* found
 * verbatim is a different kind of answer from the same five words scattered over a page.
 *
 * **The score does not leave this module.** `recall` drops it; nothing above ever sees one.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 4. Search                                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * *"When did I last feel like this about work?"*
 *
 * Returns `{ matched, similar }` — two lists of **documents**, never a sentence, never a
 * count and never a score. The app does not summarise them and has nowhere to put a number
 * if it wanted to: what comes back is what the user wrote, and the screen draws the rows.
 *
 * `matched` is the lexical half and is always available. `similar` is the semantic half and
 * is empty on every device with no index — which is every device until someone turns it on.
 * A document already in `matched` is never repeated in `similar`: it was found, and *found*
 * outranks *looks alike*.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 5. "Your past entries"                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * The labels the user chose on entries like this one (§5.8's second use).
 *
 * *"The `Last time 62` button, for feelings"* — the user's own past authorship is the most
 * defensible prior there is, and it is still only a proposal: what comes back is a list of
 * feeling ids with **the ids of the entries each was read from**, and a card renders them
 * dashed with provenance `from: "retrieval"`.
 *
 * **Rule 3, again, as a hard gate.** A past entry is only allowed to speak when it names a
 * person or a trigger the check-in in front of the user also names. Two empty sets are a
 * refusal, exactly as in `similarTriggerOffers` — a semantically near entry with nothing
 * structural in common is the case the rule exists to throw away, and the negation problem
 * (*"not angry, just tired"* sitting near *angry*) is why.
 *
 * Ordering is by how often a label was chosen on the retrieved entries, then by how alike
 * the entries were. Neither number is returned; the order is all that is left of them.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 6. Namesakes                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * Two relationships called Alex: which one this sentence sounds like (§5.8's fifth use).
 *
 * **It orders the candidates §4.5 already produced and does nothing else.** It cannot add a
 * candidate, cannot remove one, cannot select one, and cannot turn a *new person* into a
 * match: `personCandidates` decides who is on the list and the user decides which of them it
 * was. A wrong order costs a tap; a wrong selection would write the wrong person into a
 * check-in, which is invariant 15 and is why this returns an array of the same length.
 *
 * A candidate with no past mentions keeps its place rather than sinking: never having
 * spoken about someone is not evidence that this sentence is not about them.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 7. "Already known?"                                                                    */
/* ------------------------------------------------------------------------------------ */

/**
 * A statement close to one already kept about the same person (§5.8's sixth use).
 *
 * *"Cheap"*, says the design, and it is: the whole of it is a lexical overlap and a shared
 * `relationship_id`. It returns the **existing** row to be shown beside the new one and
 * nothing else — no merge, no replacement, no de-duplication. Two facts that say the same
 * thing twice are the user's to keep or drop.
 *
 * **Nothing calls this at all today** — not the card, and not the person view either. That is
 * a decision rather than a gap, and the decision is one layer up: S0 deferred `person_fact`
 * until the encryption envelope lands (§12.5) and named the proposal card as the place that
 * must not offer one, so there is no proposed fact on any screen for this to sit beside. The
 * function exists, is tested, and is wired to nothing; the day the card gains facts it gains
 * this in one line. It is the one use of §5.8's six that is waiting on a decision rather than
 * on work, and the ledger's *Deferred and follow-ups* says so with the same words.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 8. Context for the proposal model                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * The *k* most similar confirmed entries' vocabulary, for the prompt (§5.8's fourth use).
 *
 * **What it may contribute, and what it may not — this is the whole safety argument.**
 *
 * It returns `{ people, triggers }`: surface strings the user has already confirmed, and
 * nothing else. Specifically it can **not**:
 *
 * - name a feeling. The feeling vocabulary is closed, is already in the prompt in full, and
 *   is the thing the model is being asked for. Putting the feelings of similar past entries
 *   in front of it is precisely *"the model learns to echo"*, and there is no consistency to
 *   be gained in exchange — the ids are fixed. So this function never reads `doc.feelings`;
 * - invent a word. Every string it returns is drawn from the vocabulary lists it was handed,
 *   so retrieval **reorders and narrows what the user already has** and can add nothing;
 * - remove a word. The retrieved names and labels are moved to the front and the rest follow
 *   in their original order, so a case whose right answer is a word retrieval did not
 *   surface can still reach it. That is the property `retrievalGolden.js` checks over every
 *   clear case in both languages.
 *
 * Those three together are what a golden-suite guard can actually assert without weights.
 * What they are *not* is proof that no model is ever swayed by an ordering — that needs a
 * model, and `scripts/journal-eval/retrieval.mjs` is where it is measured when one exists.
 */
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
