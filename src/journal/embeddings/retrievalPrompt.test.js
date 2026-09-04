import { describe, expect, it } from 'vitest';

import { retrievalVocabulary } from './recall';
import { suiteDocuments } from './retrievalGolden';
import { toIndexVector } from './embed';
import { buildContext } from '../inference/index';
import { PROMPT_RULES, buildPrompt } from '../inference/prompt';
import { activeFeelings } from '../../constants/journal';
import contexts from '../inference/golden/contexts.json';
import transcripts from '../inference/golden/transcripts.json';

/** A case whose right answer is not in doubt: `ambiguity: "none"` and words it must have. */
const clearCases = transcripts.filter(row => (
    row.expect?.ambiguity === 'none' && (row.expect.must_include?.length ?? 0) > 0
));

/** The fixture user's own vocabulary, as `buildContext` takes it. */
const vocabularyFor = (name) => buildContext(contexts[name]);

const docs = suiteDocuments();
const adversarial = toIndexVector([1, 0]);
const vectors = new Map(docs.map(doc => [doc.id, { vector: adversarial }]));

const influenced = (context) => retrievalVocabulary({
    queryVector: adversarial,
    docs,
    vectors,
    people: context.people,
    triggers: context.triggers,
    relationshipName: () => context.people[context.people.length - 1] ?? '',
    triggerLabel: () => context.triggers[context.triggers.length - 1] ?? ''
});

describe('retrieval-influenced prompts (the item 3 guard)', () => {
    it('has clear cases to guard, in both languages', () => {
        expect(clearCases.length).toBeGreaterThan(40);
        expect(clearCases.some(row => row.language === 'de')).toBe(true);
        expect(clearCases.some(row => row.language === 'en')).toBe(true);
    });

    /* 1. It cannot take a word away */

    it('leaves every clear case every trigger label its answer needs', () => {
        const lost = [];

        clearCases.forEach(row => {
            const before = vocabularyFor(row.context);
            const after = influenced(before);

            (row.expect.trigger_labels ?? []).forEach(label => {
                // A label the fixture user does not have is a *new trigger* in the answer,
                // which the prompt never contained and retrieval therefore cannot lose.
                if (!before.triggers.includes(label)) return;
                if (!after.triggers.includes(label)) lost.push(`${row.id}: ${label}`);
            });
        });

        expect(lost).toEqual([]);
    });

    it('leaves every clear case every name its answer needs', () => {
        const lost = [];

        clearCases.forEach(row => {
            const before = vocabularyFor(row.context);
            const after = influenced(before);

            (row.expect.people ?? []).forEach(name => {
                if (!before.people.includes(name)) return;
                if (!after.people.includes(name)) lost.push(`${row.id}: ${name}`);
            });
        });

        expect(lost).toEqual([]);
    });

    /* 2. It cannot put a new word in */

    it('adds no word the user has not confirmed, in either language', () => {
        ['en', 'de'].forEach(name => {
            const before = vocabularyFor(name);
            const after = influenced(before);

            expect([...after.triggers].sort()).toEqual([...before.triggers].sort());
            expect([...after.people].sort()).toEqual([...before.people].sort());
        });
    });

    it('names no feeling: the echo channel does not exist', () => {
        ['en', 'de'].forEach(name => {
            const after = influenced(vocabularyFor(name));

            expect(Object.keys(after).sort()).toEqual(['people', 'triggers']);
            activeFeelings().forEach(feeling => {
                expect(JSON.stringify(after)).not.toContain(`"${feeling.id}"`);
            });
        });
    });

    /* 3. It cannot change what the model was told to do */

    it('changes nothing in the prompt but the order of two lists', () => {
        ['en', 'de'].forEach(name => {
            const before = vocabularyFor(name);
            const after = { ...before, ...influenced(before) };

            const plain = buildPrompt(before);
            const retrieved = buildPrompt(after);

            // Every rule, verbatim, in both.
            PROMPT_RULES.forEach(rule => {
                expect(plain).toContain(rule);
                expect(retrieved).toContain(rule);
            });

            // The feeling vocabulary, byte for byte, in both.
            activeFeelings().forEach(feeling => {
                const line = `- ${feeling.id} — ${feeling.label}: ${feeling.gloss}`;
                expect(plain).toContain(line);
                expect(retrieved).toContain(line);
            });

            // And nothing else moved: the two prompts differ only on the lines that carry
            // the names and the labels.
            const differing = plain.split('\n')
                .map((line, at) => (line === retrieved.split('\n')[at] ? null : at))
                .filter(at => at !== null);

            differing.forEach(at => {
                const line = plain.split('\n')[at];
                expect(line).toMatch(/People this person has named before|Trigger labels this person has used before/);
            });
        });
    });

    it('would notice a retrieval that dropped a word — the guard is not vacuous', () => {
        const before = vocabularyFor('en');
        // A planted "retrieval" that narrows instead of reordering, which is exactly the
        // implementation mistake this file exists to catch.
        const narrowed = { people: before.people.slice(0, 1), triggers: before.triggers.slice(0, 1) };

        const lost = clearCases
            .filter(row => row.context === 'en')
            .flatMap(row => (row.expect.trigger_labels ?? [])
                .filter(label => before.triggers.includes(label) && !narrowed.triggers.includes(label))
                .map(label => `${row.id}: ${label}`));

        expect(lost.length).toBeGreaterThan(0);
    });
});
