/**
 * The love taxonomy and the pure helpers that read it.
 *
 * This module is the single source for the seven categories: ids, labels, colours (both
 * the Tailwind class and the hex the SVG charts need), prose, behavioural metrics, and
 * slider anchors. The ids are the cross-tier contract — they are also the server's
 * validation allowlist in backend/internal/domain/categories.go.
 */

export const CATEGORIES = [
    {
        id: 'eros',
        label: 'Eros',
        description: 'Romantic, passionate love',
        color: 'bg-rose-400',
        hex: '#fb7185',
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
        hex: '#fb923c',
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
        hex: '#fbbf24',
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
        hex: '#34d399',
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
        hex: '#a78bfa',
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
        hex: '#60a5fa',
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
        hex: '#94a3b8',
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
export const GUIDE_SCALE = [
    { label: 'Never', value: 0 },
    { label: 'Sometimes', value: 35 },
    { label: 'Often', value: 70 },
    { label: 'Constantly', value: 100 }
];

// How far the suggested range extends either side of the average answer.
export const GUIDE_BAND_RADIUS = 8;

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

/** True when a snapshot actually carries a score for this category — absent is not zero. */
export const isScored = (stats, id) => stats != null && stats[id] !== undefined && stats[id] !== null;

/** Newest first, matching the card stack. Undated snapshots sort oldest. */
export const byDateDesc = (a, b) => new Date(b.date || 0) - new Date(a.date || 0);

// A stack needs at least this many snapshots before "most changed" says anything.
const MIN_VERSIONS_FOR_RANGE = 3;

/**
 * The one-line summary shown on a card: which styles lead right now, and which dimension
 * has moved the most across the whole stack. Both are descriptive — the highest two scores
 * in the latest snapshot, and the widest range across all snapshots — and both are plain
 * arithmetic the UI states in a sentence. Returns null when there is nothing honest to say.
 */
export const summarizeStack = (versions) => {
    if (!versions || versions.length === 0) return null;

    const latest = [...versions].sort(byDateDesc)[0];
    const scored = CATEGORIES.filter(cat => isScored(latest.stats, cat.id));
    if (scored.length < 2) return null;

    // Stable within CATEGORIES order, so ties break the same way every render.
    const dominant = [...scored]
        .sort((a, b) => (latest.stats[b.id] - latest.stats[a.id]) || (CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)))
        .slice(0, 2);

    let mostChanged = null;
    if (versions.length >= MIN_VERSIONS_FOR_RANGE) {
        let widest = 0;
        CATEGORIES.forEach(cat => {
            const values = versions.filter(v => isScored(v.stats, cat.id)).map(v => v.stats[cat.id]);
            if (values.length < 2) return;
            const range = Math.max(...values) - Math.min(...values);
            if (range > widest) {
                widest = range;
                mostChanged = cat;
            }
        });
        if (widest === 0) mostChanged = null;
    }

    return { dominant, mostChanged };
};
