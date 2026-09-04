/**
 * The **retrieval** golden set, out of band (§5.8, session G2).
 *
 *     node scripts/journal-eval/retrieval.mjs [--out <path>] [--force] [--verbose]
 *
 * `make journal-eval` runs this before the proposal candidates, because unlike them it needs
 * no weights at all: the lexical half of §5.8's third use is the search the app ships, and
 * it can be scored on any machine in milliseconds.
 *
 * **What a run reports, and the distinction the whole file is built around.**
 *
 * A **lexical** case — *Fussball* finds *Fußball*, *Nebenkosten* finds
 * *Nebenkostenabrechnung*, *Umzug* finds a day that never says the word because it is filed
 * under a trigger whose label does — is answered by words. It passes or fails here, and the
 * number is about the shipped feature.
 *
 * A **semantic** case — *"Wann war ich zuletzt so ausgelaugt von meinem Job?"* reaching an
 * entry about being *erschöpft* after a day in the *Büro* — shares no content word with its
 * answer, and only EmbeddingGemma can bridge it. Without an embedder those are reported
 * **skipped, by name**. They are never graded against a stand-in: a hashed-n-gram embedder
 * would be measured instead of the model, and its number would sit in a report beside numbers
 * that are about a model.
 *
 * **There is no embedder here yet**, and that is a stated gap rather than a silent one. The
 * app's own `createWebEmbedder` is transformers.js under a browser's WASM, and the harness
 * runs under plain `node`; wiring one up is a session's work and belongs with the first
 * machine that has the 219 MB. `--embedder <path>` is the seam: a module default-exporting
 * `async (texts, kind) => number[][]`. `kind` is `'query'` or `'document'` and **the prefixes
 * are applied for it** — see `prefixed` — because a query embedded as a document is a point
 * in the wrong space with no symptom (§5.8, G1's second finding).
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadInference } from './load.mjs';
import { repoRoot, today } from './paths.mjs';
import { writeReport } from './report.mjs';

/* ------------------------------------------------------------------------------------ */
/* Arguments                                                                              */
/* ------------------------------------------------------------------------------------ */

export const parseArgs = (argv) => {
    const options = { report: true };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        const next = () => argv[index += 1];
        switch (argument) {
            case '--out': options.out = next(); break;
            case '--embedder': options.embedder = next(); break;
            case '--no-report': options.report = false; break;
            case '--force': options.force = true; break;
            case '--verbose': options.verbose = true; break;
            case '--help': options.help = true; break;
            default: throw new Error(`unknown option ${argument}`);
        }
    }
    return options;
};

const HELP = `
Usage: node scripts/journal-eval/retrieval.mjs [options]

  --embedder <path>  A module default-exporting async (texts, kind) => number[][].
                     Without it the semantic cases are reported as skipped, never as passes.
  --out <path>       Report path. Default product_vision/eval/retrieval-eval-<date>.md
  --no-report        Print the summary, write nothing.
  --force            Overwrite a report that already exists.
  --verbose          One line per case.
`.trim();

/* ------------------------------------------------------------------------------------ */
/* The embedder seam                                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * Wrap a user-supplied embedder so that the two mandatory prefixes and the 256-dimension
 * truncation are applied **here** rather than trusted to whoever wrote the module.
 *
 * Both are properties of the weights, not preferences of a harness, and both fail silently:
 * a vector without its prefix still has 256 numbers and still ranks. So the harness owns
 * them, and an embedder module only has to turn strings into arrays of numbers.
 */
export const wrapEmbedder = async (path, app) => {
    if (!path) return null;

    const module = await import(pathToFileURL(join(process.cwd(), path)).href);
    const embed = module.default ?? module.embed;
    if (typeof embed !== 'function') {
        throw new Error(`${path} must default-export an async (texts, kind) => number[][]`);
    }

    return async (texts, kind) => {
        const prefixed = texts.map(text => app.prefixed(text, kind));
        const raw = await embed(prefixed, kind);
        return raw.map(values => app.toIndexVector(values, app.INDEX_DIMS));
    };
};

/* ------------------------------------------------------------------------------------ */
/* The report                                                                             */
/* ------------------------------------------------------------------------------------ */

const row = (values) => `| ${values.join(' | ')} |`;

const statusMark = (status) => ({ pass: 'pass', fail: '**fail**', skipped: 'skipped' }[status] ?? status);

export const renderReport = ({ run, app, embedder, when }) => {
    const { summary, cases, documents } = run;

    const lines = [
        `# Retrieval evaluation — ${when}`,
        '',
        'The retrieval golden set of §5.8, scored by the application\'s own `recall`.',
        '*given these entries, query x returns y in the top three — in German and in English*',
        '',
        '## What was run',
        '',
        row(['', '']),
        row([':--', ':--']),
        row(['Suite', '`src/journal/embeddings/golden/retrieval.json`']),
        row(['Documents', `${documents} (journal entries and snapshot notes)`]),
        row(['Top-N rule', `${app.TOP_N}`]),
        row(['Embedder', embedder ? '`--embedder` supplied — see the run log' : '**none** — lexical half only']),
        row(['Lexical floors', `\`LEXICAL_FLOOR\` ${app.LEXICAL_FLOOR}, \`RELATIVE_FLOOR\` ${app.RELATIVE_FLOOR}`]),
        row(['Similarity floor', `\`SIMILARITY_FLOOR\` ${app.SIMILARITY_FLOOR}`]),
        '',
        '## Result',
        '',
        row(['Group', 'Total', 'Pass', 'Fail', 'Skipped']),
        row([':--', '--:', '--:', '--:', '--:']),
        row(['Lexical', summary.lexical.total, summary.lexical.pass, summary.lexical.fail, 0]),
        row(['Semantic', summary.semantic.total, summary.semantic.pass, summary.semantic.fail, summary.semantic.skipped]),
        row(['German', summary.byLanguage.de.total, summary.byLanguage.de.pass, summary.byLanguage.de.fail, '—']),
        row(['English', summary.byLanguage.en.total, summary.byLanguage.en.pass, summary.byLanguage.en.fail, '—']),
        row(['**All**', summary.total, summary.pass, summary.fail, summary.skipped]),
        '',
        '## Every case',
        '',
        row(['Case', 'Lang', 'Mode', 'Query', 'Wanted', 'Top three', 'Result']),
        row([':--', ':--', ':--', ':--', ':--', ':--', ':--']),
        ...cases.map(entry => row([
            `\`${entry.id}\``,
            entry.language,
            entry.mode,
            `*${entry.query}*`,
            entry.expect.join(', '),
            entry.top.length ? entry.top.join(', ') : '—',
            statusMark(entry.status)
        ])),
        ''
    ];

    if (summary.semantic.skipped > 0) {
        lines.push(
            '## What this run does not say',
            '',
            `**${summary.semantic.skipped} semantic cases were not run**, because no embedder was`,
            'supplied and their queries share no content word with their answers. They are the half',
            'of §5.8\'s third use that needs EmbeddingGemma, and until a machine with the weights runs',
            'them, nothing here is evidence about the model — only about the words.',
            '',
            'The same limit applies to `SIMILARITY_FLOOR`: it is still G1\'s starting value, chosen',
            'without a measurement, and this suite is the instrument that would move it.',
            '',
            'It also applies to §5.8\'s fourth use, *context for the proposal model*.',
            '`src/journal/embeddings/retrievalPrompt.test.js` proves structurally that a',
            'retrieval-influenced prompt cannot lose a word a clear case needs, cannot add a word the',
            'user never confirmed, cannot name a feeling, and changes no rule — over all 120 proposal',
            'golden cases in both languages. What it cannot prove is that no model is ever swayed by',
            'an **ordering**, which needs weights and a differential run of the proposal suite.',
            ''
        );
    }

    return lines.join('\n');
};

/* ------------------------------------------------------------------------------------ */
/* The run                                                                                */
/* ------------------------------------------------------------------------------------ */

export const main = async (argv = process.argv.slice(2)) => {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(HELP);
        return 0;
    }

    const app = await loadInference();
    const embed = await wrapEmbedder(options.embedder, app);

    const run = await app.runRetrievalSuite({ embed });
    const { summary } = run;

    if (options.verbose) {
        run.cases.forEach(entry => {
            console.log(
                `${entry.status.padEnd(8)} ${entry.id.padEnd(24)} ${entry.language} ${entry.mode.padEnd(9)}`
                + ` "${entry.query}" → ${entry.top.join(', ') || '—'}`
            );
        });
        console.log('');
    }

    console.log(`retrieval  documents=${run.documents}  top-${app.TOP_N}`);
    console.log(
        `  lexical   ${summary.lexical.pass}/${summary.lexical.total} pass`
        + (summary.lexical.fail ? `  ${summary.lexical.fail} FAIL` : '')
    );
    console.log(
        `  semantic  ${summary.semantic.pass}/${summary.semantic.total} pass`
        + `  ${summary.semantic.skipped} skipped (no embedder — never counted as passes)`
    );
    console.log(`  de ${summary.byLanguage.de.pass} pass / ${summary.byLanguage.de.fail} fail`
        + `   ·   en ${summary.byLanguage.en.pass} pass / ${summary.byLanguage.en.fail} fail`);

    run.cases.filter(entry => entry.status === app.RETRIEVAL_STATUS.fail).forEach(entry => {
        console.log(`  FAIL ${entry.id}: wanted ${entry.missing.join(', ')}, got ${entry.top.join(', ') || '—'}`);
    });

    if (options.report) {
        const when = today();
        const out = options.out ?? join(repoRoot, 'product_vision', 'eval', `retrieval-eval-${when}.md`);

        // `writeReport`, not a second overwrite policy. This file had its own, and it was
        // weaker in the way that loses work: it checked only the `.md` path and then wrote
        // both, so a `.json` sitting beside a report that had been renamed was clobbered
        // without a word. The shared one checks both paths and normalises the trailing
        // newline, so there is one rule for everything written into `product_vision/eval/`.
        //
        // Its refusal is **caught rather than propagated**, which is the one thing this stage
        // does differently from `run.mjs`: this stage is cheap and runs on every
        // `make journal-eval`, so a second run on the same day must print the numbers and say
        // it kept the existing report — not fail the target over a file it declined to touch.
        try {
            await writeReport({
                markdownPath: out,
                jsonPath: out.replace(/\.md$/, '.json'),
                markdown: renderReport({ run, app, embedder: options.embedder, when }),
                data: run,
                force: options.force
            });
            console.log(`\nWrote ${out}`);
        } catch (error) {
            console.log(`\n${error.message.split('\n')[0]} Kept it; pass --force to replace.`);
        }
    }

    // A lexical failure is a broken search and fails the target. A skipped semantic case is
    // an unrun measurement, which is a fact about this machine and not a defect.
    return summary.lexical.fail > 0 || summary.semantic.fail > 0 ? 1 : 0;
};

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then(code => { process.exitCode = code; }).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}
