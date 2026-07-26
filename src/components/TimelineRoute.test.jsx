import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import axios from 'axios';
import TimelineRoute, { timelinePath, LegacyTimelineRedirect } from './TimelineRoute';
import { SubjectsProvider } from '../context/SubjectsContext';
import { DiscretionProvider } from '../context/DiscretionContext';

vi.mock('axios');

const alex = {
    ID: 1, relationship_id: 7, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: { eros: 40 }, tags: [], description: ''
};

const mockFetch = ({ subjects = [alex], relationships = [{ ID: 7, name: 'Alex', snapshot_count: 1 }] } = {}) => {
    axios.get.mockImplementation((url) => Promise.resolve({
        data: url === '/api/relationships' ? relationships : subjects
    }));
};

const renderAt = (path) => render(
    <MemoryRouter initialEntries={[path]}>
        <DiscretionProvider>
            <SubjectsProvider>
                <Routes>
                    <Route path="/" element={<div>dashboard</div>} />
                    <Route path="/relationships/:id/timeline" element={<TimelineRoute />} />
                    <Route path="/timeline/:name" element={<LegacyTimelineRedirect />} />
                </Routes>
            </SubjectsProvider>
        </DiscretionProvider>
    </MemoryRouter>
);

describe('timelinePath', () => {
    it('addresses a stack by relationship id, so the link survives a rename', () => {
        expect(timelinePath(7)).toBe('/relationships/7/timeline');
    });
});

describe('TimelineRoute', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch();
    });

    it('fetches on direct entry and renders the stack it was asked for', async () => {
        renderAt(timelinePath(7));

        expect(await screen.findByText(/Timeline Analysis:/)).toBeInTheDocument();
        expect(screen.getByText('Alex')).toBeInTheDocument();
    });

    it('renders a name that would otherwise need URL encoding', async () => {
        // The name is no longer in the URL at all, which is the point.
        mockFetch({
            subjects: [{ ...alex, name: 'Sam & Jo' }],
            relationships: [{ ID: 7, name: 'Sam & Jo', snapshot_count: 1 }]
        });

        renderAt(timelinePath(7));

        expect(await screen.findByText('Sam & Jo')).toBeInTheDocument();
    });

    it('shows an empty state for a relationship with no snapshots', async () => {
        renderAt(timelinePath(999));

        expect(await screen.findByText(/No analysis here/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /back to your analyses/i })).toBeInTheDocument();
    });

    it('surfaces a load failure rather than claiming the stack is empty', async () => {
        axios.get.mockRejectedValue({ response: { data: { error: 'Failed to fetch subjects' } } });

        renderAt(timelinePath(7));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch subjects');
        expect(screen.queryByText(/No analysis here/)).not.toBeInTheDocument();
    });
});

describe('LegacyTimelineRedirect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch();
    });

    it('resolves an old name-based link to the relationship it names', async () => {
        renderAt('/timeline/Alex');

        expect(await screen.findByText(/Timeline Analysis:/)).toBeInTheDocument();
        expect(screen.getByText('Alex')).toBeInTheDocument();
    });

    it('decodes the name from the URL exactly once', async () => {
        mockFetch({
            subjects: [{ ...alex, name: 'Sam & Jo' }],
            relationships: [{ ID: 7, name: 'Sam & Jo', snapshot_count: 1 }]
        });

        renderAt(`/timeline/${encodeURIComponent('Sam & Jo')}`);

        expect(await screen.findByText('Sam & Jo')).toBeInTheDocument();
    });

    it('explains itself when the name no longer matches anything', async () => {
        renderAt('/timeline/Renamed%20Since');

        expect(await screen.findByText(/No analysis for/)).toHaveTextContent('Renamed Since');
        expect(screen.getByText(/older link/)).toBeInTheDocument();
    });
});
