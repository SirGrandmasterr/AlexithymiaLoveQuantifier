import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **`npm test` must never load weights** (§5.7), and this file is that sentence as a check
 * that can fail.
 *
 * The whole boundary is built to make it true: `propose(input, context, runtime)` takes its
 * runtime as an argument, so a component test hands in `createFakeRuntime(fixtures)` and no
 * suite has ever had a reason to reach for a real one. But "no reason to" is a habit, and a
 * habit is not a guarantee — a single `import { createWebRuntime }` added for convenience in
 * a component test would put 3.4 GB of model behind the next `npm test`, and the failure
 * would look like a slow suite rather than a mistake. It is the same shape of risk the
 * ledger already records for `fake.js` leaking the other way, into the app.
 *
 * So this walks every `*.test.js(x)` in `src/` and asserts that none of them imports a module
 * that can load a model. **It reads source rather than instrumenting the loader** on purpose:
 * a mocked-out import still counts as an import as far as the next reader is concerned, and
 * the rule this protects is about what the suite is allowed to depend on, not about what it
 * happened to execute on one run.
 *
 * The runtime *modules* are not themselves forbidden — `web.test.js` and `native.test.js`
 * exist to test them, and they do it with an injected `loadPipeline` / `loadModel` / fake
 * plugin, which is the seam that keeps the weights out. What is forbidden is a test importing
 * `@huggingface/transformers` itself, or the Capacitor plugin proxy, both of which are the
 * only two doors a real model could come through.
 */

const SRC = 'src';

const testFiles = (directory) => readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.jsx?$/.test(entry) ? [path] : [];
});

/**
 * The two modules that can put a model in memory.
 *
 * `@huggingface/transformers` is the library the web runtime dynamically imports; importing
 * it from a test pulls megabytes of loader into the suite and gives that test a way to fetch
 * a model. `@capacitor/core`'s `registerPlugin` is the other door: on a device it is the
 * bridge to the native engine, and in a suite it is a proxy that would let a test believe it
 * had one.
 */
const FORBIDDEN_IMPORTS = ['@huggingface/transformers', '@capacitor/core'];

/** `import … from 'x'`, `import 'x'`, and `await import('x')` — every form the repo uses. */
const importsOf = (source) => [
    ...source.matchAll(/(?:^|\s)import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
].map(match => match[1]);

describe('npm test never loads weights', () => {
    const files = testFiles(SRC);

    it('found the suites it is asserting about', () => {
        // The guard. A changed layout or a stricter glob would otherwise make every
        // assertion below pass over an empty list, which is C1's own "a check with no
        // negative control cannot fail" one directory up.
        expect(files.length).toBeGreaterThan(20);
        expect(files.some(path => path.includes('web.test.js'))).toBe(true);
    });

    it('would notice the import if one were there — the negative control', () => {
        // C1's rule, applied to this file: a check with no negative control is a check that
        // cannot fail. `web.js` really does import the model library, in the dynamic form,
        // and `native.js` really does reach the bridge through `journalPlugin.js`. If the
        // matcher below stops seeing them, the assertion after it has stopped meaning
        // anything and is passing over an empty list.
        const web = importsOf(readFileSync('src/journal/inference/web.js', 'utf8'));
        expect(web).toContain('@huggingface/transformers');

        const bridge = importsOf(readFileSync('src/mobile/journalPlugin.js', 'utf8'));
        expect(bridge).toContain('@capacitor/core');
    });

    it('imports neither the model library nor the native bridge, in any suite', () => {
        const offenders = files.flatMap((path) => {
            const imports = importsOf(readFileSync(path, 'utf8'));
            return imports
                .filter(specifier => FORBIDDEN_IMPORTS.includes(specifier))
                .map(specifier => `${path} imports ${specifier}`);
        });

        expect(offenders).toEqual([]);
    });

    it('keeps the real runtimes behind an injected loader, so importing one loads nothing', async () => {
        // The other half of the guarantee, and the reason the rule above is enough: building
        // a real runtime is free. No file is opened, no session is created, and nothing is
        // fetched until something asks it a question — which is what makes it safe for
        // `index.test.js` to construct all four.
        const { createWebRuntime } = await import('./web');
        const { createNativeRuntime } = await import('./native');

        const seen = [];
        const plugin = new Proxy({}, { get: (_t, name) => (...args) => { seen.push(String(name)); return Promise.resolve(args); } });

        createWebRuntime({ loadModel: async () => { throw new Error('should not be called'); } });
        createNativeRuntime({ plugin });

        expect(seen).toEqual([]);
    });
});
