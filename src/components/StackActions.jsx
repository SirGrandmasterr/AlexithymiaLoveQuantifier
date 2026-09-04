import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cadenceLabel } from '../constants/cadence';

export default function StackActions({ stack, onRename, onCadence, onMerge, onDelete }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const { name, snapshot_count: count, cadence_days: cadence } = stack.relationship;

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const choose = (action) => () => {
        setOpen(false);
        action();
    };

    return (
        <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
            <span className="text-[11px] uppercase tracking-widest text-slate-400 truncate">
                {count} snapshot{count === 1 ? '' : 's'}
                {cadence && (
                    <span className="text-slate-300 normal-case tracking-normal"> · {cadenceLabel(cadence).toLowerCase()}</span>
                )}
            </span>

            <div ref={containerRef} className="relative flex-shrink-0">
                <button
                    type="button"
                    onClick={() => setOpen(current => !current)}
                    aria-expanded={open}
                    aria-haspopup="menu"
                    aria-label={`Stack actions for ${name}`}
                    className="p-1 text-slate-300 hover:text-slate-600 rounded transition-colors"
                >
                    <MoreHorizontal size={16} />
                </button>

                {open && (
                    <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 z-[60] w-52 py-1 bg-white rounded-xl shadow-lg border border-slate-100"
                    >
                        <button
                            type="button"
                            role="menuitem"
                            onClick={choose(onRename)}
                            className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            Rename relationship
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={choose(onCadence)}
                            className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            Check-in rhythm
                            <span className="block text-[11px] text-slate-400">{cadenceLabel(cadence)}</span>
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={choose(onMerge)}
                            className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            Merge into…
                        </button>
                        <button
                            type="button"
                            role="menuitem"
                            onClick={choose(onDelete)}
                            className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                            Delete relationship
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
