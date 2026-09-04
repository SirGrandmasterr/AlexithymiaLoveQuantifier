import { describe, it, expect } from 'vitest';
import {
    AXES,
    DIMS,
    EWMA_HALFLIFE,
    SLOPE_DAYS,
    SLOPE_WINDOW,
    addSmoothing,
    dominantFeeling,
    entryPosition,
    ewma,
    familyProfile,
    labelHeatmap,
    slope,
    triggerSummary,
    weekOf,
    weeklyMood
} from './drift';
import { atLevel, observationsOf } from './observations';
import { feelingById } from '../../constants/journal';

const DAY = 86400000;

const LUCIE = 5;
const MEETING = 'trg-meeting';
const BREAKUP = 'trg-breakup';
const resolveTrigger = (id) => ({
    [MEETING]: { live: MEETING, label: 'meeting', role: 'interaction' },
    [BREAKUP]: { live: BREAKUP, label: 'breakup', role: 'interaction' }
}[id] ?? { live: id, label: id, role: 'entity' });
const personName = () => 'Lucie';

let nextId = 1;
const checkin = (day, feelings, mentions = [LUCIE]) => ({
    ID: nextId++,
    client_id: `c-${nextId}`,
    kind: 'checkin',
    day,
    at: `${day}T10:00:00Z`,
    payload: { v: 1, feelings },
    mentions: mentions.map((relationshipId, ref) => ({ ref, relationship_id: relationshipId, label: '' }))
});
const about = (triggerId) => [{ kind: 'person', ref: 0 }, { kind: 'trigger', trigger: triggerId }];

const entries = [
    checkin('2026-08-01', [{ id: 'affection', intensity: 2, about: about(MEETING) }]),
    checkin('2026-08-05', [{ id: 'sadness', intensity: 3, about: about(BREAKUP) }]),
    checkin('2026-08-11', [{ id: 'anxiety', intensity: 2, about: about(MEETING) }]),
    checkin('2026-08-21', [{ id: 'calm', intensity: 1, about: about(MEETING) }])
];

const perPerson = () => atLevel(observationsOf(entries, { resolveTrigger, personName }), 'person');

describe('ewma and slope', () => {
    it('is pandas’ adjusted ewm: the first value is itself, then newer values count most', () => {
        expect(ewma([1])).toEqual([1]);
        const out = ewma([0, 1], 1);
        // halflife 1 → α = 0.5; weights 0.5 and 1 → (0·0.5 + 1·1) / 1.5
        expect(out[1]).toBeCloseTo(2 / 3, 10);
        expect(ewma([0, 0, 0, 1], EWMA_HALFLIFE)[3]).toBeGreaterThan(0.3);
        expect(ewma([0, 0, 0, 1], EWMA_HALFLIFE)[3]).toBeLessThan(0.5);
    });

    it('fits a line, and answers null with fewer than two distinct points', () => {
        expect(slope([0, 1, 2], [0, 2, 4])).toBeCloseTo(2, 10);
        expect(slope([0, 0], [1, 2])).toBeNull();
        expect(slope([0], [1])).toBeNull();
    });
});

describe('addSmoothing', () => {
    const smoothed = addSmoothing(perPerson());

    it('adds a delta, a smoothed value and a slope per dimension, and a distance from the first', () => {
        expect(DIMS).toEqual(['valence', 'energy', 'dominance', 'intensity']);
        expect(AXES).toEqual(['valence', 'energy', 'dominance']);
        const [first, second] = smoothed;
        DIMS.forEach(dim => {
            expect(first[`d_${dim}`]).toBeNull();
            expect(first[`ewma_${dim}`]).toBe(first[dim]);
            expect(first[`slope_${dim}`]).toBeNull();
            expect(Number.isFinite(second[`ewma_${dim}`])).toBe(true);
        });
        expect(first.distanceFromFirst).toBe(0);
        // The EmotionGuesser’s own assertion: the second delta is one vocabulary entry less another.
        expect(second.d_valence).toBeCloseTo(feelingById('sadness').valence - feelingById('affection').valence, 10);
        expect(second.distanceFromFirst).toBeGreaterThan(0);
    });

    it('reports a slope in units per thirty days over a trailing window', () => {
        expect(SLOPE_DAYS).toBe(30);
        expect(SLOPE_WINDOW).toBe(6);
        const [, second] = smoothed;
        const perDay = (feelingById('sadness').valence - feelingById('affection').valence) / 4;
        expect(second.slope_valence).toBeCloseTo(perDay * 30, 10);
    });

    it('is keyed: two keys never smooth into each other', () => {
        const pairs = addSmoothing(atLevel(observationsOf(entries, { resolveTrigger, personName }), 'pair'));
        const breakup = pairs.find(row => row.label === 'Lucie · breakup');
        expect(breakup.d_valence).toBeNull();
        expect(breakup.ewma_valence).toBe(breakup.valence);
    });

    it('drops the columns of a previous pass rather than stacking them', () => {
        const twice = addSmoothing(addSmoothing(perPerson()));
        expect(Object.keys(twice[0]).filter(key => key.startsWith('ewma_'))).toHaveLength(DIMS.length);
        expect(twice).toEqual(smoothed);
    });
});

describe('triggerSummary', () => {
    it('gives one row per key named at least twice, most-named first, with drift since the first time', () => {
        const summary = triggerSummary(perPerson());
        expect(summary).toHaveLength(1);
        const lucie = summary[0];
        expect(lucie).toMatchObject({ key: `person:${LUCIE}`, label: 'Lucie', kind: 'person', count: 4 });
        // Four feelings named once each: the tie goes to whichever comes first in the list,
        // and `calm` sits among the original twenty-one while `affection` was appended.
        expect(lucie.dominantFeeling).toBe('calm');
        AXES.forEach(axis => {
            expect(Number.isFinite(lucie.now[axis])).toBe(true);
            expect(lucie.drift[axis]).toBeCloseTo(lucie.now[axis] - feelingById('affection')[axis], 10);
        });
        expect(lucie.firstAt).toBeLessThan(lucie.lastAt);
        expect(lucie.distance).toBeGreaterThan(0);
        expect(lucie.meanIntensity).toBeCloseTo((2 + 3 + 2 + 1) / 4 / 3, 10);
    });

    it('breaks a tie between feelings by the list’s order, as topFeelings does', () => {
        expect(dominantFeeling([{ feelingId: 'anger' }, { feelingId: 'joy' }])).toBe('joy');
        expect(dominantFeeling([{ feelingId: 'anger' }, { feelingId: 'anger' }, { feelingId: 'joy' }])).toBe('anger');
        expect(dominantFeeling([])).toBeNull();
    });

    it('honours minObs', () => {
        const pairs = atLevel(observationsOf(entries, { resolveTrigger, personName }), 'pair');
        expect(triggerSummary(pairs).map(row => row.label)).toEqual(['Lucie · meeting']);
        expect(triggerSummary(pairs, { minObs: 1 }).map(row => row.label)).toEqual(['Lucie · meeting', 'Lucie · breakup']);
    });
});

describe('weeklyMood', () => {
    it('places a check-in at its feelings’ coordinates weighted by strength, and averages a week', () => {
        const entry = checkin('2026-08-03', [
            { id: 'joy', intensity: 3, about: [] },
            { id: 'sadness', intensity: 1, about: [] }
        ]);
        const position = entryPosition(entry);
        const joy = feelingById('joy');
        const sadness = feelingById('sadness');
        AXES.forEach(axis => expect(position[axis]).toBeCloseTo((3 * joy[axis] + 1 * sadness[axis]) / 4, 10));

        const weeks = weeklyMood([entry, checkin('2026-08-04', [{ id: 'joy', intensity: 3, about: [] }])]);
        expect(weeks).toHaveLength(1);
        expect(weeks[0].count).toBe(2);
        expect(weeks[0].valence).toBeCloseTo((position.valence + joy.valence) / 2, 10);
    });

    it('keys a week on its Monday, leaves a week with nothing in it out, and ignores what is not a check-in', () => {
        expect(weekOf(new Date(2026, 7, 5).getTime())).toBe('2026-08-03');
        expect(weekOf(new Date(2026, 7, 3).getTime())).toBe('2026-08-03');
        expect(weekOf(new Date(2026, 7, 2).getTime())).toBe('2026-07-27');
        const weeks = weeklyMood([
            ...entries,
            { kind: 'ritual', at: '2026-08-12T22:00:00Z', payload: { v: 1 } },
            checkin('2026-08-13', [{ id: 'bliss', intensity: 1, about: [] }])
        ]);
        expect(weeks.map(week => week.week)).toEqual(['2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']);
        expect(entryPosition({ kind: 'checkin', at: 'nonsense', payload: { v: 1, feelings: [] } })).toBeNull();
    });

    it('counts an absent strength at the stated constant, so a day word still places its day', () => {
        const position = entryPosition(checkin('2026-08-03', [{ id: 'calm', about: [] }]));
        expect(position.valence).toBe(feelingById('calm').valence);
    });
});

describe('labelHeatmap and familyProfile', () => {
    it('sums strength per key and feeling, feelings in list order, keys most-named first', () => {
        const matrix = labelHeatmap(atLevel(observationsOf(entries, { resolveTrigger, personName }), 'pair'));
        expect(matrix.keys.map(entry => entry.label)).toEqual(['Lucie · meeting', 'Lucie · breakup']);
        expect(matrix.feelings).toEqual(['calm', 'sadness', 'anxiety', 'affection']);
        const meeting = matrix.cells[0];
        expect(meeting[matrix.feelings.indexOf('affection')]).toBeCloseTo(2 / 3, 10);
        expect(meeting[matrix.feelings.indexOf('sadness')]).toBe(0);
        expect(matrix.max).toBe(1);
    });

    it('caps the keys at topN', () => {
        const matrix = labelHeatmap(atLevel(observationsOf(entries, { resolveTrigger, personName }), 'pair'), { topN: 1 });
        expect(matrix.keys).toHaveLength(1);
        expect(matrix.cells).toHaveLength(1);
    });

    it('sums by family in the fixed order, and gives can’t tell to no family', () => {
        const rows = [
            { feelingId: 'joy', intensity: 1 }, { feelingId: 'amusement', intensity: 0.5 },
            { feelingId: 'anger', intensity: 1 }, { feelingId: 'unclear', intensity: 1 }
        ];
        const profile = familyProfile(rows);
        expect(profile.map(entry => entry.family)).toEqual(['joy', 'trust', 'anticipation', 'fear', 'sadness', 'disgust', 'anger', 'quiet']);
        expect(profile.find(entry => entry.family === 'joy').total).toBe(1.5);
        expect(profile.find(entry => entry.family === 'anger').total).toBe(1);
        expect(profile.reduce((sum, entry) => sum + entry.total, 0)).toBe(2.5);
    });
});

describe('the time axis', () => {
    it('measures slopes in days, so a gap of a day is one unit', () => {
        const rows = atLevel(observationsOf([
            checkin('2026-08-01', [{ id: 'sadness', intensity: 1, about: about(MEETING) }]),
            checkin('2026-08-02', [{ id: 'joy', intensity: 1, about: about(MEETING) }])
        ], { resolveTrigger, personName }), 'person');
        const [, second] = addSmoothing(rows);
        const perDay = feelingById('joy').valence - feelingById('sadness').valence;
        expect(second.slope_valence).toBeCloseTo(perDay * 30, 6);
        expect(second.at - rows[0].at).toBe(DAY);
    });
});
