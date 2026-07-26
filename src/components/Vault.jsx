import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Archive, Download, Upload, Loader2, ShieldCheck, Lock, Info } from 'lucide-react';
import { useSubjects } from '../context/SubjectsContext';
import { CATEGORIES } from '../constants/categories';
import { hashPassphrase, readLockHash, setLockHash, isLockAvailable } from './AppLock';

/**
 * The Vault: what is stored, how to take it with you, and how to put it back.
 *
 * The copy here is load-bearing. Every claim on this page has to be true of the code as
 * written — "nothing is sent anywhere" is checkable by opening the network tab, and the app
 * lock section says outright that it does not encrypt anything. A page that reassures
 * beyond what the code guarantees is worse than no page.
 */

const LAST_EXPORT_KEY = 'alq:last-export-at';

const readLastExport = () => {
    try {
        return window.localStorage.getItem(LAST_EXPORT_KEY);
    } catch {
        return null;
    }
};

/** Plain words, not a driver name: the point is to say where the file actually is. */
export const describeBackend = (backend) => {
    if (backend === 'sqlite') return 'a SQLite file on the machine running this app';
    if (backend === 'postgres') return 'your PostgreSQL database';
    return backend ? `your ${backend} database` : 'your database';
};

const escapeCSV = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * One row per snapshot, one column per category, so a spreadsheet can chart it without any
 * unpacking. A skipped category is an **empty cell**, never a zero — the distinction this
 * whole app is built on must survive the export too.
 */
export const buildCSV = (stacks) => {
    const header = [
        'relationship', 'date', 'kind',
        ...CATEGORIES.map(category => category.id),
        'uncertain', 'tags', 'note'
    ];

    const rows = stacks.flatMap(({ relationship, versions }) => (
        [...versions]
            .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
            .map(snapshot => [
                relationship.name,
                snapshot.date ? new Date(snapshot.date).toISOString().split('T')[0] : '',
                snapshot.kind || 'full',
                ...CATEGORIES.map(category => {
                    const value = snapshot.stats?.[category.id];
                    return value === undefined || value === null ? '' : value;
                }),
                (snapshot.uncertain || []).join(' '),
                (snapshot.tags || []).join(' '),
                snapshot.description || ''
            ])
    ));

    return [header, ...rows].map(row => row.map(escapeCSV).join(',')).join('\n');
};

const downloadFile = (contents, filename, type) => {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

const today = () => new Date().toISOString().split('T')[0];

const Section = ({ icon: Icon, title, children }) => (
    <section className="bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 p-6 md:p-8">
        <h2 className="flex items-center gap-2 text-lg font-light text-slate-800 mb-4">
            <Icon size={18} className="text-slate-400" />
            {title}
        </h2>
        {children}
    </section>
);

export default function Vault() {
    const { stacks, people, refresh } = useSubjects();

    const [meta, setMeta] = useState(null);
    const [metaError, setMetaError] = useState(null);
    const [notice, setNotice] = useState(null);
    const [busy, setBusy] = useState(null);
    const [lastExport, setLastExport] = useState(readLastExport);

    const [preview, setPreview] = useState(null);
    const [pendingDocument, setPendingDocument] = useState(null);
    const fileInput = useRef(null);

    const [lockSet, setLockSet] = useState(() => Boolean(readLockHash()));
    const [passphrase, setPassphrase] = useState('');

    useEffect(() => {
        let cancelled = false;
        axios.get('/api/meta')
            .then(response => { if (!cancelled) setMeta(response.data); })
            .catch(() => { if (!cancelled) setMetaError('Could not read your storage details.'); });
        return () => { cancelled = true; };
    }, []);

    const rememberExport = () => {
        const stamp = new Date().toISOString();
        try {
            window.localStorage.setItem(LAST_EXPORT_KEY, stamp);
        } catch {
            // Losing the reminder is not worth failing the export over.
        }
        setLastExport(stamp);
    };

    const exportJSON = async () => {
        setBusy('json');
        setNotice(null);
        try {
            const response = await axios.get('/api/export');
            downloadFile(JSON.stringify(response.data, null, 2), `alq-export-${today()}.json`, 'application/json');
            rememberExport();
            setNotice({ type: 'success', text: 'Downloaded. Keep it somewhere you back up.' });
        } catch {
            setNotice({ type: 'error', text: 'Could not build the export. Is the server running?' });
        } finally {
            setBusy(null);
        }
    };

    // Built from state already in the browser: the spreadsheet never round-trips anywhere.
    const exportCSV = () => {
        downloadFile(buildCSV(stacks), `alq-export-${today()}.csv`, 'text/csv');
        rememberExport();
        setNotice({ type: 'success', text: 'Downloaded a single sheet, one row per snapshot.' });
    };

    const chooseFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = ''; // let the same file be picked twice
        if (!file) return;

        setNotice(null);
        setPreview(null);
        setPendingDocument(null);
        setBusy('preview');

        try {
            const parsed = JSON.parse(await file.text());
            // Always dry-run first: the user sees exactly what the real run will do before
            // anything is written.
            const response = await axios.post('/api/import?dry_run=true', parsed);
            setPendingDocument(parsed);
            setPreview(response.data);
        } catch (error) {
            setNotice({
                type: 'error',
                text: error?.response?.data?.error || 'That file could not be read as an export.'
            });
        } finally {
            setBusy(null);
        }
    };

    const confirmImport = async () => {
        setBusy('import');
        setNotice(null);
        try {
            const response = await axios.post('/api/import', pendingDocument);
            const { relationships_created: created, snapshots_created: added, snapshots_skipped: skipped } = response.data;
            setPreview(null);
            setPendingDocument(null);
            await refresh();
            setNotice({
                type: 'success',
                text: `Imported ${added} snapshot${added === 1 ? '' : 's'} into ${created} new relationship${created === 1 ? '' : 's'}. ${skipped} already here.`
            });
        } catch (error) {
            setNotice({ type: 'error', text: error?.response?.data?.error || 'Could not import that file.' });
        } finally {
            setBusy(null);
        }
    };

    const saveLock = async (event) => {
        event.preventDefault();
        if (!passphrase.trim()) return;

        const hash = await hashPassphrase(passphrase);
        if (!hash) {
            setNotice({ type: 'error', text: 'This browser will not hash a passphrase outside a secure context.' });
            return;
        }
        setLockHash(hash);
        setLockSet(true);
        setPassphrase('');
        setNotice({ type: 'success', text: 'Lock set. It applies the next time this app loads.' });
    };

    const clearLock = () => {
        setLockHash(null);
        setLockSet(false);
        setNotice({ type: 'success', text: 'Lock removed.' });
    };

    const span = meta?.oldest_snapshot_date
        ? new Date(meta.oldest_snapshot_date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : null;

    return (
        <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-slate-200">
            <div className="max-w-3xl mx-auto px-6 py-12 space-y-6">
                <header>
                    <h1 className="text-4xl font-light tracking-tight text-slate-900 mb-2">
                        Your <span className="font-semibold">Vault</span>
                    </h1>
                    <p className="text-slate-500 font-light">
                        Where this lives, and how to take it with you.
                    </p>
                </header>

                {notice && (
                    <div
                        role="alert"
                        className={`p-4 rounded-lg flex items-center gap-3 ${notice.type === 'success'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-red-50 text-red-800 border border-red-200'
                            }`}
                    >
                        <Info size={18} className="flex-shrink-0" />
                        <span className="flex-1 text-sm">{notice.text}</span>
                    </div>
                )}

                <Section icon={Archive} title="Your data">
                    {metaError ? (
                        <p className="text-sm text-slate-500">{metaError}</p>
                    ) : !meta ? (
                        <Loader2 className="animate-spin text-slate-300" size={20} />
                    ) : (
                        <>
                            <p className="text-sm text-slate-600 font-light leading-relaxed">
                                Everything you have written is stored in {describeBackend(meta.db_backend)}.
                            </p>
                            <p className="text-sm text-slate-600 font-light leading-relaxed mt-2">
                                <span className="font-medium text-slate-800">{meta.relationship_count}</span>{' '}
                                relationship{meta.relationship_count === 1 ? '' : 's'} and{' '}
                                <span className="font-medium text-slate-800">{meta.snapshot_count}</span>{' '}
                                snapshot{meta.snapshot_count === 1 ? '' : 's'}
                                {span && <> , going back to {span}</>}.
                            </p>
                        </>
                    )}
                </Section>

                <Section icon={ShieldCheck} title="What leaves this machine">
                    <dl className="space-y-4 text-sm font-light leading-relaxed">
                        <div>
                            <dt className="font-medium text-slate-800">Who can see this?</dt>
                            <dd className="text-slate-600 mt-1">
                                Whoever can reach the server it runs on and sign in as you. There are no other
                                accounts, no sharing, and no way for one user to see another's analyses.
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">What does the app send anywhere?</dt>
                            <dd className="text-slate-600 mt-1">
                                Nothing. Every request goes to this app's own origin — you can check that in
                                your browser's network tab. There is no analytics, no telemetry, and no
                                third-party script.
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">What about AI features?</dt>
                            <dd className="text-slate-600 mt-1">
                                There are none, by design. Nothing here infers, scores, or interprets on your
                                behalf — every number in this app is one you set yourself.
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">Is it encrypted?</dt>
                            <dd className="text-slate-600 mt-1">
                                No. The database is a plain file (or your Postgres instance); anyone with
                                access to the server can read it. Passwords are hashed, but your notes and
                                scores are not. Protecting the machine is the protection.
                            </dd>
                        </div>
                    </dl>
                </Section>

                <Section icon={Download} title="Take it with you">
                    <p className="text-sm text-slate-600 font-light leading-relaxed">
                        A complete copy — every relationship, every snapshot, notes, tags, uncertainty flags
                        and guided answers included.
                    </p>
                    <div className="flex flex-wrap gap-3 mt-4">
                        <button
                            type="button"
                            onClick={exportJSON}
                            disabled={busy === 'json'}
                            className="px-5 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 disabled:opacity-50 transition-all shadow-lg shadow-slate-200"
                        >
                            {busy === 'json' ? 'Preparing…' : 'Download everything (JSON)'}
                        </button>
                        <button
                            type="button"
                            onClick={exportCSV}
                            className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:border-slate-400 transition-all"
                        >
                            Download spreadsheet (CSV)
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-400 font-light mt-4">
                        Last export: {lastExport ? new Date(lastExport).toLocaleString() : 'never'}.
                        {' '}The JSON file is the one that can be imported again; the CSV is for spreadsheets.
                    </p>
                </Section>

                <Section icon={Upload} title="Put it back">
                    <p className="text-sm text-slate-600 font-light leading-relaxed">
                        Import a JSON export. Snapshots already here are skipped, so importing the same file
                        twice changes nothing.
                    </p>

                    <input
                        ref={fileInput}
                        type="file"
                        accept="application/json,.json"
                        onChange={chooseFile}
                        aria-label="Choose an export file"
                        className="mt-4 block w-full text-sm text-slate-500 file:mr-4 file:px-4 file:py-2 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-sm file:font-medium file:text-slate-700 hover:file:border-slate-400"
                    />

                    {busy === 'preview' && (
                        <p className="text-sm text-slate-400 font-light mt-4">Checking the file…</p>
                    )}

                    {preview && (
                        <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-200">
                            <p className="text-sm text-slate-700 font-light">
                                Would create {preview.relationships_created} relationship
                                {preview.relationships_created === 1 ? '' : 's'} and{' '}
                                {preview.snapshots_created} snapshot{preview.snapshots_created === 1 ? '' : 's'};
                                skip {preview.snapshots_skipped} already here.
                            </p>
                            <p className="text-[11px] text-slate-400 font-light mt-1">
                                Nothing has been written yet.
                            </p>
                            <div className="flex gap-3 mt-4">
                                <button
                                    type="button"
                                    onClick={confirmImport}
                                    disabled={busy === 'import'}
                                    className="px-5 py-2 bg-slate-800 text-white text-sm font-medium rounded-lg hover:bg-slate-900 disabled:opacity-50 transition-all"
                                >
                                    {busy === 'import' ? 'Importing…' : 'Import'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => { setPreview(null); setPendingDocument(null); }}
                                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </Section>

                <Section icon={Lock} title="Lock this screen">
                    <p className="text-sm text-slate-600 font-light leading-relaxed">
                        An optional passphrase that covers the app on this device, asked for on load and after
                        15 minutes idle.
                    </p>
                    <p className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 font-light leading-relaxed">
                        This locks the screen on this device. It does not encrypt the database — anyone with
                        access to the server files can read them. There is no recovery: if you forget it,
                        clear this site's data in your browser and sign in again.
                    </p>

                    {!isLockAvailable() ? (
                        <p className="text-sm text-slate-500 font-light mt-4">
                            Unavailable here — the browser only offers the hashing this needs over HTTPS or on
                            localhost.
                        </p>
                    ) : lockSet ? (
                        <button
                            type="button"
                            onClick={clearLock}
                            className="mt-4 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:border-slate-400 transition-all"
                        >
                            Remove the lock
                        </button>
                    ) : (
                        <form onSubmit={saveLock} className="mt-4 flex flex-wrap gap-3">
                            <input
                                type="password"
                                value={passphrase}
                                onChange={(event) => setPassphrase(event.target.value)}
                                aria-label="New passphrase"
                                placeholder="Choose a passphrase"
                                className="flex-1 min-w-[12rem] px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:border-slate-500 focus:outline-none"
                            />
                            <button
                                type="submit"
                                disabled={!passphrase.trim()}
                                className="px-5 py-2.5 bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 disabled:opacity-50 transition-all"
                            >
                                Set lock
                            </button>
                        </form>
                    )}
                </Section>

                <p className="text-[11px] text-slate-400 font-light text-center pb-4">
                    {people.length} snapshot{people.length === 1 ? '' : 's'} loaded in this browser session.
                </p>
            </div>
        </div>
    );
}
