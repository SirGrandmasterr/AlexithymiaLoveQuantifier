import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WhatChanged, {
    computeDeltas,
    findPreviousVersion,
    elapsedSentence,
    STEADY_THRESHOLD
} from './WhatChanged';
import { CATEGORIES_EXPORT } from './Dashboard';

const categories = CATEGORIES_EXPORT;

const snapshot = (overrides) => ({
    ID: 1, relationship_id: 1, name: 'Alex', date: '2026-03-01T00:00:00Z', stats: {}, uncertain: [], tags: [], description: '',
    ...overrides
});

describe('computeDeltas', () => {
    it('orders movements by size, largest first', () => {
        const previous = snapshot({ ID: 1, stats: { eros: 50, mania: 20, storge: 60 } });
        const current = snapshot({ ID: 2, stats: { eros: 60, mania: 70, storge: 40 } });

        const { moved } = computeDeltas(current, previous, categories);

        expect(moved.map(r => [r.category.id, r.delta])).toEqual([
            ['mania', 50],
            ['storge', -20],
            ['eros', 10]
        ]);
    });

    it('collapses movements below the steady threshold', () => {
        const previous = snapshot({ ID: 1, stats: { eros: 50, ludus: 30, agape: 10 } });
        const current = snapshot({ ID: 2, stats: { eros: 54, ludus: 30, agape: 40 } });

        const { moved, steady } = computeDeltas(current, previous, categories);

        expect(moved.map(r => r.category.id)).toEqual(['agape']);
        expect(steady.map(r => r.category.id)).toEqual(['eros', 'ludus']);
        expect(STEADY_THRESHOLD).toBe(5);
    });

    it('treats a category missing on either side as not comparable', () => {
        const previous = snapshot({ ID: 1, stats: { eros: 50, ludus: 20 } });
        const current = snapshot({ ID: 2, stats: { eros: 80, mania: 40 } });

        const { moved, notComparable } = computeDeltas(current, previous, categories);

        expect(moved.map(r => r.category.id)).toEqual(['eros']);
        expect(notComparable.map(c => c.id)).toContain('ludus');
        expect(notComparable.map(c => c.id)).toContain('mania');
    });

    it('marks a comparison uncertain when either side was flagged unsure', () => {
        const previous = snapshot({ ID: 1, stats: { eros: 50, mania: 10 }, uncertain: ['eros'] });
        const current = snapshot({ ID: 2, stats: { eros: 80, mania: 40 }, uncertain: [] });

        const { moved } = computeDeltas(current, previous, categories);

        expect(moved.find(r => r.category.id === 'eros').uncertain).toBe(true);
        expect(moved.find(r => r.category.id === 'mania').uncertain).toBe(false);
    });

    it('does not confuse a score of zero with a skipped category', () => {
        const previous = snapshot({ ID: 1, stats: { eros: 0 } });
        const current = snapshot({ ID: 2, stats: { eros: 30 } });

        const { moved, notComparable } = computeDeltas(current, previous, categories);

        expect(moved.map(r => r.category.id)).toEqual(['eros']);
        expect(notComparable.map(c => c.id)).not.toContain('eros');
    });
});

describe('findPreviousVersion', () => {
    const current = snapshot({ ID: 3, date: '2026-03-01T00:00:00Z' });

    it('picks the most recent snapshot of the same stack dated at or before it', () => {
        const all = [
            snapshot({ ID: 1, date: '2026-01-01T00:00:00Z' }),
            snapshot({ ID: 2, date: '2026-02-01T00:00:00Z' }),
            current
        ];
        expect(findPreviousVersion(current, all).ID).toBe(2);
    });

    it('ignores other people entirely', () => {
        const all = [snapshot({ ID: 9, relationship_id: 2, name: 'Sam', date: '2026-02-20T00:00:00Z' }), current];
        expect(findPreviousVersion(current, all)).toBeNull();
    });

    it('matches on the relationship, not the name', () => {
        // Two stacks may share a display name since Phase 4; comparing across them would
        // be comparing two different people.
        const namesake = snapshot({ ID: 9, relationship_id: 2, name: 'Alex', date: '2026-02-20T00:00:00Z' });
        expect(findPreviousVersion(current, [namesake, current])).toBeNull();
    });

    it('returns nothing when the new snapshot predates everything else', () => {
        const backdated = snapshot({ ID: 3, date: '2020-01-01T00:00:00Z' });
        const all = [snapshot({ ID: 1, date: '2026-01-01T00:00:00Z' }), backdated];
        expect(findPreviousVersion(backdated, all)).toBeNull();
    });

    it('falls back to the most recently created undated snapshot', () => {
        const all = [
            snapshot({ ID: 1, date: null }),
            snapshot({ ID: 2, date: null }),
            current
        ];
        expect(findPreviousVersion(current, all).ID).toBe(2);
    });
});

describe('elapsedSentence', () => {
    const at = (date) => snapshot({ date });

    it('scales the unit to the gap', () => {
        expect(elapsedSentence(at('2026-03-01'), at('2026-03-02'), 'Alex')).toBe('1 day since your last snapshot of Alex.');
        expect(elapsedSentence(at('2026-03-01'), at('2026-03-08'), 'Alex')).toBe('7 days since your last snapshot of Alex.');
        expect(elapsedSentence(at('2026-01-01'), at('2026-03-19'), 'Alex')).toBe('11 weeks since your last snapshot of Alex.');
        expect(elapsedSentence(at('2026-01-01'), at('2026-07-01'), 'Alex')).toBe('6 months since your last snapshot of Alex.');
        expect(elapsedSentence(at('2020-01-01'), at('2026-01-01'), 'Alex')).toBe('6 years since your last snapshot of Alex.');
    });

    it('handles same-day and undated snapshots without inventing a duration', () => {
        expect(elapsedSentence(at('2026-03-01'), at('2026-03-01'), 'Alex')).toBe('Another snapshot of Alex, the same day as the last one.');
        expect(elapsedSentence(at(null), at('2026-03-01'), 'Alex')).toBe('Compared with your previous snapshot of Alex.');
    });
});

describe('WhatChanged screen', () => {
    const previous = snapshot({ ID: 1, date: '2026-01-01T00:00:00Z', stats: { eros: 50, ludus: 30, mania: 20 } });
    const current = snapshot({ ID: 2, date: '2026-03-19T00:00:00Z', stats: { eros: 80, ludus: 32, agape: 15 }, uncertain: ['eros'] });

    const renderScreen = (props = {}) => render(
        <WhatChanged
            current={current}
            previous={previous}
            categories={categories}
            onSaveContext={vi.fn()}
            onDone={vi.fn()}
            {...props}
        />
    );

    it('describes the movement, the steady dimensions and the gaps', () => {
        renderScreen();

        expect(screen.getByText('11 weeks since your last snapshot of Alex.')).toBeInTheDocument();
        expect(screen.getByText('≈↑30')).toBeInTheDocument();      // eros, flagged unsure
        expect(screen.getByText('50 → 80')).toBeInTheDocument();
        expect(screen.getByText('1 dimension steady.')).toBeInTheDocument();
        expect(screen.getByText(/Not comparable \(skipped on one side\)/)).toHaveTextContent('Mania');
        expect(screen.getByText(/plain subtraction, nothing more/)).toBeInTheDocument();
    });

    it('saves a note through the caller and confirms it', async () => {
        const onSaveContext = vi.fn().mockResolvedValue(undefined);
        renderScreen({ onSaveContext });

        await userEvent.click(screen.getByRole('button', { name: /add a note/i }));
        await userEvent.type(screen.getByPlaceholderText('Anything future-you should know about this period?'), 'We moved.');
        await userEvent.click(screen.getByRole('button', { name: 'milestone' }));
        await userEvent.click(screen.getByRole('button', { name: /save note/i }));

        await waitFor(() => {
            expect(onSaveContext).toHaveBeenCalledWith({ description: 'We moved.', tags: ['milestone'] });
        });
        expect(await screen.findByText('Note saved.')).toBeInTheDocument();
    });

    it('keeps the note open with its text when saving fails', async () => {
        const onSaveContext = vi.fn().mockRejectedValue(new Error('Network Error'));
        renderScreen({ onSaveContext });

        await userEvent.click(screen.getByRole('button', { name: /add a note/i }));
        await userEvent.type(screen.getByPlaceholderText('Anything future-you should know about this period?'), 'We moved.');
        await userEvent.click(screen.getByRole('button', { name: /save note/i }));

        expect(await screen.findByText(/could not save that note/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Anything future-you should know about this period?')).toHaveValue('We moved.');
    });

    it('dismisses through Done', async () => {
        const onDone = vi.fn();
        renderScreen({ onDone });

        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(onDone).toHaveBeenCalled();
    });
});
