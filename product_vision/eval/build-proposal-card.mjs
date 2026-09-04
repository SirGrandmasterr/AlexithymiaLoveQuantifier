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
    id, label, gloss, hex
}));

const stamp = new Date().toISOString().slice(0, 10);
const template = await readFile(here('proposal-card.template.html'), 'utf8');

const html = template
    .replace('__VOCAB__', JSON.stringify(vocabulary, null, 2))
    .replace('__MAXFEEL__', String(journal.MAX_FEELINGS_PER_CHECKIN))
    .replace('__UNCLEAR__', journal.UNCLEAR_FEELING_ID)
    .replace('__INTENSITIES__', JSON.stringify(journal.INTENSITY_LEVELS))
    // The two sentences the real card (D2) and this fixture share, read from the app's copy so
    // the forbidden-word walk that covers `JOURNAL_COPY.proposal` covers this page too.
    .replace('__DASHED__', JSON.stringify(journal.JOURNAL_COPY.proposal.dashed))
    .replace('__REPHRASE__', JSON.stringify(journal.JOURNAL_COPY.proposal.notIt))
    .replace('__GENERATED__', stamp);

for (const token of ['__VOCAB__', '__MAXFEEL__', '__UNCLEAR__', '__INTENSITIES__', '__DASHED__', '__REPHRASE__', '__GENERATED__']) {
    if (html.includes(token)) throw new Error(`template still holds ${token}`);
}

await writeFile(here('proposal-card.html'), html, 'utf8');
console.log(`proposal-card.html — ${vocabulary.length} feelings, generated ${stamp}`);
