import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, Trash2, Edit2, Info, Activity, Calendar, ChevronLeft, ChevronRight, TrendingUp, StickyNote, HelpCircle, MinusCircle, Radar as RadarIcon, BarChart3, Zap, Check, Volume2, VolumeX } from 'lucide-react';
import WhatChanged, { findPreviousVersion } from './WhatChanged';
import VaultKnob from './VaultKnob';
import ContextCapsuleFields from './ContextCapsule';
import LoveShape from './LoveShape';
import StackActions from './StackActions';
import CadenceNudge from './CadenceNudge';
import { RenameRelationshipDialog, MergeRelationshipDialog, DeleteRelationshipDialog, CadenceDialog } from './RelationshipDialogs';
import { timelinePath } from './TimelineRoute';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { CATEGORIES, GUIDE_SCALE, anchorFor, anchorPhrase, nextPhraseSeed, guideBand, isScored, summarizeStack } from '../constants/categories';
import usePullToRefresh from '../mobile/usePullToRefresh';
import { syncReminders } from '../mobile/cadenceReminders';
import { dialSoundEnabled, setDialSoundEnabled } from '../mobile/knobFeedback';

// The taxonomy and its helpers now live in src/constants/categories.js. They are
// re-exported here because the dashboard is where callers have always looked for them.
export { CATEGORIES, anchorFor, anchorPhrase, guideBand, isScored };
export const CATEGORIES_EXPORT = CATEGORIES;

const Card = ({ children, className = '', style = {} }) => (
    <div className={`bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${className}`} style={style}>
        {children}
    </div>
);

const LoveChart = ({ stats, uncertain = [] }) => {
    if (!stats) return null;
    return (
        <div className="space-y-3 mt-4">
            {CATEGORIES.map((cat) => {
                const scored = isScored(stats, cat.id);
                const unsure = scored && uncertain.includes(cat.id);
                const label = !scored ? 'Not scored' : unsure ? 'Marked unsure' : `${stats[cat.id]}%`;

                return (
                    <div key={cat.id} className="group" title={label}>
                        <div className="flex justify-between items-end mb-1">
                            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{cat.label}</span>
                            <span className={`text-xs font-semibold ${scored ? 'text-slate-700' : 'text-slate-300'}`}>
                                {scored ? `${unsure ? '≈' : ''}${stats[cat.id]}%` : '—'}
                            </span>
                        </div>
                        <div className={`h-2 w-full bg-slate-100 rounded-full overflow-hidden ${unsure ? 'border border-dashed border-slate-300' : ''}`}>
                            {scored && (
                                <div
                                    className={`h-full rounded-full transition-all duration-1000 ease-out ${cat.color} ${unsure ? 'opacity-60' : 'opacity-80'}`}
                                    style={{ width: `${stats[cat.id]}%` }}
                                />
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

/**
 * The one-line stack summary: which styles lead, and what has moved most.
 * The ⓘ states the arithmetic, because every number shown must be explainable.
 */
const SummaryLine = ({ versions }) => {
    const summary = useMemo(() => summarizeStack(versions), [versions]);
    if (!summary) return null;

    const formula = summary.mostChanged
        ? 'Dominant: the highest two scores in your latest snapshot. Most changed: the widest range across all snapshots.'
        : 'Dominant: the highest two scores in your latest snapshot.';

    return (
        <p className="text-[11px] text-slate-400 font-light mt-2 flex items-center gap-1 flex-wrap">
            <span>
                {summary.dominant.map(cat => cat.label).join(' · ')} dominant
                {summary.mostChanged && ` — ${summary.mostChanged.label} most changed`}
            </span>
            <span title={formula} aria-label={formula} className="cursor-help text-slate-300">
                <Info size={11} />
            </span>
        </p>
    );
};

const CardStack = ({ versions, maskName = (name) => name, blurClass = '', onEdit, onDelete, onAddVersion, onPulse, onAnalyze }) => {
    // Sort versions by date DESC (newest first)
    const sortedVersions = useMemo(() => {
        return [...versions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }, [versions]);

    const [activeIndex, setActiveIndex] = useState(0);
    const [openNoteId, setOpenNoteId] = useState(null);
    const [showShape, setShowShape] = useState(false);
    const containerRef = useRef(null);

    // Reset active index when versions change (e.g. new version added)
    useEffect(() => {
        setActiveIndex(0);
    }, [versions.length]);

    // An expanded note belongs to the card it was opened on, not to the stack.
    useEffect(() => {
        setOpenNoteId(null);
    }, [activeIndex]);

    // Handle scroll with non-passive listener to prevent page scroll
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e) => {
            const last = sortedVersions.length - 1;
            const goingDown = e.deltaY > 0;

            // Only swallow the wheel when there is actually a version to scrub to.
            // Otherwise the page stops scrolling whenever the pointer crosses a card.
            const canScrub = goingDown ? activeIndex < last : activeIndex > 0;
            if (!canScrub) return;

            // { passive: false } above is what makes preventDefault work here
            e.preventDefault();
            e.stopPropagation();
            setActiveIndex(prev => (goingDown ? Math.min(prev + 1, last) : Math.max(prev - 1, 0)));
        };

        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
        // activeIndex is read directly rather than through the state updater, so the
        // listener must be re-registered when it changes.
    }, [sortedVersions.length, activeIndex]);

    // Scrubbing the stack by touch — and the axis it is allowed to use.
    //
    // This was a *vertical* drag, mirroring the wheel handler, and that was the bug. Vertical
    // is what the page scrolls with, so every attempt to scroll from a card was a coin toss:
    // sometimes the page moved, sometimes the stack riffled, and which one you got depended
    // on where your finger happened to land. Two gestures competing for one axis cannot be
    // fixed with a better threshold, only by moving one of them.
    //
    // So the stack now takes the horizontal axis, which nothing else on this screen wants,
    // and vertical belongs to the page unconditionally — reinforced by `touch-action: pan-y`
    // on the container, which tells the compositor the same thing without waiting for us.
    // The direction follows the visual metaphor rather than the old wheel: swiping left
    // pushes the top card off to reveal the older one beneath.
    //
    // Anyone who does not care to discover a swipe has the pager underneath the stack, which
    // is the discoverable half of the same control.
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const SWIPE_PX = 45;
        /** Beyond this much vertical travel the gesture is a scroll, whatever it does next. */
        const YIELD_PX = 12;

        let startX = null;
        let startY = null;
        let decided = false;

        const onStart = (event) => {
            if (event.touches.length !== 1) return;
            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;
            decided = false;
        };

        const onMove = (event) => {
            if (startX === null) return;

            const deltaX = event.touches[0].clientX - startX;
            const deltaY = event.touches[0].clientY - startY;

            // Vertical intent is the page's, and it is settled early and permanently: a
            // gesture that starts as a scroll must not turn into a scrub halfway through
            // because the finger drifted sideways.
            if (!decided && Math.abs(deltaY) > YIELD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
                startX = null;
                return;
            }
            if (Math.abs(deltaX) < SWIPE_PX) return;

            const last = sortedVersions.length - 1;
            // Left pushes the top card away, revealing the older snapshot under it.
            const goingOlder = deltaX < 0;
            const canScrub = goingOlder ? activeIndex < last : activeIndex > 0;
            if (!canScrub) {
                startX = null;
                return;
            }

            // `{ passive: false }` below is what makes this preventDefault work, exactly as
            // it does for the wheel listener.
            event.preventDefault();
            decided = true;
            startX = event.touches[0].clientX;
            setActiveIndex(prev => (goingOlder ? Math.min(prev + 1, last) : Math.max(prev - 1, 0)));
        };

        const onEnd = () => { startX = null; decided = false; };

        container.addEventListener('touchstart', onStart, { passive: true });
        container.addEventListener('touchmove', onMove, { passive: false });
        container.addEventListener('touchend', onEnd, { passive: true });
        container.addEventListener('touchcancel', onEnd, { passive: true });

        return () => {
            container.removeEventListener('touchstart', onStart);
            container.removeEventListener('touchmove', onMove);
            container.removeEventListener('touchend', onEnd);
            container.removeEventListener('touchcancel', onEnd);
        };
    }, [sortedVersions.length, activeIndex]);

    const last = sortedVersions.length - 1;

    return (
        <>
            <div
                ref={containerRef}
                // `touch-action: pan-y` states the axis split the touch handler implements: the
                // browser may scroll this vertically without consulting us, and horizontal is
                // ours. It also removes the ~300ms the WebView otherwise spends deciding.
                style={{ touchAction: 'pan-y' }}
                // 500px is taller than the content area of a 360×640 phone once the header and
                // the bottom bar are removed, which left the newest card clipped. Below `sm` the
                // stack takes the viewport height it can actually have.
                className="relative h-[min(70vh,500px)] sm:h-[500px]"
            >
                {sortedVersions.map((person, index) => {
                    const offset = index - activeIndex;
                    const isActive = offset === 0;
                    const tags = person.tags || [];
                    const hasNote = Boolean(person.description && person.description.trim());
                    const isNoteOpen = openNoteId === person.ID;

                    // Determine style based on position relative to active card
                    let style = {};
                    let extraClasses = "";

                    if (offset < 0) {
                        // Cards that have been "scrolled past" (newer versions being discarded)
                        // "moves it downwards where it fades away" & "rotates ... to the left"
                        style = {
                            transform: 'translateY(120%) rotate(-15deg)',
                            opacity: 0,
                            zIndex: 60, // Start high then drop or disappear
                            pointerEvents: 'none'
                        };
                    } else if (offset === 0) {
                        // Active Card
                        style = {
                            transform: 'translateY(0) rotate(0deg) scale(1)',
                            opacity: 1,
                            zIndex: 50
                        };
                        extraClasses = "group hover:shadow-xl";
                    } else {
                        // Cards in the stack (older versions)
                        // Visual stack effect: adjust scale and y-offset
                        if (offset > 2) {
                            style = { opacity: 0, pointerEvents: 'none', zIndex: 0 };
                        } else {
                            style = {
                                transform: `translateY(${offset * 12}px) scale(${1 - offset * 0.04})`,
                                opacity: 1 - (offset * 0.1), // Fade out slightly
                                zIndex: 50 - offset
                            };
                        }
                    }

                    return (
                        <Card
                            key={person.ID}
                            className={`absolute top-0 left-0 w-full h-full transition-all duration-700 ease-in-out origin-bottom-left flex flex-col justify-between p-6 ${extraClasses}`}
                            style={style}
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <h3 className="text-xl font-light text-slate-900">{maskName(person.name)}</h3>
                                    <div className="flex items-center gap-2 mt-1">
                                        <Calendar size={12} className="text-slate-400" />
                                        <span className="text-xs text-slate-500 font-mono">
                                            {person.date ? new Date(person.date).toLocaleDateString() : 'No Date'}
                                        </span>
                                        {sortedVersions.length > 1 && (
                                            <span className="text-xs text-slate-300 ml-2 bg-slate-100 px-2 py-0.5 rounded-full">
                                                v{sortedVersions.length - index}
                                            </span>
                                        )}
                                    </div>

                                    {/* Context capsule: quiet indicators that this snapshot carries a story */}
                                    {isActive && (hasNote || tags.length > 0) && (
                                        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                            {hasNote && (
                                                <button
                                                    type="button"
                                                    onClick={() => setOpenNoteId(isNoteOpen ? null : person.ID)}
                                                    aria-expanded={isNoteOpen}
                                                    title={isNoteOpen ? 'Hide note' : 'Show note'}
                                                    className="p-1 -ml-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                                                >
                                                    <StickyNote size={13} />
                                                </button>
                                            )}
                                            {tags.slice(0, 3).map((tag) => (
                                                <span key={tag} className={`text-[10px] text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full ${blurClass}`}>
                                                    {tag}
                                                </span>
                                            ))}
                                            {tags.length > 3 && (
                                                <span className="text-[10px] text-slate-400">+{tags.length - 3}</span>
                                            )}
                                        </div>
                                    )}

                                    {isActive && <SummaryLine versions={versions} />}
                                </div>

                                {/* Actions only visible if it's the active card */}
                                {isActive && (
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/80 backdrop-blur-sm rounded-lg">
                                        <button
                                            onClick={() => setShowShape(s => !s)}
                                            aria-pressed={showShape}
                                            className="p-2 text-slate-300 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition-colors"
                                            title={showShape ? 'Show bars' : 'Show Love Shape'}
                                        >
                                            {showShape ? <BarChart3 size={16} /> : <RadarIcon size={16} />}
                                        </button>
                                        <button onClick={onAnalyze} className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Deep Analysis">
                                            <TrendingUp size={16} />
                                        </button>
                                        <button onClick={() => onPulse(person)} className="p-2 text-slate-300 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition-colors" title="Quick Pulse">
                                            <Zap size={16} />
                                        </button>
                                        <button onClick={() => onAddVersion(person)} className="p-2 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Add New Version">
                                            <Plus size={16} />
                                        </button>
                                        <button onClick={() => onEdit(person)} className="p-2 text-slate-300 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition-colors" title="Edit">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => onDelete(person.ID)} className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>

                            {isActive && isNoteOpen && (
                                <p className={`text-xs text-slate-500 font-light leading-relaxed bg-slate-50 rounded-lg p-3 mb-4 whitespace-pre-wrap max-h-24 overflow-y-auto ${blurClass}`}>
                                    {person.description}
                                </p>
                            )}

                            <div className="border-t border-slate-50 pt-4 flex-grow">
                                {showShape ? (
                                    <div className="flex justify-center">
                                        <LoveShape snapshot={person} size={260} />
                                    </div>
                                ) : (
                                    <LoveChart stats={person.stats} uncertain={person.uncertain || []} />
                                )}
                            </div>

                            {/* Hover-only, so this is the desktop half of the story; the pager
                                below the stack is the touch half. */}
                            <div className="hidden sm:block absolute inset-x-0 bottom-4 px-6 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                {sortedVersions.length > 1 && (
                                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">
                                        {activeIndex < sortedVersions.length - 1 ? "Scroll ↓ for history" : "End of history"}
                                    </p>
                                )}
                            </div>
                        </Card>
                    );
                })}
            </div>

            {/* The discoverable half of the scrub.
                A swipe nobody is told about is a feature nobody has, and on a phone there is no
                hover state to hint with — the "Scroll ↓ for history" line inside the card only
                ever appears under a mouse. Two buttons and a count say the same thing out loud,
                and give the gesture a fallback for anyone who would rather tap. */}
            {sortedVersions.length > 1 && (
                <div className="sm:hidden mt-3 flex items-center justify-center gap-4">
                    <button
                        type="button"
                        onClick={() => setActiveIndex(index => Math.max(index - 1, 0))}
                        disabled={activeIndex === 0}
                        aria-label="Newer version"
                        className="p-2 rounded-full text-slate-400 disabled:opacity-25 active:bg-slate-100 transition-colors touch-target flex items-center justify-center"
                    >
                        <ChevronLeft size={18} />
                    </button>
                    <span className="text-[11px] font-light text-slate-400 tabular-nums" aria-live="polite">
                        {activeIndex + 1} / {sortedVersions.length}
                    </span>
                    <button
                        type="button"
                        onClick={() => setActiveIndex(index => Math.min(index + 1, last))}
                        disabled={activeIndex === last}
                        aria-label="Older version"
                        className="p-2 rounded-full text-slate-400 disabled:opacity-25 active:bg-slate-100 transition-colors touch-target flex items-center justify-center"
                    >
                        <ChevronRight size={18} />
                    </button>
                </div>
            )}
        </>
    );
};


export const AboutModal = ({ onClose }) => {
    const [selectedCategory, setSelectedCategory] = useState(null);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div className="p-6 flex-shrink-0 flex justify-between items-center border-b border-slate-50">
                    <div className="flex items-center gap-3">
                        {selectedCategory && (
                            <button
                                onClick={() => setSelectedCategory(null)}
                                className="p-1 -ml-2 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
                                title="Back to Categories"
                            >
                                <ChevronLeft size={24} />
                            </button>
                        )}
                        <div>
                            <h2 className="text-xl font-light text-slate-800">
                                {selectedCategory ? selectedCategory.label : 'Love Categories'}
                            </h2>
                            <p className="text-xs text-slate-400 mt-1">
                                {selectedCategory ? 'Category Details' : 'Based on the Color Wheel Theory of Love'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto">
                    {!selectedCategory ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {CATEGORIES.map((cat) => (
                                <div
                                    key={cat.id}
                                    onClick={() => setSelectedCategory(cat)}
                                    className="p-4 rounded-xl border border-slate-50 bg-slate-50/50 hover:bg-white hover:shadow-sm hover:border-slate-200 transition-all cursor-pointer group"
                                >
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className={`w-3 h-3 rounded-full ${cat.color} group-hover:scale-110 transition-transform`} />
                                        <h3 className={`font-medium text-slate-900 group-hover:${cat.textColor} transition-colors`}>{cat.label}</h3>
                                    </div>
                                    <p className="text-sm text-slate-500 leading-relaxed font-light">{cat.description}</p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-6 animate-in slide-in-from-right-2 duration-200">
                            <div className={`p-4 rounded-xl bg-slate-50 border-l-4 ${selectedCategory.borderColor}`}>
                                <p className="text-sm text-slate-700 leading-relaxed font-medium mb-3">
                                    {selectedCategory.extendedDescription}
                                </p>
                                <div className="text-sm">
                                    <span className={`font-semibold ${selectedCategory.textColor}`}>Core Motivation: </span>
                                    <span className="text-slate-600 italic">{selectedCategory.coreMotivation}</span>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-semibold text-slate-800 uppercase tracking-wider mb-4 border-b border-slate-100 pb-2">
                                    How to Detect It
                                </h4>
                                <div className="space-y-4">
                                    {selectedCategory.metrics.map((metric, idx) => (
                                        <div key={idx} className="flex gap-3">
                                            <div className="flex-shrink-0 mt-0.5">
                                                <div className={`w-1.5 h-1.5 rounded-full ${selectedCategory.color} opacity-70`} />
                                            </div>
                                            <div>
                                                <h5 className="text-sm font-medium text-slate-900">{metric.title}</h5>
                                                <p className="text-sm text-slate-500 font-light mt-0.5 leading-relaxed">
                                                    {metric.description}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </Card>
        </div>
    );
};

/**
 * One category's scoring row: dial, slider, anchor phrase, optional guided-scoring panel,
 * and the skip/unsure toggles. Owns no data — every change goes back to PersonForm.
 *
 * There are two ways to set the number and they are not redundant. The track is direct and
 * fast with a mouse; the dial is the one that works under a thumb, because the hand rests
 * clear of the track and of the anchor phrase beside it. See `VaultKnob` for why that
 * separation matters more here than it would on most forms.
 *
 * @param {number} [previousValue] what this category read in the snapshot being built on.
 *   Shown as a mark on the track and a one-tap way back to it — a new version starts at zero
 *   now, so this is how last time's number stays available without being assumed.
 * @param {number} [phraseSeed] which of the band's five phrasings to show. Owned by the form
 *   rather than the row so that one opening speaks with one voice, and the next opening picks
 *   a different one — see `anchorPhrase`.
 */
export const CategorySliderRow = ({
    category,
    value,
    uncertain,
    skipped,
    guideAnswers,
    collapsed = false,
    hideGuide = false,
    previousValue,
    phraseSeed = 0,
    onExpand,
    onValueChange,
    onToggleSkip,
    onToggleUncertain,
    onGuideAnswer
}) => {
    const [guideOpen, setGuideOpen] = useState(false);
    const band = guideBand(guideAnswers);
    // Recomputed on every render and deliberately not memoised: it is a lookup and a
    // modulo, and the value it depends on changes on every detent of the dial.
    const phrase = anchorPhrase(category, value, phraseSeed);
    // Offered only while it would actually change something — an unmoved dial showing
    // "Last time 0" is noise, and so is one already sitting on the old number.
    const hasPrevious = Number.isFinite(previousValue) && previousValue !== value;

    // Quick pulse: one line per category, carrying last time's answer, until the user says
    // this one moved. Opening a row is the whole interaction — a pulse where nothing
    // changed costs zero clicks beyond saving.
    if (collapsed) {
        return (
            <button
                type="button"
                onClick={onExpand}
                aria-label={`Adjust ${category.label}`}
                className="w-full flex items-center justify-between gap-3 py-2 px-1 -mx-1 rounded-lg text-left hover:bg-slate-50 transition-colors"
            >
                <span className="flex items-center gap-2 min-w-0">
                    <Check size={14} className="text-emerald-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-slate-700 truncate">{category.label}</span>
                </span>
                <span className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[11px] text-slate-400">
                        {skipped ? 'still not scored' : 'unchanged'}
                    </span>
                    <span className="text-sm font-mono w-10 text-right text-slate-500">
                        {skipped ? '—' : value}
                    </span>
                </span>
            </button>
        );
    }

    return (
        <div className={skipped ? 'opacity-50' : ''}>
            <div className="flex items-center gap-3 mb-2">
                {/* Left of the label and above the track: the one part of the row a thumb is
                    meant to land on, positioned so that landing on it hides nothing. */}
                <VaultKnob
                    value={value}
                    onChange={onValueChange}
                    label={category.label}
                    disabled={skipped}
                />
                <div className="flex-1 min-w-0 flex justify-between items-center gap-2">
                    <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-slate-700">{category.label}</span>
                        <span className="text-[10px] text-slate-400">{category.description}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={`text-sm font-mono w-10 text-right ${skipped ? 'text-slate-300' : uncertain ? 'text-slate-500 border-b border-dashed border-slate-400' : 'text-slate-500'}`}>
                            {skipped ? '—' : `${uncertain ? '≈' : ''}${value}`}
                        </span>
                        <button
                            type="button"
                            onClick={onToggleUncertain}
                            disabled={skipped}
                            aria-pressed={uncertain}
                            aria-label={`Mark ${category.label} unsure`}
                            title="I'm not sure about this one"
                            className={`w-6 h-6 rounded-full text-xs font-semibold border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${uncertain
                                ? 'bg-slate-700 text-white border-slate-700'
                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                }`}
                        >
                            ?
                        </button>
                        <button
                            type="button"
                            onClick={onToggleSkip}
                            aria-pressed={skipped}
                            aria-label={`Skip ${category.label}`}
                            title="Not scoring this today"
                            className={`p-1 rounded-full border transition-colors ${skipped
                                ? 'bg-slate-700 text-white border-slate-700'
                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                }`}
                        >
                            <MinusCircle size={13} />
                        </button>
                    </div>
                </div>
            </div>

            {skipped ? (
                <p className="text-[11px] text-slate-400 italic">Not scoring this today — it will be left blank, not zero.</p>
            ) : (
                <>
                    <div className="relative py-2">
                        {/* Track drawn by us rather than the input, so the suggestion band can sit on it */}
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-slate-200 rounded-full pointer-events-none" />
                        {band && (
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-1 bg-slate-400/50 rounded-full pointer-events-none"
                                style={{ left: `${band.min}%`, width: `${band.max - band.min}%` }}
                            />
                        )}
                        {/* Where this category stood last time. A mark, not a starting
                            position: the number is offered, not assumed. */}
                        {hasPrevious && (
                            <div
                                aria-hidden="true"
                                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-slate-400 rounded-full pointer-events-none"
                                style={{ left: `calc(${previousValue}% - 1px)` }}
                            />
                        )}
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={value}
                            onChange={(e) => onValueChange(parseInt(e.target.value))}
                            aria-label={category.label}
                            // `touch-pan-y` is what stops a scroll from becoming a score. A
                            // range input claims every touch that lands on it, so dragging the
                            // page from a spot that happened to be over a track moved the
                            // number instead — silently, since the finger was covering it.
                            // With this, vertical belongs to the page and only a deliberate
                            // sideways drag reaches the control.
                            className="relative w-full h-1 bg-transparent rounded-lg appearance-none cursor-pointer accent-slate-600 touch-pan-y"
                        />
                    </div>

                    {/* Anchor band boundaries */}
                    <div className="relative h-2" aria-hidden="true">
                        {(category.anchors || []).slice(1).map((a) => (
                            <span key={a.min} className="absolute top-0 w-px h-1.5 bg-slate-200" style={{ left: `${a.min}%` }} />
                        ))}
                    </div>

                    <div className="flex items-start justify-between gap-3">
                        {phrase && (
                            <p className="text-[11px] text-slate-500 font-light leading-snug">{phrase}</p>
                        )}
                        {hasPrevious && (
                            <button
                                type="button"
                                onClick={() => onValueChange(previousValue)}
                                aria-label={`Set ${category.label} to last time's ${previousValue}`}
                                className="flex-shrink-0 px-2 py-1 -my-1 text-[11px] font-medium text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-50 transition-colors tabular-nums"
                            >
                                Last time {previousValue}
                            </button>
                        )}
                    </div>

                    {/* Guided scoring is hidden in a pulse: the fast path and the slow,
                        careful path are different tools for different days. */}
                    {!hideGuide && (
                        <button
                            type="button"
                            onClick={() => setGuideOpen(o => !o)}
                            aria-expanded={guideOpen}
                            className="mt-2 flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
                        >
                            <HelpCircle size={12} />
                            {guideOpen ? 'Hide guide' : 'Guide me'}
                        </button>
                    )}

                    {guideOpen && (
                        <div className="mt-3 p-3 bg-slate-50 rounded-lg space-y-3">
                            <p className="text-[11px] text-slate-500 font-light">
                                How often does each of these describe you, for this person?
                            </p>
                            {category.metrics.map((metric, index) => (
                                <div key={metric.title}>
                                    <p className="text-xs font-medium text-slate-700">{metric.title}</p>
                                    <p className="text-[11px] text-slate-500 font-light leading-snug mb-1.5">{metric.description}</p>
                                    <div className="flex flex-wrap gap-1">
                                        {GUIDE_SCALE.map((option, optionIndex) => {
                                            const selected = guideAnswers?.[String(index)] === optionIndex;
                                            return (
                                                <button
                                                    key={option.label}
                                                    type="button"
                                                    onClick={() => onGuideAnswer(index, optionIndex)}
                                                    aria-pressed={selected}
                                                    aria-label={`${metric.title}: ${option.label}`}
                                                    className={`px-2.5 py-1 rounded-md text-[11px] border transition-colors ${selected
                                                        ? 'bg-slate-800 text-white border-slate-800'
                                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                                        }`}
                                                >
                                                    {option.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}

                            {band && (
                                <div className="pt-2 border-t border-slate-200 flex items-start justify-between gap-3">
                                    <p className="text-[11px] text-slate-600 font-light leading-snug">
                                        Your {band.count} answer{band.count === 1 ? '' : 's'} average {band.midpoint} — a suggested
                                        range of {band.min}–{band.max}. The final number is yours.
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => onValueChange(band.midpoint)}
                                        className="flex-shrink-0 px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 rounded-md hover:border-slate-400 transition-colors"
                                    >
                                        Use {band.midpoint}
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

export const PersonForm = ({ onClose, onSave, initialData, isNewVersion, isPulse }) => {
    // A pulse is a new version taken the fast way: same name, today's date, context
    // cleared. Everything that was true of "new version" is true of it.
    const isNewSnapshot = isNewVersion || isPulse;
    const [name, setName] = useState(initialData?.name || '');

    // If it's a new version, default to today. If editing existing, use its date.
    // If creating brand new subject, use today.
    const [date, setDate] = useState(() => {
        if (isNewSnapshot || !initialData) {
            return new Date().toISOString().split('T')[0];
        }
        return initialData.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    });

    // Which pulse rows the user has opened. Everything else keeps last time's answer,
    // which is the point: "nothing moved" should cost nothing to say.
    const [expanded, setExpanded] = useState(() => new Set());

    // Context describes a period, so it is never inherited by a new version — only
    // an edit of an existing snapshot seeds it. The same goes for uncertainty and
    // guide answers: last time's doubt is not this time's.
    const isEditing = Boolean(initialData) && !isNewSnapshot;

    // Every category needs a slider position even when its key is absent from the
    // stored snapshot, so the zeros are the floor and the stored values sit on top.
    //
    // A **new version** now starts from those zeros rather than from last time's numbers.
    // Inheriting them looked helpful and was quietly corrosive: a row left untouched
    // recorded a fresh, dated, apparently deliberate score that the user had never actually
    // made this time, and a stack of those reads as stability when it is really silence.
    // Starting at zero makes every number in a snapshot something someone decided.
    //
    // A **pulse** is the exception, and not an inconsistency: carrying the previous answers
    // is the whole definition of one — "open what has moved, leave the rest" — and its rows
    // say "unchanged" on their face, so nothing is being claimed that was not seen.
    const [stats, setStats] = useState(() => ({
        ...CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: 0 }), {}),
        ...((isEditing || isPulse) ? (initialData?.stats || {}) : {})
    }));

    // What the snapshot being built on read, for the mark on each track. Not applicable when
    // editing (the values *are* these) or in a pulse (they are already carried).
    const previousStats = isNewVersion && !isPulse ? (initialData?.stats || {}) : null;

    // Sound is a per-device preference rather than a per-form one, so it is read once and
    // written straight through. See `src/mobile/knobFeedback.js` for the default.
    const [dialSound, setDialSound] = useState(dialSoundEnabled);

    // One seed per opening of this form, so every row speaks in the same voice today and a
    // different one next time. Taken in a state initialiser rather than at render, or the
    // sentences would change under the user on every keystroke.
    const [phraseSeed] = useState(nextPhraseSeed);
    const [description, setDescription] = useState(isEditing ? (initialData.description || '') : '');
    const [tags, setTags] = useState(isEditing ? (initialData.tags || []) : []);
    const [uncertain, setUncertain] = useState(isEditing ? (initialData.uncertain || []) : []);
    const [guideAnswers, setGuideAnswers] = useState(isEditing ? (initialData.guide_answers || {}) : {});
    // A skipped category is one with no key in the stored stats — Phase 1's semantics.
    //
    // A pulse inherits them: "unchanged" has to mean unchanged, so a category left unscored
    // last time stays unscored unless the user opens it. A full new version does the
    // opposite — everything is scorable again.
    const [skipped, setSkipped] = useState(() => (
        (isEditing || isPulse) && initialData
            ? CATEGORIES.filter(cat => !isScored(initialData.stats, cat.id)).map(cat => cat.id)
            : []
    ));

    const handleSliderChange = (id, value) => {
        setStats(prev => ({ ...prev, [id]: value }));
    };

    const toggleSkip = (id) => {
        setSkipped(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
        // Skipping wins over unsure: you cannot be unsure about a score you did not give.
        setUncertain(prev => prev.filter(u => u !== id));
    };

    const toggleUncertain = (id) => {
        setUncertain(prev => (prev.includes(id) ? prev.filter(u => u !== id) : [...prev, id]));
    };

    const setGuideAnswer = (categoryId, metricIndex, optionIndex) => {
        setGuideAnswers(prev => {
            const forCategory = { ...(prev[categoryId] || {}) };
            if (forCategory[String(metricIndex)] === optionIndex) {
                delete forCategory[String(metricIndex)]; // clicking the same answer clears it
            } else {
                forCategory[String(metricIndex)] = optionIndex;
            }
            const next = { ...prev, [categoryId]: forCategory };
            if (Object.keys(forCategory).length === 0) delete next[categoryId];
            return next;
        });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;

        // Skipped categories are omitted entirely — absent means "not scored".
        const scoredStats = {};
        CATEGORIES.forEach(cat => {
            if (!skipped.includes(cat.id)) scoredStats[cat.id] = stats[cat.id];
        });
        const scoredGuideAnswers = Object.fromEntries(
            Object.entries(guideAnswers).filter(([id]) => !skipped.includes(id))
        );

        onSave({
            name: name.trim(),
            date,
            kind: isPulse ? 'pulse' : 'full',
            stats: scoredStats,
            description,
            tags,
            uncertain: uncertain.filter(id => !skipped.includes(id)),
            guide_answers: scoredGuideAnswers
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Card className="w-full max-w-lg max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-xl font-light text-slate-800">
                            {isPulse ? 'Quick Pulse' : isEditing ? 'Edit Analysis' : isNewVersion ? 'New Version' : 'New Subject'}
                        </h2>
                        <button type="button" onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-8">
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Identity</label>
                            <input
                                type="text"
                                placeholder="Enter name..."
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={`w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700 ${isNewSnapshot ? 'opacity-50 cursor-not-allowed' : ''}`}
                                autoFocus={!initialData}
                                disabled={isNewSnapshot}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Date of State</label>
                            <input
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors text-slate-700"
                            />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <div className="flex items-center justify-between gap-3">
                                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Metrics</label>
                                {/* The dial clicks. Some rooms are not the place for that, and
                                    discretion mode already silences it — this is the standing
                                    preference for everywhere else. */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        const next = !dialSound;
                                        setDialSound(next);
                                        setDialSoundEnabled(next);
                                    }}
                                    aria-pressed={dialSound}
                                    aria-label={dialSound ? 'Turn off dial sound' : 'Turn on dial sound'}
                                    title={dialSound ? 'Dial clicks are on' : 'Dial clicks are off'}
                                    className="p-2 -m-2 text-slate-300 hover:text-slate-600 transition-colors"
                                >
                                    {dialSound ? <Volume2 size={15} /> : <VolumeX size={15} />}
                                </button>
                            </div>
                            <p className="text-[11px] text-slate-400 font-light mt-1">
                                {isPulse
                                    ? 'Carried over from your last snapshot. Open anything that has moved — leave the rest.'
                                    : isNewVersion
                                        ? <>
                                            A fresh reading: every dial starts at zero, and last time's number is
                                            marked on the track if you want it back. Turn the dial with your thumb,
                                            or drag the track.
                                        </>
                                        : <>
                                            Every number is yours to set. Open <span className="italic">Guide me</span> to answer the
                                            behaviours instead, skip what you cannot judge today, or flag a score as unsure.
                                        </>}
                            </p>
                        </div>
                        <div className={isPulse ? 'divide-y divide-slate-50 space-y-0' : 'contents'}>
                            {CATEGORIES.map((cat) => (
                                <CategorySliderRow
                                    key={cat.id}
                                    category={cat}
                                    value={stats[cat.id]}
                                    uncertain={uncertain.includes(cat.id)}
                                    skipped={skipped.includes(cat.id)}
                                    guideAnswers={guideAnswers[cat.id]}
                                    previousValue={previousStats?.[cat.id]}
                                    phraseSeed={phraseSeed}
                                    collapsed={isPulse && !expanded.has(cat.id)}
                                    hideGuide={isPulse}
                                    onExpand={() => setExpanded(prev => new Set(prev).add(cat.id))}
                                    onValueChange={(value) => handleSliderChange(cat.id, value)}
                                    onToggleSkip={() => toggleSkip(cat.id)}
                                    onToggleUncertain={() => toggleUncertain(cat.id)}
                                    onGuideAnswer={(metricIndex, optionIndex) => setGuideAnswer(cat.id, metricIndex, optionIndex)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100">
                        <ContextCapsuleFields
                            description={description}
                            tags={tags}
                            onDescriptionChange={setDescription}
                            onTagsChange={setTags}
                        />
                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-100 flex justify-end">
                        <button
                            type="submit"
                            disabled={!name.trim()}
                            className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                        >
                            {isPulse ? 'Save pulse' : isEditing ? 'Update Analysis' : 'Analyze & Save'}
                        </button>
                    </div>
                </form>
            </Card>
        </div>
    );
};

// The server's error messages are human-readable, so prefer them over a generic one.
const errorText = (error, fallback) => error?.response?.data?.error || fallback;

export default function Dashboard() {
    const {
        people,
        stacks,
        loadError,
        staleSince,
        refresh,
        dismissLoadError,
        createSubject,
        updateSubject,
        deleteSubject,
        renameRelationship,
        setCadence,
        mergeRelationships,
        deleteRelationship
    } = useSubjects();
    const { maskName, blurClass } = useDiscretion();
    const navigate = useNavigate();

    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPerson, setEditingPerson] = useState(null);
    const [isNewVersionMode, setIsNewVersionMode] = useState(false);
    const [isPulseMode, setIsPulseMode] = useState(false);
    const [isAboutOpen, setIsAboutOpen] = useState(false);
    const [notice, setNotice] = useState(null);
    const [whatChanged, setWhatChanged] = useState(null);
    // Which stack-level dialog is open, and for which stack: { kind, relationshipId }.
    const [stackDialog, setStackDialog] = useState(null);

    // Re-read from `stacks` rather than capturing the stack, so a dialog left open across
    // a refresh is never acting on a stale snapshot count.
    const dialogStack = stackDialog
        ? stacks.find(stack => stack.relationship.ID === stackDialog.relationshipId)
        : null;

    // A failed load is the provider's to report; everything else is this screen's.
    const banner = notice || (loadError ? { type: 'error', text: loadError } : null);
    const dismissBanner = () => {
        setNotice(null);
        dismissLoadError();
    };

    // The list is fetched once on mount and mutated locally after that, which is invisible on
    // a desktop where a reload is free. A phone is resumed, not reloaded — this is how the
    // list gets refetched without one. No-op on web; see `src/mobile/usePullToRefresh.js`.
    const { pull, refreshing, armed } = usePullToRefresh(refresh);

    // Reminders are recomputed from `stacks` whenever it changes, so adding a snapshot or
    // changing a rhythm cancels the notification it just satisfied. No-op unless the user has
    // turned reminders on; see `src/mobile/cadenceReminders.js` for the constraints it works
    // under, which come from the product rule at the top of `constants/cadence.js`.
    useEffect(() => {
        syncReminders(stacks);
    }, [stacks]);

    const handleSavePerson = async (personData) => {
        setNotice(null);
        try {
            if (editingPerson && !isNewVersionMode) {
                // Update existing — an in-place correction, so no "What Changed" payoff.
                await updateSubject(editingPerson.ID, personData);
            } else {
                // Create new (or new version)
                const saved = await createSubject(personData);

                // Anything that lands in an existing stack has something to compare against.
                const previous = findPreviousVersion(saved, people);
                if (previous) setWhatChanged({ current: saved, previous });
            }
            handleCloseForm();
        } catch (error) {
            // The form deliberately stays open so the user's input survives the failure.
            console.error("Failed to save subject", error);
            setNotice({ type: 'error', text: errorText(error, 'Could not save this analysis. Your entries are still here — try again.') });
        }
    };

    // The "add a note" follow-up on the What Changed screen: a partial PUT that writes
    // only the context capsule, leaving the scores exactly as they were just saved.
    const saveSnapshotContext = async ({ description, tags }) => {
        const updated = await updateSubject(whatChanged.current.ID, { description, tags });
        setWhatChanged(prev => ({ ...prev, current: updated }));
    };

    const deletePerson = async (id) => {
        if (!window.confirm("Are you sure you want to delete this specific version?")) return;
        setNotice(null);
        try {
            await deleteSubject(id);
            setNotice({ type: 'success', text: 'Version deleted.' });
        } catch (error) {
            console.error("Failed to delete subject", error);
            setNotice({ type: 'error', text: errorText(error, 'Could not delete this version.') });
        }
    };

    const handleCloseForm = () => {
        setIsFormOpen(false);
        setEditingPerson(null);
        setIsNewVersionMode(false);
        setIsPulseMode(false);
    };

    const startEdit = (person) => {
        setEditingPerson(person);
        setIsNewVersionMode(false);
        setIsPulseMode(false);
        setIsFormOpen(true);
    };

    const startNewVersion = (person) => {
        setEditingPerson(person); // Pass current data as template
        setIsNewVersionMode(true);
        setIsPulseMode(false);
        setIsFormOpen(true);
    };

    const startPulse = (person) => {
        setEditingPerson(person);
        setIsNewVersionMode(false);
        setIsPulseMode(true);
        setIsFormOpen(true);
    };

    // The nudge hands back a whole stack; both paths start from its newest snapshot.
    const newestOf = (stack) => [...stack.versions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];

    const openStackDialog = (kind, stack) => () => {
        setNotice(null);
        setStackDialog({ kind, relationshipId: stack.relationship.ID });
    };
    const closeStackDialog = () => setStackDialog(null);

    // The dialogs report their own failures inline and stay open, so these deliberately
    // let the rejection through rather than swallowing it into a banner.
    const confirmRename = async (name) => {
        await renameRelationship(dialogStack.relationship.ID, name);
        setNotice({ type: 'success', text: `Renamed to ${name}.` });
    };

    const confirmMerge = async (targetId) => {
        const merged = await mergeRelationships(targetId, dialogStack.relationship.ID);
        setNotice({ type: 'success', text: `Merged into ${merged.name}.` });
    };

    const confirmCadence = async (days) => {
        await setCadence(dialogStack.relationship.ID, days);
        setNotice({
            type: 'success',
            text: days
                ? `You'll see one line here when it's been ${days} days.`
                : 'Reminders off for this relationship.'
        });
    };

    const confirmDeleteRelationship = async () => {
        const { name } = dialogStack.relationship;
        await deleteRelationship(dialogStack.relationship.ID);
        setNotice({ type: 'success', text: `Deleted every snapshot of ${name}.` });
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
            {/* Pull-to-refresh indicator. `pull` is 0 on web, so this never renders there. */}
            {pull > 0 && (
                <div
                    className="fixed top-0 inset-x-0 z-30 flex justify-center pointer-events-none"
                    style={{ transform: `translateY(${pull}px)` }}
                >
                    <div className="mt-2 p-2 bg-white rounded-full shadow-md border border-slate-100">
                        <Activity
                            size={18}
                            className={`transition-colors ${refreshing ? 'animate-spin text-rose-500'
                                : armed ? 'text-rose-500' : 'text-slate-300'
                                }`}
                        />
                    </div>
                </div>
            )}

            <div
                className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12"
                style={pull > 0 ? { transform: `translateY(${pull}px)` } : undefined}
            >
                <header className="flex flex-col md:flex-row md:items-end justify-between mb-8 md:mb-12 space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-slate-900 mb-2">
                            My <span className="font-semibold">Analysis</span>
                        </h1>
                        <p className="text-slate-500 font-light max-w-md">
                            Overview of your emotional metrics.
                        </p>
                    </div>
                    {/* On a handset "New Analysis" is the one thing this screen is for, so it
                        takes the full width rather than sharing a row with an info icon. */}
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsAboutOpen(true)} aria-label="About" className="flex items-center justify-center p-3 min-h-[48px] min-w-[48px] bg-white border border-slate-200 text-slate-500 rounded-xl hover:border-slate-400 hover:text-slate-700 transition-all shadow-sm">
                            <Info size={18} />
                        </button>
                        <button onClick={() => setIsFormOpen(true)} className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group">
                            <Plus size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                            <span className="font-medium">New Analysis</span>
                        </button>
                    </div>
                </header>

                {/* Cached data is not an error, so it does not use the banner slot — that one
                    is dismissible and this condition is not something the user can dismiss
                    their way out of. It states the age, because "offline" alone is not
                    actionable: whether a twenty-minute-old list is fine depends on the list. */}
                {staleSince && (
                    <div role="status" className="mb-6 p-3 rounded-lg bg-slate-100 border border-slate-200 flex items-center gap-3">
                        <Activity size={16} className="flex-shrink-0 text-slate-400" />
                        <span className="flex-1 text-sm font-light text-slate-600">
                            Showing your last synced copy, from {new Date(staleSince).toLocaleString()}. Pull down to try again.
                        </span>
                    </div>
                )}

                {banner && (
                    <div
                        role="alert"
                        className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${banner.type === 'success'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                    >
                        <Info size={18} className="flex-shrink-0" />
                        <span className="flex-1 text-sm">{banner.text}</span>
                        <button
                            onClick={dismissBanner}
                            aria-label="Dismiss notification"
                            className="p-1 rounded hover:bg-white/50 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                <CadenceNudge
                    stacks={stacks}
                    maskName={maskName}
                    onPulse={(stack) => startPulse(newestOf(stack))}
                    onSnapshot={(stack) => startNewVersion(newestOf(stack))}
                    onSettings={(stack) => setStackDialog({ kind: 'cadence', relationshipId: stack.relationship.ID })}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {people.length === 0 && (
                        <div className="col-span-full flex flex-col items-center justify-center py-20 text-center">
                            <Activity size={48} className="mb-4 opacity-20 text-slate-400" />
                            <p className="text-lg font-light text-slate-600 max-w-md">
                                Map your first relationship — a past one works well: you already know how it ended.
                            </p>
                            <p className="text-sm font-light text-slate-400 mt-3 max-w-md">
                                Seven sliders, one date. You can answer the behaviours instead of guessing at a
                                number, and skip anything you cannot judge today.
                            </p>
                            <div className="flex gap-4 mt-6">
                                <button onClick={() => setIsFormOpen(true)} className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4">
                                    Begin first analysis
                                </button>
                                <button onClick={() => setIsAboutOpen(true)} className="text-sm font-medium text-slate-400 hover:text-slate-700 underline underline-offset-4">
                                    Read the categories first
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Keyed by relationship id: the name is a label now, and two stacks
                        are allowed to share one. */}
                    {stacks.map((stack) => (
                        <div key={stack.relationship.ID}>
                            <StackActions
                                stack={stack}
                                onRename={openStackDialog('rename', stack)}
                                onCadence={openStackDialog('cadence', stack)}
                                onMerge={openStackDialog('merge', stack)}
                                onDelete={openStackDialog('delete', stack)}
                            />
                            <CardStack
                                versions={stack.versions}
                                maskName={maskName}
                                blurClass={blurClass}
                                onEdit={startEdit}
                                onDelete={deletePerson}
                                onAddVersion={startNewVersion}
                                onPulse={startPulse}
                                onAnalyze={() => navigate(timelinePath(stack.relationship.ID))}
                            />
                        </div>
                    ))}
                </div>
            </div >

            {isFormOpen && (
                <PersonForm
                    onClose={handleCloseForm}
                    onSave={handleSavePerson}
                    initialData={editingPerson}
                    isNewVersion={isNewVersionMode}
                    isPulse={isPulseMode}
                />
            )
            }

            {
                isAboutOpen && (
                    <AboutModal onClose={() => setIsAboutOpen(false)} />
                )
            }

            {whatChanged && (
                <WhatChanged
                    current={whatChanged.current}
                    previous={whatChanged.previous}
                    onSaveContext={saveSnapshotContext}
                    onDone={() => setWhatChanged(null)}
                />
            )}

            {dialogStack && stackDialog.kind === 'rename' && (
                <RenameRelationshipDialog
                    relationship={dialogStack.relationship}
                    onRename={confirmRename}
                    onClose={closeStackDialog}
                />
            )}

            {dialogStack && stackDialog.kind === 'cadence' && (
                <CadenceDialog
                    relationship={dialogStack.relationship}
                    onSave={confirmCadence}
                    onClose={closeStackDialog}
                />
            )}

            {dialogStack && stackDialog.kind === 'merge' && (
                <MergeRelationshipDialog
                    stack={dialogStack}
                    otherStacks={stacks.filter(other => other.relationship.ID !== dialogStack.relationship.ID)}
                    onMerge={confirmMerge}
                    onClose={closeStackDialog}
                />
            )}

            {dialogStack && stackDialog.kind === 'delete' && (
                <DeleteRelationshipDialog
                    stack={dialogStack}
                    onDelete={confirmDeleteRelationship}
                    onClose={closeStackDialog}
                />
            )}
        </div >
    );
}
