import { describe, it, expect } from 'vitest';
import {
    CIRCUMPLEX,
    DRIFT_BARS,
    MAX_SERIES,
    POLARITY,
    RANGES,
    SERIES_COLORS,
    circumplexLayout,
    dotRadius,
    driftBarsLayout,
    heatmapLayout,
    pathD,
    radarLayout,
    seriesColor,
    timeseriesLayout,
    weeklyLayout
} from './charts';
import { addSmoothing, familyProfile, labelHeatmap, triggerSummary, weeklyMood } from './drift';
import { atLevel, observationsOf } from './observations';
import { FEELINGS, FEELING_FAMILIES } from '../../constants/journal';

const LUCIE = 5;
const MEETING = 'trg-meeting';
const resolveTrigger = () => ({ live: MEETING, label: 'meeting', role: 'interaction' });
const personName = () => 'Lucie';

let nextId = 1;
const checkin = (day, id, intensity) => ({
    ID: nextId++,
    client_id: `c-${nextId}`,
    kind: 'checkin',
    day,
    at: `${day}T10:00:00Z`,
    payload: { v: 1, feelings: [{ id, intensity, about: [{ kind: 'person', ref: 0 }, { kind: 'trigger', trigger: MEETING }] }] },
    mentions: [{ ref: 0, relationship_id: LUCIE, label: '' }]
});

const entries = [
    checkin('2026-08-01', 'affection', 2),
    checkin('2026-08-05', 'sadness', 3),
    checkin('2026-08-11', 'anxiety', 1)
];
const rows = () => addSmoothing(atLevel(observationsOf(entries, { resolveTrigger, personName }), 'person'));
const KEY = `person:${LUCIE}`;

describe('colours', () => {
    it('gives every series a fixed colour, wrapping past the eighth, and two for polarity', () => {
        expect(SERIES_COLORS).toHaveLength(MAX_SERIES);
        expect(seriesColor(0)).toBe(SERIES_COLORS[0]);
        expect(seriesColor(MAX_SERIES)).toBe(SERIES_COLORS[0]);
        expect(seriesColor(-1)).toBe(SERIES_COLORS[MAX_SERIES - 1]);
        [POLARITY.toward, POLARITY.away, ...SERIES_COLORS].forEach(hex => expect(hex).toMatch(/^#[0-9a-f]{6}$/));
    });
});

describe('circumplexLayout', () => {
    const layout = circumplexLayout(rows(), [KEY]);

    it('places every feeling anchor inside the plot, and a series as a path of dots sized by strength', () => {
        expect(layout.anchors).toHaveLength(FEELINGS.filter(feeling => feeling.family !== null).length);
        layout.anchors.forEach(anchor => {
            expect(anchor.x).toBeGreaterThanOrEqual(CIRCUMPLEX.left);
            expect(anchor.x).toBeLessThanOrEqual(CIRCUMPLEX.width - CIRCUMPLEX.right);
            expect(anchor.y).toBeGreaterThanOrEqual(CIRCUMPLEX.top);
            expect(anchor.y).toBeLessThanOrEqual(CIRCUMPLEX.height - CIRCUMPLEX.bottom);
        });
        expect(layout.series).toHaveLength(1);
        expect(layout.series[0].points).toHaveLength(3);
        expect(layout.series[0].path).toMatch(/^M[\d.]+ [\d.]+ L/);
        expect(layout.series[0].last).toEqual(layout.series[0].points[2]);
        expect(dotRadius(1)).toBeGreaterThan(dotRadius(1 / 3));
        expect(layout.series[0].points[1].r).toBeGreaterThan(layout.series[0].points[2].r);
    });

    it('draws pleasant to the right and energetic upward', () => {
        const raw = circumplexLayout(rows(), [KEY], { smoothed: false });
        const [affection, sadness] = raw.series[0].points;
        expect(affection.x).toBeGreaterThan(sadness.x);
        expect(affection.y).toBeLessThan(sadness.y);
    });

    it('uses the smoothed position by default and the recorded one when asked', () => {
        const smoothed = circumplexLayout(rows(), [KEY]);
        const raw = circumplexLayout(rows(), [KEY], { smoothed: false });
        expect(smoothed.series[0].points[0]).toEqual(raw.series[0].points[0]);
        expect(smoothed.series[0].points[1].x).not.toBe(raw.series[0].points[1].x);
    });

    it('draws nothing for a key it has no rows for', () => {
        expect(circumplexLayout(rows(), ['person:404']).series).toEqual([]);
    });
});

describe('driftBarsLayout', () => {
    it('draws one signed bar per key, sorted, coloured by polarity, and grows with the rows', () => {
        const summary = triggerSummary(rows());
        const layout = driftBarsLayout(summary, 'valence');
        expect(layout.bars).toHaveLength(1);
        const bar = layout.bars[0];
        expect(bar.polarity).toBe('away');
        expect(bar.color).toBe(POLARITY.away);
        expect(bar.x + bar.width).toBeCloseTo(layout.center, 5);
        expect(layout.view.height).toBe(DRIFT_BARS.top + DRIFT_BARS.rowHeight + DRIFT_BARS.bottom);
        expect(driftBarsLayout([], 'valence').bars).toEqual([]);
    });

    it('draws a move toward pleasant to the right of the centre', () => {
        const layout = driftBarsLayout([{ key: 'k', label: 'k', kind: 'trigger', count: 2, drift: { valence: 0.4 }, dominantFeeling: 'joy' }], 'valence');
        expect(layout.bars[0].polarity).toBe('toward');
        expect(layout.bars[0].x).toBeCloseTo(layout.center, 5);
        expect(layout.bars[0].width).toBeGreaterThan(0);
    });
});

describe('timeseriesLayout', () => {
    it('places dots in time order on the chosen axis, with a smoothed line and a zero line where the axis has one', () => {
        const layout = timeseriesLayout(rows(), KEY, 'valence');
        expect(layout.points).toHaveLength(3);
        expect(layout.points[0].x).toBeLessThan(layout.points[2].x);
        expect(layout.line).toMatch(/^M/);
        expect(layout.zeroY).not.toBeNull();
        expect(layout.range).toEqual(RANGES.valence);
        expect(layout.points[0].quote).toBeNull();
    });

    it('has no zero line on an axis that starts at zero, and is empty for an unknown key', () => {
        expect(timeseriesLayout(rows(), KEY, 'energy').zeroY).toBeNull();
        expect(timeseriesLayout(rows(), KEY, 'intensity').range).toEqual([0, 1]);
        expect(timeseriesLayout(rows(), 'nope', 'valence').points).toEqual([]);
    });
});

describe('heatmapLayout', () => {
    it('lays out a column per feeling present and a row per key, with an opacity by magnitude', () => {
        const layout = heatmapLayout(labelHeatmap(rows()));
        expect(layout.columns.map(column => column.id)).toEqual(['sadness', 'anxiety', 'affection']);
        expect(layout.rows).toHaveLength(1);
        const cells = layout.rows[0].cells;
        expect(cells.find(cell => cell.feelingId === 'sadness').opacity).toBe(1);
        expect(cells.find(cell => cell.feelingId === 'anxiety').opacity).toBeLessThan(1);
        expect(cells.every(cell => !cell.empty)).toBe(true);
        expect(layout.view.width).toBeGreaterThan(layout.view.labelWidth);
    });
});

describe('weeklyLayout', () => {
    it('draws three strips, one per axis, with a point per week', () => {
        // 1 August is a Saturday, so the three check-ins fall in three different weeks.
        const layout = weeklyLayout(weeklyMood(entries));
        expect(layout.strips.map(strip => strip.axis)).toEqual(['valence', 'energy', 'dominance']);
        layout.strips.forEach(strip => {
            expect(strip.points).toHaveLength(3);
            expect(strip.line).toMatch(/^M/);
        });
        expect(layout.ticks).toHaveLength(3);
        expect(layout.strips[1].top).toBeGreaterThan(layout.strips[0].bottom);
    });

    it('centres a single week rather than dividing by zero', () => {
        const layout = weeklyLayout(weeklyMood(entries.slice(0, 1)));
        expect(Number.isFinite(layout.strips[0].points[0].x)).toBe(true);
    });
});

describe('radarLayout', () => {
    it('places one axis per family, a polygon scaled to the largest total, and rings', () => {
        const layout = radarLayout(familyProfile(rows()));
        expect(layout.families.map(family => family.family)).toEqual(FEELING_FAMILIES);
        expect(layout.rings).toHaveLength(3);
        expect(layout.max).toBeGreaterThan(0);
        const biggest = layout.families.reduce((best, family) => (family.total > best.total ? family : best));
        const reach = Math.hypot(biggest.x - layout.center, biggest.y - layout.center);
        expect(reach).toBeCloseTo(layout.view.radius, 0);
        expect(layout.polygon.split(' ')).toHaveLength(FEELING_FAMILIES.length);
    });

    it('collapses to the centre with nothing in it', () => {
        const layout = radarLayout(familyProfile([]));
        expect(layout.max).toBe(0);
        layout.families.forEach(family => {
            expect(family.x).toBe(layout.center);
            expect(family.y).toBe(layout.center);
        });
    });
});

describe('pathD', () => {
    it('writes a move then lines, rounded to two decimals', () => {
        expect(pathD([{ x: 1.234, y: 2 }, { x: 3.333, y: 4.446 }])).toBe('M1.23 2 L3.33 4.45');
        expect(pathD([])).toBe('');
    });
});
