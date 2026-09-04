import { EMBEDDING_GEMMA_ONNX, EMBEDDING_MODEL, MODEL_BASE_PATH } from '../inference/models';

/* 1. The contract */

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

export const prefixed = (text, kind = EMBED_KINDS.document) => {
    const prefix = EMBEDDING_PREFIXES[kind];
    if (!prefix) throw new Error(`unknown embedding kind: ${String(kind)}`);
    return `${prefix}${String(text ?? '').trim()}`;
};

/* 2. Truncation and normalisation */

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

/* 3. The boundary */

const asTexts = (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    return list.map(text => String(text ?? '').trim()).filter(Boolean);
};

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

/* 4. The browser's embedder */

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
