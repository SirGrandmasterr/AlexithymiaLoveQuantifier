import { FEELINGS, feelingById, FEELING_FAMILIES } from '../../constants/journal';
import { AXES } from './drift';

/* The geometry of the Insights screen's five drawings, as pure functions (invariant 19).
 * Every function takes rows from `observations`/`drift` and returns numbers in a viewBox;
 * `JournalInsights.jsx` is a `map` over what comes back. Colours follow the EmotionGuesser's
 * rule — identity (which series) is categorical, magnitude is one hue, polarity is two.
 */

/** Series colours: eight, in a fixed order, so the same pick keeps its colour across drawings. */
export const SERIES_COLORS = Object.freeze([
    '#334155', // slate-700
    '#e11d48', // rose-600
    '#0f766e', // teal-700
    '#b45309', // amber-700
    '#6d28d9', // violet-700
    '#0369a1', // sky-700
    '#be185d', // pink-700
    '#4d7c0f'  // lime-700
]);

/** At most this many series on one drawing — past it, a plot is a tangle. */
export const MAX_SERIES = SERIES_COLORS.length;

/** Polarity: toward the pleasant / energetic / in-control end, and away from it. */
export const POLARITY = Object.freeze({ toward: '#0f766e', away: '#e11d48' });

/** Magnitude: one hue, the heatmap's. */
export const MAGNITUDE = '#1e293b';

export const seriesColor = (index) => SERIES_COLORS[((index % MAX_SERIES) + MAX_SERIES) % MAX_SERIES];

/** Each axis's range, in the units the constants use. */
export const RANGES = Object.freeze({
    valence: [-1, 1],
    energy: [0, 1],
    dominance: [-1, 1],
    intensity: [0, 1]
});

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const round = (value) => Math.round(value * 100) / 100;

const scale = (value, [low, high], from, to) => from + ((clamp(value, low, high) - low) / (high - low)) * (to - from);

export const pathD = (points) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`)
    .join(' ');

/* 1. The circumplex — valence across, energy up */

export const CIRCUMPLEX = Object.freeze({ width: 640, height: 480, left: 44, right: 16, top: 20, bottom: 40 });

/** Dot radius for a strength on 0…1. */
export const dotRadius = (intensity) => 3 + 7 * clamp(intensity, 0, 1);

export const circumplexLayout = (rows, keys, { smoothed = true, view = CIRCUMPLEX } = {}) => {
    const plotX = (valence) => scale(valence, RANGES.valence, view.left, view.width - view.right);
    const plotY = (energy) => scale(energy, RANGES.energy, view.height - view.bottom, view.top);

    const anchors = FEELINGS.filter(feeling => feeling.family !== null && !feeling.retired).map(feeling => ({
        id: feeling.id,
        label: feeling.label,
        x: round(plotX(feeling.valence)),
        y: round(plotY(feeling.energy))
    }));

    const series = keys.map((key, index) => {
        const group = rows.filter(row => row.key === key).sort((a, b) => a.at - b.at);
        const useSmoothed = smoothed && group.every(row => Number.isFinite(row.ewma_valence));
        const points = group.map(row => ({
            x: round(plotX(useSmoothed ? row.ewma_valence : row.valence)),
            y: round(plotY(useSmoothed ? row.ewma_energy : row.energy)),
            r: round(dotRadius(row.intensity)),
            at: row.at,
            day: row.day,
            feelingId: row.feelingId,
            intensity: row.intensity,
            entryId: row.entryId
        }));
        return {
            key,
            label: group[0]?.label ?? key,
            kind: group[0]?.kind ?? null,
            color: seriesColor(index),
            points,
            path: pathD(points),
            last: points[points.length - 1] ?? null
        };
    }).filter(entry => entry.points.length > 0);

    return {
        view,
        anchors,
        series,
        axes: {
            xLine: { x1: view.left, x2: view.width - view.right, y: round(plotY(RANGES.energy[0])) },
            yLine: { y1: view.top, y2: view.height - view.bottom, x: round(plotX(0)) },
            midY: round(plotY(0.5))
        }
    };
};

/* 2. Drift bars — signed, one per key */

export const DRIFT_BARS = Object.freeze({ width: 640, rowHeight: 26, labelWidth: 200, gap: 8, top: 12, bottom: 24 });

export const driftBarsLayout = (summary, axis = 'valence', { view = DRIFT_BARS } = {}) => {
    const sorted = [...summary]
        .filter(row => Number.isFinite(row.drift?.[axis]))
        .sort((a, b) => a.drift[axis] - b.drift[axis]);
    const plotLeft = view.labelWidth;
    const plotRight = view.width - view.gap;
    const center = (plotLeft + plotRight) / 2;
    const halfWidth = (plotRight - plotLeft) / 2;
    const extent = Math.max(0.05, ...sorted.map(row => Math.abs(row.drift[axis])));

    const bars = sorted.map((row, index) => {
        const value = row.drift[axis];
        const length = (Math.abs(value) / extent) * halfWidth;
        return {
            key: row.key,
            label: row.label,
            kind: row.kind,
            value: round(value),
            count: row.count,
            dominantFeeling: row.dominantFeeling,
            y: view.top + index * view.rowHeight,
            height: view.rowHeight - 6,
            x: round(value < 0 ? center - length : center),
            width: round(length),
            color: value < 0 ? POLARITY.away : POLARITY.toward,
            polarity: value < 0 ? 'away' : 'toward'
        };
    });

    return {
        view: { ...view, height: view.top + bars.length * view.rowHeight + view.bottom },
        center: round(center),
        extent: round(extent),
        bars
    };
};

/* 3. One series over time */

export const TIMESERIES = Object.freeze({ width: 640, height: 220, left: 44, right: 16, top: 16, bottom: 32 });

export const timeseriesLayout = (rows, key, dim = 'valence', { view = TIMESERIES } = {}) => {
    const group = rows.filter(row => row.key === key).sort((a, b) => a.at - b.at);
    if (group.length === 0) return { view, points: [], line: '', ticks: [], zeroY: null, range: RANGES[dim] };

    const range = RANGES[dim] ?? RANGES.valence;
    const first = group[0].at;
    const last = group[group.length - 1].at;
    const span = Math.max(1, last - first);
    const plotX = (at) => view.left + ((at - first) / span) * (view.width - view.left - view.right);
    const plotY = (value) => scale(value, range, view.height - view.bottom, view.top);

    const points = group.map(row => ({
        x: round(plotX(row.at)),
        y: round(plotY(row[dim])),
        r: round(dotRadius(row.intensity)),
        at: row.at,
        day: row.day,
        feelingId: row.feelingId,
        value: round(row[dim]),
        quote: row.quote ?? null
    }));
    const smoothedPoints = group
        .filter(row => Number.isFinite(row[`ewma_${dim}`]))
        .map(row => ({ x: round(plotX(row.at)), y: round(plotY(row[`ewma_${dim}`])) }));

    const ticks = [];
    const tickCount = Math.min(4, group.length);
    for (let i = 0; i < tickCount; i += 1) {
        const at = first + (span * i) / Math.max(1, tickCount - 1);
        ticks.push({ x: round(plotX(at)), at });
    }

    return {
        view,
        range,
        points,
        line: pathD(smoothedPoints),
        ticks,
        zeroY: range[0] < 0 ? round(plotY(0)) : null,
        topY: round(plotY(range[1])),
        bottomY: round(plotY(range[0]))
    };
};

/* 4. The heatmap */

export const HEATMAP = Object.freeze({ cell: 22, labelWidth: 160, headerHeight: 78, gap: 2 });

export const heatmapLayout = (matrix, { view = HEATMAP } = {}) => {
    const columns = matrix.feelings.map((id, index) => ({
        id,
        label: feelingById(id)?.label ?? id,
        hex: feelingById(id)?.hex ?? '#94a3b8',
        x: view.labelWidth + index * view.cell
    }));
    const rows = matrix.keys.map((entry, rowIndex) => ({
        key: entry.key,
        label: entry.label,
        kind: entry.kind,
        y: view.headerHeight + rowIndex * view.cell,
        cells: matrix.feelings.map((id, columnIndex) => {
            const value = matrix.cells[rowIndex][columnIndex];
            return {
                feelingId: id,
                x: columns[columnIndex].x,
                value: round(value),
                opacity: matrix.max > 0 ? round(0.08 + 0.92 * (value / matrix.max)) : 0,
                empty: value === 0
            };
        })
    }));

    return {
        view: {
            ...view,
            width: view.labelWidth + columns.length * view.cell + view.gap,
            height: view.headerHeight + rows.length * view.cell + view.gap
        },
        columns,
        rows
    };
};

/* 5. The weeks, as three small multiples */

export const WEEKLY = Object.freeze({ width: 640, stripHeight: 70, left: 44, right: 16, gap: 14 });

export const weeklyLayout = (weeks, { view = WEEKLY } = {}) => {
    const count = weeks.length;
    const plotX = (index) => (count <= 1
        ? (view.left + view.width - view.right) / 2
        : view.left + (index / (count - 1)) * (view.width - view.left - view.right));

    const strips = AXES.map((axis, stripIndex) => {
        const top = stripIndex * (view.stripHeight + view.gap);
        const range = RANGES[axis];
        const plotY = (value) => scale(value, range, top + view.stripHeight - 6, top + 6);
        const points = weeks.map((week, index) => ({
            x: round(plotX(index)),
            y: round(plotY(week[axis])),
            week: week.week,
            value: round(week[axis]),
            count: week.count
        }));
        return {
            axis,
            color: seriesColor(stripIndex),
            top,
            bottom: top + view.stripHeight,
            zeroY: range[0] < 0 ? round(plotY(0)) : round(plotY(range[0])),
            points,
            line: pathD(points)
        };
    });

    return {
        view: { ...view, height: AXES.length * view.stripHeight + (AXES.length - 1) * view.gap },
        strips,
        ticks: weeks.map((week, index) => ({ x: round(plotX(index)), week: week.week })).filter((tick, index, all) => (
            all.length <= 6 || index % Math.ceil(all.length / 6) === 0 || index === all.length - 1
        ))
    };
};

/* 6. The family radar */

export const RADAR = Object.freeze({ size: 260, radius: 96, rings: 3 });

export const radarLayout = (profile, { view = RADAR } = {}) => {
    const center = view.size / 2;
    const max = Math.max(0, ...profile.map(entry => entry.total));
    const families = FEELING_FAMILIES.map((family, index) => {
        const angle = -Math.PI / 2 + (index / FEELING_FAMILIES.length) * Math.PI * 2;
        const total = profile.find(entry => entry.family === family)?.total ?? 0;
        const fraction = max > 0 ? total / max : 0;
        return {
            family,
            total: round(total),
            angle,
            axisX: round(center + Math.cos(angle) * view.radius),
            axisY: round(center + Math.sin(angle) * view.radius),
            labelX: round(center + Math.cos(angle) * (view.radius + 22)),
            labelY: round(center + Math.sin(angle) * (view.radius + 22)),
            x: round(center + Math.cos(angle) * view.radius * fraction),
            y: round(center + Math.sin(angle) * view.radius * fraction)
        };
    });
    const rings = Array.from({ length: view.rings }, (unused, index) => (
        round(view.radius * ((index + 1) / view.rings))
    ));

    return {
        view,
        center,
        max: round(max),
        families,
        rings,
        polygon: families.map(entry => `${entry.x},${entry.y}`).join(' ')
    };
};
