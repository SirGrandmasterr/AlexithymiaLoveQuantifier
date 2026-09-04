import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, ChevronLeft, ChevronRight, CloudOff, Info, Loader2, NotebookPen, Trash2 } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useDiscretion } from '../context/DiscretionContext';
import CheckinComposer, { CheckinButton, CheckinFab, chipClass } from './CheckinComposer';
import { useVoiceAvailability } from './VoiceCheckin';
import { buildContext } from '../journal/inference';
import { useSubjects } from '../context/SubjectsContext';
import usePullToRefresh from '../mobile/usePullToRefresh';
import DayGraph from './DayGraph.jsx';
import { Modal } from './RelationshipDialogs';
import {
    JOURNAL_COPY,
    JOURNAL_ROOT,
    PEOPLE_PATH,
    RECORD_PARAM,
    RECORD_PARAM_VALUE,
    SEARCH_PATH,
    TRIGGERS_PATH,
    UNCLEAR_FEELING_ID,
    civilDay,
    dayRange,
    feelingById,
    fillCopy,
    isDayString,
    journalDayPath,
    monthBounds,
    questionById,
    readCheckin,
    readPersonFact,
    readRitual,
    shiftDay,
    timeOfDay
} from '../constants/journal';
// One owner for the three settings keys, so the first-run card and the profile screen
// cannot disagree about what "the ritual has been decided here" means.
import { ritualSettingUntouched } from '../constants/journalSettings';

export const Frame = ({ children, pull = 0, refreshing = false, armed = false }) => (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
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
            className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6"
            style={pull > 0 ? { transform: `translateY(${pull}px)` } : undefined}
        >
            {children}
        </div>
    </div>
);

export const Loading = () => (
    <div className="flex justify-center items-center py-24">
        <Loader2 className="animate-spin text-slate-400" size={28} />
    </div>
);

export const LoadFailed = ({ message, onDismiss }) => (
    <div
        role="alert"
        className="p-4 rounded-lg flex items-center gap-3 bg-red-50 text-red-800 border border-red-200"
    >
        <Info size={18} className="flex-shrink-0" />
        <span className="flex-1 text-sm">{message}</span>
        {onDismiss && (
            <button
                type="button"
                onClick={onDismiss}
                className="text-xs font-medium underline underline-offset-4"
            >
                {JOURNAL_COPY.day.dismiss}
            </button>
        )}
    </div>
);

// Re-exported, not redeclared: it is defined in CheckinComposer because that module cannot
// import this one. Two identical literals is the shape a restyle silently half-applies.
export { chipClass };

export const PendingMark = ({ error = null }) => (
    <span
        data-pending-mark
        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400"
    >
        <CloudOff size={12} className="flex-shrink-0" />
        {error ? fillCopy(JOURNAL_COPY.day.notSent, { reason: error }) : JOURNAL_COPY.day.notSynced}
    </span>
);

export const FeelingChip = ({ feeling }) => {
    const known = feelingById(feeling.id);
    const hex = known?.hex ?? '#94a3b8';
    const dashed = feeling.uncertain === true || feeling.id === UNCLEAR_FEELING_ID;
    const intensity = JOURNAL_COPY.checkin.intensity[feeling.intensity];

    return (
        <span
            data-feeling={feeling.id}
            data-uncertain={dashed ? 'true' : 'false'}
            className={`${chipClass} border text-slate-700 ${dashed ? 'border-dashed' : 'border-solid'}`}
            style={{ borderColor: hex, backgroundColor: `${hex}1f` }}
        >
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
            <span data-feeling-label>{known?.label ?? feeling.id}</span>
            {intensity && <span className="font-normal text-slate-500">{intensity}</span>}
        </span>
    );
};

/** A person. Masked to initials under discretion, never blurred — the mask *is* the cover. */
export const PersonChip = ({ name }) => {
    const { maskName } = useDiscretion();
    return <span className={`${chipClass} bg-slate-800/5 text-slate-600`}>{maskName(name)}</span>;
};

/** A trigger or a context tag. Blurred under discretion, like every other note in this app. */
export const WordChip = ({ text, kind }) => {
    const { blurClass } = useDiscretion();
    return (
        <span data-chip={kind} className={`${chipClass} bg-slate-100 text-slate-600 ${blurClass}`}>
            {text}
        </span>
    );
};

export const AttachedFeelings = ({ feelings, template, formula }) => {
    if (!feelings || feelings.length === 0) return null;

    return (
        <p className="text-[11px] text-slate-400 font-light flex items-center gap-1 flex-wrap">
            <span data-attached-feelings>
                {fillCopy(template, { feelings: feelings.map(feeling => feeling.label).join(' · ') })}
            </span>
            <span title={formula} aria-label={formula} className="cursor-help text-slate-300">
                <Info size={11} />
            </span>
        </p>
    );
};

const AboutChip = ({ about, mentionsByRef }) => {
    const { personName, resolveTrigger } = useJournal();

    if (about.kind === 'person') {
        const mention = mentionsByRef.get(about.ref);
        if (!mention) return null;
        return <PersonChip name={personName(mention)} />;
    }

    if (about.kind === 'trigger') {
        const resolved = resolveTrigger(about.trigger);
        return <WordChip kind="trigger" text={resolved.label ?? about.trigger} />;
    }

    if (about.kind === 'tag') {
        return about.tag ? <WordChip kind="tag" text={about.tag} /> : null;
    }

    return null;
};

const FeelingRow = ({ feeling, mentionsByRef }) => (
    <li className="flex flex-wrap items-center gap-2">
        <FeelingChip feeling={feeling} />
        {feeling.about.length > 0 && (
            <>
                <span className="text-xs text-slate-400">{JOURNAL_COPY.checkin.aboutLabel}</span>
                {feeling.about.map((about, index) => (
                    <AboutChip
                        key={`${about.kind}-${about.ref ?? about.trigger ?? about.tag ?? index}`}
                        about={about}
                        mentionsByRef={mentionsByRef}
                    />
                ))}
            </>
        )}
    </li>
);

const DeleteCheckinDialog = ({ entry, checkin, time, onClose }) => {
    const { deleteEntry } = useJournal();
    const [error, setError] = useState(null);
    const [deleting, setDeleting] = useState(false);

    const feelings = checkin.feelings
        .map(feeling => feelingById(feeling.id)?.label ?? feeling.id)
        .join(', ');

    const submit = async () => {
        if (deleting) return;

        setDeleting(true);
        setError(null);
        try {
            await deleteEntry(entry.ID);
            onClose();
        } catch (failure) {
            setError(failure?.response?.data?.error || JOURNAL_COPY.checkin.delete.error);
            setDeleting(false);
        }
    };

    return (
        <Modal title={JOURNAL_COPY.checkin.delete.title} onClose={onClose}>
            <div className="px-6 pb-6">
                {error && (
                    <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                        {error}
                    </p>
                )}
                <p className="text-sm text-slate-600 font-light leading-relaxed">
                    {fillCopy(JOURNAL_COPY.checkin.delete.body, { time: time ?? entry.day, feelings })}
                </p>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        {JOURNAL_COPY.checkin.delete.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={deleting}
                        className="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-rose-100"
                    >
                        {JOURNAL_COPY.checkin.delete.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

const CheckinEntry = ({ entry, opened = false }) => {
    const { blurClass } = useDiscretion();
    const checkin = readCheckin(entry.payload);
    const time = timeOfDay(entry.at);
    const [confirming, setConfirming] = useState(false);
    const article = useRef(null);

    useEffect(() => {
        // Optional-called: jsdom has no `scrollIntoView` at all, and a highlight that only
        // works where a test runner implements scrolling is not a highlight.
        if (opened) article.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, [opened]);

    const mentionsByRef = useMemo(
        () => new Map((entry.mentions ?? []).map(mention => [mention.ref, mention])),
        [entry.mentions]
    );

    return (
        <article
            ref={article}
            data-entry-kind="checkin"
            data-opened={opened ? 'true' : undefined}
            data-pending={entry.pending ? 'true' : undefined}
            className={`bg-white rounded-2xl shadow-sm border p-4 sm:p-5 space-y-3 transition-colors ${opened ? 'border-slate-300 ring-2 ring-slate-200' : 'border-slate-100'
                }`}
        >
            <div className="flex items-start justify-between gap-3">
                {time && (
                    <time dateTime={entry.at} className="block text-xs font-medium text-slate-400">
                        {time}
                    </time>
                )}
                {entry.pending ? (
                    <span className="ml-auto"><PendingMark error={entry.outbox_error} /></span>
                ) : (
                    <button
                        type="button"
                        onClick={() => setConfirming(true)}
                        aria-label={JOURNAL_COPY.checkin.delete.action}
                        className="ml-auto -mt-1 -mr-1 p-1 rounded-full text-slate-300 hover:text-rose-600 transition-colors"
                    >
                        <Trash2 size={14} />
                    </button>
                )}
            </div>

            {confirming && (
                <DeleteCheckinDialog
                    entry={entry}
                    checkin={checkin}
                    time={time}
                    onClose={() => setConfirming(false)}
                />
            )}

            <ul className="space-y-2">
                {checkin.feelings.map((feeling, index) => (
                    <FeelingRow
                        key={`${feeling.id ?? 'feeling'}-${index}`}
                        feeling={feeling}
                        mentionsByRef={mentionsByRef}
                    />
                ))}
            </ul>

            {checkin.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {checkin.tags.map(tag => <WordChip key={tag} kind="tag" text={tag} />)}
                </div>
            )}

            {checkin.transcript && (
                <p data-transcript className={`text-sm text-slate-600 font-light ${blurClass}`}>
                    {checkin.transcript}
                </p>
            )}

            {checkin.note && (
                <p data-note className={`text-sm text-slate-500 font-light ${blurClass}`}>
                    {checkin.note}
                </p>
            )}
        </article>
    );
};

const PersonFactEntry = ({ entry }) => {
    const { blurClass } = useDiscretion();
    const { personName } = useJournal();
    const fact = readPersonFact(entry.payload);
    const time = timeOfDay(entry.at);

    return (
        <article
            data-entry-kind="person_fact"
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-2"
        >
            <div className="flex flex-wrap items-center gap-2">
                {time && (
                    <time dateTime={entry.at} className="text-xs font-medium text-slate-400">{time}</time>
                )}
                {(entry.mentions ?? []).map(mention => (
                    <PersonChip key={mention.ID ?? `${mention.ref}`} name={personName(mention)} />
                ))}
            </div>
            {fact.text && (
                <p data-fact className={`text-sm text-slate-600 font-light ${blurClass}`}>{fact.text}</p>
            )}
        </article>
    );
};

const RitualFooter = ({ entry }) => {
    const { personName } = useJournal();
    const ritual = readRitual(entry.payload);
    const dayWord = ritual.dayWord?.id ? ritual.dayWord : null;

    const answerWord = (id) => {
        if (!Object.prototype.hasOwnProperty.call(ritual.answers, id)) return JOURNAL_COPY.day.unanswered;
        const answer = ritual.answers[id];
        if (answer === true) return JOURNAL_COPY.ritual.yes;
        if (answer === false) return JOURNAL_COPY.ritual.no;
        return String(answer);
    };

    return (
        <section
            data-entry-kind="ritual"
            data-pending={entry.pending ? 'true' : undefined}
            aria-label={JOURNAL_COPY.day.ritualHeading}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-3"
        >
            <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-sm font-medium text-slate-500">{JOURNAL_COPY.day.ritualHeading}</h2>
                {entry.pending && <PendingMark error={entry.outbox_error} />}
            </div>

            <dl className="space-y-1.5">
                {ritual.asked.map(id => (
                    <div key={id} className="flex items-baseline justify-between gap-4 text-sm">
                        <dt className="text-slate-600 font-light">{questionById(id)?.text ?? id}</dt>
                        <dd className="text-slate-500 flex-shrink-0">{answerWord(id)}</dd>
                    </div>
                ))}
            </dl>

            {dayWord && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-xs text-slate-400">{JOURNAL_COPY.ritual.dayWord}</span>
                    <FeelingChip feeling={{ id: dayWord.id, uncertain: dayWord.uncertain, intensity: null }} />
                </div>
            )}

            {(entry.mentions ?? []).length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">{JOURNAL_COPY.ritual.who}</span>
                    {entry.mentions.map(mention => (
                        <PersonChip key={mention.ID ?? `${mention.ref}`} name={personName(mention)} />
                    ))}
                </div>
            )}
        </section>
    );
};

/** The month the viewed day falls in, one cell per day, marking the days with something on. */
const MonthStrip = ({ day }) => {
    const { markedDays } = useJournal();
    const bounds = monthBounds(day);
    const today = civilDay();
    const days = bounds ? dayRange(bounds.from, bounds.to) : [];

    return (
        <nav aria-label={JOURNAL_COPY.day.month} className="flex flex-wrap gap-1">
            {days.map(candidate => {
                const selected = candidate === day;
                const marked = markedDays.has(candidate);

                return (
                    <Link
                        key={candidate}
                        to={journalDayPath(candidate)}
                        aria-current={selected ? 'date' : undefined}
                        aria-label={candidate}
                        className={`relative w-8 h-8 rounded-lg flex items-center justify-center text-xs transition-colors ${selected
                            ? 'bg-slate-800 text-white font-medium'
                            : 'text-slate-500 hover:bg-slate-100'
                            } ${candidate === today && !selected ? 'ring-1 ring-slate-300' : ''}`}
                    >
                        {Number(candidate.slice(8, 10))}
                        {marked && (
                            <span
                                data-marked
                                className={`absolute bottom-1 h-1 w-1 rounded-full ${selected ? 'bg-white' : 'bg-rose-400'}`}
                            />
                        )}
                    </Link>
                );
            })}
        </nav>
    );
};

const DayHeader = ({ day, today, onCompose, voice }) => (
    <header className="space-y-4">
        <div className="flex items-start justify-between gap-4">
            <MonthStrip day={day} />
            <CheckinButton onOpen={onCompose} voice={voice} />
        </div>

        <div className="flex items-center justify-between gap-3">
            <Link
                to={journalDayPath(shiftDay(day, -1))}
                aria-label={JOURNAL_COPY.day.previous}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
                <ChevronLeft size={20} />
            </Link>

            <div className="text-center min-w-0">
                <time dateTime={day} className="block text-lg sm:text-xl font-light text-slate-800 truncate">
                    {new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
                        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
                    })}
                </time>
                {day !== today && (
                    <Link
                        to={JOURNAL_ROOT}
                        className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                    >
                        {JOURNAL_COPY.day.today}
                    </Link>
                )}
            </div>

            <Link
                to={journalDayPath(shiftDay(day, 1))}
                aria-label={JOURNAL_COPY.day.next}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
                <ChevronRight size={20} />
            </Link>
        </div>

        <nav aria-label={JOURNAL_COPY.nav.label} className="flex items-center justify-center gap-5">
            <Link
                to={PEOPLE_PATH}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
            >
                {JOURNAL_COPY.people.heading}
            </Link>
            <Link
                to={TRIGGERS_PATH}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
            >
                {JOURNAL_COPY.triggers.heading}
            </Link>
            <Link
                to={SEARCH_PATH}
                data-journal-search-link
                className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
            >
                {JOURNAL_COPY.similar.search.heading}
            </Link>
        </nav>
    </header>
);

const EmptyDay = ({ day, today, firstRun }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-12 flex flex-col items-center text-center space-y-4">
        <NotebookPen size={36} className="opacity-20 text-slate-400" />
        <p className="text-sm text-slate-500 font-light max-w-sm">
            {day === today ? JOURNAL_COPY.empty.today : JOURNAL_COPY.empty.pastDay}
        </p>
        {firstRun && (
            <p data-first-run className="text-sm text-slate-400 font-light max-w-sm border-t border-slate-100 pt-4">
                {JOURNAL_COPY.empty.firstRun}
            </p>
        )}
    </div>
);

export default function Journal() {
    const { day: dayParam } = useParams();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const {
        entries, entriesForDay, pendingForDay, triggers, loading, loadError, dismissLoadError,
        loadRange, refresh
    } = useJournal();
    const { relationships } = useSubjects();
    // `null`, `'chips'` or `'voice'` — which way in was taken, not merely that one was.
    const [composing, setComposing] = useState(null);

    const voice = useVoiceAvailability();

    // The closed vocabularies plus this user's own names and labels — and never an id
    // (§5.1). Built here because this is the screen that holds both lists.
    const proposalContext = useMemo(
        () => buildContext({ relationships, triggers, language: voice.language }),
        [relationships, triggers, voice.language]
    );
    // Which check-in the graph is pointing at. Cleared by the day change below, because a row
    // id from yesterday is not on this screen.
    const [openedCheckin, setOpenedCheckin] = useState(null);

    const today = civilDay();
    const day = isDayString(dayParam) ? dayParam : today;

    // The provider loads a range; the screen decides which one. A month, because that is
    // what the strip above the header draws.
    useEffect(() => {
        const bounds = monthBounds(day);
        if (bounds) loadRange(bounds.from, bounds.to);
    }, [day, loadRange]);

    useEffect(() => { setOpenedCheckin(null); }, [day]);

    useEffect(() => {
        if (searchParams.get(RECORD_PARAM) !== RECORD_PARAM_VALUE || !voice.primed) return;

        setComposing(voice.showMicrophone ? 'voice' : 'chips');

        const next = new URLSearchParams(searchParams);
        next.delete(RECORD_PARAM);
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams, voice.primed, voice.showMicrophone]);

    const { pull, refreshing, armed } = usePullToRefresh(refresh);

    const dayEntries = entriesForDay(day);
    const dayPending = pendingForDay(day);
    // Newest first — the opposite of the server's order, which is oldest-first because the
    // day graph reads it left to right.
    const checkins = dayEntries.filter(entry => entry.kind === 'checkin').slice().reverse();
    const pendingCheckins = dayPending.filter(entry => entry.kind === 'checkin').slice().reverse();
    const facts = dayEntries.filter(entry => entry.kind === 'person_fact').slice().reverse();
    const ritual = dayEntries.filter(entry => entry.kind === 'ritual').slice(-1)[0]
        ?? dayPending.filter(entry => entry.kind === 'ritual').slice(-1)[0]
        ?? null;

    // A path that is present and is not a day is a typo or an old link, not a day with
    // nothing on it. Send it to today rather than drawing "Invalid Date".
    if (dayParam !== undefined && !isDayString(dayParam)) {
        return <Navigate to={JOURNAL_ROOT} replace />;
    }

    const empty = checkins.length === 0 && pendingCheckins.length === 0 && facts.length === 0 && !ritual;
    const firstRun = empty && entries.length === 0 && day === today && ritualSettingUntouched();

    const followSavedEntry = (created) => {
        if (created?.day && created.day !== day) navigate(journalDayPath(created.day));
    };

    return (
        <Frame pull={pull} refreshing={refreshing} armed={armed}>
            <DayHeader day={day} today={today} onCompose={setComposing} voice={voice.showMicrophone} />

            <CheckinFab onOpen={setComposing} voice={voice.showMicrophone} />

            {composing && (
                <CheckinComposer
                    mode={composing}
                    context={proposalContext}
                    onClose={() => setComposing(null)}
                    onSaved={followSavedEntry}
                />
            )}

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            <DayGraph day={day} entries={dayEntries} onOpenCheckin={setOpenedCheckin} />

            {loading && dayEntries.length === 0 && dayPending.length === 0 && !loadError ? (
                <Loading />
            ) : (
                <>
                    {empty ? (
                        <EmptyDay day={day} today={today} firstRun={firstRun} />
                    ) : (
                        <div className="space-y-3">
                            {pendingCheckins.map(entry => (
                                <CheckinEntry key={entry.client_id} entry={entry} />
                            ))}
                            {checkins.map(entry => (
                                <CheckinEntry key={entry.ID} entry={entry} opened={openedCheckin === entry.ID} />
                            ))}
                            {facts.map(entry => <PersonFactEntry key={entry.ID} entry={entry} />)}
                        </div>
                    )}

                    {ritual && <RitualFooter entry={ritual} />}
                </>
            )}
        </Frame>
    );
}
