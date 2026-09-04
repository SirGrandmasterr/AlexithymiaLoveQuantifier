/**
 * Getting an object out of what a model actually emits.
 *
 * On Android the runtime is handed the §5.2 schema and cannot produce tokens outside it, so
 * this module has nothing to do there but `JSON.parse`. On the web there is **no grammar** —
 * verified on 2026-09-02 against `@huggingface/transformers` 4.2.0, which ships fourteen
 * logits processors and not one of them constrains to a schema (§5.2's `(verify)`, now
 * closed) — so what comes back is a string that is *usually* JSON, and the difference
 * between usually and always is this file.
 *
 * **It repairs framing, never content.** Fences, a leading *"Here is the JSON:"*, prose after
 * the closing brace: those are the model failing to follow the eighth prompt rule, and
 * dropping them changes nothing about what was proposed. What it will not do is guess at a
 * missing field, coerce a type, or close an unbalanced brace — a truncated object is a
 * proposal nobody made, and `validateProposal` turning it into `ambiguity: "feeling"` is the
 * honest outcome (§4.6). Every repair is counted and travels beside the proposal, so D4's
 * eval report can say how often the web path needed one.
 */

/** What had to be done to the model's output before it was an object. Counted, not hidden. */
export const REPAIRS = {
    /** ```json … ``` — the most common single failure, and the cheapest to undo. */
    fence: 'fence',
    /** Prose before `{` or after the matching `}`. */
    prose: 'prose'
};

const FENCE = /^\s*```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/;

/**
 * The first balanced `{…}` in a string, respecting strings and escapes.
 *
 * A brace counter that does not know about `"` reads the `}` in a transcript of *"she said
 * }"* as the end of the object. That is not a hypothetical: the transcript field carries
 * whatever was said, and this is the one place a user's own words could break the parse.
 */
export const firstObject = (text) => {
    const start = text.indexOf('{');
    if (start < 0) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let at = start; at < text.length; at += 1) {
        const ch = text[at];

        if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }

        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return text.slice(start, at + 1);
        }
    }

    // Unbalanced: the generation was cut off, or the model wrote something that is not an
    // object at all. Both are refusals, and neither is repairable from here.
    return null;
};

/**
 * Parse one model answer.
 *
 * Returns `{ value, repairs }` on success and `{ value: null, repairs, error }` on failure.
 * A failure is a value the caller renders, not an exception it catches — the same rule the
 * whole boundary is written to (`index.js` §1).
 */
export const parseModelJson = (raw) => {
    const repairs = [];
    const text = String(raw ?? '');

    let body = text;
    const fenced = FENCE.exec(body);
    if (fenced) {
        body = fenced[1];
        repairs.push(REPAIRS.fence);
    }

    const trimmed = body.trim();
    let candidate = trimmed;
    if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) {
        candidate = firstObject(body);
        if (candidate === null) {
            return { value: null, repairs, error: 'the answer contains no complete JSON object' };
        }
        repairs.push(REPAIRS.prose);
    }

    try {
        const value = JSON.parse(candidate);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return { value: null, repairs, error: 'the answer is not a JSON object' };
        }
        return { value, repairs };
    } catch (cause) {
        return { value: null, repairs, error: cause?.message || 'the answer is not valid JSON' };
    }
};
