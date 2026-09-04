import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';
import { resetSessionLost } from './auth/session';

const mocks = vi.hoisted(() => {
    const responseHandlers = [];
    const requestHandlers = [];
    const instance = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    };
    return {
        responseHandlers,
        requestHandlers,
        axios: {
            defaults: { headers: { common: {} } },
            interceptors: {
                request: {
                    use: vi.fn((onFulfilled) => requestHandlers.push(onFulfilled) - 1),
                    eject: vi.fn()
                },
                response: {
                    use: vi.fn((onOk, onError) => responseHandlers.push(onError) - 1),
                    eject: vi.fn()
                }
            },
            create: vi.fn(() => instance),
            get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
            // The interceptor replays a failed request through this after renewing.
            request: vi.fn()
        }
    };
});

vi.mock('axios', () => ({ default: mocks.axios }));

const signIn = async () => {
    await userEvent.click(screen.getByRole('link', { name: /start analyzing/i }));
    await userEvent.type(screen.getByPlaceholderText('name@example.com'), 'user@example.com');
    await userEvent.type(screen.getByPlaceholderText('••••••••'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
};

const fire401 = async (config = { url: '/api/subjects', headers: {} }) => {
    const onError = mocks.responseHandlers[0];
    await act(async () => {
        await onError({ response: { status: 401 }, config }).catch(() => { });
    });
};

/** Push one outgoing request through the request interceptor and return what axios would send. */
const sendRequest = (config = { url: '/api/subjects', headers: {} }) => (
    mocks.requestHandlers[0](config)
);

describe('App — the login handoff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Deliberately *not* clearing the handler arrays: see `fire401`.
        localStorage.clear();
        sessionStorage.clear();
        resetSessionLost();
        axios.defaults.headers.common = {};
        window.history.pushState({}, '', '/');
        axios.post.mockResolvedValue({
            data: { token: 'fresh-token', refresh_token: 'refresh-one', expires_in: 86400 }
        });
        axios.request.mockResolvedValue({ data: [] });
    });

    it('sends the auth header on the very first request after logging in', async () => {
        // The provider loads two endpoints; only the first one's header matters here.
        const headersAtFetchTime = [];
        axios.get.mockImplementation(() => {
            headersAtFetchTime.push(axios.defaults.headers.common['Authorization']);
            return Promise.resolve({ data: [] });
        });

        render(<App />);
        await signIn();

        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/subjects'));

        // The whole point: the first fetch after login must not go out anonymous, or the
        // server 401s and the interceptor signs the user straight back out.
        expect(headersAtFetchTime[0]).toBe('Bearer fresh-token');
    });

    it('lands on the dashboard, not back on the landing page', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();

        expect(await screen.findByRole('button', { name: /new analysis/i })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /start analyzing/i })).not.toBeInTheDocument();
    });

    it('renews the session and replays the request when a 401 arrives', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        axios.post.mockResolvedValueOnce({
            data: { token: 'renewed-token', refresh_token: 'refresh-two', expires_in: 86400 }
        });

        await fire401();

        expect(axios.post).toHaveBeenCalledWith(
            '/api/refresh',
            { refresh_token: 'refresh-one' },
            { __isSessionCall: true }
        );
        // Replayed with the new credential, and marked so a second 401 cannot loop here.
        expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
            url: '/api/subjects',
            __isRetry: true,
            headers: expect.objectContaining({ Authorization: 'Bearer renewed-token' })
        }));

        // Still on the dashboard, still signed in, and the stored token has moved on.
        expect(screen.getByRole('button', { name: /new analysis/i })).toBeInTheDocument();
        expect(localStorage.getItem('token')).toBe('renewed-token');
    });

    it('treats a session it cannot renew as never having been signed in', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        axios.post.mockRejectedValueOnce({ response: { status: 401 } });

        await fire401();

        // Landing, not the dashboard, and no overlay explaining a thing the user cannot act on.
        expect(await screen.findByRole('link', { name: /start analyzing/i })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /new analysis/i })).not.toBeInTheDocument();

        // Both halves are gone, so nothing tries to spend the refused credential again.
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('alq:refresh-token')).toBeNull();
    });

    it('sends a lost session to the login page from a protected route', async () => {
        axios.get.mockResolvedValue({ data: [] });
        window.history.pushState({}, '', '/vault');

        render(<App />);
        await waitFor(() => expect(screen.getByPlaceholderText('name@example.com')).toBeInTheDocument());
    });

    it('renews before an outgoing request when the stored token has aged out', async () => {
        localStorage.setItem('token', 'stale-token');
        localStorage.setItem('alq:refresh-token', 'refresh-one');
        localStorage.setItem('alq:token-expires-at', String(Date.now() - 1000));

        axios.post.mockResolvedValueOnce({
            data: { token: 'renewed-token', refresh_token: 'refresh-two', expires_in: 86400 }
        });

        const sent = await sendRequest({ url: '/api/subjects', headers: { Authorization: 'Bearer stale-token' } });

        expect(axios.post).toHaveBeenCalledWith(
            '/api/refresh',
            { refresh_token: 'refresh-one' },
            { __isSessionCall: true }
        );
        // The request that would have failed carries the new credential instead.
        expect(sent.headers.Authorization).toBe('Bearer renewed-token');
    });

    it('does not hold up a request while the token is still good', async () => {
        localStorage.setItem('token', 'good-token');
        localStorage.setItem('alq:refresh-token', 'refresh-one');
        localStorage.setItem('alq:token-expires-at', String(Date.now() + 86400 * 1000));

        await sendRequest();

        expect(axios.post).not.toHaveBeenCalledWith('/api/refresh', expect.anything(), expect.anything());
    });

    // `/api/refresh` cannot wait for itself.
    it('exempts the renewal call from the request interceptor', async () => {
        localStorage.setItem('token', 'stale-token');
        localStorage.setItem('alq:refresh-token', 'refresh-one');
        localStorage.setItem('alq:token-expires-at', String(Date.now() - 1000));

        await sendRequest({ url: '/api/refresh', headers: {}, __isSessionCall: true });

        expect(axios.post).not.toHaveBeenCalled();
    });

    it('revokes the session server-side on an explicit log out', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        await userEvent.click(screen.getByRole('button', { name: /log out/i }));

        expect(axios.post).toHaveBeenCalledWith(
            '/api/logout',
            { refresh_token: 'refresh-one' },
            { __isSessionCall: true }
        );
        expect(await screen.findByRole('link', { name: /start analyzing/i })).toBeInTheDocument();
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('alq:refresh-token')).toBeNull();
    });
});
