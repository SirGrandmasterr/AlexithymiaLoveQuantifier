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
            {
                min: 0, max: 16,
                phrases: [
                    'You notice them the way you notice anyone.',
                    'Nothing in your body changes when they walk in.',
                    'You could describe their face only in general terms.',
                    'Sitting across the table from them is as good as sitting beside them.',
                    'The thought of touching them has simply never come up.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'There is attraction, but it sits in the background of the day.',
                    'You register that they are good-looking the way you register weather.',
                    'A brush of contact is pleasant and forgotten within the hour.',
                    'You would take the seat next to them if it were free, and think nothing of it.',
                    'The pull is there, and it never asks you for anything.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You look a moment longer than the conversation needs.',
                    'You notice what they were wearing hours after they have gone.',
                    'You choose the seat beside them rather than the one opposite.',
                    'Their absence is neutral; their arrival is a small lift.',
                    'There is a physical interest here, and it is not confused about itself.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'You look forward to being near them, and you notice when you are not.',
                    'You arrange the day so that it passes through them.',
                    'You are aware of the distance between your hands.',
                    'A cancelled evening lands in the body before it lands in the diary.',
                    'Wanting them is a steady note under everything else.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'Their physical presence organises your attention.',
                    'You reach for contact before you have decided to.',
                    'You remember rooms by where they were standing in them.',
                    'Distance is felt in the body, not merely noted.',
                    'The wanting arrives before the thinking does, most days.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'Being in the same room reorganises whatever else you were doing.',
                    'Your attention goes to them and stays there, whatever else is happening.',
                    'Contact is not something you decide on; it is where your hands already are.',
                    'Time apart is counted by the body, without your agreeing to count it.',
                    'The pull is the loudest thing in the room, and you would not call it a choice.'
                ]
            }
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
            {
                min: 0, max: 16,
                phrases: [
                    'Nothing here is a game; the tone stays earnest throughout.',
                    'You answer questions about the future straight, without flinching.',
                    'Teasing does not really feature in how the two of you talk.',
                    'You would introduce them to anyone in your life without a second thought.',
                    'There is no chase in this, and you have not gone looking for one.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'Banter happens, but the conversation goes deep when it needs to.',
                    'You flirt, and you also say the plain thing when the plain thing is needed.',
                    'A question about next year gets an honest answer, if a short one.',
                    'The lightness is a texture here rather than the point.',
                    'You enjoy the play; you are not protecting it from anything.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You keep the tone light more often than the conversation requires.',
                    'You notice a small relief when a heavy subject passes by.',
                    'Plans get made a week out, rarely further.',
                    'You have not thought about where this is going, and have not minded.',
                    'The fun is doing most of the work, and doing it well.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'You enjoy the play more than the plan, and you keep the future vague.',
                    'A conversation about definitions gets deflected, usually with a joke.',
                    'They occupy one part of your life and are not introduced to the rest.',
                    'You are aware of other possibilities, and comfortable with the awareness.',
                    'Lightness is not only the mood here; it is the arrangement.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'The chase is most of the pleasure, and you know that it is.',
                    'You steer away from anything that would settle what this is.',
                    'You keep several conversations open and see no conflict in it.',
                    'A definition would cost more than it would give you.',
                    'What you want from this is the game itself, played well.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'The pleasure is in the chase itself; pinning it down would spoil it.',
                    'Any move toward permanence reads as an ending.',
                    'You keep every door open, deliberately and without apology.',
                    'None of this is meant to arrive anywhere.',
                    'You would sooner lose the person than lose the lightness.'
                ]
            }
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
            {
                min: 0, max: 16,
                phrases: [
                    'You are still performing a version of yourself around them.',
                    'You choose your words with them more carefully than with old friends.',
                    'A silence between you needs filling.',
                    'You would not call them first with bad news.',
                    'There is warmth here, and no ease yet.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'Comfortable in stretches, guarded in others.',
                    'Some subjects are easy with them; others you route around.',
                    'You relax after the first half hour, most times.',
                    'You might call them in a crisis, after two other people.',
                    'The ease comes and goes, and you notice which it is.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You are mostly yourself, with a few edges still tucked away.',
                    'Silence is fine now, provided it does not run too long.',
                    'You have shown them something unflattering and it went well.',
                    'They are on the list of people you would call, if not at the top.',
                    'This has the shape of a friendship that is still growing.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'You can be unedited with them, and silence is not awkward.',
                    'You say the half-formed thought without rehearsing it first.',
                    'An ordinary evening with them costs you nothing to get through.',
                    'When something goes wrong they are among the first you think of.',
                    'The comfort is dependable rather than remarkable, which is the point.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'You do not manage yourself around them at all.',
                    'You have told them the thing you tell almost nobody.',
                    'Hours pass with nothing said and nothing missing.',
                    'They are the first call, and you do not weigh it.',
                    'Being with them is closer to rest than to effort.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'They are where you go first — in a crisis, or with nothing to say at all.',
                    'There is no version of yourself you keep back from them.',
                    'Their presence has the ordinariness of family rather than of company.',
                    'You cannot locate a subject you would avoid with them.',
                    'They read as home, in the plain and unromantic sense of the word.'
                ]
            }
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
            {
                min: 0, max: 16,
                phrases: [
                    'Practical compatibility has not entered your thinking.',
                    'You could not say what they earn or where they want to live.',
                    'The question of whether this would work has not been asked.',
                    'Plans stay short-range because nobody has proposed a longer one.',
                    'Whatever this is, it is not being assessed.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'You have noticed how the logistics would work, without dwelling on it.',
                    'You know the practical facts and have not done anything with them.',
                    'A mismatch would register, and it would not decide anything.',
                    'The future comes up occasionally, in general terms.',
                    'The thinking is there, quietly, and it is not driving.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You have run the arithmetic once or twice, privately.',
                    'You can name what would and would not work about this.',
                    'Money, distance, or timing has come up as a real subject.',
                    'A practical obstacle would give you pause rather than an answer.',
                    'Head and heart are both being consulted, roughly evenly.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'You weigh the practical fit alongside how you feel.',
                    'You have measured this against what you want your life to look like.',
                    'The five-year question has an answer, and you have checked it.',
                    'A serious mismatch here would outweigh a great deal of feeling.',
                    'The assessment is deliberate, and you would defend making it.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'You assess this like a shared plan: criteria, timelines, and fit.',
                    'The requirements were set before this person appeared.',
                    'You have declined people you enjoyed for failing exactly these tests.',
                    'Feeling is evidence here rather than the verdict.',
                    'What you are choosing is a life that works, and they are part of it.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'The criteria decide it, and they decide it first.',
                    'You could produce the list, in order, without preparing it.',
                    'A failed requirement ends the discussion, whatever else is true.',
                    'How you feel is noted, and then set beside the plan.',
                    'This is a partnership being specified rather than a person being fallen for.'
                ]
            }
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
            {
                min: 0, max: 16,
                phrases: [
                    'Their attention is welcome rather than required.',
                    'A message can go unanswered all day without meaning anything.',
                    'Their other friendships are simply their other friendships.',
                    'Your mood today has nothing to do with them.',
                    'You have never checked to see where they are.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'A slow reply registers, then passes.',
                    'You notice that you are waiting, and the noticing is the whole of it.',
                    'You have wondered once who they were with, and let it go.',
                    'A good exchange lifts the hour rather than the day.',
                    'The unease exists and stays small.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You re-read a message to work out its tone.',
                    'You have checked your phone more often than you needed to.',
                    'An unexplained gap makes for an uneasy afternoon.',
                    'Their plans with other people take a small effort to be fine about.',
                    'The needle moves with them now, and you can feel it moving.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'Your day tilts with how the last exchange went.',
                    'You compose replies more carefully than the message calls for.',
                    'Silence gets filled in with explanations you supply yourself.',
                    'You find reasons to check where they are.',
                    'Settling depends on hearing from them.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'You track when they will answer, and the waiting takes the foreground.',
                    'A delay becomes an accusation before any evidence arrives.',
                    'Their independent time reads as distance opening up.',
                    'You ask for reassurance, receive it, and need it again shortly.',
                    'Much of the day goes on managing the fear of losing them.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'You track where they are and when they will answer; settling depends on it.',
                    'Nothing else holds your attention while a message is unanswered.',
                    'Reassurance holds for an hour, and then the ground goes again.',
                    'Their separate life registers as something being taken from you.',
                    'The whole day is organised around the fear that this ends.'
                ]
            }
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
            {
                min: 0, max: 16,
                phrases: [
                    'You keep your own needs squarely in view.',
                    'You give what you can spare, and no more than that.',
                    'Favours are remembered on both sides.',
                    'Their good news is pleasant; it is not your good news.',
                    'The accounting here is ordinary and even.'
                ]
            },
            {
                min: 17, max: 33,
                phrases: [
                    'You give when giving is easy.',
                    'You help, provided it does not rearrange your week.',
                    'You notice when the effort has been one-sided lately.',
                    'Forgiveness comes, and it takes a day or two.',
                    'The generosity is real and has a limit you can locate.'
                ]
            },
            {
                min: 34, max: 50,
                phrases: [
                    'You put yourself out for them more often than not.',
                    'You have given up something you wanted, and not much minded.',
                    'You stop keeping score partway through.',
                    'Their difficulty becomes your problem fairly readily.',
                    'Care runs ahead of convenience, though not always.'
                ]
            },
            {
                min: 51, max: 67,
                phrases: [
                    'Their wellbeing regularly outranks your convenience.',
                    'You rearrange your plans for them without being asked to.',
                    'You forgive things you would not overlook in anyone else.',
                    'Their good fortune pleases you with nothing in it for you.',
                    'Giving here does not feel like a cost being paid.'
                ]
            },
            {
                min: 68, max: 84,
                phrases: [
                    'You give first and work out afterwards what it cost.',
                    'You have stopped noticing whether any of it comes back.',
                    'Their comfort is the thing being solved for.',
                    'You defend them to yourself before you have heard your own side.',
                    'Their happiness is sufficient, and you would not ask for a share.'
                ]
            },
            {
                min: 85, max: 100,
                phrases: [
                    'You give without tallying, and their good fortune is enough on its own.',
                    'There is no version of this in which you are owed anything.',
                    'You would take the loss to spare them the inconvenience.',
                    'Their flaws are met with understanding before anything else.',
                    'What is good for them is what you want, without a second step.'
                ]
            }
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
        // Five bands rather than six: this category has two metrics rather than four, so
        // the scale it can honestly resolve is coarser than the others'.
        anchors: [
            {
                min: 0, max: 20,
                phrases: [
                    'Your boundaries hold, even when holding them costs something.',
                    'You can say no to them and mean it.',
                    'You know what you want out of this and could state it.',
                    'Their preference does not automatically become yours.',
                    'There are two people in this arrangement, and you are one of them.'
                ]
            },
            {
                min: 21, max: 40,
                phrases: [
                    'You give way on the small things and hold the large ones.',
                    'You state your needs, if not the first time of asking.',
                    'You notice yourself conceding, and let it stand.',
                    'Your plans bend around theirs more often than the reverse.',
                    'You are still in the picture, slightly to one side of it.'
                ]
            },
            {
                min: 41, max: 60,
                phrases: [
                    'You set your own needs aside often, and notice afterwards.',
                    'You answer "what do you want?" by working out what they want.',
                    'A boundary gets stated and then quietly dropped.',
                    'You are surprised, occasionally, by how little you asked for.',
                    'Your own preferences have become harder to locate quickly.'
                ]
            },
            {
                min: 61, max: 80,
                phrases: [
                    'You defer first and reconstruct your own view later, if at all.',
                    'Your needs come up only once they have become urgent.',
                    'You judge situations by what is best for them, almost by default.',
                    'Saying no would feel like a failure of the relationship.',
                    'There is little of you left in the decisions being made.'
                ]
            },
            {
                min: 81, max: 100,
                phrases: [
                    'The question "what do I want here?" has stopped being asked.',
                    'You could not name a need of your own without a long pause.',
                    'Every situation is evaluated through them, and only through them.',
                    'Nothing is held back, because nothing is being held.',
                    'You have gone out of the frame entirely.'
                ]
            }
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

export const PHRASES_PER_BAND = 5;

/** The anchor band containing `value`, or null if the value falls outside every band. */
export const anchorFor = (category, value) =>
    (category.anchors || []).find(a => value >= a.min && value <= a.max) || null;

export const anchorPhrase = (category, value, seed = 0) => {
    const bands = category.anchors || [];
    const index = bands.findIndex(band => value >= band.min && value <= band.max);
    if (index === -1) return null;

    const phrases = bands[index].phrases || [];
    if (phrases.length === 0) return null;

    const offset = Math.abs(seed) + index + categoryOffset(category.id);
    return phrases[offset % phrases.length];
};

/** A small stable number per category id. Not a hash worth the name — a shuffle. */
const categoryOffset = (id) => (
    String(id || '').split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
);

let phraseCursor = Math.floor(Math.random() * PHRASES_PER_BAND);
export const nextPhraseSeed = () => {
    phraseCursor += 1;
    return phraseCursor;
};

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
