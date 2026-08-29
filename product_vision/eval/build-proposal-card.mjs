/**
 * Generates product_vision/eval/proposal-card.html from proposal-card.template.html and the
 * real vocabulary in src/constants/journal.js.
 *
 *   node product_vision/eval/build-proposal-card.mjs
 *
 * Why a generator rather than a hand-written mock-up: question 2 of the user test asks how
 * people react to a proposal, and a card whose words, glosses or colours had drifted from the
 * app's would be measuring the mock-up instead. The vocabulary is read from the constant the
 * app itself renders from, so the two cannot disagree — and after any change to FEELINGS this
 * command is the whole of the update.
 *
 * esbuild is used only to resolve the extensionless `./contextTags` import that Vite resolves
 * for the app and Node does not. It writes one file into the OS temp directory and removes it.
 */
import { build } from 'esbuild';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const here = (name) => join(root, 'product_vision', 'eval', name);

const scratch = await mkdtemp(join(tmpdir(), 'alq-u1-'));
const bundled = join(scratch, 'journal.mjs');

await build({
    entryPoints: [join(root, 'src', 'constants', 'journal.js')],
    bundle: true, format: 'esm', platform: 'node', outfile: bundled, logLevel: 'warning'
});

const journal = await import(pathToFileURL(bundled).href);
await rm(scratch, { recursive: true, force: true });

const vocabulary = journal.activeFeelings().map(({ id, label, gloss, hex }) => ({
    // The card renders a label, a gloss as its tooltip and a colour. Valence and energy are
    // the graph's axes and no chip reads them, so they are left out rather than copied into a
    // second place they could go stale.
    id, label, gloss, hex
}));

const stamp = new Date().toISOString().slice(0, 10);
const template = await readFile(here('proposal-card.template.html'), 'utf8');

const html = template
    .replace('__VOCAB__', JSON.stringify(vocabulary, null, 2))
    .replace('__MAXFEEL__', String(journal.MAX_FEELINGS_PER_CHECKIN))
    .replace('__UNCLEAR__', journal.UNCLEAR_FEELING_ID)
    .replace('__INTENSITIES__', JSON.stringify(journal.INTENSITY_LEVELS))
    .replace('__GENERATED__', stamp);

for (const token of ['__VOCAB__', '__MAXFEEL__', '__UNCLEAR__', '__INTENSITIES__', '__GENERATED__']) {
    if (html.includes(token)) throw new Error(`template still holds ${token}`);
}

await writeFile(here('proposal-card.html'), html, 'utf8');
console.log(`proposal-card.html — ${vocabulary.length} feelings, generated ${stamp}`);
