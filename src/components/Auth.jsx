import React, { useState } from 'react';
import axios from 'axios';
import { Heart } from 'lucide-react';
import { rememberEmail, lastEmail, isStayingSignedIn, setStaySignedIn } from '../auth/session';

export default function Auth({ onLogin }) {
    const [isLogin, setIsLogin] = useState(true);
    const [email, setEmail] = useState(lastEmail);
    const [password, setPassword] = useState('');
    const [staySignedIn, setStay] = useState(isStayingSignedIn);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const endpoint = isLogin ? '/api/login' : '/api/signup';
            // `__isSessionCall` keeps the response interceptor out of it: a 401 here is a
            // wrong passphrase, which this form reports, not a session to renew.
            const response = await axios.post(endpoint, { email, password }, { __isSessionCall: true });

            if (isLogin) {
                // Before anything is written: this chooses *which store* the session and the
                // remembered address land in, so it has to run ahead of both.
                setStaySignedIn(staySignedIn);
                rememberEmail(email);
                // The whole payload, not just the token: the refresh half is what keeps this
                // screen from reappearing tomorrow.
                onLogin(response.data);
            } else {
                setIsLogin(true);
                setError('Account created! Please log in.');
            }
        } catch (err) {
            setError(err.response?.data?.error || 'An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-100">
                <div className="flex flex-col items-center mb-8">
                    <div className="p-3 bg-rose-50 rounded-full mb-4">
                        <Heart className="text-rose-500" size={32} />
                    </div>
                    <h1 className="text-2xl font-light text-slate-800">
                        Alexithymia<span className="font-semibold">LoveQuantifier</span>
                    </h1>
                    <p className="text-slate-400 text-sm mt-1">
                        {isLogin ? 'Welcome back' : 'Create your account'}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Email</label>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-800 transition-colors"
                            placeholder="name@example.com"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Password</label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-slate-800 transition-colors"
                            placeholder="••••••••"
                        />
                    </div>

                    {isLogin && (
                        <label
                            htmlFor="stay-signed-in"
                            className="flex items-center gap-3 text-sm text-slate-600 cursor-pointer select-none"
                        >
                            <input
                                id="stay-signed-in"
                                type="checkbox"
                                checked={staySignedIn}
                                onChange={(e) => setStay(e.target.checked)}
                                className="w-4 h-4 rounded border-slate-300 text-slate-800 focus:ring-slate-800"
                            />
                            <span>
                                Stay signed in
                                <span className="block text-xs text-slate-400 font-light">
                                    {staySignedIn
                                        ? 'This device stays signed in until you sign out.'
                                        : 'You will be signed out when you close the app.'}
                                </span>
                            </span>
                        </label>
                    )}

                    {error && (
                        <div className="p-3 bg-rose-50 text-rose-600 text-sm rounded-lg text-center">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3 bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors disabled:opacity-50 font-medium"
                    >
                        {loading ? 'Please wait...' : (isLogin ? 'Sign In' : 'Create Account')}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button
                        onClick={() => setIsLogin(!isLogin)}
                        className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
                    >
                        {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
                    </button>
                </div>
            </div>
        </div>
    );
}
