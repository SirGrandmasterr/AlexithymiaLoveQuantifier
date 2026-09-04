/** The gate, as data, so the report can print the numbers it was judged against. */
export const THRESHOLDS = Object.freeze({
    mustIncludeRecall: 0.8,
    mustNotViolationRate: 0.05,
    ambiguityAccuracy: 0.9,
    germanWerMargin: 0.05
});

/** Where each number comes from, printed under the gate table so a reader need not dig. */
export const THRESHOLD_SOURCES = Object.freeze({
    mustIncludeRecall: '§5.7, unchanged',
    mustNotViolationRate: '§5.7, unchanged',
    ambiguityAccuracy: '§5.7, unchanged',
    germanWerMargin: 'stated by D4; §5.7 leaves the margin to the first run'
});

const criterion = (name, statement, actual, pass, detail) => ({ name, statement, actual, pass, detail });

export const applyGate = (overall, cleanByLanguage = {}, thresholds = THRESHOLDS) => {
    const english = cleanByLanguage.en?.wer ?? null;
    const german = cleanByLanguage.de?.wer ?? null;
    const gap = english === null || german === null ? null : german - english;

    const criteria = [
        criterion(
            'must-include recall',
            `≥ ${thresholds.mustIncludeRecall}`,
            overall.mustIncludeRecall,
            overall.mustIncludeRecall === null ? null : overall.mustIncludeRecall >= thresholds.mustIncludeRecall,
            `${overall.mustIncludeHit}/${overall.mustIncludeTotal} required ids present`
        ),
        criterion(
            'must-not-include rate',
            `≤ ${thresholds.mustNotViolationRate}`,
            overall.mustNotViolationRate,
            overall.mustNotViolationRate === null ? null : overall.mustNotViolationRate <= thresholds.mustNotViolationRate,
            `${overall.mustNotViolations}/${overall.mustNotIncludeTotal} forbidden ids proposed`
        ),
        criterion(
            'ambiguity accuracy',
            `≥ ${thresholds.ambiguityAccuracy} of the ambiguity cases`,
            overall.ambiguityAccuracy,
            overall.ambiguityAccuracy === null ? null : overall.ambiguityAccuracy >= thresholds.ambiguityAccuracy,
            `${overall.ambiguityCorrect}/${overall.ambiguityCases} non-"none" cases correct`
        ),
        criterion(
            'German WER margin (clean)',
            `de − en ≤ ${thresholds.germanWerMargin} absolute`,
            gap,
            gap === null ? null : gap <= thresholds.germanWerMargin,
            english === null || german === null
                ? 'not measured — one language has no clean clips'
                : `en ${english.toFixed(3)}, de ${german.toFixed(3)}`
        )
    ];

    const failed = criteria.filter(c => c.pass === false);
    const unmeasured = criteria.filter(c => c.pass === null);

    return {
        criteria,
        thresholds,
        passed: failed.length === 0 && unmeasured.length === 0,
        failed: failed.map(c => c.name),
        unmeasured: unmeasured.map(c => c.name),
        verdict: failed.length ? 'fail' : unmeasured.length ? 'incomplete' : 'pass'
    };
};

export const clipCeiling = (clipRow, condition, difficulty) => (
    clipRow?.wer_ceiling?.[condition] ?? difficulty?.[clipRow?.difficulty]?.[condition] ?? null
);

export const clearsEnglishButNotGerman = (result) => (
    result.failed.length === 1
    && result.failed[0] === 'German WER margin (clean)'
    && result.unmeasured.length === 0
);
