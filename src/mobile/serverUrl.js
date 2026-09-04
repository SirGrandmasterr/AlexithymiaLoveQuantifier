import axios from 'axios';
import { isNative } from './platform';

const STORAGE_KEY = 'alq:server-url';

const DEFAULT_NATIVE_URL = import.meta.env.VITE_ANDROID_API_URL || import.meta.env.VITE_API_URL || 'https://api.alexithymialovequantifier.voglerprojekte.com';

export const normalizeServerUrl = (raw) => {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';

    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    return withScheme.replace(/\/+$/, '');
};

/** `null` when valid, otherwise a sentence to show under the field. */
export const validateServerUrl = (raw) => {
    const normalized = normalizeServerUrl(raw);
    if (!normalized) return 'Enter the address of your server, for example https://api.alexithymialovequantifier.voglerprojekte.com';

    let parsed;
    try {
        parsed = new URL(normalized);
    } catch {
        return 'That is not a valid address.';
    }

    if (!parsed.hostname) return 'That address has no host.';
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
        return 'Give the server root only — no path after the port or domain.';
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

export const getServerUrl = () => {
    const stored = readStored();
    if (stored) return normalizeServerUrl(stored);
    if (!isNative()) {
        const webEnv = import.meta.env.VITE_API_URL;
        return webEnv ? normalizeServerUrl(webEnv) : '';
    }
    return normalizeServerUrl(DEFAULT_NATIVE_URL);
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
