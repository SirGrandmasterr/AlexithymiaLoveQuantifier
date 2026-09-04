import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import JournalInsights, { DEFAULT_SERIES, insightsInfo } from './JournalInsights';
import { SubjectsProvider } from '../context/SubjectsContext';
import { JournalProvider } from '../context/JournalContext';
import { DiscretionProvider, BLUR_CLASS } from '../context/DiscretionContext';
import { JOURNAL_COPY, fillCopy } from '../constants/journal';
import { UNSTATED_INTENSITY } from './dayGraph.js';
import { EWMA_HALFLIFE } from '../journal/analytics/drift';
import { MAX_SERIES } from '../journal/analytics/charts';

vi.mock('axios');

const relationships = [{ ID: 7, name: 'Lucie', snapshot_count: 0 }, { ID: 8, name: 'Alex', snapshot_count: 1 }];

const MEETING = '0b7e0000-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORK = '0b7e0000-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let nextId = 1;

const trigger = (id, label, role) => ({
    ID: nextId++, client_id: id, kind: 'trigger', day: '2026-08-01', at: '2026-08-01T09:00:00Z', schema_version: 1,
    payload: { v: 1, label, merged_into: null, ...(role ? { role } : {}) }, superseded_at: null, supersedes_id: null, mentions: []
});

const checkin = (day, feelings, people = []) => ({
    ID: nextId++, client_id: `checkin-${nextId}`, kind: 'checkin', day, at: `${day}T09:00:00Z`, schema_version: 1,
    payload: { v: 1, source: 'chips', feelings },
    superseded_at: null, supersedes_id: null,
    mentions: people.map((relationshipId, ref) => ({ ID: nextId++, ref, relationship_id: relationshipId, label: '' }))
});

const aboutLucieMeeting = [{ kind: 'person', ref: 0 }, { kind: 'trigger', trigger: MEETING }];

const journal = [
    trigger(MEETING, 'meeting', 'interaction'),
    trigger(WORK, 'work'),
    checkin('2026-08-01', [{ id: 'affection', intensity: 2, quote: 'lovely evening', about: aboutLucieMeeting }], [7]),
    checkin('2026-08-04', [{ id: 'stress', intensity: 3, about: [{ kind: 'trigger', trigger: WORK }] }]),
    checkin('2026-08-08', [{ id: 'anxiety', intensity: 2, about: aboutLucieMeeting }], [7]),
    checkin('2026-08-12', [{ id: 'calm', intensity: 1, about: [{ kind: 'person', ref: 0 }] }], [8])
];

const mockFetch = ({ entries = [], days = [], rels = relationships } = {}) => {
    axios.get.mockImplementation((url) => {
        if (url === '/api/relationships') return Promise.resolve({ data: rels });
        if (url === '/api/journal/entries') return Promise.resolve({ data: entries });
        if (url === '/api/journal/days') return Promise.resolve({ data: days });
        return Promise.resolve({ data: [] });
    });
};

const renderInsights = () => render(
    <MemoryRouter initialEntries={['/journal/insights']}>
        <DiscretionProvider>
            <SubjectsProvider>
                <JournalProvider>
                    <Routes>
                        <Route path="/journal/insights" element={<JournalInsights />} />
                    </Routes>
                </JournalProvider>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

const view = () => document.querySelector('[data-journal-view="insights"]');
const picks = () => [...document.querySelectorAll('[data-series-pick]')];

beforeEach(() => {
    vi.clearAllMocks();
    nextId = 1;
    window.localStorage.clear();
});

describe('the Insights screen', () => {
    it('loads the whole record, not a month', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        // The provider's first fetch is the default month; the screen's `loadAll` widens it.
        const calls = axios.get.mock.calls.filter(([url]) => url === '/api/journal/entries');
        expect(calls.at(-1)[1].params.from).toBe('1970-01-01');
    });

    it('says so when there is nothing to draw', async () => {
        mockFetch({ entries: [] });
        renderInsights();
        expect(await screen.findByText(JOURNAL_COPY.insights.empty)).toBeInTheDocument();
        expect(view()).toBeNull();
    });

    it('draws the pair level by default: every drawing present, one series per pair, and the pairs named the EmotionGuesser way', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        expect(screen.getByRole('heading', { name: JOURNAL_COPY.insights.heading })).toBeInTheDocument();
        expect(document.querySelector('[data-segment="level:pair"]')).toHaveAttribute('aria-pressed', 'true');
        expect(picks().map(button => button.textContent)).toEqual(['Lucie · meeting2', 'Alex1', 'work1']);

        ['circumplex', 'drift', 'series', 'heatmap', 'weekly', 'radar'].forEach(card => (
            expect(document.querySelector(`[data-insights-card="${card}"]`)).toBeInTheDocument()
        ));
        // Hand-drawn SVG, so the test can count what is on it (invariant 19).
        expect(document.querySelectorAll('[data-insights-circumplex] [data-series]')).toHaveLength(3);
        expect(document.querySelectorAll('[data-insights-circumplex] [data-series="person:7|trigger:' + MEETING + '"] [data-point]')).toHaveLength(2);
        expect(document.querySelectorAll('[data-insights-circumplex] [data-anchor]').length).toBeGreaterThan(20);
        // Only the pair named twice has a drift bar.
        expect(document.querySelectorAll('[data-insights-drift] [data-bar]')).toHaveLength(1);
        expect(document.querySelector('[data-insights-drift] [data-bar]')).toHaveAttribute('data-polarity', 'away');
        expect(document.querySelectorAll('[data-insights-heatmap] [data-heat-row]')).toHaveLength(3);
        expect(document.querySelectorAll('[data-insights-weekly] [data-strip]')).toHaveLength(3);
        expect(document.querySelector('[data-insights-radar] [data-radar-polygon]')).toBeInTheDocument();
    });

    it('re-keys the table when the level changes, and the picks start over', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        await userEvent.click(document.querySelector('[data-segment="level:person"]'));
        expect(picks().map(button => button.textContent)).toEqual(['Lucie2', 'Alex1']);
        expect(document.querySelectorAll('[data-insights-circumplex] [data-series]')).toHaveLength(2);

        await userEvent.click(document.querySelector('[data-segment="level:trigger"]'));
        expect(picks().map(button => button.textContent)).toEqual(['meeting2', 'work1']);
        // The trigger level pools both halves: the meeting is named with Lucie both times.
        expect(document.querySelector('[data-companions]')).toHaveTextContent('Lucie (2)');
    });

    it('lets the user put a series down and pick it up, and caps the picks', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        const work = document.querySelector(`[data-series-pick="trigger:${WORK}"]`);
        expect(work).toHaveAttribute('aria-pressed', 'true');
        await userEvent.click(work);
        expect(work).toHaveAttribute('aria-pressed', 'false');
        expect(document.querySelectorAll('[data-insights-circumplex] [data-series]')).toHaveLength(2);
        await userEvent.click(work);
        expect(work).toHaveAttribute('aria-pressed', 'true');
        expect(DEFAULT_SERIES).toBeLessThanOrEqual(MAX_SERIES);
    });

    it('states its figures as sentences, and the drawing choices behind them in the ⓘ', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        const figures = document.querySelector('[data-focus-figures]');
        expect(figures).toHaveTextContent(fillCopy(JOURNAL_COPY.insights.series1.count, { count: 2 }));
        expect(figures).toHaveTextContent('Smoothed position now:');
        expect(figures).toHaveTextContent('Since the first time:');
        expect(figures).toHaveTextContent('per thirty days');

        await userEvent.click(document.querySelector('[data-insights-info]'));
        const info = document.querySelector('[data-insights-info-body]');
        expect(info).toHaveTextContent(JOURNAL_COPY.insights.caveat);
        expect(info).toHaveTextContent(fillCopy(JOURNAL_COPY.insights.unstated, { strength: UNSTATED_INTENSITY }));
        expect(info).toHaveTextContent(fillCopy(JOURNAL_COPY.insights.smoothing, { halflife: EWMA_HALFLIFE }));
        expect(insightsInfo()).toHaveLength(4);
    });

    it('switches the drift axis and the focused series’ axis', async () => {
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        await userEvent.click(document.querySelector('[data-segment="drift:dominance"]'));
        expect(document.querySelector('[data-segment="drift:dominance"]')).toHaveAttribute('aria-pressed', 'true');
        expect(document.querySelector('[data-insights-drift]')).toHaveTextContent(JOURNAL_COPY.insights.drift.axis.dominance);

        await userEvent.click(document.querySelector('[data-segment="focus-dim:intensity"]'));
        expect(document.querySelectorAll('[data-insights-timeseries] [data-point]')).toHaveLength(2);

        await userEvent.selectOptions(document.querySelector('[data-focus-pick]'), `trigger:${WORK}`);
        expect(document.querySelectorAll('[data-insights-timeseries] [data-point]')).toHaveLength(1);
    });

    it('masks names and blurs labels under discretion', async () => {
        window.localStorage.setItem('alq:discreet', 'true');
        mockFetch({ entries: journal });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());

        const labels = picks().map(button => button.textContent);
        expect(labels.some(text => text.includes('Lucie'))).toBe(false);
        const work = document.querySelector(`[data-series-pick="trigger:${WORK}"] span:not([style])`);
        expect(work.className).toContain(BLUR_CLASS.split(' ')[0]);
    });

    it('draws the day-graph constant, not a silent middle, for a strength that was not stated', async () => {
        mockFetch({ entries: [
            trigger(WORK, 'work'),
            checkin('2026-08-01', [{ id: 'calm', about: [{ kind: 'trigger', trigger: WORK }] }])
        ] });
        renderInsights();
        await waitFor(() => expect(view()).toBeInTheDocument());
        expect(document.querySelector('[data-focus-figures]')).toHaveTextContent(fillCopy(JOURNAL_COPY.insights.series1.count, { count: 1 }));
    });
});
