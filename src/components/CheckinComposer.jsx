import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Mic, NotebookPen, Plus, X } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useDiscretion } from '../context/DiscretionContext';
import VoiceCapture, { createVoiceKit } from './VoiceCheckin';
import ProposalCard from './ProposalCard';
import {
    chipClass,
    INTENSITY_DOT,
    DEFAULT_INTENSITY,
    nextIntensity,
    aboutText,
    FeelingGrid,
    PersonPicker,
    TriggerPicker,
    TagPicker,
    buildCheckinRequest
} from './CheckinControls';
import { readKeepTranscripts, readSuggestions } from '../constants/journalSettings';
import { CONTEXT_TAGS, MAX_TAGS } from '../constants/contextTags';
import {
    JOURNAL_COPY,
    MAX_FEELINGS_PER_CHECKIN,
    UNCLEAR_FEELING_ID,
    feelingById,
    fillCopy
} from '../constants/journal';

export { chipClass, buildCheckinRequest };

const AboutChip = ({ about, picked, onPickUp, onRemove }) => {
    const { maskName, blurClass } = useDiscretion();
    const person = about.kind === 'person';
    const text = person ? maskName(aboutText(about)) : aboutText(about);
    const dashed = about.kind === 'trigger' && about.isNew;

    return (
        <span
            data-about={about.kind}
            className={`${chipClass} border bg-slate-800/5 text-slate-600 ${dashed ? 'border-dashed border-slate-300' : 'border-transparent'
                } ${picked ? 'ring-2 ring-slate-400' : ''}`}
        >
            <button
                type="button"
                onClick={onPickUp}
                aria-pressed={picked}
                aria-label={fillCopy(JOURNAL_COPY.checkin.pickUp, { label: text })}
                className={person ? '' : blurClass}
            >
                {text}
            </button>
            <button
                type="button"
                onClick={onRemove}
                aria-label={fillCopy(JOURNAL_COPY.checkin.remove, { label: text })}
                className="text-slate-400 hover:text-slate-700 transition-colors"
            >
                <X size={12} />
            </button>
        </span>
    );
};

/** One picked feeling: its strength, its unsureness, and what it was about. */
const PickedFeeling = ({
    entry, moving, pendingTriggers, onCycleIntensity, onToggleUncertain, onRemove,
    onAddAbout, onPickUpAbout, onRemoveAbout, onMoveHere
}) => {
    const known = feelingById(entry.id);
    const hex = known?.hex ?? '#94a3b8';
    const label = known?.label ?? entry.id;
    const dashed = entry.uncertain === true || entry.id === UNCLEAR_FEELING_ID;
    const [picker, setPicker] = useState(null);
    const closePicker = () => setPicker(null);

    const addAbout = (about) => {
        onAddAbout(entry.id, about);
        closePicker();
    };

    const movingFromHere = moving?.id === entry.id;

    return (
        <div
            data-picked={entry.id}
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2"
        >
            <div className="flex flex-wrap items-center gap-2">
                <span
                    data-feeling={entry.id}
                    data-uncertain={dashed ? 'true' : 'false'}
                    className={`${chipClass} border text-slate-700 ${dashed ? 'border-dashed' : 'border-solid'}`}
                    style={{ borderColor: hex, backgroundColor: `${hex}1f` }}
                >
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                    {label}
                </span>

                <button
                    type="button"
                    data-intensity={entry.intensity}
                    onClick={() => onCycleIntensity(entry.id)}
                    aria-label={fillCopy(JOURNAL_COPY.checkin.intensityAria, {
                        word: JOURNAL_COPY.checkin.intensity[entry.intensity]
                    })}
                    className="px-2 h-6 min-w-[2.25rem] rounded-full border border-slate-200 bg-white text-slate-600 tracking-[0.2em] leading-none hover:border-slate-400 transition-colors"
                >
                    {INTENSITY_DOT.repeat(entry.intensity)}
                </button>

                <button
                    type="button"
                    onClick={() => onToggleUncertain(entry.id)}
                    aria-pressed={entry.uncertain === true}
                    aria-label={JOURNAL_COPY.checkin.uncertainLabel}
                    className={`w-6 h-6 rounded-full text-xs font-semibold border transition-colors ${entry.uncertain === true
                        ? 'bg-slate-700 text-white border-slate-700'
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                        }`}
                >
                    ≈
                </button>

                <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label={fillCopy(JOURNAL_COPY.checkin.remove, { label })}
                    className="ml-auto p-1 rounded-full text-slate-300 hover:text-slate-600 transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {entry.about.length > 0 && (
                    <span className="text-[11px] text-slate-400">{JOURNAL_COPY.checkin.aboutLabel}</span>
                )}
                {entry.about.map((about, index) => (
                    <AboutChip
                        key={`${about.kind}-${about.clientId ?? about.relationshipId ?? aboutText(about)}-${index}`}
                        about={about}
                        picked={movingFromHere && moving.index === index}
                        onPickUp={() => onPickUpAbout(entry.id, index)}
                        onRemove={() => onRemoveAbout(entry.id, index)}
                    />
                ))}

                {moving && !movingFromHere && (
                    <button
                        type="button"
                        data-move-here={entry.id}
                        onClick={() => onMoveHere(entry.id)}
                        className={`${chipClass} border border-dashed border-slate-400 text-slate-600 hover:bg-slate-100 transition-colors`}
                    >
                        {JOURNAL_COPY.checkin.moveHere}
                    </button>
                )}
            </div>

            {picker === null ? (
                <div className="flex flex-wrap gap-2">
                    {[
                        ['person', JOURNAL_COPY.checkin.addPerson],
                        ['trigger', JOURNAL_COPY.checkin.addTrigger],
                        ['tag', JOURNAL_COPY.checkin.addTag]
                    ].map(([kind, text]) => (
                        <button
                            key={kind}
                            type="button"
                            data-add-about={`${entry.id}:${kind}`}
                            onClick={() => setPicker(kind)}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-700 transition-colors"
                        >
                            <Plus size={12} />
                            {text}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="border-t border-slate-100">
                    {picker === 'person' && <PersonPicker onPick={addAbout} onCancel={closePicker} />}
                    {picker === 'trigger' && (
                        <TriggerPicker pending={pendingTriggers} onPick={addAbout} onCancel={closePicker} />
                    )}
                    {picker === 'tag' && <TagPicker onPick={addAbout} onCancel={closePicker} />}
                </div>
            )}
        </div>
    );
};

/* The two ways in (§9.2) */

export const CheckinButton = ({ onOpen, voice = false }) => (
    <button
        type="button"
        data-checkin-open="header"
        data-checkin-mode={voice ? 'voice' : 'chips'}
        onClick={() => onOpen(voice ? 'voice' : 'chips')}
        title={voice ? JOURNAL_COPY.voice.openHint : JOURNAL_COPY.checkin.openHint}
        className="hidden md:flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group flex-shrink-0"
    >
        {voice
            ? <Mic size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
            : <NotebookPen size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />}
        <span className="font-medium">{voice ? JOURNAL_COPY.voice.open : JOURNAL_COPY.checkin.open}</span>
    </button>
);

export const CheckinFab = ({ onOpen, voice = false }) => (
    <button
        type="button"
        data-checkin-open="fab"
        data-checkin-mode={voice ? 'voice' : 'chips'}
        onClick={() => onOpen(voice ? 'voice' : 'chips')}
        aria-label={voice ? JOURNAL_COPY.voice.open : JOURNAL_COPY.checkin.open}
        style={{ bottom: 'calc(var(--alq-nav-height) + env(safe-area-inset-bottom, 0px) + 1rem)' }}
        className="alq-hide-on-keyboard md:hidden fixed right-4 z-40 h-16 w-16 rounded-full bg-slate-800 text-white shadow-lg shadow-slate-900/20 flex items-center justify-center active:bg-slate-700 transition-colors"
    >
        {voice ? <Mic size={26} strokeWidth={1.75} /> : <NotebookPen size={26} strokeWidth={1.75} />}
    </button>
);

/* The sheet */

export default function CheckinComposer({ onClose, onSaved, mode = 'chips', voiceKit = null, context = null }) {
    const { createEntry } = useJournal();
    const { blurClass } = useDiscretion();
    const titleId = useId();

    // Built once, and only for a composer that was opened by the microphone. A chips
    // composer never constructs a recorder, so it never asks for a device.
    const kit = useMemo(
        () => (mode === 'voice' ? (voiceKit || createVoiceKit()) : null),
        [mode, voiceKit]
    );

    const [picked, setPicked] = useState([]);
    const [query, setQuery] = useState('');
    const [tags, setTags] = useState([]);
    const [note, setNote] = useState('');
    // The chip that has been picked up and is waiting for a feeling to be dropped on.
    const [moving, setMoving] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    // `null` means “nothing spoken yet” and `''` means “spoken, and the words came back
    // empty” — the same absent-is-not-empty rule the payload follows.
    const [transcript, setTranscript] = useState(null);
    const [language, setLanguage] = useState(null);

    const takeTranscript = useCallback((text, spokenLanguage) => {
        setTranscript(text);
        if (spokenLanguage !== undefined) setLanguage(spokenLanguage || null);
    }, []);

    // D2. Read once per open, like the transcript setting: a preference changed on the
    // profile screen applies to the next composer, not to one already holding a card.
    const [suggestions] = useState(() => readSuggestions());
    // The `propose` envelope the card is drawn from, or null while there is none. Only a
    // composer the microphone opened can ever hold one, and only with the setting on.
    const [proposal, setProposal] = useState(null);

    const takeProposal = useCallback((result) => {
        if (suggestions && result?.ok) setProposal(result);
    }, [suggestions]);

    const saveProposal = async (request) => {
        const created = await createEntry(request);
        if (onSaved) onSaved(created);
        onClose();
    };

    /** §4.6's second exit: back to the microphone, with nothing kept. */
    const rerecord = () => {
        setProposal(null);
        setTranscript(null);
        setLanguage(null);
    };

    /** §4.6's third exit: the words stay, the card goes, and the grid below takes over. */
    const fallToChips = (text) => {
        setProposal(null);
        setTranscript(text);
    };

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const atCap = picked.length >= MAX_FEELINGS_PER_CHECKIN;

    const toggleFeeling = (id) => {
        setMoving(null);
        setPicked(previous => {
            if (previous.some(entry => entry.id === id)) {
                return previous.filter(entry => entry.id !== id);
            }

            const fresh = { id, intensity: DEFAULT_INTENSITY, uncertain: false, about: [] };
            if (id === UNCLEAR_FEELING_ID) return [fresh];

            const others = previous.filter(entry => entry.id !== UNCLEAR_FEELING_ID);
            if (others.length >= MAX_FEELINGS_PER_CHECKIN) return previous;
            return [...others, fresh];
        });
    };

    const updateFeeling = (id, change) => setPicked(previous => previous.map(entry => (
        entry.id === id ? { ...entry, ...change(entry) } : entry
    )));

    const cycleIntensity = (id) => updateFeeling(id, entry => ({ intensity: nextIntensity(entry.intensity) }));
    const toggleUncertain = (id) => updateFeeling(id, entry => ({ uncertain: entry.uncertain !== true }));
    const removeFeeling = (id) => {
        setMoving(null);
        setPicked(previous => previous.filter(entry => entry.id !== id));
    };

    const addAbout = (id, about) => updateFeeling(id, entry => ({ about: [...entry.about, about] }));
    const removeAbout = (id, index) => {
        setMoving(null);
        updateFeeling(id, entry => ({ about: entry.about.filter((_, at) => at !== index) }));
    };

    const pickUpAbout = (id, index) => setMoving(previous => (
        previous?.id === id && previous.index === index ? null : { id, index }
    ));

    /** The second half of "tap the chip, then tap the other feeling". */
    const moveHere = (targetId) => {
        if (!moving) return;
        const source = picked.find(entry => entry.id === moving.id);
        const chip = source?.about[moving.index];
        setMoving(null);
        if (!chip) return;

        setPicked(previous => previous.map(entry => {
            if (entry.id === moving.id) {
                return { ...entry, about: entry.about.filter((_, at) => at !== moving.index) };
            }
            if (entry.id === targetId) return { ...entry, about: [...entry.about, chip] };
            return entry;
        }));
    };

    const toggleTag = (tag) => setTags(previous => (
        previous.includes(tag)
            ? previous.filter(entry => entry !== tag)
            : (previous.length < MAX_TAGS ? [...previous, tag] : previous)
    ));

    const pendingTriggers = useMemo(() => {
        const byId = new Map();
        picked.forEach(entry => entry.about.forEach(about => {
            if (about.kind !== 'trigger' || !about.isNew || byId.has(about.clientId)) return;
            byId.set(about.clientId, {
                clientId: about.clientId, live: about.clientId, label: about.label, isNew: true
            });
        }));
        return [...byId.values()];
    }, [picked]);

    const save = async () => {
        if (saving || picked.length === 0) return;

        setSaving(true);
        setError(null);
        try {
            // Built here rather than memoised above: nothing downstream depends on its
            // identity, so a memo would only suggest something does.
            const created = await createEntry(buildCheckinRequest({
                picked, tags, note,
                // What the user left in the box is what is saved (§4.3). The model's own
                // text is never read again after it lands in that textarea.
                transcript, language, keepTranscript: readKeepTranscripts()
            }));
            // Trap 4: inside `try`, after the await. In a `finally` this would throw the
            // user's whole check-in away on every failed save.
            if (onSaved) onSaved(created);
            onClose();
        } catch (failure) {
            setError(failure?.response?.data?.error || JOURNAL_COPY.checkin.saveError);
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/20 backdrop-blur-sm sm:p-4">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-100 max-h-[92vh] flex flex-col overflow-hidden"
            >
                <div className="px-5 pt-5 pb-3 flex justify-between items-start gap-4 flex-shrink-0">
                    <h2 id={titleId} className="text-lg font-light text-slate-800">
                        {JOURNAL_COPY.checkin.prompt}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={JOURNAL_COPY.checkin.close}
                        className="p-2 -mr-2 -mt-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-50 transition-colors flex-shrink-0"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
                    {kit && (
                        <VoiceCapture
                            kit={kit}
                            context={context}
                            transcript={transcript}
                            onTranscript={takeTranscript}
                            onProposal={takeProposal}
                            onKeyboard={() => setTranscript('')}
                            hidden={proposal !== null}
                        />
                    )}

                    {proposal !== null ? (
                        <ProposalCard
                            result={proposal}
                            context={context}
                            runtime={kit.runtime}
                            source={{
                                model: kit.runtime.model ?? kit.model?.id ?? null,
                                promptVersion: kit.runtime.promptVersion ?? null
                            }}
                            onSave={saveProposal}
                            onDiscard={onClose}
                            onRerecord={rerecord}
                            onChips={fallToChips}
                        />
                    ) : (
                    <>
                    {picked.length > 0 && (
                        <div className="space-y-2">
                            {moving && (
                                <p role="status" className="text-[11px] text-slate-500 font-light">
                                    {JOURNAL_COPY.checkin.moveHint}
                                </p>
                            )}
                            {picked.map(entry => (
                                <PickedFeeling
                                    key={entry.id}
                                    entry={entry}
                                    moving={moving}
                                    pendingTriggers={pendingTriggers}
                                    onCycleIntensity={cycleIntensity}
                                    onToggleUncertain={toggleUncertain}
                                    onRemove={removeFeeling}
                                    onAddAbout={addAbout}
                                    onPickUpAbout={pickUpAbout}
                                    onRemoveAbout={removeAbout}
                                    onMoveHere={moveHere}
                                />
                            ))}
                        </div>
                    )}

                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {JOURNAL_COPY.checkin.chips}
                        </p>

                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            aria-label={JOURNAL_COPY.checkin.find}
                            placeholder={JOURNAL_COPY.checkin.find}
                            className="w-full text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                        />

                        <FeelingGrid picked={picked} atCap={atCap} query={query} onToggle={toggleFeeling} />

                        <p className="text-[11px] text-slate-400 font-light">
                            {fillCopy(JOURNAL_COPY.checkin.cap, { max: MAX_FEELINGS_PER_CHECKIN })}
                            {' '}
                            {JOURNAL_COPY.checkin.unclearAlone}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            {JOURNAL_COPY.checkin.tagsLabel}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {CONTEXT_TAGS.map(tag => {
                                const selected = tags.includes(tag);
                                return (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleTag(tag)}
                                        aria-pressed={selected}
                                        className={`px-3 py-1 rounded-full text-xs border transition-colors ${selected
                                            ? 'bg-slate-800 text-white border-slate-800'
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                            }`}
                                    >
                                        {tag}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label
                            htmlFor="checkin-note"
                            className="block text-xs font-semibold text-slate-400 uppercase tracking-wider"
                        >
                            {JOURNAL_COPY.checkin.noteLabel}
                        </label>
                        <textarea
                            id="checkin-note"
                            data-composer-note
                            rows={2}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            className={`w-full text-sm p-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-slate-800 transition-colors resize-y ${blurClass}`}
                        />
                    </div>
                    </>
                    )}
                </div>

                {proposal === null && (
                <div className="px-5 py-4 border-t border-slate-100 flex-shrink-0 space-y-3 pb-safe">
                    {error && (
                        <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                            {error}
                        </p>
                    )}
                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                        >
                            {JOURNAL_COPY.checkin.cancel}
                        </button>
                        <button
                            type="button"
                            onClick={save}
                            disabled={saving || picked.length === 0}
                            className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            {saving ? JOURNAL_COPY.checkin.saving : JOURNAL_COPY.checkin.save}
                        </button>
                    </div>
                </div>
                )}
            </div>
        </div>
    );
}
