import React, { useEffect, useId, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { CADENCE_OPTIONS, MIN_CADENCE_DAYS, MAX_CADENCE_DAYS } from '../constants/cadence';

/**
 * The stack-level actions: rename, merge, and deleting a whole history.
 *
 * These replace the `window.confirm` pattern the per-version delete still uses. Merging is
 * not reversible, so it needs to state in a sentence what it is about to do — a browser
 * confirm cannot say "all four snapshots of Alex M will move into Alex".
 */

const Shell = ({ children, className = '' }) => (
    <div className={`bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 ${className}`}>
        {children}
    </div>
);

export const Modal = ({ title, subtitle, onClose, children }) => {
    const titleId = useId();

    // Escape closes, the way every other dismissible surface in the browser behaves.
    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/20 backdrop-blur-sm transition-all">
            <Shell className="w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby={titleId}
                    className="flex flex-col min-h-0"
                >
                    <div className="p-6 pb-4 flex justify-between items-start gap-4 flex-shrink-0">
                        <div>
                            <h2 id={titleId} className="text-xl font-light text-slate-800">{title}</h2>
                            {subtitle && <p className="text-xs text-slate-400 mt-1">{subtitle}</p>}
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close"
                            className="p-2 -mr-2 -mt-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors flex-shrink-0"
                        >
                            <X size={20} />
                        </button>
                    </div>
                    {children}
                </div>
            </Shell>
        </div>
    );
};

/** A failed action keeps its dialog open: the user's selection is not thrown away. */
const DialogError = ({ message }) => (
    message ? (
        <p role="alert" className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
            {message}
        </p>
    ) : null
);

const errorText = (error, fallback) => error?.response?.data?.error || fallback;

export const RenameRelationshipDialog = ({ relationship, onRename, onClose }) => {
    const [name, setName] = useState(relationship.name);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        if (!name.trim() || saving) return;

        setSaving(true);
        setError(null);
        try {
            await onRename(name.trim());
            onClose();
        } catch (failure) {
            setError(errorText(failure, 'Could not rename this relationship.'));
            setSaving(false);
        }
    };

    return (
        <Modal
            title="Rename relationship"
            subtitle={`Every snapshot of ${relationship.name} takes the new name`}
            onClose={onClose}
        >
            <form onSubmit={submit} className="px-6 pb-6">
                <DialogError message={error} />
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2" htmlFor="relationship-name">
                    Name
                </label>
                <input
                    id="relationship-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                    className="w-full text-lg border-b-2 border-slate-200 py-2 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                />
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={!name.trim() || saving}
                        className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                    >
                        {saving ? 'Saving…' : 'Rename'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

/**
 * The check-in rhythm setting. Off is first and is the default, because opting in to being
 * reminded should be a choice rather than something to escape from.
 */
export const CadenceDialog = ({ relationship, onSave, onClose }) => {
    const current = relationship.cadence_days ?? null;
    const isPreset = current === null || CADENCE_OPTIONS.some(option => option.days === current);

    const [choice, setChoice] = useState(isPreset ? current : 'custom');
    const [customDays, setCustomDays] = useState(isPreset ? '' : String(current));
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    const resolved = choice === 'custom' ? Number(customDays) : choice;
    const customInvalid = choice === 'custom' &&
        (!Number.isInteger(resolved) || resolved < MIN_CADENCE_DAYS || resolved > MAX_CADENCE_DAYS);

    const submit = async (event) => {
        event.preventDefault();
        if (customInvalid || saving) return;

        setSaving(true);
        setError(null);
        try {
            await onSave(resolved);
            onClose();
        } catch (failure) {
            setError(errorText(failure, 'Could not save this rhythm.'));
            setSaving(false);
        }
    };

    return (
        <Modal
            title="Check-in rhythm"
            subtitle={`How often to be reminded about ${relationship.name}`}
            onClose={onClose}
        >
            <form onSubmit={submit} className="px-6 pb-6 overflow-y-auto">
                <DialogError message={error} />

                <div className="space-y-2">
                    {CADENCE_OPTIONS.map(option => (
                        <label
                            key={option.label}
                            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${choice === option.days
                                ? 'border-slate-400 bg-slate-50'
                                : 'border-slate-100 hover:border-slate-300'
                                }`}
                        >
                            <input
                                type="radio"
                                name="cadence"
                                checked={choice === option.days}
                                onChange={() => setChoice(option.days)}
                                className="accent-slate-700"
                            />
                            <span className="flex-1 min-w-0">
                                <span className="block text-sm font-medium text-slate-800">{option.label}</span>
                                <span className="block text-[11px] text-slate-400">{option.hint}</span>
                            </span>
                        </label>
                    ))}

                    <label
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${choice === 'custom'
                            ? 'border-slate-400 bg-slate-50'
                            : 'border-slate-100 hover:border-slate-300'
                            }`}
                    >
                        <input
                            type="radio"
                            name="cadence"
                            checked={choice === 'custom'}
                            onChange={() => setChoice('custom')}
                            className="accent-slate-700"
                        />
                        <span className="flex-1 flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-slate-800">Every</span>
                            <input
                                type="number"
                                min={MIN_CADENCE_DAYS}
                                max={MAX_CADENCE_DAYS}
                                value={customDays}
                                onChange={(event) => { setCustomDays(event.target.value); setChoice('custom'); }}
                                aria-label="Custom rhythm in days"
                                className="w-20 px-2 py-1 text-sm border-b-2 border-slate-200 focus:border-slate-800 focus:outline-none bg-transparent text-slate-700"
                            />
                            <span className="text-sm font-medium text-slate-800">days</span>
                        </span>
                    </label>
                </div>

                {customInvalid && (
                    <p className="mt-3 text-[11px] text-slate-500">
                        Pick between {MIN_CADENCE_DAYS} and {MAX_CADENCE_DAYS} days.
                    </p>
                )}

                <p className="mt-5 text-[11px] text-slate-400 font-light leading-relaxed">
                    A rhythm shows one quiet line on your dashboard when it has been a while. Nothing is
                    emailed, nothing is counted, and nothing is sent anywhere — the date is compared in
                    your browser.
                </p>

                <div className="mt-6 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={customInvalid || saving}
                        className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                    >
                        {saving ? 'Saving…' : 'Save rhythm'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

export const MergeRelationshipDialog = ({ stack, otherStacks, onMerge, onClose }) => {
    const [targetId, setTargetId] = useState(null);
    const [error, setError] = useState(null);
    const [merging, setMerging] = useState(false);

    const target = otherStacks.find(other => other.relationship.ID === targetId);
    const count = stack.relationship.snapshot_count;

    const submit = async () => {
        if (!target || merging) return;

        setMerging(true);
        setError(null);
        try {
            await onMerge(target.relationship.ID);
            onClose();
        } catch (failure) {
            setError(errorText(failure, 'Could not merge these relationships.'));
            setMerging(false);
        }
    };

    return (
        <Modal
            title="Merge into…"
            subtitle={`Move every snapshot of ${stack.relationship.name} into another relationship`}
            onClose={onClose}
        >
            <div className="px-6 pb-6 overflow-y-auto">
                <DialogError message={error} />

                {otherStacks.length === 0 ? (
                    <p className="text-sm text-slate-500 font-light">
                        There is nothing to merge into yet — this is your only relationship.
                    </p>
                ) : (
                    <fieldset>
                        <legend className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
                            Merge into
                        </legend>
                        <div className="space-y-2">
                            {otherStacks.map(({ relationship }) => (
                                <label
                                    key={relationship.ID}
                                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${targetId === relationship.ID
                                        ? 'border-slate-400 bg-slate-50'
                                        : 'border-slate-100 hover:border-slate-300'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="merge-target"
                                        value={relationship.ID}
                                        checked={targetId === relationship.ID}
                                        onChange={() => setTargetId(relationship.ID)}
                                        className="accent-slate-700"
                                    />
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-medium text-slate-800 truncate">{relationship.name}</span>
                                        <span className="block text-[11px] text-slate-400">
                                            {relationship.snapshot_count} snapshot{relationship.snapshot_count === 1 ? '' : 's'}
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                )}

                {target && (
                    <div className="mt-5 p-4 rounded-xl bg-amber-50 border border-amber-200 flex gap-3">
                        <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-900 font-light leading-relaxed">
                            All {count} snapshot{count === 1 ? '' : 's'} of <span className="font-medium">{stack.relationship.name}</span> will
                            move into <span className="font-medium">{target.relationship.name}</span>. This cannot be split apart
                            automatically.
                        </p>
                    </div>
                )}

                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={!target || merging}
                        className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-slate-200"
                    >
                        {merging ? 'Merging…' : 'Merge'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export const DeleteRelationshipDialog = ({ stack, onDelete, onClose }) => {
    const [error, setError] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const count = stack.relationship.snapshot_count;

    const submit = async () => {
        if (deleting) return;

        setDeleting(true);
        setError(null);
        try {
            await onDelete();
            onClose();
        } catch (failure) {
            setError(errorText(failure, 'Could not delete this relationship.'));
            setDeleting(false);
        }
    };

    return (
        <Modal
            title="Delete relationship"
            subtitle="This removes the whole history, not one version"
            onClose={onClose}
        >
            <div className="px-6 pb-6">
                <DialogError message={error} />
                <p className="text-sm text-slate-600 font-light leading-relaxed">
                    All {count} snapshot{count === 1 ? '' : 's'} of <span className="font-medium text-slate-800">{stack.relationship.name}</span> will
                    be deleted, along with their notes and tags.
                </p>
                <div className="mt-8 flex justify-end gap-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={deleting}
                        className="px-6 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-rose-100"
                    >
                        {deleting ? 'Deleting…' : `Delete ${count} snapshot${count === 1 ? '' : 's'}`}
                    </button>
                </div>
            </div>
        </Modal>
    );
};
