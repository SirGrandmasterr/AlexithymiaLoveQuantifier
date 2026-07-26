import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, User, LogOut, LogIn, Archive, Eye, EyeOff } from 'lucide-react';

export default function Navbar({ isAuthenticated, onLogout, discreet = false, onToggleDiscretion }) {
    const navigate = useNavigate();

    const handleLogout = () => {
        onLogout();
        navigate('/');
    };

    return (
        <nav className="bg-white border-b border-slate-100 sticky top-0 z-40">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2 group">
                    <div className="p-1.5 bg-rose-50 rounded-full group-hover:bg-rose-100 transition-colors">
                        <Heart className="text-rose-500" size={20} />
                    </div>
                    <span className="text-xl font-light text-slate-800">
                        Alexithymia<span className="font-semibold">LoveQuantifier</span>
                    </span>
                </Link>

                <div className="flex items-center gap-4">
                    {isAuthenticated ? (
                        <>
                            {/* Ctrl+. does the same thing without reaching for the mouse. */}
                            <button
                                onClick={onToggleDiscretion}
                                aria-pressed={discreet}
                                aria-label={discreet ? 'Turn off discretion mode' : 'Turn on discretion mode'}
                                title={discreet ? 'Show names and notes (Ctrl+.)' : 'Hide names and notes (Ctrl+.)'}
                                className={`p-2 rounded-lg transition-all ${discreet
                                    ? 'text-slate-800 bg-slate-100'
                                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                {discreet ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                            <Link
                                to="/vault"
                                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition-all"
                            >
                                <Archive size={18} />
                                <span>Vault</span>
                            </Link>
                            <Link
                                to="/profile"
                                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition-all"
                            >
                                <User size={18} />
                                <span>Profile</span>
                            </Link>
                            <button
                                onClick={handleLogout}
                                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-rose-600 px-3 py-2 rounded-lg hover:bg-rose-50 transition-all"
                            >
                                <LogOut size={18} />
                                <span>Logout</span>
                            </button>
                        </>
                    ) : (
                        <Link
                            to="/login"
                            className="flex items-center gap-2 px-5 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 transition-all shadow-lg shadow-slate-200"
                        >
                            <LogIn size={16} />
                            <span>Sign In</span>
                        </Link>
                    )}
                </div>
            </div>
        </nav>
    );
}
