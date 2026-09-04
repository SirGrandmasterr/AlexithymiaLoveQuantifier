import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Square, Loader2 } from 'lucide-react';
import { JOURNAL_COPY, fillCopy } from '../constants/journal';
import { useDiscretion } from '../context/DiscretionContext';
import { audioInput, proposeRitual } from '../journal/inference';

/**
 * The ritual in one breath (§3.7) — *"Slept okay, didn't move, was outside, saw Lucie, ate
 * late."*
 *
 * It exists for nights when even swiping is too much, and it changes nothing about the
 * record: one clip through the same single pass as a check-in, with the night's question ids
 * in the prompt and the ritual payload as the output schema, and then **the same confirm
 * card** — one row per question, each answer pre-selected but **dashed** until confirmed.
 *
 * **Three rules, each of them invariant 15 wearing a different hat, and each one a line of
 * code here rather than an intention:**
 *
 * 1. **A question the note did not mention is absent, not `false`** (invariant 14). It gets a
 *    row like every other question, because the person may want to answer it; what it does
 *    not get is a value. `answers` is built from what is *chosen*, so a row nobody touched
 *    contributes no key at all.
 * 2. **Nothing here saves.** This component hands its answers up and the ritual screen writes
 *    them through the same `buildRitualRequest` the swipes use. There is one write path, and
 *    a proposal never gets its own.
 * 3. **Every exit leads to the cards.** Nothing heard, a runtime that would not answer, or a
 *    person who simply changes their mind: all three land on the deck, which is the thing
 *    that always works. The swipe cards remain the default and the only path on the Light and
 *    text-only tiers, and this component is not rendered there at all.
 *
 * The people the model heard are shown and **not resolved here**. A yes to *with someone*
 * still opens the *Who?* card, where relationship ids are chosen by tapping (§3.5) — the one
 * place in the app allowed to attach a person to a record, and not a place a model may reach.
 */

/** A store snapshot, subscribed the way React 19 wants stores subscribed. */
const useStore = (store) => useSyncExternalStore(
    useCallback(listener => store.subscribe(listener), [store]),
    useCallback(() => store.getSnapshot(), [store])
);

/**
 * One question, one row: *Yes* / *No*, and the choice the model proposed shown **dashed**
 * until it is confirmed.
 *
 * The dashed border is the same signal the check-in's proposal card uses for the same thing,
 * and the same one the ritual's own cards use for a day word — *not saved yet*. Confirming is
 * a tap on the choice, which is deliberately the same gesture as changing it: there is no
 * "accept all", because accepting all is exactly the tap nobody reads.
 */
const Row = ({ question, choice, proposed, confirmed, onChoose }) => (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-slate-100 last:border-0">
        <span className="text-sm text-slate-700 font-light flex-1">{question.text}</span>
        <span className="flex gap-2 flex-shrink-0">
            {[true, false].map((value) => {
                const picked = choice === value;
                const dashed = picked && !confirmed && proposed === value;
                return (
                    <button
                        key={String(value)}
                        type="button"
                        data-ritual-row={question.id}
                        data-choice={String(value)}
                        aria-pressed={picked}
                        onClick={() => onChoose(picked && confirmed ? null : value)}
                        className={`px-4 py-2 min-h-[44px] min-w-[64px] rounded-xl text-sm transition-all ${picked
                            ? dashed
                                ? 'border-2 border-dashed border-slate-400 text-slate-700 bg-white'
                                : 'bg-slate-800 text-white border-2 border-slate-800'
                            : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-slate-300'
                            }`}
                    >
                        {value ? JOURNAL_COPY.ritual.yes : JOURNAL_COPY.ritual.no}
                        <span className="sr-only">
                            {picked
                                ? ` — ${confirmed ? '' : JOURNAL_COPY.ritual.voice.unconfirmed}`
                                : ''}
                        </span>
                    </button>
                );
            })}
        </span>
    </div>
);

/**
 * The confirm card.
 *
 * `state` holds one entry per question **asked tonight** — not per question answered — so a
 * question the model skipped is on screen with nothing chosen and can still be answered by
 * hand. What leaves here is the subset that has a boolean.
 */
export const RitualVoiceConfirm = ({ deck, proposed, people, onKeep, onCards }) => {
    const [choices, setChoices] = useState(() => Object.fromEntries(
        deck.map(question => [question.id, proposed[question.id] ?? null])
    ));
    const [confirmed, setConfirmed] = useState(() => Object.fromEntries(deck.map(q => [q.id, false])));

    const choose = (id, value) => {
        setChoices(current => ({ ...current, [id]: value }));
        setConfirmed(current => ({ ...current, [id]: value !== null }));
    };

    const keep = () => {
        // The answers, and only the answers. A row nobody chose contributes no key, which is
        // what makes a skipped question absent rather than false (invariant 14, §6.3).
        const answers = {};
        deck.forEach((question) => {
            if (typeof choices[question.id] === 'boolean') answers[question.id] = choices[question.id];
        });
        onKeep(answers);
    };

    return (
        <div className="space-y-4" data-ritual-voice="confirm">
            <div>
                <h2 className="text-lg font-light text-slate-800">{JOURNAL_COPY.ritual.voice.confirm}</h2>
                <p className="mt-1 text-xs text-slate-400 font-light leading-relaxed">
                    {JOURNAL_COPY.ritual.voice.confirmHint}
                </p>
            </div>

            {people.length > 0 && (
                <p className="text-xs text-slate-500 font-light" data-ritual-voice-people>
                    {fillCopy(JOURNAL_COPY.ritual.voice.heard, { names: people.join(', ') })}
                </p>
            )}

            <div className="rounded-xl border border-slate-200 bg-white px-4">
                {deck.map(question => (
                    <Row
                        key={question.id}
                        question={question}
                        choice={choices[question.id]}
                        proposed={proposed[question.id] ?? null}
                        confirmed={confirmed[question.id]}
                        onChoose={value => choose(question.id, value)}
                    />
                ))}
            </div>

            <div className="flex flex-wrap gap-3">
                <button
                    type="button"
                    data-ritual-voice-keep
                    onClick={keep}
                    className="px-5 py-2.5 min-h-[48px] bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 transition-all"
                >
                    {JOURNAL_COPY.ritual.voice.keep}
                </button>
                <button
                    type="button"
                    data-ritual-voice-cards
                    onClick={onCards}
                    className="px-5 py-2.5 min-h-[48px] bg-white border border-slate-200 text-slate-600 text-sm rounded-xl hover:border-slate-400 transition-all"
                >
                    {JOURNAL_COPY.ritual.voice.cards}
                </button>
            </div>
        </div>
    );
};

/**
 * The offer, the recording, and the pass — everything before the confirm card.
 *
 * `kit` is the same trio the check-in composer holds (`createVoiceKit`), injected for the
 * same reason: a test needs no microphone and no weights. `deck` is tonight's questions, and
 * it is what goes into the prompt and the schema — so a question the user turned off is one
 * the model is never given the chance to answer.
 */
export default function RitualVoice({ kit, deck, context, onAnswers, onCards }) {
    const { recorder, runtime } = kit;
    const capture = useStore(recorder);
    const { discreet } = useDiscretion();

    const [thinking, setThinking] = useState(false);
    const [result, setResult] = useState(null);
    const [problem, setProblem] = useState(null);
    const live = useRef(true);
    useEffect(() => () => { live.current = false; }, []);

    const clips = capture.clips || [];
    const recording = capture.state === 'recording';
    const busy = capture.state === 'requesting' || capture.state === 'decoding';

    const run = useCallback(async (takes) => {
        setThinking(true);
        setProblem(null);
        const answer = await proposeRitual(audioInput(takes), context, runtime, deck);
        if (!live.current) return;
        setThinking(false);

        if (!answer.ok) {
            setProblem(JOURNAL_COPY.ritual.voice.unavailable);
            return;
        }
        if (Object.keys(answer.proposal.answers).length === 0 && !answer.proposal.transcript) {
            setProblem(JOURNAL_COPY.ritual.voice.nothing);
            return;
        }
        setResult(answer.proposal);
    }, [context, deck, runtime]);

    // A finished take runs the pass. The recorder stops itself on silence or at thirty
    // seconds (§4.2), so this is the ordinary end of a recording and not only the tap.
    useEffect(() => {
        if (recording || thinking || result || problem) return;
        if (clips.length === 0) return;
        run(clips);
    }, [clips, recording, thinking, result, problem, run]);

    const tap = () => recorder.tap?.();

    if (result) {
        return (
            <RitualVoiceConfirm
                deck={deck}
                proposed={result.answers}
                people={result.people.map(person => person.name)}
                onKeep={onAnswers}
                onCards={onCards}
            />
        );
    }

    if (problem) {
        return (
            <p className="text-sm text-slate-500 font-light" role="status" data-ritual-voice="problem">
                {problem}
            </p>
        );
    }

    if (busy) {
        return (
            <p className="text-sm text-slate-500 font-light flex items-center gap-2" role="status" data-ritual-voice="busy">
                <Loader2 size={16} className="animate-spin text-slate-400" />
                {JOURNAL_COPY.ritual.voice.listening}
            </p>
        );
    }

    if (thinking) {
        return (
            <p className="text-sm text-slate-500 font-light flex items-center gap-2" role="status" data-ritual-voice="thinking">
                <Loader2 size={16} className="animate-spin text-slate-400" />
                {JOURNAL_COPY.ritual.voice.reading}
            </p>
        );
    }

    if (recording) {
        return (
            <button
                type="button"
                data-ritual-voice="stop"
                onClick={tap}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] bg-slate-800 text-white text-sm rounded-xl"
            >
                <Square size={16} />
                {JOURNAL_COPY.ritual.voice.listening}
            </button>
        );
    }

    // Discretion mode never offers this: speaking a note aloud is what the mode exists to
    // avoid, and a disabled microphone still says *you could be recording* to anyone looking
    // (§4.4, §9.6). The cards are already on screen underneath.
    if (discreet) return null;

    return (
        <div className="space-y-2" data-ritual-voice="offer">
            <button
                type="button"
                data-ritual-voice-start
                onClick={tap}
                className="w-full flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] bg-white border border-slate-200 text-slate-600 text-sm rounded-xl hover:border-slate-400 transition-all"
            >
                <Mic size={16} />
                {JOURNAL_COPY.ritual.voice.offer}
            </button>
            <p className="text-xs text-slate-400 font-light leading-relaxed">
                {JOURNAL_COPY.ritual.voice.hint}
            </p>
        </div>
    );
}
