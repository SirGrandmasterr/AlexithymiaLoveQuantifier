import React, { useCallback, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useSubjects } from '../context/SubjectsContext';
import { useDiscretion } from '../context/DiscretionContext';
import { propose, textInput } from '../journal/inference';
import { readKeepTranscripts } from '../constants/journalSettings';
import {
    JOURNAL_COPY,
    MAX_FEELINGS_PER_CHECKIN,
    UNCLEAR_FEELING_ID,
    clientId,
    feelingById,
    fillCopy,
    personCandidates,
    triggerCandidates
} from '../constants/journal';
import {
    chipClass,
    INTENSITY_DOT,
    DEFAULT_INTENSITY,
    nextIntensity,
    FeelingGrid,
    PersonPicker,
    TriggerPicker,
    TagPicker,
    buildCheckinRequest
} from './CheckinControls';

/**
 * The proposal card — where "the user authors every number" is made visible (§4.4).
 *
 * It shows what a model proposed, lets the user accept it chip by chip, and writes only
 * what is solid. Its anatomy is §4.4's, top to bottom: the transcript as an editable quote;
 * the feelings, dashed until tapped; what each was about, under it; the people, with their
 * resolution state; and Save, Discard and *This isn't it*. Facts are not on it — see the
 * note on §4.4 item 5 below.
 *
 * **Invariant 15 holds structurally, in three places a reader can point at:**
 *
 * 1. `confirmedPicked` builds the save payload from **the card's state**, never from the
 *    proposal: a feeling reaches it only if `confirmed`, and an `about` only if the person
 *    or trigger it names was resolved or confirmed. A dashed chip has no path to the body.
 * 2. `resolvePerson` and `resolveTriggerLabel` set `confirmed: true` only for an **exact
 *    or case-and-diacritic-equal match** — the same comparison `FindOrCreateRelationship`
 *    and §4.5b make — so what the card shows solid is what the server would have matched
 *    anyway. A candidate is offered and never selected; a new name is dashed until tapped.
 * 3. The model's proposal travels **beside** the body as `payload.proposal` (§6.3), built
 *    by `buildProvenance`: what was proposed, what was accepted, what replaced what, how
 *    much the filter dropped. That is the honest measure of whether the model is helping,
 *    and it is provenance, not input — the server validates ids, not opinions.
 *
 * **§4.4 item 5, facts, is deliberately not built.** S0's decision (ledger, 2026-08-22,
 * *`person_fact` waits for 6-E*) is that no UI writes a `person_fact` until the encryption
 * envelope lands, and it names this card: *"D2 must not offer a `person_fact` affordance in
 * the proposal card."* A proposal's `facts` are therefore neither shown nor written. The
 * validator still filters them (D1), so when the decision is reversed the data is clean.
 *
 * **`unclear` is exclusive here as it is in the composer** (A7). The validator lets a
 * proposal carry *can't tell* beside a named feeling; the first tap decides — keeping one
 * puts the other down.
 *
 * Every state update reads `previous` rather than the render's copy (ledger, A8): two taps
 * inside one task must not lose one of them.
 *
 * **No bare strings.** Every sentence is a template in `JOURNAL_COPY.proposal` with the
 * model's output dropped into slots, and the walk in `journal.test.js` names the card's
 * paths. The model writes none of the copy.
 */

/* ------------------------------------------------------------------------------------ */
/* 1. Pure: resolution, state, the body, the provenance                                   */
/* ------------------------------------------------------------------------------------ */

/** The same fold `personCandidates` uses: *Lucie* and *lucie* are one key. */
const keyOf = (text) => (
    String(text ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
);

let keyCounter = 0;
const nextKey = () => { keyCounter += 1; return `f${keyCounter}`; };

/**
 * §4.5, step by step. Exact → matched and solid, with the relationship id. Otherwise the
 * candidates are **offered** — `state: 'candidates'` — and nothing is selected; a name with
 * no candidates is `new`. Both are dashed until the user taps.
 */
export const resolvePerson = (name, relationships = []) => {
    const candidates = personCandidates(name, relationships);
    const exact = candidates.find(candidate => candidate.exact);
    if (exact) {
        return {
            key: keyOf(name), name, relationshipId: exact.relationshipId, matchName: exact.name,
            state: 'matched', candidates: [], confirmed: true
        };
    }
    return {
        key: keyOf(name), name, relationshipId: null, matchName: null,
        state: candidates.length ? 'candidates' : 'new', candidates, confirmed: false
    };
};

const liveIdOf = (candidate) => candidate.live ?? candidate.trigger?.live ?? candidate.clientId;

/**
 * §4.5b, step by step. Exact, then case- and diacritic-insensitive, against the user's
 * live triggers → resolved to the live id and shown under the vocabulary's own spelling.
 * Otherwise a new trigger, dashed; its client id is minted on the tap that keeps it.
 */
export const resolveTriggerLabel = (label, triggers = []) => {
    const hit = triggerCandidates(label, triggers)[0];
    if (hit) {
        return { key: keyOf(label), label: hit.label, live: liveIdOf(hit), isNew: false, clientId: null, confirmed: true };
    }
    return { key: keyOf(label), label, live: null, isNew: true, clientId: null, confirmed: false };
};

/**
 * The card's state from one validated proposal. Every feeling is `proposed` and not yet
 * `confirmed`; every person and trigger the proposal names is resolved once and referenced
 * by key from the chips, so a resolution flows to every chip that names it.
 */
export const cardStateFromProposal = (proposal, { relationships = [], triggers = [] } = {}) => {
    const people = [];
    const personKey = (name) => {
        const key = keyOf(name);
        if (!people.some(person => person.key === key)) people.push(resolvePerson(name, relationships));
        return key;
    };
    const triggerRows = [];
    const triggerKey = (label) => {
        const key = keyOf(label);
        if (!triggerRows.some(trigger => trigger.key === key)) triggerRows.push(resolveTriggerLabel(label, triggers));
        return key;
    };

    (proposal.people || []).forEach(person => personKey(person.name));

    const feelings = (proposal.feelings || []).map(feeling => ({
        key: nextKey(),
        id: feeling.id,
        intensity: feeling.intensity ?? DEFAULT_INTENSITY,
        uncertain: false,
        proposed: true,
        confirmed: false,
        replaces: null,
        about: (feeling.about || []).map(about => {
            if (about.kind === 'person') return { kind: 'person', person: personKey(about.name) };
            if (about.kind === 'trigger') return { kind: 'trigger', trigger: triggerKey(about.label) };
            return { kind: 'tag', tag: about.tag };
        })
    }));

    return {
        transcript: proposal.transcript ?? '',
        language: proposal.language || null,
        ambiguity: proposal.ambiguity,
        proposedIds: feelings.map(feeling => feeling.id),
        // §4.6 `conflict`: the readings are alternatives until one is picked.
        alternatives: proposal.ambiguity === 'conflict' && feelings.length > 0,
        feelings,
        people,
        triggers: triggerRows
    };
};

/**
 * A re-proposal after the transcript was edited (§4.3), laid over what the user already
 * decided: a feeling the new proposal names again keeps its confirmation, strength and
 * unsureness; a feeling the user added keeps its place; a person or trigger the user
 * resolved by hand stays resolved. Everything else is the new proposal's.
 */
export const mergeProposal = (previous, proposal, lists) => {
    const next = cardStateFromProposal(proposal, lists);

    const carriedFeelings = next.feelings.map(feeling => {
        const before = previous.feelings.find(entry => entry.id === feeling.id);
        return before
            ? { ...feeling, confirmed: before.confirmed, intensity: before.intensity, uncertain: before.uncertain, replaces: before.replaces }
            : feeling;
    });
    const added = previous.feelings.filter(entry => (
        !entry.proposed && !carriedFeelings.some(feeling => feeling.id === entry.id)
    ));

    const people = next.people.map(person => {
        const before = previous.people.find(entry => entry.key === person.key);
        return before?.confirmed && !person.confirmed ? { ...before } : person;
    });
    const triggers = next.triggers.map(trigger => {
        const before = previous.triggers.find(entry => entry.key === trigger.key);
        return before?.confirmed && !trigger.confirmed ? { ...before } : trigger;
    });

    return { ...next, feelings: [...carriedFeelings, ...added], people, triggers };
};

/**
 * What is solid, in the shape `buildCheckinRequest` takes — and nothing else. The whole of
 * invariant 15 on the card is that this function reads `confirmed` three times.
 */
export const confirmedPicked = (state) => state.feelings
    .filter(feeling => feeling.confirmed)
    .map(feeling => ({
        id: feeling.id,
        intensity: feeling.intensity,
        uncertain: feeling.uncertain === true,
        about: feeling.about.map(about => {
            if (about.kind === 'person') {
                const person = state.people.find(entry => entry.key === about.person);
                if (!person?.confirmed) return null;
                return { kind: 'person', relationshipId: person.relationshipId, name: person.name };
            }
            if (about.kind === 'trigger') {
                const trigger = state.triggers.find(entry => entry.key === about.trigger);
                if (!trigger?.confirmed) return null;
                return {
                    kind: 'trigger',
                    clientId: trigger.isNew ? trigger.clientId : trigger.live,
                    label: trigger.label,
                    isNew: trigger.isNew
                };
            }
            return { kind: 'tag', tag: about.tag };
        }).filter(Boolean)
    }));

/**
 * The `proposal` block of §6.3. `proposed` is what the model said; `accepted` is what the
 * user kept, in the card's order, additions included; `replaced` maps each proposed id the
 * user changed in place to the word that took its slot. `edited_transcript` compares the
 * saved words with the model's first transcript, so a corrected name counts as an edit
 * even after the re-proposal echoed it back.
 */
export const buildProvenance = (state, { runtime, model, promptVersion, provenance, originalTranscript }) => {
    const replaced = {};
    state.feelings.forEach(feeling => {
        if (feeling.replaces && feeling.confirmed) replaced[feeling.replaces] = feeling.id;
    });
    return {
        model: model ?? null,
        runtime: runtime ?? null,
        prompt_version: promptVersion ?? null,
        proposed: [...state.proposedIds],
        accepted: state.feelings.filter(feeling => feeling.confirmed).map(feeling => feeling.id),
        replaced,
        dropped_by_filter: provenance?.dropped_by_filter ?? 0,
        ambiguity: state.ambiguity,
        edited_transcript: state.transcript.trim() !== String(originalTranscript ?? '').trim()
    };
};

/** §4.6's sentence for the card's state, with the model's mentions dropped into the slots. */
export const ambiguitySentence = (state, mask = (name) => name) => {
    const copy = JOURNAL_COPY.proposal.ambiguity;
    switch (state.ambiguity) {
        case 'feeling':
            return copy.feeling;
        case 'conflict':
            return copy.conflict;
        case 'target': {
            const names = state.people.map(person => mask(person.name));
            const labels = state.triggers.map(trigger => trigger.label);
            const options = [...names, ...labels].map(name => fillCopy(copy.targetOption, { name }));
            return options.length ? fillCopy(copy.target, { options: options.join(', ') }) : copy.targetUnknown;
        }
        default:
            return null;
    }
};

/* ------------------------------------------------------------------------------------ */
/* 2. The reducers — every one reads `previous`                                          */
/* ------------------------------------------------------------------------------------ */

/** A7's rule: *can't tell* puts every other word down, and any other word puts it down. */
const exclusive = (feelings, keptKey) => {
    const kept = feelings.find(feeling => feeling.key === keptKey);
    if (!kept) return feelings;
    if (kept.id === UNCLEAR_FEELING_ID) return feelings.filter(feeling => feeling.key === keptKey);
    return feelings.filter(feeling => feeling.id !== UNCLEAR_FEELING_ID);
};

const withFeeling = (state, key, change) => ({
    ...state,
    feelings: state.feelings.map(feeling => (feeling.key === key ? { ...feeling, ...change(feeling) } : feeling))
});

/* ------------------------------------------------------------------------------------ */
/* 3. The pieces                                                                          */
/* ------------------------------------------------------------------------------------ */

const linkClass = 'text-[11px] font-medium text-slate-400 hover:text-slate-600 underline underline-offset-4';

/** One thing a feeling was about, dashed until what it names is resolved. */
const AboutChip = ({ about, state, picked, onKeepTrigger, onPickUp, onRemove }) => {
    const { maskName, blurClass } = useDiscretion();

    let text = '';
    let resolved = true;
    let keepable = false;
    if (about.kind === 'person') {
        const person = state.people.find(entry => entry.key === about.person);
        text = maskName(person?.name ?? '');
        resolved = person?.confirmed === true;
    } else if (about.kind === 'trigger') {
        const trigger = state.triggers.find(entry => entry.key === about.trigger);
        resolved = trigger?.confirmed === true;
        keepable = !resolved;
        text = resolved ? trigger.label : fillCopy(JOURNAL_COPY.triggers.newTrigger, { label: trigger?.label ?? '' });
    } else {
        text = about.tag;
    }
    const blur = about.kind === 'person' ? '' : blurClass;

    return (
        <span
            data-about={about.kind}
            data-resolved={resolved ? 'true' : 'false'}
            className={`${chipClass} border bg-slate-800/5 text-slate-600 ${resolved ? 'border-transparent' : 'border-dashed border-slate-300'
                } ${picked ? 'ring-2 ring-slate-400' : ''}`}
        >
            {keepable ? (
                <button
                    type="button"
                    data-trigger-keep
                    onClick={onKeepTrigger}
                    aria-label={fillCopy(JOURNAL_COPY.proposal.triggers.keep, { label: text })}
                    className={blur}
                >
                    {text}
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onPickUp}
                    aria-pressed={picked}
                    aria-label={fillCopy(JOURNAL_COPY.checkin.pickUp, { label: text })}
                    className={blur}
                >
                    {text}
                </button>
            )}
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

/** One proposed feeling: dashed until kept, then its strength, its unsureness, its abouts. */
const ProposedFeeling = ({
    feeling, state, moving, pendingTriggers, changing,
    onToggle, onChange, onCancelChange, onChangeTo, onCycleIntensity, onToggleUncertain, onRemove,
    onAddAbout, onKeepTrigger, onPickUpAbout, onRemoveAbout, onMoveHere
}) => {
    const known = feelingById(feeling.id);
    const hex = known?.hex ?? '#94a3b8';
    const label = known?.label ?? feeling.id;
    const dashed = !feeling.confirmed || feeling.uncertain === true || feeling.id === UNCLEAR_FEELING_ID;
    const [picker, setPicker] = useState(null);
    const closePicker = () => setPicker(null);
    const addAbout = (about) => { onAddAbout(feeling.key, about); closePicker(); };
    const movingFromHere = moving?.key === feeling.key;
    const copy = JOURNAL_COPY.proposal;

    return (
        <div
            data-proposed={feeling.id}
            data-confirmed={feeling.confirmed ? 'true' : 'false'}
            className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2"
        >
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    data-feeling-toggle={feeling.id}
                    aria-pressed={feeling.confirmed}
                    aria-label={fillCopy(feeling.confirmed ? copy.putDown : copy.keep, { label })}
                    onClick={() => onToggle(feeling.key)}
                    className={`${chipClass} border text-slate-700 transition-colors ${dashed ? 'border-dashed' : 'border-solid'}`}
                    style={{ borderColor: hex, backgroundColor: feeling.confirmed ? `${hex}33` : 'transparent' }}
                >
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: hex }} />
                    {label}
                    {!feeling.confirmed && (
                        <span className="tracking-[0.2em] text-slate-400" aria-hidden="true">
                            {INTENSITY_DOT.repeat(feeling.intensity)}
                        </span>
                    )}
                </button>

                {feeling.confirmed && (
                    <>
                        <button
                            type="button"
                            data-intensity={feeling.intensity}
                            onClick={() => onCycleIntensity(feeling.key)}
                            aria-label={fillCopy(JOURNAL_COPY.checkin.intensityAria, {
                                word: JOURNAL_COPY.checkin.intensity[feeling.intensity]
                            })}
                            className="px-2 h-6 min-w-[2.25rem] rounded-full border border-slate-200 bg-white text-slate-600 tracking-[0.2em] leading-none hover:border-slate-400 transition-colors"
                        >
                            {INTENSITY_DOT.repeat(feeling.intensity)}
                        </button>
                        <button
                            type="button"
                            onClick={() => onToggleUncertain(feeling.key)}
                            aria-pressed={feeling.uncertain === true}
                            aria-label={JOURNAL_COPY.checkin.uncertainLabel}
                            className={`w-6 h-6 rounded-full text-xs font-semibold border transition-colors ${feeling.uncertain === true
                                ? 'bg-slate-700 text-white border-slate-700'
                                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-400'
                                }`}
                        >
                            ≈
                        </button>
                    </>
                )}

                <button
                    type="button"
                    data-feeling-change={feeling.id}
                    onClick={() => (changing ? onCancelChange() : onChange(feeling.key))}
                    className={linkClass}
                >
                    {changing ? copy.changeCancel : copy.change}
                </button>

                <button
                    type="button"
                    onClick={() => onRemove(feeling.key)}
                    aria-label={fillCopy(JOURNAL_COPY.checkin.remove, { label })}
                    className="ml-auto p-1 rounded-full text-slate-300 hover:text-slate-600 transition-colors"
                >
                    <X size={14} />
                </button>
            </div>

            {changing && (
                <div data-change-grid={feeling.id} className="space-y-2 border-t border-slate-100 pt-2">
                    <p className="text-[11px] text-slate-400 font-light">{fillCopy(copy.changeHint, { label })}</p>
                    <FeelingGrid
                        picked={[feeling]}
                        atCap={false}
                        query=""
                        onToggle={(id) => { if (id !== feeling.id) onChangeTo(feeling.key, id); else onCancelChange(); }}
                    />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                {feeling.about.length > 0 && (
                    <span className="text-[11px] text-slate-400">{JOURNAL_COPY.checkin.aboutLabel}</span>
                )}
                {feeling.about.map((about, index) => (
                    <AboutChip
                        key={`${about.kind}-${about.person ?? about.trigger ?? about.tag}-${index}`}
                        about={about}
                        state={state}
                        picked={movingFromHere && moving.index === index}
                        onKeepTrigger={() => onKeepTrigger(about.trigger)}
                        onPickUp={() => onPickUpAbout(feeling.key, index)}
                        onRemove={() => onRemoveAbout(feeling.key, index)}
                    />
                ))}
                {moving && !movingFromHere && (
                    <button
                        type="button"
                        data-move-here={feeling.id}
                        onClick={() => onMoveHere(feeling.key)}
                        className={`${chipClass} border border-dashed border-slate-400 text-slate-600 hover:bg-slate-100 transition-colors`}
                    >
                        {JOURNAL_COPY.checkin.moveHere}
                    </button>
                )}
            </div>

            {state.ambiguity === 'target' && feeling.about.length === 0 && (
                <p className="text-[11px] text-slate-500 font-light" data-attach-hint>{copy.attachHint}</p>
            )}

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
                            data-add-about={`${feeling.id}:${kind}`}
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

/** One person the model heard, with §4.5's resolution state and the taps that settle it. */
const PersonRow = ({ person, relationships, onKeepNew, onPickExisting }) => {
    const { maskName } = useDiscretion();
    const [picking, setPicking] = useState(false);
    const copy = JOURNAL_COPY.proposal.people;
    const name = maskName(person.name);

    let sentence;
    if (person.state === 'matched') sentence = fillCopy(copy.matches, { name, match: maskName(person.matchName) });
    else if (person.confirmed && person.relationshipId != null) sentence = fillCopy(copy.linked, { name, match: maskName(person.matchName) });
    else if (person.confirmed) sentence = fillCopy(copy.added, { name });
    else sentence = fillCopy(copy.newPerson, { name });

    const settled = person.confirmed;

    return (
        <div
            data-person={person.key}
            data-person-state={person.state}
            data-person-confirmed={settled ? 'true' : 'false'}
            className="space-y-2"
        >
            <div className="flex flex-wrap items-center gap-2">
                {settled ? (
                    <span className={`${chipClass} border border-transparent bg-slate-800/5 text-slate-700`}>{sentence}</span>
                ) : (
                    <button
                        type="button"
                        data-person-keep-new
                        onClick={() => onKeepNew(person.key)}
                        aria-label={fillCopy(copy.keepNew, { name })}
                        className={`${chipClass} border border-dashed border-slate-300 bg-white text-slate-500 hover:border-slate-500 transition-colors`}
                    >
                        {sentence}
                    </button>
                )}
                {!settled && (
                    <button
                        type="button"
                        data-person-pick-existing
                        onClick={() => setPicking(open => !open)}
                        className={linkClass}
                    >
                        {copy.pickExisting}
                    </button>
                )}
            </div>

            {!settled && person.state === 'candidates' && (
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-400 font-light">{copy.candidateHint}</span>
                    {person.candidates.map(candidate => (
                        <button
                            key={candidate.relationshipId}
                            type="button"
                            data-person-candidate={candidate.relationshipId}
                            onClick={() => onPickExisting(person.key, candidate.relationshipId, candidate.name)}
                            className={`${chipClass} border border-dashed border-slate-300 bg-white text-slate-600 hover:border-slate-500 transition-colors`}
                        >
                            {fillCopy(copy.candidate, { candidate: maskName(candidate.name) })}
                        </button>
                    ))}
                </div>
            )}

            {!settled && picking && (
                <div className="flex flex-wrap gap-2">
                    {relationships.map(relationship => (
                        <button
                            key={relationship.ID}
                            type="button"
                            data-person-existing={relationship.ID}
                            onClick={() => { onPickExisting(person.key, relationship.ID, relationship.name); setPicking(false); }}
                            className={`${chipClass} border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors`}
                        >
                            {maskName(relationship.name)}
                        </button>
                    ))}
                </div>
            )}

            {!settled && (
                <p className="text-[11px] text-slate-400 font-light">{copy.unresolved}</p>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------------------------ */
/* 4. The card                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * @param result the `propose` envelope — `{ ok, proposal, provenance, runtime, mode }`.
 * @param context what the proposal was made against; the re-proposal uses the same.
 * @param runtime the runtime that answered, for the text-mode re-run after an edit. One
 *   that does not take text leaves the edit standing and the chips as they are.
 * @param source `{ model, promptVersion }` for the provenance block.
 * @param onSave given the §7.2 request; rejects on failure, and the card keeps everything.
 * @param onDiscard drops everything, the transcript included (§4.4 item 6).
 * @param onRerecord §4.6's second exit. @param onChips the third, with the words.
 */
export default function ProposalCard({
    result, context, runtime, source = {}, onSave, onDiscard, onRerecord, onChips
}) {
    const { relationships } = useSubjects();
    const { triggers } = useJournal();
    const { blurClass, maskName } = useDiscretion();
    const copy = JOURNAL_COPY.proposal;

    const [state, setState] = useState(() => cardStateFromProposal(result.proposal, { relationships, triggers }));
    const [latest, setLatest] = useState(result);
    const originalTranscript = useRef(result.proposal.transcript);
    const lastProposedText = useRef(result.proposal.transcript);
    const transcriptBox = useRef(null);

    const [grid, setGrid] = useState(() => result.proposal.ambiguity === 'feeling');
    const [query, setQuery] = useState('');
    const [changing, setChanging] = useState(null);
    const [moving, setMoving] = useState(null);
    const [exits, setExits] = useState(() => result.proposal.ambiguity !== 'none');
    const [rerunning, setRerunning] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    /* ---- the transcript, and the re-proposal an edit triggers (§4.3) ------------------ */

    const editTranscript = (text) => setState(previous => ({ ...previous, transcript: text }));

    const rerun = useCallback(async (text) => {
        if (text.trim() === lastProposedText.current.trim()) return;
        lastProposedText.current = text;
        if (!text.trim() || !runtime) return;

        setRerunning(true);
        const next = await propose(textInput(text), context, runtime);
        setRerunning(false);
        // A runtime that does not take text, or that failed: the edit stands, the chips
        // stay, and nothing on the card claims otherwise.
        if (!next.ok) return;

        setLatest(next);
        setState(previous => mergeProposal(previous, next.proposal, { relationships, triggers }));
        setGrid(open => open || next.proposal.ambiguity === 'feeling');
    }, [context, runtime, relationships, triggers]);

    /* ---- feelings ------------------------------------------------------------------- */

    const toggleFeeling = (key) => {
        setMoving(null);
        setState(previous => {
            const feeling = previous.feelings.find(entry => entry.key === key);
            if (!feeling) return previous;
            if (feeling.confirmed) {
                // Tapping again removes it (§4.4 item 2).
                return { ...previous, feelings: previous.feelings.filter(entry => entry.key !== key) };
            }
            const kept = previous.feelings.map(entry => (entry.key === key ? { ...entry, confirmed: true } : entry));
            return { ...previous, feelings: exclusive(kept, key) };
        });
    };

    const addFromGrid = (id) => {
        setMoving(null);
        setState(previous => {
            const existing = previous.feelings.find(entry => entry.id === id);
            if (existing) {
                return { ...previous, feelings: previous.feelings.filter(entry => entry.key !== existing.key) };
            }
            const others = previous.feelings.filter(entry => entry.id !== UNCLEAR_FEELING_ID);
            if (id !== UNCLEAR_FEELING_ID && others.length >= MAX_FEELINGS_PER_CHECKIN) return previous;
            const fresh = {
                key: nextKey(), id, intensity: DEFAULT_INTENSITY, uncertain: false,
                proposed: false, confirmed: true, replaces: null, about: []
            };
            return { ...previous, feelings: exclusive([...(id === UNCLEAR_FEELING_ID ? [] : others), fresh], fresh.key) };
        });
    };

    const changeTo = (key, id) => {
        setChanging(null);
        setState(previous => {
            if (previous.feelings.some(entry => entry.id === id)) return previous;
            const changed = previous.feelings.map(entry => (entry.key === key
                ? { ...entry, id, confirmed: true, replaces: entry.replaces ?? (entry.proposed ? entry.id : null) }
                : entry));
            return { ...previous, feelings: exclusive(changed, key) };
        });
    };

    const pickAlternative = (key) => {
        setState(previous => ({
            ...previous,
            alternatives: false,
            feelings: exclusive(
                previous.feelings.filter(entry => entry.key === key || !entry.proposed)
                    .map(entry => (entry.key === key ? { ...entry, confirmed: true } : entry)),
                key
            )
        }));
    };

    const cycleIntensity = (key) => setState(previous => withFeeling(previous, key, feeling => ({ intensity: nextIntensity(feeling.intensity) })));
    const toggleUncertain = (key) => setState(previous => withFeeling(previous, key, feeling => ({ uncertain: feeling.uncertain !== true })));
    const removeFeeling = (key) => {
        setMoving(null);
        setState(previous => ({ ...previous, feelings: previous.feelings.filter(entry => entry.key !== key) }));
    };

    /* ---- abouts, people, triggers ---------------------------------------------------- */

    const addAbout = (key, pick) => setState(previous => {
        let next = previous;
        let about;
        if (pick.kind === 'person') {
            const personKey = pick.relationshipId != null ? `id:${pick.relationshipId}` : keyOf(pick.name);
            const known = previous.people.find(entry => (
                pick.relationshipId != null ? entry.relationshipId === pick.relationshipId : entry.key === personKey
            ));
            if (!known) {
                next = {
                    ...next,
                    people: [...next.people, {
                        key: personKey, name: pick.name, relationshipId: pick.relationshipId,
                        matchName: pick.relationshipId != null ? pick.name : null,
                        state: pick.relationshipId != null ? 'matched' : 'new', candidates: [], confirmed: true
                    }]
                };
            }
            about = { kind: 'person', person: known?.key ?? personKey };
        } else if (pick.kind === 'trigger') {
            const known = previous.triggers.find(entry => (
                pick.isNew ? entry.clientId === pick.clientId : entry.live === pick.clientId
            ));
            const triggerKey = known?.key ?? (pick.isNew ? `new:${pick.clientId}` : `live:${pick.clientId}`);
            if (!known) {
                next = {
                    ...next,
                    triggers: [...next.triggers, {
                        key: triggerKey, label: pick.label, live: pick.isNew ? null : pick.clientId,
                        isNew: pick.isNew === true, clientId: pick.isNew ? pick.clientId : null, confirmed: true
                    }]
                };
            }
            about = { kind: 'trigger', trigger: triggerKey };
        } else {
            about = { kind: 'tag', tag: pick.tag };
        }
        return withFeeling(next, key, feeling => ({ about: [...feeling.about, about] }));
    });

    const removeAbout = (key, index) => {
        setMoving(null);
        setState(previous => withFeeling(previous, key, feeling => ({ about: feeling.about.filter((_, at) => at !== index) })));
    };

    const pickUpAbout = (key, index) => setMoving(previous => (
        previous?.key === key && previous.index === index ? null : { key, index }
    ));

    const moveHere = (targetKey) => {
        if (!moving) return;
        const from = moving;
        setMoving(null);
        setState(previous => {
            const sourceFeeling = previous.feelings.find(entry => entry.key === from.key);
            const chip = sourceFeeling?.about[from.index];
            if (!chip) return previous;
            return {
                ...previous,
                feelings: previous.feelings.map(entry => {
                    if (entry.key === from.key) return { ...entry, about: entry.about.filter((_, at) => at !== from.index) };
                    if (entry.key === targetKey) return { ...entry, about: [...entry.about, chip] };
                    return entry;
                })
            };
        });
    };

    /** The tap that keeps a new trigger: the client id is minted here, the row on save. */
    const keepTrigger = (triggerKey) => setState(previous => ({
        ...previous,
        triggers: previous.triggers.map(trigger => (trigger.key === triggerKey && !trigger.confirmed
            ? { ...trigger, confirmed: true, clientId: trigger.clientId ?? clientId() }
            : trigger))
    }));

    const keepNewPerson = (personKey) => setState(previous => ({
        ...previous,
        people: previous.people.map(person => (person.key === personKey
            ? { ...person, confirmed: true, state: 'new', relationshipId: null, matchName: null }
            : person))
    }));

    const pickExisting = (personKey, relationshipId, name) => setState(previous => ({
        ...previous,
        people: previous.people.map(person => (person.key === personKey
            ? { ...person, confirmed: true, relationshipId, matchName: name }
            : person))
    }));

    /* ---- save ----------------------------------------------------------------------- */

    const picked = confirmedPicked(state);

    const save = async () => {
        if (saving || picked.length === 0) return;
        setSaving(true);
        setError(null);

        // The body is the card's state (§4.4): what is solid, and nothing the model said.
        const request = buildCheckinRequest({
            picked, tags: [], note: '',
            transcript: state.transcript, language: state.language,
            keepTranscript: readKeepTranscripts()
        });
        request.payload.proposal = buildProvenance(state, {
            runtime: latest.runtime,
            model: source.model ?? null,
            promptVersion: source.promptVersion ?? null,
            provenance: latest.provenance,
            originalTranscript: originalTranscript.current
        });

        try {
            await onSave(request);
        } catch (failure) {
            // Trap 4: the card stays, with every confirmation on it.
            setError(failure?.response?.data?.error || copy.saveError);
            setSaving(false);
        }
    };

    /* ---- the pending triggers the picker offers, deduped by key ----------------------- */

    const pendingTriggers = state.triggers
        .filter(trigger => trigger.isNew && trigger.confirmed)
        .map(trigger => ({ clientId: trigger.clientId, live: trigger.clientId, label: trigger.label, isNew: true }));

    const atCap = state.feelings.length >= MAX_FEELINGS_PER_CHECKIN;
    const sentence = ambiguitySentence(state, maskName);
    const showRows = !(state.alternatives && state.ambiguity === 'conflict');

    return (
        <div className="space-y-5" data-proposal-card data-ambiguity={state.ambiguity}>
            {/* 1. The transcript — the user's words stay the headline, and stay editable. */}
            <div className="space-y-2">
                <label htmlFor="proposal-transcript" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {JOURNAL_COPY.voice.transcriptLabel}
                </label>
                <textarea
                    id="proposal-transcript"
                    ref={transcriptBox}
                    data-card-transcript
                    rows={3}
                    value={state.transcript}
                    onChange={(event) => editTranscript(event.target.value)}
                    onBlur={(event) => rerun(event.target.value)}
                    className={`w-full text-sm p-3 bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:border-slate-800 transition-colors resize-y ${blurClass}`}
                />
                <p className="text-[11px] text-slate-400 font-light">{JOURNAL_COPY.voice.transcriptHint}</p>
                {rerunning && (
                    <p role="status" className="text-sm text-slate-500 font-light flex items-center gap-2" data-card-rerunning>
                        <Loader2 size={16} className="animate-spin text-slate-400" />
                        {copy.rerunning}
                    </p>
                )}
            </div>

            {sentence && (
                <p role="status" data-ambiguity-sentence className="text-sm text-slate-700">{sentence}</p>
            )}

            {/* 2 and 3. The feelings, and what each was about. */}
            <div className="space-y-2">
                {state.feelings.length > 0 && showRows && (
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.suggested}</p>
                )}

                {!showRows && (
                    <div className="flex flex-wrap gap-2" data-alternatives>
                        {state.feelings.filter(feeling => feeling.proposed).map(feeling => {
                            const known = feelingById(feeling.id);
                            return (
                                <button
                                    key={feeling.key}
                                    type="button"
                                    data-alternative={feeling.id}
                                    onClick={() => pickAlternative(feeling.key)}
                                    aria-label={fillCopy(copy.keep, { label: known?.label ?? feeling.id })}
                                    className={`${chipClass} border border-dashed text-slate-700`}
                                    style={{ borderColor: known?.hex ?? '#94a3b8' }}
                                >
                                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: known?.hex ?? '#94a3b8' }} />
                                    {known?.label ?? feeling.id}
                                </button>
                            );
                        })}
                    </div>
                )}

                {showRows && moving && (
                    <p role="status" className="text-[11px] text-slate-500 font-light">{JOURNAL_COPY.checkin.moveHint}</p>
                )}
                {showRows && state.feelings.map(feeling => (
                    <ProposedFeeling
                        key={feeling.key}
                        feeling={feeling}
                        state={state}
                        moving={moving}
                        pendingTriggers={pendingTriggers}
                        changing={changing === feeling.key}
                        onToggle={toggleFeeling}
                        onChange={setChanging}
                        onCancelChange={() => setChanging(null)}
                        onChangeTo={changeTo}
                        onCycleIntensity={cycleIntensity}
                        onToggleUncertain={toggleUncertain}
                        onRemove={removeFeeling}
                        onAddAbout={addAbout}
                        onKeepTrigger={keepTrigger}
                        onPickUpAbout={pickUpAbout}
                        onRemoveAbout={removeAbout}
                        onMoveHere={moveHere}
                    />
                ))}

                <button
                    type="button"
                    data-add-word
                    aria-expanded={grid}
                    onClick={() => setGrid(open => !open)}
                    className={`${chipClass} border border-dashed border-slate-300 text-slate-500 hover:border-slate-500 transition-colors`}
                >
                    <Plus size={12} />
                    {grid ? copy.addWordClose : copy.addWord}
                </button>

                {grid && (
                    <div className="space-y-2" data-card-grid>
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            aria-label={JOURNAL_COPY.checkin.find}
                            placeholder={JOURNAL_COPY.checkin.find}
                            className="w-full text-sm border-b-2 border-slate-200 py-1.5 focus:border-slate-800 focus:outline-none bg-transparent transition-colors placeholder:text-slate-300 text-slate-700"
                        />
                        <FeelingGrid picked={state.feelings} atCap={atCap} query={query} onToggle={addFromGrid} />
                        <p className="text-[11px] text-slate-400 font-light">
                            {fillCopy(JOURNAL_COPY.checkin.cap, { max: MAX_FEELINGS_PER_CHECKIN })}
                            {' '}
                            {JOURNAL_COPY.checkin.unclearAlone}
                        </p>
                    </div>
                )}
            </div>

            {/* 4. People, with their resolution state. Nothing here is created until Save. */}
            {state.people.length > 0 && (
                <div className="space-y-3" data-card-people>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{copy.people.heading}</p>
                    {state.people.map(person => (
                        <PersonRow
                            key={person.key}
                            person={person}
                            relationships={relationships}
                            onKeepNew={keepNewPerson}
                            onPickExisting={pickExisting}
                        />
                    ))}
                </div>
            )}

            {/* 6. Two buttons and one link. */}
            <div className="space-y-3 pt-2 border-t border-slate-100">
                <p className="text-[11px] text-slate-400 font-light">{copy.dashed}</p>

                {error && (
                    <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 text-sm">
                        {error}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        data-card-not-it
                        aria-expanded={exits}
                        onClick={() => setExits(true)}
                        className={linkClass}
                    >
                        {copy.notIt}
                    </button>
                    <div className="ml-auto flex gap-3">
                        <button
                            type="button"
                            data-card-discard
                            onClick={onDiscard}
                            className="px-4 py-2 text-slate-500 hover:text-slate-800 rounded-lg transition-colors"
                        >
                            {copy.discard}
                        </button>
                        <button
                            type="button"
                            data-card-save
                            onClick={save}
                            disabled={saving || picked.length === 0}
                            className="px-6 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        >
                            {saving ? copy.saving : copy.save}
                        </button>
                    </div>
                </div>

                {exits && (
                    <div className="flex flex-wrap items-center gap-3" data-card-exits>
                        <span className="text-[11px] text-slate-400 font-light">{copy.exits.heading}</span>
                        <button
                            type="button"
                            data-exit="edit"
                            onClick={() => transcriptBox.current?.focus()}
                            className={linkClass}
                        >
                            {copy.exits.edit}
                        </button>
                        <button type="button" data-exit="rerecord" onClick={onRerecord} className={linkClass}>
                            {copy.exits.rerecord}
                        </button>
                        <button
                            type="button"
                            data-exit="chips"
                            onClick={() => onChips(state.transcript)}
                            className={linkClass}
                        >
                            {copy.exits.chips}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
