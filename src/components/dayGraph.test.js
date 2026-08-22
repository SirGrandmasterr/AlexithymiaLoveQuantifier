import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
    buildDayCurve,
    branchPaths,
    project,
    paintersOrder,
    dayGraphLegend,
    strokeWidthFor,
    FEELING_HALF_LIFE_MIN,
    BRANCH_END_THRESHOLD,
    CONFIDENT_MIN,
    NEUTRAL_SETTLE_MIN,
    STEP_MIN,
    UNSTATED_INTENSITY,
    MAX_SAMPLES,
    TRUNK,
    STROKE_WIDTH,
    EXTRAPOLATED_OPACITY
} from './dayGraph';
import { feelingById } from '../constants/journal';

/* ------------------------------------------------------------------------------------ */
/* Fixtures                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * A day built in UTC on purpose. `t` is minutes elapsed from the first check-in, so nothing
 * about these fixtures depends on the runner's zone — which is what lets the DST case at the
 * bottom pin a zone and mean it, rather than testing the machine it happens to run on.
 */
const DAY = '2026-03-14';
const BASE = Date.parse(`${DAY}T08:00:00Z`);

let rowId = 0;
const instant = (minutes) => new Date(BASE + minutes * 60000).toISOString();

const feeling = (id, intensity = 2, extra = {}) => ({ id, intensity, about: [], ...extra });

/** A check-in `minutes` after 08:00 UTC. `intensity: null` is left out of the payload entirely. */
const checkin = (minutes, feelings, payload = {}) => {
    rowId += 1;
    return {
        ID: rowId,
        client_id: `client-${rowId}`,
        kind: 'checkin',
        day: DAY,
        at: instant(minutes),
        schema_version: 1,
        payload: {
            v: 1,
            source: 'manual',
            tz_offset_min: 0,
            feelings: feelings.map(entry => {
                if (entry.intensity !== null && entry.intensity !== undefined) return entry;
                const { intensity, ...rest } = entry;
                return rest;
            }),
            ...payload
        },
        mentions: []
    };
};

/** The ritual's day word as A8 writes it: a check-in, `source: "ritual_word"`, no intensity. */
const dayWord = (minutes, id) => checkin(minutes, [{ id, about: [] }], { source: 'ritual_word' });

const ritualRow = (minutes) => {
    rowId += 1;
    return {
        ID: rowId,
        client_id: `client-${rowId}`,
        kind: 'ritual',
        day: DAY,
        at: instant(minutes),
        schema_version: 1,
        payload: { v: 1, question_set: 1, answers: {}, day_word: { id: 'calm' } },
        mentions: []
    };
};

const sampleAt = (curve, t) => curve.samples.find(sample => sample.t === t) ?? null;
const branchAt = (curve, t, id) => (sampleAt(curve, t)?.branches ?? []).find(entry => entry.feeling === id) ?? null;
const branchFor = (curve, id) => curve.branches.find(entry => entry.feeling === id) ?? null;

beforeEach(() => {
    rowId = 0;
});

/* ------------------------------------------------------------------------------------ */
/* 1. The trunk, and the day it spans                                                     */
/* ------------------------------------------------------------------------------------ */

describe('the trunk', () => {
    it('starts at the first check-in rather than at the start of the day', () => {
        const curve = buildDayCurve([checkin(60, [feeling('joy')]), checkin(360, [feeling('calm')])]);

        expect(curve.bounds.startAt).toBe(Date.parse(`${DAY}T09:00:00Z`));
        expect(curve.bounds.startT).toBe(0);
        expect(curve.samples[0].t).toBe(0);
        expect(curve.samples.every(sample => sample.t >= 0)).toBe(true);

        // The check that would fail if anything drew back to midnight: the first sample's
        // instant is 09:00, not 00:00.
        expect(new Date(curve.bounds.startAt).getUTCHours()).toBe(9);
        expect(curve.bounds.endAt).toBe(Date.parse(`${DAY}T14:00:00Z`));
        expect(curve.bounds.endT).toBe(300);
    });

    it('is the neutral line, and the extents always contain it', () => {
        expect(TRUNK).toEqual({ valence: 0, energy: 0.3, hex: '#94a3b8' });

        const curve = buildDayCurve([checkin(0, [feeling('joy', 3)]), checkin(120, [feeling('sadness', 3)])]);
        expect(curve.bounds.minY).toBeLessThanOrEqual(0);
        expect(curve.bounds.maxY).toBeGreaterThanOrEqual(0);
    });

    it('samples every STEP_MIN from the first check-in to the last', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy')]), checkin(60, [feeling('joy')])]);

        expect(curve.bounds.stepMin).toBe(STEP_MIN);
        expect(curve.samples.map(sample => sample.t)).toEqual([
            0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
        ]);
    });

    it('returns no samples for a day with nothing in it', () => {
        expect(buildDayCurve([])).toEqual({ samples: [], branches: [], bounds: null });
        expect(buildDayCurve(null)).toEqual({ samples: [], branches: [], bounds: null });
        // A night with a ritual row but no check-in is still a day with no curve: the ritual's
        // own copy of the day word is not what the graph reads (§6.3).
        expect(buildDayCurve([ritualRow(870)])).toEqual({ samples: [], branches: [], bounds: null });
    });

    it('draws one sample for a day holding a single check-in', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy')])]);

        expect(curve.samples).toHaveLength(1);
        expect(curve.bounds.endT).toBe(0);
        expect(curve.samples[0].branches).toHaveLength(1);
    });

    it('reads the day it is given, whatever order the rows arrive in', () => {
        const late = checkin(300, [feeling('calm')]);
        const early = checkin(0, [feeling('joy')]);

        const curve = buildDayCurve([late, early]);
        expect(curve.bounds.startAt).toBe(Date.parse(`${DAY}T08:00:00Z`));
        expect(curve.bounds.endT).toBe(300);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 2. One branch per feeling                                                              */
/* ------------------------------------------------------------------------------------ */

describe('branches', () => {
    it('gives two simultaneous feelings two branches leaving the trunk at the same t', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 2), feeling('anxiety', 3)])]);

        expect(curve.branches).toHaveLength(2);
        expect(curve.branches.map(branch => branch.startT)).toEqual([0, 0]);
        expect(new Set(curve.branches.map(branch => branch.key)).size).toBe(2);

        const [first] = curve.samples;
        expect(first.branches.map(entry => entry.feeling).sort()).toEqual(['anxiety', 'joy']);
    });

    it('counts one branch per distinct feeling, not per mention of it', () => {
        // A payload naming the same feeling twice in one check-in is not two branches.
        const curve = buildDayCurve([checkin(0, [feeling('joy', 1), feeling('joy', 3)])]);

        expect(curve.branches).toHaveLength(1);
        expect(curve.samples[0].branches).toHaveLength(1);
        expect(curve.samples[0].branches[0].intensity).toBe(3);   // the later entry wins
    });

    it('continues the live branch rather than starting a second one', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('joy', 2)]),
            checkin(120, [feeling('joy', 3)])
        ]);

        expect(curve.branches).toHaveLength(1);
        expect(curve.branches[0].supports.map(support => support.t)).toEqual([0, 120]);
    });

    it('puts y at valence scaled by the strength, and z at the feeling’s fixed energy', () => {
        const joy = feelingById('joy');
        const curve = buildDayCurve([checkin(0, [feeling('joy', 3)]), checkin(0, [feeling('joy', 3)])]);
        const entry = curve.samples[0].branches[0];

        expect(entry.z).toBe(joy.energy);
        expect(entry.y).toBeCloseTo(joy.valence * 1, 10);       // 3 of 3 is the full scale

        const half = buildDayCurve([checkin(0, [feeling('joy', 1)])]).samples[0].branches[0];
        expect(half.y).toBeCloseTo(joy.valence / 3, 10);
        expect(half.z).toBe(joy.energy);                        // energy is fixed, never scaled
    });

    it('orders branches born at one moment by the vocabulary, not by the payload', () => {
        const listed = buildDayCurve([checkin(0, [feeling('anger'), feeling('joy')])]);
        const reversed = buildDayCurve([checkin(0, [feeling('joy'), feeling('anger')])]);

        expect(listed.branches.map(branch => branch.feeling)).toEqual(['joy', 'anger']);
        expect(reversed.branches.map(branch => branch.feeling)).toEqual(['joy', 'anger']);
    });

    it('reports a feeling it has never heard of rather than dropping it silently', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy'), feeling('serenity')])]);

        expect(curve.bounds.unknownFeelings).toEqual(['serenity']);
        expect(curve.branches.map(branch => branch.feeling)).toEqual(['joy']);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 3. Interpolation between two check-ins that both carry the feeling                      */
/* ------------------------------------------------------------------------------------ */

describe('a feeling reported twice', () => {
    it('interpolates between 12:00 and 18:00 and never dips below either endpoint', () => {
        // 12:00 and 18:00, in this fixture's frame: 240 and 600 minutes after 08:00.
        const curve = buildDayCurve([
            checkin(240, [feeling('joy', 3)]),
            checkin(600, [feeling('joy', 2)])
        ]);

        const held = curve.samples
            .filter(sample => sample.t <= 360)
            .map(sample => sample.branches.find(entry => entry.feeling === 'joy').intensity);

        expect(Math.min(...held)).toBeGreaterThanOrEqual(2);
        expect(Math.max(...held)).toBeLessThanOrEqual(3);
        expect(held[0]).toBeCloseTo(3, 10);
        expect(held[held.length - 1]).toBeCloseTo(2, 10);
    });

    it('holds its line rather than sagging to the value decay would have reached', () => {
        const held = buildDayCurve([
            checkin(0, [feeling('joy', 2)]),
            checkin(360, [feeling('joy', 2)])
        ]);
        const faded = buildDayCurve([
            checkin(0, [feeling('joy', 2)]),
            checkin(360, [feeling('calm', 2)])
        ]);

        expect(branchAt(held, 180, 'joy').intensity).toBeCloseTo(2, 10);
        // The same 180 minutes, with nothing said in between, is most of two half-lives down.
        expect(branchAt(faded, 180, 'joy').intensity).toBeCloseTo(2 * 2 ** (-180 / FEELING_HALF_LIFE_MIN), 10);
        expect(branchAt(faded, 180, 'joy').intensity).toBeLessThan(1);
    });

    it('stays monotone across three supports rather than overshooting between them', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('joy', 1)]),
            checkin(120, [feeling('joy', 3)]),
            checkin(240, [feeling('joy', 3)])
        ]);

        const held = curve.samples
            .filter(sample => sample.t <= 240)
            .map(sample => sample.branches.find(entry => entry.feeling === 'joy').intensity);

        expect(Math.min(...held)).toBeGreaterThanOrEqual(1);
        expect(Math.max(...held)).toBeLessThanOrEqual(3);
        held.forEach((value, index) => {
            if (index > 0) expect(value).toBeGreaterThanOrEqual(held[index - 1] - 1e-12);
        });
    });
});

/* ------------------------------------------------------------------------------------ */
/* 4. Decay, and where it ends                                                            */
/* ------------------------------------------------------------------------------------ */

describe('decay', () => {
    /** The minute an exponential decay of `intensity` reaches the threshold. */
    const expectedEnd = (from, intensity, halfLife = FEELING_HALF_LIFE_MIN, threshold = BRANCH_END_THRESHOLD) => (
        from + halfLife * Math.log2(intensity / threshold)
    );

    it('crosses BRANCH_END_THRESHOLD at the minute the half-life implies', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 1)]),
            checkin(720, [feeling('calm', 1)])
        ]);
        const expected = expectedEnd(0, 1);          // 150 · log2(5) ≈ 348.29 min

        expect(branchFor(curve, 'anxiety').endT).toBeCloseTo(expected, 9);
        expect(branchFor(curve, 'anxiety').merged).toBe(true);

        const lastCarried = curve.samples.filter(sample => sample.branches.some(entry => entry.feeling === 'anxiety'));
        const lastT = lastCarried[lastCarried.length - 1].t;
        expect(lastT).toBeLessThanOrEqual(expected);
        expect(lastT + STEP_MIN).toBeGreaterThan(expected);

        // And it is genuinely at the threshold when it gets there, not merely near the end.
        const atEnd = 1 * 2 ** (-(expected - 0) / FEELING_HALF_LIFE_MIN);
        expect(atEnd).toBeCloseTo(BRANCH_END_THRESHOLD, 12);
    });

    it('moves with the constant rather than with a number written into the arithmetic', () => {
        const entries = [checkin(0, [feeling('anxiety', 1)]), checkin(720, [feeling('calm', 1)])];

        const fast = buildDayCurve(entries, { halfLifeMin: 30 });
        const slow = buildDayCurve(entries, { halfLifeMin: 300 });

        expect(branchFor(fast, 'anxiety').endT).toBeCloseTo(expectedEnd(0, 1, 30), 9);
        expect(branchFor(slow, 'anxiety').endT).toBeCloseTo(expectedEnd(0, 1, 300), 9);
    });

    it('lets a stronger feeling stand longer, from the same rule', () => {
        const entries = (strength) => [checkin(0, [feeling('anxiety', strength)]), checkin(900, [feeling('calm', 1)])];

        expect(branchFor(buildDayCurve(entries(3)), 'anxiety').endT)
            .toBeCloseTo(expectedEnd(0, 3), 9);
        expect(branchFor(buildDayCurve(entries(3)), 'anxiety').endT)
            .toBeGreaterThan(branchFor(buildDayCurve(entries(1)), 'anxiety').endT);
    });

    it('leaves a branch the day ended before as unmerged, rather than closing it onto the trunk', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 3)]), checkin(60, [feeling('calm', 1)])]);
        const [path] = branchPaths(curve).filter(entry => entry.feeling === 'joy');

        expect(branchFor(curve, 'joy').endT).toBeGreaterThan(curve.bounds.endT);
        expect(path.merged).toBe(false);
        expect(path.merge).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------ */
/* 5. Absence, and the one exception to it                                                */
/* ------------------------------------------------------------------------------------ */

describe('a later check-in without the feeling', () => {
    it('does not end the branch — absence is not a report that it stopped', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 2)]),
            checkin(60, [feeling('joy', 2)]),
            checkin(120, [feeling('joy', 2)])
        ]);

        expect(branchAt(curve, 60, 'anxiety')).not.toBeNull();
        expect(branchAt(curve, 120, 'anxiety')).not.toBeNull();
        expect(branchFor(curve, 'anxiety').endT)
            .toBeCloseTo(150 * Math.log2(2 / BRANCH_END_THRESHOLD), 9);
        expect(branchFor(curve, 'anxiety').endT).toBeGreaterThan(120);
    });
});

describe('an explicit level check-in', () => {
    it('ends every branch over NEUTRAL_SETTLE_MIN', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 3), feeling('joy', 2)]),
            checkin(120, [feeling('neutral', 2)]),
            checkin(300, [feeling('calm', 2)])
        ]);

        ['anxiety', 'joy'].forEach(id => {
            expect(branchFor(curve, id).endT).toBeCloseTo(120 + NEUTRAL_SETTLE_MIN, 10);
            expect(branchFor(curve, id).endReason).toBe('neutral');
            expect(branchFor(curve, id).merged).toBe(true);
            expect(branchAt(curve, 145, id)).not.toBeNull();
            expect(branchAt(curve, 150, id).intensity).toBeCloseTo(0, 10);
            expect(branchAt(curve, 155, id)).toBeNull();
        });
    });

    it('converges into the trunk rather than being cut off at it', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 3)]),
            checkin(120, [feeling('neutral', 2)]),
            checkin(300, [feeling('calm', 2)])
        ]);

        const falling = [125, 130, 135, 140, 145, 150].map(t => branchAt(curve, t, 'anxiety').intensity);
        falling.forEach((value, index) => {
            if (index > 0) expect(value).toBeLessThan(falling[index - 1]);
        });
        expect(falling[falling.length - 1]).toBeCloseTo(0, 10);
    });

    it('does not end the branches reported in the same breath as it', () => {
        // "Level, and also anxious" is not a report that nothing in particular is present.
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 2)]),
            checkin(120, [feeling('neutral', 2), feeling('anxiety', 2)]),
            checkin(300, [feeling('calm', 2)])
        ]);

        expect(branchFor(curve, 'anxiety').endReason).toBe('decay');
        expect(branchAt(curve, 300, 'anxiety')).not.toBeNull();
    });

    it('starts a second branch when the feeling is reported again after it', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 2)]),
            checkin(120, [feeling('neutral', 2)]),
            checkin(300, [feeling('anxiety', 2)])
        ]);

        const anxious = curve.branches.filter(branch => branch.feeling === 'anxiety');
        expect(anxious.map(branch => branch.key)).toEqual(['anxiety#0', 'anxiety#1']);
        expect(anxious[0].endT).toBeCloseTo(150, 10);
        expect(anxious[1].startT).toBe(300);
        expect(branchAt(curve, 200, 'anxiety')).toBeNull();
    });

    it('draws its own branch, because the user did say it', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 2)]),
            checkin(120, [feeling('neutral', 2)]),
            checkin(300, [feeling('calm', 2)])
        ]);

        const level = branchFor(curve, 'neutral');
        expect(level).not.toBeNull();
        expect(level.startT).toBe(120);
        expect(branchAt(curve, 120, 'neutral').y).toBe(0);       // valence 0 — it sits on the trunk
    });
});

/* ------------------------------------------------------------------------------------ */
/* 6. Extrapolation                                                                       */
/* ------------------------------------------------------------------------------------ */

describe('extrapolated segments', () => {
    it('marks what is further than CONFIDENT_MIN from a check-in carrying the feeling, and only that', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('sadness', 3)]),
            checkin(600, [feeling('calm', 1)])
        ]);

        expect(CONFIDENT_MIN % STEP_MIN).toBe(0);   // so both sides of the boundary are sampled
        expect(branchAt(curve, CONFIDENT_MIN - STEP_MIN, 'sadness').extrapolated).toBe(false);
        expect(branchAt(curve, CONFIDENT_MIN, 'sadness').extrapolated).toBe(false);
        expect(branchAt(curve, CONFIDENT_MIN + STEP_MIN, 'sadness').extrapolated).toBe(true);
    });

    it('measures the distance to the nearest support, on either side of it', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('sadness', 3)]),
            checkin(600, [feeling('sadness', 3)])
        ]);

        // Halfway between two supports 600 apart is 300 from both — far from either.
        expect(branchAt(curve, 300, 'sadness').extrapolated).toBe(true);
        // Ninety minutes before the second one is inside its confidence, though 510 after the first.
        expect(branchAt(curve, 510, 'sadness').extrapolated).toBe(false);
    });

    it('moves with the constant', () => {
        const entries = [checkin(0, [feeling('sadness', 3)]), checkin(600, [feeling('calm', 1)])];
        const tight = buildDayCurve(entries, { confidentMin: 45 });

        expect(branchAt(tight, 45, 'sadness').extrapolated).toBe(false);
        expect(branchAt(tight, 50, 'sadness').extrapolated).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 7. The ritual's day word                                                               */
/* ------------------------------------------------------------------------------------ */

describe('the ritual day word', () => {
    it('ends the day, needing no special case: decay, then extrapolation, then it rises', () => {
        const curve = buildDayCurve([
            checkin(60, [feeling('joy', 2)]),          // 09:00
            checkin(360, [feeling('stress', 1)]),      // 14:00
            dayWord(870, 'tiredness')                  // 22:30
        ]);

        // The day ends on the word, not on the afternoon check-in.
        expect(curve.bounds.endAt).toBe(Date.parse(`${DAY}T22:30:00Z`));
        expect(curve.bounds.endT).toBe(810);

        // Rule 7, in the order it states: the afternoon feeling decays…
        const stress = branchFor(curve, 'stress');
        expect(stress.endT).toBeCloseTo(300 + 150 * Math.log2(1 / BRANCH_END_THRESHOLD), 9);
        expect(branchAt(curve, 350, 'stress').intensity)
            .toBeCloseTo(2 ** (-50 / FEELING_HALF_LIFE_MIN), 10);

        // …is marked as a guess past ninety minutes…
        expect(branchAt(curve, 300 + CONFIDENT_MIN, 'stress').extrapolated).toBe(false);
        expect(branchAt(curve, 300 + CONFIDENT_MIN + STEP_MIN, 'stress').extrapolated).toBe(true);

        // …and is gone before the word's own branch rises at the ritual's minute.
        expect(branchAt(curve, 700, 'stress')).toBeNull();
        expect(branchFor(curve, 'tiredness').startT).toBe(810);
        expect(branchAt(curve, 810, 'tiredness')).not.toBeNull();
    });

    it('draws the word at the stated strength rather than at a silent middle number', () => {
        const curve = buildDayCurve([checkin(60, [feeling('joy', 2)]), dayWord(870, 'tiredness')]);
        const word = branchAt(curve, 810, 'tiredness');

        expect(word.intensity).toBe(UNSTATED_INTENSITY);
        expect(word.intensity).not.toBe(2);
        expect(word.y).toBeCloseTo(feelingById('tiredness').valence * (UNSTATED_INTENSITY / 3), 10);

        // And the constant is what decides it, not the arithmetic around it.
        const louder = buildDayCurve(
            [checkin(60, [feeling('joy', 2)]), dayWord(870, 'tiredness')],
            { unstatedIntensity: 3 }
        );
        expect(branchAt(louder, 810, 'tiredness').intensity).toBe(3);
    });

    it('ends a day with no ritual at its last check-in', () => {
        const curve = buildDayCurve([
            checkin(60, [feeling('joy', 2)]),
            checkin(360, [feeling('stress', 1)])
        ]);

        expect(curve.bounds.endAt).toBe(Date.parse(`${DAY}T14:00:00Z`));
        expect(curve.bounds.endT).toBe(300);
    });

    it('is not extended by the ritual row itself', () => {
        // The ritual keeps its own copy of the word (§6.3). Reading it here would draw the
        // word twice and stretch the day to a row the graph does not read.
        const curve = buildDayCurve([
            checkin(60, [feeling('joy', 2)]),
            checkin(360, [feeling('stress', 1)]),
            ritualRow(870)
        ]);

        expect(curve.bounds.endT).toBe(300);
        expect(curve.branches.map(branch => branch.feeling)).toEqual(['joy', 'stress']);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 8. Sampling bounds                                                                     */
/* ------------------------------------------------------------------------------------ */

describe('sampling', () => {
    it('holds MAX_SAMPLES over a day longer than the step could cover', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('joy', 2)]),
            checkin(1500, [feeling('calm', 2)])       // 25 hours: an autumn civil day
        ]);

        expect(curve.samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
        expect(curve.bounds.stepMin).toBeGreaterThan(STEP_MIN);
        expect(curve.bounds.sampleCount).toBe(curve.samples.length);
        expect(curve.samples[curve.samples.length - 1].t).toBe(1500);
    });

    it('lets more than five branches be alive at once, because decay outlives a check-in', () => {
        // §8.2 rule 8 bounds a *check-in* at five feelings, and the composer and the server
        // both enforce that. It does not bound a *sample*: an intensity-2 feeling stands for
        // 150·log2(10) ≈ 498 minutes, so two full check-ins an hour apart leave ten branches
        // alive together. Truncating to five would drop a line the user authored, so nothing
        // here truncates — `bounds.maxBranches` reports what the day actually held.
        const morning = ['joy', 'excitement', 'pleasure', 'rapport', 'gratitude'];
        const later = ['pride', 'curiosity', 'calm', 'longing', 'boredom'];
        const curve = buildDayCurve([
            checkin(0, morning.map(id => feeling(id, 2))),
            checkin(60, later.map(id => feeling(id, 2)))
        ]);

        expect(curve.bounds.maxBranches).toBe(10);
        expect(sampleAt(curve, 60).branches).toHaveLength(10);
        expect(curve.branches).toHaveLength(10);
    });

    it('does not crash on more feelings at one moment than a composer can produce', () => {
        // Five is the composer's cap (`MAX_FEELINGS_PER_CHECKIN`) and the server's. Six can
        // only arrive from a file — and a drawing that threw would lose the whole day.
        const six = ['joy', 'anxiety', 'calm', 'sadness', 'anger', 'curiosity'];
        const curve = buildDayCurve([checkin(0, six.map(id => feeling(id, 2)))]);

        expect(curve.branches).toHaveLength(6);
        expect(curve.samples[0].branches).toHaveLength(6);
        expect(curve.bounds.maxBranches).toBe(6);
        expect(curve.samples[0].branches.every(entry => Number.isFinite(entry.y))).toBe(true);
        expect(branchPaths(curve)).toHaveLength(6);
        expect(dayGraphLegend(curve.samples)).toHaveLength(6);
    });

    it('clamps a strength no writer of this app could have produced', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 9)]), checkin(0, [feeling('calm', 0)])]);

        expect(branchAt(curve, 0, 'joy').intensity).toBe(3);
        expect(branchAt(curve, 0, 'calm').intensity).toBe(1);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 9. branchPaths                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('branchPaths', () => {
    it('draws one path per branch lifetime, born and merged at trunk valence', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('anxiety', 2)]),
            checkin(120, [feeling('neutral', 2)]),
            checkin(300, [feeling('anxiety', 2)])
        ]);
        const paths = branchPaths(curve);
        const anxious = paths.filter(path => path.feeling === 'anxiety');

        expect(anxious).toHaveLength(2);                     // two lifetimes, two paths
        expect(anxious[0].birth).toMatchObject({ t: 0, y: TRUNK.valence });
        expect(anxious[0].merge).toMatchObject({ t: 150, y: TRUNK.valence });
        expect(anxious[0].points[0]).toBe(anxious[0].birth);
        expect(anxious[0].points[anxious[0].points.length - 1]).toBe(anxious[0].merge);
    });

    it('is born at the check-in’s own minute, not at the next sample', () => {
        // 09:02 is not a multiple of five; rule 2's "leaving the trunk at the same t" is only
        // true if the birth is the check-in and not the grid.
        const curve = buildDayCurve([
            checkin(0, [feeling('joy', 2)]),
            checkin(62, [feeling('anger', 2), feeling('shame', 2)]),
            checkin(300, [feeling('calm', 2)])
        ]);
        const born = branchPaths(curve).filter(path => ['anger', 'shame'].includes(path.feeling));

        expect(born.map(path => path.birth.t)).toEqual([62, 62]);
        expect(born.every(path => path.birth.y === TRUNK.valence)).toBe(true);
    });

    it('takes its stroke width from the strength', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 3), feeling('calm', 1)])]);
        const paths = branchPaths(curve);

        expect(paths.find(path => path.feeling === 'joy').width).toBeCloseTo(STROKE_WIDTH.max, 10);
        expect(paths.find(path => path.feeling === 'calm').width).toBeCloseTo(strokeWidthFor(1), 10);
        expect(strokeWidthFor(3)).toBe(STROKE_WIDTH.max);
        expect(strokeWidthFor(0)).toBe(STROKE_WIDTH.min);
    });

    it('dashes the unclear feeling and anything marked uncertain, and nothing else', () => {
        const curve = buildDayCurve([checkin(0, [
            feeling('unclear', 2),
            feeling('joy', 2, { uncertain: true }),
            feeling('calm', 2, { uncertain: false }),
            feeling('sadness', 2)
        ])]);
        const dashed = Object.fromEntries(branchPaths(curve).map(path => [path.feeling, path.dashed]));

        expect(dashed).toEqual({ unclear: true, joy: true, calm: false, sadness: false });
    });

    it('splits the path where the opacity changes, sharing the boundary point', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('sadness', 3)]),
            checkin(600, [feeling('calm', 1)])
        ]);
        const [path] = branchPaths(curve).filter(entry => entry.feeling === 'sadness');

        expect(path.segments.length).toBe(2);
        expect(path.segments[0].extrapolated).toBe(false);
        expect(path.segments[0].opacity).toBe(1);
        expect(path.segments[1].extrapolated).toBe(true);
        expect(path.segments[1].opacity).toBe(EXTRAPOLATED_OPACITY);
        // No gap: the last point of one run is the first point of the next.
        expect(path.segments[1].points[0]).toBe(path.segments[0].points[path.segments[0].points.length - 1]);
    });

    it('reads a bare samples array as its name says', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 2)]), checkin(120, [feeling('calm', 2)])]);
        const fromSamples = branchPaths(curve.samples);

        expect(fromSamples.map(path => path.feeling)).toEqual(['joy', 'calm']);
        expect(fromSamples.every(path => path.birth.y === TRUNK.valence)).toBe(true);
    });

    it('returns nothing for a day with nothing in it', () => {
        expect(branchPaths(buildDayCurve([]))).toEqual([]);
        expect(branchPaths([])).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 10. project                                                                            */
/* ------------------------------------------------------------------------------------ */

describe('project', () => {
    it('is the exact 2-D ribbon at pitch 0', () => {
        const points = [
            { x: 0, y: 0, z: TRUNK.energy },
            { x: 0.25, y: -0.6, z: 0.9 },
            { x: 1, y: 0.8, z: 0.1 }
        ];

        points.forEach(point => {
            const flat = project(point, { pitch: 0 });
            expect(flat.x).toBe(point.x);        // exactly, not nearly
            expect(flat.y).toBe(point.y);
            expect(flat.width).toBe(1);          // no tilt, no depth cues
            expect(flat.opacity).toBe(1);
        });
    });

    it('mirrors x at a yaw of 180°', () => {
        expect(project({ x: 0.25, y: -0.6, z: 0.9 }, { yaw: 180 }).x).toBe(-0.25);
        expect(project({ x: -1, y: 0, z: 0 }, { yaw: 180 }).x).toBe(1);
        // And it is still the flat ribbon in y, which the rounding dust of Math.sin(Math.PI)
        // would otherwise disturb.
        expect(project({ x: 0.25, y: -0.6, z: 0.9 }, { yaw: 180, pitch: 0 }).y).toBe(-0.6);
    });

    it('slides depth up the screen when it is tilted', () => {
        const tilted = project({ x: 0.25, y: 0, z: 1 }, { pitch: 30 });

        expect(tilted.y).toBeCloseTo(-Math.sin(Math.PI / 6), 12);
        expect(tilted.depth).toBeCloseTo(Math.cos(Math.PI / 6), 12);
        expect(tilted.x).toBe(0.25);
    });

    it('fades and narrows what is further away, and only while there is a tilt', () => {
        const near = project({ x: 0, y: 0, z: 1 }, { pitch: 45 });
        const far = project({ x: 0, y: 0, z: -1 }, { pitch: 45 });

        expect(far.opacity).toBeLessThan(near.opacity);
        expect(far.width).toBeLessThan(near.width);
        expect(project({ x: 0, y: 0, z: -1 }, { pitch: 0 }).opacity).toBe(1);
    });

    it('answers for a point with nothing in it rather than returning NaN', () => {
        expect(project(null)).toMatchObject({ x: 0, y: 0, depth: 0 });
        expect(project({ x: 'nine' })).toMatchObject({ x: 0, y: 0 });
    });

    it('projects a day’s samples onto the ribbon they were built as', () => {
        const curve = buildDayCurve([checkin(0, [feeling('joy', 3)]), checkin(120, [feeling('sadness', 2)])]);

        curve.samples.forEach(sample => sample.branches.forEach(entry => {
            const flat = project({ x: sample.t, y: entry.y, z: entry.z }, { pitch: 0 });
            expect(flat.x).toBe(sample.t);
            expect(flat.y).toBe(entry.y);
        }));
    });
});

describe('paintersOrder', () => {
    it('sorts furthest first', () => {
        const sorted = paintersOrder([{ id: 'a', depth: 0.5 }, { id: 'b', depth: -0.2 }, { id: 'c', depth: 0.1 }]);
        expect(sorted.map(item => item.id)).toEqual(['b', 'c', 'a']);
    });

    it('is stable for equal depths — two feelings at one energy cannot swap between renders', () => {
        const items = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, depth: 0.3 }));

        expect(paintersOrder(items).map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(paintersOrder(items)).toEqual(paintersOrder(items));
        // The input is left alone: a sort in place would reorder the caller's array too.
        expect(items.map(item => item.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('answers for nothing at all', () => {
        expect(paintersOrder(null)).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 11. dayGraphLegend                                                                     */
/* ------------------------------------------------------------------------------------ */

describe('dayGraphLegend', () => {
    it('lists distinct feelings in order of first appearance', () => {
        const curve = buildDayCurve([
            checkin(0, [feeling('sadness', 2)]),
            checkin(60, [feeling('joy', 2), feeling('sadness', 2)]),
            checkin(120, [feeling('calm', 2)])
        ]);

        expect(dayGraphLegend(curve.samples).map(entry => entry.id)).toEqual(['sadness', 'joy', 'calm']);
    });

    it('carries the label and the colour from the vocabulary, and marks what draws dashed', () => {
        const curve = buildDayCurve([checkin(0, [
            feeling('unclear', 2),
            feeling('joy', 2, { uncertain: true }),
            feeling('calm', 2)
        ])]);
        const legend = dayGraphLegend(curve.samples);

        expect(legend.find(entry => entry.id === 'unclear'))
            .toMatchObject({ label: "can't tell", hex: '#a1a1aa', dashed: true });
        expect(legend.find(entry => entry.id === 'joy').dashed).toBe(true);
        expect(legend.find(entry => entry.id === 'calm').dashed).toBe(false);
    });

    it('holds no names, so discretion cannot change what it returns', () => {
        // The same day, once with a person and a trigger named on every feeling.
        const plain = buildDayCurve([checkin(0, [feeling('joy', 2)]), checkin(60, [feeling('calm', 2)])]);
        const named = buildDayCurve([
            checkin(0, [feeling('joy', 2, { about: [{ kind: 'person', ref: 0 }] })], {
                tags: ['at Lucie’s'], note: 'Lucie came over'
            }),
            checkin(60, [feeling('calm', 2, { about: [{ kind: 'trigger', trigger: 'trigger-1' }] })])
        ]);

        expect(dayGraphLegend(named.samples)).toEqual(dayGraphLegend(plain.samples));
        expect(JSON.stringify(dayGraphLegend(named.samples))).not.toMatch(/Lucie|trigger/i);
        expect(Object.keys(dayGraphLegend(plain.samples)[0]).sort())
            .toEqual(['dashed', 'energy', 'hex', 'id', 'label', 'valence']);
    });

    it('returns nothing for a day with nothing in it', () => {
        expect(dayGraphLegend([])).toEqual([]);
        expect(dayGraphLegend(buildDayCurve([]))).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 12. A day that spans a clock change                                                    */
/* ------------------------------------------------------------------------------------ */

describe('a day spanning a daylight-saving change', () => {
    const hadTZ = 'TZ' in process.env;
    const previousTZ = process.env.TZ;

    beforeAll(() => { process.env.TZ = 'Europe/Berlin'; });
    afterAll(() => {
        // Assigning `undefined` sets the *string* "undefined" and leaves the process in a zone
        // that does not exist.
        if (hadTZ) process.env.TZ = previousTZ;
        else delete process.env.TZ;
    });

    it('really is in a zone with a clock change, or the case below asserts nothing', () => {
        const before = new Date('2025-10-25T12:00:00Z').getTimezoneOffset();
        const after = new Date('2025-10-26T12:00:00Z').getTimezoneOffset();

        expect(before).toBe(-120);
        expect(after).toBe(-60);
    });

    it('produces monotonically increasing t across the extra hour', () => {
        // The civil day of 2025-10-25 runs 04:00 to 04:00 local and contains the autumn
        // change, so it is twenty-five hours long; the check-ins inside it span twenty-four,
        // which is already more than a five-minute step can cover. Every `at` below is a real
        // local wall clock, and two of them read 02:30.
        const clocks = [
            '2025-10-25T04:30:00+02:00',
            '2025-10-25T13:00:00+02:00',
            '2025-10-25T23:15:00+02:00',
            '2025-10-26T02:30:00+02:00',   // the first pass through 02:30
            '2025-10-26T02:30:00+01:00',   // and the second, an hour later
            '2025-10-26T03:30:00+01:00'
        ];
        const entries = clocks.map((at, index) => ({
            ID: index + 1,
            client_id: `dst-${index}`,
            kind: 'checkin',
            day: '2025-10-25',
            at,
            schema_version: 1,
            payload: { v: 1, source: 'manual', feelings: [{ id: 'calm', intensity: 2, about: [] }] },
            mentions: []
        }));

        const curve = buildDayCurve(entries);
        const times = curve.samples.map(sample => sample.t);

        times.forEach((t, index) => {
            if (index > 0) expect(t).toBeGreaterThan(times[index - 1]);
        });
        expect(curve.bounds.endT).toBe(1440);        // elapsed minutes, not clock minutes
        expect(curve.samples.length).toBeLessThanOrEqual(MAX_SAMPLES);
        expect(curve.bounds.stepMin).toBeGreaterThan(STEP_MIN);

        // The two 02:30s are an hour apart on the axis, which a clock-time x would have drawn
        // on top of each other.
        const supports = branchFor(curve, 'calm').supports.map(support => support.t);
        expect(supports).toEqual([0, 510, 1125, 1320, 1380, 1440]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* 13. The reason this module exists at all                                               */
/* ------------------------------------------------------------------------------------ */

describe('the module itself', () => {
    // `import.meta.url` is rewritten by Vite to something `fileURLToPath` refuses; Vitest runs
    // with the project root as its cwd, so this is the way to read a source file.
    const source = readFileSync(resolve(process.cwd(), 'src/components/dayGraph.js'), 'utf8');

    it('imports no renderer, which is what invariant 19 asks of chart logic', () => {
        expect(source).not.toMatch(/from\s+['"]react['"]/);
        expect(source).not.toMatch(/from\s+['"]recharts['"]/);
        expect(source).not.toMatch(/from\s+['"]three['"]/);
        expect(source).not.toMatch(/React\.createElement/);
        expect(source).not.toMatch(/return\s*\(?\s*</);        // no JSX, no SVG
    });

    it('says out loud that its constants are a drawing choice and not a claim', () => {
        expect(source).toMatch(/drawing choice about what the user recorded, not a claim/);
    });

    it('holds every tunable as a named constant rather than inline in the arithmetic', () => {
        expect(FEELING_HALF_LIFE_MIN).toBe(150);
        expect(BRANCH_END_THRESHOLD).toBe(0.2);
        expect(CONFIDENT_MIN).toBe(90);
        expect(NEUTRAL_SETTLE_MIN).toBe(30);
        expect(STEP_MIN).toBe(5);
        expect(UNSTATED_INTENSITY).toBe(1);
        expect(MAX_SAMPLES).toBe(288);
    });

    it('does not touch the entries it is given', () => {
        const entries = [checkin(0, [feeling('joy', 2)]), checkin(120, [feeling('calm', 2)])];
        const before = JSON.stringify(entries);

        buildDayCurve(entries);
        expect(JSON.stringify(entries)).toBe(before);
    });
});
