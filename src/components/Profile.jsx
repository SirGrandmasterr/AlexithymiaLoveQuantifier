import React, { useState, useEffect, useMemo, useRef } from 'react';
import { User, Mail, Shield, Save, Upload, Loader2, Info, Bell, NotebookPen, Download } from 'lucide-react';
import axios from 'axios';
import { resolveAssetUrl } from '../mobile/serverUrl';
import { remindersAvailable, remindersEnabled, setRemindersEnabled } from '../mobile/cadenceReminders';
import { setRitualReminder } from '../mobile/ritualReminder';
import {
    DEFAULT_RITUAL_TIME,
    JOURNAL_COPY,
    MAX_OPTIONAL_QUESTIONS,
    TRANSCRIPTION_LANGUAGES,
    fillCopy,
    optionalQuestions
} from '../constants/journal';
import {
    readAskWho,
    readKeepTranscripts,
    readLanguage,
    readEmbeddings,
    readOptionalQuestions,
    readRitualSetting,
    readSuggestions,
    readTierOverride,
    readVoiceSetting,
    writeAskWho,
    writeEmbeddings,
    writeKeepTranscripts,
    writeLanguage,
    writeOptionalQuestions,
    writeRitualSetting,
    writeSuggestions,
    writeTierOverride,
    writeVoiceSetting
} from '../constants/journalSettings';
import {
    canTranscribe, detectTier, effectiveTier, nativeTierReport, nominalMemoryGb, probeWebGpu
} from '../journal/inference/tier';
import { createModelSetDownloader } from '../journal/inference/download';
import {
    EMBEDDING_GEMMA_ONNX, EMBEDDING_MODEL, PROPOSAL_MODEL,
    formatBytes, modelSize, setBytes, setLabel, tierModels
} from '../journal/inference/models';
import { embeddingsAvailable } from '../journal/embeddings/availability';
import { isNative } from '../mobile/platform';
import { createNativeDownloader, primeNativeTier } from '../mobile/journalPlugin';

const VoiceSettings = () => {
    const native = isNative();
    const [detected, setDetected] = useState(() => detectTier());
    const [override, setOverride] = useState(readTierOverride);
    const { tier, refused } = effectiveTier(detected, override);
    const capable = canTranscribe(tier);

    const [voice, setVoice] = useState(() => readVoiceSetting(capable));
    const [suggestions, setSuggestions] = useState(readSuggestions);
    const [keepTranscripts, setKeep] = useState(readKeepTranscripts);
    const [language, setLanguage] = useState(readLanguage);
    const [onDevice, setOnDevice] = useState(null);

    useEffect(() => {
        let live = true;
        (native ? primeNativeTier() : probeWebGpu()).then(() => {
            if (!live) return;
            const now = detectTier();
            setDetected(now);
            setVoice(readVoiceSetting(canTranscribe(effectiveTier(now, readTierOverride()).tier)));
        });
        return () => { live = false; };
    }, [native]);

    const memoryGb = native ? nominalMemoryGb(nativeTierReport()?.totalMemoryBytes) : null;

    const models = useMemo(() => tierModels(tier, { native }), [tier, native]);
    const downloader = useMemo(
        () => createModelSetDownloader(models, native ? { createDownloader: createNativeDownloader } : {}),
        [models, native]
    );

    useEffect(() => {
        let cancelled = false;
        downloader.isDownloaded().then(has => { if (!cancelled) setOnDevice(has); });
        return () => { cancelled = true; };
    }, [downloader]);

    const tierName = (id) => JOURNAL_COPY.settings.tier.names[id] || id;

    const toggleVoice = () => {
        // The writer refuses a `true` for a device that cannot record, and what it stored is
        // what goes on screen — so a refusal is visible rather than silently undone.
        setVoice(writeVoiceSetting(!voice, capable));
    };

    const pin = (value) => {
        const next = value || null;
        setOverride(next);
        writeTierOverride(next);
        // Turning the tier down below what voice needs turns voice off with it, rather than
        // leaving a `true` behind that the Vault page would read as "a model is running".
        if (!canTranscribe(effectiveTier(detected, next).tier)) {
            setVoice(writeVoiceSetting(false, false));
        }
    };

    const removeFiles = async () => {
        await downloader.remove();
        setOnDevice(false);
    };

    return (
        <div className="mt-6" data-voice-settings>
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                {JOURNAL_COPY.settings.tier.label}
            </h4>
            <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md mb-2">
                {native ? JOURNAL_COPY.settings.tier.descriptionNative : JOURNAL_COPY.settings.tier.description}
            </p>
            <p className="text-xs text-slate-500 font-light" data-tier-detected={detected}>
                {fillCopy(
                    override ? JOURNAL_COPY.settings.tier.pinned : JOURNAL_COPY.settings.tier.detected,
                    { tier: tierName(tier) }
                )}
            </p>
            {memoryGb !== null && (
                <p className="text-xs text-slate-400 font-light" data-tier-memory={memoryGb}>
                    {fillCopy(JOURNAL_COPY.settings.tier.memory, { gb: memoryGb })}
                </p>
            )}
            {refused && (
                <p className="mt-1 text-xs text-amber-700 font-light" data-tier-refused={refused}>
                    {fillCopy(JOURNAL_COPY.settings.tier.refused, {
                        tier: tierName(refused), actual: tierName(tier)
                    })}
                </p>
            )}
            <select
                data-setting="tier"
                aria-label={JOURNAL_COPY.settings.tier.label}
                value={override || ''}
                onChange={(event) => pin(event.target.value)}
                className="mt-2 p-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
                <option value="">{JOURNAL_COPY.settings.tier.auto}</option>
                {['full', 'light', 'text-only'].map(id => (
                    <option key={id} value={id}>{tierName(id)}</option>
                ))}
            </select>

            <div className="mt-6">
                {!capable ? (
                    // No toggle at all where it could not work. §9.4's sentence, and the
                    // sharper one when the reason is an address rather than a machine.
                    <p className="text-sm text-slate-500 font-light leading-relaxed max-w-md" data-voice-unavailable>
                        {typeof window !== 'undefined' && window.isSecureContext === false
                            ? JOURNAL_COPY.empty.voiceNeedsSecureContext
                            : JOURNAL_COPY.empty.voiceUnavailable}
                    </p>
                ) : (
                    <>
                        <button
                            type="button"
                            data-setting="voice"
                            onClick={toggleVoice}
                            aria-pressed={voice}
                            className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${voice
                                ? 'bg-slate-800 text-white border-slate-800'
                                : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                }`}
                        >
                            <span>{JOURNAL_COPY.settings.voice.label}</span>
                            <span className={`text-xs ${voice ? 'text-slate-300' : 'text-slate-400'}`}>
                                {voice ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                            </span>
                        </button>

                        <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                            {JOURNAL_COPY.settings.voice.description}
                        </p>
                        <p className="mt-2 text-xs text-slate-400 font-light">
                            {onDevice
                                ? JOURNAL_COPY.settings.voice.downloaded
                                : fillCopy(JOURNAL_COPY.settings.voice.size, {
                                    label: setLabel(models), size: formatBytes(setBytes(models))
                                })}
                        </p>

                        {onDevice && (
                            <button
                                type="button"
                                data-setting="remove-model"
                                onClick={removeFiles}
                                className="mt-3 px-4 py-2 min-h-[44px] bg-white border border-slate-200 text-slate-600 text-sm rounded-xl hover:border-slate-400 transition-all"
                            >
                                {JOURNAL_COPY.settings.voice.remove}
                            </button>
                        )}

                        {voice && (
                            <div className="mt-6" data-suggestions-settings>
                                <button
                                    type="button"
                                    data-setting="suggestions"
                                    onClick={() => { const next = !suggestions; setSuggestions(next); writeSuggestions(next); }}
                                    aria-pressed={suggestions}
                                    className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${suggestions
                                        ? 'bg-slate-800 text-white border-slate-800'
                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                        }`}
                                >
                                    <span>{JOURNAL_COPY.settings.suggestions.label}</span>
                                    <span className={`text-xs ${suggestions ? 'text-slate-300' : 'text-slate-400'}`}>
                                        {suggestions ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                                    </span>
                                </button>
                                <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                                    {JOURNAL_COPY.settings.suggestions.description}
                                </p>
                                <p className="mt-2 text-xs text-slate-400 font-light leading-relaxed max-w-md" data-suggestions-model>
                                    {fillCopy(JOURNAL_COPY.settings.suggestions.model, {
                                        label: PROPOSAL_MODEL.label,
                                        licence: PROPOSAL_MODEL.licence
                                    })}
                                </p>
                            </div>
                        )}

                        <div className="mt-6">
                            <button
                                type="button"
                                data-setting="keep-transcripts"
                                onClick={() => { const next = !keepTranscripts; setKeep(next); writeKeepTranscripts(next); }}
                                aria-pressed={keepTranscripts}
                                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${keepTranscripts
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                            >
                                <span>{JOURNAL_COPY.settings.keepTranscripts.label}</span>
                                <span className={`text-xs ${keepTranscripts ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {keepTranscripts ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                                </span>
                            </button>
                            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                                {JOURNAL_COPY.settings.keepTranscripts.description}
                            </p>
                        </div>

                        <div className="mt-6">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                {JOURNAL_COPY.settings.language.label}
                            </h4>
                            <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md mb-2">
                                {JOURNAL_COPY.settings.language.description}
                            </p>
                            <select
                                data-setting="language"
                                aria-label={JOURNAL_COPY.settings.language.label}
                                value={language || ''}
                                onChange={(event) => {
                                    const next = event.target.value || null;
                                    setLanguage(next);
                                    writeLanguage(next);
                                }}
                                className="p-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="">{JOURNAL_COPY.settings.language.auto}</option>
                                {TRANSCRIPTION_LANGUAGES.map(code => (
                                    <option key={code} value={code}>{code}</option>
                                ))}
                            </select>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

/**
 * The embedding index (§5.8, G1): one toggle, one download, and the two sentences that have
 * to be in front of the user before either happens.
 *
 * It is its own block rather than a row inside `VoiceSettings` because it is its own opt-in
 * with its own model and its own licence — EmbeddingGemma is under Google's **Gemma Terms
 * of Use**, not Apache 2.0 (§5.6), and a second model folded in under a heading about voice
 * would be a second download the user agreed to by agreeing to something else.
 *
 * The same rule the voice toggle follows: **it may only be turned on where it could do
 * something.** `embeddingsAvailable()` decides, the writer refuses a `true` it was handed
 * for a device that has nowhere to keep an index, and what the writer stored is what goes on
 * screen — so a refusal is visible rather than silently undone, and the Vault page cannot
 * end up describing numbers that were never made here.
 */
const EmbeddingSettings = () => {
    const capable = embeddingsAvailable();
    const [on, setOn] = useState(() => readEmbeddings(capable));
    const [onDevice, setOnDevice] = useState(null);
    const [progress, setProgress] = useState(null);

    const downloader = useMemo(() => createModelSetDownloader([EMBEDDING_GEMMA_ONNX]), []);

    useEffect(() => {
        let cancelled = false;
        downloader.isDownloaded().then(has => { if (!cancelled) setOnDevice(has); });
        const unsubscribe = downloader.subscribe(snapshot => { if (!cancelled) setProgress(snapshot); });
        return () => { cancelled = true; unsubscribe(); };
    }, [downloader]);

    const label = EMBEDDING_MODEL.label;
    const size = modelSize(EMBEDDING_GEMMA_ONNX);
    const running = progress?.state === 'downloading';
    const failed = progress?.state === 'error';
    const done = running && progress.total > 0
        ? `${Math.round((progress.loaded / progress.total) * 100)}%`
        : '';

    return (
        <div className="mt-6" data-embedding-settings>
            <button
                type="button"
                data-setting="embeddings"
                disabled={!capable}
                onClick={() => setOn(writeEmbeddings(!on, capable))}
                aria-pressed={on}
                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${on
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40'
                    }`}
            >
                <span>{JOURNAL_COPY.settings.embeddings.label}</span>
                <span className={`text-xs ${on ? 'text-slate-300' : 'text-slate-400'}`}>
                    {on ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                </span>
            </button>

            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                {JOURNAL_COPY.settings.embeddings.description}
            </p>

            {!capable && (
                <p className="mt-2 text-xs text-slate-500 font-light" data-embeddings-unavailable>
                    {JOURNAL_COPY.settings.embeddings.unavailable}
                </p>
            )}

            {/* The licence line is not conditional on the toggle: which terms the weights
                come under is part of deciding, not a detail revealed afterwards. */}
            <p className="mt-2 text-xs text-slate-400 font-light leading-relaxed max-w-md" data-embeddings-licence>
                {fillCopy(JOURNAL_COPY.settings.embeddings.licence, {
                    label, licence: EMBEDDING_MODEL.licence
                })}
            </p>

            {capable && on && (
                <div className="mt-3 space-y-3 max-w-md">
                    <p className="text-xs text-slate-400 font-light" data-embeddings-size>
                        {onDevice
                            ? JOURNAL_COPY.settings.embeddings.downloaded
                            : fillCopy(JOURNAL_COPY.settings.embeddings.size, { label, size })}
                    </p>

                    {failed && (
                        <p role="alert" className="text-xs text-red-700 font-light" data-embeddings-error>
                            {JOURNAL_COPY.settings.voice.downloadError}
                        </p>
                    )}

                    {running && (
                        <p className="text-xs text-slate-500 font-light flex items-center gap-2" data-embeddings-download="running">
                            <Loader2 size={14} className="animate-spin text-slate-400 flex-shrink-0" />
                            {fillCopy(JOURNAL_COPY.settings.embeddings.downloading, { label, done, size })}
                        </p>
                    )}

                    {!onDevice && !running && (
                        <button
                            type="button"
                            data-embeddings-start
                            onClick={async () => { if (await downloader.start()) setOnDevice(true); }}
                            className="inline-flex items-center gap-2 px-5 py-2.5 min-h-[48px] bg-slate-800 text-white text-sm font-medium rounded-xl hover:bg-slate-900 transition-all"
                        >
                            <Download size={16} />
                            {fillCopy(JOURNAL_COPY.settings.embeddings.downloadOffer, { label, size })}
                        </button>
                    )}

                    {onDevice && (
                        <button
                            type="button"
                            data-embeddings-remove
                            onClick={async () => { await downloader.remove(); setOnDevice(false); }}
                            className="px-4 py-2 min-h-[44px] bg-white border border-slate-200 text-slate-600 text-sm rounded-xl hover:border-slate-400 transition-all"
                        >
                            {JOURNAL_COPY.settings.embeddings.remove}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const JournalSettings = () => {
    const [ritual, setRitual] = useState(readRitualSetting);
    const [questions, setQuestions] = useState(readOptionalQuestions);
    const [askWho, setAskWho] = useState(readAskWho);

    const saveRitual = (next) => {
        setRitual(next);
        writeRitualSetting(next);
        setRitualReminder(next);
    };

    const questionsRef = useRef(questions);

    const toggleQuestion = (id) => {
        const current = questionsRef.current;
        const next = current.includes(id)
            ? current.filter(other => other !== id)
            : [...current, id];

        questionsRef.current = next;
        setQuestions(next);
        writeOptionalQuestions(next);
    };

    const toggleAskWho = () => {
        const next = !askWho;
        setAskWho(next);
        writeAskWho(next);
    };

    const atLimit = questions.length >= MAX_OPTIONAL_QUESTIONS;

    return (
        <div className="pt-8 border-t border-slate-50" data-journal-settings>
            <div className="flex items-center gap-2 text-slate-800 font-medium mb-1">
                <NotebookPen size={18} />
                <h3>{JOURNAL_COPY.settings.heading}</h3>
            </div>
            <p className="text-xs text-slate-400 font-light mb-4">{JOURNAL_COPY.settings.subheading}</p>

            <button
                type="button"
                data-setting="ritual"
                onClick={() => saveRitual({ ...ritual, on: !ritual.on })}
                aria-pressed={ritual.on}
                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${ritual.on
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
            >
                <span>{JOURNAL_COPY.settings.ritual.label}</span>
                <span className={`text-xs ${ritual.on ? 'text-slate-300' : 'text-slate-400'}`}>
                    {ritual.on ? ritual.time : JOURNAL_COPY.settings.off}
                </span>
            </button>

            {ritual.on && (
                <label className="mt-3 flex items-center gap-3 text-sm text-slate-600">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        {JOURNAL_COPY.settings.ritual.time}
                    </span>
                    <input
                        type="time"
                        data-setting="ritual-time"
                        value={ritual.time}
                        onChange={(event) => saveRitual({ ...ritual, time: event.target.value })}
                        className="p-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                </label>
            )}

            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                {fillCopy(JOURNAL_COPY.settings.ritual.description, { time: DEFAULT_RITUAL_TIME })}
            </p>

            <div className="mt-6">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    {JOURNAL_COPY.settings.questions.label}
                </h4>
                <p className="text-xs text-slate-400 font-light leading-relaxed max-w-md mb-3">
                    {fillCopy(JOURNAL_COPY.settings.questions.description, { max: MAX_OPTIONAL_QUESTIONS })}
                </p>

                <div className="space-y-2 max-w-md">
                    {optionalQuestions().map(question => {
                        const chosen = questions.includes(question.id);
                        return (
                            <button
                                key={question.id}
                                type="button"
                                data-question={question.id}
                                aria-pressed={chosen}
                                // Stated, then enforced: the cap sentence is on screen before
                                // the ninth card is reachable, so nothing is refused silently.
                                disabled={!chosen && atLimit}
                                onClick={() => toggleQuestion(question.id)}
                                className={`w-full text-left px-4 py-3 min-h-[48px] border rounded-xl transition-all ${chosen
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40 disabled:hover:border-slate-200'
                                    }`}
                            >
                                <span className="text-sm font-medium">{question.text}</span>
                                <span className={`block mt-1 text-xs font-light leading-relaxed ${chosen ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {question.note}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {atLimit && (
                    <p className="mt-3 text-xs text-slate-400 font-light">
                        {fillCopy(JOURNAL_COPY.settings.questions.atLimit, { max: MAX_OPTIONAL_QUESTIONS })}
                    </p>
                )}
            </div>

            <div className="mt-6">
                <button
                    type="button"
                    data-setting="ask-who"
                    onClick={toggleAskWho}
                    aria-pressed={askWho}
                    className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${askWho
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                        }`}
                >
                    <span>{JOURNAL_COPY.settings.askWho.label}</span>
                    <span className={`text-xs ${askWho ? 'text-slate-300' : 'text-slate-400'}`}>
                        {askWho ? JOURNAL_COPY.settings.on : JOURNAL_COPY.settings.off}
                    </span>
                </button>
                <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                    {JOURNAL_COPY.settings.askWho.description}
                </p>
            </div>

            <VoiceSettings />
            <EmbeddingSettings />
        </div>
    );
};

export default function Profile() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const fileInputRef = useRef(null);

    const [formData, setFormData] = useState({
        name: '',
        age: '',
        mbti_type: '',
        profile_picture: '',
        email: ''
    });

    const [reminders, setReminders] = useState(remindersEnabled);
    const [reminderError, setReminderError] = useState(null);

    useEffect(() => {
        fetchProfile();
    }, []);

    const toggleReminders = async () => {
        setReminderError(null);
        const next = await setRemindersEnabled(!reminders);
        setReminders(next);

        if (!reminders && !next) {
            setReminderError(
                'Android did not grant notification permission. You can enable it for this app in Settings › Notifications.'
            );
        }
    };

    const fetchProfile = async () => {
        try {
            const res = await axios.get('/api/me');
            setFormData({
                name: res.data.name || '',
                age: res.data.age || '',
                mbti_type: res.data.mbti_type || '',
                profile_picture: res.data.profile_picture || '',
                email: res.data.email || ''
            });
        } catch (error) {
            console.error('Failed to fetch profile', error);
            setMessage({ type: 'error', text: 'Failed to load profile data.' });
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: name === 'age' ? parseInt(value) || '' : value }));
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage({ type: '', text: '' });
        try {
            await axios.put('/api/me', formData);
            setMessage({ type: 'success', text: 'Profile updated successfully!' });
        } catch (error) {
            console.error('Failed to update profile', error);
            setMessage({ type: 'error', text: 'Failed to update profile.' });
        } finally {
            setSaving(false);
        }
    };

    const handleImageUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const uploadData = new FormData();
        uploadData.append('image', file);

        try {
            const res = await axios.post('/api/upload', uploadData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            // Update the profile picture URL in form data
            const fullUrl = res.data.url;
            setFormData(prev => ({ ...prev, profile_picture: fullUrl }));
            setMessage({ type: 'success', text: 'Image uploaded successfully. Remember to save changes.' });
        } catch (error) {
            console.error('Upload failed', error);
            setMessage({ type: 'error', text: 'Image upload failed.' });
        } finally {
            setUploading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-full min-h-[500px]">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto px-6 py-12">
            <h1 className="text-3xl font-light text-slate-900 mb-8">Account Settings</h1>

            {message.text && (
                <div className={`mb-6 p-4 rounded-lg flex items-center gap-3 ${message.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
                    <Info size={18} />
                    <span>{message.text}</span>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className="p-8 border-b border-slate-50 relative">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-6">
                        <div className="relative group">
                            <div className="w-24 h-24 rounded-full overflow-hidden bg-slate-100 border-4 border-white shadow-md flex items-center justify-center">
                                {formData.profile_picture ? (
                                    <img src={resolveAssetUrl(formData.profile_picture)} alt="Profile" className="w-full h-full object-cover" />
                                ) : (
                                    <User size={40} className="text-slate-400" />
                                )}
                            </div>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploading}
                                className="absolute bottom-0 right-0 p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                title="Upload new picture"
                            >
                                {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden"
                                accept="image/*"
                                onChange={handleImageUpload}
                            />
                        </div>
                        <div className="flex-1">
                            <h2 className="text-xl font-medium text-slate-900">{formData.name || 'Set your name'}</h2>
                            <p className="text-slate-500">Manage your profile and personal information</p>
                        </div>
                        <div className="flex-shrink-0 mt-4 sm:mt-0">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-70"
                            >
                                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>

                <div className="p-8 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Name Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Full Name
                            </label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="e.g. Jane Doe"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* Email Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Email Address
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Mail size={18} className="text-slate-400" />
                                </div>
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="w-full pl-10 p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                                />
                            </div>
                        </div>

                        {/* Age Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                Age
                            </label>
                            <input
                                type="number"
                                name="age"
                                value={formData.age}
                                onChange={handleChange}
                                placeholder="e.g. 25"
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                            />
                        </div>

                        {/* MBTI Type Field */}
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                                MBTI Type
                            </label>
                            <select
                                name="mbti_type"
                                value={formData.mbti_type}
                                onChange={handleChange}
                                className="w-full p-3 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors appearance-none"
                            >
                                <option value="">Select a type...</option>
                                <option value="INTJ">INTJ</option>
                                <option value="INTP">INTP</option>
                                <option value="ENTJ">ENTJ</option>
                                <option value="ENTP">ENTP</option>
                                <option value="INFJ">INFJ</option>
                                <option value="INFP">INFP</option>
                                <option value="ENFJ">ENFJ</option>
                                <option value="ENFP">ENFP</option>
                                <option value="ISTJ">ISTJ</option>
                                <option value="ISFJ">ISFJ</option>
                                <option value="ESTJ">ESTJ</option>
                                <option value="ESFJ">ESFJ</option>
                                <option value="ISTP">ISTP</option>
                                <option value="ISFP">ISFP</option>
                                <option value="ESTP">ESTP</option>
                                <option value="ESFP">ESFP</option>
                            </select>
                        </div>
                    </div>

                    {remindersAvailable() && (
                        <div className="pt-8 border-t border-slate-50">
                            <div className="flex items-center gap-2 text-slate-800 font-medium mb-4">
                                <Bell size={18} />
                                <h3>Check-in reminders</h3>
                            </div>
                            <button
                                type="button"
                                onClick={toggleReminders}
                                aria-pressed={reminders}
                                className={`w-full sm:w-auto flex items-center justify-between gap-4 px-5 py-3 min-h-[48px] border rounded-xl font-medium transition-all text-sm ${reminders
                                    ? 'bg-slate-800 text-white border-slate-800'
                                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                    }`}
                            >
                                <span>{reminders ? 'Reminders are on' : 'Turn on reminders'}</span>
                                <span className={`text-xs ${reminders ? 'text-slate-300' : 'text-slate-400'}`}>
                                    {reminders ? '10:00' : 'off'}
                                </span>
                            </button>
                            <p className="mt-3 text-xs text-slate-400 font-light leading-relaxed max-w-md">
                                One notification at 10:00 for each relationship whose rhythm has come
                                round, carrying the same sentence the app shows — no counts, no
                                streaks, nothing to clear. Scheduled on this device from snapshots
                                you already have; nothing is sent to the server.
                            </p>
                            {reminderError && (
                                <p role="alert" className="mt-3 text-xs text-amber-600 font-light max-w-md">
                                    {reminderError}
                                </p>
                            )}
                        </div>
                    )}

                    <JournalSettings />

                    <div className="pt-8 border-t border-slate-50">
                        <div className="flex items-center gap-2 text-slate-800 font-medium mb-4">
                            <Shield size={18} />
                            <h3>Security</h3>
                        </div>
                        <button className="px-5 py-2.5 bg-white border border-slate-200 text-slate-600 font-medium rounded-xl hover:bg-slate-50 hover:border-slate-300 hover:text-slate-800 transition-all text-sm">
                            Change Password
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
