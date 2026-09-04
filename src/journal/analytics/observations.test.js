import { describe, it, expect } from 'vitest';
import { LEVELS, INTENSITY_SCALE, atLevel, levelOf, observationsOf, seriesOf } from './observations';
import { FEELINGS, feelingById } from '../../constants/journal';
import { UNSTATED_INTENSITY } from '../../components/dayGraph.js';

/* Fixtures: the EmotionGuesser's own test journal, written as this app's rows */

const LUCIE = 5;
const BOSS = 9;
const MEETING = 'trg-meeting';
const BREAKUP = 'trg-breakup';
const WORK = 'trg-work';
const TIRED = 'trg-tired';

const roles = {
    [MEETING]: { live: MEETING, label: 'meeting', role: 'interaction' },
    [BREAKUP]: { live: BREAKUP, label: 'breakup', role: 'interaction' },
    [WORK]: { live: WORK, label: 'work', role: 'entity' },
    [TIRED]: { live: TIRED, label: 'being tired', role: 'interaction' }
};
const resolveTrigger = (id) => roles[id] ?? { live: id, label: id, role: null };
const personName = (mention) => ({ [LUCIE]: 'Lucie', [BOSS]: 'my boss' }[mention.relationship_id] ?? mention.label);

let nextId = 1;
const checkin = (day, feelings, mentions = []) => ({
    ID: nextId++,
    client_id: `c-${nextId}`,
    kind: 'checkin',
    day,
    at: `${day}T10:00:00Z`,
    payload: { v: 1, feelings },
    mentions: mentions.map((relationshipId, ref) => ({ ref, relationship_id: relationshipId, label: '' }))
});
const person = (ref) => ({ kind: 'person', ref });
const trigger = (id) => ({ kind: 'trigger', trigger: id });

const entries = [
    checkin('2026-08-01', [{ id: 'affection', intensity: 2, quote: 'lovely', about: [person(0), trigger(MEETING)] }], [LUCIE]),
    checkin('2026-08-05', [
        { id: 'sadness', intensity: 3, about: [person(0), trigger(BREAKUP)] },
        { id: 'anxiety', intensity: 2, about: [trigger(WORK)] }
    ], [LUCIE]),
    checkin('2026-08-06', [
        { id: 'anxiety', intensity: 2, about: [person(0), trigger(MEETING)] },
        { id: 'tiredness', about: [trigger(TIRED)] }
    ], [BOSS]),
    // A feeling about nothing is not an observation, and a ritual row is not a check-in.
    checkin('2026-08-07', [{ id: 'calm', intensity: 1, about: [] }]),
    { ID: 99, kind: 'ritual', day: '2026-08-07', at: '2026-08-07T22:00:00Z', payload: { v: 1 }, mentions: [] }
];

describe('observationsOf', () => {
    const rows = observationsOf(entries, { resolveTrigger, personName });

    it('gives one row per feeling and thing it was about, carrying the feeling’s three coordinates', () => {
        expect(rows).toHaveLength(5);
        const first = rows[0];
        expect(first).toMatchObject({
            feelingId: 'affection', level: 2, intensity: 2 / INTENSITY_SCALE,
            valence: feelingById('affection').valence, energy: feelingById('affection').energy, dominance: feelingById('affection').dominance,
            quote: 'lovely', day: '2026-08-01',
            person: { id: LUCIE, name: 'Lucie' }, entity: null, interaction: { id: MEETING, label: 'meeting' }
        });
    });

    it('reads a trigger with an entity role as a side and one with an interaction role as a happening', () => {
        const work = rows.find(row => row.feelingId === 'anxiety' && row.entity);
        expect(work).toMatchObject({ entity: { id: WORK, label: 'work' }, interaction: null, person: null });
        const tired = rows.find(row => row.feelingId === 'tiredness');
        expect(tired).toMatchObject({ entity: null, person: null, interaction: { id: TIRED, label: 'being tired' } });
    });

    it('counts an absent strength at the day graph’s stated constant, never at zero', () => {
        const tired = rows.find(row => row.feelingId === 'tiredness');
        expect(tired.level).toBe(UNSTATED_INTENSITY);
        expect(levelOf(undefined)).toBe(UNSTATED_INTENSITY);
        expect(levelOf(5)).toBe(INTENSITY_SCALE);
        expect(levelOf(0)).toBe(1);
    });

    it('reads a trigger with no role as an entity — what every trigger was before roles existed', () => {
        const plain = observationsOf([checkin('2026-08-09', [{ id: 'joy', intensity: 1, about: [trigger('trg-x')] }])], {
            resolveTrigger: () => ({ live: 'trg-x', label: 'the gym', role: null }), personName
        });
        expect(plain[0]).toMatchObject({ entity: { id: 'trg-x', label: 'the gym' }, interaction: null });
    });

    it('is in time order and skips a feeling it does not know', () => {
        const at = rows.map(row => row.at);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
        const unknown = observationsOf([checkin('2026-08-09', [{ id: 'bliss', intensity: 1, about: [trigger(WORK)] }])], { resolveTrigger, personName });
        expect(unknown).toEqual([]);
    });
});

describe('atLevel', () => {
    const rows = observationsOf(entries, { resolveTrigger, personName });

    it('keeps both halves apart at the pair level, with the EmotionGuesser’s separator', () => {
        const pairs = seriesOf(atLevel(rows, 'pair'));
        // Each named once, so the order is the labels', case-insensitively.
        expect(pairs.map(entry => entry.label)).toEqual([
            'being tired', 'Lucie · breakup', 'Lucie · meeting', 'my boss · meeting', 'work'
        ]);
        expect(pairs.every(entry => entry.count === 1)).toBe(true);
        expect(pairs.find(entry => entry.label === 'Lucie · meeting').kind).toBe('pair');
    });

    it('pools everything about one person at the person level, and drops rows with no person', () => {
        const people = atLevel(rows, 'person');
        expect(seriesOf(people).map(entry => [entry.label, entry.count])).toEqual([['Lucie', 2], ['my boss', 1]]);
        expect(people.every(row => row.kind === 'person')).toBe(true);
    });

    it('pools everything about one trigger at the trigger level, both halves alike', () => {
        const triggers = seriesOf(atLevel(rows, 'trigger'));
        expect(triggers.map(entry => [entry.label, entry.count])).toEqual([
            ['meeting', 2], ['being tired', 1], ['breakup', 1], ['work', 1]
        ]);
    });

    it('counts a feeling once per key however many rows it spread into', () => {
        const spread = observationsOf([checkin('2026-08-10', [
            { id: 'joy', intensity: 2, about: [person(0), trigger(MEETING), trigger(BREAKUP)] }
        ], [LUCIE])], { resolveTrigger, personName });
        expect(spread).toHaveLength(2);
        expect(seriesOf(atLevel(spread, 'person'))[0].count).toBe(1);
        expect(seriesOf(atLevel(spread, 'pair')).map(entry => entry.count)).toEqual([1, 1]);
    });

    it('refuses a level it does not know, and names the three it does', () => {
        expect(LEVELS).toEqual(['pair', 'person', 'trigger']);
        expect(() => atLevel(rows, 'entity')).toThrow(/entity/);
    });
});

describe('the vocabulary the table depends on', () => {
    it('has three coordinates on every feeling, so a row never lacks one', () => {
        FEELINGS.forEach(feeling => {
            ['valence', 'energy', 'dominance'].forEach(axis => expect(Number.isFinite(feeling[axis])).toBe(true));
        });
    });
});
