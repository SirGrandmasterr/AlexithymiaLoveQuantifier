import { FAILURE_KINDS, INPUT_MODES, TASKS } from './contract';
import { validateProposal, truncateTranscript } from './validate';
import { validateRitualProposal } from './ritual';
import { activeFeelings, TRIGGER_ROLES } from '../../constants/journal';
import { CONTEXT_TAGS } from '../../constants/contextTags';

/* 1. The vocabulary of outcomes */

export { RUNTIME_IDS, INPUT_MODES, FAILURE_KINDS, TASKS, InferenceError } from './contract';

const failure = (kind, message, extra = {}) => ({ ok: false, failure: { kind, message, ...extra } });

/* 2. Inputs */

/** A typed note, or an edited transcript re-proposed in text mode (§4.3). */
export const textInput = (text) => ({ kind: INPUT_MODES.text, text: String(text ?? '') });

/** One or more recorder clips. Several clips are one take and one card (§4.2). */
export const audioInput = (clips) => ({
    kind: INPUT_MODES.audio,
    clips: Array.isArray(clips) ? clips : [clips]
});

const isAudioClip = (value) => Boolean(
    value && value.audio && typeof value.audio.length === 'number' && value.audio.length > 0
);

export const normalizeInput = (input) => {
    if (typeof input === 'string') {
        return input.trim() ? textInput(input) : null;
    }
    if (!input || typeof input !== 'object') return null;

    if (input.kind === INPUT_MODES.text) {
        return input.text && String(input.text).trim() ? textInput(input.text) : null;
    }
    if (input.kind === INPUT_MODES.audio) {
        const clips = (input.clips || []).filter(isAudioClip);
        return clips.length ? { kind: INPUT_MODES.audio, clips } : null;
    }
    // A bare clip, or the recorder's `clips()` array, passed straight through.
    if (isAudioClip(input)) return audioInput([input]);
    if (Array.isArray(input)) {
        const clips = input.filter(isAudioClip);
        return clips.length ? audioInput(clips) : null;
    }
    return null;
};

/* 3. Context */

export const buildContext = ({ relationships = [], triggers = [], language = null } = {}) => ({
    feelings: activeFeelings().map(({ id, label, gloss }) => ({ id, label, gloss })),
    tags: [...CONTEXT_TAGS],
    people: uniqueStrings(relationships.map(person => person?.name ?? person?.Name ?? person)),
    triggers: uniqueStrings(triggers.map(trigger => trigger?.label ?? trigger)),
    // Which half each label is, by label — never by id (§5.1). The prompt lists things and
    // happenings apart so the model reuses each in its own slot. A label with no role is
    // listed as a thing, which is what every trigger was before roles existed.
    triggerRoles: triggerRolesOf(triggers),
    language
});

function triggerRolesOf(triggers) {
    const roles = {};
    triggers.forEach((trigger) => {
        const label = typeof trigger?.label === 'string' ? trigger.label.trim() : '';
        const role = trigger?.role;
        if (!label || !TRIGGER_ROLES.includes(role) || roles[label]) return;
        roles[label] = role;
    });
    return roles;
}

function uniqueStrings(values) {
    const seen = new Set();
    const out = [];
    values.forEach((value) => {
        if (typeof value !== 'string') return;
        const trimmed = value.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        out.push(trimmed);
    });
    return out;
}

/** A context is usable when the model can be constrained by it. */
export const isUsableContext = (context) => Boolean(
    context
    && typeof context === 'object'
    && Array.isArray(context.feelings)
    && context.feelings.length > 0
);

/* 4. The runtimes */

export { createNativeRuntime } from './native';

export { createWebRuntime } from './web';

const acceptsMode = (runtime, mode) => {
    if (Array.isArray(runtime.accepts)) return runtime.accepts.includes(mode);
    if (runtime.capabilities && typeof runtime.capabilities === 'object') {
        return Boolean(runtime.capabilities[mode]);
    }
    // A runtime that says nothing about itself is taken at its word for both modes.
    return true;
};

/* 5. propose */

export const propose = async (input, context, runtime) => {
    if (!runtime || typeof runtime.propose !== 'function') {
        return failure(FAILURE_KINDS.unavailable, 'no inference runtime was supplied');
    }

    const normalized = normalizeInput(input);
    if (!normalized) {
        return failure(FAILURE_KINDS.input, 'input is neither audio nor text', { runtime: runtime.id ?? null });
    }
    if (!isUsableContext(context)) {
        return failure(FAILURE_KINDS.context, 'context carries no feeling vocabulary', { runtime: runtime.id ?? null });
    }
    if (!acceptsMode(runtime, normalized.kind)) {
        return failure(
            FAILURE_KINDS.unavailable,
            `this runtime does not take ${normalized.kind}`,
            { runtime: runtime.id ?? null, mode: normalized.kind }
        );
    }

    const startedAt = Date.now();
    let raw;
    try {
        raw = await runtime.propose({ ...normalized, context });
    } catch (cause) {
        // The one place a runtime's exception is allowed to end. Everything above this line
        // sees a value; nothing above it sees a throw.
        return failure(FAILURE_KINDS.failed, cause?.message || 'the runtime failed', {
            runtime: runtime.id ?? null,
            mode: normalized.kind,
            cause
        });
    }

    if (raw === null || raw === undefined) {
        return failure(FAILURE_KINDS.empty, 'the runtime returned nothing', {
            runtime: runtime.id ?? null,
            mode: normalized.kind
        });
    }

    // In text mode the words are the input, so the quotes are read against the input rather
    // than against whatever the model echoed back as the transcript.
    const { proposal, provenance } = validateProposal(
        raw,
        context,
        normalized.kind === INPUT_MODES.text ? { transcript: normalized.text } : {}
    );

    if (normalized.kind === INPUT_MODES.text) {
        proposal.transcript = truncateTranscript(normalized.text);
    }

    return {
        ok: true,
        proposal,
        provenance,
        runtime: runtime.id ?? null,
        mode: normalized.kind,
        durationMs: Date.now() - startedAt
    };
};

/* 6. proposeRitual */

export const proposeRitual = async (input, context, runtime, questions = []) => {
    if (!runtime || typeof runtime.propose !== 'function') {
        return failure(FAILURE_KINDS.unavailable, 'no inference runtime was supplied');
    }
    if (!Array.isArray(questions) || questions.length === 0) {
        return failure(FAILURE_KINDS.context, 'the ritual has no questions to ask', { runtime: runtime.id ?? null });
    }

    const normalized = normalizeInput(input);
    if (!normalized) {
        return failure(FAILURE_KINDS.input, 'input is neither audio nor text', { runtime: runtime.id ?? null });
    }
    if (!acceptsMode(runtime, normalized.kind)) {
        return failure(
            FAILURE_KINDS.unavailable,
            `this runtime does not take ${normalized.kind}`,
            { runtime: runtime.id ?? null, mode: normalized.kind }
        );
    }

    const startedAt = Date.now();
    let raw;
    try {
        raw = await runtime.propose({ ...normalized, context, task: TASKS.ritual, questions });
    } catch (cause) {
        return failure(FAILURE_KINDS.failed, cause?.message || 'the runtime failed', {
            runtime: runtime.id ?? null,
            mode: normalized.kind,
            cause
        });
    }

    if (raw === null || raw === undefined) {
        return failure(FAILURE_KINDS.empty, 'the runtime returned nothing', {
            runtime: runtime.id ?? null,
            mode: normalized.kind
        });
    }

    const { proposal, provenance } = validateRitualProposal(raw, { questions });

    // The same rule as `propose`: in text mode the words are the input, echoed rather than
    // taken back from the model (§5.2).
    if (normalized.kind === INPUT_MODES.text) {
        proposal.transcript = truncateTranscript(normalized.text);
    }

    return {
        ok: true,
        proposal,
        provenance,
        runtime: runtime.id ?? null,
        mode: normalized.kind,
        durationMs: Date.now() - startedAt
    };
};
