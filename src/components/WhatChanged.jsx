import React, { useState, useMemo } from 'react';
import { X, StickyNote, Check } from 'lucide-react';
import ContextCapsuleFields from './ContextCapsule';
import LoveShape from './LoveShape';
import { CATEGORIES, isScored } from '../constants/categories';
import { humanGap } from '../constants/cadence';

// Movements smaller than this are reported as "steady" rather than listed one by one.
export const STEADY_THRESHOLD = 5;

const MS_PER_DAY = 86400000;

export const findPreviousVersion = (current, all) => {
    // Matched on the relationship, not the name: two stacks may legitimately share a
    // display name now, and comparing across them would be comparing two different people.
    const others = all.filter(p => p.ID !== current.ID && p.relationship_id === current.relationship_id);
    if (others.length === 0) return null;

    const currentTime = current.date ? new Date(current.date).getTime() : Infinity;
    const earlier = others
        .filter(p => p.date && new Date(p.date).getTime() <= currentTime)
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    if (earlier.length > 0) return earlier[0];

    // Undated snapshots have no position in time; fall back to the most recently created.
    const undated = others.filter(p => !p.date).sort((a, b) => b.ID - a.ID);
    return undated[0] || null;
};

/** How long passed between two snapshots, phrased for the header. */
export const elapsedSentence = (previous, current, name) => {
    if (!previous?.date || !current?.date) {
        return `Compared with your previous snapshot of ${name}.`;
    }

    const days = Math.round((new Date(current.date) - new Date(previous.date)) / MS_PER_DAY);
    if (days <= 0) return `Another snapshot of ${name}, the same day as the last one.`;

    // Shared with the cadence nudge so the app has one vocabulary for elapsed time.
    return `${humanGap(days)} since your last snapshot of ${name}.`;
};

export const computeDeltas = (current, previous, categories = CATEGORIES) => {
    const compared = [];
    const notComparable = [];

    categories.forEach(category => {
        if (!isScored(current.stats, category.id) || !isScored(previous.stats, category.id)) {
            notComparable.push(category);
            return;
        }
        const from = previous.stats[category.id];
        const to = current.stats[category.id];
        compared.push({
            category,
            from,
            to,
            delta: to - from,
            uncertain: (current.uncertain || []).includes(category.id) || (previous.uncertain || []).includes(category.id)
        });
    });

    return {
        moved: compared
            .filter(row => Math.abs(row.delta) >= STEADY_THRESHOLD)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
        steady: compared.filter(row => Math.abs(row.delta) < STEADY_THRESHOLD),
        notComparable
    };
};

export default function WhatChanged({ current, previous, categories = CATEGORIES, onSaveContext, onDone }) {
    const [noteOpen, setNoteOpen] = useState(false);
    const [description, setDescription] = useState(current.description || '');
    const [tags, setTags] = useState(current.tags || []);
    const [saving, setSaving] = useState(false);
    const [savedNote, setSavedNote] = useState(false);
    const [error, setError] = useState(null);

    const { moved, steady, notComparable } = useMemo(
        () => computeDeltas(current, previous, categories),
        [current, previous, categories]
    );

    const handleSaveNote = async () => {
        setSaving(true);
        setError(null);
        try {
            await onSaveContext({ description, tags });
            setSavedNote(true);
            setNoteOpen(false);
        } catch {
            setError('Could not save that note. Your text is still here — try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Card>
                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h2 className="text-xl font-light text-slate-800">What changed</h2>
                            <p className="text-sm text-slate-500 font-light mt-1">
                                {elapsedSentence(previous, current, current.name)}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onDone}
                            aria-label="Close"
                            className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex justify-center mb-2">
                        <LoveShape snapshot={current} compareTo={previous} size={230} />
                    </div>
                    <p className="text-center text-[11px] text-slate-400 font-light mb-5">
                        Solid: this snapshot. Dashed rose: the one before it.
                    </p>

                    <div className="space-y-3">
                        {moved.length === 0 && steady.length === 0 && (
                            <p className="text-sm text-slate-500 font-light">
                                Nothing lines up between these two snapshots — they score different categories.
                            </p>
                        )}

                        {moved.map((row) => (
                            <div key={row.category.id} className="flex items-center gap-3">
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${row.category.color}`} />
                                <span className="text-sm text-slate-700 flex-1 min-w-0">{row.category.label}</span>
                                <span className="text-xs text-slate-400 font-mono">{`${row.from} → ${row.to}`}</span>
                                <span className="text-sm font-mono text-slate-800 w-14 text-right">
                                    {`${row.uncertain ? '≈' : ''}${row.delta > 0 ? '↑' : '↓'}${Math.abs(row.delta)}`}
                                </span>
                            </div>
                        ))}

                        {steady.length > 0 && (
                            <p className="text-sm text-slate-400 font-light pt-1">
                                {steady.length} dimension{steady.length === 1 ? '' : 's'} steady.
                            </p>
                        )}

                        {notComparable.length > 0 && (
                            <p className="text-xs text-slate-400 font-light">
                                Not comparable (skipped on one side): {notComparable.map(c => c.label).join(', ')}.
                            </p>
                        )}
                    </div>

                    <p className="text-[11px] text-slate-400 font-light mt-4 pt-4 border-t border-slate-100">
                        Differences between your last two snapshots — plain subtraction, nothing more.
                        {moved.some(row => row.uncertain) && ' A ≈ marks a comparison where one side was flagged unsure.'}
                    </p>

                    <div className="mt-6 pt-6 border-t border-slate-100">
                        {noteOpen ? (
                            <div className="space-y-4">
                                <ContextCapsuleFields
                                    description={description}
                                    tags={tags}
                                    onDescriptionChange={setDescription}
                                    onTagsChange={setTags}
                                    heading="What do you think drove this?"
                                    hint="Saved onto the snapshot you just took. Your scores are not touched."
                                    textareaId="what-changed-note"
                                />
                                {error && <p className="text-sm text-red-700">{error}</p>}
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setNoteOpen(false)}
                                        className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveNote}
                                        disabled={saving}
                                        className="px-5 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-all"
                                    >
                                        {saving ? 'Saving...' : 'Save note'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-between gap-4">
                                {savedNote ? (
                                    <p className="flex items-center gap-2 text-sm text-emerald-700">
                                        <Check size={16} /> Note saved.
                                    </p>
                                ) : (
                                    <p className="text-sm text-slate-500 font-light">
                                        Want to note what you think drove this?
                                    </p>
                                )}
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setNoteOpen(true)}
                                        className="flex items-center gap-2 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:border-slate-400 transition-colors"
                                    >
                                        <StickyNote size={14} />
                                        {savedNote ? 'Edit note' : 'Add a note'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onDone}
                                        className="px-5 py-2 text-sm bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-all shadow-lg shadow-slate-200"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}

// Local copy of the dashboard's surface primitive — this screen is rendered over the grid.
const Card = ({ children }) => (
    <div className="bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
        {children}
    </div>
);
