/**
 * The four ways a candidate can be asked a question.
 *
 * A runner is one function: `run({ prompt, schema, input })` → `{ raw, ms, peakBytes, note }`.
 * `raw` is whatever the thing said, as a string, unrepaired and unparsed — `validateProposal`
 * is what reads it, and it is the app's own, so the harness never gets to be more forgiving
 * than the app.
 *
 * | Runner | What it drives | Needs |
 * | :----- | :------------- | :---- |
 * | `reference` | Nothing. Answers with the golden reference. | — |
 * | `replay` | Nothing. Answers from a file captured elsewhere — the only way to score a model that runs on a phone. | a replay JSON |
 * | `llama-mtmd-cli` | llama.cpp's multimodal CLI, temperature 0, JSON schema as the grammar. | the binary and a GGUF |
 * | `litert-lm` | LiteRT-LM's CLI, temperature 0, the constrained decoder. | the binary and a `.litertlm` |
 *
 * **Temperature 0 is not a default here, it is an argument that is always passed**, because
 * §5.7's gate is a claim about a model and not about a sample of one. Where a runtime has no
 * temperature flag the runner says so in `note` and the report prints it.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ------------------------------------------------------------------------------------ */
/* Peak memory                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * Peak resident set size of a child process, sampled.
 *
 * Sampling and not accounting: Node has no portable way to read a child's high-water mark,
 * and `/usr/bin/time -v` does not exist on two of the three platforms this repo is developed
 * on. A 100 ms poll misses a spike shorter than that, so **the number is a floor, and the
 * report says so** rather than presenting it as the peak. For the figure §12.1 actually
 * wants — peak with the audio encoder loaded, on the oldest supported phone — the QA
 * checklist and a device profiler are the instrument, and the replay runner carries what
 * they measured.
 */
const sampleRss = (pid, platform = process.platform) => new Promise((resolve) => {
    const command = platform === 'win32'
        ? ['tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']]
        : ['ps', ['-o', 'rss=', '-p', String(pid)]];
    const child = spawn(command[0], command[1], { windowsHide: true });
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', () => {
        if (platform === 'win32') {
            // "image","pid","session","#","12,345 K"
            const match = out.match(/"([\d.,\s]+)\sK"\s*$/m);
            resolve(match ? Number(match[1].replace(/[^\d]/g, '')) * 1024 : null);
            return;
        }
        const kilobytes = Number(out.trim().split(/\s+/)[0]);
        resolve(Number.isFinite(kilobytes) ? kilobytes * 1024 : null);
    });
});

const SAMPLE_MS = 100;

/**
 * A `.cmd` or `.bat` needs `shell: true` on Windows.
 *
 * Node 22 refuses to `spawn` a batch file directly — it is a fixed security hole, not a bug —
 * and a wrapper script around a real binary is exactly how a llama.cpp or LiteRT-LM build gets
 * driven on this machine. Under the shell, Node does not quote for you, so an argument with a
 * space in it (a model path under *Program Files*, a temp directory with the user's name in
 * it) is quoted here or it arrives as two arguments.
 */
const needsShell = (command) => /\.(cmd|bat)$/i.test(command);
const quoteForShell = (argument) => (/[\s"]/.test(argument) ? `"${argument.replace(/"/g, '""')}"` : argument);

/** Spawn, capture stdout and stderr, time it, and watch its memory. */
const runProcess = (command, args, { cwd, timeoutMs = 600000 } = {}) => new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const shell = needsShell(command);
    const child = shell
        ? spawn(quoteForShell(command), args.map(quoteForShell), { cwd, windowsHide: true, shell: true })
        : spawn(command, args, { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let peakBytes = null;

    const timer = setInterval(async () => {
        const rss = await sampleRss(child.pid);
        if (rss !== null && (peakBytes === null || rss > peakBytes)) peakBytes = rss;
    }, SAMPLE_MS);

    const killer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', (error) => { clearInterval(timer); clearTimeout(killer); reject(error); });
    child.on('close', (code) => {
        clearInterval(timer);
        clearTimeout(killer);
        resolve({
            code, stdout, stderr, peakBytes,
            ms: Number(process.hrtime.bigint() - started) / 1e6
        });
    });
});

/* ------------------------------------------------------------------------------------ */
/* The runners                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * Answers every case with its own golden reference.
 *
 * The harness's self-check: a perfect score proves the scoring, the aggregation and the gate
 * are wired together correctly, and proves nothing at all about any model. It exists so that
 * a first real run's numbers can be trusted to be the model's rather than the arithmetic's,
 * and so that this whole directory is runnable on a machine with no weights on it.
 */
export const createReferenceRunner = () => ({
    id: 'reference',
    describe: () => ({ command: '(none)', note: 'no process is started and no weights are read' }),
    run: async ({ entry }) => ({
        raw: JSON.stringify(entry.reference),
        ms: 0,
        peakBytes: null,
        note: 'golden reference'
    })
});

/**
 * Answers from a file of outputs captured somewhere this harness cannot reach — which in
 * practice means a phone.
 *
 * The Android runtimes have no CLI: LiteRT-LM runs inside the app's own plugin, and the
 * platform recogniser only exists on a handset. So the device produces a JSON file keyed
 * `<case-id>|<condition>` and this runner scores it with exactly the same code as a local
 * run. The alternative — a second scoring path for Android — is how two tiers end up being
 * graded differently and nobody notices.
 *
 * The file may carry `ms` and `peak_bytes` per entry; a device measurement is better than
 * anything sampled here, and where it is present it is used.
 */
export const createReplayRunner = async (path) => {
    const file = JSON.parse(await readFile(path, 'utf8'));
    const answers = file.answers || file;
    return {
        id: 'replay',
        describe: () => ({
            command: `(replay of ${path})`,
            note: `${Object.keys(answers).length} recorded answers`
                + (file.device ? `, captured on ${file.device}` : '')
        }),
        run: async ({ entry, condition }) => {
            const hit = answers[`${entry.id}|${condition}`] ?? answers[entry.id];
            if (hit === undefined) return { raw: '', ms: null, peakBytes: null, note: 'no recorded answer' };
            return {
                raw: typeof hit === 'string' ? hit : (hit.raw ?? JSON.stringify(hit)),
                ms: typeof hit === 'object' ? (hit.ms ?? null) : null,
                peakBytes: typeof hit === 'object' ? (hit.peak_bytes ?? null) : null,
                note: 'replayed'
            };
        }
    };
};

/**
 * The default argument list for each CLI, as a template.
 *
 * **These flag names are taken from the two projects' documented interfaces and have not been
 * run against a binary in this repository's environment** — there is no llama.cpp and no
 * LiteRT-LM build on the machine D4 was written on, and inventing a verification would be
 * worse than saying so. Both templates are therefore overridable in one environment variable
 * each (`JOURNAL_EVAL_LLAMA_ARGS`, `JOURNAL_EVAL_LITERT_ARGS`), and the report prints the
 * command that actually ran. A build that spells `--temp` differently is a variable, not a
 * patch to this file.
 *
 * What is **not** negotiable, and what the report should be checked against: temperature 0
 * and a schema. §5.7's gate is a claim about a model, not about one sample from it.
 *
 * Placeholders: `<model>`, `<prompt_file>`, `<schema_file>`, `<audio>`, `<mmproj>`. An
 * argument whose placeholder resolves to nothing is dropped, which is how the same template
 * serves an audio pass and a text one.
 */
export const DEFAULT_ARGS = {
    'llama-mtmd-cli': [
        '-m', '<model>',
        '--mmproj', '<mmproj>',
        '--temp', '0',
        '--seed', '0',
        '--json-schema-file', '<schema_file>',
        '-f', '<prompt_file>',
        '--no-display-prompt',
        '-no-cnv',
        '--audio', '<audio>'
    ],
    'litert-lm': [
        '--model_path=<model>',
        '--temperature=0',
        '--top_k=1',
        '--prompt_file=<prompt_file>',
        '--constraint_json_schema_file=<schema_file>',
        '--audio_path=<audio>'
    ]
};

/**
 * Fill a template, and drop every argument whose placeholder came out empty.
 *
 * Two shapes have to survive: a separate-token flag (`--audio <path>`) and a joined one
 * (`--audio_path=<path>`). A joined argument that resolves to a bare `--flag=` is dropped;
 * a separate flag is dropped together with the value that would have followed it, which is
 * why this is a fold over the list rather than a `map`.
 */
export const fillArgs = (template, values) => {
    const resolve = (argument) => Object.entries(values)
        .reduce((text, [token, value]) => text.replaceAll(token, value ?? ''), argument);

    const out = [];
    for (let index = 0; index < template.length; index += 1) {
        const argument = template[index];
        const next = template[index + 1];
        const placeholder = /^<[a-z_]+>$/.test(next || '');
        if (placeholder && !resolve(next)) { index += 1; continue; }
        const filled = resolve(argument);
        if (/^--?[\w-]+=$/.test(filled)) continue;
        out.push(filled);
    }
    return out;
};

/**
 * One CLI runner for both engines: spawn a binary with a filled template, hand back stdout.
 *
 * The prompt goes in a file rather than in an argument. It is 4.6 kB, Windows has an
 * argument-length limit a 4.6 kB `-p` would meet on a bad day, and a prompt that was silently
 * truncated by an operating system would look exactly like a model that ignored its rules.
 *
 * stdout is returned unrepaired. `parseModelJson` in the app is what strips a code fence or a
 * banner, and it is the app's, so the harness can never be more forgiving than the screen.
 */
export const createCliRunner = ({ kind, binary, model, mmproj = null, argTemplate = null, extraArgs = [] }) => {
    const template = argTemplate || DEFAULT_ARGS[kind];
    return {
        id: kind,
        describe: () => ({
            command: [binary, ...fillArgs(template, {
                '<model>': model, '<mmproj>': mmproj, '<prompt_file>': 'prompt.txt',
                '<schema_file>': 'schema.json', '<audio>': 'clip.wav'
            }), ...extraArgs].join(' '),
            note: kind === 'litert-lm'
                ? 'temperature 0; LLGuidance constrained decoding. §5.2: the grammar schema relaxes '
                  + '`tag` to a bounded string, because a tag containing a space breaks that parser'
                : 'temperature 0; the output schema as a GBNF grammar'
        }),
        run: async ({ prompt, schema, input }) => {
            const scratch = await mkdtemp(join(tmpdir(), 'alq-eval-'));
            try {
                const promptFile = join(scratch, 'prompt.txt');
                const schemaFile = join(scratch, 'schema.json');
                await writeFile(promptFile, prompt, 'utf8');
                await writeFile(schemaFile, JSON.stringify(schema), 'utf8');

                const args = [...fillArgs(template, {
                    '<model>': model,
                    '<mmproj>': mmproj,
                    '<prompt_file>': promptFile,
                    '<schema_file>': schemaFile,
                    '<audio>': input.kind === 'audio' ? input.path : null
                }), ...extraArgs];

                const result = await runProcess(binary, args);
                return {
                    raw: result.stdout,
                    ms: result.ms,
                    peakBytes: result.peakBytes,
                    note: result.code === 0
                        ? null
                        : `exit ${result.code}: ${(result.stderr.trim().split('\n').at(-1) || '').slice(0, 200)}`
                };
            } finally {
                await rm(scratch, { recursive: true, force: true });
            }
        }
    };
};

/** Build the runner a candidate names, from the environment the Makefile passes in. */
export const createRunner = async (candidate, environment = process.env) => {
    const split = (value) => (value || '').split(' ').filter(Boolean);
    const extraArgs = split(environment.JOURNAL_EVAL_EXTRA_ARGS);

    switch (candidate.runtime) {
        case 'reference':
            return createReferenceRunner();

        case 'replay': {
            const path = environment.JOURNAL_EVAL_REPLAY;
            if (!path) {
                throw new Error(`candidate "${candidate.id}" runs on a device this harness cannot drive; `
                    + 'score it from a capture with JOURNAL_EVAL_REPLAY=<file> '
                    + '(scripts/journal-eval/README.md).');
            }
            return createReplayRunner(path);
        }

        case 'llama-mtmd-cli': {
            const binary = environment.JOURNAL_EVAL_LLAMA_BIN;
            const model = environment.JOURNAL_EVAL_MODEL;
            if (!binary || !model) {
                throw new Error(`candidate "${candidate.id}" needs JOURNAL_EVAL_LLAMA_BIN and JOURNAL_EVAL_MODEL`);
            }
            return createCliRunner({
                kind: 'llama-mtmd-cli', binary, model,
                mmproj: environment.JOURNAL_EVAL_MMPROJ || null,
                argTemplate: environment.JOURNAL_EVAL_LLAMA_ARGS ? split(environment.JOURNAL_EVAL_LLAMA_ARGS) : null,
                extraArgs
            });
        }

        case 'litert-lm': {
            const binary = environment.JOURNAL_EVAL_LITERT_BIN;
            const model = environment.JOURNAL_EVAL_MODEL;
            if (!binary || !model) {
                throw new Error(`candidate "${candidate.id}" needs JOURNAL_EVAL_LITERT_BIN and JOURNAL_EVAL_MODEL`);
            }
            return createCliRunner({
                kind: 'litert-lm', binary, model,
                argTemplate: environment.JOURNAL_EVAL_LITERT_ARGS ? split(environment.JOURNAL_EVAL_LITERT_ARGS) : null,
                extraArgs
            });
        }

        default:
            throw new Error(`unknown runtime "${candidate.runtime}"`);
    }
};
