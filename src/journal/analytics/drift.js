import { FEELINGS, FEELING_FAMILIES, feelingById, readCheckin } from '../../constants/journal';
import { levelOf } from './observations';

/* The EmotionGuesser's `drift.py`, computed on read.
 *
 * Everything is keyed on `key` (see `atLevel`). Per key, in time order:
 *   d_<dim>            the delta to the previous observation of the same key
 *   ewma_<dim>         an exponentially weighted moving average, newest counting most
 *   slope_<dim>        a least-squares slope over a trailing window, in units per 30 days
 *   distanceFromFirst  Euclidean distance in (valence, energy, dominance) from the first
 *
 * Every number is a drawing choice about what was recorded, not a claim about the person —
 * the constants are stated here and read into the Insights screen's ⓘ.
 */

export const DIMS = ['valence', 'energy', 'dominance', 'intensity'];

/** The three coordinate axes — `intensity` is a weight, not a position. */
export const AXES = ['valence', 'energy', 'dominance'];

/** After this many further observations, an older one counts half. */
export const EWMA_HALFLIFE = 3;

/** How many trailing observations a slope is fitted over. */
export const SLOPE_WINDOW = 6;

/** The unit a slope is reported in: change per this many days. */
export const SLOPE_DAYS = 30;

const MS_PER_DAY = 86400000;

const byTime = (a, b) => (a.at - b.at) || String(a.entryId).localeCompare(String(b.entryId));

const groupByKey = (rows) => {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (!groups.has(row.key)) groups.set(row.key, []);
        groups.get(row.key).push(row);
    });
    groups.forEach(group => group.sort(byTime));
    return groups;
};

/** pandas' `ewm(halflife, adjust=True).mean()` at every position: weights (1−α)^age, normalised. */
export const ewma = (values, halflife = EWMA_HALFLIFE) => {
    const alpha = 1 - Math.exp(Math.log(0.5) / halflife);
    const out = [];
    values.forEach((value, index) => {
        let numerator = 0;
        let denominator = 0;
        for (let i = 0; i <= index; i += 1) {
            const weight = Math.pow(1 - alpha, index - i);
            numerator += weight * values[i];
            denominator += weight;
        }
        out.push(denominator === 0 ? value : numerator / denominator);
    });
    return out;
};

/** Least-squares slope of `ys` over `xs` (days), or null with fewer than two distinct x. */
export const slope = (xs, ys) => {
    const n = xs.length;
    if (n < 2) return null;
    const meanX = xs.reduce((sum, x) => sum + x, 0) / n;
    const meanY = ys.reduce((sum, y) => sum + y, 0) / n;
    let covariance = 0;
    let variance = 0;
    for (let i = 0; i < n; i += 1) {
        covariance += (xs[i] - meanX) * (ys[i] - meanY);
        variance += (xs[i] - meanX) * (xs[i] - meanX);
    }
    return variance === 0 ? null : covariance / variance;
};

export const addSmoothing = (rows, { halflife = EWMA_HALFLIFE, window = SLOPE_WINDOW } = {}) => {
    const out = [];

    groupByKey(rows).forEach((group) => {
        const first = group[0];
        const days = group.map(row => (row.at - first.at) / MS_PER_DAY);
        const smoothed = {};
        DIMS.forEach((dim) => { smoothed[dim] = ewma(group.map(row => row[dim]), halflife); });

        group.forEach((row, index) => {
            const extended = { ...row };
            DIMS.forEach((dim) => {
                extended[`d_${dim}`] = index === 0 ? null : row[dim] - group[index - 1][dim];
                extended[`ewma_${dim}`] = smoothed[dim][index];
                const from = Math.max(0, index - window + 1);
                const fitted = slope(days.slice(from, index + 1), group.slice(from, index + 1).map(entry => entry[dim]));
                extended[`slope_${dim}`] = fitted === null ? null : fitted * SLOPE_DAYS;
            });
            extended.distanceFromFirst = Math.sqrt(
                AXES.reduce((sum, axis) => sum + (row[axis] - first[axis]) ** 2, 0)
            );
            out.push(extended);
        });
    });

    return out.sort(byTime);
};

const FEELING_ORDER = new Map(FEELINGS.map((feeling, index) => [feeling.id, index]));

/** The feeling named most often, ties to whichever comes first in the list — `topFeelings`' rule. */
export const dominantFeeling = (rows) => {
    const counts = new Map();
    rows.forEach(row => counts.set(row.feelingId, (counts.get(row.feelingId) ?? 0) + 1));
    return [...counts.entries()]
        .sort(([aId, aCount], [bId, bCount]) => (
            (bCount - aCount) || ((FEELING_ORDER.get(aId) ?? Infinity) - (FEELING_ORDER.get(bId) ?? Infinity))
        ))[0]?.[0] ?? null;
};

/** One row per key: counts, the smoothed position now, and how far it has moved since the first time. */
export const triggerSummary = (rows, { minObs = 2 } = {}) => {
    const smoothed = addSmoothing(rows);
    const summaries = [];

    groupByKey(smoothed).forEach((group, key) => {
        if (group.length < minObs) return;
        const first = group[0];
        const last = group[group.length - 1];
        const now = {};
        const drift = {};
        const slope30 = {};
        AXES.forEach((axis) => {
            now[axis] = last[`ewma_${axis}`];
            drift[axis] = last[`ewma_${axis}`] - first[axis];
            slope30[axis] = last[`slope_${axis}`];
        });

        summaries.push({
            key,
            label: last.label,
            kind: last.kind,
            parts: last.parts ?? null,
            count: group.length,
            firstAt: first.at,
            lastAt: last.at,
            dominantFeeling: dominantFeeling(group),
            meanIntensity: group.reduce((sum, row) => sum + row.intensity, 0) / group.length,
            now,
            drift,
            slope30,
            distance: last.distanceFromFirst
        });
    });

    return summaries.sort((a, b) => (b.count - a.count) || String(a.label).localeCompare(String(b.label)));
};

/* Weekly mood */

const pad2 = (value) => String(value).padStart(2, '0');

/** The Monday a local instant falls in, as `YYYY-MM-DD`. */
export const weekOf = (at) => {
    const date = new Date(at);
    const weekday = (date.getDay() + 6) % 7;
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday);
    return `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
};

/** A check-in's own position: its feelings' coordinates, weighted by strength. Null with no known feeling. */
export const entryPosition = (entry) => {
    if (entry?.kind !== 'checkin') return null;
    const at = new Date(entry.at).getTime();
    if (Number.isNaN(at)) return null;

    let weight = 0;
    const sums = { valence: 0, energy: 0, dominance: 0 };
    readCheckin(entry.payload).feelings.forEach((feeling) => {
        const known = feelingById(feeling.id);
        if (!known) return;
        const level = levelOf(feeling.intensity);
        weight += level;
        AXES.forEach((axis) => { sums[axis] += level * known[axis]; });
    });
    if (weight === 0) return null;

    const position = { at };
    AXES.forEach((axis) => { position[axis] = sums[axis] / weight; });
    return position;
};

/** One row per week with something in it: the mean of that week's check-in positions. */
export const weeklyMood = (entries) => {
    const weeks = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        const position = entryPosition(entry);
        if (!position) return;
        const week = weekOf(position.at);
        if (!weeks.has(week)) weeks.set(week, { week, count: 0, valence: 0, energy: 0, dominance: 0 });
        const row = weeks.get(week);
        row.count += 1;
        AXES.forEach((axis) => { row[axis] += position[axis]; });
    });

    return [...weeks.values()]
        .map(row => ({ ...row, valence: row.valence / row.count, energy: row.energy / row.count, dominance: row.dominance / row.count }))
        .sort((a, b) => a.week.localeCompare(b.week));
};

/* Heatmap and radar */

/** Key × feeling, summed strength, for the `topN` most-named keys. Feelings in list order. */
export const labelHeatmap = (rows, { topN = 15 } = {}) => {
    const counts = new Map();
    const labels = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        counts.set(row.key, (counts.get(row.key) ?? 0) + 1);
        labels.set(row.key, { key: row.key, label: row.label, kind: row.kind });
    });
    const keys = [...counts.entries()]
        .sort(([aKey, aCount], [bKey, bCount]) => (bCount - aCount) || String(labels.get(aKey).label).localeCompare(String(labels.get(bKey).label)))
        .slice(0, topN)
        .map(([key]) => labels.get(key));
    const kept = new Set(keys.map(entry => entry.key));

    const present = new Set();
    const totals = new Map();
    rows.forEach((row) => {
        if (!kept.has(row.key)) return;
        present.add(row.feelingId);
        const cell = `${row.key}#${row.feelingId}`;
        totals.set(cell, (totals.get(cell) ?? 0) + row.intensity);
    });
    const feelings = FEELINGS.map(feeling => feeling.id).filter(id => present.has(id));

    return {
        keys,
        feelings,
        cells: keys.map(entry => feelings.map(id => totals.get(`${entry.key}#${id}`) ?? 0)),
        max: Math.max(0, ...totals.values())
    };
};

/** Summed strength per family, in the fixed family order. `unclear` belongs to none. */
export const familyProfile = (rows) => {
    const totals = new Map(FEELING_FAMILIES.map(family => [family, 0]));
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const family = feelingById(row.feelingId)?.family;
        if (family && totals.has(family)) totals.set(family, totals.get(family) + row.intensity);
    });
    return FEELING_FAMILIES.map(family => ({ family, total: totals.get(family) }));
};
