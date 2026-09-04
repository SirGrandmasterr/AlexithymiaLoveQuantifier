import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useDiscretion } from '../context/DiscretionContext';
import { useEmbeddings } from '../journal/embeddings/EmbeddingContext';
import { Modal } from './RelationshipDialogs';
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
    MAX_TRIGGER_LABEL,
    countCopy,
    fillCopy,
    journalDayPath,
    mergeTriggerRequest,
    readCheckin,
    renameTriggerRequest,
    summarizeTrigger,
    timeOfDay
} from '../constants/journal';

/* The pieces */

const Empty = ({ message }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-12 text-center">
        <p className="text-sm text-slate-500 font-light">{message}</p>
    </div>
);

const errorText = (failure, fallback) => failure?.response?.data?.error || fallback;

/** One check-in that names this trigger: when it was, what was felt, and what was said. */
const TriggerEntry = ({ entry, liveId, resolve }) => {
    const { blurClass } = useDiscretion();
    const checkin = readCheckin(entry.payload);
    const time = timeOfDay(entry.at);

    // Only the feelings this trigger was attached to. The rest of the check-in was about
    // something else, and listing it here would attribute it to this word.
    const feelings = checkin.feelings.filter(feeling => feeling.about.some(about => (
        about.kind === 'trigger' && about.trigger && resolve(about.trigger) === liveId
    )));

    return (
        <li
            data-trigger-entry={entry.ID}
            className="rounded-xl border border-slate-100 p-3 space-y-2"
        >
            <div className="flex items-center gap-2 text-xs">
                <Link
                    to={journalDayPath(entry.day)}
                    className="font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4"
                >
                    {entry.day}
                </Link>
                {time && <time dateTime={entry.at} className="text-slate-400">{time}</time>}
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

            {checkin.transcript && (
                <p data-transcript className={`text-sm text-slate-600 font-light ${blurClass}`}>
                    {checkin.transcript}
                </p>
            )}
        </li>
    );
};

export const RenameTriggerDialog = ({ trigger, onClose }) => {
    const { createEntry } = useJournal();
    const [label, setLabel] = useState(trigger.label ?? '');
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        if (!label.trim() || saving) return;

        setSaving(true);
        setError(null);
        try {
            await createEntry(renameTriggerRequest({ trigger, label }));
            onClose();
        } catch (failure) {
            // Trap 4: the dialog stays open and the typed name stays in it.
            setError(errorText(failure, JOURNAL_COPY.triggers.rename.error));
            setSaving(false);
        }
    };

    return (
        <Modal title={JOURNAL_COPY.triggers.rename.title} onClose={onClose}>
            <form onSubmit={submit} className="px-6 pb-6">
                {error && (
                    <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                        {error}
                    </p>
                )}
                <p className="mb-5 text-sm text-slate-600 font-light leading-relaxed">
                    {fillCopy(JOURNAL_COPY.triggers.rename.body, { label: trigger.label })}
                </p>
                <label
                    htmlFor="trigger-label"
                    className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2"
                >
                    {JOURNAL_COPY.triggers.rename.label}
                </label>
                <input
                    id="trigger-label"
                    type="text"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    maxLength={MAX_TRIGGER_LABEL}
                    autoFocus
                    className="w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                />
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        {JOURNAL_COPY.triggers.rename.cancel}
                    </button>
                    <button
                        type="submit"
                        data-rename-confirm
                        disabled={!label.trim() || saving}
                        className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                    >
                        {JOURNAL_COPY.triggers.rename.confirm}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export const MergeTriggerDialog = ({ trigger, others, count, onClose }) => {
    const { createEntry } = useJournal();
    const { blurClass } = useDiscretion();
    const [targetId, setTargetId] = useState(null);
    const [error, setError] = useState(null);
    const [merging, setMerging] = useState(false);

    const target = others.find(other => other.live === targetId) ?? null;

    const submit = async () => {
        if (!target || merging) return;

        setMerging(true);
        setError(null);
        try {
            await createEntry(mergeTriggerRequest({ trigger, into: target }));
            onClose();
        } catch (failure) {
            setError(errorText(failure, JOURNAL_COPY.triggers.merge.error));
            setMerging(false);
        }
    };

    return (
        <Modal title={JOURNAL_COPY.triggers.merge.title} onClose={onClose}>
            <div className="px-6 pb-6 overflow-y-auto">
                {error && (
                    <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                        {error}
                    </p>
                )}

                {others.length === 0 ? (
                    <p className="text-sm text-slate-500 font-light">{JOURNAL_COPY.triggers.merge.alone}</p>
                ) : (
                    <fieldset>
                        <legend className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                            {JOURNAL_COPY.triggers.merge.legend}
                        </legend>
                        <div className="space-y-2">
                            {others.map(other => (
                                <label
                                    key={other.live}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${targetId === other.live
                                        ? 'border-slate-400 bg-slate-50'
                                        : 'border-slate-100 hover:border-slate-300'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="merge-trigger-target"
                                        value={other.live}
                                        checked={targetId === other.live}
                                        onChange={() => setTargetId(other.live)}
                                        className="accent-slate-700"
                                    />
                                    <span className={`flex-1 min-w-0 text-sm font-medium text-slate-800 truncate ${blurClass}`}>
                                        {other.label}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {target && (
                    <div
                        data-merge-warning
                        className="mt-5 p-4 rounded-xl bg-amber-50 border border-amber-200 flex gap-3"
                    >
                        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-amber-900 font-light leading-relaxed space-y-1">
                            <p>
                                {fillCopy(JOURNAL_COPY.triggers.merge.body, {
                                    from: trigger.label,
                                    into: target.label,
                                    count
                                })}
                            </p>
                            <p>{JOURNAL_COPY.triggers.merge.oneWay}</p>
                        </div>
                    </div>
                )}

                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        {JOURNAL_COPY.triggers.merge.cancel}
                    </button>
                    <button
                        type="button"
                        data-merge-confirm
                        onClick={submit}
                        disabled={!target || merging}
                        className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                    >
                        {JOURNAL_COPY.triggers.merge.confirm}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

/** One trigger: its label, what names it, and the two corrections it can take. */
const TriggerRow = ({ trigger, summary, others, resolve }) => {
    const { blurClass } = useDiscretion();
    const [open, setOpen] = useState(false);
    const [dialog, setDialog] = useState(null);

    return (
        <li data-trigger-row={trigger.live} className="bg-white rounded-2xl shadow-sm border border-slate-100">
            <div className="p-4 sm:p-5 space-y-3">
                <button
                    type="button"
                    data-trigger-expand
                    onClick={() => setOpen(current => !current)}
                    aria-expanded={open}
                    aria-label={fillCopy(
                        open ? JOURNAL_COPY.triggers.collapse : JOURNAL_COPY.triggers.expand,
                        { label: trigger.label }
                    )}
                    className="w-full flex items-center gap-3 text-left group"
                >
                    <span className="flex-1 min-w-0 space-y-1">
                        <span data-trigger-label className={`block text-base font-light text-slate-800 truncate ${blurClass}`}>
                            {trigger.label}
                        </span>
                        <span className="block text-xs text-slate-500">
                            {countCopy(summary.count, JOURNAL_COPY.triggers.entryCount)}
                            {trigger.role && JOURNAL_COPY.triggers.roles[trigger.role] && (
                                <span data-trigger-role={trigger.role} className="text-slate-400">
                                    {' · '}{JOURNAL_COPY.triggers.roles[trigger.role]}
                                </span>
                            )}
                        </span>
                        <AttachedFeelings
                            feelings={summary.feelings}
                            template={JOURNAL_COPY.triggers.attached}
                            formula={JOURNAL_COPY.triggers.attachedFormula}
                        />
                    </span>
                    {open
                        ? <ChevronDown size={16} className="flex-shrink-0 text-slate-400" />
                        : <ChevronRight size={16} className="flex-shrink-0 text-slate-300 group-hover:text-slate-500 transition-colors" />}
                </button>

                <div
                    role="group"
                    aria-label={fillCopy(JOURNAL_COPY.triggers.actions, { label: trigger.label })}
                    className="flex flex-wrap gap-2"
                >
                    <button
                        type="button"
                        data-trigger-rename
                        onClick={() => setDialog('rename')}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-slate-400 transition-colors"
                    >
                        {JOURNAL_COPY.triggers.renameAction}
                    </button>
                    <button
                        type="button"
                        data-trigger-merge
                        onClick={() => setDialog('merge')}
                        className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-slate-400 transition-colors"
                    >
                        {JOURNAL_COPY.triggers.mergeAction}
                    </button>
                </div>

                {open && (
                    <section data-trigger-detail className="pt-1 space-y-2">
                        <h3 className="text-xs font-medium text-slate-400">{JOURNAL_COPY.triggers.entries}</h3>
                        {summary.entries.length === 0 ? (
                            <p className="text-sm text-slate-500 font-light">{JOURNAL_COPY.empty.nothingHere}</p>
                        ) : (
                            <ul className="space-y-2">
                                {summary.entries.map(entry => (
                                    <TriggerEntry
                                        key={entry.ID}
                                        entry={entry}
                                        liveId={trigger.live}
                                        resolve={resolve}
                                    />
                                ))}
                            </ul>
                        )}
                    </section>
                )}
            </div>

            {dialog === 'rename' && (
                <RenameTriggerDialog trigger={trigger} onClose={() => setDialog(null)} />
            )}
            {dialog === 'merge' && (
                <MergeTriggerDialog
                    trigger={trigger}
                    others={others}
                    count={summary.count}
                    onClose={() => setDialog(null)}
                />
            )}
        </li>
    );
};

/* The screen */

const byEntriesThenLabel = (a, b) => (
    (b.summary.count - a.summary.count)
    || String(a.trigger.label || '').localeCompare(String(b.trigger.label || ''))
);

const SimilarPairs = ({ pairs, rows }) => {
    const { blurClass } = useDiscretion();
    const [merging, setMerging] = useState(null);

    const rowFor = (clientId) => rows.find(row => row.trigger.live === clientId) ?? null;

    const usable = pairs
        .map(pair => ({ a: rowFor(pair.a.clientId), b: rowFor(pair.b.clientId) }))
        .filter(pair => pair.a && pair.b);

    if (usable.length === 0) return null;

    return (
        <section data-similar-pairs className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-3">
            <div className="space-y-1">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {JOURNAL_COPY.similar.pairsHeading}
                </h2>
                <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md">
                    {JOURNAL_COPY.similar.pairsNote}
                </p>
            </div>

            <ul className="space-y-2">
                {usable.map(({ a, b }) => (
                    <li
                        key={`${a.trigger.live} ${b.trigger.live}`}
                        data-similar-pair={`${a.trigger.live} ${b.trigger.live}`}
                        className="flex flex-wrap items-center justify-between gap-3"
                    >
                        <span className={`text-sm font-light text-slate-700 ${blurClass}`}>
                            {fillCopy(JOURNAL_COPY.similar.pair, { a: a.trigger.label, b: b.trigger.label })}
                        </span>
                        <button
                            type="button"
                            data-similar-merge={`${a.trigger.live} ${b.trigger.live}`}
                            onClick={() => setMerging({ a, b })}
                            className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-4 transition-colors"
                        >
                            {JOURNAL_COPY.similar.pairAction}
                        </button>
                    </li>
                ))}
            </ul>

            {merging && (
                <MergeTriggerDialog
                    trigger={merging.a.trigger}
                    others={[merging.b.trigger]}
                    count={merging.a.summary.count}
                    onClose={() => setMerging(null)}
                />
            )}
        </section>
    );
};

export default function JournalTriggers() {
    const {
        triggers, entries, loading, loadError, dismissLoadError, loadAll, resolveTrigger
    } = useJournal();

    // Counts of the whole record, not of whichever month the day view last loaded.
    useEffect(() => { loadAll(); }, [loadAll]);

    const resolve = useCallback((id) => resolveTrigger(id).live, [resolveTrigger]);

    const rows = useMemo(() => (
        // `triggers` is `activeTriggers` already: a trigger that has been merged away is not
        // in it, so the list shows the survivor and never the ids that resolve to it.
        triggers
            .map(trigger => ({ trigger, summary: summarizeTrigger(entries, trigger.live, resolve) }))
            .sort(byEntriesThenLabel)
    ), [triggers, entries, resolve]);

    // Empty on every device that has not turned the index on — which is every device by
    // default, and every device with no provider above this one.
    const { pairs } = useEmbeddings();

    return (
        <Frame>
            <header className="space-y-1">
                <h1 className="text-xl sm:text-2xl font-light text-slate-800">{JOURNAL_COPY.triggers.heading}</h1>
                <p className="text-sm text-slate-400 font-light">{JOURNAL_COPY.triggers.subheading}</p>
            </header>

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            {loading && rows.length === 0 && !loadError ? (
                <Loading />
            ) : rows.length === 0 ? (
                <Empty message={JOURNAL_COPY.triggers.empty} />
            ) : (
                <>
                <SimilarPairs pairs={pairs} rows={rows} />
                <ul data-journal-view="triggers" className="space-y-3">
                    {rows.map(({ trigger, summary }) => (
                        <TriggerRow
                            key={trigger.live}
                            trigger={trigger}
                            summary={summary}
                            others={rows
                                .map(row => row.trigger)
                                .filter(other => other.live !== trigger.live)}
                            resolve={resolve}
                        />
                    ))}
                </ul>
                </>
            )}
        </Frame>
    );
}
