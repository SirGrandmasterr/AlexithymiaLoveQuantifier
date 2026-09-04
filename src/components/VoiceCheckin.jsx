import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Mic, Square, Trash2, Plus, Download, Loader2, AlertTriangle } from 'lucide-react';
import { JOURNAL_COPY, countCopy, fillCopy } from '../constants/journal';
import { useDiscretion } from '../context/DiscretionContext';
import { createRecorder, watchLifecycle, MAX_CLIP_MS, DISCARD_REASONS, ERROR_KINDS } from '../journal/recorder';
import { createModelSetDownloader, DOWNLOAD_ERRORS } from '../journal/inference/download';
import { PROPOSAL_MODEL, formatBytes, setBytes, setLabel, tierModels } from '../journal/inference/models';
import { audioInput, propose } from '../journal/inference';
import { createWebRuntime } from '../journal/inference/web';
import { createNativeRuntime } from '../journal/inference/native';
import {
    canTranscribe, detectTier, effectiveTier, nativeTierReport, probeWebGpu, voiceAvailability, webGpuAvailable
} from '../journal/inference/tier';
import { readLanguage, readTierOverride, readVoiceSetting } from '../constants/journalSettings';
import { isNative } from '../mobile/platform';
import { createNativeDownloader, nativeCaptureDeps, primeNativeTier } from '../mobile/journalPlugin';

/**
 * The microphone path: tap, speak, see the words (§4.2, §4.3).
 *
 * It writes down what was said and hands the words to the chip grid the composer already
 * has. **There is no proposal here** — no chip is pre-selected, nothing is inferred, and the
 * runtime's own answer says as much (`ambiguity: "feeling"`, §4.6). D2 puts a card on top of
 * the same seam; this slice is the honest floor underneath it.
 *
 * Three things it takes as props rather than reaching for, so a test needs no microphone, no
 * Cache Storage and no 45 MB of weights: the **recorder**, the **downloader** and the
 * **runtime**. `createVoiceKit()` builds the real trio and is the only place the three meet.
 *
 * The transcript is a `<textarea>`, not a paragraph, because §4.3 makes editing the point:
 * a model mishears names most of all, and `Lucy`/`Lucie` is the error that would create a
 * second relationship if it reached find-or-create unseen. **What the user leaves in the box
 * is what is saved** — the model's own text is never read again after it lands here.
 */

/**
 * The real trio, for a tier. Built once per composer, and never at import time.
 *
 * On Android (C4, D3) the three are the plugin's: C2's recorder unchanged but driven through
 * `nativeCaptureDeps`, so the samples stay on the native side and `clip.audio` is a handle;
 * the downloader over the plugin's weight store; and the native runtime, which sends handles
 * across the bridge and gets a proposal back. Nothing above this function knows which trio it
 * holds. `native` and `plugin` are injectable for the tests only.
 *
 * **The tier decides all three** (§5.5), and that is the D3 change. A Full-tier device
 * downloads one model and runs one pass over the audio; a Light-tier device downloads two and
 * runs them in sequence; a text-only device never gets here, because the screen offers a
 * keyboard instead. `tierModels` owns which, and the download line is built from the same
 * list rather than from a second opinion about it.
 */
export const createVoiceKit = (options = {}) => {
    const native = options.native ?? isNative();
    // The tier this device is on, with the user's pin applied — the same answer
    // `useVoiceAvailability` shows on screen, read here rather than passed down so that a
    // kit and the sentence describing it cannot disagree. A test hands one in.
    const tier = options.tier || effectiveTier(detectTier(), readTierOverride()).tier;
    const models = options.models || tierModels(tier, { native });

    // What the download line and the settings screen say. One sentence for the whole set,
    // because it is one decision: a Light-tier phone is not asked twice.
    const label = setLabel(models);
    const size = formatBytes(setBytes(models));
    // The model whose name goes on the record. The proposal model where there is one; the
    // transcriber otherwise, which is what a text-only-proposals build would have.
    const model = models.find(one => one.label === PROPOSAL_MODEL.label) || models[0] || null;

    if (native) {
        const { plugin } = options;
        return {
            tier,
            models,
            model,
            label,
            size,
            recorder: options.recorder || createRecorder(nativeCaptureDeps(plugin)),
            downloader: options.downloader || createModelSetDownloader(models, {
                createDownloader: createNativeDownloader,
                ...(plugin ? { plugin } : {})
            }),
            runtime: options.runtime || createNativeRuntime({
                tier, language: options.language, ...(plugin ? { plugin } : {})
            })
        };
    }

    return {
        tier,
        models,
        model,
        label,
        size,
        recorder: options.recorder || createRecorder(),
        downloader: options.downloader || createModelSetDownloader(models),
        runtime: options.runtime || createWebRuntime({ tier, language: options.language })
    };
};

/**
 * What this screen may offer: a microphone, a keyboard, or a sentence saying why there is
 * no microphone.
 *
 * Read once per mount rather than watched. All four inputs — the device's own capabilities,
 * the pinned tier, the voice setting and discretion mode — change on a navigation or a
 * settings visit, not under a screen that is sitting still, and a `storage` listener for
 * that would be four moving parts to save one remount.
 */
export const useVoiceAvailability = () => {
    const { discreet } = useDiscretion();
    // On Android the tier is the plugin's memory report, primed by the app shell at
    // launch. Should this screen mount before that read has landed, it evaluates again
    // when it does — the one moving part, and the reason `detectTier()` is not read
    // straight into the memo below.
    // Two facts have to be asked for rather than read: the plugin's memory report on
    // Android, and the browser's WebGPU **adapter** on the web — `navigator.gpu` existing is
    // not the same question (D3 measured a browser where it lied). Both are cached after the
    // first answer, so this settles once per session and not once per mount.
    const [primed, setPrimed] = useState(
        () => (isNative() ? nativeTierReport() !== null : webGpuAvailable() !== null)
    );
    useEffect(() => {
        if (primed) return undefined;
        let live = true;
        (isNative() ? primeNativeTier() : probeWebGpu()).then(() => { if (live) setPrimed(true); });
        return () => { live = false; };
    }, [primed]);

    return useMemo(() => {
        const detected = detectTier();
        const availability = voiceAvailability({
            detected,
            override: readTierOverride(),
            voiceOn: readVoiceSetting(canTranscribe(detected)),
            discreet
        });
        // `primed` travels with the answer because one caller has to wait for it rather
        // than render around it: the launcher shortcut (§9.2) decides between the microphone
        // and the keyboard *once*, on arrival, and a screen that answered before the plugin's
        // memory report landed would arm the wrong one.
        return { ...availability, detected, language: readLanguage(), primed };
    }, [discreet, primed]);
};

/** A store snapshot, subscribed the way React 19 wants stores subscribed. */
const useStore = (store) => useSyncExternalStore(
    useCallback(listener => store.subscribe(listener), [store]),
    useCallback(() => store.getSnapshot(), [store])
);

const secondsLeft = (ms) => Math.max(0, Math.ceil(ms / 1000));

/**
 * The level meter: eight bars, lit from the middle out.
 *
 * Deliberately not a number. §4.2 asks for a meter so the screen cannot be mistaken for
 * idle; a decibel reading would be a measurement the user has no use for, and this app does
 * not show numbers it did not ask someone to author.
 */
const LevelMeter = ({ level }) => {
    const lit = Math.min(8, Math.round(level * 40));
    return (
        <div className="flex items-end gap-1 h-6" aria-hidden="true" data-level-meter={lit}>
            {Array.from({ length: 8 }, (_, index) => (
                <span
                    key={index}
                    className={`w-1.5 rounded-full transition-all duration-75 ${index < lit ? 'bg-slate-800' : 'bg-slate-200'}`}
                    style={{ height: `${25 + index * 9}%` }}
                />
            ))}
        </div>
    );
};

/**
 * The download offer, and the only place the size is promised.
 *
 * Size and cancel are on screen **before** anything moves (§5.6), and a checksum failure is
 * the end of the attempt rather than a warning to click past: nothing is cached, and the
 * copy says whose problem it is to fix.
 */
const ModelDownload = ({ downloader, label, size, onReady }) => {
    const progress = useStore(downloader);

    const done = progress.total > 0
        ? `${Math.round((progress.loaded / progress.total) * 100)}%`
        : '';

    if (progress.state === 'downloading') {
        return (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3" data-model-download="running">
                <p className="text-sm text-slate-600 font-light flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-slate-400 flex-shrink-0" />
                    {fillCopy(JOURNAL_COPY.settings.voice.downloading, { label, done, size })}
                </p>
                <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                        className="h-full bg-slate-800 transition-all"
                        style={{ width: progress.total ? `${(progress.loaded / progress.total) * 100}%` : '0%' }}
                    />
                </div>
                <button
                    type="button"
                    data-model-cancel
                    onClick={() => downloader.cancel()}
                    className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                    {JOURNAL_COPY.empty.modelDownloadCancel}
                </button>
            </div>
        );
    }

    if (progress.state === 'error') {
        const checksum = progress.error?.kind === DOWNLOAD_ERRORS.checksum
            || progress.error?.kind === DOWNLOAD_ERRORS.length;
        return (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3" data-model-download="error">
                <p className="text-sm text-red-800 font-light flex items-start gap-2">
                    <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
                    {checksum ? JOURNAL_COPY.settings.voice.checksumError : JOURNAL_COPY.settings.voice.downloadError}
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3" data-model-download="offer">
            <p className="text-sm text-slate-600 font-light">
                {fillCopy(JOURNAL_COPY.settings.voice.size, { label, size })}
            </p>
            <button
                type="button"
                data-model-start
                onClick={async () => { if (await downloader.start()) onReady(); }}
                className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[48px] bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 transition-all"
            >
                <Download size={16} />
                {fillCopy(JOURNAL_COPY.settings.voice.downloadOffer, { label, size })}
            </button>
        </div>
    );
};

/**
 * @param onProposal D2: the whole `propose` envelope, after the words were handed over. The
 *   composer decides whether a card is shown on it; this screen only ever reports it.
 * @param hidden D2: true while the proposal card is on screen. The recorder stays mounted
 *   — *Say it again* needs it — and nothing here is drawn, because the card carries the
 *   transcript itself.
 */
export default function VoiceCapture({
    kit, context, transcript, onTranscript, onNoisy, onKeyboard, onProposal, hidden = false
}) {
    const { recorder, downloader, runtime, label, size } = kit;
    const capture = useStore(recorder);
    const { blurClass } = useDiscretion();

    const [ready, setReady] = useState(null);      // null = not asked yet
    const [working, setWorking] = useState(false);
    const [problem, setProblem] = useState(null);
    const [noisy, setNoisy] = useState(false);
    const transcribed = useRef(new Set());

    // Background and a hidden tab both throw the audio away (§4.2, §9.6). The app lock is the
    // third exit and belongs to `App.jsx`, which owns the lock's state.
    useEffect(() => watchLifecycle(recorder), [recorder]);
    useEffect(() => () => recorder.destroy(), [recorder]);

    useEffect(() => {
        let cancelled = false;
        downloader.isDownloaded().then(has => { if (!cancelled) setReady(has); });
        return () => { cancelled = true; };
    }, [downloader]);

    /**
     * Transcribe as soon as a take lands, and exactly once per take.
     *
     * Keyed on the clip ids rather than on a boolean: *add more* produces a second clip on
     * the same card, and the whole take is transcribed again so the words read as one note
     * rather than two halves stitched in the UI.
     */
    useEffect(() => {
        if (capture.state !== 'ready' || capture.clips.length === 0) return;

        const key = capture.clips.map(clip => clip.id).join('+');
        if (transcribed.current.has(key)) return;
        transcribed.current.add(key);

        const flagged = capture.clips.some(clip => clip.noisy);
        setNoisy(flagged);
        if (onNoisy) onNoisy(flagged);

        setWorking(true);
        setProblem(null);
        propose(audioInput(capture.clips), context, runtime)
            .then(result => {
                if (result.ok) {
                    onTranscript(result.proposal.transcript, result.proposal.language);
                    // The proposal travels beside the words, already through D1's filter.
                    // Whether it becomes a card is the composer's decision (the *Show
                    // suggestions* setting), not this screen's.
                    if (onProposal) onProposal(result);
                } else {
                    setProblem(JOURNAL_COPY.voice.notWritten);
                }
            })
            .finally(() => {
                setWorking(false);
                // The audio has done its one job. Nothing downstream needs it, and §4.2 says
                // it does not outlive the transcript.
                recorder.discard(DISCARD_REASONS.discard);
            });
    }, [capture.state, capture.clips, context, runtime, recorder, onTranscript, onNoisy, onProposal]);

    const denied = capture.state === 'error' && capture.error?.kind === ERROR_KINDS.permission;
    const recording = capture.state === 'recording';
    const busy = working || capture.state === 'decoding' || capture.state === 'requesting';

    // After every hook, so the recorder keeps its subscriptions while the card is up.
    if (hidden) return null;

    if (ready === false) {
        return (
            <div className="space-y-3" data-voice-block="download">
                <ModelDownload downloader={downloader} label={label} size={size} onReady={() => setReady(true)} />
                <button
                    type="button"
                    data-voice-keyboard
                    onClick={onKeyboard}
                    className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
                >
                    {JOURNAL_COPY.voice.keyboard}
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-3" data-voice-block="capture">
            {denied && (
                <p role="status" className="text-sm text-slate-500 font-light" data-voice-denied>
                    {JOURNAL_COPY.voice.denied}
                </p>
            )}
            {problem && (
                <p role="alert" className="text-sm text-slate-600 font-light" data-voice-problem>
                    {problem}
                </p>
            )}

            {!transcript && !busy && (
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        data-voice-record
                        aria-pressed={recording}
                        onClick={() => recorder.tap()}
                        title={JOURNAL_COPY.voice.openHint}
                        className={`h-14 w-14 rounded-full flex items-center justify-center transition-colors flex-shrink-0 ${recording
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-800 text-white hover:bg-slate-900'
                            }`}
                    >
                        {recording ? <Square size={20} fill="currentColor" /> : <Mic size={22} strokeWidth={1.75} />}
                    </button>

                    {recording ? (
                        <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-3">
                                <LevelMeter level={capture.level} />
                                <span className="text-sm text-slate-500 font-light tabular-nums" data-voice-countdown>
                                    {fillCopy(JOURNAL_COPY.voice.remaining, { seconds: secondsLeft(capture.remainingMs) })}
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 font-light">{JOURNAL_COPY.voice.recording}</p>
                        </div>
                    ) : (
                        <div className="flex-1 min-w-0">
                            <p className="text-sm text-slate-600 font-light">{JOURNAL_COPY.voice.openHint}</p>
                            <p className="text-xs text-slate-400 font-light">
                                {fillCopy(JOURNAL_COPY.voice.limit, { seconds: Math.round(MAX_CLIP_MS / 1000) })}
                            </p>
                        </div>
                    )}
                </div>
            )}

            {busy && (
                <p role="status" className="text-sm text-slate-500 font-light flex items-center gap-2" data-voice-working>
                    <Loader2 size={16} className="animate-spin text-slate-400" />
                    {JOURNAL_COPY.voice.working}
                </p>
            )}

            {transcript !== null && transcript !== undefined && !busy && (
                <div className="space-y-2" data-voice-transcript>
                    <label
                        htmlFor="voice-transcript"
                        className="block text-xs font-semibold text-slate-400 uppercase tracking-wider"
                    >
                        {JOURNAL_COPY.voice.transcriptLabel}
                    </label>
                    {/* Blurred under discretion like every other transcript in the app (§9.6). */}
                    <textarea
                        id="voice-transcript"
                        data-voice-transcript-input
                        rows={3}
                        value={transcript}
                        onChange={(event) => onTranscript(event.target.value)}
                        className={`w-full text-sm p-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-slate-800 transition-colors resize-y ${blurClass}`}
                    />
                    <p className="text-[11px] text-slate-400 font-light">{JOURNAL_COPY.voice.transcriptHint}</p>

                    {noisy && (
                        <p className="text-[11px] text-amber-700 font-light flex items-center gap-1.5" data-voice-noisy>
                            <AlertTriangle size={12} className="flex-shrink-0" />
                            {JOURNAL_COPY.voice.noisy}
                        </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                        <button
                            type="button"
                            data-voice-add-more
                            onClick={() => recorder.start()}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <Plus size={14} />
                            {JOURNAL_COPY.voice.addMore}
                        </button>
                        <button
                            type="button"
                            data-voice-discard
                            onClick={() => { recorder.discard(DISCARD_REASONS.discard); setNoisy(false); onTranscript(null); }}
                            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
                        >
                            <Trash2 size={14} />
                            {JOURNAL_COPY.voice.discard}
                        </button>
                    </div>
                </div>
            )}

            {capture.clips.length > 1 && (
                <p className="text-[11px] text-slate-400 font-light">
                    {countCopy(capture.clips.length, JOURNAL_COPY.voice.clips)}
                </p>
            )}
        </div>
    );
}

export { ModelDownload, LevelMeter };
