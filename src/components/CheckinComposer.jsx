import React, { useEffect, useId, useMemo, useState } from 'react';
import { NotebookPen, Plus, X } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { CONTEXT_TAGS, MAX_TAGS, MAX_TAG_LENGTH } from '../constants/contextTags';
import {
    DAY_ROLLOVER_HOUR,
    INTENSITY_LEVELS,
    JOURNAL_COPY,
    MAX_FEELINGS_PER_CHECKIN,
    MAX_TRIGGER_LABEL,
    PAYLOAD_VERSION,
    UNCLEAR_FEELING_ID,
    activeFeelings,
    civilDay,
    clientId,
    feelingById,
    fillCopy,
    personCandidates,
    rfc3339Local,
    triggerCandidates,
    tzOffsetMinutes
} from '../constants/journal';

/**
 * The check-in composer — chips and typed text, which §4.1 calls the definition of a
 * check-in rather than a fallback for one. Voice and the model arrive in 6-C and 6-D and
 * land on the same record; nothing here waits for them.
 *
 * **Invariant 15 is structural in this file, not intentional.** Nothing is written that the
 * user did not tap: `personCandidates` and `triggerCandidates` return suggestions and this
 * component never selects one of them, a new person or a new trigger reaches the request
 * only from the button that names it, and the `about` a chip carries is only ever the chip
 * the user put there. The request is built from this component's state at save time, never
 * from a picker's transient text — a label typed and then abandoned mints nothing.
 *
 * **Trap 4:** a failed save leaves the sheet open with every selection intact. `onClose()`
 * sits inside `try`, after the await, and never in a `finally`.
 *
 * **No bare strings.** Every word comes from `JOURNAL_COPY`, so the forbidden-word walk in
 * `journal.test.js` sees the whole surface. Colours are inline `style` from the complete
 * literal hexes in `FEELINGS`, never composed class names (invariant 4).
 */

/* ------------------------------------------------------------------------------------ */
/* The pieces                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Strength, as dots.
 *
 * §4.4 item 2 says dots and never numbers, and the reason is the product's: a number
 * invites arithmetic across check-ins, and there is no mood average in this app. The word
 * goes in the button's `aria-label` so a screen reader hears "clearly" rather than a run of
 * middle dots; `data-intensity` is for tests, and a data attribute is not a rendering.
 */
const INTENSITY_DOT = '·';

/** `··`. Two of three, so the common case is one tap and not two. */
const DEFAULT_INTENSITY = INTENSITY_LEVELS[1];

const nextIntensity = (level) => {
    const index = INTENSITY_LEVELS.indexOf(level);
    return INTENSITY_LEVELS[(index + 1) % INTENSITY_LEVELS.length];
};

/**
 * The neutral chip shape every chip in the journal borrows, so one row reads as one row.
 *
 * It lives here rather than in `Journal.jsx`, which is where it reads more naturally,
 * because `Journal.jsx` imports this module — the other direction would be a cycle. It is a
 * complete literal string and must stay one: a composed class name is purged by the Tailwind
 * scanner and renders shapeless (invariant 4).
 */
export const chipClass = 'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium';

/** The whole vocabulary as one grid of buttons, narrowed by the field above it. */
const FeelingGrid = ({ picked, atCap, query, onToggle }) => {
    const needle = query.trim().toLowerCase();
    const shown = activeFeelings().filter(feeling => (
        !needle
        || feeling.label.toLowerCase().includes(needle)
        || feeling.gloss.toLowerCase().includes(needle)
        || feeling.id.includes(needle)
    ));

    if (shown.length === 0) {
        return <p className="text-xs text-slate-400 font-light">{JOURNAL_COPY.checkin.findEmpty}</p>;
    }

    return (
        <div className="flex flex-wrap gap-2">
            {shown.map(feeling => {
                const selected = picked.some(entry => entry.id === feeling.id);
                const unclear = feeling.id === UNCLEAR_FEELING_ID;
                // The cap is stated above this grid; here it only stops the tap. `unclear`
                // is exempt because choosing it puts every other word down anyway.
                const blocked = !selected && atCap && !unclear;

                return (
                    <button
                        key={feeling.id}
                        type="button"
                        data-feeling={feeling.id}
                        aria-pressed={selected}
                        disabled={blocked}
                        title={feeling.gloss}
                        onClick={() => onToggle(feeling.id)}
                        className={`${chipClass} border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${unclear ? 'border-dashed' : 'border-solid'
                            } ${selected ? 'text-slate-800' : 'text-slate-600'}`}
                        style={{
                            borderColor: feeling.hex,
                            backgroundColor: selected ? `${feeling.hex}33` : 'transparent'
                        }}
                    >
                        <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: feeling.hex }} />
                        {feeling.label}
                    </button>
                );
            })}
        </div>
    );
};

/**
 * One person the user might have meant, or one they are about to name for the first time.
 *
 * Nothing here is pre-selected. `personCandidates` returns an exact match **alone** (§4.5
 * step 1), so what this list offers beside a name is only ever offered when the server
 * would not have matched it exactly either.
 */
const PersonPicker = ({ onPick, onCancel }) => {
    const { relationships } = useSubjects();
    const { maskName } = useDiscretion();
    const [query, setQuery] = useState('');

    const typed = query.trim();
    const candidates = personCandidates(typed, relationships);
    const offered = typed ? candidates : relationships.map(person => ({
        relationshipId: person.ID, name: person.name, exact: false, match: 'all'
    }));

    return (
        <div className="space-y-2 pt-2">
            <input
                type="text"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={JOURNAL_COPY.checkin.personLabel}
                placeholder={JOURNAL_COPY.checkin.personPlaceholder}
                maxLength={MAX_TAG_LENGTH}
                className="w-full text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
            />

            {typed && candidates.length > 0 && !candidates[0].exact && (
                <p className="text-[11px] text-slate-400 font-light">{JOURNAL_COPY.people.candidateHint}</p>
            )}

            <div className="flex flex-wrap gap-2">
                {offered.map(candidate => (
                    <button
                        key={`known-${candidate.relationshipId}`}
                        type="button"
                        data-person-candidate={candidate.relationshipId}
                        onClick={() => onPick({ kind: 'person', relationshipId: candidate.relationshipId, name: candidate.name })}
                        className={`${chipClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors`}
                    >
                        {maskName(candidate.name)}
                    </button>
                ))}

                {/* Dashed, because nothing dashed has been written yet (§4.4). The person is
                    created by the server inside the entry's transaction, and only if this
                    button was tapped — and it is never offered beside an exact match,
                    because `FindOrCreateRelationship` would have matched that name anyway
                    and the offer would invite a duplicate the server cannot make (§4.5). */}
                {typed && !candidates.some(candidate => candidate.exact) && (
                    <button
                        type="button"
                        data-new-person
                        onClick={() => onPick({ kind: 'person', relationshipId: null, name: typed })}
                        className={`${chipClass} border border-dashed border-slate-300 bg-white text-slate-500 hover:border-slate-500 transition-colors`}
                    >
                        {fillCopy(JOURNAL_COPY.people.newPerson, { name: maskName(typed) })}
                    </button>
                )}
            </div>

            <button
                type="button"
                onClick={onCancel}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4"
            >
                {JOURNAL_COPY.checkin.cancel}
            </button>
        </div>
    );
};

/**
 * The same for a trigger.
 *
 * The list comes from the provider's `triggers`, which is `activeTriggers` resolved through
 * `readTrigger` — a merged-away trigger is not in it, and the one that survived is offered
 * under its current label. The id sent is `live`, never the id a chip was first written
 * with: the server accepts a live trigger only (§6.3), and the client is the half that
 * resolves.
 */
const TriggerPicker = ({ pending, onPick, onCancel }) => {
    const { triggers } = useJournal();
    const { blurClass } = useDiscretion();
    const [query, setQuery] = useState('');

    // The triggers this composer has already minted count as existing ones for every
    // feeling after the first. Without them the second feeling cannot reach the word the
    // first one just named, and the only way to attach it would be to type the label again
    // — which mints a second `client_id` and, on save, a second trigger row with the same
    // label. A vocabulary that duplicates itself on the way in is worse than none.
    const known = [...triggers, ...pending];
    const typed = query.trim();
    const candidates = triggerCandidates(typed, known);
    const offered = typed ? candidates : known;

    return (
        <div className="space-y-2 pt-2">
            <input
                type="text"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={JOURNAL_COPY.checkin.triggerLabel}
                placeholder={JOURNAL_COPY.checkin.triggerPlaceholder}
                maxLength={MAX_TRIGGER_LABEL}
                className="w-full text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
            />

            <div className="flex flex-wrap gap-2">
                {offered.map(candidate => (
                    <button
                        key={`known-${candidate.live ?? candidate.clientId}`}
                        type="button"
                        data-trigger-candidate={candidate.live ?? candidate.clientId}
                        onClick={() => onPick({
                            kind: 'trigger',
                            // `live` is what a new entry must reference; `clientId` is what
                            // the row was called when it was written. A candidate from
                            // `triggerCandidates` carries the row it matched, so the walk
                            // is reachable from either shape.
                            clientId: candidate.live ?? candidate.trigger?.live ?? candidate.clientId,
                            label: candidate.label,
                            // A trigger this composer minted a moment ago is still new: it
                            // has no row yet, so it travels as `label` + `client_id` rather
                            // than as a reference the server would answer 404 for.
                            isNew: candidate.isNew === true || candidate.trigger?.isNew === true
                        })}
                        className={`${chipClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors ${blurClass}`}
                    >
                        {candidate.label}
                    </button>
                ))}

                {/* Dashed until confirmed. The `client_id` is minted here, on the tap, and
                    travels in `triggers[]` and in the feeling's `about` as the same value —
                    which is what makes the two halves of §7.2 agree. Not offered beside an
                    exact match: *Arbeit* and *arbeit* are one trigger (§4.5b). */}
                {typed && !candidates.some(candidate => candidate.exact) && (
                    <button
                        type="button"
                        data-new-trigger
                        onClick={() => onPick({ kind: 'trigger', clientId: clientId(), label: typed, isNew: true })}
                        className={`${chipClass} border border-dashed border-slate-300 bg-white text-slate-500 hover:border-slate-500 transition-colors`}
                    >
                        {fillCopy(JOURNAL_COPY.triggers.newTrigger, { label: typed })}
                    </button>
                )}
            </div>

            <button
                type="button"
                onClick={onCancel}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4"
            >
                {JOURNAL_COPY.checkin.cancel}
            </button>
        </div>
    );
};

/** A context tag, from the same seven the snapshots offer, or one the user writes. */
const TagPicker = ({ onPick, onCancel }) => {
    const [custom, setCustom] = useState('');
    const typed = custom.trim();

    return (
        <div className="space-y-2 pt-2">
            <div className="flex flex-wrap gap-2">
                {CONTEXT_TAGS.map(tag => (
                    <button
                        key={tag}
                        type="button"
                        onClick={() => onPick({ kind: 'tag', tag })}
                        className={`${chipClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors`}
                    >
                        {tag}
                    </button>
                ))}
            </div>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        if (typed) onPick({ kind: 'tag', tag: typed });
                    }}
                    aria-label={JOURNAL_COPY.checkin.tagLabel}
                    placeholder={JOURNAL_COPY.checkin.tagPlaceholder}
                    maxLength={MAX_TAG_LENGTH}
                    className="flex-1 text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                />
                <button
                    type="button"
                    disabled={!typed}
                    onClick={() => onPick({ kind: 'tag', tag: typed })}
                    className="px-3 py-1 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:border-slate-400 hover:text-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                    {JOURNAL_COPY.checkin.add}
                </button>
            </div>

            <button
                type="button"
                onClick={onCancel}
                className="text-[11px] font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4"
            >
                {JOURNAL_COPY.checkin.cancel}
            </button>
        </div>
    );
};

/** The text of one `about` chip, before it is a payload target. */
const aboutText = (about) => (about.kind === 'tag' ? about.tag : (about.name ?? about.label ?? ''));

/**
 * One chip a feeling is about.
 *
 * Two controls, because it does two things: the body picks it up so it can be dropped on
 * another feeling, and the × takes it off this one. A person is masked under discretion and
 * never blurred — the mask is the cover; a trigger or a tag is blurred like every other
 * note in this app (§9.6).
 */
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

                {/* The same `≈` the snapshot sliders use for a score the user does not
                    trust, so one mark means one thing across the app. */}
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

/* ------------------------------------------------------------------------------------ */
/* The request                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * The §7.2 request, built from what is on screen and from nothing else.
 *
 * Two dedupe passes, both of which matter. Two feelings about the same person produce **one**
 * mention and two `about`s pointing at its `ref` — the ref is the index into `mentions`,
 * which is what the server validates against (§6.5). Two feelings about the same new trigger
 * produce **one** `triggers[]` entry and therefore one trigger row, which is the difference
 * between a vocabulary and a pile of duplicates.
 *
 * `source` is `typed` when the user wrote a sentence and `chips` when they only tapped —
 * §4.1's two paths, told apart by the only thing that distinguishes them here.
 */
export const buildCheckinRequest = ({ picked, tags, note, now = new Date() }) => {
    const mentions = [];
    const mentionRefs = new Map();
    const triggers = [];
    const triggersSeen = new Set();

    const refFor = (about) => {
        const key = about.relationshipId != null ? `id:${about.relationshipId}` : `new:${about.name}`;
        if (!mentionRefs.has(key)) {
            const ref = mentions.length;
            mentions.push(about.relationshipId != null
                ? { ref, relationship_id: about.relationshipId, label: about.name }
                : { ref, name: about.name, label: about.name });
            mentionRefs.set(key, ref);
        }
        return mentionRefs.get(key);
    };

    const declareTrigger = (about) => {
        if (triggersSeen.has(about.clientId)) return about.clientId;
        triggersSeen.add(about.clientId);
        triggers.push(about.isNew
            ? { label: about.label, client_id: about.clientId }
            : { trigger: about.clientId });
        return about.clientId;
    };

    const feelings = picked.map(entry => {
        const about = entry.about.map(target => {
            if (target.kind === 'person') return { kind: 'person', ref: refFor(target) };
            if (target.kind === 'trigger') return { kind: 'trigger', trigger: declareTrigger(target) };
            return { kind: 'tag', tag: target.tag };
        });

        const feeling = { id: entry.id, intensity: entry.intensity, about };
        // Absent, never `false` (invariant 14). Only `true` is a statement the user made.
        if (entry.uncertain === true) feeling.uncertain = true;
        return feeling;
    });

    const trimmedNote = note.trim();
    const payload = {
        v: PAYLOAD_VERSION,
        source: trimmedNote ? 'typed' : 'chips',
        tz_offset_min: tzOffsetMinutes(now),
        feelings
    };
    // An empty list and an absent key mean the same thing, and the absent one is the honest
    // record of a user who added neither.
    if (tags.length > 0) payload.tags = tags;
    if (trimmedNote) payload.note = trimmedNote;

    return {
        client_id: clientId(),
        kind: 'checkin',
        at: rfc3339Local(now),
        day: civilDay(now, DAY_ROLLOVER_HOUR),
        // The row's schema version, which is not the payload's `v` — they are both 1 today
        // and they version different things (§6.2 against §6.4).
        schema_version: 1,
        payload,
        mentions,
        triggers,
        supersedes_id: null
    };
};

/* ------------------------------------------------------------------------------------ */
/* The two ways in (§9.2)                                                                 */
/* ------------------------------------------------------------------------------------ */

/**
 * The header button above `md`, in the corner the dashboard puts *New Analysis* in, so the
 * app's two primary screens share one grammar.
 */
export const CheckinButton = ({ onOpen }) => (
    <button
        type="button"
        data-checkin-open="header"
        onClick={onOpen}
        title={JOURNAL_COPY.checkin.openHint}
        className="hidden md:flex items-center justify-center gap-2 px-5 py-3 min-h-[48px] bg-white border border-slate-200 text-slate-700 rounded-xl hover:border-slate-400 hover:shadow-md transition-all group flex-shrink-0"
    >
        <NotebookPen size={18} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
        <span className="font-medium">{JOURNAL_COPY.checkin.open}</span>
    </button>
);

/**
 * The handset button: 64 px, bottom-right, inside the thumb's arc, sitting on top of the
 * bottom bar's height plus the gesture inset so it clears both. It hides with the bar while
 * the soft keyboard is up, for the bar's own reason — a control under an open keyboard is a
 * mis-tap waiting to happen.
 *
 * It is a keyboard/chips button in this slice. The microphone takes this place in 6-C where
 * a device can run the transcriber, and under discretion it stays a keyboard for good
 * (§4.4): speaking a note aloud defeats the mode, and the app should not offer to.
 */
export const CheckinFab = ({ onOpen }) => (
    <button
        type="button"
        data-checkin-open="fab"
        onClick={onOpen}
        aria-label={JOURNAL_COPY.checkin.open}
        style={{ bottom: 'calc(var(--alq-nav-height) + env(safe-area-inset-bottom, 0px) + 1rem)' }}
        className="alq-hide-on-keyboard md:hidden fixed right-4 z-40 h-16 w-16 rounded-full bg-slate-800 text-white shadow-lg shadow-slate-900/20 flex items-center justify-center active:bg-slate-700 transition-colors"
    >
        <NotebookPen size={26} strokeWidth={1.75} />
    </button>
);

/* ------------------------------------------------------------------------------------ */
/* The sheet                                                                              */
/* ------------------------------------------------------------------------------------ */

export default function CheckinComposer({ onClose, onSaved }) {
    const { createEntry } = useJournal();
    const { blurClass } = useDiscretion();
    const titleId = useId();

    const [picked, setPicked] = useState([]);
    const [query, setQuery] = useState('');
    const [tags, setTags] = useState([]);
    const [note, setNote] = useState('');
    // The chip that has been picked up and is waiting for a feeling to be dropped on.
    const [moving, setMoving] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    const atCap = picked.length >= MAX_FEELINGS_PER_CHECKIN;

    /**
     * `unclear` is exclusive, which §4.4 implies and this makes explicit: *can't tell*
     * beside *joy* is not a record of two things, it is a contradiction, and the record
     * should not be able to hold one. Choosing it puts the others down; choosing another
     * puts it down. The sentence saying so is on screen beside the grid.
     */
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

    /**
     * The triggers minted in this composer and not yet saved, in the shape the picker's
     * chips and `triggerCandidates` both read. Deduped by id, so a word attached to two
     * feelings appears once in the list it is offered from.
     */
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
            const created = await createEntry(buildCheckinRequest({ picked, tags, note }));
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

                        {/* Stated before it is reached, so the limit is something the user
                            was told rather than something they ran into. */}
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
                        {/* Blurred under discretion like every other note in the app — and
                            it is what turns this into the `typed` path (§4.1). */}
                        <textarea
                            id="checkin-note"
                            data-composer-note
                            rows={2}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            className={`w-full text-sm p-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-slate-800 transition-colors resize-y ${blurClass}`}
                        />
                    </div>
                </div>

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
            </div>
        </div>
    );
}
