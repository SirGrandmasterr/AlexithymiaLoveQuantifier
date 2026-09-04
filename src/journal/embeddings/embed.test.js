import { describe, it, expect } from 'vitest';
import {
    EMBEDDING_PREFIXES,
    EMBED_FAILURES,
    EMBED_KINDS,
    INDEX_DIMS,
    embedTexts,
    prefixed,
    toIndexVector
} from './embed';
import { createFakeEmbedder, withoutPrefix } from './embed.fake';
import { EMBEDDING_GEMMA_ONNX, EMBEDDING_MODEL, modelFileUrl, totalBytes } from '../inference/models';

describe('the mandatory prompt prefixes', () => {
    it('is the query prefix, to the character, trailing space included', () => {
        // From the upstream model card. A prefix that is *nearly* right has no symptom: the
        // vector still has 256 numbers, still scans, still ranks, and is quietly worse.
        expect(EMBEDDING_PREFIXES.query).toBe('task: search result | query: ');
    });

    it('is the document prefix, to the character', () => {
        expect(EMBEDDING_PREFIXES.document).toBe('title: none | text: ');
    });

    it('differs between a query and a stored entry, which is the point of having two', () => {
        expect(prefixed('work', EMBED_KINDS.query)).toBe('task: search result | query: work');
        expect(prefixed('work', EMBED_KINDS.document)).toBe('title: none | text: work');
        expect(prefixed('work', EMBED_KINDS.query)).not.toBe(prefixed('work', EMBED_KINDS.document));
    });

    it('refuses a kind it does not know rather than embedding without a prefix', () => {
        expect(() => prefixed('work', 'entry')).toThrow(/unknown embedding kind/);
    });

    it('trims the text but never the prefix', () => {
        expect(prefixed('  work  ', EMBED_KINDS.document)).toBe('title: none | text: work');
    });
});

describe('what actually reaches the model', () => {
    it('applies the query prefix on a query', async () => {
        const runtime = createFakeEmbedder();
        await embedTexts(['my job'], { kind: EMBED_KINDS.query, runtime });

        expect(runtime.calls).toEqual(['task: search result | query: my job']);
    });

    it('applies the document prefix on a stored entry', async () => {
        const runtime = createFakeEmbedder();
        await embedTexts(['work'], { kind: EMBED_KINDS.document, runtime });

        expect(runtime.calls).toEqual(['title: none | text: work']);
    });

    it('applies the document prefix to every text in a batch, not only the first', async () => {
        const runtime = createFakeEmbedder();
        await embedTexts(['work', 'the move', 'money'], { kind: EMBED_KINDS.document, runtime });

        expect(runtime.calls).toEqual([
            'title: none | text: work',
            'title: none | text: the move',
            'title: none | text: money'
        ]);
    });

    it('defaults to the stored-entry prefix, which is what the index writes', async () => {
        const runtime = createFakeEmbedder();
        await embedTexts(['work'], { runtime });

        expect(runtime.calls[0].startsWith(EMBEDDING_PREFIXES.document)).toBe(true);
    });

    it('never double-prefixes: the runtime adds nothing of its own', async () => {
        const runtime = createFakeEmbedder();
        await embedTexts(['work'], { kind: EMBED_KINDS.query, runtime });

        expect(withoutPrefix(runtime.calls[0])).toBe('work');
        expect(runtime.calls[0]).not.toContain(EMBEDDING_PREFIXES.document);
    });
});

describe('Matryoshka truncation', () => {
    it('cuts 768 down to 256, which is the width the index stores', () => {
        const wide = Float32Array.from({ length: 768 }, (_, i) => (i % 7) - 3);
        expect(toIndexVector(wide).length).toBe(INDEX_DIMS);
    });

    it('keeps the first 256 and drops the tail, rather than sampling or pooling', () => {
        const wide = Float32Array.from({ length: 768 }, (_, i) => (i < INDEX_DIMS ? 1 : 1000));
        const cut = toIndexVector(wide);
        // Every kept value came from the head, so they are all equal after normalising.
        expect(new Set(Array.from(cut).map(value => value.toFixed(6))).size).toBe(1);
    });

    it('re-normalises, or cosine stops being cosine', () => {
        const cut = toIndexVector(Float32Array.from({ length: 768 }, (_, i) => i + 1));
        const length = Math.sqrt(Array.from(cut).reduce((sum, value) => sum + value * value, 0));
        expect(length).toBeCloseTo(1, 6);
    });

    it('leaves a zero vector alone rather than dividing by zero', () => {
        const zero = toIndexVector(new Float32Array(INDEX_DIMS));
        expect(Array.from(zero).every(value => value === 0)).toBe(true);
    });

    it('does not pad a short vector into a wide one it has no numbers for', () => {
        expect(toIndexVector(Float32Array.from([1, 2, 3])).length).toBe(3);
    });
});

describe('the result envelope', () => {
    it('carries the model id and the width, which is what a stored row records', async () => {
        const runtime = createFakeEmbedder({ model: 'google/embeddinggemma-300m' });
        const result = await embedTexts(['work'], { runtime });

        expect(result.ok).toBe(true);
        expect(result.model).toBe('google/embeddinggemma-300m');
        expect(result.dims).toBe(INDEX_DIMS);
        expect(result.vectors[0]).toBeInstanceOf(Float32Array);
    });

    it('is `unavailable` with no runtime — the default state of every device', async () => {
        const result = await embedTexts(['work'], { runtime: null });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.unavailable);
    });

    it('turns a throwing runtime into a result rather than a rejection', async () => {
        const runtime = createFakeEmbedder({ fail: 'no weights on this device' });
        const result = await embedTexts(['work'], { runtime });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.failed);
        expect(result.failure.cause).toBeInstanceOf(Error);
    });

    it('refuses an empty request rather than asking a model about nothing', async () => {
        const runtime = createFakeEmbedder();
        const result = await embedTexts(['   '], { runtime });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.input);
        expect(runtime.calls).toEqual([]);
    });

    it('refuses a kind it does not know, before anything reaches the model', async () => {
        const runtime = createFakeEmbedder();
        const result = await embedTexts(['work'], { kind: 'entry', runtime });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.input);
        expect(runtime.calls).toEqual([]);
    });

    it('refuses an answer with the wrong number of vectors in it', async () => {
        const runtime = {
            model: 'fake', dims: INDEX_DIMS,
            embed: async () => [Array.from({ length: INDEX_DIMS }, () => 0.1)]
        };
        const result = await embedTexts(['work', 'money'], { runtime });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.shape);
    });

    it('refuses vectors narrower than the width it was promised', async () => {
        const runtime = {
            model: 'fake', dims: INDEX_DIMS,
            embed: async () => [[0.1, 0.2, 0.3]]
        };
        const result = await embedTexts(['work'], { runtime });

        expect(result.ok).toBe(false);
        expect(result.failure.kind).toBe(EMBED_FAILURES.shape);
    });
});

describe('the model this index is built on', () => {
    it('is EmbeddingGemma, under the Gemma terms and not Apache', () => {
        expect(EMBEDDING_MODEL.id).toBe('google/embeddinggemma-300m');
        expect(EMBEDDING_MODEL.licence).toBe('Gemma Terms of Use');
        expect(EMBEDDING_GEMMA_ONNX.licence).toBe('Gemma Terms of Use');
    });

    it('carries the terms beside the weights, which §5.6 requires of a redistribution', () => {
        const terms = EMBEDDING_GEMMA_ONNX.files.find(file => file.path.endsWith('GEMMA_TERMS_OF_USE.txt'));
        expect(terms).toBeTruthy();
        expect(terms.path.startsWith(`${EMBEDDING_GEMMA_ONNX.id}/`)).toBe(true);
    });

    it('is 219 MB, measured, which is what the settings screen promises', () => {
        // 218,739,216 bytes over eight files, from revision 5090578d on 2026-09-04. §5.8
        // estimated "~200-300 MB (verify)" and now carries this instead.
        expect(totalBytes(EMBEDDING_GEMMA_ONNX)).toBe(218_739_216);
    });

    it('comes from this app own origin, with no model hub anywhere in the record', () => {
        EMBEDDING_GEMMA_ONNX.files.forEach(file => {
            expect(modelFileUrl(file).startsWith('/models/')).toBe(true);
        });
        const serialized = JSON.stringify(EMBEDDING_GEMMA_ONNX);
        expect(serialized).not.toContain('huggingface');
        expect(serialized).not.toContain('http');
    });

    it('asks for q4, which is the build §5.8 RAM sentence is about', () => {
        expect(EMBEDDING_GEMMA_ONNX.dtype).toBe('q4');
        const weights = EMBEDDING_GEMMA_ONNX.files.filter(file => file.path.includes('/onnx/'));
        expect(weights.map(file => file.path.split('/').pop())).toEqual([
            'model_q4.onnx',
            'model_q4.onnx_data'
        ]);
    });
});

describe('the fake itself', () => {
    it('answers the same numbers for the same text every run', async () => {
        const one = createFakeEmbedder();
        const two = createFakeEmbedder();

        const a = await embedTexts(['work'], { runtime: one });
        const b = await embedTexts(['work'], { runtime: two });

        expect(Array.from(a.vectors[0])).toEqual(Array.from(b.vectors[0]));
    });

    it('puts two texts it was given no fixture for far apart', async () => {
        const runtime = createFakeEmbedder();
        const result = await embedTexts(['work', 'the dentist'], { runtime });
        const [a, b] = result.vectors;

        let dot = 0;
        for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
        expect(Math.abs(dot)).toBeLessThan(0.3);
    });
});
