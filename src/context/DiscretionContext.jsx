import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Discretion mode: shoulder-surfing protection, and nothing more than that.
 *
 * It is honest about its own scope. Names collapse to initials and notes blur **on this
 * screen**; the data is unchanged, the API responses are unchanged, and anyone with access
 * to the server files can still read everything. It defends against the person sitting next
 * to you, which is the threat this app actually has.
 *
 * Deliberately not transformed: `aria-label`s and titles used by assistive technology keep
 * the real name. Hiding a name from a screen reader would harm a user without protecting
 * them from anyone looking at the screen.
 */

const DiscretionContext = createContext(null);

const STORAGE_KEY = 'alq:discreet';
const DISCREET_TITLE = 'Notes';
const APP_TITLE = 'AlexithymiaLoveQuantifier';

export const useDiscretion = () => {
    const value = useContext(DiscretionContext);
    if (!value) throw new Error('useDiscretion must be used inside a DiscretionProvider');
    return value;
};

/**
 * "Alex" → "A.", "Sam Taylor" → "S. T.". Enough to tell your own stacks apart at a glance
 * without the name being readable across a room.
 */
export const initials = (name) => {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    return words.slice(0, 2).map(word => `${[...word][0].toUpperCase()}.`).join(' ');
};

/** The blur applied to notes and tags. Literal strings — Tailwind cannot see composed ones. */
export const BLUR_CLASS = 'blur-[3px] hover:blur-none focus-within:blur-none transition-[filter] duration-150';

const readStored = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export function DiscretionProvider({ children }) {
    const [discreet, setDiscreet] = useState(readStored);

    const toggle = useCallback(() => {
        setDiscreet(previous => {
            const next = !previous;
            try {
                window.localStorage.setItem(STORAGE_KEY, String(next));
            } catch {
                // A blocked storage write costs persistence, not the feature.
            }
            return next;
        });
    }, []);

    // Ctrl+. — reachable without moving your hand to the mouse, which is the point when
    // somebody has just walked up behind you.
    useEffect(() => {
        const onKeyDown = (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === '.') {
                event.preventDefault();
                toggle();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [toggle]);

    // The tab title is on screen too, and it is the one piece of the app visible when the
    // window is not.
    useEffect(() => {
        document.title = discreet ? DISCREET_TITLE : APP_TITLE;
    }, [discreet]);

    const value = useMemo(() => ({
        discreet,
        toggle,
        setDiscreet,
        maskName: (name) => (discreet ? initials(name) : name),
        // Applied to notes and tags: readable when you look directly at them, unreadable
        // at a glance from a metre away.
        blurClass: discreet ? BLUR_CLASS : ''
    }), [discreet, toggle]);

    return <DiscretionContext.Provider value={value}>{children}</DiscretionContext.Provider>;
}

export default DiscretionContext;
