import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, NotebookPen, Trash2 } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { Modal } from './RelationshipDialogs';
import { timelinePath } from './TimelineRoute';
import {
    AttachedFeelings,
    FeelingChip,
    Frame,
    LoadFailed,
    Loading,
    QuoteLine
} from './Journal';
import {
    JOURNAL_COPY,
    PEOPLE_PATH,
    countCopy,
    journalDayPath,
    journalPersonPath,
    readCheckin,
    readPersonFact,
    summarizePerson,
    timeOfDay
} from '../constants/journal';

/* The pieces */

const Heading = ({ title, subtitle, children }) => (
    <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-light text-slate-800">{title}</h1>
        {subtitle && <p className="text-sm text-slate-400 font-light">{subtitle}</p>}
        {children}
    </header>
);

const Empty = ({ message }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-12 flex flex-col items-center text-center space-y-4">
        <NotebookPen size={36} className="opacity-20 text-slate-400" />
        <p className="text-sm text-slate-500 font-light max-w-sm">{message}</p>
    </div>
);

const PersonRow = ({ relationship, summary }) => {
    const { maskName } = useDiscretion();
    const hasStack = Number(relationship.snapshot_count) > 0;

    return (
        <li
            data-person-row={relationship.ID}
            data-journal-only={hasStack ? 'false' : 'true'}
            className="bg-white rounded-2xl shadow-sm border border-slate-100"
        >
            <Link
                to={journalPersonPath(relationship.ID)}
                className="flex items-center gap-3 p-4 sm:p-5 group"
            >
                <span className="flex-1 min-w-0 space-y-1">
                    <span className="block text-base font-light text-slate-800 truncate">
                        {maskName(relationship.name)}
                    </span>
                    <span className="block text-xs text-slate-500">
                        {countCopy(summary.count, JOURNAL_COPY.people.mentionCount)}
                    </span>
                    <AttachedFeelings
                        feelings={summary.feelings}
                        template={JOURNAL_COPY.people.attached}
                        formula={JOURNAL_COPY.people.attachedFormula}
                    />
                </span>
                <ChevronRight
                    size={16}
                    className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors"
                />
            </Link>

            <p className="px-4 sm:px-5 pb-4 -mt-1 text-[11px]">
                {hasStack ? (
                    <Link
                        data-timeline-link
                        to={timelinePath(relationship.ID)}
                        className="font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                    >
                        {JOURNAL_COPY.people.timeline}
                    </Link>
                ) : (
                    <span data-no-timeline className="text-slate-400 font-light">
                        {JOURNAL_COPY.people.journalOnly}
                    </span>
                )}
            </p>
        </li>
    );
};

/** One entry that named this person: when it was, what was felt about them, what was said. */
const MentionEntry = ({ entry, relationshipId }) => {
    const { blurClass } = useDiscretion();
    const time = timeOfDay(entry.at);

    // Which `about.ref`s on this entry point at this person. A feeling reaches a person
    // through the mention's position, never through a name (invariant 2a).
    const refs = useMemo(() => new Set(
        (entry.mentions ?? [])
            .filter(mention => mention.relationship_id === relationshipId)
            .map(mention => mention.ref)
    ), [entry.mentions, relationshipId]);

    const checkin = entry.kind === 'checkin' ? readCheckin(entry.payload) : null;
    // Only the feelings that were attached to *them*. The rest of the check-in was about
    // something else, and listing it here would put words in the person's mouth.
    const feelings = checkin
        ? checkin.feelings.filter(feeling => feeling.about.some(about => about.kind === 'person' && refs.has(about.ref)))
        : [];

    return (
        <li
            data-mention-entry={entry.ID}
            data-entry-kind={entry.kind}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-2"
        >
            <div className="flex items-center gap-2 text-xs">
                <Link
                    to={journalDayPath(entry.day)}
                    className="font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                >
                    {entry.day}
                </Link>
                {time && <time dateTime={entry.at} className="text-slate-400">{time}</time>}
                {entry.kind === 'ritual' && (
                    <span className="text-slate-400">{JOURNAL_COPY.day.ritualHeading}</span>
                )}
            </div>

            {feelings.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                    {feelings.map((feeling, index) => (
                        <li key={`${feeling.id ?? 'feeling'}-${index}`} className="flex flex-wrap items-center gap-2">
                            <FeelingChip feeling={feeling} />
                            <QuoteLine quote={feeling.quote} />
                        </li>
                    ))}
                </ul>
            )}

            {checkin?.transcript && (
                <p data-transcript className={`text-sm text-slate-600 font-light ${blurClass}`}>
                    {checkin.transcript}
                </p>
            )}
            {checkin?.note && (
                <p data-note className={`text-sm text-slate-500 font-light ${blurClass}`}>
                    {checkin.note}
                </p>
            )}
        </li>
    );
};

/** One confirmed fact, with the date it was confirmed on. */
const FactEntry = ({ entry }) => {
    const { blurClass } = useDiscretion();
    const fact = readPersonFact(entry.payload);

    return (
        <li
            data-fact-entry={entry.ID}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-1"
        >
            <Link
                to={journalDayPath(entry.day)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
            >
                {entry.day}
            </Link>
            {fact.text && (
                <p data-fact className={`text-sm text-slate-600 font-light ${blurClass}`}>{fact.text}</p>
            )}
        </li>
    );
};

export const RemovePersonDialog = ({ name, relationshipId, facts, mentions, onClose }) => {
    const { removePersonFromJournal } = useJournal();
    const { maskName } = useDiscretion();
    const [error, setError] = useState(null);
    const [removing, setRemoving] = useState(false);

    const submit = async () => {
        if (removing) return;

        setRemoving(true);
        setError(null);
        try {
            await removePersonFromJournal(relationshipId);
            onClose();
        } catch (failure) {
            // Trap 4: the dialog stays open with its sentence intact, so the user can read
            // what did not happen rather than guess from a closed screen.
            setError(failure?.response?.data?.error || JOURNAL_COPY.people.remove.error);
            setRemoving(false);
        }
    };

    return (
        <Modal title={JOURNAL_COPY.people.remove.title} onClose={onClose}>
            <div className="px-6 pb-6">
                {error && (
                    <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                        {error}
                    </p>
                )}
                <p data-remove-body className="text-sm text-slate-600 font-light leading-relaxed">
                    {facts > 0 && countCopy(facts, JOURNAL_COPY.people.remove.facts, { name: maskName(name) })}
                    {facts > 0 && mentions > 0 && ' '}
                    {mentions > 0 && countCopy(mentions, JOURNAL_COPY.people.remove.mentions, { name: maskName(name) })}
                </p>
                <p className="mt-2 text-sm text-slate-500 font-light leading-relaxed">
                    {JOURNAL_COPY.people.remove.stays}
                </p>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        {JOURNAL_COPY.people.remove.cancel}
                    </button>
                    <button
                        type="button"
                        data-remove-confirm
                        onClick={submit}
                        disabled={removing}
                        className="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-rose-100"
                    >
                        {JOURNAL_COPY.people.remove.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

/* The two screens */

const byMentionsThenName = (a, b) => (
    (b.summary.count - a.summary.count)
    || String(a.relationship.name || '').localeCompare(String(b.relationship.name || ''))
);

export default function JournalPeople() {
    const { relationships } = useSubjects();
    const { entries, loading, loadError, dismissLoadError, loadAll } = useJournal();

    // The counts on this screen are counts of the whole record, not of a month.
    useEffect(() => { loadAll(); }, [loadAll]);

    const rows = useMemo(() => (
        relationships
            .map(relationship => ({ relationship, summary: summarizePerson(entries, relationship.ID) }))
            .sort(byMentionsThenName)
    ), [relationships, entries]);

    return (
        <Frame>
            <Heading title={JOURNAL_COPY.people.heading} subtitle={JOURNAL_COPY.people.subheading} />

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            {loading && rows.length === 0 && !loadError ? (
                <Loading />
            ) : rows.length === 0 ? (
                <Empty message={JOURNAL_COPY.people.empty} />
            ) : (
                <ul data-journal-view="people" className="space-y-3">
                    {rows.map(({ relationship, summary }) => (
                        <PersonRow key={relationship.ID} relationship={relationship} summary={summary} />
                    ))}
                </ul>
            )}
        </Frame>
    );
}

export function JournalPerson() {
    const { id } = useParams();
    const relationshipId = Number(id);

    const { relationships } = useSubjects();
    const { entries, loading, loadError, dismissLoadError, loadAll, personName } = useJournal();
    const { maskName } = useDiscretion();
    const [removing, setRemoving] = useState(false);

    useEffect(() => { loadAll(); }, [loadAll]);

    const relationship = relationships.find(person => person.ID === relationshipId) ?? null;
    const summary = useMemo(() => summarizePerson(entries, relationshipId), [entries, relationshipId]);

    const name = relationship?.name
        || personName(summary.entries[0]?.mentions?.find(mention => mention.relationship_id === relationshipId))
        || '';

    const hasStack = Number(relationship?.snapshot_count) > 0;

    return (
        <Frame>
            <Heading title={maskName(name)}>
                <p className="text-sm text-slate-500">
                    {countCopy(summary.count, JOURNAL_COPY.people.mentionCount)}
                </p>
                <AttachedFeelings
                    feelings={summary.feelings}
                    template={JOURNAL_COPY.people.attached}
                    formula={JOURNAL_COPY.people.attachedFormula}
                />
                <p className="flex flex-wrap items-center gap-4 pt-2 text-xs">
                    <Link
                        to={PEOPLE_PATH}
                        className="font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                    >
                        {JOURNAL_COPY.people.back}
                    </Link>
                    {hasStack && (
                        <Link
                            data-timeline-link
                            to={timelinePath(relationshipId)}
                            className="font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                        >
                            {JOURNAL_COPY.people.timeline}
                        </Link>
                    )}
                </p>
                <p className="text-[11px] text-slate-400 font-light">{JOURNAL_COPY.people.stackActions}</p>
            </Heading>

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            {loading && summary.count === 0 && !loadError ? (
                <Loading />
            ) : (
                <div data-journal-view="person" className="space-y-6">
                    <section className="space-y-3">
                        <h2 className="text-sm font-medium text-slate-500">{JOURNAL_COPY.people.mentions}</h2>
                        {summary.mentions.length === 0 ? (
                            <Empty message={JOURNAL_COPY.people.noMentions} />
                        ) : (
                            <ul className="space-y-3">
                                {summary.mentions.map(entry => (
                                    <MentionEntry key={entry.ID} entry={entry} relationshipId={relationshipId} />
                                ))}
                            </ul>
                        )}
                    </section>

                    <section className="space-y-3">
                        <h2 className="text-sm font-medium text-slate-500">{JOURNAL_COPY.people.facts}</h2>
                        {summary.facts.length === 0 ? (
                            <Empty message={JOURNAL_COPY.people.noFacts} />
                        ) : (
                            <ul className="space-y-3">
                                {summary.facts.map(entry => <FactEntry key={entry.ID} entry={entry} />)}
                            </ul>
                        )}
                    </section>

                    {summary.count > 0 && (
                        <div className="pt-2">
                            <button
                                type="button"
                                data-remove-person
                                onClick={() => setRemoving(true)}
                                className="inline-flex items-center gap-2 px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                            >
                                <Trash2 size={14} />
                                {JOURNAL_COPY.people.remove.action}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {removing && (
                <RemovePersonDialog
                    name={name}
                    relationshipId={relationshipId}
                    facts={summary.facts.length}
                    mentions={summary.mentions.length}
                    onClose={() => setRemoving(false)}
                />
            )}
        </Frame>
    );
}
