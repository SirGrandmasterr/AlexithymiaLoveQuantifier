/**
 * The report — the artefact §5.7 gates on. *"A model does not become a default until its
 * numbers are in a checked-in report."*
 *
 * Two files are written: a Markdown one for people, and a JSON one beside it with every
 * per-clip row, so a later session can re-aggregate without re-running a model. The Markdown
 * is generated and says so at the top; the reasoning a report needs — why a threshold moved,
 * what a caveat means for the decision — is written by hand underneath, in the section this
 * file leaves headed and empty. A generator that also wrote the conclusions would be a
 * generator that could conclude a model passed.
 */
import { access, writeFile } from 'node:fs/promises';
import { THRESHOLD_SOURCES } from './gate.mjs';

const pct = (value, digits = 3) => (value === null || value === undefined ? '—' : value.toFixed(digits));
const asPercent = (value) => (value === null || value === undefined ? '—' : `${(value * 100).toFixed(1)}%`);
const ms = (value) => (value === null || value === undefined ? '—' : `${Math.round(value)} ms`);
const mib = (value) => (value === null || value === undefined ? '—' : `${(value / 1024 / 1024).toFixed(0)} MiB`);
const tick = (pass) => (pass === true ? '**pass**' : pass === false ? '**FAIL**' : '*not measured*');

const table = (headers, rows) => [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => ':---').join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`)
].join('\n');

const candidateSection = (run) => {
    const { candidate, overall, gate, latency, memory, perId, ambiguity, wer, clipCount, notes } = run;

    const lines = [
        `## ${candidate.label}`,
        '',
        table(['What', 'Value'], [
            ['Candidate id', `\`${candidate.id}\``],
            ['Tier', candidate.tier],
            ['Model', candidate.model ? `\`${candidate.model}\`` : '—'],
            ['Build / quantisation', candidate.packaging || '—'],
            ['Pinned revision', run.revision ? `\`${run.revision}\`` : '*not pinned in the Makefile*'],
            ['Runtime', `\`${candidate.runtime}\``],
            ['Command', `\`${run.runnerDescription.command}\``],
            ['Runtime note', run.runnerDescription.note || '—'],
            ['Input mode', candidate.mode],
            ['Transcriber', candidate.transcriber ? `${candidate.transcriber.model} (${candidate.transcriber.packaging})` : 'none — one pass (§5.1)'],
            ['Grammar', candidate.grammar],
            ['Device', candidate.device],
            ['Clips scored', String(clipCount)]
        ]),
        ''
    ];

    if (candidate.caveat) lines.push(`> **Caveat.** ${candidate.caveat}`, '');
    if (candidate.open_question) lines.push(`> **Open question this is evidence for.** ${candidate.open_question}`, '');
    notes.forEach(note => lines.push(`> ${note}`, ''));

    lines.push(
        `### Gate — ${gate.verdict.toUpperCase()}`,
        '',
        table(['Criterion', 'Required', 'Measured', 'Result', 'Detail'], gate.criteria.map(criterion => [
            criterion.name,
            criterion.statement,
            pct(criterion.actual),
            tick(criterion.pass),
            criterion.detail
        ])),
        '',
        gate.verdict === 'pass'
            ? '**Every criterion held.** §5.7 permits this candidate to become the default for its tier.'
            : gate.verdict === 'fail'
                ? `**Does not become a tier default.** Failed: ${gate.failed.join(', ')}.`
                : `**Not a pass — the run was incomplete.** Unmeasured: ${gate.unmeasured.join(', ')}. `
                  + 'A criterion nothing was measured against has not been cleared.',
        '',
        '### The numbers the gate reads',
        '',
        table(['Measure', 'Value'], [
            ['Cases fully satisfying their expectation', `${overall.casesFullyOk} / ${overall.clips}`],
            ['must-include recall', `${asPercent(overall.mustIncludeRecall)} (${overall.mustIncludeHit}/${overall.mustIncludeTotal})`],
            ['must-not-include violations', `${asPercent(overall.mustNotViolationRate)} (${overall.mustNotViolations}/${overall.mustNotIncludeTotal})`],
            ['ambiguity accuracy, ambiguity cases', `${asPercent(overall.ambiguityAccuracy)} (${overall.ambiguityCorrect}/${overall.ambiguityCases})`],
            ['ambiguity accuracy, every case', asPercent(overall.ambiguityAccuracyAllCases)],
            ['known trigger reused exactly', `${overall.knownTriggerHit}/${overall.knownTriggerCases}`],
            ['new trigger minted where wanted', `${overall.newTriggerHit}/${overall.newTriggerCases}`],
            ['dropped by the filter, total', String(run.droppedByFilter)],
            ['answers that were schema-valid before filtering', `${run.schemaValid}/${clipCount}`],
            ['answers that were not JSON at all', String(run.unparseable)]
        ]),
        '',
        '### Transcription',
        '',
        table(['Language', 'Condition', 'Clips', 'WER (corpus)', 'WER (mean of clips)', 'Over ceiling'], wer.rows),
        '',
        wer.marginLine,
        '',
        '### Latency and memory',
        '',
        table(['Measure', 'Value'], [
            ['Median wall time per clip', ms(latency.median)],
            ['p90 wall time', ms(latency.p90)],
            ['Slowest clip', latency.slowest ? `${ms(latency.slowest.ms)} (${latency.slowest.id})` : '—'],
            ['Peak RSS observed', mib(memory.peakBytes)],
            ['How memory was read', memory.how]
        ]),
        '',
        '### Per feeling id',
        '',
        'Nothing here is a gate criterion. It is the table that says *which* feeling a model is',
        'missing or inventing, which is what changes a prompt (§5.4) or a vocabulary (§5.3).',
        '',
        table(['id', 'support', 'TP', 'FP', 'FN', 'precision', 'recall', 'F1'], perId.map(row => [
            `\`${row.id}\``, String(row.support), String(row.truePositive), String(row.falsePositive),
            String(row.falseNegative), pct(row.precision, 2), pct(row.recall, 2), pct(row.f1, 2)
        ])),
        '',
        '### Ambiguity, answered against expected',
        '',
        table(['expected \\ answered', ...ambiguity.columns], ambiguity.rows),
        ''
    );

    if (run.worstCases.length) {
        lines.push(
            '### The cases that failed',
            '',
            table(['case', 'clip', 'what went wrong'], run.worstCases.map(row => [
                `\`${row.id}\``, row.clip, row.failures.join('; ')
            ])),
            ''
        );
    }

    return lines.join('\n');
};

const werSection = (byGroup, margin) => {
    const rows = byGroup.map(group => [
        group.language, group.condition, String(group.clips),
        pct(group.wer), pct(group.meanWer),
        group.withCeiling ? `${group.overCeiling}/${group.withCeiling}` : '—'
    ]);
    const en = byGroup.find(group => group.language === 'en' && group.condition === 'clean');
    const de = byGroup.find(group => group.language === 'de' && group.condition === 'clean');
    const marginLine = en?.wer !== undefined && en?.wer !== null && de?.wer !== undefined && de?.wer !== null
        ? `**German margin on the clean clips: ${pct(de.wer - en.wer)}** against a stated ceiling of `
          + `${margin}. ${de.wer - en.wer <= margin ? 'Within it.' : '**Outside it** — see §12.1: the '
          + "Light tier's Whisper is the named fallback, and which way to go is a product decision."}`
        : '**The German margin could not be measured** — one of the two clean sets has no clips. '
          + '§12.4 question 8 is unanswered until it does.';
    return { rows, marginLine };
};

export const buildWerSection = werSection;

/**
 * The whole report as Markdown. `runs` is one entry per candidate, already scored.
 */
export const renderReport = ({ runs, date, suiteSummary, environment }) => {
    const anyReal = runs.some(run => run.candidate.runtime !== 'reference');

    const head = [
        anyReal ? `# Model evaluation — ${date}` : `# Harness check — ${date}`,
        '',
        anyReal
            ? 'The golden suite (§5.7) driven through the default model of each tier, at temperature 0, '
              + 'with the output schema as the grammar where the runtime takes one. **The gate below is '
              + 'what decides whether a model becomes a tier default.**'
            : '**This run loaded no weights.** Every candidate below is the `reference` one, which answers '
              + 'each case with the golden suite\'s own hand-written proposal. A perfect score here means '
              + 'the harness — the scoring, the aggregation and the gate — is wired together correctly, '
              + 'and means **nothing whatever about any model**. No model becomes a tier default on the '
              + 'strength of this document.',
        '',
        '> Generated by `make journal-eval` (`scripts/journal-eval/run.mjs`). The tables are machine-written; ',
        '> the sections headed *Reading* and *Decisions* below them are not, and are where the reasoning goes.',
        '',
        '## What was run',
        '',
        table(['What', 'Value'], [
            ['Date', date],
            ['Golden cases', `${suiteSummary.cases} in ${suiteSummary.pairs} pairs (${suiteSummary.en} English, ${suiteSummary.de} German, ${suiteSummary.other} other)`],
            ['Ambiguity cases', String(suiteSummary.ambiguityCases)],
            ['Recordings found', `${suiteSummary.clips} clips across ${suiteSummary.speakers} consented speakers`],
            ['Recordings lock', suiteSummary.suiteSha ? `\`${suiteSummary.suiteSha.slice(0, 16)}…\`` : '*no lock file — no clips*'],
            ['Prompt version', `\`${suiteSummary.promptVersion}\``],
            ['Feeling vocabulary', `${suiteSummary.feelingIds} active ids`],
            ['Host', `${environment.platform} ${environment.arch}, node ${environment.node}`],
            ['Repository commit', environment.commit || '*not a git checkout*']
        ]),
        '',
        '### The thresholds this run was judged against',
        '',
        table(['Criterion', 'Value', 'Where it comes from'],
            Object.entries(runs[0]?.gate.thresholds || {}).map(([key, value]) => [
                key, String(value), THRESHOLD_SOURCES[key] || '—'
            ])),
        '',
        '§5.7 says these numbers are *"to be revised after the first run"*. If this run says revise them, ',
        'the revision goes in *Reading* below **with its reasoning**, and `THRESHOLDS` in ',
        '`scripts/journal-eval/gate.mjs` moves in the same change. A threshold quietly loosened to make a ',
        'model pass is the failure this whole document exists to prevent.',
        ''
    ].join('\n');

    const tail = [
        '## Reading',
        '',
        '*Written by hand. What the numbers above mean, what surprised you, and whether any threshold ',
        'should move — with the reasoning, not the conclusion alone.*',
        '',
        '## Decisions',
        '',
        'One line each, and each one repeated in `product_vision/06-progress.md` and §12.5.',
        '',
        table(['Question', 'Answer', 'Evidence'], [
            ['Is E4B a desktop-tier default? (§12.5)', '', ''],
            ['Is the Android Light-tier transcriber Whisper or the platform recogniser on API 31+? (§12.5)', '', ''],
            ['Does the single pass need a dedicated transcriber back on the Full tier? (§5.1)', '', ''],
            ['Does any candidate become a tier default?', '', '']
        ]),
        '',
        '## What this run does not say',
        '',
        '*The limits of the evidence: what was not measured, what was measured on the wrong device, and ',
        'what a later run should do differently.*',
        ''
    ].join('\n');

    return [head, ...runs.map(candidateSection), tail].join('\n');
};

/**
 * Write the pair, and **refuse to overwrite a report that already exists.**
 *
 * The generated tables are disposable; the *Reading*, *Decisions* and *What this run does not
 * say* sections underneath them are not, and a second run on the same day would silently
 * replace an afternoon of somebody's reasoning with an empty heading. So a second run on the
 * same day has to say which it means: `--force` to replace, or `--out` to write beside it.
 */
export const writeReport = async ({ markdownPath, jsonPath, markdown, data, force = false }) => {
    if (!force) {
        for (const path of [markdownPath, jsonPath]) {
            const exists = await access(path).then(() => true, () => false);
            if (exists) {
                throw new Error(`${path} already exists.\n`
                    + 'A report carries hand-written sections a re-run would overwrite. Pass --force to '
                    + 'replace it, or --out <path> to write a second one beside it.');
            }
        }
    }
    await writeFile(markdownPath, `${markdown.trimEnd()}\n`, 'utf8');
    await writeFile(jsonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
};
