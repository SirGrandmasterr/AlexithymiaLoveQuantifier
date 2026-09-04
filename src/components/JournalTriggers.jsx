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
    Loading
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

/**
 * `/journal/triggers` — the vocabulary the user grew, and the two corrections it needs.
 *
 * **There is no triggers endpoint and there is not going to be one** (§7.1). The list is
 * `GET /api/journal/entries?kind=trigger`, which the provider already holds; a rename is a
 * `POST` with `supersedes_id` and a new `label`; a merge is the same `POST` with
 * `merged_into` in its payload. A journal row is a statement made at a moment, so changing
 * one is a new statement — giving the vocabulary its own verbs would be a second way to
 * write history that the export, the import and `readTrigger` would each have to learn.
 *
 * **There is no delete either, and that is not an oversight.** A trigger a check-in still
 * references cannot be removed without stranding the reference: the export would omit the
 * row and the import would refuse the file for naming a trigger it does not contain. Rename
 * covers "this is called the wrong thing" and merge covers "this is the same as that", which
 * is every reason a user has to reach for a delete here.
 *
 * The detail is a disclosure inside the row rather than a route of its own: §9.1 gives the
 * vocabulary one screen, and the entries that name a trigger are what that screen is for.
 *
 * **Discretion blurs labels and transcripts** — a trigger label is a word about the user's
 * life, and it is treated as one.
 */

/* ------------------------------------------------------------------------------------ */
/* The pieces                                                                             */
/* ------------------------------------------------------------------------------------ */

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
                        <li key={`${feeling.id ?? 'feeling'}-${index}`}>
                            <FeelingChip feeling={feeling} />
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

/**
 * Rename — a correction row carrying the new label.
 *
 * Nothing already written moves. Every check-in keeps pointing at the id it was written
 * with, and `readTrigger` walks that id forward to this row, which is why the body says the
 * new name shows everywhere rather than that anything was rewritten.
 */
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

/**
 * Merge — a correction whose payload names the survivor.
 *
 * The dialog states the count and that it is one-way, in the same shape
 * `MergeRelationshipDialog` states its own: the sentence appears once a target is chosen,
 * because "this cannot be undone" is only a sentence about something once there is
 * something. A user who finds out afterwards has no way back, and nothing stored knows
 * which of the merged entries had belonged to which trigger, so there is no undo to build.
 */
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

/* ------------------------------------------------------------------------------------ */
/* The screen                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Most-named first, then by label — `byMentionsThenName`'s rule on the People view, for its
 * reason: the count is what the screen is about and the label keeps two equal rows still.
 */
const byEntriesThenLabel = (a, b) => (
    (b.summary.count - a.summary.count)
    || String(a.trigger.label || '').localeCompare(String(b.trigger.label || ''))
);

/**
 * *“Looks similar to…”* — §5.8's first use, second half.
 *
 * The point of the whole slice is here: without it a free-text vocabulary fragments into
 * *work*, *my job*, *the office* and *Arbeit*, and every later count groups on noise. What
 * this does about it is offer pairs. **It merges nothing.** The button opens the same
 * `MergeTriggerDialog` the row's own *Merge into…* opens, with the same radio to pick, the
 * same count, and the same sentence saying out loud that a merge is one-way — because the
 * suggestion changes which pair is easy to find, and must not change what a tap does.
 *
 * A pair only appears when a **structural** fact agrees with the geometry (rule 3): the two
 * words have been used around the same person, or around the same third trigger. Two words
 * an embedding thinks are alike, with nothing in the user's own history connecting them, are
 * exactly the case this refuses — see `similar.js`.
 *
 * There is no number on screen and none to put there: `similarTriggerPairs` returns labels
 * and ids, having thrown its ordering away.
 */
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

    /**
     * One id in, the id that is live now out — a merge chain of any depth resolved to the
     * trigger that speaks for it (§6.3).
     *
     * This screen resolves more ids than any other — `loadAll()` above means it walks every
     * check-in in the history, once per trigger — so the thing that has to be hoisted is the
     * **index**, not this closure. It is, in `JournalContext`, memoised on `triggerEntries`;
     * `resolveTrigger` closes over it and this callback only stops the arrow function being
     * rebuilt. An earlier version of this comment claimed hoisting the binding was enough,
     * which it never was: `readTrigger` given an array rebuilds the index on every call.
     */
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
