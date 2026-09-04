import React, { useMemo, useState } from 'react';
import { Clock, X } from 'lucide-react';
import { dueStacks, nudgeSentence, snoozeUntil } from '../constants/cadence';

const SNOOZE_KEY = 'alq:cadence-snoozed';
const SEEN_KEY = 'alq:cadence-seen';

const readJSON = (storage, key, fallback) => {
    try {
        const stored = storage.getItem(key);
        return stored ? JSON.parse(stored) : fallback;
    } catch {
        // A corrupt entry must never take the dashboard down with it.
        return fallback;
    }
};

const writeJSON = (storage, key, value) => {
    try {
        storage.setItem(key, JSON.stringify(value));
    } catch {
        // Private-mode or quota failures cost the user a snooze, nothing more.
    }
};

export const readSnoozes = () => readJSON(window.localStorage, SNOOZE_KEY, {});
export const readSeen = () => readJSON(window.sessionStorage, SEEN_KEY, []);

export const snooze = (relationshipId, now = new Date()) => {
    const snoozes = readSnoozes();
    snoozes[relationshipId] = snoozeUntil(now);
    writeJSON(window.localStorage, SNOOZE_KEY, snoozes);
};

export const markSeen = (relationshipIds) => {
    const seen = new Set(readSeen());
    relationshipIds.forEach(id => seen.add(id));
    writeJSON(window.sessionStorage, SEEN_KEY, [...seen]);
};

export default function CadenceNudge({ stacks, maskName = (name) => name, onSnapshot, onPulse, onSettings }) {
    // Read once per mount: the banner must not reappear the moment its own state changes.
    const [snoozes] = useState(readSnoozes);
    const [seen, setSeen] = useState(readSeen);
    const [dismissed, setDismissed] = useState(false);

    const due = useMemo(
        () => dueStacks(stacks, { snoozedUntil: snoozes, seen }),
        [stacks, snoozes, seen]
    );

    if (dismissed || due.length === 0) return null;

    const [first, ...rest] = due;
    const name = maskName(first.stack.relationship.name);

    const retire = (ids) => {
        markSeen(ids);
        setSeen(prev => [...new Set([...prev, ...ids])]);
    };

    const later = () => {
        due.forEach(({ stack }) => snooze(stack.relationship.ID));
        retire(due.map(({ stack }) => stack.relationship.ID));
        setDismissed(true);
    };

    const dismiss = () => {
        retire(due.map(({ stack }) => stack.relationship.ID));
        setDismissed(true);
    };

    const act = (handler) => () => {
        retire([first.stack.relationship.ID]);
        setDismissed(true);
        handler(first.stack);
    };

    return (
        <div className="mb-6 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
            <div className="flex items-start gap-3">
                <Clock size={18} className="text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 font-light">{nudgeSentence(name, first.elapsed)}</p>

                    {rest.length > 0 && (
                        <p className="text-xs text-slate-400 font-light mt-1">
                            Also waiting: {rest.map(({ stack }) => maskName(stack.relationship.name)).join(' · ')}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 mt-3">
                        <button
                            type="button"
                            onClick={act(onPulse)}
                            className="px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
                        >
                            Quick pulse
                        </button>
                        <button
                            type="button"
                            onClick={act(onSnapshot)}
                            className="px-3 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:border-slate-400 transition-colors"
                        >
                            Full snapshot
                        </button>
                        <button
                            type="button"
                            onClick={later}
                            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            Later
                        </button>
                        <button
                            type="button"
                            onClick={() => { dismiss(); onSettings(first.stack); }}
                            className="text-xs font-light text-slate-300 hover:text-slate-500 underline underline-offset-4 transition-colors"
                        >
                            turn this off
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label="Dismiss reminder"
                    className="p-1 text-slate-300 hover:text-slate-500 rounded transition-colors flex-shrink-0"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
}
