import { describe, it, expect } from 'vitest';
import {
    VECTOR_KEY,
    clearVectorIndex,
    createVectorIndex,
    indexedDbBackend,
    staleIds,
    vectorRow
} from './store';
import { INDEX_DIMS } from './embed';

const memoryBackend = () => {
    const rows = new Map();
    return {
        rows,
        getAll: async () => [...rows.values()],
        putMany: async (items) => { items.forEach(item => rows.set(item[VECTOR_KEY], item)); },
        deleteMany: async (ids) => { ids.forEach(id => rows.delete(id)); },
        clear: async () => { rows.clear(); }
    };
};

const vector = (fill = 0.1, dims = INDEX_DIMS) => Float32Array.from({ length: dims }, () => fill);

describe('a stored row', () => {
    it('is exactly the four fields §5.8 names, and nothing else', () => {
        const row = vectorRow({
            entryClientId: 'trigger-1', model: 'google/embeddinggemma-300m',
            dims: INDEX_DIMS, vector: vector()
        });

        expect(Object.keys(row).sort()).toEqual(['dims', 'entry_client_id', 'model', 'vector']);
        // No label, no transcript, no day, no relationship. A vector is invertible; the words
        // beside it would not even need inverting.
        expect(JSON.stringify(row)).not.toContain('work');
    });

    it('keeps the vector a typed array, which is what "not a vector database" means on disk', () => {
        const row = vectorRow({ entryClientId: 'a', model: 'm', dims: 3, vector: [1, 2, 3] });
        expect(row.vector).toBeInstanceOf(Float32Array);
    });
});

describe('reading back', () => {
    it('returns what it wrote', async () => {
        const backend = memoryBackend();
        const index = createVectorIndex({ backend });

        await index.put([{ entryClientId: 'a', model: 'm', dims: INDEX_DIMS, vector: vector() }]);
        const rows = await index.all();

        expect(rows).toHaveLength(1);
        expect(rows[0].entryClientId).toBe('a');
        expect(rows[0].vector).toBeInstanceOf(Float32Array);
    });

    it('drops a row whose width and `dims` disagree rather than scanning it', async () => {
        const backend = memoryBackend();
        backend.rows.set('bad', { [VECTOR_KEY]: 'bad', model: 'm', dims: 256, vector: Float32Array.from([1, 2]) });

        expect(await createVectorIndex({ backend }).all()).toEqual([]);
    });

    it('drops a row with no model on it: a vector nothing can date is a vector nothing can retire', async () => {
        const backend = memoryBackend();
        backend.rows.set('bad', { [VECTOR_KEY]: 'bad', dims: 2, vector: Float32Array.from([1, 2]) });

        expect(await createVectorIndex({ backend }).all()).toEqual([]);
    });

    it('answers with an empty index rather than throwing when the store refuses', async () => {
        const broken = { getAll: async () => { throw new Error('quota'); } };
        expect(await createVectorIndex({ backend: broken }).all()).toEqual([]);
    });

    it('narrows `current` to the model and width asked for', async () => {
        const backend = memoryBackend();
        const index = createVectorIndex({ backend });
        await index.put([
            { entryClientId: 'a', model: 'old', dims: INDEX_DIMS, vector: vector() },
            { entryClientId: 'b', model: 'new', dims: INDEX_DIMS, vector: vector() }
        ]);

        const current = await index.current({ model: 'new', dims: INDEX_DIMS });
        expect([...current.keys()]).toEqual(['b']);
    });
});

describe('staleness, and the lazy re-embed it drives', () => {
    const rows = [
        { entryClientId: 'a', model: 'old-model', dims: 256, vector: vector() },
        { entryClientId: 'b', model: 'new-model', dims: 256, vector: vector() },
        { entryClientId: 'c', model: 'new-model', dims: 128, vector: vector(0.1, 128) }
    ];

    it('asks for the ids it has no vector for at all', () => {
        expect(staleIds(rows, ['b', 'd'], { model: 'new-model', dims: 256 })).toEqual(['d']);
    });

    it('marks every vector stale when the model changes — that is what the field is for', () => {
        expect(staleIds(rows, ['a', 'b', 'c'], { model: 'newer-model', dims: 256 }).sort())
            .toEqual(['a', 'b', 'c']);
    });

    it('marks a vector stale when the width changes, not only the model', () => {
        expect(staleIds(rows, ['c'], { model: 'new-model', dims: 256 })).toEqual(['c']);
    });

    it('leaves the old rows in place: a model change invalidates, it does not delete', async () => {
        const backend = memoryBackend();
        const index = createVectorIndex({ backend });
        await index.put([{ entryClientId: 'a', model: 'old', dims: INDEX_DIMS, vector: vector() }]);

        // Nothing about asking the stale question removes anything. The re-embed is lazy:
        // the row simply stops matching until something replaces it.
        expect(staleIds([...(await index.current({ model: 'new', dims: INDEX_DIMS })).values()],
            ['a'], { model: 'new', dims: INDEX_DIMS })).toEqual(['a']);
        expect(backend.rows.size).toBe(1);
    });

    it('asks for nothing when everything matches — the ordinary case, and it costs no model', () => {
        expect(staleIds(rows, ['b'], { model: 'new-model', dims: 256 })).toEqual([]);
    });

    it('deduplicates, so two feelings naming one trigger do not embed it twice', () => {
        expect(staleIds([], ['d', 'd', 'd'], { model: 'm', dims: 256 })).toEqual(['d']);
    });
});

describe('forgetting', () => {
    it('drops the vectors it is given and leaves the rest', async () => {
        const backend = memoryBackend();
        const index = createVectorIndex({ backend });
        await index.put([
            { entryClientId: 'a', model: 'm', dims: INDEX_DIMS, vector: vector() },
            { entryClientId: 'b', model: 'm', dims: INDEX_DIMS, vector: vector() }
        ]);

        await index.forget(['a']);
        expect((await index.all()).map(row => row.entryClientId)).toEqual(['b']);
    });
});

describe('signing out', () => {
    it('empties the index, which is what §10.2 promises out loud', async () => {
        const backend = memoryBackend();
        await createVectorIndex({ backend }).put([
            { entryClientId: 'a', model: 'm', dims: INDEX_DIMS, vector: vector() }
        ]);

        await clearVectorIndex({ backend });

        expect(backend.rows.size).toBe(0);
        expect(await createVectorIndex({ backend }).all()).toEqual([]);
    });

    it('does not throw on a device that has no store to empty', async () => {
        await expect(clearVectorIndex({ backend: indexedDbBackend({ factory: null }) }))
            .resolves.toBeUndefined();
    });
});

describe('the IndexedDB backend', () => {
    it('answers with nothing rather than throwing where there is no IndexedDB', async () => {
        // jsdom is exactly this device, and so is a browser in some private modes.
        const backend = indexedDbBackend({ factory: null });
        expect(await backend.getAll()).toEqual([]);
        await expect(backend.putMany([])).resolves.toBeUndefined();
        await expect(backend.clear()).resolves.toBeUndefined();
    });
});
