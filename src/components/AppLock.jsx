import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';

/**
 * An optional local screen lock.
 *
 * Read the copy on the Vault page before extending this: it locks the screen on **this
 * device** and encrypts nothing. The passphrase hash lives in localStorage, the database is
 * exactly as readable as it was, and anyone with the server files can read everything. It
 * is a curtain, not a safe — and saying so plainly is part of the feature.
 */

const HASH_KEY = 'alq:lock-hash';
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

/** SHA-256 via the platform. Absent outside a secure context, which the caller handles. */
export const hashPassphrase = async (passphrase) => {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;

    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(passphrase));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

export const readLockHash = () => {
    try {
        return window.localStorage.getItem(HASH_KEY);
    } catch {
        return null;
    }
};

export const setLockHash = (hash) => {
    try {
        if (hash) window.localStorage.setItem(HASH_KEY, hash);
        else window.localStorage.removeItem(HASH_KEY);
    } catch {
        // Nothing to do: without storage there is no lock to set.
    }
};

export const isLockAvailable = () => Boolean(globalThis.crypto?.subtle);

export default function AppLock({ children }) {
    const [hash, setHash] = useState(readLockHash);
    // Locked on load whenever a passphrase is set — a lock that survives only the tab is
    // not a lock.
    const [locked, setLocked] = useState(() => Boolean(readLockHash()));
    const [entry, setEntry] = useState('');
    const [error, setError] = useState(null);

    // Keep in step with the Vault page setting it in the same tab.
    useEffect(() => {
        const sync = () => {
            const stored = readLockHash();
            setHash(stored);
            if (!stored) setLocked(false);
        };
        window.addEventListener('storage', sync);
        return () => window.removeEventListener('storage', sync);
    }, []);

    const lock = useCallback(() => {
        if (readLockHash()) setLocked(true);
    }, []);

    // Idle timeout: the realistic case is a laptop left open, not an attacker at the
    // keyboard. Any interaction restarts the clock.
    useEffect(() => {
        if (!hash || locked) return undefined;

        let timer = window.setTimeout(lock, IDLE_LIMIT_MS);
        const restart = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(lock, IDLE_LIMIT_MS);
        };

        const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
        events.forEach(event => window.addEventListener(event, restart, { passive: true }));
        return () => {
            window.clearTimeout(timer);
            events.forEach(event => window.removeEventListener(event, restart));
        };
    }, [hash, locked, lock]);

    const unlock = async (event) => {
        event.preventDefault();
        const attempt = await hashPassphrase(entry);
        if (attempt && attempt === hash) {
            setEntry('');
            setError(null);
            setLocked(false);
            return;
        }
        setError('That passphrase does not match.');
    };

    if (!locked) return children;

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900 flex items-center justify-center p-6">
            <form onSubmit={unlock} className="w-full max-w-sm text-center">
                <div className="inline-flex p-3 bg-slate-800 rounded-full mb-6">
                    <Lock className="text-slate-400" size={24} />
                </div>
                <h1 className="text-xl font-light text-slate-100">Locked</h1>
                <p className="text-sm text-slate-400 font-light mt-2">
                    Enter your passphrase to continue on this device.
                </p>

                <input
                    type="password"
                    value={entry}
                    onChange={(event) => setEntry(event.target.value)}
                    aria-label="Passphrase"
                    autoFocus
                    className="mt-6 w-full px-4 py-3 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none"
                    placeholder="••••••••"
                />

                {error && <p role="alert" className="mt-3 text-sm text-rose-400">{error}</p>}

                <button
                    type="submit"
                    className="mt-4 w-full px-6 py-3 bg-slate-100 text-slate-900 rounded-xl font-medium hover:bg-white transition-colors"
                >
                    Unlock
                </button>

                <p className="mt-6 text-[11px] text-slate-500 font-light leading-relaxed">
                    This locks the screen, it does not encrypt anything. If you have forgotten the
                    passphrase, clear this site's data in your browser and sign in again.
                </p>
            </form>
        </div>
    );
}
