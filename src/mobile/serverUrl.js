import axios from 'axios';
import { isNative } from './platform';

/**
 * Where the API lives.
 *
 * On the web this question has never existed: the SPA and the API are same-origin in both
 * environments (Vite proxies `/api` in dev, Nginx proxies it in the container), which is
 * exactly why the Go service ships no CORS middleware at all — see
 * [docs/02-architecture.md §6](../../docs/02-architecture.md).
 *
 * A packaged Android build has no such luxury. The WebView is served from `https://localhost`
 * by Capacitor, and the backend is on some other host entirely — an emulator loopback alias,
 * a LAN address, or the user's own domain, since this is self-hosted software and there is no
 * "our" server to hardcode. So the base URL becomes runtime configuration.
 *
 * ## Why this is read synchronously, at module scope
 *
 * `App.jsx` reads the token out of `localStorage` synchronously, before the first render,
 * and its comment explains why: child effects commit before their parent's, so the first
 * `GET /api/subjects` would go out before any effect could set the header. The base URL has
 * the *same* ordering requirement — a request that goes out before `axios.defaults.baseURL`
 * is set would hit `https://localhost/api/...` inside the WebView and 404.
 *
 * `@capacitor/preferences` is async and therefore cannot be used here without breaking that
 * invariant. `localStorage` can, and buys nothing less in the bargain: WebView storage lives
 * in the app's private data directory, sandboxed by the OS from every other app, which is the
 * same protection `SharedPreferences` gives (neither is encrypted at rest).
 */

const STORAGE_KEY = 'alq:server-url';

/**
 * `10.0.2.2` is the emulator's alias for the *host's* loopback — inside the emulator,
 * `localhost` is the emulated device itself, so it is never what you want.
 *
 * Port 8080 is the bare `go run ./cmd/server` from the docs' fastest path. **Under Docker
 * Compose the address to use is Nginx on 8082**, not the backend's own port: 8081 is now
 * bound to 127.0.0.1 on the server and is unreachable from a device, and Nginx proxies
 * `/uploads` as well as `/api`, so avatars resolve — that gap was the original reason to
 * point a native client at the backend directly. Going through Nginx also picks up the
 * request-size cap and the login rate limit, which the backend has no equivalent of.
 */
const DEFAULT_NATIVE_URL = import.meta.env.VITE_ANDROID_API_URL || 'http://10.0.2.2:8080';

/**
 * Trailing slashes are stripped so `baseURL + '/api/subjects'` never doubles up, and a bare
 * host is assumed to be cleartext because the deployment model this serves is a box on a LAN.
 */
export const normalizeServerUrl = (raw) => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, '');
};

/** `null` when valid, otherwise a sentence to show under the field. */
export const validateServerUrl = (raw) => {
    const normalized = normalizeServerUrl(raw);
    if (!normalized) return 'Enter the address of your server, for example http://10.0.2.2:8080';

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        return 'That is not a valid address.';
    }

    if (!parsed.hostname) return 'That address has no host.';
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
        return 'Give the server root only — no path after the port.';
    }
    return null;
};

const readStored = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
};

/**
 * The empty string is a meaningful value on the web: it means "same origin", which preserves
 * today's Vite-proxy and Nginx behaviour exactly. Only native builds get a default host.
 */
export const getServerUrl = () => {
    if (!isNative()) return '';
    return normalizeServerUrl(readStored() || DEFAULT_NATIVE_URL);
};

export const setServerUrl = (raw) => {
    const normalized = normalizeServerUrl(raw);
    try {
        if (normalized) window.localStorage.setItem(STORAGE_KEY, normalized);
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Without storage the value still applies for this launch, which is better than
        // refusing to connect at all.
    }
    applyServerUrl(normalized);
    return normalized;
};

/** True once the user has chosen a server explicitly — used to decide whether to prompt. */
export const hasConfiguredServer = () => !isNative() || Boolean(readStored());

/** The single writer for `axios.defaults.baseURL`, mirroring `applyToken` in `App.jsx`. */
export const applyServerUrl = (url) => {
    axios.defaults.baseURL = url || undefined;
};

/**
 * Absolute URL for a server-relative asset path.
 *
 * `users.profile_picture` is stored as `/uploads/profile_<nanos>.jpg`. In a browser that
 * resolves against the page origin and is correct. In the WebView it would resolve against
 * `https://localhost` and 404, so it has to be rebased onto the configured server.
 *
 * Note the consequence: avatars are fetched by the WebView itself, not through
 * `CapacitorHttp`, so a cleartext server needs `allowMixedContent` — which
 * `capacitor.config.json` sets — and the `/uploads` route is public by design
 * ([docs/02-architecture.md §3.3](../../docs/02-architecture.md)).
 */
export const resolveAssetUrl = (path) => {
    if (!path) return path;
    if (/^(https?:|data:|blob:)/i.test(path)) return path;

    const base = getServerUrl();
    if (!base) return path;
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`;
};

// Applied at import time, for the same reason the token is: the first request must not race
// this. `App.jsx` imports this module before it renders anything.
applyServerUrl(getServerUrl());
