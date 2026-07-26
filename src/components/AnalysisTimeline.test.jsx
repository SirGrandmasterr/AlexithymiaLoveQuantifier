import React from 'react';
import { render } from '@testing-library/react';
import AnalysisTimeline, { makeDotRenderer, CATEGORY_COLORS } from './AnalysisTimeline';
import { CATEGORIES_EXPORT } from './Dashboard';

// The dot renderer is what keeps the chart honest about Phase 2's new states, so it is
// tested directly — inside jsdom Recharts has no layout and never calls it.
describe('makeDotRenderer', () => {
    const renderDot = (props) => makeDotRenderer('mania')({ key: 'k', ...props });

    it('draws a solid dot for an ordinary score', () => {
        const dot = renderDot({ cx: 10, cy: 20, payload: { _uncertain: [] } });
        expect(dot.props.strokeDasharray).toBeUndefined();
        expect(dot.props.stroke).toBe(CATEGORY_COLORS.mania);
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

describe('AnalysisTimeline', () => {
    it('explains the dashed points only when some exist', () => {
        const withoutUncertain = [
            { ID: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } }
        ];
        const { container, rerender } = render(
            <AnalysisTimeline versions={withoutUncertain} onBack={vi.fn()} categories={CATEGORIES_EXPORT} />
        );
        expect(container.textContent).not.toMatch(/Dashed points/);

        rerender(
            <AnalysisTimeline
                versions={[{ ...withoutUncertain[0], uncertain: ['eros'] }]}
                onBack={vi.fn()}
                categories={CATEGORIES_EXPORT}
            />
        );
        expect(container.textContent).toMatch(/Dashed points were flagged unsure/);
    });
});
