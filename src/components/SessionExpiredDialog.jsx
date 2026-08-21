import React, { useState } from 'react';
import axios from 'axios';
import { Lock } from 'lucide-react';
import { saveSession, rememberEmail, lastEmail } from '../auth/session';

/**
 * Signing back in without losing your place.
 *
 * This is the last resort of the session design in `src/auth/session.js` — reached only when
 * renewal is impossible, which after this change means the refresh token expired (two months
 * of not opening the app), the session was revoked, or the server is older than the renewal
 * endpoint. It replaces the behaviour that made an expired token so grating: the app used to
 * clear the token, which dropped the user to the landing page from wherever they were, with
 * whatever they were typing.
 *
 * So this is an overlay, not a route change. The screen behind it is still mounted, still
 * scrolled where it was, and an open form still holds its input. One field, because the
 * address is already known, and no mention of tokens: what expired is a technical detail the
 * user cannot act on, and "for your security" is the reason they can.
 */
export default function SessionExpiredDialog({ onSignedIn, onSignOut }) {
    const [email, setEmail] = useState(lastEmail);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setError('');
        setBusy(true);

        try {
            // `__isSessionCall` keeps the interceptor out of this: a 401 here is a wrong
            // passphrase for the form to report, not a session to renew.
            const response = await axios.post(
                '/api/login',
                { email, password },
                { __isSessionCall: true }
            );
            saveSession(response.data);
            rememberEmail(email);
            setPassword('');
            onSignedIn(response.data.token);
        } catch (err) {
            setError(err.response?.data?.error || 'Could not sign in. Check your connection and try again.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-expired-title"
            className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
        >
            <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-slate-100 p-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex flex-col items-center text-center">
                    <div className="p-3 bg-slate-50 rounded-full mb-4">
                        <Lock className="text-slate-400" size={22} />
                    </div>
                    <h2 id="session-expired-title" className="text-lg font-light text-slate-800">
                        Signed out for security
                    </h2>
                    <p className="text-sm text-slate-400 font-light mt-2">
                        Your work is still here. Sign in to carry on where you were.
                    </p>
                </div>

                <form onSubmit={submit} className="mt-6 space-y-4">
                    {/* Shown read-only when it is already known: it identifies whose session
                        this is, which matters on a shared device, without asking for a field
                        the user has already given. */}
                    {lastEmail() ? (
                        <p className="text-center text-sm text-slate-600 font-medium truncate">{email}</p>
                    ) : (
                        <div>
                            <label htmlFor="session-email" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                                Email
                            </label>
                            <input
                                id="session-email"
                                type="email"
                                required
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-800 transition-colors"
                                placeholder="name@example.com"
                            />
                        </div>
                    )}

                    <div>
                        <label htmlFor="session-password" className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Password
                        </label>
                        <input
                            id="session-password"
                            type="password"
                            required
                            autoFocus
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-800 transition-colors"
                            placeholder="••••••••"
                        />
                    </div>

                    {error && (
                        <div role="alert" className="p-3 bg-rose-50 text-rose-600 text-sm rounded-lg text-center">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={busy}
                        className="w-full py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors disabled:opacity-50 font-medium"
                    >
                        {busy ? 'Signing in…' : 'Continue'}
                    </button>
                </form>

                <button
                    type="button"
                    onClick={onSignOut}
                    className="mt-4 w-full text-sm text-slate-400 hover:text-slate-700 transition-colors"
                >
                    Sign in as someone else
                </button>
            </div>
        </div>
    );
}
