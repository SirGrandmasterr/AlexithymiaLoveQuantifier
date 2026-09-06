import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Archive, Download, Upload, Loader2, ShieldCheck, Lock, Info } from 'lucide-react';
import { useSubjects } from '../context/SubjectsContext';
import { CATEGORIES } from '../constants/categories';
import { hashPassphrase, readLockHash, setLockHash, isLockAvailable } from './AppLock';
import { readEmbeddings, readVoiceSetting } from '../constants/journalSettings';
import { embeddingsAvailable } from '../journal/embeddings/availability';
import { canTranscribe, detectTier, TIERS } from '../journal/inference/tier';
import { cloudIsOn, primeCloudStatus } from '../journal/inference/cloud';
import { MAX_CLIP_MS, SILENCE_HOLD_MS } from '../journal/recorder';
import { isNative } from '../mobile/platform';

const LAST_EXPORT_KEY = 'alq:last-export-at';

/**
 * The §10.2 variants of *What about AI features?*, chosen by what **this device** has been
 * asked to do — read from the same `localStorage` key the settings screen writes, the way
 * `remindersEnabled()` is read.
 *
 * **D3 restored the full paragraph, which C3 had deliberately narrowed.** Until this commit
 * the app had no proposal model: it wrote words down and handed them to the same chips the
 * user had always tapped, so the *voice on* variant said *"it proposes nothing"* — §10.2's
 * paragraph with every suggestion clause removed, because a Vault sentence the code cannot
 * support is the one thing invariant 2e forbids absolutely. The model now exists, the card
 * that renders its proposals exists, and every clause below is true of the code as written.
 *
 * **Three variants and not two, because the Light tier is genuinely two models** (§5.5, §5.1).
 * A Full-tier device runs one audio-native pass; a Light-tier device runs Whisper tiny for the
 * words and Gemma 4 E2B for the tags. Saying *"one model"* on a device running two would be
 * false in the direction that matters most on this page — the number of models is exactly the
 * kind of thing this section exists to state — so the Light tier gets §10.2's own alternative
 * sentence, and both name every model and its licence (§5.6).
 *
 * Exported so `Vault.test.jsx` can assert all three verbatim, which is what keeps them honest.
 */

export const OUTBOX_CLAIM = 'One exception, on this phone: a check-in you save with no '
    + 'connection is kept **on this device** until it can be sent, marked **not yet synced** on '
    + 'its day. It is sent once when the connection is back, however many times it is tried, '
    + 'and it is held in plain text here in the meantime, like everything else. It is the only '
    + 'thing this app keeps that way — your analyses are never queued — and signing out clears '
    + 'it.';

export const AI_CLAIM = {
    off: 'None are running. The journal can write down a voice note and suggest what it was '
        + 'about using a model that runs **on this device only**; it is off until you turn it '
        + 'on in your profile. Right now nothing here infers, scores, or interprets on your '
        + 'behalf — every number in this app is one you set yourself, and every journal entry '
        + 'is one you wrote or tapped.',

    on: 'One model, and it runs on this device: Gemma 4 E2B, open weights under the Apache '
        + '2.0 licence, downloaded once from this server. It **writes down** a voice note — '
        + 'the audio is never saved and never sent — and **suggests** feelings, people and '
        + 'triggers to tag from what was said. It is asked only what you said, never how you '
        + 'sounded. Every suggestion waits for you to confirm, change, or discard it — '
        + '**nothing it proposes is saved on its own**, and it never touches your love '
        + 'snapshots. It switches off in your profile at any time.',

    onLight: 'One small model writes the words down and a second one suggests tags; both run '
        + 'on this device: Whisper tiny and Gemma 4 E2B, open weights under the Apache 2.0 '
        + 'licence, downloaded once from this server. They **write down** a voice note — the '
        + 'audio is never saved and never sent — and **suggest** feelings, people and triggers '
        + 'to tag from what was said. They are asked only what you said, never how you '
        + 'sounded. Every suggestion waits for you to confirm, change, or discard it — '
        + '**nothing they propose is saved on its own**, and they never touch your love '
        + 'snapshots. They switch off in your profile at any time.'
};

/**
 * The fourth variant: §5.5b's Gemini option, and the one state in which this page cannot say
 * *"on this device"* about anything.
 *
 * It is a separate paragraph rather than an edit to the other three because every promise
 * they make is a promise about locality, and each one is false here in a different way: the
 * model is not open weights, it was not downloaded, it does not run here, and **the audio is
 * sent**. Three of those are matters of accuracy; the fourth is the reason this page exists.
 * So the paragraph leads with it.
 *
 * What survives from the on-device variants, because the code still makes it true: the model
 * is asked only what was said (the same prompt, rule 3), every suggestion waits for a tap
 * (`buildProvenance` reads the card's confirmed state, not the proposal), it never touches a
 * love snapshot, and it switches off in the profile.
 */
export const AI_CLAIM_CLOUD = 'One model, and it does not run here: your voice note is sent, '
    + 'as it was recorded, through this app\'s own server to Google\'s Gemini. The server '
    + 'holds the key; your browser still talks to nothing but this app. Gemini **writes down** '
    + 'the note and **suggests** feelings, people and triggers from what was said, in one '
    + 'pass — it is asked only what you said, never how you sounded. **The recording is not '
    + 'kept**, here or on the server, and what Google does with it is governed by their terms '
    + 'and not by this app. Every suggestion still waits for you to confirm, change, or '
    + 'discard it — **nothing it proposes is saved on its own**, and it never touches your '
    + 'love snapshots. It switches off in your profile at any time, and with it off no '
    + 'journal audio leaves this device.';

/** Which of the *voice on* paragraphs describes this device. */
export const aiClaimFor = (tier, cloud = false) => {
    if (cloud === true) return AI_CLAIM_CLOUD;
    return tier === TIERS.light ? AI_CLAIM.onLight : AI_CLAIM.on;
};

/**
 * §10.2's *"What about the similar-entry suggestions?"* — G1, and **two variants where the
 * design document wrote one.**
 *
 * The split is the same one C3 made for *What about AI features?* and for the same reason:
 * §10.2's row reads *"A second small model … turns your entries into numbers … It is off
 * until you turn it on"*, and on a device where it **is** off the first clause is a present
 * tense about something that is not happening. This page describes *this machine*, so the
 * off state says what is true of it and names no model, exactly as *"None are running"* does
 * — and the on state carries §10.2's sentences with only their last clause changed, because
 * *"it is off until you turn it on"* is the one sentence that cannot be true once it is on.
 * §10.2 now records both.
 *
 * Three things the on paragraph must name, and each is a promise with code under it:
 *
 * - **EmbeddingGemma, and its licence.** It is **not** Apache 2.0 like Gemma 4 and Whisper:
 *   it is under Google's Gemma Terms of Use, and §5.6 requires those terms to travel with
 *   any copy the operator serves. `make models-fetch` puts the file beside the weights.
 * - **Downloaded once from this server.** The manifest is `/models/`-relative and
 *   `connect-src 'self'` would refuse anywhere else.
 * - **Kept only on this device, and deleted when you sign out.** The index has no server
 *   endpoint, no export path, and `JournalContext` empties it on the branch that runs with
 *   no session — the same branch that drops the outbox (§5.8 rule 1).
 *
 * **G2 widened both variants to name search**, because §9.7's row always read *"similar-entry
 * suggestions **and search**"* and G1 shipped only the first half. Two clauses had to change
 * rather than one: the off variant now says the journal *cannot be searched*, which is true —
 * `/journal/search` is behind the same switch — and the on variant says the search happens
 * here and asks the server nothing, which `retrieval.test.jsx` holds by asserting that typing
 * a query makes no request. The sign-out clause gained its consequence for the same reason: a
 * user who is told the numbers are deleted should be told what that costs them.
 */
export const SIMILAR_CLAIM = {
    off: 'None are being made, and the journal cannot be searched. The journal can find the '
        + 'words you have used before — "you have called this \'work\' before" — and look '
        + 'through what you have written, with a second small model that runs **on this '
        + 'device only**; it is off until you turn it on in your profile. Right now nothing '
        + 'here is turning your entries into numbers.',

    on: 'A second small model — EmbeddingGemma, downloaded once from this server, open '
        + 'weights under **Google\'s Gemma Terms of Use** rather than Apache — turns your '
        + 'entries into numbers that this device uses to find entries with similar words: '
        + '"you have called this \'work\' before". It is also what lets you search the '
        + 'journal, which happens here and asks the server nothing. Those numbers are '
        + '**kept only on this device**, never sent, never exported, and **deleted when you '
        + 'sign out** — after which search finds nothing until this device has read your '
        + 'entries back. Nothing is merged or renamed unless you tap it, and it switches off '
        + 'in your profile at any time.'
};

/**
 * §10.2's *"What does the app send anywhere?"*, which needed a second variant the moment a
 * request could leave the operator's machine.
 *
 * The first sentence of the existing answer is *"Nothing."* — and with the Gemini option on
 * that is false, not narrowly but in the way this page is least allowed to be wrong. What is
 * still exactly true, and what the `cloud` variant leads with, is the part a user can check
 * themselves: **the browser** still talks only to this app's origin. The hop is the server's,
 * it is one endpoint, and it carries the recording and nothing else.
 */
export const SEND_CLAIM = {
    off: 'Nothing. Every request goes to this app\'s own origin — you can check that in your '
        + 'browser\'s network tab. There is no analytics, no telemetry, and no third-party '
        + 'script. **If you turn on voice check-ins, the speech and language model files are '
        + 'downloaded once, from this same server, and run here.**',

    cloud: 'One thing, because you turned it on. Your browser still sends every request to '
        + 'this app\'s own origin — you can check that in your browser\'s network tab — and '
        + 'there is still no analytics, no telemetry, and no third-party script. But **with '
        + 'the Gemini option on, the server forwards your voice notes to Google** so they can '
        + 'be written down and labelled. Nothing else goes with them: not your name, not your '
        + 'people, not your scores, not your other entries. Turn it off in your profile and '
        + 'nothing leaves this machine again.'
};

export const embeddingsAreOn = () => readEmbeddings(embeddingsAvailable());

/** The `**bold**` runs §10.2 writes, rendered without a markdown dependency for two words. */
const emphasised = (text) => text.split(/\*\*(.+?)\*\*/g).map((part, index) => (
    index % 2 === 1 ? <strong key={index} className="font-medium text-slate-700">{part}</strong> : part
));

/**
 * Whether a model would answer a check-in on this device, by either route. The Gemini option
 * makes voice possible where the tier cannot, so asking the tier alone would leave a
 * text-only phone reading *"None are running"* while its recordings were being sent.
 */
export const voiceIsOn = () => readVoiceSetting(canTranscribe(detectTier()) || cloudIsOn());

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

export const monthOf = (day) => {
    const match = /^(\d{4})-(\d{2})/.exec(day || '');
    if (!match) return null;

    return new Date(Number(match[1]), Number(match[2]) - 1, 1)
        .toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

const escapeCSV = (value) => {
    const text = value == null ? '' : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

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

export const buildJournalCSV = (journal) => {
    const entries = journal?.entries || [];

    const triggerLabels = {};
    entries.forEach(entry => {
        if (entry.kind === 'trigger' && entry.payload?.label) {
            triggerLabels[entry.client_id] = entry.payload.label;
        }
    });

    const nameAbout = (about, mentions) => {
        if (about.kind === 'person') {
            const mention = mentions.find(candidate => candidate.ref === about.ref);
            return mention?.label || mention?.relationship || '';
        }
        if (about.kind === 'tag') return about.tag || '';
        if (about.kind === 'trigger') return triggerLabels[about.trigger] || about.trigger || '';
        return '';
    };

    const rows = entries
        .filter(entry => entry.kind === 'checkin' && !entry.superseded_at)
        .flatMap(entry => {
            const payload = entry.payload || {};
            const mentions = entry.mentions || [];
            const tags = (payload.tags || []).join(' ');

            return (payload.feelings || []).map(feeling => {
                const about = feeling.about || [];
                return [
                    entry.day,
                    entry.at,
                    payload.source || '',
                    feeling.id,
                    // Absent stays absent, the same rule the snapshot sheet follows for a
                    // skipped category: an empty cell, never a zero and never a false.
                    feeling.intensity ?? '',
                    feeling.uncertain == null ? '' : String(feeling.uncertain),
                    about.map(item => item.kind).join(' '),
                    about.map(item => nameAbout(item, mentions)).join(' '),
                    tags
                ];
            });
        });

    if (rows.length === 0) return '';

    const header = [
        'day', 'at', 'source', 'feeling', 'intensity', 'uncertain', 'about_kind', 'about', 'tags'
    ];
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
    // Read once, like the lock hash beside it: the settings screen is a different route,
    // so this page is remounted after any change that could move it.
    const [voiceOn, setVoiceOn] = useState(voiceIsOn);
    // Which paragraph describes this device: one model on the Full tier, two on the Light
    // one. Read once, like every other fact on this page.
    const [voiceTier] = useState(() => detectTier());
    // The fourth: Gemini. Unlike everything else on this page it cannot be read once at
    // mount, because half the answer is the server's — so it is asked, and the two claims it
    // governs are re-read when it comes back rather than describing the wrong device in the
    // meantime.
    const [cloudOn, setCloudOn] = useState(cloudIsOn);
    const [similarOn] = useState(embeddingsAreOn);
    const [passphrase, setPassphrase] = useState('');

    useEffect(() => {
        let cancelled = false;
        axios.get('/api/meta')
            .then(response => { if (!cancelled) setMeta(response.data); })
            .catch(() => { if (!cancelled) setMetaError('Could not read your storage details.'); });
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        let cancelled = false;
        primeCloudStatus().then(() => {
            if (cancelled) return;
            setCloudOn(cloudIsOn());
            setVoiceOn(voiceIsOn());
        });
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

    const exportCSV = async () => {
        setBusy('csv');
        setNotice(null);
        try {
            const response = await axios.get('/api/export');
            const stamp = today();

            downloadFile(buildCSV(stacks), `alq-export-${stamp}.csv`, 'text/csv');
            const journal = buildJournalCSV(response.data?.journal);
            if (journal) downloadFile(journal, `alq-journal-${stamp}.csv`, 'text/csv');

            rememberExport();
            setNotice({
                type: 'success',
                text: journal
                    ? 'Downloaded two sheets: one row per snapshot, one row per feeling.'
                    : 'Downloaded a single sheet, one row per snapshot.'
            });
        } catch {
            setNotice({ type: 'error', text: 'Could not build the export. Is the server running?' });
        } finally {
            setBusy(null);
        }
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
            const {
                relationships_created: created,
                snapshots_created: added,
                snapshots_skipped: skipped,
                journal_entries_created: entries = 0,
                journal_entries_skipped: entriesHeld = 0
            } = response.data;
            setPreview(null);
            setPendingDocument(null);
            await refresh();
            // A version 1 file has no journal at all, so the second sentence only appears
            // when there was something for it to say.
            const journalSaid = entries || entriesHeld
                ? ` And ${entries} journal ${entries === 1 ? 'entry' : 'entries'}; ${entriesHeld} already here.`
                : '';
            setNotice({
                type: 'success',
                text: `Imported ${added} snapshot${added === 1 ? '' : 's'} into ${created} new relationship${created === 1 ? '' : 's'}. ${skipped} already here.${journalSaid}`
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

    const journalSpan = monthOf(meta?.oldest_journal_day);

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
                                {span && <>, going back to {span}</>}.
                            </p>
                            {meta.journal_entry_count > 0 && (
                                <p className="text-sm text-slate-600 font-light leading-relaxed mt-2">
                                    <span className="font-medium text-slate-800">{meta.journal_entry_count}</span>{' '}
                                    journal entr{meta.journal_entry_count === 1 ? 'y' : 'ies'} — check-ins, evening
                                    questions, the words you name things after, and anything you have since
                                    corrected
                                    {journalSpan && <>, going back to {journalSpan}</>}.
                                </p>
                            )}
                        </>
                    )}

                    {isNative() && (
                        <p data-outbox-claim className="text-sm text-slate-600 font-light leading-relaxed mt-2">
                            {emphasised(OUTBOX_CLAIM)}
                        </p>
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
                            <dd className="text-slate-600 mt-1" data-send-claim={cloudOn ? 'cloud' : 'off'}>
                                {emphasised(cloudOn ? SEND_CLAIM.cloud : SEND_CLAIM.off)}
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">What about AI features?</dt>
                            <dd
                                className="text-slate-600 mt-1"
                                data-ai-claim={voiceOn ? (cloudOn ? 'cloud' : 'on') : 'off'}
                            >
                                {emphasised(voiceOn ? aiClaimFor(voiceTier, cloudOn) : AI_CLAIM.off)}
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">
                                What about the similar-entry suggestions?
                            </dt>
                            <dd className="text-slate-600 mt-1" data-similar-claim={similarOn ? 'on' : 'off'}>
                                {emphasised(similarOn ? SIMILAR_CLAIM.on : SIMILAR_CLAIM.off)}
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">Does it listen?</dt>
                            <dd className="text-slate-600 mt-1">
                                Only while the record button is lit. There is no wake word, no background
                                capture, and recording stops when you tap, after{' '}
                                {Math.round(SILENCE_HOLD_MS / 1000)} seconds of silence, or at{' '}
                                {Math.round(MAX_CLIP_MS / 1000)} seconds.
                            </dd>
                        </div>
                        <div>
                            <dt className="font-medium text-slate-800">Is it encrypted?</dt>
                            <dd className="text-slate-600 mt-1">
                                No. The database is a plain file (or your Postgres instance); anyone with
                                access to the server can read it. Passwords are hashed, but your notes,
                                scores, and everything in the journal — the words you tapped, what you typed,
                                the people and things you named, your answers to the evening questions, and
                                journal transcripts — are not. Protecting the machine is the protection.
                            </dd>
                        </div>
                    </dl>
                </Section>

                <Section icon={Download} title="Take it with you">
                    <p className="text-sm text-slate-600 font-light leading-relaxed">
                        A complete copy — every relationship, every snapshot, notes, tags, uncertainty flags
                        and guided answers included, and every journal entry with the people it names, the
                        triggers it leans on, and anything you have since corrected.
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
                            disabled={busy === 'csv'}
                            className="px-5 py-2.5 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-xl hover:border-slate-400 disabled:opacity-50 transition-all"
                        >
                            {busy === 'csv' ? 'Preparing…' : 'Download spreadsheet (CSV)'}
                        </button>
                    </div>
                    <p className="text-[11px] text-slate-400 font-light mt-4">
                        Last export: {lastExport ? new Date(lastExport).toLocaleString() : 'never'}.
                        {' '}The JSON file is the one that can be imported again; the CSV is for spreadsheets,
                        and arrives as two sheets when there is a journal to write — one row per snapshot,
                        one row per feeling. What was said stays in the JSON.
                    </p>
                </Section>

                <Section icon={Upload} title="Put it back">
                    <p className="text-sm text-slate-600 font-light leading-relaxed">
                        Import a JSON export, from this version of the app or the one before it. Snapshots
                        already here are skipped, and a journal entry is matched by the id it was written
                        with, so importing the same file twice changes nothing.
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
                            {(preview.journal_entries_created > 0 || preview.journal_entries_skipped > 0) && (
                                <p className="text-sm text-slate-700 font-light mt-1">
                                    And {preview.journal_entries_created} journal
                                    {preview.journal_entries_created === 1 ? ' entry' : ' entries'}; skip{' '}
                                    {preview.journal_entries_skipped} already here.
                                </p>
                            )}
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
