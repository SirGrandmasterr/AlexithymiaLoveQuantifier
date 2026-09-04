import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const golden = join(root, 'src/journal/inference/golden');
const here = (name) => join(root, 'product_vision/eval', name);

const transcripts = JSON.parse(await readFile(join(golden, 'transcripts.json'), 'utf8'));
const recordings = JSON.parse(await readFile(join(golden, 'recordings.json'), 'utf8'));

const clipRows = new Map(recordings.clips.map(row => [row.case, row]));

const DIRECTIONS = {
    'quiet-voice': 'Quietly, close to the microphone, the way somebody actually says this.',
    emphatic: 'Loud and close. Let it clip a little — that is the point.',
    'fast-list': 'Fast. No pauses between the items.',
    'filler-heavy': 'Keep the fillers, the false start and the rising question. Do not tidy it up.',
    'long-run-on': 'One breath group. No full stops in the delivery, however long it gets.',
    'short-utterance': 'Just the two words. Nothing before, nothing after.',
    colloquial: 'Ordinary speaking register, not a reading voice.',
    rambling: 'Unhurried and a little aimless, the way somebody thinks out loud.',
    'code-switch': 'Say the quoted phrase in its own language, as you would in life.',
    numbers: 'Say the numbers as words, as written.',
    abbreviations: 'Say the letters, one by one.',
    'name-unfamiliar': 'The name matters. Say it the way you would if you knew them.',
    'place-names': 'The place name matters as much as the sentence around it.',
    'other-language': 'The one pair whose halves swap languages on purpose, to find out whether the '
        + 'model reports the language it heard. The file name is the case id, not the language.'
};

const LANGUAGE_NAMES = { en: 'English', de: 'German (Deutsch)', fr: 'French (français)' };

/** How long this script's sentences take to say, from the suite's own per-clip estimates. */
const minutes = (cases) => {
    const seconds = cases.reduce((sum, entry) => sum + (clipRows.get(entry.id)?.seconds_hint || 0), 0);
    return seconds < 90 ? `${Math.round(seconds)} seconds` : `${Math.round(seconds / 60)} minutes`;
};

const languages = [...new Set(transcripts.map(entry => entry.language))].sort();

const preamble = (language, cases) => [
    `# Recording script — ${LANGUAGE_NAMES[language] || language}`,
    '',
    '**Generated from `src/journal/inference/golden/transcripts.json`. Do not hand-edit** — a word',
    'changed here and not there becomes a permanent error in every word error rate computed from',
    'the recording. To change a sentence, change it in the suite (in *both* halves of its pair),',
    'run `npm test`, then re-run `node product_vision/eval/build-recording-scripts.mjs`.',
    '',
    `${cases.length} sentence${cases.length === 1 ? '' : 's'}, about ${minutes(cases)} of speech. Read`,
    'each one **exactly as written**, twice: once for the clean take and — if you are recording the',
    'noisy one in a real room rather than deriving it — once more there. Allow three or four times',
    'the speech length in wall clock, for setup, re-takes and stopping between sentences.',
    '',
    '## Before you start',
    '',
    '- A quiet room. No music, no second voice, nothing running that hums.',
    '- 20–30 cm from the microphone. A phone is fine; a phone held at arm\'s length is not.',
    '- Say your speaker id out loud once at the start of the session, not into any clip.',
    '- **These sentences are not about you.** They describe an invented person\'s day, with',
    '  invented friends called Alex, Lucie and Sam. Nothing in them is true of anybody.',
    '- Read the sentence, not the meaning. If a line feels wrong to say, say so afterwards —',
    '  that is worth knowing — but read it as written for the recording.',
    '- A mistake is not a problem: stop, pause, and say the whole sentence again. Only the last',
    '  take needs to be in the file.',
    '',
    '## Saving',
    '',
    'One folder for you, named `sp01`, `sp02`, … (whichever you were given), inside',
    '`src/journal/inference/golden/audio/`. Save each clip as the **File** column says, exactly.',
    'Full instructions, including what to do with a phone recording, are in',
    '[`audio/README.md`](../../src/journal/inference/golden/audio/README.md).',
    '',
    '---',
    '',
    ''
].join('\n');

const caseBlock = (entry, index) => {
    const row = clipRows.get(entry.id);
    const direction = DIRECTIONS[entry.pair];
    const suffix = entry.id.split('.').pop();
    const mismatch = entry.language !== suffix;
    return [
        `### ${index + 1}. \`${entry.id}\``,
        '',
        `> ${entry.transcript}`,
        '',
        `**File:** \`${entry.id}.clean.wav\` — and \`${entry.id}.noisy.wav\` for the noisy take.`,
        `**About:** ${row ? `${row.words} words, roughly ${row.seconds_hint} s` : 'unmeasured'}.`,
        ...(mismatch ? ['', `**Note:** this sentence is in ${LANGUAGE_NAMES[entry.language] || entry.language} `
            + `although the file name ends \`.${suffix}\`. That is deliberate; save it under the name above.`] : []),
        ...(direction ? ['', `**How to say it:** ${direction}`] : []),
        ''
    ].join('\n');
};

for (const language of languages) {
    const cases = transcripts.filter(entry => entry.language === language);
    const body = cases.map(caseBlock).join('\n');
    const path = here(`recording-script-${language}.md`);
    await writeFile(path, `${preamble(language, cases)}${body}`.trimEnd() + '\n', 'utf8');
    process.stdout.write(`${path.slice(root.length + 1)} — ${cases.length} sentences\n`);
}
