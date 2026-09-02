/**
 * The scoring under the feeling half of §5.7's gate — pure, so it runs in `npm test` while
 * the eval it feeds does not (see the note at the top of `wer.test.mjs`).
 *
 * The last block is the one that matters most: it runs the real golden suite's hand-written
 * references through this file's `satisfies`, and every one of the 120 has to pass. That is
 * what holds this reading and `validate.test.js`'s together — if the two ever drift, a model
 * would be graded by one standard and the references by another, and the gate would be
 * measuring the drift.
 */
import { describe, expect, it } from 'vitest';
import { aggregate, ambiguityConfusion, perIdMetrics, satisfies, scoreCase } from './score.mjs';
// Vite resolves these; the harness itself reads the same two files with `readFile`, because it
// runs under plain node where a JSON import needs an import attribute.
import transcripts from '../../src/journal/inference/golden/transcripts.json';
import contexts from '../../src/journal/inference/golden/contexts.json';
import recordings from '../../src/journal/inference/golden/recordings.json';

const triggersOf = (key) => contexts[key].triggers.map(trigger => trigger.label);

const proposal = (over = {}) => ({
    transcript: 'x', language: 'en', feelings: [], people: [], facts: [], ambiguity: 'none', ...over
});
const feeling = (id, about = []) => ({ id, intensity: 2, about });

describe('satisfies', () => {
    it('passes an answer that meets every clause', () => {
        expect(satisfies(
            proposal({ feelings: [feeling('stress', [{ kind: 'trigger', label: 'work' }])] }),
            { ambiguity: 'none', must_include: ['stress'], must_not_include: ['joy'], trigger_labels: ['work'] },
            ['work']
        )).toEqual([]);
    });

    it('names each failure, and names them all', () => {
        expect(satisfies(
            proposal({ feelings: [feeling('anger')], ambiguity: 'target' }),
            { ambiguity: 'none', must_include: ['stress'], must_not_include: ['anger'] }
        )).toEqual(['ambiguity target', 'missing stress', 'has anger']);
    });

    it('reads an empty list as "none at all" and an absent key as "no opinion"', () => {
        const withPerson = proposal({ people: [{ name: 'Lucie' }] });
        expect(satisfies(withPerson, { people: [] })).toEqual(['people Lucie']);
        expect(satisfies(withPerson, {})).toEqual([]);
    });

    it('reads new_trigger against the context, not against the label list', () => {
        const known = proposal({ feelings: [feeling('stress', [{ kind: 'trigger', label: 'work' }])] });
        const fresh = proposal({ feelings: [feeling('stress', [{ kind: 'trigger', label: 'the car' }])] });
        expect(satisfies(known, { new_trigger: true }, ['work'])).toEqual(['no new trigger']);
        expect(satisfies(fresh, { new_trigger: true }, ['work'])).toEqual([]);
    });

    it('wants a fact about the named person, not merely some fact', () => {
        const about = proposal({ people: [{ name: 'Lucie' }], facts: [{ person: 'Lucie', text: 'moved to Lyon' }] });
        expect(satisfies(about, { facts: ['Lucie'] })).toEqual([]);
        expect(satisfies(about, { facts: ['Sam'] })).toEqual(['no fact about Sam']);
        expect(satisfies(about, { facts: [] })).toEqual(['has facts']);
    });
});

describe('scoreCase', () => {
    const entry = {
        id: 'x.en', pair: 'x', language: 'en',
        expect: { ambiguity: 'none', must_include: ['stress', 'tiredness'], must_not_include: ['joy', 'anger'] },
        reference: { feelings: [feeling('stress'), feeling('tiredness')], people: [], facts: [], ambiguity: 'none' }
    };

    it('counts the gate numbers rather than deciding them', () => {
        const score = scoreCase({ entry, proposal: proposal({ feelings: [feeling('stress'), feeling('joy')] }) });
        expect(score.mustIncludeTotal).toBe(2);
        expect(score.mustIncludeHit).toBe(1);
        expect(score.mustNotIncludeTotal).toBe(2);
        expect(score.mustNotIncludeViolations).toBe(1);
        expect(score.ok).toBe(false);
    });

    it('marks a "none" case as not an ambiguity case', () => {
        expect(scoreCase({ entry, proposal: proposal() }).ambiguityIsCase).toBe(false);
        const conflicted = { ...entry, expect: { ...entry.expect, ambiguity: 'conflict' } };
        expect(scoreCase({ entry: conflicted, proposal: proposal() }).ambiguityIsCase).toBe(true);
        expect(scoreCase({ entry: conflicted, proposal: proposal() }).ambiguityCorrect).toBe(false);
    });
});

describe('aggregate', () => {
    const score = (over) => ({
        ok: true, mustIncludeTotal: 0, mustIncludeHit: 0, mustNotIncludeTotal: 0, mustNotIncludeViolations: 0,
        ambiguityIsCase: false, ambiguityCorrect: true, newTriggerWanted: false, newTriggerFound: false,
        knownTriggerWanted: [], knownTriggerFound: [], predictedIds: [], expectedIds: [], ...over
    });

    it('reads recall over required ids, not over cases', () => {
        const result = aggregate([
            score({ mustIncludeTotal: 3, mustIncludeHit: 3 }),
            score({ mustIncludeTotal: 1, mustIncludeHit: 0 })
        ]);
        expect(result.mustIncludeRecall).toBe(0.75);
    });

    it('scopes ambiguity accuracy to the ambiguity cases, and reports the flattering figure separately', () => {
        const result = aggregate([
            score({ ambiguityIsCase: true, ambiguityCorrect: false }),
            score({ ambiguityIsCase: false, ambiguityCorrect: true }),
            score({ ambiguityIsCase: false, ambiguityCorrect: true })
        ]);
        expect(result.ambiguityAccuracy).toBe(0);
        expect(result.ambiguityAccuracyAllCases).toBeCloseTo(2 / 3, 10);
    });

    it('is null rather than zero where nothing was asked', () => {
        const result = aggregate([score({})]);
        expect(result.mustIncludeRecall).toBe(null);
        expect(result.mustNotViolationRate).toBe(null);
        expect(result.ambiguityAccuracy).toBe(null);
    });

    it('wants every named known trigger, not just one of them', () => {
        const result = aggregate([
            score({ knownTriggerWanted: ['work', 'the move'], knownTriggerFound: ['work'] }),
            score({ knownTriggerWanted: ['work'], knownTriggerFound: ['work'] })
        ]);
        expect(result.knownTriggerCases).toBe(2);
        expect(result.knownTriggerHit).toBe(1);
    });
});

describe('perIdMetrics', () => {
    it('keeps an id that was only ever a false positive, with a null recall', () => {
        const rows = perIdMetrics([
            { predictedIds: ['anger'], expectedIds: [] },
            { predictedIds: ['anger'], expectedIds: [] }
        ]);
        const anger = rows.find(row => row.id === 'anger');
        expect(anger.falsePositive).toBe(2);
        expect(anger.support).toBe(0);
        expect(anger.recall).toBe(null);
        expect(anger.precision).toBe(0);
    });

    it('computes precision, recall and F1 the ordinary way', () => {
        const rows = perIdMetrics([
            { predictedIds: ['stress'], expectedIds: ['stress'] },
            { predictedIds: ['stress'], expectedIds: [] },
            { predictedIds: [], expectedIds: ['stress'] }
        ]);
        const stress = rows.find(row => row.id === 'stress');
        expect(stress.precision).toBe(0.5);
        expect(stress.recall).toBe(0.5);
        expect(stress.f1).toBe(0.5);
    });
});

describe('ambiguityConfusion', () => {
    it('tabulates what was answered against what was expected', () => {
        expect(ambiguityConfusion([
            { ambiguityExpected: 'feeling', ambiguityActual: 'none' },
            { ambiguityExpected: 'feeling', ambiguityActual: 'feeling' },
            { ambiguityExpected: 'none', ambiguityActual: 'none' }
        ])).toEqual({ feeling: { none: 1, feeling: 1 }, none: { none: 1 } });
    });
});

describe('the golden suite, read by this file rather than by the offline one', () => {
    it('is a hundred and twenty cases in sixty pairs', () => {
        expect(transcripts.length).toBe(120);
        expect(new Set(transcripts.map(entry => entry.pair)).size).toBe(60);
    });

    it('has a reference that satisfies its own expectation, for every case', () => {
        transcripts.forEach((entry) => {
            expect(satisfies(entry.reference, entry.expect, triggersOf(entry.context)), entry.id).toEqual([]);
        });
    });

    it('would score a perfect run as a perfect run', () => {
        const scores = transcripts.map(entry => scoreCase({
            entry, proposal: entry.reference, contextTriggers: triggersOf(entry.context)
        }));
        const overall = aggregate(scores);
        expect(overall.clips).toBe(120);
        expect(overall.casesFullyOk).toBe(120);
        expect(overall.mustIncludeRecall).toBe(1);
        expect(overall.mustNotViolationRate).toBe(0);
        expect(overall.ambiguityAccuracy).toBe(1);
    });

    it('carries enough non-"none" ambiguity cases for that criterion to mean something', () => {
        const scores = transcripts.map(entry => scoreCase({ entry, proposal: entry.reference }));
        // Twenty of the hundred and twenty. §5.7 wants 0.9 of them correct, so the criterion
        // fails on the third wrong answer — tight enough to bite, and not so tight that one
        // case decides a tier default.
        expect(scores.filter(score => score.ambiguityIsCase).length).toBe(20);
    });

    it('splits evenly between the two languages, bar the one case that is about a third', () => {
        // Sixty and sixty by pair; sixty and fifty-nine by spoken language, because D1's
        // `other-language` pair swaps them on purpose — the `.en` half is French and the
        // `.de` half is English, to see whether the model declares the language it heard
        // rather than the one it was asked about. The harness groups WER by what was *said*
        // (`entry.language`), so that pair contributes one French clip to a group of its own
        // and one more English clip, and the German-versus-English margin is unaffected.
        expect(transcripts.filter(entry => entry.id.endsWith('.en')).length).toBe(60);
        expect(transcripts.filter(entry => entry.id.endsWith('.de')).length).toBe(60);
        expect(transcripts.filter(entry => entry.language === 'en').length).toBe(60);
        expect(transcripts.filter(entry => entry.language === 'de').length).toBe(59);
        expect(transcripts.filter(entry => entry.language === 'fr').map(entry => entry.id))
            .toEqual(['other-language.en']);
    });
});

describe('the recording plan', () => {
    const classes = Object.keys(recordings.difficulty);

    it('has exactly one row per case, and no row for a case that does not exist', () => {
        // The two files together are the suite. A case with no row would be scored against no
        // WER ceiling at all; a row with no case is a clip nobody will ever be asked to record.
        expect(recordings.clips.map(row => row.case).sort())
            .toEqual(transcripts.map(entry => entry.id).sort());
    });

    it('gives every clip a difficulty class the table defines', () => {
        recordings.clips.forEach((row) => {
            expect(classes, row.case).toContain(row.difficulty);
        });
    });

    it('states a ceiling for both conditions in every class, noisier than clean or equal to it', () => {
        classes.forEach((name) => {
            const ceilings = recordings.difficulty[name];
            expect(typeof ceilings.clean, name).toBe('number');
            expect(typeof ceilings.noisy, name).toBe('number');
            // A noisy clip may not be held to a *tighter* ceiling than its clean twin. `short`
            // is the case where they are equal, because two words quantise WER to steps of 0.5
            // and the number there means "at most one word wrong" in both conditions.
            expect(ceilings.noisy, name).toBeGreaterThanOrEqual(ceilings.clean);
        });
    });

    it('agrees with the transcripts about language and word count', () => {
        const byId = new Map(transcripts.map(entry => [entry.id, entry]));
        recordings.clips.forEach((row) => {
            const entry = byId.get(row.case);
            expect(row.language, row.case).toBe(entry.language);
            expect(row.words, row.case).toBe(entry.transcript.trim().split(/\s+/).length);
        });
    });

    it('keeps both halves of a pair in the same difficulty class', () => {
        // The point of a pair is that its halves differ in language and in nothing else. A
        // German half held to a looser ceiling than its English twin would make the §5.7
        // margin a comparison of two ceilings rather than of two languages.
        const byPair = new Map();
        recordings.clips.forEach((row) => {
            const pair = transcripts.find(entry => entry.id === row.case).pair;
            byPair.set(pair, [...(byPair.get(pair) || []), row.difficulty]);
        });
        byPair.forEach((difficulties, pair) => {
            expect(new Set(difficulties).size, pair).toBe(1);
        });
    });
});
