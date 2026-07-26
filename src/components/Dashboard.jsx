import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { Plus, X, Trash2, Edit2, Info, Activity, Layers, Calendar, ChevronLeft, TrendingUp, StickyNote, HelpCircle, MinusCircle } from 'lucide-react';
import AnalysisTimeline from './AnalysisTimeline';
import WhatChanged, { findPreviousVersion } from './WhatChanged';
import ContextCapsuleFields from './ContextCapsule';

const CATEGORIES = [
    {
        id: 'eros',
        label: 'Eros',
        description: 'Romantic, passionate love',
        color: 'bg-rose-400',
        textColor: 'text-rose-500',
        borderColor: 'border-rose-300',
        extendedDescription: 'Eros is the "chemistry" operating system. It is heavily driven by physical attraction, aesthetics, and a desire for rapid, intense connection. It is what most movies depict as "falling in love."',
        coreMotivation: 'Physical and emotional merging; intense fascination with the partner\'s physical being.',
        metrics: [
            { title: 'Proximity Seeking', description: 'You find yourself constantly wanting to close the physical distance between you two (e.g., sitting side-by-side rather than across a table).' },
            { title: 'Aesthetic Fixation', description: 'You frequently notice and focus on their physical features.' },
            { title: 'Rapid Escalation', description: 'You feel a drive to escalate the relationship quickly, sharing deep secrets or engaging physically early on.' },
            { title: 'The "Spark"', description: 'You experience a noticeable physiological response (elevated heart rate, nervous energy) when you see them.' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'You notice them the way you notice anyone.' },
            { min: 21, max: 45, phrase: 'There is attraction, but it sits in the background of the day.' },
            { min: 46, max: 70, phrase: 'You look forward to being near them, and you notice when you are not.' },
            { min: 71, max: 100, phrase: 'Their physical presence organises your attention; distance is felt in the body.' }
        ]
    },
    {
        id: 'ludus',
        label: 'Ludus',
        description: 'Playful, flirtatious love',
        color: 'bg-orange-400',
        textColor: 'text-orange-500',
        borderColor: 'border-orange-300',
        extendedDescription: 'Ludus views love as a game to be played or a dance to be enjoyed, rather than a heavy, long-term commitment. It is about the fun of the interaction without the weight of obligation.',
        coreMotivation: 'Entertainment, freedom, and enjoying the "chase."',
        metrics: [
            { title: 'Lighthearted Communication', description: 'Conversations heavily feature banter, teasing, and flirting rather than deep, emotionally vulnerable topics.' },
            { title: 'Avoidance of "The Future"', description: 'You (or they) actively change the subject or feel a spike of discomfort when asked to define the relationship or make plans months in advance.' },
            { title: 'Multiple Outputs', description: 'You feel comfortable and perhaps prefer pursuing or entertaining multiple romantic interests simultaneously.' },
            { title: 'Emotional Boundaries', description: 'You do not feel a strong need to integrate this person into your broader life (introducing them to family or close friends).' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'Nothing here is a game; the tone stays earnest throughout.' },
            { min: 21, max: 45, phrase: 'Banter happens, but the conversation goes deep when it needs to.' },
            { min: 46, max: 70, phrase: 'You enjoy the play more than the plan, and you keep the future vague.' },
            { min: 71, max: 100, phrase: 'The pleasure is in the chase itself; pinning it down would spoil it.' }
        ]
    },
    {
        id: 'storge',
        label: 'Storge',
        description: 'Unconditional, familial love',
        color: 'bg-amber-400',
        textColor: 'text-amber-500',
        borderColor: 'border-amber-300',
        extendedDescription: 'Storge is the "slow burn" operating system. It is love that grows gradually out of a foundation of deep friendship, shared values, and mutual trust. There is often no distinct moment of "falling" in love; it just becomes a fact over time.',
        coreMotivation: 'Companionship, stability, and psychological comfort.',
        metrics: [
            { title: 'High Comfort Level', description: 'You feel entirely yourself around them. You do not feel the need to "perform" or hide your flaws.' },
            { title: 'Shared Values Over Aesthetics', description: 'Your connection is built on shared interests, similar life goals, or intellectual alignment rather than physical chemistry.' },
            { title: 'Slow Progression', description: 'Physical intimacy or romantic declarations happened significantly later in the relationship, feeling like a natural evolution of a friendship.' },
            { title: 'Crisis Stability', description: 'In times of high stress, your first instinct is to lean on them for practical support and advice.' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'You are still performing a version of yourself around them.' },
            { min: 21, max: 45, phrase: 'Comfortable in stretches, guarded in others.' },
            { min: 46, max: 70, phrase: 'You can be unedited with them, and silence is not awkward.' },
            { min: 71, max: 100, phrase: 'They are where you go first — in a crisis, or with nothing to say at all.' }
        ]
    },
    {
        id: 'pragma',
        label: 'Pragma',
        description: 'Enduring, logical love',
        color: 'bg-emerald-400',
        textColor: 'text-emerald-500',
        borderColor: 'border-emerald-300',
        extendedDescription: 'Pragma is the pragmatic, checklist-driven operating system. It is a highly cognitive approach to love where a partner is evaluated based on their practical compatibility for a successful life, family, or partnership.',
        coreMotivation: 'Long-term compatibility, practical success, and life alignment.',
        metrics: [
            { title: 'Checklist Evaluation', description: 'You mentally (or literally) evaluate them against a set of criteria: financial stability, career trajectory, parenting potential, or lifestyle habits.' },
            { title: 'Rational Vetoes', description: 'You have actively walked away from someone you found highly attractive or fun because they did not meet your logical criteria for a long-term partner.' },
            { title: 'Logistical Harmony', description: 'The relationship is characterized by smooth planning, shared financial goals, and efficient division of labor.' },
            { title: 'Head Over Heart', description: 'Decisions about the relationship are made based on what makes logical sense rather than emotional impulses.' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'Practical compatibility has not entered your thinking.' },
            { min: 21, max: 45, phrase: 'You have noticed how the logistics would work, without dwelling on it.' },
            { min: 46, max: 70, phrase: 'You weigh the practical fit alongside how you feel.' },
            { min: 71, max: 100, phrase: 'You assess this like a shared plan: criteria, timelines, and fit.' }
        ]
    },
    {
        id: 'mania',
        label: 'Mania',
        description: 'Obsessive, intense love',
        color: 'bg-violet-400',
        textColor: 'text-violet-500',
        borderColor: 'border-violet-300',
        extendedDescription: 'Mania is an unstable, highly volatile operating system. It usually arises from low self-esteem or a fear of abandonment, leading to a desperate need for the partner\'s constant reassurance and attention.',
        coreMotivation: 'Alleviating anxiety through complete possession and reassurance from the partner.',
        metrics: [
            { title: 'Metric of Response', description: 'You experience genuine distress, anxiety, or anger if they do not reply to a message within a specific timeframe.' },
            { title: 'Extreme Jealousy', description: 'You feel highly threatened by their external friendships or independent activities.' },
            { title: 'Emotional Rollercoaster', description: 'Your mood for the entire day is dictated entirely by how well your interactions with this person are going.' },
            { title: 'Hyper-Vigilance', description: 'You frequently monitor their social media or whereabouts to ensure they are not abandoning you.' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'Their attention is welcome rather than required.' },
            { min: 21, max: 45, phrase: 'A slow reply registers, then passes.' },
            { min: 46, max: 70, phrase: 'Your day tilts with how the last exchange went.' },
            { min: 71, max: 100, phrase: 'You track where they are and when they will answer; settling depends on it.' }
        ]
    },
    {
        id: 'agape',
        label: 'Agape',
        description: 'Selfless, universal love',
        color: 'bg-blue-400',
        textColor: 'text-blue-500',
        borderColor: 'border-blue-300',
        extendedDescription: 'Agape is the altruistic operating system. It is an entirely selfless love where the well-being and happiness of the partner are prioritized over your own, without any expectation of reward or reciprocation.',
        coreMotivation: 'The unconditional care, nurturing, and betterment of the other person.',
        metrics: [
            { title: 'Willing Sacrifice', description: 'You consistently give up your own resources (time, money, comfort) to improve their situation, and you do not harbor resentment for it.' },
            { title: 'Forgiveness', description: 'You have a high capacity to forgive their mistakes or flaws because you view them with deep empathy.' },
            { title: 'Zero Keeping Score', description: 'You do not keep a mental tally of "who owes who" favors or effort in the relationship.' },
            { title: 'Prioritizing Their Joy', description: 'You feel genuine satisfaction simply from seeing them happy, even if you did not directly cause it or benefit from it.' }
        ],
        anchors: [
            { min: 0, max: 20, phrase: 'You keep your own needs squarely in view.' },
            { min: 21, max: 45, phrase: 'You give when giving is easy.' },
            { min: 46, max: 70, phrase: 'Their wellbeing regularly outranks your convenience.' },
            { min: 71, max: 100, phrase: 'You give without tallying, and their good fortune is enough on its own.' }
        ]
    },
    {
        id: 'selflessness',
        label: 'Selflessness',
        description: 'Complete lack of ego',
        color: 'bg-slate-400',
        textColor: 'text-slate-500',
        borderColor: 'border-slate-300',
        extendedDescription: 'In traditional psychological models, this overlaps almost completely with "Agape". It represents the absolute extreme end of the Agape spectrum.',
        coreMotivation: 'Total removal of the "self" from the equation of the relationship.',
        metrics: [
            { title: 'Absence of Personal Demands', description: 'You do not enforce your own boundaries or needs if they conflict even slightly with the other person\'s.' },
            { title: 'Identity Merging', description: 'You evaluate situations entirely through the lens of "what is best for them," completely omitting "what is best for me."' }
        ],
        // Three bands rather than four: this category has two metrics, and the middle
        // ground between "boundaries hold" and "no self left" is one recognisable state.
        anchors: [
            { min: 0, max: 30, phrase: 'Your boundaries hold, even when holding them costs something.' },
            { min: 31, max: 65, phrase: 'You set your own needs aside often, and notice afterwards.' },
            { min: 66, max: 100, phrase: 'The question "what do I want here?" has stopped being asked.' }
        ]
    }
];

// The guided-scoring frequency scale. The index (0-3) is what gets stored in
// guide_answers; the value is what the suggestion band averages.
const GUIDE_SCALE = [
    { label: 'Never', value: 0 },
    { label: 'Sometimes', value: 35 },
    { label: 'Often', value: 70 },
    { label: 'Constantly', value: 100 }
];

// How far the suggested range extends either side of the average answer.
const GUIDE_BAND_RADIUS = 8;

/** The anchor band containing `value`, or null if the value falls outside every band. */
export const anchorFor = (category, value) =>
    (category.anchors || []).find(a => value >= a.min && value <= a.max) || null;

/**
 * Plain arithmetic over the answered metrics of one category: the mean of the chosen
 * frequency values, and a range of ±8 around it. Returns null when nothing is answered.
 * Nothing here writes a score — the band is a suggestion the user may ignore.
 */
export const guideBand = (answers) => {
    const values = Object.values(answers || {})
        .filter(i => GUIDE_SCALE[i] !== undefined)
        .map(i => GUIDE_SCALE[i].value);
    if (values.length === 0) return null;

    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const midpoint = Math.round(average);
    return {
        count: values.length,
        midpoint,
        min: Math.max(0, midpoint - GUIDE_BAND_RADIUS),
        max: Math.min(100, midpoint + GUIDE_BAND_RADIUS)
    };
};

const Card = ({ children, className = '', style = {} }) => (
    <div className={`bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${className}`} style={style}>
        {children}
    </div>
);

/** True when the snapshot actually carries a score for this category. */
const isScored = (stats, id) => stats != null && stats[id] !== undefined && stats[id] !== null;

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

export const CATEGORIES_EXPORT = CATEGORIES;

const CardStack = ({ versions, onEdit, onDelete, onAddVersion, onAnalyze }) => {
    // Sort versions by date DESC (newest first)
    const sortedVersions = useMemo(() => {
        return [...versions].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }, [versions]);

    const [activeIndex, setActiveIndex] = useState(0);
    const [openNoteId, setOpenNoteId] = useState(null);
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
            // Prevent page scroll
            e.preventDefault();
            e.stopPropagation();

            if (e.deltaY > 0) {
                // Scroll Down -> Reveal older version (increment index)
                setActiveIndex(prev => {
                    if (prev < sortedVersions.length - 1) return prev + 1;
                    return prev;
                });
            } else {
                // Scroll Up -> Return to newer version (decrement index)
                setActiveIndex(prev => {
                    if (prev > 0) return prev - 1;
                    return prev;
                });
            }
        };

        // { passive: false } is crucial for preventDefault to work
        container.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            container.removeEventListener('wheel', handleWheel);
        };
    }, [sortedVersions.length]);

    return (
        <div
            ref={containerRef}
            className="relative h-[500px]"
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
                                <h3 className="text-xl font-light text-slate-900">{person.name}</h3>
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
                                            <span key={tag} className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-full">
                                                {tag}
                                            </span>
                                        ))}
                                        {tags.length > 3 && (
                                            <span className="text-[10px] text-slate-400">+{tags.length - 3}</span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Actions only visible if it's the active card */}
                            {isActive && (
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/80 backdrop-blur-sm rounded-lg">
                                    <button onClick={() => onAnalyze(versions)} className="p-2 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Deep Analysis">
                                        <TrendingUp size={16} />
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
                            <p className="text-xs text-slate-500 font-light leading-relaxed bg-slate-50 rounded-lg p-3 mb-4 whitespace-pre-wrap max-h-24 overflow-y-auto">
                                {person.description}
                            </p>
                        )}

                        <div className="border-t border-slate-50 pt-4 flex-grow">
                            <LoveChart stats={person.stats} uncertain={person.uncertain || []} />
                        </div>

                        <div className="absolute inset-x-0 bottom-4 px-6 text-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
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
 * One category's scoring row: slider, anchor phrase, optional guided-scoring panel,
 * and the skip/unsure toggles. Owns no data — every change goes back to PersonForm.
 */
export const CategorySliderRow = ({
    category,
    value,
    uncertain,
    skipped,
    guideAnswers,
    onValueChange,
    onToggleSkip,
    onToggleUncertain,
    onGuideAnswer
}) => {
    const [guideOpen, setGuideOpen] = useState(false);
    const band = guideBand(guideAnswers);
    const anchor = anchorFor(category, value);

    return (
        <div className={skipped ? 'opacity-50' : ''}>
            <div className="flex justify-between items-center mb-2 gap-2">
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

            {skipped ? (
                <p className="text-[11px] text-slate-400 italic">Not scoring this today — it will be left blank, not zero.</p>
            ) : (
                <>
                    <div className="relative py-1">
                        {/* Track drawn by us rather than the input, so the suggestion band can sit on it */}
                        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 bg-slate-200 rounded-full pointer-events-none" />
                        {band && (
                            <div
                                className="absolute top-1/2 -translate-y-1/2 h-1 bg-slate-400/50 rounded-full pointer-events-none"
                                style={{ left: `${band.min}%`, width: `${band.max - band.min}%` }}
                            />
                        )}
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={value}
                            onChange={(e) => onValueChange(parseInt(e.target.value))}
                            aria-label={category.label}
                            className="relative w-full h-1 bg-transparent rounded-lg appearance-none cursor-pointer accent-slate-600"
                        />
                    </div>

                    {/* Anchor band boundaries */}
                    <div className="relative h-2" aria-hidden="true">
                        {(category.anchors || []).slice(1).map((a) => (
                            <span key={a.min} className="absolute top-0 w-px h-1.5 bg-slate-200" style={{ left: `${a.min}%` }} />
                        ))}
                    </div>

                    {anchor && (
                        <p className="text-[11px] text-slate-500 font-light leading-snug">{anchor.phrase}</p>
                    )}

                    <button
                        type="button"
                        onClick={() => setGuideOpen(o => !o)}
                        aria-expanded={guideOpen}
                        className="mt-2 flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <HelpCircle size={12} />
                        {guideOpen ? 'Hide guide' : 'Guide me'}
                    </button>

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

export const PersonForm = ({ onClose, onSave, initialData, isNewVersion }) => {
    const [name, setName] = useState(initialData?.name || '');

    // If it's a new version, default to today. If editing existing, use its date.
    // If creating brand new subject, use today.
    const [date, setDate] = useState(() => {
        if (isNewVersion || !initialData) {
            return new Date().toISOString().split('T')[0];
        }
        return initialData.date ? new Date(initialData.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    });

    // Every category needs a slider position even when its key is absent from the
    // stored snapshot, so the zeros are the floor and the stored values sit on top.
    const [stats, setStats] = useState(() => ({
        ...CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: 0 }), {}),
        ...(initialData?.stats || {})
    }));

    // Context describes a period, so it is never inherited by a new version — only
    // an edit of an existing snapshot seeds it. The same goes for uncertainty and
    // guide answers: last time's doubt is not this time's.
    const isEditing = Boolean(initialData) && !isNewVersion;
    const [description, setDescription] = useState(isEditing ? (initialData.description || '') : '');
    const [tags, setTags] = useState(isEditing ? (initialData.tags || []) : []);
    const [uncertain, setUncertain] = useState(isEditing ? (initialData.uncertain || []) : []);
    const [guideAnswers, setGuideAnswers] = useState(isEditing ? (initialData.guide_answers || {}) : {});
    // A skipped category is one with no key in the stored stats — Phase 1's semantics.
    const [skipped, setSkipped] = useState(() => (
        isEditing ? CATEGORIES.filter(cat => !isScored(initialData.stats, cat.id)).map(cat => cat.id) : []
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
                            {initialData && !isNewVersion ? 'Edit Analysis' : isNewVersion ? 'New Version' : 'New Subject'}
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
                                className={`w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700 ${isNewVersion ? 'opacity-50 cursor-not-allowed' : ''}`}
                                autoFocus={!initialData}
                                disabled={isNewVersion}
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
                            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">Metrics</label>
                            <p className="text-[11px] text-slate-400 font-light mt-1">
                                Every number is yours to set. Open <span className="italic">Guide me</span> to answer the
                                behaviours instead, skip what you cannot judge today, or flag a score as unsure.
                            </p>
                        </div>
                        {CATEGORIES.map((cat) => (
                            <CategorySliderRow
                                key={cat.id}
                                category={cat}
                                value={stats[cat.id]}
                                uncertain={uncertain.includes(cat.id)}
                                skipped={skipped.includes(cat.id)}
                                guideAnswers={guideAnswers[cat.id]}
                                onValueChange={(value) => handleSliderChange(cat.id, value)}
                                onToggleSkip={() => toggleSkip(cat.id)}
                                onToggleUncertain={() => toggleUncertain(cat.id)}
                                onGuideAnswer={(metricIndex, optionIndex) => setGuideAnswer(cat.id, metricIndex, optionIndex)}
                            />
                        ))}
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
                            {initialData && !isNewVersion ? 'Update Analysis' : 'Analyze & Save'}
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
    const [people, setPeople] = useState([]);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingPerson, setEditingPerson] = useState(null);
    const [isNewVersionMode, setIsNewVersionMode] = useState(false);
    const [isAboutOpen, setIsAboutOpen] = useState(false);
    const [selectedTimelineStack, setSelectedTimelineStack] = useState(null);
    const [notice, setNotice] = useState(null);
    const [whatChanged, setWhatChanged] = useState(null);

    useEffect(() => {
        fetchSubjects();
    }, []);

    const fetchSubjects = async () => {
        try {
            const response = await axios.get('/api/subjects');
            setPeople(response.data);
        } catch (error) {
            console.error("Failed to fetch subjects", error);
            setNotice({ type: 'error', text: errorText(error, 'Could not load your analyses. Check that the server is running, then reload.') });
        }
    };

    // Group people by name for the stacks
    const groupedPeople = useMemo(() => {
        const groups = {};
        people.forEach(person => {
            if (!groups[person.name]) {
                groups[person.name] = [];
            }
            groups[person.name].push(person);
        });
        return Object.values(groups);
    }, [people]);

    const handleSavePerson = async (personData) => {
        setNotice(null);
        try {
            if (editingPerson && !isNewVersionMode) {
                // Update existing — an in-place correction, so no "What Changed" payoff.
                const response = await axios.put(`/api/subjects/${editingPerson.ID}`, personData);
                setPeople(people.map(p => p.ID === editingPerson.ID ? response.data : p));
            } else {
                // Create new (or new version)
                const response = await axios.post('/api/subjects', personData);
                const saved = response.data;
                setPeople([...people, saved]);

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
        const id = whatChanged.current.ID;
        const response = await axios.put(`/api/subjects/${id}`, { description, tags });
        setPeople(prev => prev.map(p => (p.ID === id ? response.data : p)));
        setWhatChanged(prev => ({ ...prev, current: response.data }));
    };

    const deletePerson = async (id) => {
        if (!window.confirm("Are you sure you want to delete this specific version?")) return;
        setNotice(null);
        try {
            await axios.delete(`/api/subjects/${id}`);
            setPeople(people.filter(p => p.ID !== id));
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
    };

    const startEdit = (person) => {
        setEditingPerson(person);
        setIsNewVersionMode(false);
        setIsFormOpen(true);
    };

    const startNewVersion = (person) => {
        setEditingPerson(person); // Pass current data as template
        setIsNewVersionMode(true);
        setIsFormOpen(true);
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
            <div className="max-w-6xl mx-auto px-6 py-12">
                <header className="flex flex-col md:flex-row md:items-end justify-between mb-12 space-y-4 md:space-y-0">
                    <div>
                        <h1 className="text-4xl font-light tracking-tight text-slate-900 mb-2">
                            My <span className="font-semibold">Analysis</span>
                        </h1>
                        <p className="text-slate-500 font-light max-w-md">
                            Overview of your emotional metrics.
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <button onClick={() => setIsAboutOpen(true)} className="flex items-center justify-center p-3 bg-white border border-slate-200 text-slate-500 rounded-xl hover:border-slate-400 hover:text-slate-700 transition-all shadow-sm">
                            <Info size={18} />
                        </button>
                        <button onClick={() => setIsFormOpen(true)} className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group">
                            <Plus size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                            <span className="font-medium">New Analysis</span>
                        </button>
                    </div>
                </header>

                {notice && (
                    <div
                        role="alert"
                        className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${notice.type === 'success'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                    >
                        <Info size={18} className="flex-shrink-0" />
                        <span className="flex-1 text-sm">{notice.text}</span>
                        <button
                            onClick={() => setNotice(null)}
                            aria-label="Dismiss notification"
                            className="p-1 rounded hover:bg-white/50 transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}

                {selectedTimelineStack ? (
                    <AnalysisTimeline
                        versions={selectedTimelineStack}
                        onBack={() => setSelectedTimelineStack(null)}
                        categories={CATEGORIES_EXPORT}
                    />
                ) : (
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

                        {groupedPeople.map((versions) => (
                            <div key={versions[0].name}> {/* Key by name since it's the stable identifier for the stack */}
                                <CardStack
                                    versions={versions}
                                    onEdit={startEdit}
                                    onDelete={deletePerson}
                                    onAddVersion={startNewVersion}
                                    onAnalyze={setSelectedTimelineStack}
                                />
                            </div>
                        ))}
                    </div>
                )}
            </div >

            {isFormOpen && (
                <PersonForm
                    onClose={handleCloseForm}
                    onSave={handleSavePerson}
                    initialData={editingPerson}
                    isNewVersion={isNewVersionMode}
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
                    categories={CATEGORIES_EXPORT}
                    onSaveContext={saveSnapshotContext}
                    onDone={() => setWhatChanged(null)}
                />
            )}
        </div >
    );
}
