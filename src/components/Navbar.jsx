import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, User, LogOut, LogIn, Archive, NotebookPen, Eye, EyeOff, Server } from 'lucide-react';
import { JOURNAL_COPY, JOURNAL_ROOT } from '../constants/journal';

export default function Navbar({
    isAuthenticated,
    onLogout,
    discreet = false,
    onToggleDiscretion,
    onOpenServerSettings
}) {
    const navigate = useNavigate();

    const handleLogout = () => {
        onLogout();
        navigate('/');
    };

    return (
        <nav className="bg-white border-b border-slate-100 sticky top-0 z-40 pt-safe">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between">
                <Link to="/" className="flex items-center gap-2 group min-w-0">
                    <div className="p-1.5 bg-rose-50 rounded-full group-hover:bg-rose-100 transition-colors flex-shrink-0">
                        <Heart className="text-rose-500" size={20} />
                    </div>
                    <span className="text-lg sm:text-xl font-light text-slate-800 truncate">
                        <span className="sm:hidden font-semibold">Quantifier</span>
                        <span className="hidden sm:inline">
                            Alexithymia<span className="font-semibold">LoveQuantifier</span>
                        </span>
                    </span>
                </Link>

                <div className="flex items-center gap-1 sm:gap-4">
                    {isAuthenticated ? (
                        <>
                            {/* Native only: on the web the API is same-origin by construction. */}
                            {onOpenServerSettings && (
                                <button
                                    onClick={onOpenServerSettings}
                                    aria-label="Server settings"
                                    className="p-3 sm:p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-all"
                                >
                                    <Server size={18} />
                                </button>
                            )}
                            <button
                                onClick={onToggleDiscretion}
                                aria-pressed={discreet}
                                aria-label={discreet ? 'Turn off discretion mode' : 'Turn on discretion mode'}
                                title={discreet ? 'Show names and notes (Ctrl+.)' : 'Hide names and notes (Ctrl+.)'}
                                className={`hidden md:block p-2 rounded-lg transition-all ${discreet
                                    ? 'text-slate-800 bg-slate-100'
                                    : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
                                    }`}
                            >
                                {discreet ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                            <Link
                                to={JOURNAL_ROOT}
                                className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition-all"
                            >
                                <NotebookPen size={18} />
                                <span>{JOURNAL_COPY.nav.label}</span>
                            </Link>
                            <Link
                                to="/vault"
                                className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition-all"
                            >
                                <Archive size={18} />
                                <span>Vault</span>
                            </Link>
                            <Link
                                to="/profile"
                                className="hidden md:flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition-all"
                            >
                                <User size={18} />
                                <span>Profile</span>
                            </Link>
                            <button
                                onClick={handleLogout}
                                aria-label="Log out"
                                className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-rose-600 p-3 md:px-3 md:py-2 rounded-lg hover:bg-rose-50 transition-all"
                            >
                                <LogOut size={18} />
                                <span className="hidden md:inline">Logout</span>
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
