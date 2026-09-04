import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Archive, NotebookPen, User, Eye, EyeOff } from 'lucide-react';
import { JOURNAL_COPY, JOURNAL_ROOT } from '../constants/journal';

const DESTINATIONS = [
    { to: '/', label: 'Analysis', icon: Activity },
    // The journal's word is the journal's to own, like every other string it says.
    { to: JOURNAL_ROOT, label: JOURNAL_COPY.nav.label, icon: NotebookPen },
    { to: '/vault', label: 'Vault', icon: Archive },
    { to: '/profile', label: 'Profile', icon: User }
];

const isActive = (pathname, to) => (
    to === '/'
        ? pathname === '/' || pathname.startsWith('/relationships') || pathname.startsWith('/timeline')
        : pathname.startsWith(to)
);

export default function MobileBottomNav({ discreet = false, onToggleDiscretion }) {
    const { pathname } = useLocation();

    return (
        <nav
            aria-label="Primary"
            // `alq-hide-on-keyboard`: a bar of tab targets under an open keyboard is a row of
            // mis-taps waiting to happen. `pb-safe` clears the gesture-navigation pill.
            className="alq-hide-on-keyboard md:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur border-t border-slate-100 pb-safe"
        >
            <ul className="flex items-stretch justify-around">
                {DESTINATIONS.map(({ to, label, icon: Icon }) => {
                    const active = isActive(pathname, to);
                    return (
                        <li key={to} className="flex-1">
                            <Link
                                to={to}
                                aria-current={active ? 'page' : undefined}
                                // 56px clears the 48dp Material minimum with room for the
                                // label; `flex-1` gives each of the five slots 72dp at 360dp.
                                className={`flex flex-col items-center justify-center gap-1 h-14 min-h-[56px] text-[11px] font-medium transition-colors ${active ? 'text-rose-500' : 'text-slate-400 active:text-slate-600'
                                    }`}
                            >
                                <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
                                <span>{label}</span>
                            </Link>
                        </li>
                    );
                })}

                <li className="flex-1">
                    <button
                        type="button"
                        onClick={onToggleDiscretion}
                        aria-pressed={discreet}
                        aria-label={discreet ? 'Turn off discretion mode' : 'Turn on discretion mode'}
                        className={`w-full flex flex-col items-center justify-center gap-1 h-14 min-h-[56px] text-[11px] font-medium transition-colors ${discreet ? 'text-slate-800' : 'text-slate-400 active:text-slate-600'
                            }`}
                    >
                        {discreet ? <EyeOff size={20} strokeWidth={2.25} /> : <Eye size={20} strokeWidth={1.75} />}
                        <span>{discreet ? 'Hidden' : 'Discreet'}</span>
                    </button>
                </li>
            </ul>
        </nav>
    );
}
