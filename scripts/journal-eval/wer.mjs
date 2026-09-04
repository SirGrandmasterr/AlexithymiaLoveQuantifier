/**
 * Word error rate, and the normalisation that decides what counts as an error.
 *
 * WER is `(substitutions + insertions + deletions) / reference_words`, and every argument
 * about it is really an argument about the normaliser. A transcriber that writes "3" where
 * the speaker said "three" has not made a mistake; one that writes "Lucy" for "Lucie" has,
 * because that name is how the app finds a relationship (§4.5). So the rules below are
 * chosen, stated, and tested rather than inherited from whatever a library happened to do:
 *
 * - **Case and punctuation go.** A full stop is a decision the transcriber makes about a
 *   sentence the speaker did not punctuate out loud.
 * - **Apostrophes are dropped, in every shape.** A curly one and a straight one are the same
 *   word, and `don’t` and `don't` are not two errors.
 * - **Numerals become words**, in both languages, for 0-20, the tens, hundert/hundred and
 *   tausend/thousand. That is the whole of the range the golden sentences use, and a map
 *   that stops where the evidence stops is honest about what it covers.
 * - **Diacritics stay.** `schon` and `schön` are different words in German and a normaliser
 *   that folds them is measuring a different language than the one being tested. This is the
 *   rule most likely to be argued with, so: folding them would make the German WER look
 *   better than it is, which is exactly the number §12.1 says must not be flattered.
 * - **Compound hyphens split.** `Vierzehn-Stunden-Tag` is three tokens, because a transcriber
 *   writing it open as three words has heard it correctly.
 * - **Fillers are kept.** `ähm` and `um` are words that were said, and `filler-heavy.*` exists
 *   precisely to find out whether a transcriber invents or drops them.
 *
 * Nothing here imports from `src/`. It is arithmetic over strings, it is covered by
 * `wer.test.mjs` in `npm test`, and it is the one part of the harness that has to be right
 * before any model is judged by it.
 */

/** 0-20, the tens, and the two multipliers the golden sentences reach. */
const NUMBER_WORDS = {
    en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
        'nineteen', 'twenty'],
    de: ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn',
        'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn',
        'neunzehn', 'zwanzig']
};

const TENS = {
    en: { 30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety' },
    de: { 30: 'dreißig', 40: 'vierzig', 50: 'fünfzig', 60: 'sechzig', 70: 'siebzig', 80: 'achtzig', 90: 'neunzig' }
};

const MULTIPLIERS = {
    en: { 100: 'hundred', 1000: 'thousand' },
    de: { 100: 'hundert', 1000: 'tausend' }
};

/**
 * A numeral as the word a speaker would have said, or `null` when it is outside the covered
 * range. Outside the range the digits are kept as they are — which means a mismatch counts
 * as an error, and that is the safe direction: an uncovered number is visible in the diff
 * rather than quietly forgiven.
 */
export const numberWord = (digits, language) => {
    const lang = language === 'de' ? 'de' : 'en';
    const value = Number(digits);
    if (!Number.isInteger(value) || value < 0) return null;
    if (value <= 20) return NUMBER_WORDS[lang][value];
    if (value < 100 && value % 10 === 0) return TENS[lang][value] || null;
    return MULTIPLIERS[lang][value] || null;
};

/**
 * Every apostrophe shape a transcriber might emit, as code points rather than as literal
 * characters: U+0027 and U+2018, U+2019, U+201A, U+201B, which look alike in most editors
 * and are unreviewable when typed straight into a character class.
 *
 * They are removed rather than turned into spaces, so `don’t` is the single token `dont`
 * and a transcriber that writes `do not` differs by exactly the one word it added. Every
 * other mark — quotes, dashes, ellipses, non-breaking spaces — is neither a letter nor a
 * number, and the class in `normaliseForWer` collapses all of them without a table.
 */
const APOSTROPHES = new RegExp(`[${[0x27, 0x2018, 0x2019, 0x201A, 0x201B].map(code => String.fromCodePoint(code)).join('')}]`, 'g');

/**
 * The token sequence a WER is computed over. Exported because a report that prints a diff
 * has to print the tokens that were actually compared, not the raw text.
 */
export const normaliseForWer = (text, language = 'en') => (
    String(text ?? '')
        .toLowerCase()
        .replace(APOSTROPHES, '')
        // A hyphen inside a compound is a word boundary, and so is every other mark.
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(token => (/^\d+$/.test(token) ? (numberWord(token, language) ?? token) : token))
);

/**
 * Levenshtein distance over token arrays, with the three edit counts kept apart.
 *
 * Two rows rather than a full matrix: the golden suite's longest case is 83 words, so the
 * full matrix would be fine, but a back-pointer row costs nothing and the counts are what
 * make a WER readable — 0.2 that is all deletions is a transcriber cutting the clip short,
 * and 0.2 that is all substitutions is one that mishears.
 */
export const alignTokens = (reference, hypothesis) => {
    const rows = reference.length + 1;
    const columns = hypothesis.length + 1;
    // Each cell holds [cost, substitutions, insertions, deletions].
    let previous = Array.from({ length: columns }, (_, column) => [column, 0, column, 0]);

    for (let row = 1; row < rows; row += 1) {
        const current = [[row, 0, 0, row]];
        for (let column = 1; column < columns; column += 1) {
            if (reference[row - 1] === hypothesis[column - 1]) {
                current[column] = [...previous[column - 1]];
                continue;
            }
            const substitute = previous[column - 1];
            const insert = current[column - 1];
            const remove = previous[column];
            const best = [substitute, insert, remove]
                .reduce((a, b) => (a[0] <= b[0] ? a : b));
            if (best === substitute) current[column] = [best[0] + 1, best[1] + 1, best[2], best[3]];
            else if (best === insert) current[column] = [best[0] + 1, best[1], best[2] + 1, best[3]];
            else current[column] = [best[0] + 1, best[1], best[2], best[3] + 1];
        }
        previous = current;
    }

    const [cost, substitutions, insertions, deletions] = previous[columns - 1];
    return { cost, substitutions, insertions, deletions };
};

/**
 * `{ wer, substitutions, insertions, deletions, referenceWords }` for one clip.
 *
 * An empty reference is not a WER of zero and not a WER of one: it is `null`, because there
 * is nothing to be wrong about, and a `null` propagates into the aggregate as an excluded
 * clip rather than as a suspiciously perfect one. No golden case has an empty transcript, so
 * this only fires when something upstream has already gone wrong — which is when it matters.
 */
export const wordErrorRate = (reference, hypothesis, language = 'en') => {
    const referenceTokens = normaliseForWer(reference, language);
    const hypothesisTokens = normaliseForWer(hypothesis, language);
    const counts = alignTokens(referenceTokens, hypothesisTokens);
    return {
        ...counts,
        referenceWords: referenceTokens.length,
        hypothesisWords: hypothesisTokens.length,
        wer: referenceTokens.length === 0 ? null : counts.cost / referenceTokens.length
    };
};

/**
 * The aggregate over many clips: **total errors over total reference words**, not the mean of
 * the per-clip rates.
 *
 * The difference is not pedantry. `short-utterance` is two words and `rambling` is 83; a mean
 * of rates lets one wrong word in a two-word clip weigh forty times what one wrong word in
 * the long one does. The corpus figure is what every published WER means, and it is the one
 * the gate reads. The mean is reported beside it because it is the one that shows a single
 * catastrophic clip, which the corpus figure can hide.
 */
export const aggregateWer = (results) => {
    const usable = results.filter(result => result && result.wer !== null);
    if (!usable.length) return { wer: null, meanWer: null, clips: 0, referenceWords: 0, errors: 0 };
    const errors = usable.reduce((sum, result) => sum + result.cost, 0);
    const referenceWords = usable.reduce((sum, result) => sum + result.referenceWords, 0);
    return {
        wer: errors / referenceWords,
        meanWer: usable.reduce((sum, result) => sum + result.wer, 0) / usable.length,
        clips: usable.length,
        referenceWords,
        errors
    };
};
