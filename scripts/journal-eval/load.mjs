/**
 * The bridge from `node` to `src/`.
 *
 * The app's modules import each other without file extensions (`./contextTags`, not
 * `./contextTags.js`), which Vite resolves and Node does not. The harness has to run under
 * plain `node` — it drives subprocesses and waits minutes on gigabytes of weights, and
 * neither belongs in a test runner — so it bundles what it needs with esbuild first, exactly
 * as `product_vision/eval/build-proposal-card.mjs` does for the same reason.
 *
 * **The point is that the harness scores a model against the validator the app actually
 * ships.** A harness-local copy of `validateProposal` would be a filter that agrees with the
 * real one until the day it does not, and the day it does not is the day a report says a
 * model is safe when the app would drop half its answers.
 *
 * One temp directory per process, removed as soon as the bundle is imported.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './paths.mjs';

/** The modules the harness is allowed to use, and nothing else. */
const SURFACE = [
    ['validateProposal, emptyProposal', 'src/journal/inference/validate.js'],
    ['buildPrompt, PROMPT_VERSION, PROMPT_RULES', 'src/journal/inference/prompt.js'],
    ['PROPOSAL_SCHEMA, PROPOSAL_GRAMMAR_SCHEMA, buildSchema, checkSchema', 'src/journal/inference/schema.js'],
    ['parseModelJson', 'src/journal/inference/parse.js'],
    ['buildContext', 'src/journal/inference/index.js'],
    ['FEELINGS, activeFeelings', 'src/constants/journal.js'],
    ['CONTEXT_TAGS', 'src/constants/contextTags.js'],
    // G2. The retrieval golden set is scored by the **app's own** `recall` for the same
    // reason the proposals are validated by the app's own validator: a harness-local copy of
    // the search would agree with the shipped one until the day it did not, and that is the
    // day a report says retrieval works when the screen does something else.
    [
        'RETRIEVAL_SUITE, RETRIEVAL_MODES, RETRIEVAL_STATUS, TOP_N, runRetrievalSuite, suiteDocuments',
        'src/journal/embeddings/retrievalGolden.js'
    ],
    ['EMBEDDING_PREFIXES, EMBED_KINDS, INDEX_DIMS, prefixed, toIndexVector', 'src/journal/embeddings/embed.js'],
    ['SIMILARITY_FLOOR', 'src/journal/embeddings/similar.js'],
    ['LEXICAL_FLOOR, RELATIVE_FLOOR', 'src/journal/embeddings/recall.js']
];

/**
 * The six packages those modules drag in, and an inert stand-in for each.
 *
 * Written out by name and by export rather than resolved through a catch-all proxy, for two
 * reasons. Esbuild copies a CommonJS module's *own* property names into the ESM namespace, so
 * a proxy that answers every property is copied as no properties at all — the trick simply
 * does not work. And a named list is reviewable: these are the seams between the pure half of
 * `src/journal/inference/` and the platform, and a seventh appearing is something a reader of
 * this file should have to notice.
 *
 * A bare import that is **not** in this table is a build error rather than a silent stub, for
 * the same reason `checkSchema` throws on a keyword it does not enforce: a dependency quietly
 * replaced with nothing is worse than one that is not there.
 */
const STUBS = {
    // `platform.js` and `journalPlugin.js`. `isNativePlatform()` must answer false, or every
    // module below it takes the Android branch on a desktop.
    '@capacitor/core': [
        "export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };",
        'export const registerPlugin = () => ({});'
    ].join('\n'),
    // `recorder.js`, for the listener that stops a recording when the app is backgrounded.
    '@capacitor/app': 'export const App = { addListener: async () => ({ remove: () => {} }) };',
    // `serverUrl.js`. Nothing in the harness makes a request; §5.7's eval is offline by
    // construction, and a stub that throws is what makes that a fact rather than an intention.
    axios: [
        'const refuse = () => { throw new Error("the eval harness makes no requests"); };',
        // `defaults` is written to at module scope by `applyServerUrl`; the verbs throw, so a
        // request that somehow got as far as being made would be loud rather than silent.
        'export default { defaults: {}, get: refuse, post: refuse, put: refuse, delete: refuse, request: refuse };'
    ].join('\n'),
    // `web.js`'s two Vite asset aliases; in the app these resolve to URLs of emitted files.
    'alq-ort-wasm': "export default '';",
    'alq-ort-mjs': "export default '';",
    // `web.js` reaches transformers.js through a *dynamic* import that only runs inside
    // `createWebRuntime`, which the harness never calls.
    '@huggingface/transformers': 'export default {};'
};

/**
 * What was stubbed on the last build, recorded so a session debugging a surprising import can
 * read it. **`--verbose` does not print it** — the comment here said it did, and neither
 * verbose path in `run.mjs` or `retrieval.mjs` touches this list.
 */
export let stubbedPackages = [];

const stubBareImports = (resolveDir) => ({
    name: 'alq-stub-bare',
    setup(esbuild) {
        // Anything that is not a relative specifier. Entry points, absolute paths and `node:`
        // builtins are let through by the guards.
        esbuild.onResolve({ filter: /^[^.]/ }, (args) => {
            if (args.kind === 'entry-point' || isAbsolute(args.path) || args.path.startsWith('node:')) return null;
            if (!(args.path in STUBS)) {
                return {
                    errors: [{
                        text: `journal-eval: no stub for "${args.path}", imported by ${args.importer}. `
                            + 'Add one to STUBS in scripts/journal-eval/load.mjs, or keep the package out '
                            + 'of the pure modules the harness bundles.'
                    }]
                };
            }
            stubbedPackages.push(args.path);
            return { path: args.path, namespace: 'alq-stub' };
        });
        esbuild.onLoad({ filter: /.*/, namespace: 'alq-stub' }, (args) => (
            { contents: STUBS[args.path], loader: 'js', resolveDir }
        ));
    }
});

let loaded = null;

/**
 * `{ validateProposal, buildPrompt, PROMPT_VERSION, PROPOSAL_SCHEMA, PROPOSAL_GRAMMAR_SCHEMA,
 * buildContext, FEELINGS, … }` — the app's own inference boundary, bundled once per process.
 */
export const loadInference = async () => {
    if (loaded) return loaded;

    const scratch = await mkdtemp(join(tmpdir(), 'alq-d4-'));
    const entry = join(scratch, 'entry.mjs');
    const outfile = join(scratch, 'inference.mjs');
    stubbedPackages = [];

    await writeFile(entry, SURFACE
        .map(([names, file]) => `export { ${names} } from ${JSON.stringify(join(repoRoot, file))};`)
        .join('\n'), 'utf8');

    await build({
        entryPoints: [entry],
        bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'warning',
        // `src/mobile/serverUrl.js` reads `import.meta.env`, which is Vite's and does not
        // exist under node. An empty object rather than the real environment: the harness
        // must not pick up a `VITE_*` value from whoever happens to be running it, and every
        // module that reads one has a literal fallback beside it.
        define: { 'import.meta.env': '{}' },
        plugins: [stubBareImports(scratch)]
    });

    const module = await import(pathToFileURL(outfile).href);
    await rm(scratch, { recursive: true, force: true });
    stubbedPackages = [...new Set(stubbedPackages)].sort();
    loaded = module;
    return module;
};
