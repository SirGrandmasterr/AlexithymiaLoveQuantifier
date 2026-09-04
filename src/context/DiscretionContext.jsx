import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const DiscretionContext = createContext(null);

const STORAGE_KEY = 'alq:discreet';
const DISCREET_TITLE = 'Notes';
const APP_TITLE = 'AlexithymiaLoveQuantifier';

export const useDiscretion = () => {
    const value = useContext(DiscretionContext);
    if (!value) throw new Error('useDiscretion must be used inside a DiscretionProvider');
    return value;
};

export const initials = (name) => {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return '—';
    return words.slice(0, 2).map(word => `${[...word][0].toUpperCase()}.`).join(' ');
};

/** The blur applied to notes and tags. Literal strings — Tailwind cannot see composed ones. */
export const BLUR_CLASS = 'blur-[3px] hover:blur-none focus-within:blur-none transition-[filter] duration-150';

export const isDiscreetOnThisDevice = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

const readStored = isDiscreetOnThisDevice;

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
