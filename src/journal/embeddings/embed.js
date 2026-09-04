/**
 * The embedding boundary: one model, two mandatory prefixes, and 256 numbers.
 *
 *     embedTexts(texts, { kind, runtime }) → Promise<EmbedResult>
 *
 * The shape is `propose`'s on purpose (`journal/inference/index.js`). `runtime` is
 * **injected** — never imported here, never a module-level singleton — which is what keeps
 * `npm test` free of 219 MB of weights (§5.7): every test passes `createFakeEmbedder()` and
 * the suite never opens an ONNX session. What resolves is a result envelope, `{ ok: true,
 * vectors }` or `{ ok: false, failure }`, because a device that has not downloaded the model
 * is an ordinary state a screen renders rather than an exception it has to catch.
 *
 * **The two prefixes are not optional and not cosmetic.** EmbeddingGemma was trained with
 * them and a vector produced without them is a different point in a different space — it
 * still has 256 numbers, still scans, still ranks, and is quietly worse at everything. There
 * is no error to notice, which is exactly why `prefixed()` is the only way to build the text
 * that reaches the model and why `embed.test.js` asserts the strings byte for byte:
 *
 *   - a query  — the label the card is asking about — is `task: search result | query: …`
 *   - a stored entry — a trigger label already in the vocabulary — is `title: none | text: …`
 *
 * The trailing space in each is part of the prefix, from the upstream model card.
 *
 * **256 dimensions, by Matryoshka truncation** (§5.8). The model emits 768; the first 256 of
 * them are a usable embedding on their own, which is the property Matryoshka Representation
 * Learning trains for — and after truncation the vector has to be **re-normalised**, or the
 * lengths of two truncated vectors differ by how much of their mass the tail carried and
 * cosine stops being cosine. A quarter of the storage, for short colloquial sentences that
 * do not need the tail.
 *
 * Vectors are unit length when they leave this module, which is what lets the scan in
 * `similar.js` be a dot product and still be a cosine.
 */

import { EMBEDDING_GEMMA_ONNX, EMBEDDING_MODEL, MODEL_BASE_PATH } from '../inference/models';

/* ------------------------------------------------------------------------------------ */
/* 1. The contract                                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * The two prompt prefixes EmbeddingGemma requires, verbatim, trailing space included.
 *
 * Frozen because they are a property of the weights, not a preference of this app: changing
 * one is changing the model, and every vector already on the device would be stale in a way
 * the `model` field could not detect.
 */
export const EMBEDDING_PREFIXES = Object.freeze({
    /** What is being looked up — the label the card has in hand and no trigger for. */
    query: 'task: search result | query: ',
    /** What is stored — a trigger label already in the user's vocabulary. */
    document: 'title: none | text: '
});

/** Which side of the comparison a text is on. Nothing else is a valid `kind`. */
export const EMBED_KINDS = Object.freeze({ query: 'query', document: 'document' });

/** §5.8's planned width: enough for short colloquial sentences, a quarter of the storage. */
export const INDEX_DIMS = 256;

/** Why an embedding did not happen. Each is something a screen can simply not draw. */
export const EMBED_FAILURES = Object.freeze({
    /** No runtime, or the model is not on this device. The default state, and not an error. */
    unavailable: 'embedder_unavailable',
    /** There was a runtime and it threw. The original error travels on `cause`. */
    failed: 'embedder_failed',
    /** Nothing to embed, or a `kind` that is neither of the two. */
    input: 'invalid_input',
    /** The runtime answered with the wrong number of vectors, or vectors of the wrong width. */
    shape: 'invalid_output'
});

const failure = (kind, message, extra = {}) => ({ ok: false, failure: { kind, message, ...extra } });

/**
 * The one way to build the text a model sees.
 *
 * Exported, and the only export that produces model input, so that "the prefixes are
 * applied" is a property of one function rather than of every call site.
 */
export const prefixed = (text, kind = EMBED_KINDS.document) => {
    const prefix = EMBEDDING_PREFIXES[kind];
    if (!prefix) throw new Error(`unknown embedding kind: ${String(kind)}`);
    return `${prefix}${String(text ?? '').trim()}`;
};

/* ------------------------------------------------------------------------------------ */
/* 2. Truncation and normalisation                                                        */
/* ------------------------------------------------------------------------------------ */

/**
 * 768 → 256, re-normalised. Returns a `Float32Array`, which is what the index stores.
 *
 * A vector shorter than `dims` is taken as it is rather than padded: padding with zeros
 * would produce a vector of the right width whose geometry is a lie, and the caller that
 * handed over a short vector has a bug worth seeing in the width rather than hiding.
 *
 * A zero vector normalises to itself. It cannot be compared with anything — every cosine
 * against it is 0 — which is the correct answer for "no direction at all" and is why this
 * does not divide by zero and does not throw.
 */
export const toIndexVector = (values, dims = INDEX_DIMS) => {
    const source = values instanceof Float32Array ? values : Float32Array.from(values ?? []);
    const width = Math.min(dims, source.length);
    const out = new Float32Array(width);

    let sum = 0;
    for (let i = 0; i < width; i += 1) {
        const value = source[i];
        out[i] = value;
        sum += value * value;
    }

    const length = Math.sqrt(sum);
    if (length > 0) {
        for (let i = 0; i < width; i += 1) out[i] /= length;
    }
    return out;
};

/* ------------------------------------------------------------------------------------ */
/* 3. The boundary                                                                        */
/* ------------------------------------------------------------------------------------ */

const asTexts = (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    return list.map(text => String(text ?? '').trim()).filter(Boolean);
};

/**
 * Embed one or more texts as queries or as stored entries.
 *
 * The `kind` applies to the whole call, because a batch that mixed the two would be a batch
 * whose prefixes nobody could check by reading the call site. Two kinds, two calls.
 *
 * Nothing a runtime throws escapes this function.
 */
export const embedTexts = async (texts, { kind = EMBED_KINDS.document, runtime = null } = {}) => {
    if (!EMBEDDING_PREFIXES[kind]) {
        return failure(EMBED_FAILURES.input, `unknown embedding kind: ${String(kind)}`);
    }

    const clean = asTexts(texts);
    if (clean.length === 0) return failure(EMBED_FAILURES.input, 'nothing to embed');

    if (!runtime || typeof runtime.embed !== 'function') {
        return failure(EMBED_FAILURES.unavailable, 'no embedding runtime on this device');
    }

    const dims = Number.isInteger(runtime.dims) && runtime.dims > 0 ? runtime.dims : INDEX_DIMS;

    let raw;
    try {
        raw = await runtime.embed(clean.map(text => prefixed(text, kind)));
    } catch (error) {
        return failure(EMBED_FAILURES.failed, error?.message || 'the embedder threw', { cause: error });
    }

    if (!Array.isArray(raw) || raw.length !== clean.length) {
        return failure(EMBED_FAILURES.shape, 'the embedder answered with the wrong number of vectors');
    }

    const vectors = raw.map(values => toIndexVector(values, dims));
    if (vectors.some(vector => vector.length !== dims)) {
        return failure(EMBED_FAILURES.shape, `the embedder answered with vectors narrower than ${dims}`);
    }

    return {
        ok: true,
        model: runtime.model ?? EMBEDDING_MODEL.id,
        dims,
        texts: clean,
        vectors
    };
};

/* ------------------------------------------------------------------------------------ */
/* 4. The browser's embedder                                                              */
/* ------------------------------------------------------------------------------------ */

/**
 * EmbeddingGemma 300m through transformers.js, on this device.
 *
 * `AutoModel` rather than a pipeline, because the export's useful output is the
 * `sentence_embedding` tensor the upstream card documents — the pooled, dense-projected,
 * unit-length 768 the model was trained to produce — and a `feature-extraction` pipeline
 * would hand back the token states and leave the pooling to be re-invented here.
 *
 * The heavy import is **dynamic**, exactly as `web.js`'s is: a user who never turns
 * similar-entry suggestions on never fetches a byte of the library on this path, and
 * `npm test` never reaches the line at all because every test injects a fake.
 *
 * `configureEnvironment` is the same function the two proposal runtimes use, so the four
 * things that make the Vault page true — no remote models, this origin's `/models/`, the
 * verified cache, same-origin WASM — hold here without being restated and without being
 * able to drift.
 *
 * WASM and not WebGPU: this is a 300M model over a handful of two-word labels, the WebGPU
 * adapter is the Full tier's and may not exist, and a backend that has to be present for a
 * feature to work is a reason for the feature not to work.
 */
export const createWebEmbedder = (options = {}) => {
    const {
        model = EMBEDDING_GEMMA_ONNX,
        modelId = EMBEDDING_MODEL.id,
        dims = INDEX_DIMS,
        cache = null,
        // Injected so the runtime can be exercised without the real library.
        loadModel = null
    } = options;

    let session = null;
    let loading = null;

    const load = async (onProgress) => {
        if (session) return session;
        if (loading) return loading;

        loading = (async () => {
            if (loadModel) {
                session = await loadModel({ model, cache, onProgress });
                return session;
            }

            const transformers = await import('@huggingface/transformers');
            const { configureEnvironment } = await import('../inference/web');
            const { createVerifiedCache } = await import('../inference/download');

            configureEnvironment(transformers.env, {
                cache: cache || createVerifiedCache(),
                device: 'wasm'
            });

            const [tokenizer, weights] = await Promise.all([
                transformers.AutoTokenizer.from_pretrained(model.id),
                transformers.AutoModel.from_pretrained(model.id, {
                    dtype: model.dtype,
                    device: 'wasm',
                    progress_callback: onProgress
                })
            ]);

            session = { tokenizer, model: weights };
            return session;
        })();

        try {
            return await loading;
        } finally {
            loading = null;
        }
    };

    return {
        id: 'web',
        /** The upstream model, not the export: it is what a stored vector records (§5.8). */
        model: modelId,
        dims,
        /** Where the weights come from, named once so a screen can say it out loud. */
        basePath: MODEL_BASE_PATH,

        /** Warm the weights without asking them anything. The settings screen uses it. */
        load,

        /**
         * Texts in, one array of numbers out per text. **Already prefixed** by `embedTexts`:
         * this function adds nothing and must not, or the prefix would be applied twice on
         * one path and once on another.
         */
        embed: async (texts) => {
            const { tokenizer, model: weights } = await load();
            const inputs = await tokenizer(texts, { padding: true });
            const output = await weights(inputs);
            const tensor = output?.sentence_embedding;
            if (!tensor) throw new Error('the model returned no sentence_embedding');
            return tensor.tolist();
        }
    };
};
