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
    TRIGGER_ROLES,
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

/* The pieces */

export const INTENSITY_DOT = '·';

/** `··`. Two of three, so the common case is one tap and not two. */
export const DEFAULT_INTENSITY = INTENSITY_LEVELS[1];

export const nextIntensity = (level) => {
    const index = INTENSITY_LEVELS.indexOf(level);
    return INTENSITY_LEVELS[(index + 1) % INTENSITY_LEVELS.length];
};

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

export const TriggerPicker = ({ pending, onPick, onCancel }) => {
    const { triggers } = useJournal();
    const { blurClass } = useDiscretion();
    const [query, setQuery] = useState('');

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
                            clientId: candidate.live ?? candidate.trigger?.live ?? candidate.clientId,
                            label: candidate.label,
                            isNew: candidate.isNew === true || candidate.trigger?.isNew === true
                        })}
                        className={`${chipClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors ${blurClass}`}
                    >
                        {candidate.label}
                    </button>
                ))}

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

/* The request */

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
        if (about.isNew) {
            const minted = { label: about.label, client_id: about.clientId };
            // Which half the new word is, when the card knew. Absent stays absent: an
            // existing trigger keeps the role it was minted with, and a chip has none.
            if (TRIGGER_ROLES.includes(about.role)) minted.role = about.role;
            triggers.push(minted);
        } else {
            triggers.push({ trigger: about.clientId });
        }
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
        // The words behind it, when a model quoted them and the user kept the feeling.
        if (typeof entry.quote === 'string' && entry.quote.trim()) feeling.quote = entry.quote.trim();
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
