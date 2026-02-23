import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, User, LogOut, LogIn } from 'lucide-react';

export default function Navbar({ isAuthenticated, onLogout }) {
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
