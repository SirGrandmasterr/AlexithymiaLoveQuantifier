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

export const createVoiceKit = (options = {}) => {
    const native = options.native ?? isNative();
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

export const useVoiceAvailability = () => {
    const { discreet } = useDiscretion();
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
        return { ...availability, detected, language: readLanguage(), primed };
    }, [discreet, primed]);
};

/** A store snapshot, subscribed the way React 19 wants stores subscribed. */
const useStore = (store) => useSyncExternalStore(
    useCallback(listener => store.subscribe(listener), [store]),
    useCallback(() => store.getSnapshot(), [store])
);

const secondsLeft = (ms) => Math.max(0, Math.ceil(ms / 1000));

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
