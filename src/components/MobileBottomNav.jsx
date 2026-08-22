import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Archive, NotebookPen, User, Eye, EyeOff } from 'lucide-react';
import { JOURNAL_COPY, JOURNAL_ROOT } from '../constants/journal';

/**
 * The primary navigation on a handset.
 *
 * The desktop header puts five controls in the top-right corner. On a 6-inch phone held in
 * one hand that corner is the single hardest pixel to reach, so the same controls move to the
 * bottom edge where the thumb rests.
 *
 * Five slots, and the fifth is the interesting one. Four are destinations — Analysis,
 * Journal, Vault, Profile; the timeline is a drill-down from a card, not a peer, so it is
 * deliberately not here. The fifth is **discretion**, which is a mode rather than a place. It
 * earns a slot because of what it is for: hiding names and notes when someone glances over.
 * On a desktop that is a keyboard shortcut (Ctrl+.) and a corner button. On a phone — the
 * device you are actually holding when someone sits down next to you — it has to be one
 * thumb-press away, or it does not work at all.
 *
 * **Five is the ceiling, and the width maths is why.** Material's bottom bar takes three to
 * five destinations; at 360 dp — the narrowest screen this app targets — five equal slots are
 * 72 dp each, comfortably above the 48 dp minimum touch target, and the 56 px height below
 * clears it on the other axis. A sixth would be 60 dp and still legal, but the labels stop
 * fitting: *Analysis* at 11 px is already the widest word here. Anything after this is a
 * drill-down, not a tab.
 *
 * The journal's own microphone button does not live here — it floats above this bar on
 * `/journal` (§9.2) and it arrives with the capture work in 6-C. Its place is left empty
 * rather than filled with a disabled control.
 */

const DESTINATIONS = [
    { to: '/', label: 'Analysis', icon: Activity },
    // The journal's word is the journal's to own, like every other string it says.
    { to: JOURNAL_ROOT, label: JOURNAL_COPY.nav.label, icon: NotebookPen },
    { to: '/vault', label: 'Vault', icon: Archive },
    { to: '/profile', label: 'Profile', icon: User }
];

/**
 * The timeline is a child of the dashboard, so it keeps Analysis lit rather than nothing.
 * The prefix rule does the same for the journal: `/journal/2026-08-21`, `/journal/ritual`
 * and `/journal/people/3` are all the journal, and all light one slot.
 */
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
