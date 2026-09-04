import axios from 'axios';
import {
    saveSession,
    clearSession,
    readAccessToken,
    readRefreshToken,
    needsRenewal,
    refreshSession,
    renewIfDue,
    endSession,
    subscribeSessionLost,
    resetSessionLost,
    withFreshToken,
    recoverFrom401,
    isStayingSignedIn,
    setStaySignedIn,
    rememberEmail,
    lastEmail
} from './session';

vi.mock('axios');

const session = (n) => ({ token: `access-${n}`, refresh_token: `refresh-${n}`, expires_in: 86400 });

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
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

describe('staying signed in', () => {
    // Absent means yes. Anything else would sign every existing install out in order to
    // introduce a feature about not being signed out.
    it('defaults to on for someone who has never chosen', () => {
        expect(isStayingSignedIn()).toBe(true);

        saveSession(session(1));

        expect(localStorage.getItem('token')).toBe('access-1');
        expect(sessionStorage.getItem('token')).toBeNull();
    });

    it('keeps the session out of localStorage when it is turned off', () => {
        setStaySignedIn(false);
        saveSession(session(1));
        rememberEmail('user@example.com');

        // sessionStorage dies with the tab, which is the honest meaning of the checkbox.
        expect(sessionStorage.getItem('token')).toBe('access-1');
        expect(sessionStorage.getItem('alq:refresh-token')).toBe('refresh-1');
        expect(localStorage.getItem('token')).toBeNull();
        expect(localStorage.getItem('alq:refresh-token')).toBeNull();

        // Nor is there a trace of who used the machine.
        expect(localStorage.getItem('alq:last-email')).toBeNull();
        expect(lastEmail()).toBe('user@example.com');
    });

    // Reading it back has to go through the same switch, or the app signs itself out.
    it('reads its own session back after turning it off', () => {
        setStaySignedIn(false);
        saveSession(session(1));

        expect(readAccessToken()).toBe('access-1');
        expect(readRefreshToken()).toBe('refresh-1');
        expect(needsRenewal()).toBe(false);
    });

    // Ticking the box halfway through an evening must not sign you out; that would teach
    // the user never to touch it.
    it('moves a live session between the two stores instead of ending it', () => {
        saveSession(session(1));
        rememberEmail('user@example.com');

        setStaySignedIn(false);

        expect(readAccessToken()).toBe('access-1');
        expect(readRefreshToken()).toBe('refresh-1');
        expect(lastEmail()).toBe('user@example.com');
        expect(localStorage.getItem('token')).toBeNull();

        setStaySignedIn(true);

        expect(readAccessToken()).toBe('access-1');
        expect(localStorage.getItem('token')).toBe('access-1');
        expect(sessionStorage.getItem('token')).toBeNull();
    });

    it('is a no-op when the choice has not changed', () => {
        saveSession(session(1));

        setStaySignedIn(true);

        expect(localStorage.getItem('token')).toBe('access-1');
    });
});

// The two interceptor functions are exported by name, so these tests drive the real code
// paths rather than reaching into axios's mock to find what was registered.
const responseErrorHandler = recoverFrom401;
const requestHandler = withFreshToken;

const fire401 = async (config = { url: '/api/subjects', headers: {} }) => {
    await responseErrorHandler({ response: { status: 401 }, config }).catch(() => { });
};

describe('losing the session', () => {
    beforeEach(() => resetSessionLost());

    it('tells a subscriber that arrives after the session already died', async () => {
        saveSession({ token: 'dead' });   // no refresh token: nothing to renew with

        await fire401();

        const handler = vi.fn();
        subscribeSessionLost(handler);

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('announces once however many requests fail', async () => {
        saveSession({ token: 'dead' });
        const handler = vi.fn();
        subscribeSessionLost(handler);

        await fire401({ url: '/api/subjects', headers: {} });
        await fire401({ url: '/api/relationships', headers: {} });

        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('forgets it once a new session is saved', async () => {
        saveSession({ token: 'dead' });
        await fire401();

        saveSession(session(9));

        const handler = vi.fn();
        subscribeSessionLost(handler);
        expect(handler).not.toHaveBeenCalled();
    });

    // A wrong password on the sign-in form is not a session to renew, and /api/refresh
    // answering 401 is the session ending rather than something to retry.
    it('leaves session calls alone', async () => {
        saveSession(session(1));

        await expect(
            responseErrorHandler({ response: { status: 401 }, config: { url: '/api/login', __isSessionCall: true } })
        ).rejects.toBeTruthy();

        expect(axios.post).not.toHaveBeenCalled();
    });

    it('does not renew a request that carries no refresh token', async () => {
        saveSession({ token: 'access-only' });

        const sent = await requestHandler({ url: '/api/subjects', headers: {} });

        expect(axios.post).not.toHaveBeenCalled();
        expect(sent.headers.Authorization).toBeUndefined();
    });
});
