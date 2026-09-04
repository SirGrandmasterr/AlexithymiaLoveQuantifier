import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'src';

const testFiles = (directory) => readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return testFiles(path);
    return /\.test\.jsx?$/.test(entry) ? [path] : [];
});

const FORBIDDEN_IMPORTS = ['@huggingface/transformers', '@capacitor/core'];

/** `import … from 'x'`, `import 'x'`, and `await import('x')` — every form the repo uses. */
const importsOf = (source) => [
    ...source.matchAll(/(?:^|\s)import\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g),
    ...source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
].map(match => match[1]);

describe('npm test never loads weights', () => {
    const files = testFiles(SRC);

    it('found the suites it is asserting about', () => {
        expect(files.length).toBeGreaterThan(20);
        expect(files.some(path => path.includes('web.test.js'))).toBe(true);
    });

    it('would notice the import if one were there — the negative control', () => {
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
        const { createWebRuntime } = await import('./web');
        const { createNativeRuntime } = await import('./native');

        const seen = [];
        const plugin = new Proxy({}, { get: (_t, name) => (...args) => { seen.push(String(name)); return Promise.resolve(args); } });

        createWebRuntime({ loadModel: async () => { throw new Error('should not be called'); } });
        createNativeRuntime({ plugin });

        expect(seen).toEqual([]);
    });
});
