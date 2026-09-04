import axios from 'axios';

// Unchanged from when App.jsx owned this: an existing install must stay signed in across the
// upgrade rather than being logged out by a renamed key.
const ACCESS_KEY = 'token';
const REFRESH_KEY = 'alq:refresh-token';
const EXPIRES_AT_KEY = 'alq:token-expires-at';
// The address only, never the passphrase. It is what lets a returning user find their email
// already filled in.
const EMAIL_KEY = 'alq:last-email';
// Which store the four keys above live in. Always in localStorage itself, because it has to
// be readable before we know where to look for everything else.
const PERSIST_KEY = 'alq:stay-signed-in';

const SESSION_KEYS = [ACCESS_KEY, REFRESH_KEY, EXPIRES_AT_KEY, EMAIL_KEY];

/** Renew this far ahead of expiry, so a slow network still lands before the old one dies. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

export const isStayingSignedIn = () => {
    try {
        return window.localStorage.getItem(PERSIST_KEY) !== 'false';
    } catch {
        return true;
    }
};

const store = () => (isStayingSignedIn() ? window.localStorage : window.sessionStorage);

const read = (key) => {
    try {
        return store().getItem(key);
    } catch {
        return null;
    }
};

const write = (key, value) => {
    try {
        if (value === null || value === undefined) store().removeItem(key);
        else store().setItem(key, value);
    } catch {
        // Private mode, or a locked store. The value still applies for this run, which is
        // better than refusing to sign in.
    }
};

export const setStaySignedIn = (stay) => {
    const next = stay !== false;
    if (next === isStayingSignedIn()) return;

    const carried = {};
    SESSION_KEYS.forEach((key) => { carried[key] = read(key); });
    SESSION_KEYS.forEach((key) => write(key, null));

    try {
        window.localStorage.setItem(PERSIST_KEY, next ? 'true' : 'false');
    } catch {
        // Without storage the preference applies for this run only, which is the safe way
        // round: the session is in sessionStorage either way and dies with the tab.
    }

    SESSION_KEYS.forEach((key) => {
        if (carried[key] !== null) write(key, carried[key]);
    });
};

export const readAccessToken = () => read(ACCESS_KEY);
export const readRefreshToken = () => read(REFRESH_KEY);
export const lastEmail = () => read(EMAIL_KEY) || '';
export const rememberEmail = (email) => write(EMAIL_KEY, email || null);

export const applyToken = (token) => {
    if (token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        write(ACCESS_KEY, token);
    } else {
        delete axios.defaults.headers.common['Authorization'];
        write(ACCESS_KEY, null);
    }
};

export const saveSession = (payload) => {
    const token = payload?.token ?? null;
    applyToken(token);

    if (payload?.refresh_token) write(REFRESH_KEY, payload.refresh_token);
    write(
        EXPIRES_AT_KEY,
        payload?.expires_in ? String(Date.now() + payload.expires_in * 1000) : null
    );

    // A new session is not a lost one. Without this, signing back in after an expiry would
    // leave the "session is over" latch set and the next 401 would be swallowed silently.
    sessionIsLost = false;

    return token;
};

export const clearSession = () => {
    applyToken(null);
    write(REFRESH_KEY, null);
    write(EXPIRES_AT_KEY, null);
};

/** True when the access token is expired, or close enough that renewing now is cheaper. */
export const needsRenewal = () => {
    if (!readRefreshToken()) return false;

    const expiresAt = Number(read(EXPIRES_AT_KEY));
    // A session stored before this module existed has no recorded expiry. Renewing once is
    // the safe reading: the token it holds may be hours from death or already dead.
    if (!expiresAt) return true;

    return Date.now() > expiresAt - RENEW_MARGIN_MS;
};

let inFlight = null;

export const refreshSession = () => {
    if (inFlight) return inFlight;

    const refreshToken = readRefreshToken();
    if (!refreshToken) return Promise.resolve(null);

    inFlight = axios
        .post('/api/refresh', { refresh_token: refreshToken }, { __isSessionCall: true })
        .then((response) => saveSession(response.data))
        .catch((error) => {
            const status = error?.response?.status;
            if (status && status !== 500 && status !== 502 && status !== 503 && status !== 504) {
                clearSession();
            }
            return null;
        })
        .finally(() => {
            inFlight = null;
        });

    return inFlight;
};

/** Renew ahead of expiry. Resolves to true when a renewal actually happened. */
export const renewIfDue = async () => {
    if (!needsRenewal()) return false;
    return Boolean(await refreshSession());
};

export const endSession = async () => {
    const refreshToken = readRefreshToken();
    clearSession();
    sessionIsLost = false;

    if (!refreshToken) return;
    try {
        await axios.post('/api/logout', { refresh_token: refreshToken }, { __isSessionCall: true });
    } catch {
        // The token expires on its own; nothing here is worth showing the user.
    }
};

let sessionIsLost = false;
let sessionLostHandler = null;

const announceSessionLost = () => {
    if (sessionIsLost) return;
    sessionIsLost = true;
    sessionLostHandler?.();
};

export const subscribeSessionLost = (handler) => {
    sessionLostHandler = handler;
    if (sessionIsLost) handler();

    return () => {
        if (sessionLostHandler === handler) sessionLostHandler = null;
    };
};

/** Test seam: forget that a session was ever lost. */
export const resetSessionLost = () => {
    sessionIsLost = false;
    sessionLostHandler = null;
};

const putToken = (headers, token) => {
    if (headers && typeof headers.set === 'function') {
        headers.set('Authorization', `Bearer ${token}`);
        return headers;
    }

    // axios lower-cases header names internally, so spreading a capitalised replacement over
    // an existing lower-case entry leaves both and lets key order decide which wins.
    const next = { ...headers };
    Object.keys(next).forEach((name) => {
        if (name.toLowerCase() === 'authorization') delete next[name];
    });
    next.Authorization = `Bearer ${token}`;
    return next;
};

export const withFreshToken = async (config) => {
    if (!config || config.__isSessionCall) return config;
    if (!needsRenewal()) return config;

    const token = await refreshSession();
    if (token) config.headers = putToken(config.headers, token);

    return config;
};

/** Turn a 401 into a renewal and a replay, or into the end of the session. */
export const recoverFrom401 = async (error) => {
    const config = error?.config;

    if (error?.response?.status !== 401 || !config) return Promise.reject(error);
    // `/api/refresh` answering 401 is the session ending, not something to renew;
    // `/api/login` answering 401 is a wrong password, which the form reports itself.
    if (config.__isSessionCall || config.__isRetry) return Promise.reject(error);

    const token = await refreshSession();
    if (!token) {
        announceSessionLost();
        return Promise.reject(error);
    }

    // Replay the original request with the new credential. `__isRetry` is what stops a
    // server that 401s for some other reason from looping here forever.
    return axios.request({
        ...config,
        __isRetry: true,
        headers: putToken({ ...config.headers }, token)
    });
};

// Both are named and exported so a test can drive them directly rather than reaching into
// axios's mock to find them — and so this registration reads as the one line it is.
axios.interceptors.request.use(withFreshToken);
axios.interceptors.response.use((response) => response, recoverFrom401);
