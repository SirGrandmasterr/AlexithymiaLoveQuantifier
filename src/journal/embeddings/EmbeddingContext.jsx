import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useJournal } from '../../context/JournalContext';
import { useSubjects } from '../../context/SubjectsContext';
import { readEmbeddings } from '../../constants/journalSettings';
import { embeddingsAvailable } from './availability';
import { EMBED_KINDS, INDEX_DIMS, createWebEmbedder, embedTexts } from './embed';
import { createVectorIndex, staleIds } from './store';
import { buildWitnesses, similarTriggerOffers, similarTriggerPairs } from './similar';
import { buildDocuments, orderNamesakes, pastEntryOffers, recall, retrievalVocabulary } from './recall';

const EmbeddingContext = createContext(null);

/** What a screen sees with no provider, with the feature off, or before the first sync. */
const OFF = Object.freeze({
    enabled: false,
    model: null,
    pairs: [],
    documents: [],
    offersFor: async () => [],
    // G2. Each answers with the empty thing rather than throwing, so a screen written
    // against them renders the "off" state without knowing there is one.
    search: async () => ({ matched: [], similar: [] }),
    pastFor: async () => [],
    orderCandidates: async (text, candidates) => candidates,
    vocabularyFor: async (text, vocabulary) => vocabulary
});

export const useEmbeddings = () => useContext(EmbeddingContext) ?? OFF;

export function EmbeddingProvider({
    runtime: injectedRuntime = null,
    backend = null,
    enabled: enabledOverride = null,
    children
}) {
    const { entries, triggers, resolveTrigger, personName } = useJournal();
    const { people: snapshots } = useSubjects();

    const enabled = enabledOverride ?? readEmbeddings(embeddingsAvailable());

    const index = useMemo(() => createVectorIndex(backend ? { backend } : {}), [backend]);

    const runtimeRef = useRef(injectedRuntime);
    const runtimeFor = useCallback(() => {
        if (!enabled) return null;
        if (!runtimeRef.current) runtimeRef.current = createWebEmbedder();
        return runtimeRef.current;
    }, [enabled]);

    const [vectors, setVectors] = useState(() => new Map());

    /** `clientId → label`, over the live vocabulary only: a merged-away word is not offered. */
    const labels = useMemo(() => {
        const map = new Map();
        (triggers || []).forEach(trigger => {
            const id = String(trigger?.live ?? trigger?.clientId ?? '');
            const label = String(trigger?.label ?? '').trim();
            if (id && label) map.set(id, label);
        });
        return map;
    }, [triggers]);

    const resolveId = useCallback((id) => resolveTrigger(id).live, [resolveTrigger]);

    const documents = useMemo(() => buildDocuments({
        entries,
        snapshots,
        resolveTrigger,
        personName
    }), [entries, snapshots, resolveTrigger, personName]);

    const wanted = useMemo(() => {
        const map = new Map(labels);
        documents.forEach(doc => {
            if (doc.kind !== 'snapshot' && doc.text) map.set(doc.id, doc.text);
        });
        return map;
    }, [labels, documents]);

    useEffect(() => {
        if (!enabled) {
            setVectors(new Map());
            return undefined;
        }

        let live = true;

        (async () => {
            const runtime = runtimeFor();
            if (!runtime) return;

            const model = runtime.model;
            const dims = Number.isInteger(runtime.dims) ? runtime.dims : INDEX_DIMS;

            const current = await index.current({ model, dims });
            if (!live) return;

            if (labels.size > 0) {
                const gone = [...current.keys()].filter(id => (
                    !wanted.has(id) && resolveId(id) !== id
                ));
                if (gone.length > 0) {
                    gone.forEach(id => current.delete(id));
                    await index.forget(gone);
                }
            }

            const missing = staleIds([...current.values()], [...wanted.keys()], { model, dims });
            if (missing.length > 0) {
                const result = await embedTexts(
                    missing.map(id => wanted.get(id)),
                    { kind: EMBED_KINDS.document, runtime }
                );
                if (!live) return;

                // `ok: false` is the ordinary state of a device that has not downloaded the
                // weights. It costs this pass and nothing else — the next one tries again.
                if (result.ok) {
                    const rows = missing.map((id, at) => ({
                        entryClientId: id,
                        model: result.model,
                        dims: result.dims,
                        vector: result.vectors[at]
                    }));
                    await index.put(rows);
                    rows.forEach(row => current.set(row.entryClientId, row));
                }
            }

            if (live) setVectors(current);
        })().catch(() => {
            // A store or a model that failed leaves the feature quiet. There is no sentence
            // to show: nothing the user asked for did not happen.
        });

        return () => { live = false; };
    }, [enabled, index, labels, wanted, resolveId, runtimeFor]);

    const witnesses = useMemo(
        () => (enabled ? buildWitnesses(entries, resolveId) : new Map()),
        [enabled, entries, resolveId]
    );

    const pairs = useMemo(
        () => (enabled ? similarTriggerPairs({ triggers, vectors, witnesses }) : []),
        [enabled, triggers, vectors, witnesses]
    );

    const embedQuery = useCallback(async (text) => {
        if (!enabled || !String(text ?? '').trim()) return null;

        const runtime = runtimeFor();
        if (!runtime) return null;

        const result = await embedTexts([text], { kind: EMBED_KINDS.query, runtime });
        return result.ok ? result.vectors[0] : null;
    }, [enabled, runtimeFor]);

    const offersFor = useCallback(async (label, context = {}) => {
        if (vectors.size === 0) return [];

        const vector = await embedQuery(label);
        if (!vector) return [];

        return similarTriggerOffers({ vector, triggers, vectors, witnesses, context });
    }, [embedQuery, triggers, vectors, witnesses]);

    const search = useCallback(async (query) => {
        if (!enabled) return { matched: [], similar: [] };

        const queryVector = await embedQuery(query);
        return recall({ query, docs: documents, vectors, queryVector });
    }, [enabled, documents, vectors, embedQuery]);

    const pastFor = useCallback(async (text, context = {}, exclude = []) => {
        const queryVector = await embedQuery(text);
        if (!queryVector) return [];

        return pastEntryOffers({ queryVector, docs: documents, vectors, context, exclude });
    }, [documents, vectors, embedQuery]);

    const orderCandidates = useCallback(async (text, candidates = []) => {
        if (!Array.isArray(candidates) || candidates.length < 2) return candidates;

        const queryVector = await embedQuery(text);
        if (!queryVector) return candidates;

        return orderNamesakes(candidates, { queryVector, docs: documents, vectors });
    }, [documents, vectors, embedQuery]);

    const vocabularyFor = useCallback(async (text, vocabulary = {}) => {
        const known = {
            people: Array.isArray(vocabulary.people) ? vocabulary.people : [],
            triggers: Array.isArray(vocabulary.triggers) ? vocabulary.triggers : []
        };

        const queryVector = await embedQuery(text);
        if (!queryVector) return known;

        return retrievalVocabulary({
            queryVector,
            docs: documents,
            vectors,
            people: known.people,
            triggers: known.triggers,
            relationshipName: (id) => personName({ relationship_id: id }),
            triggerLabel: (id) => labels.get(id) ?? ''
        });
    }, [documents, vectors, embedQuery, personName, labels]);

    const value = useMemo(() => ({
        enabled,
        model: enabled ? (runtimeRef.current?.model ?? null) : null,
        pairs,
        documents: enabled ? documents : [],
        offersFor,
        search,
        pastFor,
        orderCandidates,
        vocabularyFor
    }), [enabled, pairs, documents, offersFor, search, pastFor, orderCandidates, vocabularyFor]);

    return <EmbeddingContext.Provider value={value}>{children}</EmbeddingContext.Provider>;
}
