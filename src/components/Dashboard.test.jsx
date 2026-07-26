import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import Dashboard, { PersonForm, CATEGORIES_EXPORT, anchorFor, guideBand } from './Dashboard';

vi.mock('axios');

const today = new Date().toISOString().split('T')[0];

const emptyStats = {
    eros: 0, ludus: 0, storge: 0, pragma: 0, mania: 0, agape: 0, selflessness: 0
};

const eros = CATEGORIES_EXPORT.find(c => c.id === 'eros');

const subjectWithContext = {
    ID: 1,
    name: 'Alex',
    date: '2026-02-20T00:00:00Z',
    description: 'Rough month — we argued about the move.',
    tags: ['conflict', 'distance', 'life change', 'routine period'],
    stats: { ...emptyStats, eros: 85, mania: 60 }
};

describe('PersonForm — context capsules', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('submits a trimmed name together with the note and tags', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);

        await userEvent.type(screen.getByPlaceholderText('Enter name...'), '  Alex  ');
        await userEvent.click(screen.getByRole('button', { name: 'conflict' }));
        await userEvent.type(screen.getByLabelText('Add a custom tag'), 'ski trip');
        await userEvent.click(screen.getByRole('button', { name: 'Add' }));
        await userEvent.type(
            screen.getByPlaceholderText('Anything future-you should know about this period?'),
            'We talked it through.'
        );

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        expect(onSave).toHaveBeenCalledWith({
            name: 'Alex',
            date: today,
            stats: emptyStats,
            description: 'We talked it through.',
            tags: ['conflict', 'ski trip'],
            uncertain: [],
            guide_answers: {}
        });
    });

    it('adds a custom tag on Enter instead of submitting the form', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);

        await userEvent.type(screen.getByPlaceholderText('Enter name...'), 'Alex');
        await userEvent.type(screen.getByLabelText('Add a custom tag'), 'ski trip{Enter}');

        expect(onSave).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: 'Remove ski trip' })).toBeInTheDocument();
    });

    it('seeds the existing note and tags when editing a snapshot', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} initialData={subjectWithContext} />);

        expect(screen.getByPlaceholderText('Anything future-you should know about this period?'))
            .toHaveValue(subjectWithContext.description);
        expect(screen.getByRole('button', { name: 'conflict' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'distance' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'milestone' })).toHaveAttribute('aria-pressed', 'false');

        // Editing only a slider must not cost the user their note — the headline bug.
        await userEvent.click(screen.getByRole('button', { name: /update analysis/i }));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Alex',
            description: subjectWithContext.description,
            tags: subjectWithContext.tags
        }));
    });

    it('starts a new version with empty context', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} initialData={subjectWithContext} isNewVersion />);

        expect(screen.getByPlaceholderText('Anything future-you should know about this period?')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'conflict' })).toHaveAttribute('aria-pressed', 'false');

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
            name: 'Alex',
            date: today,
            description: '',
            tags: []
        }));
    });
});

describe('Anchors — the taxonomy content contract', () => {
    it('resolves the band containing a value, including at the boundaries', () => {
        expect(anchorFor(eros, 0).phrase).toBe(eros.anchors[0].phrase);
        expect(anchorFor(eros, 20).phrase).toBe(eros.anchors[0].phrase);
        expect(anchorFor(eros, 21).phrase).toBe(eros.anchors[1].phrase);
        expect(anchorFor(eros, 100).phrase).toBe(eros.anchors[eros.anchors.length - 1].phrase);
    });

    it('covers 0-100 contiguously for every category', () => {
        CATEGORIES_EXPORT.forEach((cat) => {
            expect(cat.anchors.length).toBeGreaterThanOrEqual(3);
            expect(cat.anchors[0].min).toBe(0);
            expect(cat.anchors[cat.anchors.length - 1].max).toBe(100);
            cat.anchors.forEach((band, index) => {
                if (index > 0) expect(band.min).toBe(cat.anchors[index - 1].max + 1);
            });
        });
    });
});

describe('Guided scoring — the suggestion band', () => {
    it('averages the answered metrics and spreads 8 either side', () => {
        // "Sometimes" (35) and "Often" (70) → average 52.5 → midpoint 53
        expect(guideBand({ 0: 1, 2: 2 })).toEqual({ count: 2, midpoint: 53, min: 45, max: 61 });
    });

    it('clamps the band to the 0-100 range', () => {
        expect(guideBand({ 0: 0 })).toEqual({ count: 1, midpoint: 0, min: 0, max: 8 });
        expect(guideBand({ 0: 3 })).toEqual({ count: 1, midpoint: 100, min: 92, max: 100 });
    });

    it('returns nothing until at least one metric is answered', () => {
        expect(guideBand({})).toBeNull();
        expect(guideBand(undefined)).toBeNull();
    });
});

describe('PersonForm — guided scoring, skipping and uncertainty', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    const fillName = async () => {
        await userEvent.type(screen.getByPlaceholderText('Enter name...'), 'Alex');
    };

    it('shows the anchor phrase for the current slider position', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);

        expect(screen.getByText(eros.anchors[0].phrase)).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Eros'), { target: { value: '80' } });

        expect(screen.getByText(eros.anchors[3].phrase)).toBeInTheDocument();
        expect(screen.queryByText(eros.anchors[0].phrase)).not.toBeInTheDocument();
    });

    it('suggests a range from the guide answers without moving the slider', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);
        await fillName();

        await userEvent.click(screen.getAllByRole('button', { name: /guide me/i })[0]);
        await userEvent.click(screen.getByRole('button', { name: 'Proximity Seeking: Sometimes' }));

        expect(screen.getByText(/average 35 — a suggested\s+range of 27–43/)).toBeInTheDocument();
        expect(screen.getByLabelText('Eros')).toHaveValue('0');

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        expect(onSave.mock.calls[0][0].stats.eros).toBe(0);
    });

    it('sets the value to the midpoint only when the user asks for it', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);
        await fillName();

        await userEvent.click(screen.getAllByRole('button', { name: /guide me/i })[0]);
        await userEvent.click(screen.getByRole('button', { name: 'Proximity Seeking: Often' }));
        await userEvent.click(screen.getByRole('button', { name: 'Use 70' }));

        expect(screen.getByLabelText('Eros')).toHaveValue('70');

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        expect(onSave.mock.calls[0][0].stats.eros).toBe(70);
        expect(onSave.mock.calls[0][0].guide_answers).toEqual({ eros: { 0: 2 } });
    });

    it('omits a skipped category from the payload rather than saving a zero', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);
        await fillName();

        await userEvent.click(screen.getByRole('button', { name: 'Skip Ludus' }));
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.stats).not.toHaveProperty('ludus');
        expect(payload.stats).toHaveProperty('eros', 0);
    });

    it('records an unsure flag, and drops it when the category is then skipped', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);
        await fillName();

        await userEvent.click(screen.getByRole('button', { name: 'Mark Mania unsure' }));
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        expect(onSave.mock.calls[0][0].uncertain).toEqual(['mania']);

        await userEvent.click(screen.getByRole('button', { name: 'Skip Mania' }));
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        expect(onSave.mock.calls[1][0].uncertain).toEqual([]);
    });

    it('seeds skipped and unsure state from the snapshot being edited', async () => {
        const snapshot = {
            ID: 5,
            name: 'Alex',
            date: '2026-02-20T00:00:00Z',
            stats: { eros: 40, mania: 60 },
            uncertain: ['mania'],
            guide_answers: { eros: { 0: 3 } }
        };

        render(<PersonForm onSave={onSave} onClose={onClose} initialData={snapshot} />);

        expect(screen.getByRole('button', { name: 'Skip Ludus' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Skip Eros' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Mark Mania unsure' })).toHaveAttribute('aria-pressed', 'true');

        await userEvent.click(screen.getByRole('button', { name: /update analysis/i }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.stats).toEqual({ eros: 40, mania: 60 });
        expect(payload.uncertain).toEqual(['mania']);
        expect(payload.guide_answers).toEqual({ eros: { 0: 3 } });
    });

    it('carries scores but not uncertainty into a new version', async () => {
        const snapshot = {
            ID: 5,
            name: 'Alex',
            stats: { eros: 40, mania: 60 },
            uncertain: ['mania'],
            guide_answers: { eros: { 0: 3 } }
        };

        render(<PersonForm onSave={onSave} onClose={onClose} initialData={snapshot} isNewVersion />);

        expect(screen.getByRole('button', { name: 'Mark Mania unsure' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Skip Ludus' })).toHaveAttribute('aria-pressed', 'false');

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.stats.eros).toBe(40);   // last reading is the starting point
        expect(payload.stats.ludus).toBe(0);   // absent last time, scorable this time
        expect(payload.uncertain).toEqual([]);
        expect(payload.guide_answers).toEqual({});
    });
});

describe('Dashboard — context surface and error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        axios.get.mockResolvedValue({ data: [] });
    });

    it('shows the note icon and up to three tag chips on the active card', async () => {
        axios.get.mockResolvedValue({ data: [subjectWithContext] });

        render(<Dashboard />);

        const noteButton = await screen.findByRole('button', { name: 'Show note' });
        expect(screen.getByText('conflict')).toBeInTheDocument();
        expect(screen.getByText('distance')).toBeInTheDocument();
        expect(screen.getByText('life change')).toBeInTheDocument();
        expect(screen.queryByText('routine period')).not.toBeInTheDocument();
        expect(screen.getByText('+1')).toBeInTheDocument();

        expect(screen.queryByText(subjectWithContext.description)).not.toBeInTheDocument();
        await userEvent.click(noteButton);
        expect(screen.getByText(subjectWithContext.description)).toBeInTheDocument();
    });

    it('renders no context indicators for a snapshot created before Phase 1', async () => {
        axios.get.mockResolvedValue({ data: [{ ID: 2, name: 'Sam', date: null, description: '', stats: emptyStats }] });

        render(<Dashboard />);

        expect(await screen.findByText('Sam')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show note' })).not.toBeInTheDocument();
    });

    it('surfaces a fetch failure instead of showing an unexplained empty grid', async () => {
        axios.get.mockRejectedValue({ response: { data: { error: 'Failed to fetch subjects' } } });

        render(<Dashboard />);

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch subjects');
    });

    it('keeps the form open with its input intact when a save fails', async () => {
        axios.post.mockRejectedValue(new Error('Network Error'));

        render(<Dashboard />);

        await userEvent.click(screen.getByRole('button', { name: /new analysis/i }));
        await userEvent.type(screen.getByPlaceholderText('Enter name...'), 'Alex');
        await userEvent.type(
            screen.getByPlaceholderText('Anything future-you should know about this period?'),
            'Do not lose this.'
        );
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(/could not save this analysis/i);
        });
        expect(screen.getByPlaceholderText('Enter name...')).toHaveValue('Alex');
        expect(screen.getByPlaceholderText('Anything future-you should know about this period?'))
            .toHaveValue('Do not lose this.');
    });

    it('renders a skipped category as blank and an unsure one as approximate', async () => {
        axios.get.mockResolvedValue({
            data: [{
                ID: 3,
                name: 'Sam',
                date: '2026-02-20T00:00:00Z',
                stats: { eros: 40, mania: 60 },   // ludus and the rest were skipped
                uncertain: ['mania']
            }]
        });

        render(<Dashboard />);

        expect(await screen.findByText('Sam')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('≈60%')).toBeInTheDocument();
        // Five unscored categories, each shown as a dash rather than a zero bar
        expect(screen.getAllByText('—')).toHaveLength(5);
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });

    it('shows What Changed after adding to an existing stack, but not after an edit', async () => {
        const existing = {
            ID: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 }, tags: [], description: ''
        };
        axios.get.mockResolvedValue({ data: [existing] });
        axios.post.mockResolvedValue({
            data: { ID: 2, name: 'Alex', date: '2026-03-19T00:00:00Z', stats: { eros: 70 }, tags: [], description: '' }
        });
        axios.put.mockResolvedValue({ data: existing });

        render(<Dashboard />);
        expect(await screen.findByText('Alex')).toBeInTheDocument();

        // An in-place edit is a correction, not a new reading — no payoff screen.
        await userEvent.click(screen.getByTitle('Edit'));
        await userEvent.click(screen.getByRole('button', { name: /update analysis/i }));
        await waitFor(() => expect(axios.put).toHaveBeenCalled());
        expect(screen.queryByText('What changed')).not.toBeInTheDocument();

        // Adding a version compares it against the previous snapshot.
        await userEvent.click(screen.getByTitle('Add New Version'));
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        expect(await screen.findByText('What changed')).toBeInTheDocument();
        expect(screen.getByText(/since your last snapshot of Alex/)).toBeInTheDocument();
        expect(screen.getByText('↑30')).toBeInTheDocument();
    });

    it('saves a What Changed note without touching the scores', async () => {
        const existing = { ID: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } };
        const created = { ID: 2, name: 'Alex', date: '2026-03-19T00:00:00Z', stats: { eros: 70 }, tags: [], description: '' };
        axios.get.mockResolvedValue({ data: [existing] });
        axios.post.mockResolvedValue({ data: created });
        axios.put.mockResolvedValue({ data: { ...created, description: 'The move happened.', tags: ['life change'] } });

        render(<Dashboard />);
        expect(await screen.findByText('Alex')).toBeInTheDocument();

        await userEvent.click(screen.getByTitle('Add New Version'));
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        await screen.findByText('What changed');

        await userEvent.click(screen.getByRole('button', { name: /add a note/i }));
        await userEvent.type(
            screen.getByPlaceholderText('Anything future-you should know about this period?'),
            'The move happened.'
        );
        await userEvent.click(screen.getByRole('button', { name: 'life change' }));
        await userEvent.click(screen.getByRole('button', { name: /save note/i }));

        await waitFor(() => {
            expect(axios.put).toHaveBeenCalledWith('/api/subjects/2', {
                description: 'The move happened.',
                tags: ['life change']
            });
        });
        expect(await screen.findByText('Note saved.')).toBeInTheDocument();
    });

    it('dismisses the notice banner', async () => {
        axios.get.mockRejectedValue(new Error('Network Error'));

        render(<Dashboard />);

        const banner = await screen.findByRole('alert');
        await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss notification' }));

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});
