import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* Peak memory */

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

/* The runners */

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
