/** What had to be done to the model's output before it was an object. Counted, not hidden. */
export const REPAIRS = {
    /** ```json … ``` — the most common single failure, and the cheapest to undo. */
    fence: 'fence',
    /** Prose before `{` or after the matching `}`. */
    prose: 'prose'
};

const FENCE = /^\s*```(?:json|JSON)?\s*\r?\n([\s\S]*?)\r?\n?\s*```\s*$/;

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
