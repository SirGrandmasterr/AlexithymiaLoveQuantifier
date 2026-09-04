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

export const numberWord = (digits, language) => {
    const lang = language === 'de' ? 'de' : 'en';
    const value = Number(digits);
    if (!Number.isInteger(value) || value < 0) return null;
    if (value <= 20) return NUMBER_WORDS[lang][value];
    if (value < 100 && value % 10 === 0) return TENS[lang][value] || null;
    return MULTIPLIERS[lang][value] || null;
};

const APOSTROPHES = new RegExp(`[${[0x27, 0x2018, 0x2019, 0x201A, 0x201B].map(code => String.fromCodePoint(code)).join('')}]`, 'g');

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
