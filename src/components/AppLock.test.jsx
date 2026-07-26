import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AppLock, { hashPassphrase, readLockHash, setLockHash, isLockAvailable } from './AppLock';

describe('AppLock', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('passes the app straight through when no passphrase is set', () => {
        render(<AppLock><p>the dashboard</p></AppLock>);

        expect(screen.getByText('the dashboard')).toBeInTheDocument();
        expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
    });

    it('stores a hash, never the passphrase itself', async () => {
        const hash = await hashPassphrase('open sesame');

        expect(hash).toMatch(/^[0-9a-f]{64}$/);
        setLockHash(hash);

        const stored = JSON.stringify(window.localStorage);
        expect(stored).not.toContain('open sesame');
        expect(readLockHash()).toBe(hash);
    });

    it('covers the app on load once a passphrase is set, and opens for the right one', async () => {
        setLockHash(await hashPassphrase('open sesame'));

        render(<AppLock><p>the dashboard</p></AppLock>);

        expect(screen.queryByText('the dashboard')).not.toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Locked' })).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Passphrase'), 'not it');
        await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/does not match/);
        expect(screen.queryByText('the dashboard')).not.toBeInTheDocument();

        await userEvent.clear(screen.getByLabelText('Passphrase'));
        await userEvent.type(screen.getByLabelText('Passphrase'), 'open sesame');
        await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

        expect(await screen.findByText('the dashboard')).toBeInTheDocument();
    });

    it('says on the lock screen what it does not do', async () => {
        setLockHash(await hashPassphrase('open sesame'));

        render(<AppLock><p>the dashboard</p></AppLock>);

        // The honest-copy requirement, asserted so it cannot quietly disappear.
        expect(screen.getByText(/does not encrypt anything/)).toBeInTheDocument();
        expect(screen.getByText(/clear this site's data/)).toBeInTheDocument();
    });

    it('reports availability from the platform rather than assuming it', () => {
        expect(isLockAvailable()).toBe(Boolean(globalThis.crypto?.subtle));
    });
});
