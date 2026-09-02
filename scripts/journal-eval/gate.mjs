/**
 * §5.7's acceptance gate, as four criteria that either hold or do not.
 *
 * > Recall ≥ 0.8 on *must include*, ≤ 0.05 on *must not include*, `ambiguity` correct on
 * > ≥ 0.9 of the ambiguity cases, German WER within a stated margin of English on the clean
 * > clips, for the default model of each tier.
 *
 * Three of those four numbers are written in the design document. The fourth is not: §5.7
 * says *"a stated margin"* and leaves the stating to the first run. It is stated here, with
 * its reasoning, so that it is a number somebody chose rather than a number that appeared:
 *
 * **`germanWerMargin = 0.05` absolute, on the clean clips.** Reasons, in order of weight:
 * (a) the transcript is editable before anything resolves (§4.3), so the cost of a German
 * word error is a correction and not a wrong record; (b) five points of absolute WER on a
 * fifteen-word note is roughly one word, which is about the point at which a person stops
 * editing and starts re-recording; (c) published Whisper figures put German a few points
 * behind English on read speech, so a margin much tighter than this would fail a transcriber
 * that is behaving exactly as its own model card says it will. **Absolute and not relative**,
 * because a relative margin gets more permissive as the English number gets worse, which is
 * the wrong direction: the worse English is, the less headroom German has.
 *
 * All four numbers are a first draft. §5.7 says they are *"to be revised after the first
 * run"* — and if the first run says revise them, the report says so with the reasoning and
 * the constant moves here, in the same change. A threshold quietly loosened to make a model
 * pass is the one failure mode this file exists to prevent.
 *
 * Pure; `gate.test.mjs` covers it in `npm test`.
 */

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

/**
 * Apply the gate to one tier's run.
 *
 * `overall` is `aggregate()` over every clip; `cleanByLanguage` is `{ en, de }`, each an
 * `aggregateWer()` over that language's **clean** clips only. Anything missing makes its
 * criterion `pass: null` — *not measured* — and a gate with a `null` in it does not pass.
 * That distinction is the whole point: a tier that never ran the German clips has not cleared
 * the German criterion, and reporting it as a pass because nothing failed would be the exact
 * mistake §12.1 warns about.
 */
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
        // `passed` is true only when all four were measured and all four held. A tier that
        // does not pass does not become a default (§5.7); a tier that was not fully measured
        // has not passed either, and `verdict` says which of the two happened.
        passed: failed.length === 0 && unmeasured.length === 0,
        failed: failed.map(c => c.name),
        unmeasured: unmeasured.map(c => c.name),
        verdict: failed.length ? 'fail' : unmeasured.length ? 'incomplete' : 'pass'
    };
};

/**
 * The §5.7 pass/fail per clip on transcription: did this clip come in under its own ceiling?
 *
 * A clip ceiling is not a gate criterion — the gate reads the aggregate — but the per-clip
 * list is what says *which* recordings are hard, which is what a second recording session
 * would act on.
 */
export const clipCeiling = (clipRow, condition, difficulty) => (
    clipRow?.wer_ceiling?.[condition] ?? difficulty?.[clipRow?.difficulty]?.[condition] ?? null
);

/**
 * The English-only variant of the gate, for the question the D4 prompt says to stop on: a
 * model that clears everything except the German margin. Returns `true` when the first three
 * criteria hold and only the German one fails — the exact shape that is a product decision
 * rather than a technical one (fall back to Whisper, ship English-only, or hold).
 */
export const clearsEnglishButNotGerman = (result) => (
    result.failed.length === 1
    && result.failed[0] === 'German WER margin (clean)'
    && result.unmeasured.length === 0
);
