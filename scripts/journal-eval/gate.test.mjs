/**
 * The gate itself. Pure, and in `npm test` for the reason `wer.test.mjs` gives at its top.
 *
 * The cases below are written as the four ways a run can end: it holds, it fails on one
 * criterion, it was not fully measured, and it clears English but not German — the last of
 * which the D4 prompt says to stop and ask about rather than decide.
 */
import { describe, expect, it } from 'vitest';
import { applyGate, clearsEnglishButNotGerman, clipCeiling, THRESHOLDS } from './gate.mjs';

const overall = (over = {}) => ({
    mustIncludeRecall: 0.9, mustIncludeHit: 90, mustIncludeTotal: 100,
    mustNotViolationRate: 0.0, mustNotViolations: 0, mustNotIncludeTotal: 120,
    ambiguityAccuracy: 0.95, ambiguityCorrect: 19, ambiguityCases: 20,
    ...over
});
const clean = (en, de) => ({
    ...(en === null ? {} : { en: { wer: en } }),
    ...(de === null ? {} : { de: { wer: de } })
});

describe('applyGate', () => {
    it('reads §5.7 numbers and nothing else', () => {
        expect(THRESHOLDS.mustIncludeRecall).toBe(0.8);
        expect(THRESHOLDS.mustNotViolationRate).toBe(0.05);
        expect(THRESHOLDS.ambiguityAccuracy).toBe(0.9);
    });

    it('passes when all four criteria hold', () => {
        const result = applyGate(overall(), clean(0.10, 0.13));
        expect(result.verdict).toBe('pass');
        expect(result.passed).toBe(true);
        expect(result.criteria.every(criterion => criterion.pass)).toBe(true);
    });

    it('fails on recall just below the line, and says which criterion', () => {
        const result = applyGate(overall({ mustIncludeRecall: 0.79 }), clean(0.1, 0.12));
        expect(result.verdict).toBe('fail');
        expect(result.failed).toEqual(['must-include recall']);
    });

    it('treats the thresholds as inclusive, because §5.7 writes them that way', () => {
        expect(applyGate(overall({ mustIncludeRecall: 0.8 }), clean(0.1, 0.15)).passed).toBe(true);
        expect(applyGate(overall({ mustNotViolationRate: 0.05 }), clean(0.1, 0.15)).passed).toBe(true);
        expect(applyGate(overall({ ambiguityAccuracy: 0.9 }), clean(0.1, 0.15)).passed).toBe(true);
    });

    it('fails when the model proposes a forbidden id too often', () => {
        const result = applyGate(overall({ mustNotViolationRate: 0.06, mustNotViolations: 7 }), clean(0.1, 0.12));
        expect(result.failed).toEqual(['must-not-include rate']);
    });

    it('is "incomplete", not "pass", when a language was never measured', () => {
        const result = applyGate(overall(), clean(0.1, null));
        expect(result.verdict).toBe('incomplete');
        expect(result.passed).toBe(false);
        expect(result.unmeasured).toEqual(['German WER margin (clean)']);
        expect(result.criteria.at(-1).detail).toMatch(/not measured/);
    });

    it('is "incomplete" when a feeling criterion had no cases to read', () => {
        const result = applyGate(overall({ ambiguityAccuracy: null, ambiguityCases: 0 }), clean(0.1, 0.12));
        expect(result.verdict).toBe('incomplete');
        expect(result.passed).toBe(false);
    });

    it('measures the German margin as an absolute gap, in the right direction', () => {
        expect(applyGate(overall(), clean(0.10, 0.15)).passed).toBe(true);
        expect(applyGate(overall(), clean(0.10, 0.151)).passed).toBe(false);
        // German better than English is not a failure of a margin that only bounds one way.
        expect(applyGate(overall(), clean(0.20, 0.02)).passed).toBe(true);
    });
});

describe('clearsEnglishButNotGerman', () => {
    it('is the one shape D4 stops and asks about', () => {
        expect(clearsEnglishButNotGerman(applyGate(overall(), clean(0.08, 0.30)))).toBe(true);
    });

    it('is false when something else failed as well', () => {
        const result = applyGate(overall({ mustIncludeRecall: 0.5 }), clean(0.08, 0.30));
        expect(clearsEnglishButNotGerman(result)).toBe(false);
    });

    it('is false when the run passed, and false when it was incomplete', () => {
        expect(clearsEnglishButNotGerman(applyGate(overall(), clean(0.08, 0.10)))).toBe(false);
        expect(clearsEnglishButNotGerman(applyGate(overall(), clean(0.08, null)))).toBe(false);
    });
});

describe('clipCeiling', () => {
    const difficulty = { plain: { clean: 0.15, noisy: 0.3 }, short: { clean: 0.5, noisy: 0.5 } };

    it('takes the class ceiling for the condition', () => {
        expect(clipCeiling({ difficulty: 'plain' }, 'clean', difficulty)).toBe(0.15);
        expect(clipCeiling({ difficulty: 'short' }, 'noisy', difficulty)).toBe(0.5);
    });

    it('lets a clip override its class', () => {
        expect(clipCeiling({ difficulty: 'plain', wer_ceiling: { clean: 0.4 } }, 'clean', difficulty)).toBe(0.4);
    });

    it('is null rather than a guess when the class is unknown', () => {
        expect(clipCeiling({ difficulty: 'invented' }, 'clean', difficulty)).toBe(null);
        expect(clipCeiling(undefined, 'clean', difficulty)).toBe(null);
    });
});
