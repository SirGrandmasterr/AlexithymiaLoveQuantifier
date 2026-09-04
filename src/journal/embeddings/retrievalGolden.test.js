import { describe, expect, it } from 'vitest';

import {
    RETRIEVAL_MODES,
    RETRIEVAL_STATUS,
    RETRIEVAL_SUITE,
    TOP_N,
    runRetrievalSuite,
    scoreRetrievalCase,
    suiteDocuments,
    suiteEntries
} from './retrievalGolden';
import { toIndexVector } from './embed';

/**
 * §5.8's retrieval golden set — *given these entries, query x returns y in the top three* —
 * in German and in English.
 *
 * **What this file proves and what it does not.** Every `lexical` case runs here against the
 * search the app ships, with no model anywhere: the umlaut fold, the `ß` fold, the German
 * compound, the trigger label standing in for a word the entry never says, the snapshot
 * note. Those are real numbers about a real feature.
 *
 * Every `semantic` case is **skipped here, by name**, because its query shares no content
 * word with its answer and only the embedding model can bridge that. The test below asserts
 * they are skipped rather than passed — a suite that quietly graded them against a fake
 * would put a number about the fake into a report beside numbers about a model.
 * `make journal-eval` is where they are scored on a machine with the weights.
 */
describe('the retrieval golden set', () => {
    it('reads as a suite: entries in two languages, cases in both, and a top-three rule', () => {
        expect(TOP_N).toBe(3);
        expect(RETRIEVAL_SUITE.entries.length).toBeGreaterThanOrEqual(20);
        expect(RETRIEVAL_SUITE.entries.filter(entry => entry.language === 'de').length).toBeGreaterThan(8);
        expect(RETRIEVAL_SUITE.entries.filter(entry => entry.language === 'en').length).toBeGreaterThan(8);
        expect(RETRIEVAL_SUITE.cases.filter(row => row.language === 'de').length).toBeGreaterThan(5);
        expect(RETRIEVAL_SUITE.cases.filter(row => row.language === 'en').length).toBeGreaterThan(5);
    });

    it('every case names an id the suite actually holds', () => {
        const ids = new Set(suiteDocuments().map(doc => doc.id));
        RETRIEVAL_SUITE.cases.forEach(row => {
            [...row.expect, ...(row.must_not ?? [])].forEach(id => {
                expect(`${row.id} names ${id}`).toBe(`${row.id} names ${ids.has(id) ? id : 'MISSING'}`);
            });
        });
    });

    it('builds its documents through the app\'s own readers', () => {
        const entries = suiteEntries();
        // The trigger rows are vocabulary, not events: they are read for their labels and
        // never returned as results (§5.8 — results are entries).
        expect(entries.some(entry => entry.kind === 'trigger')).toBe(true);
        expect(suiteDocuments().some(doc => doc.kind === 'trigger')).toBe(false);

        // A day filed under a trigger carries that trigger's label in its searchable text
        // even though the entry never says the word.
        const move = suiteDocuments().find(doc => doc.id === 'de-10');
        expect(move.text.toLowerCase()).toContain('umzug');
        expect(move.triggers).toContain('t-umzug');
    });

    /* -------------------------------------------------------------------------------- */
    /* The suite itself                                                                   */
    /* -------------------------------------------------------------------------------- */

    it('passes every lexical case, in German and in English, with no model at all', async () => {
        const run = await runRetrievalSuite();

        const failures = run.cases
            .filter(row => row.status === RETRIEVAL_STATUS.fail)
            .map(row => `${row.id} "${row.query}" → wanted ${row.missing.join(', ')}, got ${row.top.join(', ')}`);

        expect(failures).toEqual([]);
        expect(run.summary.lexical.pass).toBe(run.summary.lexical.total);
        expect(run.summary.lexical.total).toBeGreaterThan(15);
    });

    it('passes in both languages rather than only in one', async () => {
        const run = await runRetrievalSuite();
        const lexical = (language) => RETRIEVAL_SUITE.cases
            .filter(row => row.language === language && row.mode === RETRIEVAL_MODES.lexical).length;

        expect(run.summary.byLanguage.de.fail).toBe(0);
        expect(run.summary.byLanguage.en.fail).toBe(0);
        expect(run.summary.byLanguage.de.pass).toBe(lexical('de'));
        expect(run.summary.byLanguage.en.pass).toBe(lexical('en'));
    });

    it('records every semantic case as skipped, never as a pass', async () => {
        const run = await runRetrievalSuite();

        expect(run.summary.semantic.total).toBeGreaterThan(5);
        expect(run.summary.semantic.skipped).toBe(run.summary.semantic.total);
        expect(run.summary.semantic.pass).toBe(0);

        run.cases.filter(row => row.mode === RETRIEVAL_MODES.semantic).forEach(row => {
            expect(row.status).toBe(RETRIEVAL_STATUS.skipped);
            expect(row.reason).toContain('embedding model');
        });
    });

    /* -------------------------------------------------------------------------------- */
    /* The scorer, scored                                                                 */
    /* -------------------------------------------------------------------------------- */

    it('fails a case whose answer is not in the top three', () => {
        const docs = suiteDocuments();
        const wrong = { id: 'planted', language: 'de', mode: 'lexical', query: 'Kletterwand', expect: ['de-1'] };

        const result = scoreRetrievalCase(wrong, { docs });
        expect(result.status).toBe(RETRIEVAL_STATUS.fail);
        expect(result.missing).toEqual(['de-1']);
    });

    it('fails a case that returns something its must_not list forbids', () => {
        const docs = suiteDocuments();
        const planted = {
            id: 'planted', language: 'de', mode: 'lexical',
            query: 'Kletterwand', expect: ['de-9'], must_not: ['de-9']
        };

        const result = scoreRetrievalCase(planted, { docs });
        expect(result.status).toBe(RETRIEVAL_STATUS.fail);
        expect(result.forbidden).toEqual(['de-9']);
    });

    /**
     * The semantic half is scoreable the moment an embedder exists, and this proves the
     * wiring with a hand-placed vector rather than with a model: two entries, one of them
     * pointed at directly. It says nothing about EmbeddingGemma and is not meant to — the
     * suite's own semantic cases stay skipped above.
     */
    it('scores a semantic case when an embedder supplies the vectors', () => {
        const docs = suiteDocuments();
        const near = toIndexVector([1, 0, 0, 0]);
        const far = toIndexVector([0, 1, 0, 0]);

        const vectors = new Map(docs.map(doc => [doc.id, { vector: doc.id === 'de-11' ? near : far }]));
        const semantic = RETRIEVAL_SUITE.cases.find(row => row.id === 'de.sem.einsam');

        const result = scoreRetrievalCase(semantic, { docs, vectors, queryVector: near });
        expect(result.status).toBe(RETRIEVAL_STATUS.pass);
        expect(result.top).toContain('de-11');
    });
});
