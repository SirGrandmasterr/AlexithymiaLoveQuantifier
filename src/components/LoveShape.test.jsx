import React from 'react';
import { render, screen } from '@testing-library/react';
import LoveShape, { buildShapeData, ShapeDot } from './LoveShape';
import { CATEGORIES } from '../constants/categories';

const snapshot = {
    ID: 1,
    name: 'Alex',
    stats: { eros: 80, mania: 30 },       // the other five were skipped
    uncertain: ['mania']
};

describe('buildShapeData', () => {
    it('produces one row per category, in the taxonomy order', () => {
        const data = buildShapeData(snapshot);
        expect(data.map(row => row.id)).toEqual(CATEGORIES.map(cat => cat.id));
    });

    it('marks an unscored category as unscored rather than as a zero reading', () => {
        const data = buildShapeData(snapshot);
        const ludus = data.find(row => row.id === 'ludus');

        expect(ludus.scored).toBe(false);
        expect(ludus.value).toBe(0);   // geometry only — the marker and tooltip say "not scored"
    });

    it('distinguishes a genuine zero from a skip', () => {
        const data = buildShapeData({ stats: { eros: 0 } });
        expect(data.find(row => row.id === 'eros')).toMatchObject({ scored: true, value: 0 });
        expect(data.find(row => row.id === 'ludus')).toMatchObject({ scored: false });
    });

    it('carries the unsure flag through', () => {
        const data = buildShapeData(snapshot);
        expect(data.find(row => row.id === 'mania').uncertain).toBe(true);
        expect(data.find(row => row.id === 'eros').uncertain).toBe(false);
    });

    it('only builds a comparison series when there is something to compare with', () => {
        expect(buildShapeData(snapshot).every(row => row.compare === null)).toBe(true);

        const compared = buildShapeData(snapshot, { stats: { eros: 50 } });
        expect(compared.find(row => row.id === 'eros')).toMatchObject({ compare: 50, compareScored: true });
        expect(compared.find(row => row.id === 'ludus')).toMatchObject({ compare: 0, compareScored: false });
    });
});

describe('ShapeDot', () => {
    const dotFor = (payload) => ShapeDot({ key: 'k', cx: 5, cy: 5, payload });

    it('fills a vertex that carries a score', () => {
        const dot = dotFor({ scored: true, uncertain: false, hex: '#fb7185' });
        expect(dot.props.fill).toBe('#fb7185');
        expect(dot.props.strokeDasharray).toBeUndefined();
    });

    it('leaves an unscored vertex open and dashed', () => {
        const dot = dotFor({ scored: false, uncertain: false, hex: '#fb7185' });
        expect(dot.props.fill).toBe('#fff');
        expect(dot.props.strokeDasharray).toBe('2 2');
    });

    it('dashes an unsure vertex while keeping it filled', () => {
        const dot = dotFor({ scored: true, uncertain: true, hex: '#fb7185' });
        expect(dot.props.fill).toBe('#fb7185');
        expect(dot.props.strokeDasharray).toBe('2 2');
    });
});

describe('LoveShape', () => {
    it('renders a shape container for a snapshot', () => {
        render(<LoveShape snapshot={snapshot} />);
        expect(screen.getByTestId('love-shape')).toBeInTheDocument();
    });

    it('renders nothing without a snapshot', () => {
        const { container } = render(<LoveShape snapshot={null} />);
        expect(container).toBeEmptyDOMElement();
    });
});
