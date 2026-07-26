import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import { SubjectsProvider, useSubjects, groupPeople, findStack, buildStacks } from './SubjectsContext';

vi.mock('axios');

const subject = (overrides) => ({
    ID: 1, relationship_id: 1, name: 'Alex', date: '2026-01-01T00:00:00Z', stats: {}, ...overrides
});

/** The two endpoints the provider loads together. */
const mockFetch = ({ subjects = [], relationships = [] } = {}) => {
    axios.get.mockImplementation((url) => Promise.resolve({
        data: url === '/api/relationships' ? relationships : subjects
    }));
};

describe('groupPeople', () => {
    it('groups versions by relationship, preserving first-seen order', () => {
        const people = [
            subject({ ID: 1, relationship_id: 1, name: 'Alex' }),
            subject({ ID: 2, relationship_id: 2, name: 'Sam' }),
            subject({ ID: 3, relationship_id: 1, name: 'Alex' })
        ];

        const groups = groupPeople(people);

        expect(groups).toHaveLength(2);
        expect(groups[0].map(p => p.ID)).toEqual([1, 3]);
        expect(groups[1].map(p => p.ID)).toEqual([2]);
    });

    it('keeps two relationships that share a display name apart', () => {
        // Impossible before Phase 4: name-based grouping merged two different people
        // called Alex into one stack, silently.
        const groups = groupPeople([
            subject({ ID: 1, relationship_id: 1, name: 'Alex' }),
            subject({ ID: 2, relationship_id: 2, name: 'Alex' })
        ]);

        expect(groups).toHaveLength(2);
    });

    it('groups a renamed stack together even though its versions disagree on the name', () => {
        // The server syncs the denormalized name, but a client holding a stale row must
        // not scatter the stack.
        const groups = groupPeople([
            subject({ ID: 1, relationship_id: 1, name: 'Alex' }),
            subject({ ID: 2, relationship_id: 1, name: 'Alexandra' })
        ]);

        expect(groups).toHaveLength(1);
    });

    it('gives an unlinked row its own stack rather than a shared undefined pile', () => {
        const groups = groupPeople([
            subject({ ID: 1, relationship_id: undefined }),
            subject({ ID: 2, relationship_id: undefined })
        ]);

        expect(groups).toHaveLength(2);
    });

    it('returns nothing for an empty list', () => {
        expect(groupPeople([])).toEqual([]);
    });
});

describe('findStack', () => {
    const people = [
        subject({ ID: 1, relationship_id: 1 }),
        subject({ ID: 2, relationship_id: 2, name: 'Sam' }),
        subject({ ID: 3, relationship_id: 1 })
    ];

    it('returns every version of one relationship', () => {
        expect(findStack(people, 1).map(p => p.ID)).toEqual([1, 3]);
    });

    it('returns an empty stack for an unknown relationship', () => {
        expect(findStack(people, 99)).toEqual([]);
    });
});

describe('buildStacks', () => {
    it('pairs each group with its relationship and counts the versions it actually has', () => {
        const stacks = buildStacks(
            [subject({ ID: 1, relationship_id: 1 }), subject({ ID: 2, relationship_id: 1 })],
            [{ ID: 1, name: 'Alexandra', snapshot_count: 7, cadence_days: 30 }]
        );

        expect(stacks).toHaveLength(1);
        expect(stacks[0].relationship).toMatchObject({ ID: 1, name: 'Alexandra', snapshot_count: 2 });
        // The rhythm comes from the server list; the latest date is derived from the
        // versions actually loaded, so it is fresh the moment one is added.
        expect(stacks[0].relationship.cadence_days).toBe(30);
        expect(stacks[0].relationship.latest_date).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('falls back to the name on the snapshot when the relationship is unknown', () => {
        const stacks = buildStacks([subject({ ID: 1, relationship_id: 4, name: 'Sam' })], []);

        expect(stacks[0].relationship.name).toBe('Sam');
        expect(stacks[0].versions.map(p => p.ID)).toEqual([1]);
    });
});

const Probe = () => {
    const {
        people, stacks, loading, loadError,
        createSubject, deleteSubject, renameRelationship, mergeRelationships, deleteRelationship
    } = useSubjects();

    return (
        <div>
            <span data-testid="state">{loading ? 'loading' : `${people.length} people`}</span>
            <span data-testid="stacks">{stacks.map(s => `${s.relationship.name}:${s.versions.length}`).join(' | ')}</span>
            {loadError && <span role="alert">{loadError}</span>}
            <button onClick={() => createSubject({ name: 'Sam' }).catch(() => { })}>create</button>
            <button onClick={() => deleteSubject(1).catch(() => { })}>delete</button>
            <button onClick={() => renameRelationship(1, 'Alexandra').catch(() => { })}>rename</button>
            <button onClick={() => mergeRelationships(1, 2).catch(() => { })}>merge</button>
            <button onClick={() => deleteRelationship(1).catch(() => { })}>delete stack</button>
        </div>
    );
};

describe('SubjectsProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockFetch({
            subjects: [subject({ ID: 1 })],
            relationships: [{ ID: 1, name: 'Alex', snapshot_count: 1 }]
        });
    });

    it('loads subjects and relationships once for every consumer', async () => {
        render(<SubjectsProvider><Probe /></SubjectsProvider>);

        expect(await screen.findByText('1 people')).toBeInTheDocument();
        expect(axios.get).toHaveBeenCalledWith('/api/subjects');
        expect(axios.get).toHaveBeenCalledWith('/api/relationships');
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('does not fetch for an anonymous visitor', async () => {
        render(<SubjectsProvider enabled={false}><Probe /></SubjectsProvider>);

        expect(await screen.findByText('0 people')).toBeInTheDocument();
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('exposes a load failure instead of an empty list', async () => {
        axios.get.mockRejectedValue({ response: { data: { error: 'Failed to fetch subjects' } } });

        render(<SubjectsProvider><Probe /></SubjectsProvider>);

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch subjects');
    });

    it('reports a failure even when only the relationships request fails', async () => {
        axios.get.mockImplementation((url) => (
            url === '/api/relationships'
                ? Promise.reject({ response: { data: { error: 'Failed to fetch relationships' } } })
                : Promise.resolve({ data: [subject({ ID: 1 })] })
        ));

        render(<SubjectsProvider><Probe /></SubjectsProvider>);

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch relationships');
    });

    it('splices a created row into shared state', async () => {
        axios.post.mockResolvedValue({ data: subject({ ID: 2, relationship_id: 2, name: 'Sam' }) });

        render(<SubjectsProvider><Probe /></SubjectsProvider>);
        await screen.findByText('1 people');

        await userEvent.click(screen.getByRole('button', { name: 'create' }));

        expect(await screen.findByText('2 people')).toBeInTheDocument();
        // A snapshot under a new name brings its relationship with it, so the new stack
        // shows the real name rather than waiting for a reload.
        expect(screen.getByTestId('stacks')).toHaveTextContent('Alex:1 | Sam:1');
    });

    it('removes a deleted row and leaves state alone when the delete fails', async () => {
        axios.delete.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce({});

        render(<SubjectsProvider><Probe /></SubjectsProvider>);
        await screen.findByText('1 people');

        await userEvent.click(screen.getByRole('button', { name: 'delete' }));
        expect(screen.getByTestId('state')).toHaveTextContent('1 people');

        await userEvent.click(screen.getByRole('button', { name: 'delete' }));
        await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('0 people'));
    });

    it('renames every version of a stack, not just the relationship', async () => {
        mockFetch({
            subjects: [subject({ ID: 1 }), subject({ ID: 2 })],
            relationships: [{ ID: 1, name: 'Alex', snapshot_count: 2 }]
        });
        axios.patch.mockResolvedValue({ data: { ID: 1, name: 'Alexandra', snapshot_count: 2 } });

        render(<SubjectsProvider><Probe /></SubjectsProvider>);
        await screen.findByText('2 people');

        await userEvent.click(screen.getByRole('button', { name: 'rename' }));

        await waitFor(() => expect(screen.getByTestId('stacks')).toHaveTextContent('Alexandra:2'));
        expect(axios.patch).toHaveBeenCalledWith('/api/relationships/1', { name: 'Alexandra' });
    });

    it('moves the source stack into the target on merge', async () => {
        mockFetch({
            subjects: [subject({ ID: 1, relationship_id: 1 }), subject({ ID: 2, relationship_id: 2, name: 'Alex M' })],
            relationships: [
                { ID: 1, name: 'Alex', snapshot_count: 1 },
                { ID: 2, name: 'Alex M', snapshot_count: 1 }
            ]
        });
        axios.post.mockResolvedValue({ data: { ID: 1, name: 'Alex', snapshot_count: 2 } });

        render(<SubjectsProvider><Probe /></SubjectsProvider>);
        await waitFor(() => expect(screen.getByTestId('stacks')).toHaveTextContent('Alex:1 | Alex M:1'));

        await userEvent.click(screen.getByRole('button', { name: 'merge' }));

        await waitFor(() => expect(screen.getByTestId('stacks')).toHaveTextContent('Alex:2'));
        expect(screen.getByTestId('stacks')).not.toHaveTextContent('Alex M');
        expect(axios.post).toHaveBeenCalledWith('/api/relationships/1/merge', { source_id: 2 });
    });

    it('drops every version when the whole relationship is deleted', async () => {
        mockFetch({
            subjects: [subject({ ID: 1 }), subject({ ID: 2 }), subject({ ID: 3, relationship_id: 2, name: 'Sam' })],
            relationships: [{ ID: 1, name: 'Alex', snapshot_count: 2 }, { ID: 2, name: 'Sam', snapshot_count: 1 }]
        });
        axios.delete.mockResolvedValue({ data: { message: 'Relationship deleted' } });

        render(<SubjectsProvider><Probe /></SubjectsProvider>);
        await screen.findByText('3 people');

        await userEvent.click(screen.getByRole('button', { name: 'delete stack' }));

        await waitFor(() => expect(screen.getByTestId('stacks')).toHaveTextContent('Sam:1'));
        expect(screen.getByTestId('state')).toHaveTextContent('1 people');
        expect(axios.delete).toHaveBeenCalledWith('/api/relationships/1');
    });
});
