import axios from 'axios';
import {
    saveSession,
    clearSession,
    readAccessToken,
    readRefreshToken,
    needsRenewal,
    refreshSession,
    renewIfDue,
    endSession
} from './session';

vi.mock('axios');

const session = (n) => ({ token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 86400 });

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    axios.defaults = { headers: { common: {} } };
});

describe('saveSession', () => {
    it('applies the header and stores both halves', () => {
        saveSession(session(1));

        expect(axios.defaults.headers.common['Authorization']).toBe('Bearer access-1');
        expect(readAccessToken()).toBe('access-1');
        expect(readRefreshToken()).toBe('refresh-1');
    });

    // A self-hosted server predating the renewal endpoint answers with a bare token. That
    // has to keep working — it is the old behaviour, not a broken one.
    it('signs in against a server that returns no refresh token', () => {
        saveSession({ token: 'access-only' });

        expect(readAccessToken()).toBe('access-only');
        expect(readRefreshToken()).toBeNull();
        expect(needsRenewal()).toBe(false);
    });
});

describe('needsRenewal', () => {
    it('is false well before expiry and true inside the margin', () => {
        saveSession(session(1));
        expect(needsRenewal()).toBe(false);

        // Five minutes of life left: inside the margin, so renew now rather than after a
        // request has already failed.
        localStorage.setItem('alq:token-expires-at', String(Date.now() + 60 * 1000));
        expect(needsRenewal()).toBe(true);
    });

    it('is true for a session stored before expiry was recorded', () => {
        localStorage.setItem('token', 'legacy');
        localStorage.setItem('alq:refresh-token', 'refresh-legacy');

        expect(needsRenewal()).toBe(true);
    });
});

describe('refreshSession', () => {
    it('shares one request between concurrent callers', async () => {
        saveSession(session(1));
        axios.post.mockResolvedValue({ data: session(2) });

        // The dashboard loads subjects and relationships in parallel, so two 401s arriving
        // together is the normal case. Two refreshes would spend two tokens from a rotating
        // family, and the server reads the second as a replay — it would revoke everything
        // and sign the user out. This is the test for that.
        const [first, second, third] = await Promise.all([
            refreshSession(), refreshSession(), refreshSession()
        ]);

        expect(axios.post).toHaveBeenCalledTimes(1);
        expect([first, second, third]).toEqual(['access-2', 'access-2', 'access-2']);
        expect(readRefreshToken()).toBe('refresh-2');
    });

    it('ends the session when the token is refused', async () => {
        saveSession(session(1));
        axios.post.mockRejectedValue({ response: { status: 401 } });

        expect(await refreshSession()).toBeNull();
        expect(readAccessToken()).toBeNull();
        expect(readRefreshToken()).toBeNull();
    });

    // The difference between "your session is over" and "you are on a train".
    it('keeps the session through a server error or a dead network', async () => {
        saveSession(session(1));
        axios.post.mockRejectedValue({ response: { status: 503 } });

        expect(await refreshSession()).toBeNull();
        expect(readRefreshToken()).toBe('refresh-1');

        axios.post.mockRejectedValue(new Error('Network Error'));

        expect(await refreshSession()).toBeNull();
        expect(readRefreshToken()).toBe('refresh-1');
    });

    it('does nothing without a refresh token', async () => {
        saveSession({ token: 'access-only' });

        expect(await refreshSession()).toBeNull();
        expect(axios.post).not.toHaveBeenCalled();
    });
});

describe('renewIfDue', () => {
    it('stays quiet while the token is still good', async () => {
        saveSession(session(1));

        expect(await renewIfDue()).toBe(false);
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('renews once the token is inside its margin', async () => {
        saveSession(session(1));
        localStorage.setItem('alq:token-expires-at', String(Date.now() + 1000));
        axios.post.mockResolvedValue({ data: session(2) });

        expect(await renewIfDue()).toBe(true);
        expect(readAccessToken()).toBe('access-2');
    });
});

describe('endSession', () => {
    it('revokes server-side and forgets locally', async () => {
        saveSession(session(1));
        axios.post.mockResolvedValue({ status: 204 });

        await endSession();

        expect(axios.post).toHaveBeenCalledWith(
            '/api/logout',
            { refresh_token: 'refresh-1' },
            { __isSessionCall: true }
        );
        expect(readAccessToken()).toBeNull();
        expect(readRefreshToken()).toBeNull();
    });

    // Pressing "log out" on a train has still logged the user out.
    it('forgets the session even when the server cannot be reached', async () => {
        saveSession(session(1));
        axios.post.mockRejectedValue(new Error('Network Error'));

        await endSession();

        expect(readAccessToken()).toBeNull();
        expect(readRefreshToken()).toBeNull();
    });
});

describe('clearSession', () => {
    it('drops the header as well as the storage', () => {
        saveSession(session(1));
        clearSession();

        expect(axios.defaults.headers.common['Authorization']).toBeUndefined();
        expect(readAccessToken()).toBeNull();
    });
});
