import React, { useState } from 'react';
import { useJournal } from '../context/JournalContext';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { CONTEXT_TAGS, MAX_TAG_LENGTH } from '../constants/contextTags';
import {
    DAY_ROLLOVER_HOUR,
    INTENSITY_LEVELS,
    JOURNAL_COPY,
    MAX_TRIGGER_LABEL,
    PAYLOAD_VERSION,
    UNCLEAR_FEELING_ID,
    activeFeelings,
    civilDay,
    clientId,
    fillCopy,
    personCandidates,
    rfc3339Local,
    triggerCandidates,
    tzOffsetMinutes
} from '../constants/journal';

/**
 * The controls a check-in is made of, shared by the composer (A7) and the proposal card
 * (D2): the chip shape, the strength dots, the vocabulary grid, the three pickers, and the
 * §7.2 request builder.
 *
 * They lived inside `CheckinComposer.jsx` until the card needed them. Moving them here
 * rather than importing them from the composer is what keeps the graph a tree: the
 * composer renders the card, the card would otherwise import the composer, and a cycle
 * that happens to work under one bundler is not a design. Nothing in this file has an
 * opinion about proposals — a picker hands back what the user tapped and `buildCheckinRequest`
 * builds a body from what it is given, which is the shape invariant 15 needs both callers
 * to share.
 *
 * **Invariant 15 is structural here, not intentional.** `personCandidates` and
 * `triggerCandidates` return suggestions and no picker in this file selects one; a new
 * person or a new trigger reaches a request only from the dashed button that names it; and
 * the request is built from what the caller holds at save time, never from a picker's
 * transient text — a label typed and then abandoned mints nothing.
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
export const INTENSITY_DOT = '·';

/** `··`. Two of three, so the common case is one tap and not two. */
export const DEFAULT_INTENSITY = INTENSITY_LEVELS[1];

export const nextIntensity = (level) => {
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
export const FeelingGrid = ({ picked, atCap, query, onToggle }) => {
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
export const PersonPicker = ({ onPick, onCancel }) => {
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
export const TriggerPicker = ({ pending, onPick, onCancel }) => {
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
export const TagPicker = ({ onPick, onCancel }) => {
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
export const aboutText = (about) => (about.kind === 'tag' ? about.tag : (about.name ?? about.label ?? ''));

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
export const buildCheckinRequest = ({
    picked, tags, note, now = new Date(),
    // C3. Absent on the chips and typed paths, and absent — not empty — when the user
    // turned *Keep transcripts* off, because the two are different records (invariant 14).
    transcript = null, language = null, keepTranscript = true
}) => {
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
    const spoken = typeof transcript === 'string' && transcript.trim().length > 0;
    const payload = {
        v: PAYLOAD_VERSION,
        // A spoken check-in is `voice` whether or not the words were kept: the source is
        // how the entry was made, and dropping the transcript does not unspeak it.
        source: spoken ? 'voice' : (trimmedNote ? 'typed' : 'chips'),
        tz_offset_min: tzOffsetMinutes(now),
        feelings
    };

    if (spoken) {
        // `transcript_kept` is written on every spoken entry, `false` included, because
        // here `false` is a statement the user made in settings rather than an absence
        // — it is the difference between “nothing was said” and “what was said was not
        // kept”, and only the row can say which.
        payload.transcript_kept = keepTranscript !== false;
        if (keepTranscript !== false) payload.transcript = transcript.trim();
        if (language) payload.language = language;
    }
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

