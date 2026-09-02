/**
 * The boundary every model in this phase plugs into, and the only thing above it that any
 * screen may call.
 *
 *     propose(input, context, runtime) → Promise<ProposalResult>
 *
 * `input` is audio or text, `context` carries the closed vocabularies plus the user's own
 * relationship names and trigger labels, and **`runtime` is injected** — never imported,
 * never looked up from a registry, never a module-level singleton. That one decision is what
 * keeps `npm test` free of model weights (§5.7): a component test passes
 * `createFakeRuntime(fixtures)` and the suite never loads 2.6 GB to find out whether a chip
 * renders. A test suite that needs weights to run is a test suite that stops being run.
 *
 * It is also what keeps the tiers honest. The Full tier is one runtime, the Light tier is
 * another, the text-only tier is the *absence* of one — and "no runtime" is then an ordinary
 * value this function handles, rather than a branch scattered through the screens. Since C4
 * there are two real runtimes behind the same seam — `web.js` in a browser, `native.js` in
 * the Android shell — and nothing above this line can tell them apart.
 *
 * **Two deliberate departures from §5.7's one-line sketch, both stated so a later session can
 * reverse them in one place:**
 *
 * 1. §5.7 writes the return type as `Promise<Proposal>`. What resolves here is a *result
 *    envelope* — `{ ok: true, proposal }` or `{ ok: false, failure }` — because a runtime
 *    that fails is something the card has to *render* (§4.6 gives it copy), not something it
 *    has to catch. A rejected promise turns a normal outcome into control flow, and the one
 *    caller that forgets a `try` shows the user a stack trace. Nothing thrown by a runtime
 *    escapes this function.
 * 2. The fake runtime is **not re-exported** from here. `index.js` is in the app's import
 *    graph; `fake.js` must not be. Tests import `./fake` directly.
 *
 * Since D1, **everything a runtime returns passes through `validateProposal`** (`validate.js`)
 * before it leaves this function. A runtime's output is never handed to a caller as it came:
 * what comes out is schema-valid and forbidden-word-free, a proposal that could not be used
 * has become `ambiguity: "feeling"`, and the filter's counts travel beside it as
 * `provenance`. In text mode the transcript is the input, echoed here rather than trusted
 * from the model (§5.2) — the one place the user's own words could otherwise be rewritten.
 */

import { FAILURE_KINDS, INPUT_MODES, TASKS } from './contract';
import { validateProposal, truncateTranscript } from './validate';
import { validateRitualProposal } from './ritual';
import { activeFeelings } from '../../constants/journal';
import { CONTEXT_TAGS } from '../../constants/contextTags';

/* ------------------------------------------------------------------------------------ */
/* 1. The vocabulary of outcomes                                                          */
/* ------------------------------------------------------------------------------------ */

// The vocabulary lives in `contract.js` so that `index.js` can re-export the real
// `createWebRuntime` from `web.js` without the two files importing each other. It is
// re-exported here, so every existing `from './index'` import keeps working.
export { RUNTIME_IDS, INPUT_MODES, FAILURE_KINDS, TASKS, InferenceError } from './contract';

const failure = (kind, message, extra = {}) => ({ ok: false, failure: { kind, message, ...extra } });

/* ------------------------------------------------------------------------------------ */
/* 2. Inputs                                                                              */
/* ------------------------------------------------------------------------------------ */

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

/**
 * Accept the shapes a caller plausibly has to hand, and refuse everything else by name.
 *
 * The sample rate is checked for being a positive number and then carried, not enforced:
 * 16 kHz is the recorder's promise to the model (§4.2), and re-asserting it here would put
 * the same rule in two places where it can disagree with itself.
 */
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

/* ------------------------------------------------------------------------------------ */
/* 3. Context                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * The context a proposal is made against: the two closed vocabularies, and the user's own
 * words for their people and their triggers.
 *
 * **No relationship id and no trigger id goes in, ever** (§5.1). The model emits surface
 * strings only — a name, a label — and the client resolves them (§4.5, §4.5b). A model that
 * could name an id could hallucinate a merge, and a merge is the one journal operation that
 * is not a new row but a rewriting of what the old ones meant. Feeling ids are the exception
 * that proves the rule: they are the app's own closed enum, the model is constrained to them
 * by §5.2's schema, and there is nothing for it to invent.
 */
export const buildContext = ({ relationships = [], triggers = [], language = null } = {}) => ({
    feelings: activeFeelings().map(({ id, label, gloss }) => ({ id, label, gloss })),
    tags: [...CONTEXT_TAGS],
    people: uniqueStrings(relationships.map(person => person?.name ?? person?.Name ?? person)),
    triggers: uniqueStrings(triggers.map(trigger => trigger?.label ?? trigger)),
    language
});

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

/* ------------------------------------------------------------------------------------ */
/* 4. The runtimes                                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * The Android plugin's runtime — Whisper tiny through the native plugin (§5.5), built in
 * C4; D3 puts Gemma 4 E2B behind the same plugin's `propose`. `native.js` is where it
 * lives and what it promises. Re-exported for the same reason the web one is: the module
 * that talks to the bridge stays in the graph of a caller that asks for it.
 */
export { createNativeRuntime } from './native';

/**
 * The browser's runtime — Whisper tiny through transformers.js, served from this app's own
 * origin (§5.5, §5.6). Built in C3; `web.js` is where it lives and what it promises.
 *
 * Re-exported rather than defined here so that the heavy module is only in the graph of a
 * caller that actually asks for it, and so the transformers.js import inside it stays the
 * dynamic one it has to be.
 */
export { createWebRuntime } from './web';

const acceptsMode = (runtime, mode) => {
    if (Array.isArray(runtime.accepts)) return runtime.accepts.includes(mode);
    if (runtime.capabilities && typeof runtime.capabilities === 'object') {
        return Boolean(runtime.capabilities[mode]);
    }
    // A runtime that says nothing about itself is taken at its word for both modes.
    return true;
};

/* ------------------------------------------------------------------------------------ */
/* 5. propose                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * Ask a runtime for a proposal.
 *
 * Nothing here touches the network — not `axios`, not `fetch`, not a worker that could. The
 * weights are local or they do not exist, and a test asserts the zero (§5.7, §10.2). That is
 * the whole reason this function is the only door: one place to look at to know the claim on
 * the Vault page is true of the code as written.
 */
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

    // The filter. Anything that fails it becomes `ambiguity: "feeling"` (§4.6) rather than
    // an error the user sees, and `raw` is not carried past this line: a caller that wanted
    // the unfiltered output would be a caller that could render it.
    const { proposal, provenance } = validateProposal(raw, context);

    // In text mode the transcript is the input, echoed and ignored (§5.2). The words came
    // from the user — typed, or transcribed and then edited — and the model is not given a
    // way to change them on their way back.
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

/* ------------------------------------------------------------------------------------ */
/* 6. proposeRitual                                                                       */
/* ------------------------------------------------------------------------------------ */

/**
 * The ritual in one breath (§3.7) — the same door, the same runtime, a different task.
 *
 * It is a second function rather than a flag on `propose` because what comes back is a
 * different object: a map of answers, not a list of feelings, and a different validator has
 * to read it. Everything else is deliberately identical, including the rule that a runtime's
 * exception ends here and a caller only ever sees a value.
 *
 * **Full tier only.** The Light and text-only tiers keep the swipe cards as their whole
 * ritual (§3.7), and a runtime that does not take audio is refused here by the same
 * `acceptsMode` check every other call goes through — which is what makes "the swipe cards
 * remain the only path" a property of the code rather than of the screen that usually
 * respects it.
 */
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
