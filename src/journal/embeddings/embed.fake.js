/**
 * A fake embedder, for tests. **Never imported by the app** (§5.7, and the ledger's warning
 * about `journal/inference/fake.js`): `embed.js` deliberately does not re-export it, because
 * a convenience re-export would ship a runtime that always succeeds into the production
 * chunk. Tests import this file directly and nothing else has any reason to.
 *
 * It does two jobs.
 *
 * 1. **It records what it was asked**, verbatim, in `calls` — which is how the mandatory
 *    prompt prefixes are tested. A wrong prefix has no symptom downstream; the only place it
 *    can be caught is at the boundary, on the exact string.
 * 2. **It lets a test place two texts near each other** without a model. `vectors` maps a
 *    bare text — the prefix stripped back off, so a test reads as `{ work: [...] }` — to the
 *    numbers to answer with. Anything not in the map gets a deterministic pseudo-random unit
 *    vector derived from the text, which is stable across runs and reliably *far* from
 *    everything else: two unrelated 256-dimension random directions are near-orthogonal, so
 *    "not similar" needs no configuration and only similarity has to be arranged.
 */

import { EMBEDDING_PREFIXES, INDEX_DIMS } from './embed';

/** Strip whichever prefix was applied, so a fixture can be keyed by the words themselves. */
export const withoutPrefix = (text) => {
    const value = String(text ?? '');
    for (const prefix of Object.values(EMBEDDING_PREFIXES)) {
        if (value.startsWith(prefix)) return value.slice(prefix.length);
    }
    return value;
};

/** xorshift32 — a stable, seeded generator, so a fixture means the same thing every run. */
const generator = (seed) => {
    let state = seed || 1;
    return () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        state |= 0;
        return (state >>> 0) / 4294967296;
    };
};

const seedOf = (text) => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

/** A unit vector that depends only on the text. Near-orthogonal to every other one. */
export const arbitraryVector = (text, dims = INDEX_DIMS) => {
    const next = generator(seedOf(String(text ?? '')));
    const out = new Float32Array(dims);
    let sum = 0;
    for (let i = 0; i < dims; i += 1) {
        const value = next() * 2 - 1;
        out[i] = value;
        sum += value * value;
    }
    const length = Math.sqrt(sum) || 1;
    for (let i = 0; i < dims; i += 1) out[i] /= length;
    return out;
};

/**
 * Two vectors `angle` apart, in a plane nothing else lives in — the fixture for "these two
 * words are close" and "these two words are not".
 *
 * `similarity` is the cosine the pair should have. Returns the two vectors; a test hands one
 * to the index and asks about the other.
 */
export const vectorPair = (seed, similarity, dims = INDEX_DIMS) => {
    const a = arbitraryVector(`${seed}:a`, dims);
    const b = arbitraryVector(`${seed}:b`, dims);

    // Gram-Schmidt: make `b` orthogonal to `a`, then rotate it back towards `a` by the
    // requested cosine. The arithmetic is exact, so a test can assert the number it asked for.
    let dot = 0;
    for (let i = 0; i < dims; i += 1) dot += a[i] * b[i];
    let sum = 0;
    for (let i = 0; i < dims; i += 1) {
        b[i] -= dot * a[i];
        sum += b[i] * b[i];
    }
    const length = Math.sqrt(sum) || 1;
    const sine = Math.sqrt(Math.max(0, 1 - similarity * similarity));
    const out = new Float32Array(dims);
    for (let i = 0; i < dims; i += 1) out[i] = similarity * a[i] + sine * (b[i] / length);

    return [a, out];
};

/**
 * The fake runtime itself.
 *
 * `dims` defaults to §5.8's 256 so that a test which says nothing about width still exercises
 * the width the app uses.
 */
export const createFakeEmbedder = ({
    dims = INDEX_DIMS,
    model = 'fake/embedder',
    vectors = {},
    fail = null
} = {}) => {
    const calls = [];

    return {
        id: 'fake',
        model,
        dims,
        /** Every string handed to the model, in order, prefix and all. */
        calls,
        load: async () => true,
        embed: async (texts) => {
            calls.push(...texts);
            if (fail) throw (fail instanceof Error ? fail : new Error(String(fail)));
            return texts.map(text => {
                const bare = withoutPrefix(text);
                const fixture = vectors[bare];
                return Array.from(fixture ?? arbitraryVector(bare, dims));
            });
        }
    };
};
