import { describe, expect, it } from 'vitest';
import { aggregateWer, alignTokens, normaliseForWer, numberWord, wordErrorRate } from './wer.mjs';

describe('normaliseForWer', () => {
    it('lower-cases and drops punctuation', () => {
        expect(normaliseForWer('Just tired.')).toEqual(['just', 'tired']);
        expect(normaliseForWer('Nothing much today. An ordinary day, I feel level.'))
            .toEqual(['nothing', 'much', 'today', 'an', 'ordinary', 'day', 'i', 'feel', 'level']);
    });

    it('treats every apostrophe shape as the same one, and joins the word', () => {
        const straight = normaliseForWer("I don't know");
        expect(straight).toEqual(['i', 'dont', 'know']);
        expect(normaliseForWer(`I don${String.fromCodePoint(0x2019)}t know`)).toEqual(straight);
        expect(normaliseForWer(`I don${String.fromCodePoint(0x2018)}t know`)).toEqual(straight);
    });

    it('splits compounds on the hyphen', () => {
        expect(normaliseForWer('Vierzehn-Stunden-Tag', 'de')).toEqual(['vierzehn', 'stunden', 'tag']);
    });

    it('keeps German diacritics apart, because they are different words', () => {
        expect(normaliseForWer('schön', 'de')).not.toEqual(normaliseForWer('schon', 'de'));
        expect(normaliseForWer('müde', 'de')).toEqual(['müde']);
        expect(normaliseForWer('weiß', 'de')).toEqual(['weiß']);
    });

    it('keeps fillers, which are words that were said', () => {
        expect(normaliseForWer('Also, ähm, ich weiß nicht.', 'de'))
            .toEqual(['also', 'ähm', 'ich', 'weiß', 'nicht']);
    });

    it('reads a numeral as the word the speaker said, in both languages', () => {
        expect(normaliseForWer('3 calls before 9')).toEqual(normaliseForWer('three calls before nine'));
        expect(normaliseForWer('Drei Anrufe vor 9', 'de')).toEqual(normaliseForWer('Drei Anrufe vor neun', 'de'));
        expect(normaliseForWer('14 hours')).toEqual(['fourteen', 'hours']);
    });

    it('leaves a numeral outside the covered range alone, so the mismatch is visible', () => {
        expect(numberWord('37', 'en')).toBe(null);
        expect(normaliseForWer('37 hours')).toEqual(['37', 'hours']);
    });

    it('is empty for empty input', () => {
        expect(normaliseForWer('')).toEqual([]);
        expect(normaliseForWer(null)).toEqual([]);
        expect(normaliseForWer('   ...   ')).toEqual([]);
    });
});

describe('alignTokens', () => {
    it('is zero for identical sequences', () => {
        expect(alignTokens(['a', 'b', 'c'], ['a', 'b', 'c']))
            .toEqual({ cost: 0, substitutions: 0, insertions: 0, deletions: 0 });
    });

    it('separates the three kinds of edit', () => {
        expect(alignTokens(['a', 'b', 'c'], ['a', 'x', 'c']))
            .toEqual({ cost: 1, substitutions: 1, insertions: 0, deletions: 0 });
        expect(alignTokens(['a', 'b'], ['a', 'b', 'c']))
            .toEqual({ cost: 1, substitutions: 0, insertions: 1, deletions: 0 });
        expect(alignTokens(['a', 'b', 'c'], ['a', 'c']))
            .toEqual({ cost: 1, substitutions: 0, insertions: 0, deletions: 1 });
    });

    it('counts a wholly missing hypothesis as deletions, and a wholly invented one as insertions', () => {
        expect(alignTokens(['a', 'b', 'c'], [])).toEqual({ cost: 3, substitutions: 0, insertions: 0, deletions: 3 });
        expect(alignTokens([], ['a', 'b'])).toEqual({ cost: 2, substitutions: 0, insertions: 2, deletions: 0 });
    });
});

describe('wordErrorRate', () => {
    it('divides by the reference length, not the hypothesis length', () => {
        const result = wordErrorRate('I had a nice day with Lucie', 'I had a nice day with Lucy');
        expect(result.referenceWords).toBe(7);
        expect(result.substitutions).toBe(1);
        expect(result.wer).toBeCloseTo(1 / 7, 10);
    });

    it('forgives a numeral written as digits', () => {
        expect(wordErrorRate('Three calls before nine', '3 calls before 9').wer).toBe(0);
    });

    it('does not forgive a misheard name', () => {
        expect(wordErrorRate('Sinéad from the choir', 'Sinead from the choir').wer).toBeGreaterThan(0);
    });

    it('is null, not zero, when there is nothing to be wrong about', () => {
        expect(wordErrorRate('', 'anything').wer).toBe(null);
    });

    it('can exceed 1 when the transcriber invents more than it heard', () => {
        expect(wordErrorRate('just tired', 'i think that i am probably quite tired today').wer).toBeGreaterThan(1);
    });
});

describe('aggregateWer', () => {
    const clip = (reference, hypothesis) => wordErrorRate(reference, hypothesis);

    it('pools errors over pooled reference words rather than averaging rates', () => {
        const short = clip('just tired', 'just tried');
        const long = clip('one two three four five six seven eight nine ten',
            'one two three four five six seven eight nine eleven');
        const pooled = aggregateWer([short, long]);
        expect(pooled.wer).toBeCloseTo(2 / 12, 10);
        expect(pooled.meanWer).toBeCloseTo(0.3, 10);
        expect(pooled.clips).toBe(2);
        expect(pooled.referenceWords).toBe(12);
    });

    it('excludes a clip with no reference rather than scoring it zero', () => {
        const pooled = aggregateWer([clip('a b', 'a b'), clip('', 'x')]);
        expect(pooled.clips).toBe(1);
        expect(pooled.wer).toBe(0);
    });

    it('is null overall when nothing was measurable', () => {
        expect(aggregateWer([]).wer).toBe(null);
        expect(aggregateWer([clip('', '')]).wer).toBe(null);
    });
});
