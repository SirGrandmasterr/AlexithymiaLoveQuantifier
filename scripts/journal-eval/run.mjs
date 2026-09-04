/**
 * `make journal-eval` — the out-of-band evaluation harness (§5.7).
 *
 *     node scripts/journal-eval/run.mjs [--candidate <id>]… [options]
 *
 * Drives a candidate through every golden case at temperature 0 with the output schema as the
 * grammar, validates each answer with the **app's own** `validateProposal`, and writes the
 * report §5.7 gates on. It is not part of `npm test`: it needs weights and minutes.
 *
 * Options
 *   --candidate <id>     Repeatable. Default: every tier default (`--candidate reference`
 *                        needs no weights and checks the harness itself).
 *   --tier-defaults      Every candidate that is a default for a tier — what §5.7's gate is
 *                        about. This is what a bare `make journal-eval` runs.
 *   --hypotheses <file>  Transcriber output for a text-mode candidate, keyed `<case>|<cond>`.
 *                        Without it a text-mode tier is scored over *perfect* transcripts,
 *                        which flatters it, and the report says so.
 *   --limit <n>          First n cases. For trying the wiring, never for a report.
 *   --conditions <list>  Default `clean,noisy`.
 *   --out <path>         Report path. Default `product_vision/eval/<name>-<date>.md`.
 *   --no-report          Print the summary, write nothing.
 *   --force              Overwrite a report that already exists, hand-written sections and all.
 *   --verbose            One line per clip, as it happens.
 *
 * Environment, read by `runners.mjs`: `JOURNAL_EVAL_LLAMA_BIN`, `JOURNAL_EVAL_LITERT_BIN`,
 * `JOURNAL_EVAL_MODEL`, `JOURNAL_EVAL_MMPROJ`, `JOURNAL_EVAL_REPLAY`,
 * `JOURNAL_EVAL_LITERT_ARGS`, `JOURNAL_EVAL_EXTRA_ARGS`.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { discoverClips, readSpeakers, readSuite, readLock } from './audio.mjs';
import { CANDIDATES, TIER_DEFAULTS, candidateById } from './candidates.mjs';
import { applyGate, clearsEnglishButNotGerman, clipCeiling } from './gate.mjs';
import { loadInference } from './load.mjs';
import { repoRoot, today } from './paths.mjs';
import { revisionFor } from './pins.mjs';
import { renderReport, buildWerSection, writeReport } from './report.mjs';
import { aggregate, ambiguityConfusion, perIdMetrics, scoreCase } from './score.mjs';
import { createRunner } from './runners.mjs';
import { aggregateWer, wordErrorRate } from './wer.mjs';

/* ------------------------------------------------------------------------------------ */
/* Arguments                                                                              */
/* ------------------------------------------------------------------------------------ */

const parseArgs = (argv) => {
    const options = { candidates: [], conditions: ['clean', 'noisy'], report: true };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => argv[index += 1];
        switch (argument) {
            case '--candidate': options.candidates.push(next()); break;
            case '--tier-defaults': options.candidates.push(...TIER_DEFAULTS.map(c => c.id)); break;
            case '--hypotheses': options.hypotheses = next(); break;
            case '--limit': options.limit = Number(next()); break;
            case '--conditions': options.conditions = next().split(',').filter(Boolean); break;
            case '--out': options.out = next(); break;
            case '--no-report': options.report = false; break;
            case '--force': options.force = true; break;
            case '--verbose': options.verbose = true; break;
            case '--help': options.help = true; break;
            default: throw new Error(`unknown option ${argument}`);
        }
    }
    if (!options.candidates.length) options.candidates = TIER_DEFAULTS.map(candidate => candidate.id);
    return options;
};

const HELP = [
    'make journal-eval — the golden suite against a candidate model (§5.7)',
    '',
    'Candidates:',
    ...Object.values(CANDIDATES).map(candidate => (
        `  ${candidate.id.padEnd(24)} ${candidate.tier.padEnd(6)} ${candidate.label}`
    )),
    '',
    'Options: --candidate <id> | --tier-defaults | --hypotheses <file> | --limit <n>',
    '         --conditions clean,noisy | --out <path> | --no-report | --force | --verbose'
].join('\n');

/* ------------------------------------------------------------------------------------ */
/* One candidate                                                                          */
/* ------------------------------------------------------------------------------------ */

const percentile = (values, fraction) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
};

/**
 * Every unit of work for one candidate: which case, which condition, which clip.
 *
 * An audio candidate has one unit per clip found — several if several speakers recorded the
 * same case, none if nobody did. A text candidate has one unit per case, because there is no
 * clip to vary; its `condition` is the one the transcript came from when hypotheses were
 * supplied, and `text` otherwise.
 */
const planUnits = ({ candidate, cases, clips, conditions, hypotheses }) => {
    const units = [];
    cases.forEach((entry) => {
        if (candidate.mode === 'audio') {
            conditions.forEach((condition) => {
                (clips.get(`${entry.id}|${condition}`) || []).forEach((clip) => {
                    units.push({ entry, condition, clip });
                });
            });
            return;
        }
        if (hypotheses) {
            conditions.forEach((condition) => {
                const text = hypotheses[`${entry.id}|${condition}`];
                if (typeof text === 'string') units.push({ entry, condition, text });
            });
            return;
        }
        units.push({ entry, condition: 'text', text: entry.transcript });
    });
    return units;
};

const runCandidate = async ({ candidate, suite, clips, options, inference, hypotheses }) => {
    const { transcripts, contexts, recordings } = suite;
    const cases = options.limit ? transcripts.slice(0, options.limit) : transcripts;
    const clipRows = new Map(recordings.clips.map(row => [row.case, row]));

    // A candidate the environment cannot drive is **reported**, not thrown. `make journal-eval`
    // with no weights installed should say which tiers it could not reach and why — running it
    // is how you find that out, so aborting on the first missing binary would put the answer
    // behind the question. When that happens it is the *only* note: the caveats below are about
    // how a run was scored, and there was no run.
    const notes = [];
    let runner = null;
    let unrunnable = false;
    try {
        runner = await createRunner(candidate, process.env);
    } catch (error) {
        unrunnable = true;
        notes.push(`**Could not be run.** ${error.message}`);
        runner = {
            id: candidate.runtime,
            describe: () => ({ command: '(not run)', note: error.message }),
            run: async () => ({ raw: '', ms: null, peakBytes: null, note: 'not run' })
        };
    }

    const units = unrunnable
        ? []
        : planUnits({ candidate, cases, clips, conditions: options.conditions, hypotheses });

    if (!unrunnable && candidate.mode === 'text' && !hypotheses && candidate.runtime !== 'reference') {
        notes.push('**Scored over the golden transcripts, not over a transcriber\'s output.** This tier '
            + 'transcribes first and proposes second, so these feeling numbers are an upper bound: they '
            + 'exclude the error cascade §5.1 names as the reason the Full tier is one pass. Pass '
            + '`--hypotheses` with the transcriber\'s own output to close that gap.');
    }
    if (!unrunnable && candidate.mode === 'audio' && units.length === 0) {
        notes.push('**No clips.** This candidate takes audio and the golden suite has no recordings on '
            + 'this machine, so nothing was run. `make journal-audio-check` lists what is missing.');
    }

    const scores = [];
    const werResults = [];
    const rows = [];
    let droppedByFilter = 0;
    let schemaValid = 0;
    let unparseable = 0;

    for (const unit of units) {
        const { entry, condition, clip, text } = unit;
        const context = inference.buildContext(contexts[entry.context]);
        const contextTriggers = context.triggers;
        const prompt = inference.buildPrompt(context);
        const schema = candidate.grammar === 'PROPOSAL_GRAMMAR_SCHEMA'
            ? inference.PROPOSAL_GRAMMAR_SCHEMA
            : inference.PROPOSAL_SCHEMA;

        const input = clip ? { kind: 'audio', path: clip.path } : { kind: 'text', text };
        const promptWithNote = clip ? prompt : `${prompt}\n\nNote: ${text}`;

        const answer = await runner.run({ entry, condition, prompt: promptWithNote, schema, input });
        const { proposal, provenance } = inference.validateProposal(answer.raw, context);

        // `validateProposal` reports "this was not an object at all" as one drop at the root
        // with no path — the model answered prose, or nothing. Distinct from an answer that
        // was JSON and wrong, which is what every other drop is.
        if (provenance.drops.some(drop => drop.path === '' && drop.reason === 'shape')) unparseable += 1;
        if (provenance.schema_valid) schemaValid += 1;
        droppedByFilter += provenance.dropped_by_filter;

        const score = scoreCase({ entry, proposal, contextTriggers });
        scores.push(score);

        const wer = wordErrorRate(entry.transcript, proposal.transcript, entry.language);
        const ceiling = clipCeiling(clipRows.get(entry.id), condition, recordings.difficulty);
        werResults.push({ ...wer, id: entry.id, language: entry.language, condition, ceiling });

        rows.push({
            case: entry.id,
            pair: entry.pair,
            language: entry.language,
            condition,
            speaker: clip?.speaker ?? null,
            clip: clip ? clip.path.slice(repoRoot.length + 1) : null,
            ok: score.ok,
            failures: score.failures,
            ambiguity: { expected: score.ambiguityExpected, actual: score.ambiguityActual },
            feelings: { expected: score.expectedIds, actual: score.predictedIds },
            wer: wer.wer,
            wer_ceiling: ceiling,
            over_ceiling: ceiling !== null && wer.wer !== null && wer.wer > ceiling,
            ms: answer.ms,
            peak_bytes: answer.peakBytes,
            schema_valid: provenance.schema_valid,
            dropped_by_filter: provenance.dropped_by_filter,
            drops: provenance.drops,
            runner_note: answer.note ?? null
        });

        if (options.verbose) {
            process.stdout.write(`${score.ok ? 'ok  ' : 'FAIL'} ${entry.id}.${condition}`
                + ` wer=${wer.wer === null ? '—' : wer.wer.toFixed(2)}`
                + `${answer.ms === null ? '' : ` ${Math.round(answer.ms)}ms`}`
                + `${score.failures.length ? `  ${score.failures.join('; ')}` : ''}\n`);
        }
    }

    const overall = aggregate(scores);

    // The WER groups the report prints, and the two the gate reads.
    const languages = [...new Set(werResults.map(result => result.language))].sort();
    const conditions = [...new Set(werResults.map(result => result.condition))].sort();
    const byGroup = languages.flatMap(language => conditions.map((condition) => {
        const group = werResults.filter(result => result.language === language && result.condition === condition);
        return {
            language, condition,
            ...aggregateWer(group),
            // Only clips whose condition has a ceiling are counted. A text-mode run has no
            // condition to look one up by, so the denominator is zero and the report says so
            // rather than printing a reassuring "0 over".
            withCeiling: group.filter(result => result.ceiling !== null && result.wer !== null).length,
            overCeiling: group.filter(result => result.ceiling !== null && result.wer !== null && result.wer > result.ceiling).length
        };
    })).filter(group => group.clips > 0);

    const cleanByLanguage = Object.fromEntries(byGroup
        .filter(group => group.condition === 'clean')
        .map(group => [group.language, group]));
    const gate = applyGate(overall, cleanByLanguage);

    const latencies = rows.map(row => row.ms).filter(value => typeof value === 'number' && value > 0);
    const slowest = rows.filter(row => typeof row.ms === 'number' && row.ms > 0)
        .sort((a, b) => b.ms - a.ms)[0];
    const peaks = rows.map(row => row.peak_bytes).filter(value => typeof value === 'number');

    const confusion = ambiguityConfusion(scores);
    const columns = [...new Set(Object.values(confusion).flatMap(row => Object.keys(row)))].sort();

    return {
        candidate,
        revision: await revisionFor(candidate.modelSet),
        runnerDescription: runner.describe(),
        notes,
        clipCount: units.length,
        overall,
        gate,
        droppedByFilter,
        schemaValid,
        unparseable,
        perId: perIdMetrics(scores),
        ambiguity: {
            columns,
            rows: Object.entries(confusion).sort(([a], [b]) => a.localeCompare(b))
                .map(([expected, answered]) => [
                    `**${expected}**`, ...columns.map(column => String(answered[column] || 0))
                ])
        },
        wer: buildWerSection(byGroup, gate.thresholds.germanWerMargin),
        werGroups: byGroup,
        latency: { median: percentile(latencies, 0.5), p90: percentile(latencies, 0.9), slowest: slowest ? { ms: slowest.ms, id: `${slowest.case}.${slowest.condition}` } : null },
        memory: {
            peakBytes: peaks.length ? Math.max(...peaks) : null,
            how: peaks.length
                ? 'sampled from the child process every 100 ms — a floor, not a true peak (see runners.mjs)'
                : 'not measured; no process was started, or the platform gave no reading'
        },
        worstCases: rows.filter(row => !row.ok).slice(0, 40)
            .map(row => ({ id: row.case, clip: row.condition, failures: row.failures })),
        rows,
        englishButNotGerman: clearsEnglishButNotGerman(gate)
    };
};

/* ------------------------------------------------------------------------------------ */
/* Entry point                                                                            */
/* ------------------------------------------------------------------------------------ */

const gitCommit = async () => {
    try {
        const { stdout } = await promisify(execFile)('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot });
        return stdout.trim();
    } catch {
        return null;
    }
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(`${HELP}\n`); return 0; }

    const unknown = options.candidates.filter(id => !candidateById(id));
    if (unknown.length) throw new Error(`unknown candidate(s): ${unknown.join(', ')}\n\n${HELP}`);

    const suite = await readSuite();
    const inference = await loadInference();
    const { clips, skipped } = await discoverClips({ caseIds: suite.transcripts.map(entry => entry.id) });
    const speakers = await readSpeakers();
    const lock = await readLock();

    skipped.forEach(({ file, why }) => process.stderr.write(`skipped ${file}: ${why}\n`));

    // Read and parsed once. The file is accepted either as `{ transcripts: … }` or as the
    // bare map, and the `??` used to reach for the second by re-reading and re-parsing the
    // whole file from disk.
    const hypothesesFile = options.hypotheses
        ? JSON.parse(await readFile(options.hypotheses, 'utf8'))
        : null;
    const hypotheses = hypothesesFile ? (hypothesesFile.transcripts ?? hypothesesFile) : null;

    const runs = [];
    for (const id of options.candidates) {
        const candidate = candidateById(id);
        process.stdout.write(`\n== ${candidate.label}\n`);
        runs.push(await runCandidate({ candidate, suite, clips, options, inference, hypotheses }));
    }

    const clipTotal = [...clips.values()].reduce((sum, list) => sum + list.length, 0);
    const suiteSummary = {
        cases: suite.transcripts.length,
        pairs: new Set(suite.transcripts.map(entry => entry.pair)).size,
        en: suite.transcripts.filter(entry => entry.language === 'en').length,
        de: suite.transcripts.filter(entry => entry.language === 'de').length,
        other: suite.transcripts.filter(entry => !['en', 'de'].includes(entry.language)).length,
        ambiguityCases: suite.transcripts.filter(entry => entry.expect.ambiguity && entry.expect.ambiguity !== 'none').length,
        clips: clipTotal,
        speakers: speakers.consented.length,
        suiteSha: lock?.suite_sha ?? null,
        promptVersion: inference.PROMPT_VERSION,
        feelingIds: inference.activeFeelings().length
    };

    const date = today();
    const environment = {
        platform: process.platform, arch: process.arch, node: process.version, commit: await gitCommit()
    };

    // A dated file in `product_vision/eval/` is a claim that something was run (that
    // directory's README says so). A run with no weights in it is a claim about the harness,
    // so it is named for what it is and cannot be mistaken for a model evaluation.
    const scoredAnything = runs.some(run => run.clipCount > 0);
    const stem = runs.every(run => run.candidate.runtime === 'reference') ? 'harness-check' : 'model-eval';
    const markdownPath = options.out || join(repoRoot, 'product_vision/eval', `${stem}-${date}.md`);
    const jsonPath = markdownPath.replace(/\.md$/, '.json');

    // A dated file in `product_vision/eval/` is a claim that something was run (that
    // directory's README says so). A run in which every candidate turned out to be undrivable
    // scored nothing, so it has nothing to claim and writes no file — the summary below says
    // what happened, which is the useful output in that case.
    if (options.report && scoredAnything) {
        await writeReport({
            markdownPath, jsonPath, force: Boolean(options.force),
            markdown: renderReport({ runs, date, suiteSummary, environment }),
            data: {
                date, environment, suite: suiteSummary,
                runs: runs.map(run => ({
                    candidate: run.candidate, revision: run.revision, runner: run.runnerDescription,
                    overall: run.overall, gate: run.gate, wer: run.werGroups, perId: run.perId,
                    latency: run.latency, memory: run.memory, rows: run.rows
                }))
            }
        });
    }

    process.stdout.write('\n');
    runs.forEach((run) => {
        process.stdout.write(`${run.candidate.id.padEnd(24)} ${run.gate.verdict.toUpperCase().padEnd(11)}`
            + ` clips=${String(run.clipCount).padStart(4)}`
            + ` recall=${run.overall.mustIncludeRecall === null ? '—' : run.overall.mustIncludeRecall.toFixed(3)}`
            + ` violations=${run.overall.mustNotViolationRate === null ? '—' : run.overall.mustNotViolationRate.toFixed(3)}`
            + ` ambiguity=${run.overall.ambiguityAccuracy === null ? '—' : run.overall.ambiguityAccuracy.toFixed(3)}\n`);
        // The notes are the report's, but a run that writes no report still has to say why —
        // "INCOMPLETE, clips=0" on its own is a result nobody can act on.
        run.notes.forEach(note => process.stdout.write(`  ${note.replace(/\*\*/g, '')}\n`));
        if (run.englishButNotGerman) {
            process.stdout.write('  ^ clears every criterion but the German one. §12.1 makes that a product '
                + 'decision, not a technical one: stop and ask.\n');
        }
    });
    if (options.report && scoredAnything) {
        process.stdout.write(`\nreport: ${markdownPath.slice(repoRoot.length + 1)}\n`);
    } else if (options.report) {
        process.stdout.write('\nNo report written: nothing was scored, so there is nothing to report.\n'
            + 'Try `make journal-eval CANDIDATE=reference`, which needs no weights.\n');
    }

    // A failing gate is not a failing command: the harness did its job by saying so, and a
    // non-zero exit here would make `make journal-eval` unusable as the thing you run to find
    // out. The report is the verdict.
    return 0;
};

main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
