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
 * 1. **Renew before it breaks.** `expires_in` comes back with every session, so a client
 *    can renew on resume rather than after a request has already failed. This is the path
 *    that runs almost every time, and the user never learns it happened.
 * 2. **Renew after it breaks.** A 401 on any request triggers one refresh and one replay of
 *    that request. Concurrent 401s share a single refresh — see `inFlight` — so a dashboard
 *    firing two requests at once does not burn two refresh tokens and revoke itself.
 * 3. **Ask, without evicting.** Only when the refresh token itself is gone or rejected does
 *    the user see anything, and what they see is a passphrase prompt over the screen they
 *    were on, not a bounce to the landing page. Their place, their scroll position, and any
 *    half-filled form are all still there afterwards.
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
 * `localStorage`, for the same reason `src/mobile/serverUrl.js` uses it: the WebView's
 * storage lives in the app's private data directory, sandboxed by the OS from every other
 * app, which is the protection Android `SharedPreferences` gives and neither is encrypted at
 * rest. It also has to be readable *synchronously*, before the first render, for exactly the
 * reason `applyToken` documents — an async read would let the first request go out
 * anonymous. `@capacitor/preferences` cannot meet that constraint.
 */

// Unchanged from when App.jsx owned this: an existing install must stay signed in across the
// upgrade rather than being logged out by a renamed key.
const ACCESS_KEY = 'token';
const REFRESH_KEY = 'alq:refresh-token';
const EXPIRES_AT_KEY = 'alq:token-expires-at';
// The address only, never the passphrase. It is what lets the re-authentication prompt ask
// for one field instead of two.
const EMAIL_KEY = 'alq:last-email';

/** Renew this far ahead of expiry, so a slow network still lands before the old one dies. */
const RENEW_MARGIN_MS = 5 * 60 * 1000;

const read = (key) => {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
};

const write = (key, value) => {
    try {
        if (value === null || value === undefined) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, value);
    } catch {
        // Private mode, or a locked store. The value still applies for this run, which is
        // better than refusing to sign in.
    }
};

export const readAccessToken = () => read(ACCESS_KEY);
export const readRefreshToken = () => read(REFRESH_KEY);
export const lastEmail = () => read(EMAIL_KEY) || '';
export const rememberEmail = (email) => write(EMAIL_KEY, email || null);

/**
 * The single writer for the auth header and its localStorage copy.
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

    if (!refreshToken) return;
    try {
        await axios.post('/api/logout', { refresh_token: refreshToken }, { __isSessionCall: true });
    } catch {
        // The token expires on its own; nothing here is worth showing the user.
    }
};

/**
 * Install the response interceptor that turns a 401 into a renewal and a retry.
 *
 * @param {() => void} onSessionLost called when renewal is impossible and the user has to
 *   authenticate again. It is called at most once per lost session — after the first call
 *   the refresh token is gone, so later 401s take the early return above it.
 * @returns {() => void} an eject function for the caller's cleanup.
 */
export const installSessionInterceptor = (onSessionLost) => {
    const id = axios.interceptors.response.use(
        (response) => response,
        async (error) => {
            const config = error?.config;

            if (error?.response?.status !== 401 || !config) return Promise.reject(error);
            // `/api/refresh` answering 401 is the session ending, not something to renew;
            // `/api/login` answering 401 is a wrong password, which the form reports itself.
            if (config.__isSessionCall || config.__isRetry) return Promise.reject(error);

            const token = await refreshSession();
            if (!token) {
                onSessionLost();
                return Promise.reject(error);
            }

            // Replay the original request with the new credential. `__isRetry` is what stops
            // a server that 401s for some other reason from looping here forever.
            //
            // The old header is removed by case-insensitive comparison rather than by
            // spreading a replacement over it: axios stores header names normalised to lower
            // case, so `{ ...config.headers, Authorization }` leaves *both* `authorization`
            // and `Authorization` in the object and which one survives depends on key order.
            const headers = { ...config.headers };
            Object.keys(headers).forEach((name) => {
                if (name.toLowerCase() === 'authorization') delete headers[name];
            });
            headers.Authorization = `Bearer ${token}`;

            return axios.request({ ...config, __isRetry: true, headers });
        }
    );

    return () => axios.interceptors.response.eject(id);
};
