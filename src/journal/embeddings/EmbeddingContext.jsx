/**
 * The index as one object the two screens can ask questions of.
 *
 * It sits inside `JournalProvider` because everything it needs is already there — the live
 * trigger vocabulary, the check-ins the witnesses are built from, and the merge resolver —
 * and a second copy of any of those would be a second chance to disagree (invariant 17's
 * reasoning, applied one layer down).
 *
 * **A component with no provider above it gets the feature turned off**, not an error. That
 * is not defensive habit: off is the honest default state of this feature on every device
 * until someone turns it on, so a screen rendered without a provider behaves exactly like a
 * screen on a device that never opted in. It also means the forty-odd component tests
 * written before this session keep passing without learning about embeddings.
 *
 * What it does, in order:
 *
 * 1. **Reads the toggle**, and refuses to be on where an index could not exist at all
 *    (`embeddingsAvailable`).
 * 2. **Keeps the trigger vocabulary embedded**, lazily. Anything with no vector, or with a
 *    vector written by a different model or at a different width, is re-embedded in an
 *    effect — after paint, never in the render path, and never awaited by anything a user
 *    is looking at. That is §5.8's *"a model change re-embeds lazily"*: ten thousand rows at
 *    ~20 ms is minutes, and minutes are free when nothing waits on them.
 * 3. **Answers two questions** — what the card should offer beside *new trigger*, and which
 *    pairs the Triggers view should show as *looks similar to…* — and answers both with
 *    labels and ids, never with a number (rule 2).
 *
 * **Nothing here posts anything.** There is no `axios` import in this directory at all, and
 * `noVectors.test.js` asserts that from the outside on every path that writes.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useJournal } from '../../context/JournalContext';
import { readEmbeddings } from '../../constants/journalSettings';
import { embeddingsAvailable } from './availability';
import { EMBED_KINDS, INDEX_DIMS, createWebEmbedder, embedTexts } from './embed';
import { createVectorIndex, staleIds } from './store';
import { buildWitnesses, similarTriggerOffers, similarTriggerPairs } from './similar';

const EmbeddingContext = createContext(null);

/** What a screen sees with no provider, with the feature off, or before the first sync. */
const OFF = Object.freeze({
    enabled: false,
    model: null,
    pairs: [],
    offersFor: async () => []
});

export const useEmbeddings = () => useContext(EmbeddingContext) ?? OFF;

export function EmbeddingProvider({
    // Every one of these is injectable, and all three are `null` in the app. The runtime is
    // what keeps `npm test` free of weights; the backend is what lets a test have an index
    // in an environment with no IndexedDB; `enabled` is what lets one say "on" without
    // writing to a global store a neighbouring test would read.
    runtime: injectedRuntime = null,
    backend = null,
    enabled: enabledOverride = null,
    children
}) {
    const { entries, triggers, resolveTrigger } = useJournal();

    const enabled = enabledOverride ?? readEmbeddings(embeddingsAvailable());

    const index = useMemo(() => createVectorIndex(backend ? { backend } : {}), [backend]);

    // Created on first use and never in render: `createWebEmbedder` is cheap, but the
    // dynamic import it hides is not, and a provider that built one on mount would fetch the
    // library on a screen that never asks it anything.
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

            // A vocabulary that has not loaded yet is not a vocabulary that lost its words:
            // pruning on an empty list would empty the index on every mount.
            if (labels.size > 0) {
                const gone = [...current.keys()].filter(id => !labels.has(id));
                if (gone.length > 0) {
                    gone.forEach(id => current.delete(id));
                    await index.forget(gone);
                }
            }

            const missing = staleIds([...current.values()], [...labels.keys()], { model, dims });
            if (missing.length > 0) {
                const result = await embedTexts(
                    missing.map(id => labels.get(id)),
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
    }, [enabled, index, labels, runtimeFor]);

    // `resolveTrigger` answers with the whole trigger; the witness walk wants the live id,
    // which is the same unwrapping the Triggers view does for `summarizeTrigger`.
    const resolveId = useCallback((id) => resolveTrigger(id).live, [resolveTrigger]);

    const witnesses = useMemo(
        () => (enabled ? buildWitnesses(entries, resolveId) : new Map()),
        [enabled, entries, resolveId]
    );

    const pairs = useMemo(
        () => (enabled ? similarTriggerPairs({ triggers, vectors, witnesses }) : []),
        [enabled, triggers, vectors, witnesses]
    );

    /**
     * *"You've called this 'work' before"* — for one label the card could not resolve.
     *
     * `context` is what the check-in already names: `people` as relationship ids, `triggers`
     * as live trigger ids. Without at least one of them nothing comes back, because rule 3
     * has nothing to agree with — which is the intended answer, not a gap.
     */
    const offersFor = useCallback(async (label, context = {}) => {
        if (!enabled || !String(label ?? '').trim() || vectors.size === 0) return [];

        const runtime = runtimeFor();
        if (!runtime) return [];

        const result = await embedTexts([label], { kind: EMBED_KINDS.query, runtime });
        if (!result.ok) return [];

        return similarTriggerOffers({
            vector: result.vectors[0],
            triggers,
            vectors,
            witnesses,
            context
        });
    }, [enabled, runtimeFor, triggers, vectors, witnesses]);

    const value = useMemo(() => ({
        enabled,
        model: enabled ? (runtimeRef.current?.model ?? null) : null,
        pairs,
        offersFor
    }), [enabled, pairs, offersFor]);

    return <EmbeddingContext.Provider value={value}>{children}</EmbeddingContext.Provider>;
}
