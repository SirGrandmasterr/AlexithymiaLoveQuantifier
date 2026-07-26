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
            get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn()
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

describe('App — the login handoff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.responseHandlers.length = 0;
        localStorage.clear();
        axios.defaults.headers.common = {};
        window.history.pushState({}, '', '/');
        axios.post.mockResolvedValue({ data: { token: 'fresh-token' } });
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

    it('signs the user out when a request really does come back 401', async () => {
        axios.get.mockResolvedValue({ data: [] });

        render(<App />);
        await signIn();
        await screen.findByRole('button', { name: /new analysis/i });

        // Fire the registered interceptor the way axios would on a genuine 401.
        const onError = mocks.responseHandlers.at(-1);
        await act(async () => {
            await onError({ response: { status: 401 } }).catch(() => { });
        });

        expect(await screen.findByRole('link', { name: /start analyzing/i })).toBeInTheDocument();
        expect(localStorage.getItem('token')).toBeNull();
    });
});
