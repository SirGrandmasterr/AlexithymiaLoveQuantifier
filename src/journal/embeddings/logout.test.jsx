import React from 'react';
import { render, waitFor } from '@testing-library/react';
import axios from 'axios';
import { JournalProvider } from '../../context/JournalContext';
import { SubjectsProvider } from '../../context/SubjectsContext';
import { clearVectorIndex } from './store';

vi.mock('axios');
vi.mock('./store', async (importOriginal) => ({
    ...(await importOriginal()),
    clearVectorIndex: vi.fn(async () => {})
}));

const tree = (enabled) => (
    <SubjectsProvider enabled={enabled}>
        <JournalProvider enabled={enabled}><div /></JournalProvider>
    </SubjectsProvider>
);

const renderProvider = (enabled) => render(tree(enabled));

beforeEach(() => {
    vi.clearAllMocks();
    axios.get.mockResolvedValue({ data: [] });
});

describe('signing out', () => {
    it('empties the embedding index on the branch that has no session', async () => {
        const { rerender } = renderProvider(true);
        await waitFor(() => expect(axios.get).toHaveBeenCalled());
        expect(clearVectorIndex).not.toHaveBeenCalled();

        rerender(tree(false));

        await waitFor(() => expect(clearVectorIndex).toHaveBeenCalled());
    });

    it('does it on a provider that starts with no session, not only on a transition', async () => {
        renderProvider(false);
        await waitFor(() => expect(clearVectorIndex).toHaveBeenCalled());
    });

    it('does not hold the logout open on a store that refuses', async () => {
        clearVectorIndex.mockRejectedValueOnce(new Error('quota'));
        // The provider must not reject into an unhandled rejection; the render is the assertion.
        renderProvider(false);
        await waitFor(() => expect(clearVectorIndex).toHaveBeenCalled());
    });
});
