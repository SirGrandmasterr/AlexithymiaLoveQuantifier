import React from 'react';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom';
import axios from 'axios';
import Dashboard, { PersonForm, CATEGORIES_EXPORT, anchorFor, anchorPhrase, guideBand } from './Dashboard';
import { PHRASES_PER_BAND } from '../constants/categories';
import { SubjectsProvider } from '../context/SubjectsContext';
import { DiscretionProvider } from '../context/DiscretionContext';
import { JournalProvider } from '../context/JournalContext';
import { summarizeStack } from '../constants/categories';

vi.mock('axios');

const TimelineProbe = () => {
    const { id } = useParams();
    return <div>timeline for relationship {id}</div>;
};

const renderDashboard = () => render(
    <MemoryRouter initialEntries={['/']}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/" element={<Dashboard />} />
                        <Route path="/relationships/:id/timeline" element={<TimelineProbe />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const mockFetch = (subjects = [], relationships) => {
    const derived = relationships ?? [...new Map(
        subjects.map(s => [s.relationship_id, { ID: s.relationship_id, name: s.name }])
    ).values()];

    axios.get.mockImplementation((url) => Promise.resolve({
        data: url === '/api/relationships' ? derived : subjects
    }));
};

const today = new Date().toISOString().split('T')[0];

const emptyStats = {
    eros: 0, ludus: 0, storge: 0, pragma: 0, mania: 0, agape: 0, selflessness: 0
};

const eros = CATEGORIES_EXPORT.find(c => c.id === 'eros');

const subjectWithContext = {
    ID: 1,
    relationship_id: 1,
    name: 'Alex',
    date: '2026-02-20T00:00:00Z',
    description: 'Rough month — we argued about the move.',
    tags: ['conflict', 'distance', 'life change', 'routine period'],
    stats: { ...emptyStats, eros: 85, mania: 60 }
};

describe('PersonForm — name suggestions', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    // The list `useSubjects()` holds: every relationship, snapshot or no snapshot.
    const suggestions = [
        { ID: 7, name: 'Lucie M', snapshot_count: 0 },
        { ID: 9, name: 'Noor', snapshot_count: 2 }
    ];

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('offers every relationship, including the ones the dashboard does not draw', () => {
        render(<PersonForm onSave={onSave} onClose={onClose} suggestions={suggestions} />);

        const list = document.querySelector('[data-name-suggestions]');
        expect(list).toBeInTheDocument();
        expect([...list.querySelectorAll('option')].map(option => option.value))
            .toEqual(['Lucie M', 'Noor']);

        // The field is wired to it, by the id React minted rather than a literal.
        const field = screen.getByPlaceholderText('Enter name...');
        expect(field.getAttribute('list')).toBe(list.id);
        expect(list.id).toBeTruthy();
    });

    it('suggests without choosing — the submitted name is still the typed one', async () => {
        render(<PersonForm onSave={onSave} onClose={onClose} suggestions={suggestions} />);

        await userEvent.type(screen.getByPlaceholderText('Enter name...'), 'Lucie M');
        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lucie M' }));
    });

    it('offers nothing on a new version or a pulse, where the person is already decided', () => {
        const { rerender } = render(
            <PersonForm
                onSave={onSave}
                onClose={onClose}
                suggestions={suggestions}
                initialData={subjectWithContext}
                isNewVersion
            />
        );
        expect(document.querySelector('[data-name-suggestions]')).toBeNull();
        expect(screen.getByPlaceholderText('Enter name...')).toBeDisabled();

        rerender(
            <PersonForm
                onSave={onSave}
                onClose={onClose}
                suggestions={suggestions}
                initialData={subjectWithContext}
                isPulse
            />
        );
        expect(document.querySelector('[data-name-suggestions]')).toBeNull();
    });

    it('renders no empty list when there is nothing to suggest', () => {
        render(<PersonForm onSave={onSave} onClose={onClose} />);

        expect(document.querySelector('[data-name-suggestions]')).toBeNull();
    });
});

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
            kind: 'full',
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
    const lastBand = (cat) => cat.anchors[cat.anchors.length - 1];

    it('resolves the band containing a value, including at the boundaries', () => {
        const [first, second] = eros.anchors;

        expect(anchorFor(eros, 0)).toBe(first);
        expect(anchorFor(eros, first.max)).toBe(first);
        expect(anchorFor(eros, first.max + 1)).toBe(second);
        expect(anchorFor(eros, 100)).toBe(lastBand(eros));
    });

    it('covers 0-100 contiguously for every category', () => {
        CATEGORIES_EXPORT.forEach((cat) => {
            // Five is the floor rather than the count: selflessness resolves more coarsely
            // than the rest on purpose, because it has half as many metrics behind it.
            expect(cat.anchors.length).toBeGreaterThanOrEqual(5);
            expect(cat.anchors[0].min).toBe(0);
            expect(lastBand(cat).max).toBe(100);
            cat.anchors.forEach((band, index) => {
                if (index > 0) expect(band.min).toBe(cat.anchors[index - 1].max + 1);
            });
        });
    });

    // The five phrasings are the feature: one sentence per band meant the whole scale was
    // explained by a handful of sentences that taught nothing on a second reading.
    it('gives every band five distinct phrasings', () => {
        CATEGORIES_EXPORT.forEach((cat) => {
            cat.anchors.forEach((band) => {
                expect(band.phrases).toHaveLength(PHRASES_PER_BAND);
                expect(new Set(band.phrases).size).toBe(PHRASES_PER_BAND);
                band.phrases.forEach((phrase) => {
                    expect(phrase.trim().length).toBeGreaterThan(0);
                });
            });
        });
    });

    it('never repeats a phrasing across the bands of one category', () => {
        CATEGORIES_EXPORT.forEach((cat) => {
            const all = cat.anchors.flatMap(band => band.phrases);
            expect(new Set(all).size).toBe(all.length);
        });
    });
});

describe('anchorPhrase — which of the five is shown', () => {
    const bandFor = (value) => anchorFor(eros, value);

    // The load-bearing property: the sentence must not reshuffle while the dial is turning.
    // It depends on the band, not the value.
    it('holds still while the value moves within one band', () => {
        const band = eros.anchors[3];
        const readings = [];
        for (let value = band.min; value <= band.max; value += 1) {
            readings.push(anchorPhrase(eros, value, 7));
        }

        expect(new Set(readings).size).toBe(1);
        expect(band.phrases).toContain(readings[0]);
    });

    it('says something different on the next opening of the form', () => {
        const seen = new Set();
        for (let seed = 0; seed < PHRASES_PER_BAND; seed += 1) {
            seen.add(anchorPhrase(eros, 60, seed));
        }

        // Five consecutive seeds walk the whole set, which is why the seed is a counter
        // rather than a fresh random number per render.
        expect(seen.size).toBe(PHRASES_PER_BAND);
    });

    it('varies the lens between bands, so one pass down the scale is not one sentence five times', () => {
        const shown = eros.anchors.map(band => anchorPhrase(eros, band.min, 3));
        const positions = shown.map((phrase, index) => eros.anchors[index].phrases.indexOf(phrase));

        expect(new Set(positions).size).toBeGreaterThan(1);
    });

    it('always returns a phrase belonging to the value it was asked about', () => {
        CATEGORIES_EXPORT.forEach((cat) => {
            [0, 17, 42, 63, 88, 100].forEach((value) => {
                const phrase = anchorPhrase(cat, value, 11);
                expect(anchorFor(cat, value).phrases).toContain(phrase);
            });
        });
    });

    it('returns null when no band contains the value', () => {
        expect(anchorPhrase(eros, 101, 0)).toBeNull();
        expect(bandFor(101)).toBeNull();
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

    it('shows an anchor phrase from the band the slider is in', async () => {
        const shownFrom = (band) => band.phrases.find(phrase => screen.queryByText(phrase));

        render(<PersonForm onSave={onSave} onClose={onClose} />);

        const low = anchorFor(eros, 0);
        expect(shownFrom(low)).toBeTruthy();

        fireEvent.change(screen.getByLabelText('Eros'), { target: { value: '80' } });

        const high = anchorFor(eros, 80);
        expect(high).not.toBe(low);
        expect(shownFrom(high)).toBeTruthy();
        expect(shownFrom(low)).toBeUndefined();
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

    it('starts a new version from zero, carrying neither scores nor uncertainty', async () => {
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
        expect(screen.getByLabelText('Eros')).toHaveValue('0');

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.stats.eros).toBe(0);
        expect(payload.stats.ludus).toBe(0);
        expect(payload.uncertain).toEqual([]);
        expect(payload.guide_answers).toEqual({});
    });

    // Zeroed does not mean discarded: last time's reading is on the track and one tap away,
    // so "about the same as before" is still cheap to say — it just has to be said.
    it('offers last time\'s number back on a new version', async () => {
        const snapshot = { ID: 5, name: 'Alex', stats: { eros: 40 } };

        render(<PersonForm onSave={onSave} onClose={onClose} initialData={snapshot} isNewVersion />);

        await userEvent.click(screen.getByRole('button', { name: "Set Eros to last time's 40" }));
        expect(screen.getByLabelText('Eros')).toHaveValue('40');

        // Once taken, the offer stops being an offer.
        expect(screen.queryByRole('button', { name: "Set Eros to last time's 40" })).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /analyze & save/i }));
        expect(onSave.mock.calls[0][0].stats.eros).toBe(40);
    });

    // The exception, and the reason it is not an inconsistency: carrying the previous
    // answers is the definition of a pulse, and its rows say "unchanged" on their face.
    it('still carries the last snapshot forward in a pulse', async () => {
        const snapshot = { ID: 5, name: 'Alex', stats: { eros: 40, mania: 60 } };

        render(<PersonForm onSave={onSave} onClose={onClose} initialData={snapshot} isPulse />);

        await userEvent.click(screen.getByRole('button', { name: /save pulse/i }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.stats.eros).toBe(40);
        expect(payload.stats.mania).toBe(60);
    });
});

describe('CardStack — which gesture belongs to whom', () => {
    // Three snapshots of one relationship, so there is a stack to riffle through.
    const versions = [1, 2, 3].map(n => ({
        ID: n,
        relationship_id: 1,
        name: 'Alex',
        date: `2026-0${n}-01T00:00:00Z`,
        stats: { ...emptyStats, eros: n * 10 }
    }));

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch(versions);
    });

    /** Any element inside the stack: touch events bubble to the container's listeners. */
    const insideStack = async () => (await screen.findAllByRole('heading', { name: 'Alex' }))[0];

    const touch = (element, type, x, y) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        event.touches = [{ clientX: x, clientY: y }];
        act(() => { element.dispatchEvent(event); });
        return event;
    };

    const position = () => screen.getByText(/^\d+ \/ \d+$/).textContent;

    it('scrubs the stack on a horizontal swipe', async () => {
        renderDashboard();
        const card = await insideStack();

        expect(position()).toBe('1 / 3');

        // Left pushes the top card away, revealing the older snapshot under it.
        touch(card, 'touchstart', 200, 300);
        const moved = touch(card, 'touchmove', 120, 302);
        touch(card, 'touchend', 120, 302);

        expect(position()).toBe('2 / 3');
        // The stack claimed this one, which is what stops the page moving with it.
        expect(moved.defaultPrevented).toBe(true);
    });

    // The bug this replaces: a vertical drag was the scrub gesture *and* the page's scroll
    // gesture, so which one you got depended on where your finger landed.
    it('leaves a vertical drag to the page', async () => {
        renderDashboard();
        const card = await insideStack();

        touch(card, 'touchstart', 200, 300);
        const moved = touch(card, 'touchmove', 204, 180);
        touch(card, 'touchend', 204, 180);

        expect(position()).toBe('1 / 3');
        expect(moved.defaultPrevented).toBe(false);
    });

    // A gesture that begins as a scroll stays one, however far the thumb then arcs sideways.
    it('does not turn a scroll into a scrub halfway through', async () => {
        renderDashboard();
        const card = await insideStack();

        touch(card, 'touchstart', 200, 300);
        touch(card, 'touchmove', 202, 260);
        const moved = touch(card, 'touchmove', 60, 250);
        touch(card, 'touchend', 60, 250);

        expect(position()).toBe('1 / 3');
        expect(moved.defaultPrevented).toBe(false);
    });

    // The swipe needs a visible counterpart: there is no hover on a phone, so the hint
    // inside the card never appears there.
    it('walks the stack with the pager, and stops at both ends', async () => {
        renderDashboard();
        await insideStack();

        const older = screen.getByRole('button', { name: 'Older version' });
        const newer = screen.getByRole('button', { name: 'Newer version' });

        expect(newer).toBeDisabled();

        await userEvent.click(older);
        expect(position()).toBe('2 / 3');
        expect(newer).toBeEnabled();

        await userEvent.click(older);
        expect(position()).toBe('3 / 3');
        expect(older).toBeDisabled();

        await userEvent.click(newer);
        expect(position()).toBe('2 / 3');
    });
});

describe('summarizeStack — the card summary line', () => {
    const at = (id, stats) => ({ ID: id, name: 'Alex', date: `2026-0${id}-01T00:00:00Z`, stats });

    it('names the two highest scores in the latest snapshot', () => {
        const summary = summarizeStack([
            at(1, { eros: 10, storge: 90, pragma: 80 }),
            at(2, { eros: 20, storge: 70, pragma: 85 })
        ]);

        expect(summary.dominant.map(c => c.id)).toEqual(['pragma', 'storge']);
    });

    it('breaks ties by taxonomy order, not by object order', () => {
        const summary = summarizeStack([at(1, { ludus: 50, eros: 50, storge: 10 })]);
        expect(summary.dominant.map(c => c.id)).toEqual(['eros', 'ludus']);
    });

    it('says nothing at all when the latest snapshot scored fewer than two categories', () => {
        expect(summarizeStack([at(1, { eros: 50 })])).toBeNull();
        expect(summarizeStack([])).toBeNull();
    });

    it('withholds "most changed" until there are three snapshots', () => {
        const versions = [
            at(1, { eros: 10, mania: 30 }),
            at(2, { eros: 90, mania: 35 })
        ];
        expect(summarizeStack(versions).mostChanged).toBeNull();

        const third = [...versions, at(3, { eros: 50, mania: 40 })];
        expect(summarizeStack(third).mostChanged.id).toBe('eros');
    });

    it('ignores snapshots that skipped a category when measuring its range', () => {
        const summary = summarizeStack([
            at(1, { eros: 10, mania: 20 }),
            at(2, { mania: 90 }),            // eros skipped — not a zero
            at(3, { eros: 15, mania: 80 })
        ]);
        expect(summary.mostChanged.id).toBe('mania');
    });
});

describe('Dashboard — context surface and error handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch([]);
    });

    it('shows the note icon and up to three tag chips on the active card', async () => {
        mockFetch([subjectWithContext]);

        renderDashboard();

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
        mockFetch([{ ID: 2, relationship_id: 2, name: 'Sam', date: null, description: '', stats: emptyStats }]);

        renderDashboard();

        expect(await screen.findByText('Sam')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show note' })).not.toBeInTheDocument();
    });

    it('surfaces a fetch failure instead of showing an unexplained empty grid', async () => {
        axios.get.mockRejectedValue({ response: { data: { error: 'Failed to fetch subjects' } } });

        renderDashboard();

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch subjects');
    });

    it('keeps the form open with its input intact when a save fails', async () => {
        axios.post.mockRejectedValue(new Error('Network Error'));

        renderDashboard();

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
        mockFetch([{
            ID: 3,
            relationship_id: 3,
            name: 'Sam',
            date: '2026-02-20T00:00:00Z',
            stats: { eros: 40, mania: 60 },   // ludus and the rest were skipped
            uncertain: ['mania']
        }]);

        renderDashboard();

        expect(await screen.findByText('Sam')).toBeInTheDocument();
        expect(screen.getByText('40%')).toBeInTheDocument();
        expect(screen.getByText('≈60%')).toBeInTheDocument();
        // Five unscored categories, each shown as a dash rather than a zero bar
        expect(screen.getAllByText('—')).toHaveLength(5);
        expect(screen.queryByText('0%')).not.toBeInTheDocument();
    });

    it('shows What Changed after adding to an existing stack, but not after an edit', async () => {
        const existing = {
            ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 }, tags: [], description: ''
        };
        mockFetch([existing]);
        axios.post.mockResolvedValue({
            data: { ID: 2, relationship_id: 1, name: 'Alex', date: '2026-03-19T00:00:00Z', stats: { eros: 70 }, tags: [], description: '' }
        });
        axios.put.mockResolvedValue({ data: existing });

        renderDashboard();
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
        const existing = { ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } };
        const created = { ID: 2, relationship_id: 1, name: 'Alex', date: '2026-03-19T00:00:00Z', stats: { eros: 70 }, tags: [], description: '' };
        mockFetch([existing]);
        axios.post.mockResolvedValue({ data: created });
        axios.put.mockResolvedValue({ data: { ...created, description: 'The move happened.', tags: ['life change'] } });

        renderDashboard();
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

    it('shows the summary line on the active card', async () => {
        mockFetch([
            { ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { storge: 80, pragma: 70, mania: 10 } },
            { ID: 2, relationship_id: 1, name: 'Alex', date: '2026-02-01T00:00:00Z', stats: { storge: 82, pragma: 72, mania: 40 } },
            { ID: 3, relationship_id: 1, name: 'Alex', date: '2026-03-01T00:00:00Z', stats: { storge: 85, pragma: 75, mania: 70 } }
        ]);

        renderDashboard();

        expect(await screen.findByText(/Storge · Pragma dominant — Mania most changed/)).toBeInTheDocument();
    });

    it('navigates to the timeline route instead of swapping the grid', async () => {
        mockFetch([{ ID: 1, relationship_id: 12, name: 'Sam & Jo', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } }]);

        renderDashboard();
        await screen.findByText('Sam & Jo');

        await userEvent.click(screen.getByTitle('Deep Analysis'));

        expect(await screen.findByText('timeline for relationship 12')).toBeInTheDocument();
    });

    it('flips the active card between bars and its Love Shape', async () => {
        mockFetch([{ ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } }]);

        renderDashboard();
        await screen.findByText('Alex');

        expect(screen.queryByTestId('love-shape')).not.toBeInTheDocument();

        await userEvent.click(screen.getByTitle('Show Love Shape'));
        expect(screen.getByTestId('love-shape')).toBeInTheDocument();

        await userEvent.click(screen.getByTitle('Show bars'));
        expect(screen.queryByTestId('love-shape')).not.toBeInTheDocument();
    });

    it('only swallows the wheel while there is a version left to scrub to', async () => {
        mockFetch([
            { ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } },
            { ID: 2, relationship_id: 1, name: 'Alex', date: '2026-02-01T00:00:00Z', stats: { eros: 60 } }
        ]);

        renderDashboard();
        const card = (await screen.findAllByText('Alex'))[0].closest('.relative');

        // Down from the newest: there is history below, so the page must not scroll.
        const scrubbed = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true });
        card.dispatchEvent(scrubbed);
        expect(scrubbed.defaultPrevented).toBe(true);

        // Down again from the oldest: nothing left to reveal, so let the page scroll.
        await waitFor(() => {
            const clamped = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true });
            card.dispatchEvent(clamped);
            expect(clamped.defaultPrevented).toBe(false);
        });
    });

    it('lets the page scroll over a single-version stack', async () => {
        mockFetch([{ ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } }]);

        renderDashboard();
        const card = (await screen.findByText('Alex')).closest('.relative');

        const event = new WheelEvent('wheel', { deltaY: 10, cancelable: true, bubbles: true });
        card.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(false);
    });

    it('dismisses the notice banner', async () => {
        axios.get.mockRejectedValue(new Error('Network Error'));

        renderDashboard();

        const banner = await screen.findByRole('alert');
        await userEvent.click(within(banner).getByRole('button', { name: 'Dismiss notification' }));

        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
});

describe('Quick Pulse', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    const lastSnapshot = {
        ID: 5,
        relationship_id: 1,
        name: 'Alex',
        date: '2026-01-10T00:00:00Z',
        stats: { eros: 40, mania: 70 },   // everything else was skipped last time
        uncertain: ['mania'],
        tags: ['conflict'],
        description: 'rough month',
        guide_answers: { eros: { 0: 3 } }
    };

    beforeEach(() => vi.clearAllMocks());

    const renderPulse = () => render(
        <PersonForm onSave={onSave} onClose={onClose} initialData={lastSnapshot} isPulse />
    );

    it('opens collapsed, carrying last time\'s answers', () => {
        renderPulse();

        expect(screen.getByRole('heading', { name: 'Quick Pulse' })).toBeInTheDocument();
        // Seven one-line rows; no sliders until something is opened.
        expect(screen.getAllByRole('button', { name: /^Adjust / })).toHaveLength(7);
        expect(screen.queryByLabelText('Eros')).not.toBeInTheDocument();

        expect(screen.getAllByText('unchanged')).toHaveLength(2);        // eros and mania
        expect(screen.getAllByText('still not scored')).toHaveLength(5); // the skipped rest
    });

    it('saves as a pulse without opening anything', async () => {
        renderPulse();

        await userEvent.click(screen.getByRole('button', { name: 'Save pulse' }));

        const payload = onSave.mock.calls[0][0];
        expect(payload.kind).toBe('pulse');
        expect(payload.name).toBe('Alex');
        // Unchanged means unchanged: the scores carry over and the skips stay skipped.
        expect(payload.stats).toEqual({ eros: 40, mania: 70 });
        // Context describes a period, so a pulse starts it empty like any new version.
        expect(payload.description).toBe('');
        expect(payload.tags).toEqual([]);
        expect(payload.uncertain).toEqual([]);
    });

    it('expands one category to the full row on request, and hides guided scoring', async () => {
        renderPulse();

        await userEvent.click(screen.getByRole('button', { name: 'Adjust Eros' }));

        expect(screen.getByLabelText('Eros')).toHaveValue('40');
        // The fast path and the careful path are different tools.
        expect(screen.queryByRole('button', { name: /guide me/i })).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText('Eros'), { target: { value: '65' } });
        await userEvent.click(screen.getByRole('button', { name: 'Save pulse' }));

        expect(onSave.mock.calls[0][0].stats).toEqual({ eros: 65, mania: 70 });
    });

    it('locks the name, exactly like a new version', () => {
        renderPulse();
        expect(screen.getByPlaceholderText('Enter name...')).toBeDisabled();
    });
});

describe('Dashboard — the cadence nudge', () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

    const overdue = [{
        ID: 1, relationship_id: 1, name: 'Alex', date: sixtyDaysAgo, stats: { eros: 40 }
    }];

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
    });

    it('says one calm sentence when a rhythm has elapsed', async () => {
        mockFetch(overdue, [{ ID: 1, name: 'Alex', cadence_days: 30 }]);

        renderDashboard();

        const nudge = await screen.findByText(/It's been .* since your last snapshot of Alex\./);
        expect(nudge).toBeInTheDocument();
        // No streak, no count of what was missed, no alarm.
        expect(screen.queryByText(/overdue|missed|streak/i)).not.toBeInTheDocument();
    });

    it('stays silent when no rhythm is set, however long it has been', async () => {
        mockFetch(overdue, [{ ID: 1, name: 'Alex', cadence_days: null }]);

        renderDashboard();
        await screen.findByText('Alex');

        expect(screen.queryByText(/since your last snapshot/)).not.toBeInTheDocument();
    });

    it('goes quiet for a week when told "Later"', async () => {
        mockFetch(overdue, [{ ID: 1, name: 'Alex', cadence_days: 30 }]);

        const first = renderDashboard();
        await screen.findByText(/since your last snapshot of Alex/);
        await userEvent.click(screen.getByRole('button', { name: 'Later' }));

        expect(screen.queryByText(/since your last snapshot/)).not.toBeInTheDocument();

        // A stored snooze outlives the session it was set in.
        first.unmount();
        sessionStorage.clear();
        renderDashboard();
        await screen.findByText('Alex');
        expect(screen.queryByText(/since your last snapshot/)).not.toBeInTheDocument();
    });

    it('does not come back in the same session once dismissed', async () => {
        mockFetch(overdue, [{ ID: 1, name: 'Alex', cadence_days: 30 }]);

        const first = renderDashboard();
        await screen.findByText(/since your last snapshot of Alex/);
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss reminder' }));

        // Remounting is not a new session — and the snooze store is untouched by dismissal.
        first.unmount();
        renderDashboard();
        await screen.findByText('Alex');
        expect(screen.queryByText(/since your last snapshot/)).not.toBeInTheDocument();
        expect(localStorage.getItem('alq:cadence-snoozed')).toBeNull();
    });

    it('opens a pulse pre-filled from the newest snapshot', async () => {
        mockFetch(overdue, [{ ID: 1, name: 'Alex', cadence_days: 30 }]);

        renderDashboard();
        await screen.findByText(/since your last snapshot of Alex/);
        await userEvent.click(screen.getByRole('button', { name: 'Quick pulse' }));

        expect(await screen.findByRole('heading', { name: 'Quick Pulse' })).toBeInTheDocument();
        expect(screen.getByText('unchanged')).toBeInTheDocument();
    });
});

describe('Dashboard — stack-level actions', () => {
    const alexV1 = { ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } };
    const alexV2 = { ID: 2, relationship_id: 1, name: 'Alex', date: '2026-02-01T00:00:00Z', stats: { eros: 60 } };
    const alexM = { ID: 3, relationship_id: 2, name: 'Alex M', date: '2026-03-01T00:00:00Z', stats: { eros: 20 } };

    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch([alexV1, alexV2, alexM]);
    });

    const openMenu = async (name) => {
        await screen.findByRole('button', { name: `Stack actions for ${name}` });
        await userEvent.click(screen.getByRole('button', { name: `Stack actions for ${name}` }));
    };

    it('keeps two relationships that share a display name in separate stacks', async () => {
        mockFetch([
            { ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 } },
            { ID: 2, relationship_id: 2, name: 'Alex', date: '2026-02-01T00:00:00Z', stats: { eros: 60 } }
        ]);

        renderDashboard();

        // Two stack headers, so two stacks — the case name-based grouping could not express.
        expect(await screen.findAllByRole('button', { name: 'Stack actions for Alex' })).toHaveLength(2);
    });

    it('renames every card in the stack', async () => {
        axios.patch.mockResolvedValue({ data: { ID: 1, name: 'Alexandra', snapshot_count: 2 } });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /rename relationship/i }));

        const field = screen.getByLabelText('Name');
        expect(field).toHaveValue('Alex');
        await userEvent.clear(field);
        await userEvent.type(field, 'Alexandra');
        await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

        await waitFor(() => {
            expect(axios.patch).toHaveBeenCalledWith('/api/relationships/1', { name: 'Alexandra' });
        });
        expect(await screen.findByRole('button', { name: 'Stack actions for Alexandra' })).toBeInTheDocument();
        // Both versions carry the new name, which is the whole point of the entity.
        await waitFor(() => expect(screen.getAllByText('Alexandra').length).toBeGreaterThan(0));
        expect(screen.queryByRole('button', { name: 'Stack actions for Alex' })).not.toBeInTheDocument();
    });

    it('keeps the rename dialog open and explains a name collision', async () => {
        axios.patch.mockRejectedValue({
            response: { status: 409, data: { error: 'You already have a relationship with that name. Merge them instead.' } }
        });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /rename relationship/i }));

        await userEvent.clear(screen.getByLabelText('Name'));
        await userEvent.type(screen.getByLabelText('Name'), 'Alex M');
        await userEvent.click(screen.getByRole('button', { name: 'Rename' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/already have a relationship with that name/i);
        expect(screen.getByLabelText('Name')).toHaveValue('Alex M');
    });

    it('offers only the other stacks as merge targets, and states what will happen', async () => {
        axios.post.mockResolvedValue({ data: { ID: 2, name: 'Alex M', snapshot_count: 3 } });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /merge into/i }));

        // The stack being merged is not offered as a target for itself.
        expect(screen.getAllByRole('radio')).toHaveLength(1);
        expect(screen.getByRole('radio', { name: /Alex M/ })).toBeInTheDocument();

        // Nothing is stated, and nothing can be confirmed, until a target is chosen.
        expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled();
        await userEvent.click(screen.getByRole('radio', { name: /Alex M/ }));
        expect(screen.getByText(/All 2 snapshots of/)).toHaveTextContent(
            'All 2 snapshots of Alex will move into Alex M. This cannot be split apart automatically.'
        );

        await userEvent.click(screen.getByRole('button', { name: 'Merge' }));

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith('/api/relationships/2/merge', { source_id: 1 });
        });
        // One stack left, holding all three snapshots.
        await waitFor(() => {
            expect(screen.getAllByRole('button', { name: /^Stack actions for/ })).toHaveLength(1);
        });
        expect(screen.getByRole('button', { name: 'Stack actions for Alex M' })).toBeInTheDocument();
    });

    it('sets a check-in rhythm from the stack menu', async () => {
        axios.patch.mockResolvedValue({ data: { ID: 1, name: 'Alex', cadence_days: 90, snapshot_count: 2 } });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /check-in rhythm/i }));

        // Off is listed first and is what an unset relationship shows.
        expect(screen.getByRole('radio', { name: /Off/ })).toBeChecked();

        await userEvent.click(screen.getByRole('radio', { name: /Quarterly/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Save rhythm' }));

        await waitFor(() => {
            expect(axios.patch).toHaveBeenCalledWith('/api/relationships/1', { cadence_days: 90 });
        });
        // The stack header reports the rhythm it now keeps.
        expect(await screen.findByText(/quarterly/i)).toBeInTheDocument();
    });

    it('turns a rhythm off by sending an explicit null', async () => {
        mockFetch([alexV1, alexV2, alexM], [
            { ID: 1, name: 'Alex', cadence_days: 30 },
            { ID: 2, name: 'Alex M', cadence_days: null }
        ]);
        axios.patch.mockResolvedValue({ data: { ID: 1, name: 'Alex', cadence_days: null, snapshot_count: 2 } });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /check-in rhythm/i }));

        expect(screen.getByRole('radio', { name: /Monthly/ })).toBeChecked();
        await userEvent.click(screen.getByRole('radio', { name: /Off/ }));
        await userEvent.click(screen.getByRole('button', { name: 'Save rhythm' }));

        // Absent would mean "leave it alone"; null is what turns reminders off.
        await waitFor(() => {
            expect(axios.patch).toHaveBeenCalledWith('/api/relationships/1', { cadence_days: null });
        });
    });

    it('names the journal mentions a relationship delete will leave behind', async () => {
        mockFetch([alexV1, alexV2, alexM], [
            { ID: 1, name: 'Alex', snapshot_count: 2, mention_count: 4 },
            { ID: 2, name: 'Alex M', snapshot_count: 3, mention_count: 0 }
        ]);
        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /delete relationship/i }));

        expect(screen.getByText(/journal mentions/)).toHaveTextContent(
            '4 journal mentions of them stay: the entries are still there, and will no longer '
            + 'be linked to a person.'
        );
    });

    it('says nothing about the journal for someone the journal has never named', async () => {
        mockFetch([alexV1, alexV2, alexM], [
            { ID: 1, name: 'Alex', snapshot_count: 2, mention_count: 0 },
            { ID: 2, name: 'Alex M', snapshot_count: 3, mention_count: 0 }
        ]);
        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /delete relationship/i }));

        // A clause whose count is zero is left out, never rendered as "0 journal mentions".
        expect(screen.getByText(/All 2 snapshots of/)).toBeInTheDocument();
        expect(screen.queryByText(/journal mention/)).not.toBeInTheDocument();
    });

    it('spells out how many snapshots a relationship delete will take', async () => {
        axios.delete.mockResolvedValue({ data: { message: 'Relationship deleted' } });

        renderDashboard();
        await openMenu('Alex');
        await userEvent.click(screen.getByRole('menuitem', { name: /delete relationship/i }));

        expect(screen.getByText(/All 2 snapshots of/)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Delete 2 snapshots' }));

        await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/relationships/1'));
        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'Stack actions for Alex' })).not.toBeInTheDocument();
        });
        expect(screen.getByRole('button', { name: 'Stack actions for Alex M' })).toBeInTheDocument();
    });
});
