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
    // Both arguments, in the provider's order. Written `(candidates) => candidates` until the
    // closeout, which returned the **query text** to a caller expecting §4.5's candidate list
    // — on the one path where nothing renders an index, so nothing would ever have said so.
    orderCandidates: async (text, candidates) => candidates,
    vocabularyFor: async (text, vocabulary) => vocabulary
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
    const { entries, triggers, resolveTrigger, personName } = useJournal();
    // Invariant 17 again: the snapshots are the subject list's, read rather than fetched.
    // §5.8's *"and snapshot notes"* is the only reason this provider knows about them, and
    // it is a read of a list that is already in memory — no request is made here.
    const { people: snapshots } = useSubjects();

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

    /**
     * Everything one user can search (§5.8's third use), built once per set of rows.
     *
     * Built whether or not the index is on, because the **lexical** half of search needs no
     * model at all and a device with the feature off simply never reaches a screen that
     * reads this. `resolveTrigger` and `personName` are the provider's own, so a day filed
     * under a renamed trigger is searchable by the name it has now.
     */
    // `resolveTrigger` answers with the whole trigger; the witness walk and the prune below
    // want the live id, which is the same unwrapping the Triggers view does for
    // `summarizeTrigger`.
    const resolveId = useCallback((id) => resolveTrigger(id).live, [resolveTrigger]);

    // `resolveTrigger` is passed straight through: it is already memoised on `triggerIndex`
    // by the provider that owns it, and a `(id) => resolveTrigger(id)` wrapper around it is a
    // second identity to keep stable for no second behaviour.
    const documents = useMemo(() => buildDocuments({
        entries,
        snapshots,
        resolveTrigger,
        personName
    }), [entries, snapshots, resolveTrigger, personName]);

    /**
     * What the index holds a vector for: the trigger vocabulary, and the entries themselves.
     *
     * G1 embedded only the vocabulary, because the only thing it offered was *"you've called
     * this 'work' before"*. Every one of G2's four uses compares against an **entry**, so the
     * entries are in the index now — the same store, the same key, the same row shape, since
     * a trigger's `client_id` is an entry client id like any other (§6.3).
     *
     * A snapshot is deliberately not here. §5.8 rule 1 says each device builds its index
     * *"from the entries it already holds decrypted"*, and a snapshot is not a journal entry;
     * it is searchable by its words and never by similarity, which `recall.js` states where
     * the reader of a result would want to know it.
     */
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

            // **Absent is not gone**, and G2 had to narrow G1's rule to keep that true. A
            // vector for an id this pass did not ask for used to be deleted, which was right
            // when the only ids were the trigger vocabulary — the two views that hold it load
            // it whole. Entries are different: the day view narrows `entries` to one month,
            // so *not in this list* means "not loaded" far more often than "deleted", and the
            // old rule would have re-embedded the whole journal every time the user walked to
            // another month.
            //
            // So a row is dropped only when the vocabulary can say it is dead — a trigger
            // whose id resolves to another one, which is exactly G1's reason for `forget`: a
            // merged-away word has nothing left to speak for. Everything else stays until
            // sign-out empties the store.
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

    /**
     * Embed one query, or answer `null`.
     *
     * The shared front half of every method below, and **the one place `EMBED_KINDS.query` is
     * used**: the prefixes are mandatory and a query embedded as a document is a point in the
     * wrong space with no symptom (§5.8, G1's second finding). It is declared here, above its
     * first caller, so that sentence can stay true — G2 wrote it below `offersFor` and left
     * `offersFor` with its own copy of these four lines, which is exactly the drift the
     * sentence exists to forbid.
     *
     * `null` is the ordinary answer on a device with no weights, and every caller is written
     * so that `null` degrades to the behaviour of a device with the feature off — the lexical
     * half of search, and the candidate order §4.5 already chose.
     */
    const embedQuery = useCallback(async (text) => {
        if (!enabled || !String(text ?? '').trim()) return null;

        const runtime = runtimeFor();
        if (!runtime) return null;

        const result = await embedTexts([text], { kind: EMBED_KINDS.query, runtime });
        return result.ok ? result.vectors[0] : null;
    }, [enabled, runtimeFor]);

    /**
     * *"You've called this 'work' before"* — for one label the card could not resolve.
     *
     * `context` is what the check-in already names: `people` as relationship ids, `triggers`
     * as live trigger ids. Without at least one of them nothing comes back, because rule 3
     * has nothing to agree with — which is the intended answer, not a gap.
     */
    const offersFor = useCallback(async (label, context = {}) => {
        if (vectors.size === 0) return [];

        const vector = await embedQuery(label);
        if (!vector) return [];

        return similarTriggerOffers({ vector, triggers, vectors, witnesses, context });
    }, [embedQuery, triggers, vectors, witnesses]);

    /**
     * §5.8's third use — recall. *"When did I last feel like this about work?"*
     *
     * The lexical half runs whatever the state of the index; the semantic half is added when
     * the query could be embedded. Returns `{ matched, similar }` — **entries**, never a
     * summary and never a number.
     */
    const search = useCallback(async (query) => {
        // **The off state is enforced here and not in the screen.** The lexical half needs no
        // model, so this function would happily answer with the toggle off — and §10.2's off
        // variant says in writing that *"the journal cannot be searched"*. Until the closeout
        // the only thing holding that sentence up was one `if (!enabled)` in `JournalSearch`,
        // which a second caller would have walked straight past. Now the seam refuses, and
        // the screen's branch is what draws the explanation rather than what enforces it.
        if (!enabled) return { matched: [], similar: [] };

        const queryVector = await embedQuery(query);
        return recall({ query, docs: documents, vectors, queryVector });
    }, [enabled, documents, vectors, embedQuery]);

    /**
     * §5.8's second use — *"Your past entries"*, for the check-in in front of the user.
     *
     * `context` is the same witness pair `offersFor` takes, and rule 3 gates this the same
     * way: no shared person and no shared trigger means nothing is offered, however alike
     * the sentences look.
     */
    const pastFor = useCallback(async (text, context = {}, exclude = []) => {
        const queryVector = await embedQuery(text);
        if (!queryVector) return [];

        return pastEntryOffers({ queryVector, docs: documents, vectors, context, exclude });
    }, [documents, vectors, embedQuery]);

    /**
     * §5.8's fifth use — namesakes. Orders §4.5's candidates and returns the same list.
     *
     * A failure of any kind — the feature off, no weights, no vectors, one candidate —
     * returns the array it was given, so a caller can use this unconditionally.
     */
    const orderCandidates = useCallback(async (text, candidates = []) => {
        if (!Array.isArray(candidates) || candidates.length < 2) return candidates;

        const queryVector = await embedQuery(text);
        if (!queryVector) return candidates;

        return orderNamesakes(candidates, { queryVector, docs: documents, vectors });
    }, [documents, vectors, embedQuery]);

    /**
     * §5.8's fourth use — the vocabulary the proposal prompt is given, narrowed by what the
     * *k* most similar confirmed entries used.
     *
     * It hands back `{ people, triggers }` reordered and nothing else; `retrievalVocabulary`
     * is where the reasoning for that lives, and `retrievalGolden.js` is the golden-suite
     * guard that a clear case still has every word it needs.
     */
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
            // `personName`, not a second scan of `relationships`. It is the provider's own
            // rule — the relationship's current name wins, the label stored on the mention
            // is the fallback — and a private `relationships.find(...)?.name ?? ''` here was
            // a third copy of it that dropped the fallback, so a prompt's retrieved
            // vocabulary lost the name of a deleted relationship the rest of the app still
            // shows.
            relationshipName: (id) => personName({ relationship_id: id }),
            triggerLabel: (id) => labels.get(id) ?? ''
        });
    }, [documents, vectors, embedQuery, personName, labels]);

    const value = useMemo(() => ({
        enabled,
        model: enabled ? (runtimeRef.current?.model ?? null) : null,
        pairs,
        // The searchable corpus. Empty with the feature off, for the same reason `search`
        // refuses there: §10.2's off variant promises the journal cannot be searched, and a
        // corpus handed out under that promise is a screen away from breaking it.
        documents: enabled ? documents : [],
        offersFor,
        search,
        pastFor,
        orderCandidates,
        vocabularyFor
    }), [enabled, pairs, documents, offersFor, search, pastFor, orderCandidates, vocabularyFor]);

    return <EmbeddingContext.Provider value={value}>{children}</EmbeddingContext.Provider>;
}
