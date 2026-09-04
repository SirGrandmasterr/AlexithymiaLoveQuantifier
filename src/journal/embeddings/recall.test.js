import { describe, expect, it } from 'vitest';

import {
    LEXICAL_FLOOR,
    MIN_TOKEN_LENGTH,
    alreadyKnown,
    buildDocuments,
    foldSearch,
    journalDocument,
    lexicalRank,
    orderNamesakes,
    pastEntryOffers,
    recall,
    retrievalVocabulary,
    snapshotDocument,
    tokenise
} from './recall';
import { toIndexVector } from './embed';
import { PAYLOAD_VERSION } from '../../constants/journal';

/* Fixtures */

const checkin = ({ id, day = '2026-05-01', at = null, transcript = '', note = '', feelings = [], mentions = [], tags = [] }) => ({
    ID: Number(id.replace(/\D/g, '')) || 1,
    client_id: id,
    kind: 'checkin',
    day,
    at: at ?? `${day}T12:00:00+02:00`,
    payload: {
        v: PAYLOAD_VERSION,
        source: 'voice',
        transcript,
        transcript_kept: true,
        language: 'de',
        note,
        tags,
        feelings: feelings.map(feeling => ({ intensity: 2, uncertain: false, about: [], ...feeling }))
    },
    mentions
});

const vectorsFor = (rows) => new Map(
    Object.entries(rows).map(([id, values]) => [id, { vector: toIndexVector(values) }])
);

/* 1. Folding and tokens */

describe('folding', () => {
    it('folds case, diacritics and ß, which is the one German rule NFD does not cover', () => {
        expect(foldSearch('Büro')).toBe('buro');
        expect(foldSearch('FUSSBALL')).toBe('fussball');
        expect(foldSearch('Fußball')).toBe('fussball');
        expect(foldSearch('Fußball')).toBe(foldSearch('Fussball'));
        expect(foldSearch('José')).toBe('jose');
    });

    it('drops tokens shorter than the minimum, in any script', () => {
        expect(MIN_TOKEN_LENGTH).toBe(2);
        expect(tokenise('a der 42 Umzug!')).toEqual(['der', '42', 'umzug']);
    });
});

/* 2. Documents */

describe('what a search reads', () => {
    it('reads a check-in\'s transcript, note, tags and resolved trigger labels', () => {
        const entry = checkin({
            id: 'c1',
            transcript: 'Langer Tag im Büro.',
            note: 'Danach noch eingekauft.',
            tags: ['routine period'],
            feelings: [{ id: 'stress', about: [{ kind: 'trigger', trigger: 't-arbeit' }] }],
            mentions: [{ relationship_id: 4, label: 'Lucie', ref: 0 }]
        });

        const doc = journalDocument(entry, {
            resolveTrigger: () => ({ live: 't-arbeit', label: 'Arbeit' }),
            personName: (mention) => mention.label
        });

        expect(doc.id).toBe('c1');
        expect(doc.text).toContain('Büro');
        expect(doc.text).toContain('Danach noch eingekauft.');
        expect(doc.text).toContain('routine period');
        // The word the entry never says, carried by the trigger it is filed under.
        expect(doc.text).toContain('Arbeit');
        expect(doc.text).toContain('Lucie');
        expect(doc.feelings).toEqual(['stress']);
        expect(doc.triggers).toEqual(['t-arbeit']);
        expect(doc.people).toEqual([4]);
    });

    it('never returns a trigger row as something to find', () => {
        const trigger = {
            ID: 9, client_id: 't-arbeit', kind: 'trigger', day: '2026-01-01', at: '2026-01-01T09:00:00Z',
            payload: { v: 1, label: 'Arbeit' }, mentions: []
        };
        expect(journalDocument(trigger, {})).toBeNull();
    });

    it('reads a snapshot note and nothing numeric from the snapshot', () => {
        const doc = snapshotDocument({
            ID: 3, relationship_id: 1, name: 'Lucie', date: '2026-05-01',
            description: 'Ruhiger Monat, viel gemeinsam gekocht.',
            tags: ['routine period'],
            stats: { attraction: 4, trust: 5 }
        });

        expect(doc.id).toBe('snapshot:3');
        expect(doc.kind).toBe('snapshot');
        expect(doc.text).toContain('gemeinsam gekocht');
        expect(doc.text).not.toMatch(/[0-9]/);
    });

    it('skips a snapshot with no note: there is nothing in it to search', () => {
        expect(snapshotDocument({ ID: 3, name: 'Lucie', description: '   ' })).toBeNull();
    });
});

/* 3. Ranking */

describe('the lexical half', () => {
    const docs = buildDocuments({
        entries: [
            checkin({ id: 'a', transcript: 'Der Tag im Büro war lang und ich war erschöpft.' }),
            checkin({ id: 'b', transcript: 'Beim Fußball im Park war ich gelöst.' }),
            checkin({ id: 'c', transcript: 'Die Nebenkostenabrechnung kam heute und ich war unruhig.' }),
            checkin({ id: 'd', transcript: 'Ich war heute im Park und habe gelesen.' })
        ]
    });

    it('finds an entry by a German phrase, with the umlaut typed or not', () => {
        expect(lexicalRank('Büro', docs).map(hit => hit.doc.id)).toEqual(['a']);
        expect(lexicalRank('buro', docs).map(hit => hit.doc.id)).toEqual(['a']);
    });

    it('finds a German compound by its first half, with no compound splitter', () => {
        expect(lexicalRank('Nebenkosten', docs).map(hit => hit.doc.id)).toEqual(['c']);
    });

    it('finds an entry by an English phrase over the same index', () => {
        const mixed = buildDocuments({
            entries: [
                checkin({ id: 'e', transcript: 'Another long day at the office.' }),
                checkin({ id: 'f', transcript: 'Carried boxes half of Saturday.' })
            ]
        });
        expect(lexicalRank('office', mixed).map(hit => hit.doc.id)).toEqual(['e']);
        expect(lexicalRank('boxes', mixed).map(hit => hit.doc.id)).toEqual(['f']);
    });

    it('weighs a rare word above a common one rather than counting words', () => {
        // "ich war" is in all four; "Fußball" is in one. The one wins, and the three
        // that share only the common words do not appear at all.
        expect(lexicalRank('ich war Fussball', docs).map(hit => hit.doc.id)).toEqual(['b']);
    });

    it('drops a document that accounts for too little of the query to be a find', () => {
        expect(LEXICAL_FLOOR).toBeGreaterThan(0);
        // Six words, of which one weak one matches: not an answer.
        expect(lexicalRank('wann habe ich mich zuletzt gefühlt', docs)).toEqual([]);
    });

    it('returns nothing for a query with no usable token', () => {
        expect(lexicalRank('   ?  ', docs)).toEqual([]);
        expect(lexicalRank('Büro', [])).toEqual([]);
    });
});

/* 4. Search */

describe('recall', () => {
    const docs = buildDocuments({
        entries: [
            checkin({ id: 'a', transcript: 'Der Tag im Büro war lang.' }),
            checkin({ id: 'b', transcript: 'Der Abend war still und niemand rief an.' })
        ]
    });

    it('returns entries, not prose: every result is a document with an id and a day', () => {
        const { matched, similar } = recall({ query: 'Büro', docs });

        expect(similar).toEqual([]);
        expect(matched).toHaveLength(1);
        expect(matched[0]).toMatchObject({ id: 'a', kind: 'checkin', day: '2026-05-01' });
        // Nothing here is a sentence about the results, and nothing is a number.
        expect(Object.keys(matched[0])).not.toContain('score');
        expect(Object.keys(matched[0])).not.toContain('similarity');
        expect(Object.keys(matched[0])).not.toContain('summary');
    });

    it('works with no index at all, which is every device by default', () => {
        expect(recall({ query: 'Büro', docs, vectors: new Map() }).matched.map(doc => doc.id)).toEqual(['a']);
    });

    it('keeps what was found apart from what merely looks alike', () => {
        const vectors = vectorsFor({ a: [1, 0], b: [0.99, 0.14] });
        const { matched, similar } = recall({ query: 'Büro', docs, vectors, queryVector: toIndexVector([1, 0]) });

        expect(matched.map(doc => doc.id)).toEqual(['a']);
        // `a` was found; it is never repeated as a guess about itself.
        expect(similar.map(doc => doc.id)).toEqual(['b']);
    });

    it('surfaces no similarity anywhere in what it returns', () => {
        const vectors = vectorsFor({ a: [1, 0], b: [0.99, 0.14] });
        const result = recall({ query: 'Büro', docs, vectors, queryVector: toIndexVector([1, 0]) });

        const walk = (value) => (
            typeof value === 'object' && value !== null
                ? Object.entries(value).flatMap(([key, inner]) => [key, ...walk(inner)])
                : []
        );
        walk(result).forEach(key => {
            expect(String(key)).not.toMatch(/similarity|score|distance|cosine|percent/i);
        });
    });
});

/* 5. "Your past entries" */

describe('past entry offers', () => {
    const docs = buildDocuments({
        entries: [
            checkin({
                id: 'past-1', day: '2026-04-01',
                transcript: 'Der Tag im Büro war lang.',
                feelings: [{ id: 'stress', about: [{ kind: 'trigger', trigger: 't-arbeit' }] }]
            }),
            checkin({
                id: 'past-2', day: '2026-04-08',
                transcript: 'Wieder ein langer Tag.',
                feelings: [
                    { id: 'stress', about: [{ kind: 'trigger', trigger: 't-arbeit' }] },
                    { id: 'tiredness', about: [{ kind: 'trigger', trigger: 't-arbeit' }] }
                ]
            }),
            checkin({
                id: 'other', day: '2026-04-09',
                transcript: 'Ein Abend am Fluss.',
                feelings: [{ id: 'calm', about: [{ kind: 'trigger', trigger: 't-fluss' }] }]
            })
        ],
        resolveTrigger: (id) => ({ live: id, label: id })
    });

    const vectors = vectorsFor({ 'past-1': [1, 0], 'past-2': [1, 0], other: [1, 0] });
    const query = toIndexVector([1, 0]);

    it('offers the labels the user chose on entries that share a trigger, most used first', () => {
        const offers = pastEntryOffers({
            queryVector: query, docs, vectors, context: { triggers: ['t-arbeit'] }
        });

        expect(offers.map(offer => offer.id)).toEqual(['stress', 'tiredness']);
        expect(offers[0].entryClientIds.sort()).toEqual(['past-1', 'past-2']);
    });

    it('offers nothing on geometry alone — rule 3 is a gate, not a weight', () => {
        // Identical vectors, so similarity could not be higher; no shared person or trigger.
        expect(pastEntryOffers({
            queryVector: query, docs, vectors, context: { triggers: ['t-nothing'] }
        })).toEqual([]);
    });

    it('offers nothing when the check-in in front of the user names nothing yet', () => {
        expect(pastEntryOffers({ queryVector: query, docs, vectors, context: {} })).toEqual([]);
    });

    it('offers nothing with no vectors, which is a device with the index off', () => {
        expect(pastEntryOffers({
            queryVector: query, docs, vectors: new Map(), context: { triggers: ['t-arbeit'] }
        })).toEqual([]);
    });

    it('leaves out a label the card already has', () => {
        const offers = pastEntryOffers({
            queryVector: query, docs, vectors,
            context: { triggers: ['t-arbeit'] }, exclude: ['stress']
        });
        expect(offers.map(offer => offer.id)).toEqual(['tiredness']);
    });

    it('carries the ids it read the label from, and no number', () => {
        const [offer] = pastEntryOffers({
            queryVector: query, docs, vectors, context: { triggers: ['t-arbeit'] }
        });
        expect(Object.keys(offer).sort()).toEqual(['entryClientIds', 'id']);
    });

    it('can be reached through a shared person as well as a shared trigger', () => {
        const withPerson = buildDocuments({
            entries: [checkin({
                id: 'p1',
                transcript: 'Abend mit Lucie.',
                feelings: [{ id: 'rapport', about: [] }],
                mentions: [{ relationship_id: 7, label: 'Lucie', ref: 0 }]
            })]
        });
        const offers = pastEntryOffers({
            queryVector: query,
            docs: withPerson,
            vectors: vectorsFor({ p1: [1, 0] }),
            context: { people: [7] }
        });
        expect(offers.map(offer => offer.id)).toEqual(['rapport']);
    });
});

/* 6. Namesakes */

describe('namesake ordering', () => {
    const docs = buildDocuments({
        entries: [
            checkin({ id: 'work', transcript: 'Alex hat den Bericht umgeschrieben.', mentions: [{ relationship_id: 2, label: 'Alex', ref: 0 }] }),
            checkin({ id: 'climb', transcript: 'Mit Alex an der Kletterwand.', mentions: [{ relationship_id: 3, label: 'Alex', ref: 0 }] })
        ]
    });

    const candidates = [
        { relationshipId: 2, name: 'Alex Weber', exact: false, match: 'prefix' },
        { relationshipId: 3, name: 'Alex Berger', exact: false, match: 'prefix' }
    ];

    const vectors = vectorsFor({ work: [1, 0], climb: [0, 1] });

    it('changes the order of the candidates', () => {
        const ordered = orderNamesakes(candidates, { queryVector: toIndexVector([0, 1]), docs, vectors });
        expect(ordered.map(row => row.relationshipId)).toEqual([3, 2]);
    });

    it('never changes the list itself — no candidate added, removed or selected', () => {
        const ordered = orderNamesakes(candidates, { queryVector: toIndexVector([0, 1]), docs, vectors });

        expect(ordered).toHaveLength(candidates.length);
        expect(new Set(ordered)).toEqual(new Set(candidates));
        // Nothing here says "this one". Selection is a tap, and this returns an array.
        ordered.forEach(row => expect(row).not.toHaveProperty('selected'));
    });

    it('leaves the order alone when there is nothing to go on', () => {
        expect(orderNamesakes(candidates, { queryVector: toIndexVector([0, 1]), docs, vectors: new Map() }))
            .toEqual(candidates);
        expect(orderNamesakes(candidates, {})).toEqual(candidates);
    });

    it('does not sink a candidate the user has never spoken about', () => {
        const withStranger = [...candidates, { relationshipId: 9, name: 'Alex Stein' }];
        const ordered = orderNamesakes(withStranger, { queryVector: toIndexVector([1, 0]), docs, vectors });
        // 2 has evidence and goes first; 3 and 9 keep the order they arrived in.
        expect(ordered.map(row => row.relationshipId)).toEqual([2, 3, 9]);
    });
});

/* 7. Already known */

describe('already known', () => {
    const kept = [
        { id: 1, text: 'moved to Lyon last spring', relationshipId: 4 },
        { id: 2, text: 'started climbing on Tuesdays', relationshipId: 4 }
    ];

    it('shows the row a new statement is close to', () => {
        expect(alreadyKnown('moved to Lyon', kept, { relationshipId: 4 })?.id).toBe(1);
    });

    it('says nothing when the statement is new', () => {
        expect(alreadyKnown('bought a bicycle', kept, { relationshipId: 4 })).toBeNull();
    });

    it('never crosses people: the same words about someone else are not already known', () => {
        expect(alreadyKnown('moved to Lyon', kept, { relationshipId: 5 })).toBeNull();
    });

    it('returns the existing row and nothing about merging it', () => {
        const row = alreadyKnown('moved to Lyon', kept, { relationshipId: 4 });
        expect(row).toBe(kept[0]);
    });
});

/* 8. Context for the proposal model */

describe('retrieval vocabulary for the prompt', () => {
    const docs = buildDocuments({
        entries: [
            checkin({
                id: 'near',
                transcript: 'Der Tag im Büro war lang.',
                feelings: [{ id: 'stress', about: [{ kind: 'trigger', trigger: 't-arbeit' }] }],
                mentions: [{ relationship_id: 2, label: 'Alex', ref: 0 }]
            }),
            checkin({
                id: 'far',
                transcript: 'Ein Abend am Fluss.',
                feelings: [{ id: 'calm', about: [{ kind: 'trigger', trigger: 't-fluss' }] }],
                mentions: [{ relationship_id: 3, label: 'Lucie', ref: 0 }]
            })
        ],
        resolveTrigger: (id) => ({ live: id, label: id })
    });

    const vectors = vectorsFor({ near: [1, 0], far: [0, 1] });
    const options = {
        docs,
        vectors,
        people: ['Lucie', 'Alex'],
        triggers: ['Fluss', 'Arbeit', 'Geld'],
        relationshipName: (id) => ({ 2: 'Alex', 3: 'Lucie' }[id] ?? ''),
        triggerLabel: (id) => ({ 't-arbeit': 'Arbeit', 't-fluss': 'Fluss' }[id] ?? '')
    };

    it('moves what retrieval found to the front and keeps everything else', () => {
        const context = retrievalVocabulary({ ...options, queryVector: toIndexVector([1, 0]) });

        expect(context.triggers).toEqual(['Arbeit', 'Fluss', 'Geld']);
        expect(context.people).toEqual(['Alex', 'Lucie']);
    });

    it('never removes a word: the two lists are the same sets they started as', () => {
        const context = retrievalVocabulary({ ...options, queryVector: toIndexVector([1, 0]) });

        expect([...context.triggers].sort()).toEqual([...options.triggers].sort());
        expect([...context.people].sort()).toEqual([...options.people].sort());
    });

    it('never adds a word the user has not confirmed', () => {
        const context = retrievalVocabulary({
            ...options,
            triggers: ['Geld'],
            queryVector: toIndexVector([1, 0])
        });
        // *Arbeit* was retrieved and is not in the vocabulary it was handed, so it is not
        // in what comes back: retrieval reorders, and cannot invent.
        expect(context.triggers).toEqual(['Geld']);
    });

    it('never names a feeling, which is the whole echo channel', () => {
        const context = retrievalVocabulary({ ...options, queryVector: toIndexVector([1, 0]) });
        expect(Object.keys(context).sort()).toEqual(['people', 'triggers']);
        expect(JSON.stringify(context)).not.toContain('stress');
    });

    it('hands back the vocabulary unchanged with no index', () => {
        expect(retrievalVocabulary({ ...options, vectors: new Map(), queryVector: toIndexVector([1, 0]) }))
            .toEqual({ people: options.people, triggers: options.triggers });
    });
});
