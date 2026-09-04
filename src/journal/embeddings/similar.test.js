import { describe, it, expect } from 'vitest';
import {
    MAX_SIMILAR,
    SIMILARITY_FLOOR,
    buildWitnesses,
    cosine,
    scan,
    similarTriggerOffers,
    similarTriggerPairs,
    witnessAgrees
} from './similar';
import { INDEX_DIMS, toIndexVector } from './embed';
import { arbitraryVector, vectorPair } from './embed.fake';

/**
 * The scan, rule 3's gate, and rule 2's absence of numbers.
 *
 * The interesting tests are the *refusals*: a close vector with nothing structural behind it
 * must produce nothing at all, and it must produce nothing for a reason that cannot be
 * out-voted by making the vectors closer.
 */

/** Two labels the model thinks are the same thing, and one it does not. */
const [WORK, MY_JOB] = vectorPair('work/my-job', 0.92);
const ELSEWHERE = arbitraryVector('the dentist');

const trigger = (clientId, label) => ({ clientId, live: clientId, label });

const vectorsFor = (entries) => new Map(
    entries.map(([id, vector]) => [id, { entryClientId: id, model: 'm', dims: INDEX_DIMS, vector }])
);

/** A check-in naming some people and some triggers, in the shape the readers expect. */
const checkin = ({ people = [], triggers = [] }) => ({
    kind: 'checkin',
    mentions: people.map((relationshipId, ref) => ({ relationship_id: relationshipId, ref })),
    payload: {
        v: 1,
        feelings: [{
            id: 'tired',
            about: triggers.map(id => ({ kind: 'trigger', trigger: id }))
                .concat(people.map((_, ref) => ({ kind: 'person', ref })))
        }]
    }
});

describe('cosine', () => {
    it('is 1 for a vector against itself', () => {
        expect(cosine(WORK, WORK)).toBeCloseTo(1, 6);
    });

    it('is the similarity the fixture asked for', () => {
        expect(cosine(WORK, MY_JOB)).toBeCloseTo(0.92, 5);
    });

    it('is near zero for two unrelated directions', () => {
        expect(Math.abs(cosine(WORK, ELSEWHERE))).toBeLessThan(0.3);
    });

    it('refuses to compare two widths rather than comparing a prefix of them', () => {
        expect(cosine(WORK, toIndexVector(WORK, 128))).toBe(0);
    });

    it('is 0 against a vector with no direction, rather than NaN', () => {
        expect(cosine(WORK, new Float32Array(INDEX_DIMS))).toBe(0);
    });
});

describe('the scan', () => {
    const rows = [
        { entryClientId: 'work', vector: WORK },
        { entryClientId: 'far', vector: ELSEWHERE }
    ];

    it('finds what is above the floor and leaves what is not', () => {
        expect(scan(MY_JOB, rows).map(hit => hit.entryClientId)).toEqual(['work']);
    });

    it('orders most alike first', () => {
        const [, closer] = vectorPair('work/my-job', 0.99);
        const found = scan(WORK, [
            { entryClientId: 'less', vector: MY_JOB },
            { entryClientId: 'more', vector: closer }
        ], { floor: 0 });

        expect(found.map(hit => hit.entryClientId)).toEqual(['more', 'less']);
    });

    it('caps at three, which is what a card has room to offer', () => {
        const many = Array.from({ length: 10 }, (_, i) => ({ entryClientId: `t${i}`, vector: WORK }));
        expect(scan(WORK, many)).toHaveLength(MAX_SIMILAR);
        expect(MAX_SIMILAR).toBe(3);
    });

    it('answers with nothing for an empty query rather than ranking noise', () => {
        expect(scan(new Float32Array(0), rows)).toEqual([]);
    });
});

describe('the structural witness', () => {
    it('records the people an entry naming a trigger also named', () => {
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);
        expect([...witnesses.get('work').people]).toEqual([7]);
    });

    it('records the other triggers on the same entry, and never the trigger itself', () => {
        const witnesses = buildWitnesses([checkin({ triggers: ['work', 'money'] })]);
        expect([...witnesses.get('work').triggers]).toEqual(['money']);
        expect(witnesses.get('work').triggers.has('work')).toBe(false);
    });

    it('follows a merge, so one word history is not split into two half-witnesses', () => {
        const witnesses = buildWitnesses(
            [checkin({ people: [7], triggers: ['old-id'] })],
            (id) => (id === 'old-id' ? 'work' : id)
        );
        expect(witnesses.has('work')).toBe(true);
        expect(witnesses.has('old-id')).toBe(false);
    });

    it('reads only check-ins: a trigger row is vocabulary, not evidence', () => {
        const witnesses = buildWitnesses([{ kind: 'trigger', payload: { v: 1, label: 'work' }, mentions: [] }]);
        expect(witnesses.size).toBe(0);
    });

    it('agrees on a shared person', () => {
        expect(witnessAgrees(
            { people: new Set([7]), triggers: new Set() },
            { people: new Set([7, 9]), triggers: new Set() }
        )).toBe(true);
    });

    it('agrees on a shared trigger', () => {
        expect(witnessAgrees(
            { people: new Set(), triggers: new Set(['money']) },
            { people: new Set(), triggers: new Set(['money']) }
        )).toBe(true);
    });

    it('refuses two empty sets: no evidence is a refusal, not a pass', () => {
        expect(witnessAgrees({ people: new Set(), triggers: new Set() },
            { people: new Set(), triggers: new Set() })).toBe(false);
    });

    it('refuses a candidate it has no witness for at all', () => {
        expect(witnessAgrees(undefined, { people: new Set([7]), triggers: new Set() })).toBe(false);
    });
});

describe('rule 3 on the card: a semantic match needs a structural witness', () => {
    const triggers = [trigger('work', 'work'), trigger('far', 'the dentist')];
    const vectors = vectorsFor([['work', WORK], ['far', ELSEWHERE]]);

    it('offers the word the user already has when a person agrees', () => {
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);

        const offers = similarTriggerOffers({
            vector: MY_JOB, triggers, vectors, witnesses,
            context: { people: [7], triggers: [] }
        });

        expect(offers).toEqual([{ clientId: 'work', label: 'work' }]);
    });

    it('offers it when another trigger on the same check-in agrees', () => {
        const witnesses = buildWitnesses([checkin({ triggers: ['work', 'money'] })]);

        const offers = similarTriggerOffers({
            vector: MY_JOB, triggers, vectors, witnesses,
            context: { people: [], triggers: ['money'] }
        });

        expect(offers.map(offer => offer.clientId)).toEqual(['work']);
    });

    it('offers NOTHING for a close vector with no shared person and no shared trigger', () => {
        // The rule, stated as the test §5.8 asks for. The vectors are as close as they were
        // in the passing case above; only the structural agreement is gone.
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);

        const offers = similarTriggerOffers({
            vector: MY_JOB, triggers, vectors, witnesses,
            context: { people: [99], triggers: ['something-else'] }
        });

        expect(offers).toEqual([]);
    });

    it('cannot be out-voted by making the vectors closer — it is a gate, not a weight', () => {
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);
        const identical = Float32Array.from(WORK);

        expect(similarTriggerOffers({
            vector: identical, triggers, vectors, witnesses,
            context: { people: [99], triggers: [] }
        })).toEqual([]);
    });

    it('offers nothing on a device with no history, however close the words are', () => {
        expect(similarTriggerOffers({
            vector: MY_JOB, triggers, vectors, witnesses: new Map(),
            context: { people: [7], triggers: ['money'] }
        })).toEqual([]);
    });

    it('offers nothing for a word that is simply not similar to anything', () => {
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work', 'far'] })]);

        expect(similarTriggerOffers({
            vector: arbitraryVector('a completely different thing'),
            triggers, vectors, witnesses,
            context: { people: [7], triggers: [] }
        })).toEqual([]);
    });

    it('gates before it caps, so three unwitnessed words cannot crowd out the one that fits', () => {
        // Five decoys, each an exact match for the query and so ahead of `work` in every
        // ordering, and none of them with a witness.
        const decoys = Array.from({ length: 5 }, (_, i) => trigger(`decoy${i}`, `decoy ${i}`));
        const allTriggers = [...decoys, trigger('work', 'work')];
        const allVectors = vectorsFor([
            ...decoys.map(row => [row.clientId, Float32Array.from(MY_JOB)]),
            ['work', WORK]
        ]);

        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);
        const offers = similarTriggerOffers({
            vector: MY_JOB, triggers: allTriggers, vectors: allVectors, witnesses,
            context: { people: [7], triggers: [] }
        });

        // ...and none of them has a witness, so the one that does is still offered.
        expect(offers.map(offer => offer.clientId)).toEqual(['work']);
    });

    it('never carries a number: rule 2 is the return type, not a rendering decision', () => {
        const witnesses = buildWitnesses([checkin({ people: [7], triggers: ['work'] })]);
        const offers = similarTriggerOffers({
            vector: MY_JOB, triggers, vectors, witnesses, context: { people: [7], triggers: [] }
        });

        offers.forEach(offer => expect(Object.keys(offer).sort()).toEqual(['clientId', 'label']));
        expect(JSON.stringify(offers)).not.toMatch(/[0-9]/);
    });

    it('offers nothing for a trigger with no vector yet — a lazy index is a quiet one', () => {
        expect(similarTriggerOffers({
            vector: MY_JOB, triggers, vectors: new Map(),
            witnesses: buildWitnesses([checkin({ people: [7], triggers: ['work'] })]),
            context: { people: [7], triggers: [] }
        })).toEqual([]);
    });
});

describe('the Triggers view pairs', () => {
    const triggers = [trigger('work', 'work'), trigger('job', 'my job'), trigger('far', 'the dentist')];
    const vectors = vectorsFor([['work', WORK], ['job', MY_JOB], ['far', ELSEWHERE]]);

    it('pairs two look-alikes the user has used around the same person', () => {
        const witnesses = buildWitnesses([
            checkin({ people: [7], triggers: ['work'] }),
            checkin({ people: [7], triggers: ['job'] })
        ]);

        const pairs = similarTriggerPairs({ triggers, vectors, witnesses });
        expect(pairs).toHaveLength(1);
        expect([pairs[0].a.clientId, pairs[0].b.clientId].sort()).toEqual(['job', 'work']);
    });

    it('offers each pair once rather than once from each side', () => {
        const witnesses = buildWitnesses([
            checkin({ people: [7], triggers: ['work'] }),
            checkin({ people: [7], triggers: ['job'] })
        ]);
        expect(similarTriggerPairs({ triggers, vectors, witnesses })).toHaveLength(1);
    });

    it('offers NOTHING for two look-alikes with no shared person or trigger', () => {
        const witnesses = buildWitnesses([
            checkin({ people: [7], triggers: ['work'] }),
            checkin({ people: [12], triggers: ['job'] })
        ]);

        expect(similarTriggerPairs({ triggers, vectors, witnesses })).toEqual([]);
    });

    it('does not pair two words that merely share a person', () => {
        const witnesses = buildWitnesses([
            checkin({ people: [7], triggers: ['work'] }),
            checkin({ people: [7], triggers: ['far'] })
        ]);

        const pairs = similarTriggerPairs({ triggers, vectors, witnesses });
        expect(pairs.some(pair => [pair.a.clientId, pair.b.clientId].includes('far'))).toBe(false);
    });

    it('carries labels and ids and no number at all', () => {
        const witnesses = buildWitnesses([
            checkin({ people: [7], triggers: ['work'] }),
            checkin({ people: [7], triggers: ['job'] })
        ]);
        const pairs = similarTriggerPairs({ triggers, vectors, witnesses });

        expect(Object.keys(pairs[0]).sort()).toEqual(['a', 'b']);
        expect(JSON.stringify(pairs)).not.toMatch(/[0-9]/);
    });
});

describe('the budget', () => {
    /**
     * §5.8's whole architecture in one number: ten thousand entries at 256 dimensions is a
     * brute-force scan in milliseconds, and an HNSW library would only start to matter past
     * fifty thousand.
     *
     * **The budget is deliberately loose.** This asserts the shape of the cost, not the speed
     * of this machine: a linear scan under a second is the claim, and a change that made it
     * quadratic would take minutes rather than fail by a hair. **Measured on this machine on
     * 2026-09-04: 2.4 ms median over seven runs**, which is §5.8's "milliseconds" and four
     * hundred times inside the budget below.
     */
    it('scans ten thousand synthetic vectors well inside a stated budget', () => {
        const rows = Array.from({ length: 10_000 }, (_, i) => ({
            entryClientId: `e${i}`,
            vector: arbitraryVector(`entry ${i}`)
        }));

        const started = performance.now();
        const hits = scan(WORK, rows, { floor: SIMILARITY_FLOOR });
        const elapsed = performance.now() - started;

        expect(hits.length).toBeLessThanOrEqual(MAX_SIMILAR);
        expect(elapsed).toBeLessThan(1000);
    });

    it('is ten megabytes of Float32Array at that size, which is what §5.8 sized for', () => {
        expect(10_000 * INDEX_DIMS * Float32Array.BYTES_PER_ELEMENT).toBe(10_240_000);
    });
});
