/**
 * The day graph's geometry: one day of check-ins as a branching curve.
 *
 * Nothing here renders. There is no React import, no SVG, no Recharts — deliberately, and
 * for the reason invariant 19 gives: Recharts draws nothing under jsdom, so a test asserting
 * on a chart's rendered output proves nothing. Every decision the graph makes about where a
 * line goes is therefore made in this file, by a pure function a test can call with a fixture
 * and check to the minute. `LoveShape.jsx` is the precedent — `buildShapeData` is where its
 * honesty rules live, and the component is a `map` over what it returns. This module is the
 * same idea with more arithmetic in it.
 *
 * The four functions §8.4 names:
 *
 *   buildDayCurve(entries, options) → { samples, branches, bounds }   the day as geometry
 *   branchPaths(curve)              → one path per branch lifetime    what the component strokes
 *   project(point, camera)          → screen (x, y), depth, width…    the 2.5-D oblique camera
 *   dayGraphLegend(samples)         → the feelings, in first order    the key beside the drawing
 *
 * `paintersOrder` is the fifth, and small: painter's ordering has to be *stable* for equal
 * depths or two branches at the same energy swap places between renders, so the sort belongs
 * here beside the depth that feeds it rather than in the component.
 *
 * The geometry is deliberately renderer-agnostic. §8.3 picks hand-drawn SVG for this slice and
 * names three.js as the upgrade path rather than a fork: everything below is (x, y, z) and
 * minutes, so a WebGL renderer would consume it unchanged.
 */

import {
    FEELINGS,
    feelingById,
    readCheckin,
    INTENSITY_LEVELS,
    UNCLEAR_FEELING_ID
} from '../constants/journal';

/* ------------------------------------------------------------------------------------ */
/* 1. The constants, and what they are                                                    */
/* ------------------------------------------------------------------------------------ */

/*
 * Every number in this block is a **drawing choice about what the user recorded, not a claim
 * about the user** — the sentence `JOURNAL_COPY.dayGraph.caveat` says on screen, verbatim:
 * "That is a drawing choice about what you recorded, not a claim about you."
 *
 * That is not a disclaimer bolted on afterwards. A half-life is an assertion about how long a
 * feeling lasts, and this application has no way of knowing that and no business guessing it.
 * What it *can* say is how it chose to draw the gap between two things the user did say, which
 * is why the ⓘ shows the half-life in words (`humanMinutes`) rather than hiding it, and why
 * each of these is a named constant an option can override rather than a number inline in the
 * arithmetic. Tune one and the sentence tunes with it; nothing here can drift into a claim.
 */

/** How long a feeling takes to halve, when nothing further is said about it. §8.2 rule 4. */
export const FEELING_HALF_LIFE_MIN = 150;

/** Below this much of one intensity step, a branch has merged into the trunk. §8.2 rule 4. */
export const BRANCH_END_THRESHOLD = 0.2;

/** Further than this from the nearest check-in carrying it, a branch is drawn as a guess. §8.2 rule 6. */
export const CONFIDENT_MIN = 90;

/** How long an explicit `level` check-in takes to settle every other branch. §8.2 rule 5. */
export const NEUTRAL_SETTLE_MIN = 30;

/** The sampling interval, in minutes. §8.2 rule 8. */
export const STEP_MIN = 5;

/**
 * What a feeling with no strength recorded is drawn at.
 *
 * The ritual's day word is one tap on one word and carries no `intensity` (§6.5, A8) — the
 * server accepts the absence rather than let the client invent a number, because a middle
 * value the user never chose would be the application authoring a value (invariant 15). The
 * graph still has to put the line somewhere, so it puts it at the **lightest** step and says
 * so: `JOURNAL_COPY.dayGraph.unstated` is that sentence. The lightest step is the choice that
 * claims least — the alternative, a silent 2, would draw a word tapped at bedtime as strongly
 * as a feeling the user deliberately marked as strong.
 */
export const UNSTATED_INTENSITY = 1;

/** The bound §8.2 rule 8 sets on one day's samples. A 25-hour day widens the step to hold it. */
export const MAX_SAMPLES = 288;

/** The feeling that is a report that nothing in particular is present. §8.2 rule 5. */
export const NEUTRAL_FEELING_ID = 'neutral';

/**
 * The trunk: the neutral line the day is drawn against, and where every branch is born and
 * dies. Valence 0, energy 0.3, grey — the same three numbers as the `neutral` vocabulary
 * entry, because it is the same place on the two axes.
 */
export const TRUNK = Object.freeze({ valence: 0, energy: 0.3, hex: '#94a3b8' });

/** Stroke width in px at zero and at full intensity. §8.1: width reinforces y. */
export const STROKE_WIDTH = Object.freeze({ min: 1, max: 3 });

/** What an extrapolated segment is drawn at. §8.1: a guess has to look like a guess. */
export const EXTRAPOLATED_OPACITY = 0.45;

/** How far depth may widen or narrow a stroke, and how far it may fade one, at full tilt. */
export const DEPTH_WIDTH_GAIN = 0.3;
export const DEPTH_OPACITY_MIN = 0.55;

/** The strength scale the user authors on. `y` is valence scaled by intensity over this. */
const MAX_INTENSITY = Math.max(...INTENSITY_LEVELS);
const MIN_INTENSITY = Math.min(...INTENSITY_LEVELS);

const DEFAULTS = Object.freeze({
    halfLifeMin: FEELING_HALF_LIFE_MIN,
    endThreshold: BRANCH_END_THRESHOLD,
    confidentMin: CONFIDENT_MIN,
    neutralSettleMin: NEUTRAL_SETTLE_MIN,
    stepMin: STEP_MIN,
    unstatedIntensity: UNSTATED_INTENSITY,
    maxSamples: MAX_SAMPLES
});

/* ------------------------------------------------------------------------------------ */
/* 2. Small arithmetic                                                                    */
/* ------------------------------------------------------------------------------------ */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/**
 * Where a feeling sits in the vocabulary, for the tie-break between two branches born at one
 * moment. Invariant 18's rule, applied to a different drawing: a thing is only recognisable if
 * it is always in the same place, so two feelings tapped in one check-in are ordered by the
 * vocabulary rather than by whichever order the payload happened to list them in.
 */
const FEELING_ORDER = new Map(FEELINGS.map((feeling, index) => [feeling.id, index]));
const feelingIndex = (id) => (FEELING_ORDER.has(id) ? FEELING_ORDER.get(id) : Number.MAX_SAFE_INTEGER);

const MS_PER_MIN = 60000;

/** An instant in epoch milliseconds, or null. `null` is checked first: `new Date(null)` is the epoch. */
const instantOf = (at) => {
    if (at === null || at === undefined || at === '') return null;
    const parsed = at instanceof Date ? at : new Date(at);
    const ms = parsed.getTime();
    return Number.isNaN(ms) ? null : ms;
};

/**
 * The strength a feeling entry draws at.
 *
 * `null` — the writer said nothing — draws at `unstatedIntensity`, which is the constant the ⓘ
 * names. A number outside the scale is clamped rather than dropped: the server would have
 * refused it, so it can only arrive from a file, and a line drawn at the edge of the scale is
 * closer to what was written than no line at all.
 */
const intensityOf = (value, options) => (
    value === null || value === undefined
        ? options.unstatedIntensity
        : clamp(value, MIN_INTENSITY, MAX_INTENSITY)
);

/** Stroke width in px for a strength on the 0…MAX_INTENSITY scale. */
export const strokeWidthFor = (intensity) => (
    STROKE_WIDTH.min
    + (STROKE_WIDTH.max - STROKE_WIDTH.min) * clamp(intensity / MAX_INTENSITY, 0, 1)
);

/**
 * Monotone cubic tangents, Fritsch–Carlson — the same shape as the `monotone` curve the
 * timeline draws with, and here for §8.2 rule 3's reason: a feeling reported at 12:00 and
 * again at 18:00 was present in between, and a curve that sags below both endpoints would be
 * drawing a dip the user never reported. Fritsch–Carlson's whole guarantee is that it cannot.
 */
const monotoneTangents = (xs, ys) => {
    const n = xs.length;
    if (n < 2) return [0];

    const secants = [];
    for (let i = 0; i < n - 1; i += 1) {
        secants.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
    }

    const tangents = new Array(n);
    tangents[0] = secants[0];
    tangents[n - 1] = secants[n - 2];
    for (let i = 1; i < n - 1; i += 1) {
        tangents[i] = secants[i - 1] * secants[i] <= 0 ? 0 : (secants[i - 1] + secants[i]) / 2;
    }

    for (let i = 0; i < n - 1; i += 1) {
        if (secants[i] === 0) {
            tangents[i] = 0;
            tangents[i + 1] = 0;
            continue;
        }
        const a = tangents[i] / secants[i];
        const b = tangents[i + 1] / secants[i];
        const square = a * a + b * b;
        if (square > 9) {
            const tau = 3 / Math.sqrt(square);
            tangents[i] = tau * a * secants[i];
            tangents[i + 1] = tau * b * secants[i];
        }
    }

    return tangents;
};

/** One cubic Hermite span. */
const hermite = (x, x0, x1, y0, y1, m0, m1) => {
    const h = x1 - x0;
    const s = (x - x0) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * y0
        + (s3 - 2 * s2 + s) * h * m0
        + (-2 * s3 + 3 * s2) * y1
        + (s3 - s2) * h * m1;
};

/* ------------------------------------------------------------------------------------ */
/* 3. buildDayCurve                                                                       */
/* ------------------------------------------------------------------------------------ */

/**
 * The day's check-ins, oldest first, with their payloads read.
 *
 * Sorted here rather than trusted: the provider hands over the server's order (`day`, `at`,
 * id) and that is already right, but this function is the one place a wrong minute becomes a
 * wrong drawing, and a caller passing a list in any other order should still get the day it
 * has. Non-`checkin` kinds are skipped — a ritual row's own copy of the day word would draw
 * the word twice, since A8 writes it as a check-in as well (§6.3).
 */
const checkinsOf = (entries) => {
    const rows = [];

    (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
        if (entry?.kind !== 'checkin') return;
        const at = instantOf(entry?.at);
        if (at === null) return;
        rows.push({ at, index, checkin: readCheckin(entry?.payload) });
    });

    rows.sort((a, b) => (a.at - b.at) || (a.index - b.index));
    return rows;
};

/**
 * Every feeling's supports — the moments a check-in actually carried it — plus the moments the
 * user said `level` and nothing else.
 *
 * A check-in carrying `level` **beside** another feeling is not that: rule 5's exception is
 * "a report that nothing in particular is present", and a check-in that also names anxiety is
 * a report that something is. So only a check-in whose sole feeling is `level` settles the
 * others; its own branch is drawn like any other, sitting on the trunk because its valence is
 * zero, because the user did say it.
 */
const supportsOf = (rows, firstAt, options, unknown) => {
    const byFeeling = new Map();
    const neutralAt = [];

    rows.forEach(row => {
        const named = row.checkin.feelings.filter(feeling => typeof feeling.id === 'string' && feeling.id);
        const known = named.filter(feeling => {
            if (feelingById(feeling.id)) return true;
            // Not dropped quietly: a feeling this build has never heard of is reported in
            // `bounds.unknownFeelings` so a newer writer's vocabulary is visible rather than
            // silently missing from the drawing.
            unknown.add(feeling.id);
            return false;
        });

        const t = (row.at - firstAt) / MS_PER_MIN;
        if (known.length === 1 && known[0].id === NEUTRAL_FEELING_ID) neutralAt.push(t);

        known.forEach(feeling => {
            const support = {
                t,
                intensity: intensityOf(feeling.intensity, options),
                uncertain: feeling.uncertain === true
            };
            const list = byFeeling.get(feeling.id) ?? [];
            // One moment, one support: a payload naming a feeling twice, or two rows sharing an
            // instant, must not put two knots on the same x — the interpolation divides by the
            // gap between them.
            if (list.length && list[list.length - 1].t === t) list[list.length - 1] = support;
            else list.push(support);
            byFeeling.set(feeling.id, list);
        });
    });

    return { byFeeling, neutralAt };
};

/** The minute a branch last supported at `t` with strength `intensity` reaches the threshold. */
const decayEndT = (t, intensity, options) => (
    intensity <= options.endThreshold
        ? t
        : t + options.halfLifeMin * Math.log2(intensity / options.endThreshold)
);

/**
 * One feeling's branches. Usually one; more than one when an explicit `level` check-in ended it
 * and a later check-in reported it again.
 *
 * Splitting rather than interpolating across the `level` is the honest reading of rules 3 and
 * 5 together: between two check-ins that both carry the feeling, rule 3 draws a line — but a
 * check-in in between saying nothing in particular is present is the user contradicting that
 * line, and drawing through it would be the graph overruling them.
 */
const branchesFor = (feelingId, supports, neutralAt, options) => {
    const entry = feelingById(feelingId);
    const built = [];
    let current = null;

    const close = (segment, nextStart) => {
        const last = segment.supports[segment.supports.length - 1];
        const neutral = neutralAt.find(n => n > last.t) ?? null;
        const settleEnd = neutral === null ? Infinity : neutral + options.neutralSettleMin;
        const decay = decayEndT(last.t, last.intensity, options);

        let endT = decay;
        let endReason = 'decay';
        if (settleEnd < endT) {
            endT = settleEnd;
            endReason = 'neutral';
        }
        if (nextStart < endT) {
            endT = nextStart;
            endReason = 'resumed';
        }

        segment.endT = endT;
        segment.endReason = endReason;
        // The ramp applies whenever a `level` sits after the last support, even when a later
        // check-in cuts the segment short first: the fall began when the user said it.
        segment.neutralAt = neutral !== null && neutral < endT ? neutral : null;
        segment.tangents = monotoneTangents(
            segment.supports.map(support => support.t),
            segment.supports.map(support => support.intensity)
        );
        built.push(segment);
    };

    supports.forEach(support => {
        if (current) {
            const last = current.supports[current.supports.length - 1];
            const interrupted = neutralAt.some(n => n > last.t && n < support.t);
            if (interrupted) {
                close(current, support.t);
                current = null;
            }
        }
        if (current) current.supports.push(support);
        else current = { feeling: feelingId, supports: [support] };
    });

    if (current) close(current, Infinity);

    return built.map((segment, index) => ({
        key: `${feelingId}#${index}`,
        feeling: feelingId,
        label: entry.label,
        hex: entry.hex,
        valence: entry.valence,
        energy: entry.energy,
        startT: segment.supports[0].t,
        endT: segment.endT,
        endReason: segment.endReason,
        neutralAt: segment.neutralAt,
        supports: segment.supports,
        tangents: segment.tangents,
        // A branch that reaches the trunk converges into it; one the day ended before, or one
        // the user reported again, never did. Only the first draws a merge point.
        merged: segment.endReason !== 'resumed',
        peakIntensity: Math.max(...segment.supports.map(support => support.intensity)),
        dashed: feelingId === UNCLEAR_FEELING_ID
            || segment.supports.some(support => support.uncertain)
    }));
};

/** Where a branch stands at `t`: interpolated between its supports, then decaying, then settling. */
const intensityAt = (branch, t, options) => {
    const { supports, tangents } = branch;
    const last = supports[supports.length - 1];

    let value;
    if (t >= last.t) {
        value = last.intensity * Math.pow(2, -(t - last.t) / options.halfLifeMin);
    } else if (t <= supports[0].t) {
        value = supports[0].intensity;
    } else {
        let i = 0;
        while (i < supports.length - 2 && supports[i + 1].t <= t) i += 1;
        value = hermite(
            t,
            supports[i].t, supports[i + 1].t,
            supports[i].intensity, supports[i + 1].intensity,
            tangents[i], tangents[i + 1]
        );
    }

    if (branch.neutralAt !== null && t > branch.neutralAt) {
        value *= clamp(1 - (t - branch.neutralAt) / options.neutralSettleMin, 0, 1);
    }

    return value;
};

/** How far `t` is from the nearest check-in that actually carried this feeling. */
const distanceToSupport = (branch, t) => branch.supports.reduce(
    (nearest, support) => Math.min(nearest, Math.abs(t - support.t)),
    Infinity
);

/** What the user last said about certainty, at or before `t`. Absence is not `false` (invariant 14). */
const uncertainAt = (branch, t) => {
    let value = branch.supports[0].uncertain;
    branch.supports.forEach(support => {
        if (support.t <= t) value = support.uncertain;
    });
    return value === true;
};

/**
 * A day of entries as drawable geometry.
 *
 * Returns `{ samples, branches, bounds }`:
 *
 * - `samples` — one every `stepMin` from the first check-in to the last, each
 *   `{ t, branches: [{ feeling, key, intensity, y, z, uncertain, extrapolated }] }`. `t` is
 *   **minutes elapsed since the first check-in**, computed from instants, which is what makes
 *   it monotone across a daylight-saving change: a civil day can be 23 or 25 hours long and a
 *   clock-time axis would run backwards through the autumn hour that happens twice.
 * - `branches` — one per branch lifetime, with the minute it was born and the minute it merged.
 * - `bounds` — the window, the axis extents, and the two instants the component needs to put a
 *   clock time under `t`: `startAt + t * 60000` is the instant of any sample. `null` for a day
 *   with no check-in in it.
 *
 * Before the first check-in nothing is drawn, and after the last nothing is either. §8.2 rule 1
 * gives the reason and it is the timeline's: an undated snapshot is left off the time axis
 * rather than placed at a plausible date, because placing it would be the application
 * inventing a fact. A trunk running back to 00:00 would be exactly that — a claim that the
 * user was level all morning, when what is true is that they had not said anything yet.
 */
export const buildDayCurve = (entries, options = {}) => {
    const settings = { ...DEFAULTS, ...options };
    const rows = checkinsOf(entries);

    if (rows.length === 0) return { samples: [], branches: [], bounds: null };

    const firstAt = rows[0].at;
    const lastAt = rows[rows.length - 1].at;
    const span = (lastAt - firstAt) / MS_PER_MIN;

    const unknown = new Set();
    const { byFeeling, neutralAt } = supportsOf(rows, firstAt, settings, unknown);

    const branches = [];
    byFeeling.forEach((supports, feelingId) => {
        branchesFor(feelingId, supports, neutralAt, settings).forEach(branch => branches.push(branch));
    });
    // Birth order, then the vocabulary's own order for two feelings born at one moment. Both
    // halves are needed: `Map` iteration order is insertion order, which is the order the
    // *payload* happened to list them in, and the legend below reads this order.
    branches.sort((a, b) => (a.startT - b.startT)
        || (feelingIndex(a.feeling) - feelingIndex(b.feeling))
        || (a.key < b.key ? -1 : 1));

    /*
     * §8.2 rule 8 caps a day at `MAX_SAMPLES`. Five minutes over 24 hours is 289 samples and a
     * civil day that contains an autumn clock change is 25 hours, so the cap is reached in
     * practice rather than in theory — the step widens to hold it, which is the one place a
     * constant is derived rather than fixed, and `bounds.stepMin` reports what was used.
     */
    const stepMin = span <= 0
        ? settings.stepMin
        : settings.stepMin * Math.max(1, Math.ceil(span / (settings.stepMin * (settings.maxSamples - 1))));

    const grid = [];
    for (let k = 0; k * stepMin < span; k += 1) grid.push(k * stepMin);
    grid.push(span);

    let minY = TRUNK.valence;
    let maxY = TRUNK.valence;
    let minZ = TRUNK.energy;
    let maxZ = TRUNK.energy;
    let maxBranches = 0;

    const samples = grid.map(t => {
        const live = [];
        branches.forEach(branch => {
            if (t < branch.startT || t > branch.endT) return;
            const intensity = intensityAt(branch, t, settings);
            const y = branch.valence * (intensity / MAX_INTENSITY);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            minZ = Math.min(minZ, branch.energy);
            maxZ = Math.max(maxZ, branch.energy);
            live.push({
                feeling: branch.feeling,
                key: branch.key,
                intensity,
                y,
                z: branch.energy,
                uncertain: uncertainAt(branch, t),
                extrapolated: distanceToSupport(branch, t) > settings.confidentMin
            });
        });
        maxBranches = Math.max(maxBranches, live.length);
        return { t, branches: live };
    });

    return {
        samples,
        branches: branches.map(({ tangents, ...branch }) => branch),
        bounds: {
            startT: 0,
            endT: span,
            startAt: firstAt,
            endAt: lastAt,
            stepMin,
            sampleCount: samples.length,
            maxBranches,
            minY,
            maxY,
            minZ,
            maxZ,
            unknownFeelings: [...unknown]
        }
    };
};

/* ------------------------------------------------------------------------------------ */
/* 4. branchPaths                                                                         */
/* ------------------------------------------------------------------------------------ */

/** Accepts a whole curve or a bare samples array, so `branchPaths(samples)` reads as it says. */
const asCurve = (input) => (
    Array.isArray(input)
        ? { samples: input, branches: [] }
        : { samples: input?.samples ?? [], branches: input?.branches ?? [] }
);

/**
 * One path per branch lifetime.
 *
 * The first and last points sit at **trunk valence**, at the branch's own birth and merge
 * minutes rather than at the nearest sample: a branch is born at the check-in that reported
 * it, and rule 2's "two feelings at one moment are two branches leaving the trunk at the same
 * t" is only true if the birth is that moment and not the next multiple of five. A merge point
 * is drawn only when the branch actually reached the trunk — a branch the day ended before, or
 * one an explicit `level` interrupted and a later check-in resumed, never did, and closing it
 * onto the trunk would draw an ending the record does not have.
 *
 * `points` carry a width from the strength at that minute and an opacity from whether that
 * stretch is extrapolated; `segments` splits the path where that opacity changes, because SVG
 * strokes one opacity per `<path>` and the boundary point belongs to both sides or the line
 * shows a gap.
 *
 * Handed a bare samples array it derives the birth and merge minutes from the samples, which
 * is the best available answer: they land on the sampling grid rather than on the check-in.
 */
export const branchPaths = (input) => {
    const { samples, branches } = asCurve(input);
    const byKey = new Map(branches.map(branch => [branch.key, branch]));
    const order = [];
    const points = new Map();

    samples.forEach(sample => {
        (sample.branches ?? []).forEach(entry => {
            const key = entry.key ?? entry.feeling;
            if (!points.has(key)) {
                points.set(key, []);
                order.push(key);
            }
            points.get(key).push({
                t: sample.t,
                y: entry.y,
                z: entry.z,
                intensity: entry.intensity,
                uncertain: entry.uncertain,
                extrapolated: entry.extrapolated,
                width: strokeWidthFor(entry.intensity),
                opacity: entry.extrapolated ? EXTRAPOLATED_OPACITY : 1
            });
        });
    });

    const lastSampleT = samples.length ? samples[samples.length - 1].t : null;

    return order.map(key => {
        const drawn = points.get(key);
        const branch = byKey.get(key) ?? null;
        const feeling = branch?.feeling ?? String(key).split('#')[0];
        const entry = feelingById(feeling);
        const z = drawn[0].z;

        const birthT = branch ? branch.startT : drawn[0].t;
        const merged = branch
            ? branch.merged && branch.endT <= (lastSampleT ?? branch.endT)
            : drawn[drawn.length - 1].t < lastSampleT;
        const mergeT = branch ? branch.endT : drawn[drawn.length - 1].t;

        const birth = { t: birthT, y: TRUNK.valence, z, intensity: 0, extrapolated: drawn[0].extrapolated, width: strokeWidthFor(0), opacity: drawn[0].opacity };
        const merge = merged
            ? { t: mergeT, y: TRUNK.valence, z, intensity: 0, extrapolated: drawn[drawn.length - 1].extrapolated, width: strokeWidthFor(0), opacity: drawn[drawn.length - 1].opacity }
            : null;

        const all = [birth, ...drawn, ...(merge ? [merge] : [])];

        const segments = [];
        all.forEach(point => {
            const tail = segments[segments.length - 1];
            if (!tail || tail.extrapolated !== point.extrapolated) {
                // The boundary point belongs to both runs, or the line breaks where the
                // opacity changes.
                if (tail) segments.push({ extrapolated: point.extrapolated, opacity: point.opacity, points: [tail.points[tail.points.length - 1], point] });
                else segments.push({ extrapolated: point.extrapolated, opacity: point.opacity, points: [point] });
            } else {
                tail.points.push(point);
            }
        });

        return {
            key,
            feeling,
            label: entry?.label ?? null,
            hex: entry?.hex ?? TRUNK.hex,
            dashed: feeling === UNCLEAR_FEELING_ID || all.some(point => point.uncertain === true),
            width: Math.max(...all.map(point => point.width)),
            birth,
            merge,
            merged,
            points: all,
            segments
        };
    });
};

/* ------------------------------------------------------------------------------------ */
/* 5. project                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Degrees, and exactly zero where the answer is zero.
 *
 * `Math.sin(Math.PI)` is 1.2e-16, not 0, which is enough to stop a half-turn being a clean
 * mirror and enough to make "at pitch 0 it is the exact 2-D ribbon" almost-true instead of
 * true. Snapping the rounding dust is what makes those two properties assertable rather than
 * approximate.
 */
const RAD = Math.PI / 180;
const trig = (value) => (Math.abs(value) < 1e-12 ? 0 : value);
const sinDeg = (degrees) => trig(Math.sin(degrees * RAD));
const cosDeg = (degrees) => trig(Math.cos(degrees * RAD));

/**
 * A 2.5-D oblique camera: a point `{ x, y, z }` in graph space to screen `(x, y)` plus the
 * depth painter's ordering sorts on, and the width and opacity multipliers depth implies.
 *
 * `yaw` turns the scene about the vertical axis, so a half-turn mirrors x — the graph read
 * from the other side. `pitch` tilts it, sliding depth up the screen; **at `pitch = 0` this is
 * the identity on x and y**, which is the property that makes the flat ribbon and the tilted
 * drawing the same geometry rather than two implementations. §8.3 calls the flat ribbon the
 * honest fallback and §12.4 leaves open that it is the whole answer; that is only cheap if
 * "flat" is a camera setting rather than a second code path.
 *
 * The depth cues follow the tilt for the same reason: with no tilt there is no depth on
 * screen, so both multipliers are exactly 1 and nothing about the drawing is depth-dependent.
 *
 * Graph space is the caller's to scale. x and z are expected in comparable units and centred
 * on the axis the rotation turns about — the component maps minutes to [-0.5, 0.5] — because a
 * rotation about an axis the data does not straddle swings the whole drawing off screen.
 */
export const project = (point, camera = {}) => {
    const { yaw = 0, pitch = 0, depthScale = 1 } = camera;
    const x = Number(point?.x) || 0;
    const y = Number(point?.y) || 0;
    const z = (Number(point?.z) || 0) * depthScale;

    const cosYaw = cosDeg(yaw);
    const sinYaw = sinDeg(yaw);
    const cosPitch = cosDeg(pitch);
    const sinPitch = sinDeg(pitch);

    const turnedX = x * cosYaw + z * sinYaw;
    const turnedZ = z * cosYaw - x * sinYaw;

    const depth = turnedZ * cosPitch;
    const tilt = Math.abs(sinPitch);
    const nearness = clamp((depth + 1) / 2, 0, 1);

    return {
        x: turnedX,
        y: y - turnedZ * sinPitch,
        depth,
        width: 1 + tilt * DEPTH_WIDTH_GAIN * (nearness * 2 - 1),
        opacity: 1 - tilt * (1 - DEPTH_OPACITY_MIN) * (1 - nearness)
    };
};

/**
 * Painter's order: furthest first, and **stable** for equal depths.
 *
 * Two branches at the same energy have the same depth by construction — energy is fixed per
 * feeling, so any two check-ins of the same feeling do — and a sort that reordered them would
 * make the drawing depend on the engine's sort rather than on the day. Decorating with the
 * index rather than relying on `Array.prototype.sort` being stable makes that a property of
 * this function, which is the one a test can hold.
 */
export const paintersOrder = (items) => (
    (Array.isArray(items) ? items : [])
        .map((item, index) => ({ item, index }))
        .sort((a, b) => (a.item?.depth ?? 0) - (b.item?.depth ?? 0) || (a.index - b.index))
        .map(({ item }) => item)
);

/* ------------------------------------------------------------------------------------ */
/* 6. dayGraphLegend                                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * The distinct feelings a day's samples hold, in order of first appearance.
 *
 * It takes samples, and a sample holds a feeling id, a strength and two coordinates. There is
 * no person, no trigger, no note and no transcript anywhere in its input, so **discretion mode
 * cannot change what it returns** — not because it checks a setting, but because it never had
 * a name to hide. That is the point of it taking samples rather than entries.
 */
export const dayGraphLegend = (input) => {
    const { samples } = asCurve(input);
    const seen = new Map();

    samples.forEach(sample => {
        (sample.branches ?? []).forEach(entry => {
            const id = entry.feeling;
            const known = feelingById(id);
            if (!known) return;
            if (!seen.has(id)) {
                seen.set(id, {
                    id,
                    label: known.label,
                    hex: known.hex,
                    valence: known.valence,
                    energy: known.energy,
                    dashed: id === UNCLEAR_FEELING_ID
                });
            }
            if (entry.uncertain === true) seen.get(id).dashed = true;
        });
    });

    return [...seen.values()];
};
