import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axios from 'axios';
import App from './App';

// A hand-built axios mock: the automock returns undefined from `axios.create()`, which
// Profile.jsx calls at module scope. This one also records the response interceptors so a
// test can fire the 401 path the way axios would.
const mocks = vi.hoisted(() => {
    const responseHandlers = [];
    const instance = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(),
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    };
    return {
        responseHandlers,
        axios: {
            defaults: { headers: { common: {} } },
            interceptors: {
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

/** Fire the registered interceptor's error handler the way axios would on a real 401. */
const fire401 = async (config = { url: '/api/subjects', headers: {} }) => {
    const onError = mocks.responseHandlers.at(-1);
    await act(async () => {
        await onError({ response: { status: 401 }, config }).catch(() => { });
    });
};

describe('App — the login handoff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.responseHandlers.length = 0;
        localStorage.clear();
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

    // A 401 used to be the end of the session. It is now the ordinary case: the token has
    // aged out, the refresh token buys a new one, and the request that failed is replayed.
    // The user is told nothing, because there is nothing for them to do.
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

    // Only when renewal is impossible does the user see anything, and what they see is a
    // prompt over the screen they were on rather than the landing page they were evicted to.
    it('asks for the passphrase in place when the session cannot be renewed', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        axios.post.mockRejectedValueOnce({ response: { status: 401 } });

        await fire401();

        expect(await screen.findByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/signed out for security/i)).toBeInTheDocument();
        // The dashboard is still mounted behind it: no navigation, so nothing typed there
        // is lost.
        expect(screen.getByRole('button', { name: /new analysis/i })).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: /start analyzing/i })).not.toBeInTheDocument();
        // The refused credential is gone, so the next 401 does not try to spend it again.
        expect(localStorage.getItem('alq:refresh-token')).toBeNull();
    });

    it('carries on where it was once the passphrase is given again', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        axios.post.mockRejectedValueOnce({ response: { status: 401 } });
        await fire401();
        await screen.findByRole('dialog');

        axios.post.mockResolvedValueOnce({
            data: { token: 'second-wind', refresh_token: 'refresh-three', expires_in: 86400 }
        });
        await userEvent.type(screen.getByLabelText(/password/i), 'password123');
        await userEvent.click(screen.getByRole('button', { name: /continue/i }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(screen.getByRole('button', { name: /new analysis/i })).toBeInTheDocument();
        expect(localStorage.getItem('token')).toBe('second-wind');
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
