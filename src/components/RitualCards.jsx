import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, X } from 'lucide-react';

import { useJournal } from '../context/JournalContext';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { detent } from '../mobile/knobFeedback';
import {
    DAY_ROLLOVER_HOUR,
    JOURNAL_COPY,
    JOURNAL_ROOT,
    PAYLOAD_VERSION,
    RITUAL_PATH,
    RITUAL_QUESTION_SET_VERSION,
    activeFeelings,
    civilDay,
    clientId,
    fillCopy,
    journalDayPath,
    rfc3339Local,
    ritualDeck,
    ritualTimeReached,
    tzOffsetMinutes
} from '../constants/journal';
import {
    readAskWho,
    readOptionalQuestions,
    readRitualSetting,
    readSuggestions,
    readTierOverride,
    readVoiceSetting
} from '../constants/journalSettings';
import { buildContext } from '../journal/inference';
import { detectTier, effectiveTier, TIERS } from '../journal/inference/tier';
import RitualVoice from './RitualVoice';
import { createVoiceKit } from './VoiceCheckin';

/**
 * The nightly ritual: five to nine binary questions, one card at a time, finishable
 * half-asleep in under a minute.
 *
 * **What it must never do is count.** A night nobody answers writes no row, and there is
 * nothing here that could notice one — no "last night", no total, no place a missed night
 * could leave a mark. That is not restraint in the copy, it is the absence of the data
 * structure that would make the copy possible (§3.6).
 *
 * **The swipe contract is deliberately not `CardStack`'s** (Frontend §3.4). The stack lives on
 * a scrolling page, so it takes the horizontal axis and hands vertical to the page — two
 * gestures on one axis cannot be fixed with a better threshold, only by moving one of them.
 * This screen has no second gesture to move: it is full-viewport and it does not scroll, so
 * the card is allowed all three directions and takes both axes outright. The rule behind both
 * decisions is the same one (invariant 2g): a control may claim an axis only where nothing
 * else on the screen wants it.
 *
 * Every gesture has a button and a key beside it. A swipe nobody is told about is a feature
 * nobody has, and at bedtime the person using this may not be in a state to discover one.
 */

/* ------------------------------------------------------------------------------------ */
/* The gesture                                                                            */
/* ------------------------------------------------------------------------------------ */

/** Commit at ~30 % of the card's width (§3.4). Below it the card springs back. */
const COMMIT_FRACTION = 0.3;

/**
 * The floor under that fraction, in pixels.
 *
 * A layout that has not measured yet reports a width of zero, and 30 % of zero is a card
 * that commits on the first pixel of a tap — which is exactly the half-asleep tap §3.4 says
 * must record nothing. The floor is what makes the threshold a real one before the first
 * paint, and it is below 30 % of any card this screen actually draws.
 */
const MIN_COMMIT_PX = 48;

/** How far a drag has to lean past the other axis before it counts as that direction. */
const AXIS_MARGIN_PX = 8;

const commitThreshold = (element) => {
    const width = element?.getBoundingClientRect?.().width || 0;
    return Math.max(MIN_COMMIT_PX, width * COMMIT_FRACTION);
};

/**
 * Which of the three answers a released drag means, or `null` for "spring back".
 *
 * Exported so the rule can be tested as arithmetic rather than only through a DOM: the
 * thing worth pinning is that a tap is `null`, and a tap is the case a gesture test is
 * least likely to reproduce faithfully.
 */
export const gestureIntent = (dx, dy, threshold) => {
    const up = -dy;
    if (up > threshold && up > Math.abs(dx) + AXIS_MARGIN_PX) return 'skip';
    if (Math.abs(dx) > threshold && Math.abs(dx) > up + AXIS_MARGIN_PX) return dx > 0 ? 'yes' : 'no';
    return null;
};

/* ------------------------------------------------------------------------------------ */
/* The requests                                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * The `kind: "ritual"` row (§6.3).
 *
 * `asked` is every question the deck put on screen; `answers` holds only the ones that were
 * answered. **A skipped question is absent, never `false`** (invariant 14) — and `asked` is
 * the only thing that can tell a question nobody answered from one that was never shown, so
 * it is recorded even though it is derivable from tonight's settings, which tomorrow's are
 * not.
 */
export const buildRitualRequest = ({
    asked, answers, dayWord, mentions = [], durationMs, at, day, ids, source = null
}) => {
    const payload = {
        v: PAYLOAD_VERSION,
        question_set: { version: RITUAL_QUESTION_SET_VERSION, asked },
        answers,
        rollover_hour: DAY_ROLLOVER_HOUR,
        duration_ms: durationMs
    };

    // §3.7: a ritual answered by speaking carries `source: "voice"` and is otherwise
    // identical to a swiped one. Absent for the swipes rather than `"swipe"`, so every row
    // written before D3 keeps meaning exactly what it meant, and the server — which reads
    // named keys and lets the rest travel through (§6.4) — needs no change at all.
    if (source) payload.source = source;

    // Absent when the closing card was skipped, and carrying no `uncertain`: the ritual has
    // no affordance for "I am unsure of this word", so writing `false` would be recording a
    // statement nobody made. `readRitual` reads its absence as null, which draws the same.
    if (dayWord) payload.day_word = { id: dayWord };

    return {
        client_id: ids.ritual,
        kind: 'ritual',
        at,
        day,
        schema_version: 1,
        payload,
        mentions,
        triggers: [],
        supersedes_id: null
    };
};

/**
 * The day word's second home: a `checkin` row at the ritual's own `at`, with
 * `source: "ritual_word"`.
 *
 * The duplication is the point (§6.3). The day graph and the mention logic read check-ins;
 * writing the word as one means neither of them ever has to know that rituals exist, and the
 * ritual row keeps its own copy so the night reads whole in an export.
 *
 * It carries **no `intensity`**. The closing card is one tap on one word — there is no
 * strength in it to record, and inventing a middle number would be the app authoring a value
 * the user did not (invariant 15). `readCheckin` already reads an absent intensity as `null`
 * rather than zero, and the server accepts the absence for the same reason.
 */
export const buildDayWordRequest = ({ dayWord, at, day, now, ids }) => ({
    client_id: ids.dayWord,
    kind: 'checkin',
    at,
    day,
    schema_version: 1,
    payload: {
        v: PAYLOAD_VERSION,
        source: 'ritual_word',
        tz_offset_min: tzOffsetMinutes(now),
        feelings: [{ id: dayWord, about: [] }]
    },
    mentions: [],
    triggers: [],
    supersedes_id: null
});

/* ------------------------------------------------------------------------------------ */
/* The card                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * One card, and the only element on this route that owns a touch axis.
 *
 * The tilt follows the finger so the direction is legible before release — at bedtime the
 * feedback has to arrive before the commitment does.
 */
const Card = ({ children, onCommit }) => {
    const cardRef = useRef(null);
    const drag = useRef(null);
    const [offset, setOffset] = useState(null);

    const onPointerDown = (event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY };
        setOffset({ dx: 0, dy: 0 });
    };

    const onPointerMove = (event) => {
        if (!drag.current) return;
        setOffset({ dx: event.clientX - drag.current.x, dy: event.clientY - drag.current.y });
    };

    const onPointerUp = (event) => {
        if (!drag.current) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);

        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        drag.current = null;
        setOffset(null);

        const intent = gestureIntent(dx, dy, commitThreshold(cardRef.current));
        // `null` is a tap, or a drag that did not travel far enough. Both spring back and
        // record nothing — the card is not a button, and a half-asleep tap must not answer
        // a question (§3.4).
        if (intent) onCommit(intent);
    };

    const onPointerCancel = () => {
        drag.current = null;
        setOffset(null);
    };

    const dx = offset?.dx ?? 0;
    const dy = offset?.dy ?? 0;
    // A small tilt, not a throw: the card leans about a degree per twenty pixels and the
    // lean is capped, so a long drag reads as intent rather than as the card coming loose.
    const tilt = Math.max(-12, Math.min(12, dx / 18));
    const leaning = offset ? gestureIntent(dx, dy, commitThreshold(cardRef.current)) : null;

    return (
        <div
            ref={cardRef}
            data-ritual-card
            data-leaning={leaning ?? ''}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={{
                // Both axes, and only here. The claim is conditional on this route staying
                // non-scrolling: there is nothing under the card for a vertical drag to
                // scroll, which is the one condition invariant 2g lets a control take
                // everything under. **If this screen ever grows a scrollable region, the
                // card gives up the vertical axis (`touch-action: pan-y`) and skip becomes a
                // button only** — a swipe-up that fights the page is worse than no swipe-up.
                touchAction: 'none',
                transform: offset ? `translate(${dx}px, ${dy}px) rotate(${tilt}deg)` : undefined,
                transition: offset ? 'none' : 'transform 180ms ease-out'
            }}
            className="w-full select-none rounded-3xl bg-white border border-slate-100 shadow-sm px-4 sm:px-6 py-5 sm:py-10 flex flex-col items-center justify-center text-center gap-4 sm:gap-6 cursor-grab active:cursor-grabbing"
        >
            {children}
        </div>
    );
};

/** The two answers, written under the card so the swipe is never the only way in. */
const YesNoButtons = ({ onAnswer }) => (
    <div className="flex items-center justify-center gap-3 w-full">
        <button
            type="button"
            data-ritual-no
            onClick={() => onAnswer('no')}
            className="flex-1 max-w-[10rem] min-h-[56px] rounded-2xl border border-slate-200 bg-white text-slate-600 font-medium hover:border-slate-400 transition-colors"
        >
            {JOURNAL_COPY.ritual.no}
        </button>
        <button
            type="button"
            data-ritual-yes
            onClick={() => onAnswer('yes')}
            className="flex-1 max-w-[10rem] min-h-[56px] rounded-2xl bg-slate-800 text-white font-medium hover:bg-slate-900 transition-colors"
        >
            {JOURNAL_COPY.ritual.yes}
        </button>
    </div>
);

const SkipLink = ({ onSkip }) => (
    <button
        type="button"
        data-ritual-skip
        onClick={onSkip}
        className="text-sm font-light text-slate-400 hover:text-slate-600 underline underline-offset-4 min-h-[44px] px-4 transition-colors"
    >
        {JOURNAL_COPY.ritual.skip}
    </button>
);

/** Position in the deck, as dots. A place in a sequence, never a score of one. */
const Progress = ({ index, total }) => (
    <div
        className="flex items-center gap-1.5"
        aria-label={fillCopy(JOURNAL_COPY.ritual.progress, { index: index + 1, total })}
    >
        {Array.from({ length: total }, (unused, position) => (
            <span
                key={position}
                className={`h-1.5 rounded-full transition-all ${position === index
                    ? 'w-4 bg-slate-500'
                    : position < index ? 'w-1.5 bg-slate-300' : 'w-1.5 bg-slate-200'
                    }`}
            />
        ))}
    </div>
);

/* ------------------------------------------------------------------------------------ */
/* The screen                                                                             */
/* ------------------------------------------------------------------------------------ */

export default function RitualCards() {
    const navigate = useNavigate();
    const { createEntry } = useJournal();
    const { relationships } = useSubjects();
    const { discreet, maskName } = useDiscretion();

    // Read once, at mount. Settings changed in another tab mid-ritual would otherwise
    // lengthen or shorten a deck the user is halfway through.
    const [deck] = useState(() => ritualDeck(readOptionalQuestions()));
    const [askWho] = useState(readAskWho);

    const [index, setIndex] = useState(0);
    const [answers, setAnswers] = useState({});

    /**
     * §3.7's one breath, on the Full tier only.
     *
     * The offer is on the first card and nowhere else: it is an alternative to starting the
     * deck, not a thing to reach for halfway through it. `spoken` turns it off for the rest
     * of the night once it has been used or declined, so a person who came back to the cards
     * is not asked again.
     *
     * The kit is built lazily and only where it could be used, so a Light-tier phone builds
     * no recorder and opens no model — the same rule the check-in composer follows.
     */
    const [voiceTier] = useState(() => effectiveTier(detectTier(), readTierOverride()).tier);
    const [spoken, setSpoken] = useState(false);
    const canSpeak = voiceTier === TIERS.full
        && readVoiceSetting(true) === true
        && readSuggestions() === true
        && !discreet;
    const voiceKit = useMemo(
        () => (canSpeak && !spoken ? createVoiceKit({ tier: voiceTier }) : null),
        [canSpeak, spoken, voiceTier]
    );
    const voiceContext = useMemo(
        () => buildContext({ relationships }),
        [relationships]
    );
    const [who, setWho] = useState([]);
    const [dayWord, setDayWord] = useState(null);
    // §3.7: "a ritual answered by voice carries `source: "voice"` and is otherwise identical
    // to one answered by swipes". `null` for the swipes, so the ordinary row is unchanged
    // and no reader has to know this field exists.
    const [source, setSource] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [saved, setSaved] = useState(null);

    const startedAt = useRef(Date.now());
    // Minted once and reused by every retry, so a save that failed halfway replays as the
    // same two rows rather than as two more (§7.2). The moment is fixed here too: the ritual
    // and its day word share one `at`, and a retry must not move it.
    const pending = useRef(null);

    const asked = useMemo(() => deck.map(question => question.id), [deck]);

    /**
     * The deck as steps, with the *Who?* card spliced in behind a yes.
     *
     * Derived rather than stored, so the card appears the moment the answer exists and the
     * index that was about to advance lands on it. It is spliced next to the question it
     * belongs to rather than appended at the end, because "who was that" is a question about
     * something the user is still holding in mind.
     */
    const steps = useMemo(() => {
        const list = [];
        deck.forEach(question => {
            list.push({ kind: 'question', id: question.id, text: question.text });
            if (question.id === 'with_people' && askWho && answers.with_people === true) {
                list.push({ kind: 'who' });
            }
        });
        list.push({ kind: 'word' });
        return list;
    }, [deck, askWho, answers.with_people]);

    const step = steps[index] ?? null;

    /**
     * One selection tick per commit, and none in discretion mode.
     *
     * `detent` already silences its *sound* under discretion; the haptic channel is not
     * silenced there, because a vibration in your own hand is not overheard. Here the whole
     * call is guarded anyway: §3.4 asks for no feedback at all in that mode, and a phone
     * buzzing once a second on a bedside table is the thing discretion is for.
     */
    const tick = useCallback(() => {
        if (!discreet) detent();
    }, [discreet]);

    const finish = useCallback(async (word) => {
        setSaving(true);
        setSaveError(null);

        if (!pending.current) {
            const now = new Date();
            pending.current = {
                now,
                at: rfc3339Local(now),
                day: civilDay(now, DAY_ROLLOVER_HOUR),
                durationMs: Date.now() - startedAt.current,
                ids: { ritual: clientId(), dayWord: clientId() }
            };
        }
        const { now, at, day, durationMs, ids } = pending.current;

        const mentions = who.map((relationshipId, ref) => ({
            ref,
            relationship_id: relationshipId,
            // The stored label is the name as it stands, never the masked one: discretion is
            // a property of this screen, not of the record.
            label: relationships.find(person => person.ID === relationshipId)?.name || ''
        }));

        try {
            await createEntry(buildRitualRequest({
                asked, answers, dayWord: word, mentions, durationMs, at, day, ids, source
            }));
            // Second, and only if there is one. A day word with no ritual behind it would be
            // an orphan; a ritual whose second write failed still reads whole, because the
            // row keeps its own copy of the word.
            if (word) await createEntry(buildDayWordRequest({ dayWord: word, at, day, now, ids }));

            setSaved({ day });
        } catch (error) {
            console.error('Failed to save the ritual', error);
            setSaveError(error?.response?.data?.error || JOURNAL_COPY.ritual.saveError);
        } finally {
            setSaving(false);
        }
    }, [answers, asked, createEntry, relationships, source, who]);

    /** Advance, or save if this was the last card. */
    const advance = useCallback((word = dayWord) => {
        if (index >= steps.length - 1) {
            finish(word);
            return;
        }
        setIndex(current => current + 1);
    }, [dayWord, finish, index, steps.length]);

    const commit = useCallback((intent) => {
        if (!step || saving || saved) return;

        if (step.kind === 'question') {
            if (intent === 'yes' || intent === 'no') {
                tick();
                setAnswers(current => ({ ...current, [step.id]: intent === 'yes' }));
                setIndex(current => current + 1);
                return;
            }
            if (intent === 'skip') {
                // Absent from `answers`, and that absence is the record (invariant 14).
                tick();
                setIndex(current => current + 1);
            }
            return;
        }

        // The who and word cards answer by tapping, so the only gesture they take is the one
        // that means "not tonight".
        if (intent === 'skip') {
            tick();
            advance(step.kind === 'word' ? null : dayWord);
        }
    }, [advance, dayWord, saved, saving, step, tick]);

    /** The keyboard, exactly equivalent to the three gestures (§3.4). */
    useEffect(() => {
        const onKeyDown = (event) => {
            const intent = { ArrowRight: 'yes', ArrowLeft: 'no', ArrowUp: 'skip' }[event.key];
            if (!intent) return;
            event.preventDefault();
            commit(intent);
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [commit]);

    const pickDayWord = (id) => {
        tick();
        setDayWord(id);
        advance(id);
    };

    const toggleWho = (relationshipId) => {
        setWho(current => (
            current.includes(relationshipId)
                ? current.filter(id => id !== relationshipId)
                : [...current, relationshipId]
        ));
    };

    if (saved) {
        return (
            <Shell>
                <div data-ritual-done className="flex flex-col items-center gap-6 text-center">
                    <p className="text-2xl font-light text-slate-700">{JOURNAL_COPY.ritual.done}</p>
                    <Link
                        to={journalDayPath(saved.day)}
                        className="text-sm font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                    >
                        {JOURNAL_COPY.nav.back}
                    </Link>
                </div>
            </Shell>
        );
    }

    return (
        <Shell
            onClose={() => navigate(JOURNAL_ROOT)}
            progress={<Progress index={Math.min(index, steps.length - 1)} total={steps.length} />}
        >
            <div className="w-full max-w-md h-full flex flex-col">
                {voiceKit && index === 0 && (
                    <div className="mb-4" data-ritual-voice-block>
                        <RitualVoice
                            kit={voiceKit}
                            deck={deck}
                            context={voiceContext}
                            onAnswers={(spokenAnswers) => {
                                // The answers the person confirmed, and nothing else. The
                                // deck then continues from the *Who?* card if there is one
                                // to show, or from the day word — the questions they did not
                                // mention stay unanswered, which is §3.7's own rule and
                                // invariant 14's.
                                setAnswers(spokenAnswers);
                                setSpoken(true);
                                setSource('voice');
                                const whoAt = deck.findIndex(q => q.id === 'with_people') + 1;
                                setIndex(spokenAnswers.with_people === true && askWho && whoAt > 0
                                    ? whoAt
                                    : deck.length);
                            }}
                            onCards={() => setSpoken(true)}
                        />
                    </div>
                )}
                {/* The card takes the space, the controls sit at the bottom of it. Anchoring
                    them low is not decoration: the acceptance test for this screen is one
                    thumb on a 360 dp phone, and a Yes button in the middle of a 800 dp
                    viewport is a two-handed control. */}
                <div className="flex-1 min-h-0 flex items-center justify-center">
                <Card onCommit={commit}>
                    {step?.kind === 'question' && (
                        <>
                            <p
                                data-ritual-step={`question:${step.id}`}
                                className="text-2xl sm:text-3xl font-light text-slate-800 leading-snug"
                            >
                                {step.text}
                            </p>
                            {/* The two answers written under the question, in the direction
                                each one lives in, so the gesture is legible without being
                                taught (§3.4). */}
                            <p className="flex items-center gap-6 text-sm font-light text-slate-400">
                                <span>← {JOURNAL_COPY.ritual.no}</span>
                                <span>{JOURNAL_COPY.ritual.yes} →</span>
                            </p>
                        </>
                    )}

                    {step?.kind === 'who' && (
                        <>
                            <p data-ritual-step="who" className="text-2xl font-light text-slate-800">
                                {JOURNAL_COPY.ritual.who}
                            </p>
                            <p className="text-xs font-light text-slate-400">{JOURNAL_COPY.ritual.whoHint}</p>
                            <div className="flex flex-wrap justify-center gap-2">
                                {relationships.map(person => (
                                    <button
                                        key={person.ID}
                                        type="button"
                                        data-who={person.ID}
                                        aria-pressed={who.includes(person.ID)}
                                        // The chip is masked, the stored label is not — see
                                        // `mentions` above. The `aria-label` keeps the real
                                        // name, as discretion mode does everywhere.
                                        aria-label={person.name}
                                        onClick={() => toggleWho(person.ID)}
                                        className={`px-3 py-2 min-h-[44px] rounded-xl border text-sm transition-colors ${who.includes(person.ID)
                                            ? 'bg-slate-800 text-white border-slate-800'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                                            }`}
                                    >
                                        {maskName(person.name)}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}

                    {step?.kind === 'word' && (
                        <>
                            <p data-ritual-step="word" className="text-xl sm:text-2xl font-light text-slate-800">
                                {JOURNAL_COPY.ritual.dayWord}
                            </p>
                            <div className="flex flex-wrap justify-center gap-1.5">
                                {activeFeelings().map(feeling => (
                                    <button
                                        key={feeling.id}
                                        type="button"
                                        data-day-word={feeling.id}
                                        onClick={() => pickDayWord(feeling.id)}
                                        style={{ borderColor: feeling.hex }}
                                        className="px-2.5 py-1.5 min-h-[36px] rounded-xl border-2 bg-white text-slate-700 text-[13px] sm:text-sm hover:bg-slate-50 transition-colors"
                                    >
                                        {feeling.label}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </Card>
                </div>

                <div className="flex-shrink-0 flex flex-col gap-4 pb-2">
                {step?.kind === 'question' && (
                    <YesNoButtons onAnswer={(intent) => commit(intent)} />
                )}

                {step?.kind === 'who' && (
                    <button
                        type="button"
                        data-ritual-who-done
                        onClick={() => { tick(); advance(); }}
                        className="w-full min-h-[56px] rounded-2xl bg-slate-800 text-white font-medium hover:bg-slate-900 transition-colors"
                    >
                        {JOURNAL_COPY.ritual.whoDone}
                    </button>
                )}

                <div className="flex flex-col items-center">
                    <SkipLink onSkip={() => commit('skip')} />
                    {/* The hint stands under every card but the closing one. That card draws
                        twenty-one chips and is the tallest thing this route has; on a 320 dp
                        screen it needs the room more than the sentence does, and the route
                        has to fit without scrolling or the card loses its axis claim. */}
                    {step?.kind !== 'word' && (
                        <p className="text-xs font-light text-slate-300 text-center max-w-xs">
                            {JOURNAL_COPY.ritual.skipHint}
                        </p>
                    )}
                </div>

                {saving && (
                    <p className="text-center text-sm font-light text-slate-400">
                        {JOURNAL_COPY.ritual.saving}
                    </p>
                )}

                {saveError && (
                    <div role="alert" className="flex flex-col items-center gap-2">
                        <p className="text-center text-sm font-light text-amber-700">{saveError}</p>
                        <button
                            type="button"
                            data-ritual-retry
                            onClick={() => finish(dayWord)}
                            className="text-sm font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
                        >
                            {JOURNAL_COPY.ritual.retry}
                        </button>
                    </div>
                )}
                </div>
            </div>
        </Shell>
    );
}

/**
 * The full-viewport frame, over the header and the bottom bar rather than between them.
 *
 * It is `fixed inset-0` for one reason and it is not aesthetics: the touch-axis claim on the
 * card is only legitimate while nothing on the screen scrolls, and a route rendered inside
 * `App`'s scrolling column would inherit a page that does. Below the app lock's layer and
 * above the composer's, because the lock outranks everything and the composer cannot be open
 * here.
 */
const Shell = ({ children, onClose, progress }) => (
    <div className="fixed inset-0 z-[70] bg-slate-50 overflow-hidden flex flex-col pt-safe pb-safe">
        <div className="flex items-center justify-between px-4 py-2 sm:py-3 flex-shrink-0">
            {onClose ? (
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={JOURNAL_COPY.ritual.close}
                    className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-300 hover:text-slate-500 rounded-lg transition-colors"
                >
                    <X size={20} />
                </button>
            ) : <span />}
            {progress}
        </div>

        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 pb-6">
            {children}
        </div>
    </div>
);

/* ------------------------------------------------------------------------------------ */
/* The web prompt line (§3.6)                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Session storage, not local: tomorrow is a new day and the line is allowed to say its one
 * sentence again. The same mechanism and the same reasoning as `CadenceNudge`'s `SEEN_KEY`,
 * with the civil day as the value so a session that spans a rollover does not stay retired.
 */
const PROMPT_SEEN_KEY = 'alq:journal-ritual-seen';

export const readRitualPromptSeen = () => {
    try {
        return window.sessionStorage.getItem(PROMPT_SEEN_KEY);
    } catch {
        return null;
    }
};

export const markRitualPromptSeen = (day) => {
    try {
        window.sessionStorage.setItem(PROMPT_SEEN_KEY, day);
    } catch {
        // A blocked write costs one repeated line, not the feature.
    }
};

/**
 * Whether the ritual owns the dashboard's nudge slot tonight, and whether its line is showing.
 *
 * **The two nudges never stack** (§3.6, invariant 2c). Two calm sentences one above the other
 * are a to-do list, which is the thing this app refuses to be — so ownership of the slot is a
 * single decision and the cadence banner simply waits for the next session. `owns` stays true
 * after the line has been answered, which is what makes it a *session* handover rather than a
 * gap the cadence banner slides into the moment the ritual is done.
 *
 * The one edge, stated because it is a choice and not an oversight: a ritual completed
 * without ever being prompted — from the journal, or from Android's shortcut in F2 — hands
 * the slot back, because nothing this session ever claimed it.
 */
export const useRitualPrompt = (now = new Date()) => {
    const { entries } = useJournal();
    // Read once per mount, like `CadenceNudge`: the line must not reappear the moment its
    // own state changes.
    const [setting] = useState(readRitualSetting);
    const [seen, setSeen] = useState(readRitualPromptSeen);

    const day = civilDay(now, DAY_ROLLOVER_HOUR);
    const recorded = entries.some(entry => entry.kind === 'ritual' && entry.day === day);
    const due = setting.on && !recorded && ritualTimeReached(setting.time, now);

    const retire = useCallback(() => {
        const today = civilDay(new Date(), DAY_ROLLOVER_HOUR);
        markRitualPromptSeen(today);
        setSeen(today);
    }, []);

    return {
        owns: due || seen === day,
        visible: due && seen !== day,
        path: RITUAL_PATH,
        retire
    };
};

/** One line, in the cadence banner's own shape, so the dashboard has one grammar for both. */
export const RitualNudge = ({ onStart, onDismiss }) => (
    <div className="mb-6 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-start gap-3">
            <Clock size={18} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 font-light">{JOURNAL_COPY.ritual.prompt}</p>

                <div className="flex flex-wrap items-center gap-3 mt-3">
                    <button
                        type="button"
                        data-ritual-start
                        onClick={onStart}
                        className="px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors"
                    >
                        {JOURNAL_COPY.ritual.start}
                    </button>
                    <button
                        type="button"
                        data-ritual-not-tonight
                        onClick={onDismiss}
                        className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        {JOURNAL_COPY.ritual.dismiss}
                    </button>
                </div>
            </div>
            <button
                type="button"
                onClick={onDismiss}
                aria-label={JOURNAL_COPY.ritual.dismiss}
                className="p-1 text-slate-300 hover:text-slate-500 rounded transition-colors flex-shrink-0"
            >
                <X size={16} />
            </button>
        </div>
    </div>
);
