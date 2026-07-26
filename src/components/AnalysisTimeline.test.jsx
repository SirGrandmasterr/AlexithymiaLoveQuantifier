import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AnalysisTimeline, { makeDotRenderer, buildTimelineData, hasMilestone } from './AnalysisTimeline';
import { CATEGORIES } from '../constants/categories';

const mania = CATEGORIES.find(c => c.id === 'mania');

// The dot renderer is what keeps the chart honest about Phase 2's new states, so it is
// tested directly — inside jsdom Recharts has no layout and never calls it.
describe('makeDotRenderer', () => {
    const renderDot = (props) => makeDotRenderer('mania')({ key: 'k', ...props });

    it('draws a solid dot for an ordinary score', () => {
        const dot = renderDot({ cx: 10, cy: 20, payload: { _uncertain: [] } });
        expect(dot.props.strokeDasharray).toBeUndefined();
        expect(dot.props.stroke).toBe(mania.hex);
    });

    it('draws a dashed dot for a score flagged unsure', () => {
        const dot = renderDot({ cx: 10, cy: 20, payload: { _uncertain: ['mania'] } });
        expect(dot.props.strokeDasharray).toBe('2 2');
    });

    it('draws nothing where the category was skipped', () => {
        const dot = renderDot({ cx: null, cy: null, payload: { _uncertain: [] } });
        expect(dot.type).toBe('g');
    });
});

describe('buildTimelineData', () => {
    it('places every snapshot at its real timestamp, oldest first', () => {
        const { chartData } = buildTimelineData([
            { ID: 2, date: '2026-03-01T00:00:00Z', stats: { eros: 70 } },
            { ID: 1, date: '2026-01-01T00:00:00Z', stats: { eros: 40 } }
        ]);

        expect(chartData.map(p => p.ts)).toEqual([
            new Date('2026-01-01T00:00:00Z').getTime(),
            new Date('2026-03-01T00:00:00Z').getTime()
        ]);
        // A two-month gap must not be reduced to "one step" — that was the old lie.
        expect(chartData[1].ts - chartData[0].ts).toBeGreaterThan(50 * 86400000);
    });

    it('excludes undated snapshots and counts them instead of misplacing them', () => {
        const { chartData, undatedCount } = buildTimelineData([
            { ID: 1, date: '2026-01-01T00:00:00Z', stats: {} },
            { ID: 2, date: null, stats: {} }
        ]);

        expect(chartData).toHaveLength(1);
        expect(undatedCount).toBe(1);
    });

    it('nudges same-day snapshots apart for display only', () => {
        const { chartData } = buildTimelineData([
            { ID: 1, date: '2026-01-01T00:00:00Z', stats: { eros: 10 } },
            { ID: 2, date: '2026-01-01T00:00:00Z', stats: { eros: 20 } }
        ]);

        expect(chartData[1].ts - chartData[0].ts).toBe(12 * 3600 * 1000);
    });

    it('derives markers only from snapshots carrying a note or tags', () => {
        const { markers } = buildTimelineData([
            { ID: 1, date: '2026-01-01T00:00:00Z', stats: {}, tags: [], description: '' },
            { ID: 2, date: '2026-02-01T00:00:00Z', stats: {}, tags: ['conflict'] },
            { ID: 3, date: '2026-03-01T00:00:00Z', stats: {}, description: 'we moved' },
            { ID: 4, date: '2026-04-01T00:00:00Z', stats: {}, description: '   ' }
        ]);

        expect(markers.map(m => m.snapshot.ID)).toEqual([2, 3]);
    });

    it('agrees with hasMilestone', () => {
        expect(hasMilestone({ tags: ['x'] })).toBe(true);
        expect(hasMilestone({ description: 'x' })).toBe(true);
        expect(hasMilestone({ tags: [], description: '  ' })).toBe(false);
    });
});

describe('AnalysisTimeline', () => {
    const versions = [
        { ID: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 }, tags: ['conflict'], description: 'the move' }
    ];

    it('explains the dashed points only when some exist', () => {
        const { container, rerender } = render(<AnalysisTimeline versions={versions} onBack={vi.fn()} />);
        expect(container.textContent).not.toMatch(/Dashed points/);

        rerender(<AnalysisTimeline versions={[{ ...versions[0], uncertain: ['eros'] }]} onBack={vi.fn()} />);
        expect(container.textContent).toMatch(/Dashed points were flagged unsure/);
    });

    it('reports undated snapshots rather than dropping them silently', () => {
        render(<AnalysisTimeline versions={[...versions, { ID: 2, name: 'Alex', date: null, stats: {} }]} onBack={vi.fn()} />);
        expect(screen.getByText(/1 undated snapshot not shown/)).toBeInTheDocument();
    });

    it('offers a comparison selector for the Love Shape', async () => {
        render(<AnalysisTimeline versions={versions} onBack={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'first' })).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(screen.getByRole('button', { name: 'none' }));
        expect(screen.getByRole('button', { name: 'none' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'first' })).toHaveAttribute('aria-pressed', 'false');
    });
});
