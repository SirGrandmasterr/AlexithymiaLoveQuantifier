/**
 * Finding the clips, checking their consent, and reading what they are.
 *
 * The layout this file expects is written down for humans in
 * `src/journal/inference/golden/audio/README.md`; this is the same rules as code:
 *
 *     golden/audio/<speaker-id>/<case-id>.<clean|noisy>.<ext>
 *
 * Two rules are load-bearing rather than tidy.
 *
 * **A speaker directory with no row in `consent/speakers.json` is refused, not skipped
 * quietly.** §5.7 asks that consent for a real clip is recorded alongside it, and the only
 * version of that promise which survives a busy afternoon is one the harness enforces.
 *
 * **Every clip found is evaluated.** If three people recorded `lucie.de`, that is three
 * clips, not one with two spares. A per-id recall that only holds for one voice is a fact
 * about that voice, and averaging it away is how a suite stops measuring what it was built
 * to measure.
 */
import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { repoRoot, today } from './paths.mjs';

export const GOLDEN_DIR = join(repoRoot, 'src/journal/inference/golden');
export const AUDIO_DIR = join(GOLDEN_DIR, 'audio');
export const CONSENT_DIR = join(GOLDEN_DIR, 'consent');
export const LOCK_FILE = join(AUDIO_DIR, 'manifest.lock.json');

export const CONDITIONS = ['clean', 'noisy'];

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

/** The three golden files, read together so a caller cannot use one without the others. */
export const readSuite = async () => ({
    transcripts: await json(join(GOLDEN_DIR, 'transcripts.json')),
    contexts: await json(join(GOLDEN_DIR, 'contexts.json')),
    recordings: await json(join(GOLDEN_DIR, 'recordings.json'))
});

const directories = async (path) => {
    try {
        return (await readdir(path, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
};

/**
 * `{ consented, unconsented, missing }` — the speakers with a row and a directory, the
 * directories with no row, and the rows whose directory is absent.
 *
 * A withdrawn speaker (`withdrawn` set to a date) counts as unconsented from that day on,
 * which is the point of keeping the row rather than deleting it: the next run's clip count
 * drops and the reason is on the record.
 */
export const readSpeakers = async () => {
    const register = await json(join(CONSENT_DIR, 'speakers.json'));
    const rows = new Map((register.speakers || []).map(speaker => [speaker.id, speaker]));
    const present = await directories(AUDIO_DIR);

    const consented = [];
    const unconsented = [];
    present.forEach((id) => {
        const row = rows.get(id);
        if (!row) { unconsented.push({ id, why: 'no row in consent/speakers.json' }); return; }
        if (row.withdrawn) { unconsented.push({ id, why: `withdrawn ${row.withdrawn}` }); return; }
        if (row.kind === 'human' && !row.consent_file) {
            unconsented.push({ id, why: 'row names no consent_file' });
            return;
        }
        consented.push(row);
    });

    return {
        consented,
        unconsented,
        missing: [...rows.values()].filter(row => !present.includes(row.id) && !row.withdrawn)
    };
};

const ACCEPTED = new Set(['.wav', '.m4a', '.mp3', '.ogg', '.opus', '.flac']);

/**
 * Read a canonical WAV's header without a decoder: sample rate, channels, bit depth and
 * duration, straight out of the RIFF chunks.
 *
 * A parser rather than a shell out to `ffprobe`, because `make journal-audio-check` should
 * tell an operator that their clips are the wrong sample rate on a machine that has no
 * ffmpeg yet — that is exactly the moment the answer is useful. A non-WAV file returns
 * `{ format: <ext> }` and nothing more; `prepare-audio.sh` is what turns it into one.
 */
export const probeWav = (buffer) => {
    if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
        return null;
    }
    let offset = 12;
    let fmt = null;
    let dataBytes = null;
    while (offset + 8 <= buffer.length) {
        const id = buffer.toString('ascii', offset, offset + 4);
        const size = buffer.readUInt32LE(offset + 4);
        if (id === 'fmt ' && offset + 8 + 16 <= buffer.length) {
            fmt = {
                audioFormat: buffer.readUInt16LE(offset + 8),
                channels: buffer.readUInt16LE(offset + 10),
                sampleRate: buffer.readUInt32LE(offset + 12),
                bitsPerSample: buffer.readUInt16LE(offset + 22)
            };
        }
        if (id === 'data') dataBytes = Math.min(size, buffer.length - offset - 8);
        offset += 8 + size + (size % 2);
    }
    if (!fmt) return null;
    const bytesPerFrame = (fmt.bitsPerSample / 8) * fmt.channels;
    return {
        ...fmt,
        seconds: dataBytes !== null && bytesPerFrame > 0 ? dataBytes / (bytesPerFrame * fmt.sampleRate) : null
    };
};

/** One clip on disk: its hash, its size and — for a WAV — what it actually is. */
export const probeClip = async (path) => {
    const bytes = (await stat(path)).size;
    const buffer = await readFile(path);
    return {
        path,
        bytes,
        sha256: createHash('sha256').update(buffer).digest('hex'),
        format: extname(path).slice(1).toLowerCase(),
        ...(probeWav(buffer) || {})
    };
};

/**
 * Every clip on disk that belongs to a consented speaker, indexed by `<case-id>|<condition>`.
 *
 * Returns `{ clips, skipped }`. `skipped` carries the files that were found under a speaker
 * with no consent, and the ones whose name does not parse — both are things an operator wants
 * named rather than counted.
 */
export const discoverClips = async ({ caseIds }) => {
    const { consented, unconsented } = await readSpeakers();
    const wanted = new Set(caseIds);
    const clips = new Map();
    const skipped = [];

    for (const { id: speaker, kind, languages } of consented) {
        const dir = join(AUDIO_DIR, speaker);
        const names = (await readdir(dir, { withFileTypes: true }))
            .filter(entry => entry.isFile())
            .map(entry => entry.name);

        for (const name of names) {
            const extension = extname(name).toLowerCase();
            if (!ACCEPTED.has(extension)) continue;
            const stem = name.slice(0, -extension.length);
            const dot = stem.lastIndexOf('.');
            const caseId = dot < 0 ? '' : stem.slice(0, dot);
            const condition = dot < 0 ? '' : stem.slice(dot + 1);
            if (!wanted.has(caseId) || !CONDITIONS.includes(condition)) {
                skipped.push({ file: join(speaker, name), why: 'name does not match <case-id>.<clean|noisy>' });
                continue;
            }
            const key = `${caseId}|${condition}`;
            clips.set(key, [...(clips.get(key) || []), {
                key, caseId, condition, speaker, speakerKind: kind || 'human', speakerLanguages: languages || [],
                path: join(dir, name)
            }]);
        }
    }

    for (const { id, why } of unconsented) {
        const dir = join(AUDIO_DIR, id);
        const count = (await readdir(dir).catch(() => [])).length;
        if (count) skipped.push({ file: `${id}/ (${count} files)`, why });
    }

    return { clips, skipped };
};

/**
 * The lock file: what each clip was, the last time the harness looked.
 *
 * It is the reason a checked-in report stays reproducible while the audio stays out of git.
 * A report names the lock's `suite_sha`, and anybody with the clips can prove they have the
 * same ones — or find out, by hash, exactly which clip was re-recorded since.
 */
export const readLock = async () => {
    try {
        return await json(LOCK_FILE);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
};

/** The one hash that stands for the whole set of clips: their per-clip hashes, in key order. */
export const suiteSha = (entries) => createHash('sha256')
    .update(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key} ${value.sha256}`).join('\n'))
    .digest('hex');

export const writeLock = async (entries, extra = {}) => {
    const payload = {
        _note: 'Written by `make journal-audio-check`. One row per clip found, keyed '
            + '`<case-id>|<condition>|<speaker>`. The audio itself is gitignored; this file is not, '
            + 'so a checked-in eval report can name a `suite_sha` that a later reader can verify '
            + 'against their own copy of the recordings. Do not hand-edit.',
        written: today(),
        suite_sha: suiteSha(entries),
        clips: entries,
        ...extra
    };
    await writeFile(LOCK_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
};
