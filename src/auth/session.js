import axios from 'axios';

/**
 * The session: one access token, one refresh token, and the rules for keeping them fresh.
 *
 * ## What was wrong
 *
 * An access token lived 24 hours and nothing could renew it. Every client therefore met
 * "Invalid or expired token" on a schedule — the web app dropped to the landing page
 * mid-sentence, and the Android app, which is *resumed* rather than reloaded for weeks at a
 * time, met it almost every session. The message was accurate and useless: the user had
 * done nothing wrong and there was nothing in it to act on.
 *
 * ## What replaces it
 *
 * Three things, in order of how often they save the user:
 *
 * 1. **Renew before the request goes out.** `expires_in` comes back with every session, so
 *    the request interceptor below can hold a request that is about to fail and renew
 *    first. This is the path that runs almost every time, and the user never learns it
 *    happened.
 * 2. **Renew after it breaks.** A 401 on any request triggers one refresh and one replay of
 *    that request. Concurrent 401s share a single refresh — see `inFlight` — so a dashboard
 *    firing two requests at once does not burn two refresh tokens and revoke itself.
 * 3. **Sign the user out, properly.** Only when the refresh token itself is gone or rejected
 *    is the session over, and then the app returns to exactly the state of someone who never
 *    signed in: the landing page, no navigation, no error. See `subscribeSessionLost`.
 *
 * ## Why the interceptors are installed here, at module scope
 *
 * They used to be installed from an effect in `App`, and that was a real bug rather than a
 * style question. **Child effects commit before their parent's**, so `SubjectsProvider`'s
 * fetch fired before `App`'s effect could install anything: on a cold load with an aged
 * token, `/api/subjects` and `/api/relationships` went out with a dead credential, 401'd
 * with no interceptor to catch them, and were never renewed or replayed. The provider showed
 * an error while `token` was still set — an app that looked signed in and did not work,
 * which is the symptom this file's whole design exists to prevent. Installing at import time
 * is the same constraint, and the same fix, as `applyToken` below.
 *
 * ## Why not literally "reuse the last login data"
 *
 * Storing the password and replaying it would also renew a session, and it is what the
 * request for this feature described. A refresh token is that idea with two properties a
 * stored password cannot have: the server can revoke it, and because every use rotates it,
 * a stolen copy is detectable — see `backend/internal/handlers/session.go`. The password
 * itself is never written to disk here.
 *
 * ## Where it is stored, and what that is worth
 *
 * `localStorage` when the user asked to stay signed in, `sessionStorage` when they did not —
 * see `setStaySignedIn`. Either way it is the WebView's own storage, which on Android lives
 * in the app's private data directory, sandboxed by the OS from every other app; that is the
 * protection `SharedPreferences` gives and neither is encrypted at rest. It also has to be
 * readable *synchronously*, before the first render, for exactly the reason `applyToken`
 * documents — an async read would let the first request go out anonymous.
 * `@capacitor/preferences` cannot meet that constraint.
 */

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

/**
 * Whether the session should outlive the tab.
 *
 * Absent means yes. That default is what keeps every install that predates the checkbox
 * signed in across the upgrade — the alternative is logging everyone out to introduce a
 * feature about not being logged out.
 */
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

/**
 * Choose whether this session survives closing the app.
 *
 * Checked, it lives in `localStorage` and the refresh token carries it for two months.
 * Unchecked, it lives in `sessionStorage`: the tab or the Android task closing is the end of
 * it, which is the honest meaning of "do not stay signed in" — and it takes the remembered
 * email with it, so a shared machine is left with no trace of who used it.
 *
 * Switching **moves** the live session rather than ending it. Ticking the box halfway through
 * an evening should not sign you out; that would teach the user not to touch it.
 */
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

/**
 * The single writer for the auth header and its stored copy.
 *
 * This must run **synchronously**, never from an effect. Child effects commit before their
 * parent's, so the subjects fetch fires before an effect in App could set the header — the
 * first request after logging in would go out anonymous, the server would 401, and the
 * interceptor would sign the user straight back out.
 */
export const applyToken = (token) => {
    if (token) {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        write(ACCESS_KEY, token);
    } else {
        delete axios.defaults.headers.common['Authorization'];
        write(ACCESS_KEY, null);
    }
};

/**
 * Record a whole session — what `/api/login` and `/api/refresh` both return.
 *
 * `refresh_token` is tolerated as absent so a client pointed at a server that predates
 * session renewal still signs in; it simply behaves the way it always did.
 *
 * @returns {string|null} the access token, for the caller to put in state.
 */
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

/**
 * In-flight refresh, shared by every caller.
 *
 * Two concurrent 401s that each refreshed would consume two tokens from a rotating family,
 * and the server reads the second use of a rotated token as a replay — it would revoke the
 * whole family and sign the user out. That failure only appears under concurrency, which is
 * the normal case here: the dashboard loads subjects and relationships in parallel.
 */
let inFlight = null;

/**
 * Exchange the refresh token for a new session.
 *
 * @returns {Promise<string|null>} the new access token, or null when the session is over.
 */
export const refreshSession = () => {
    if (inFlight) return inFlight;

    const refreshToken = readRefreshToken();
    if (!refreshToken) return Promise.resolve(null);

    inFlight = axios
        .post('/api/refresh', { refresh_token: refreshToken }, { __isSessionCall: true })
        .then((response) => saveSession(response.data))
        .catch((error) => {
            // A refused token is the end of the session; a network failure or a server
            // error is not. Clearing on the latter would sign out every offline phone the
            // moment it woke up out of range.
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

/**
 * Tell the server this session is over, then forget it locally.
 *
 * Fire-and-forget by design: the local half must happen whether or not the request lands,
 * because the user pressing "log out" on a train has still logged out.
 */
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

/**
 * The session is over and only a fresh sign-in can fix it.
 *
 * A latch rather than an event, because the subscriber may not exist yet: the interceptors
 * are installed at import time and `App` subscribes in an effect, so a 401 answered during
 * the first paint would otherwise be announced to nobody. `subscribeSessionLost` fires
 * immediately when it finds the latch already set.
 */
let sessionIsLost = false;
let sessionLostHandler = null;

const announceSessionLost = () => {
    if (sessionIsLost) return;
    sessionIsLost = true;
    sessionLostHandler?.();
};

/**
 * @param {() => void} handler called once when renewal has become impossible. The app's
 *   answer to it is to drop the token and render as though nobody had ever signed in — no
 *   overlay, no error, no half-authenticated screen behind a dialog.
 * @returns {() => void} unsubscribe.
 */
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

/**
 * Put a token on one outgoing request.
 *
 * axios 1.x hands interceptors an `AxiosHeaders` instance, whose `set` is the supported way
 * in; a plain object is what a test double and a replayed config carry. Both are handled
 * rather than assumed, because getting it wrong fails as a *missing* header — a 401 that
 * looks like an expired session rather than like a bug here.
 */
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

/**
 * Renew *before* the request, not after it fails.
 *
 * This is the half that was missing. The response interceptor can only react to a 401, and
 * on a cold start there is nothing to react with yet — the requests that fail are the ones
 * the dashboard fires on mount. Holding a doomed request for one refresh costs a few hundred
 * milliseconds once a day and removes the failure entirely.
 *
 * `__isSessionCall` requests are exempt: `/api/refresh` cannot wait for itself.
 */
export const withFreshToken = async (config) => {
    if (!config || config.__isSessionCall) return config;
    if (!needsRenewal()) return config;

    const token = await refreshSession();
    // A null token means the session is over. The request still goes out and still 401s,
    // and `recoverFrom401` is the one place that decides a session has ended — one code
    // path for that, rather than two that can disagree.
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
