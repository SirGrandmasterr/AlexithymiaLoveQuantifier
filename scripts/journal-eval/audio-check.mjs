/**
 * `make journal-audio-check` — what is on disk, what is missing, and what is wrong with it.
 *
 *     node scripts/journal-eval/audio-check.mjs [--write-lock] [--all]
 *
 * Run it as the recordings arrive. It answers four questions, in the order they matter:
 *
 *   1. Does every speaker directory have consent? (§5.7; a directory without it is refused)
 *   2. Which of the 240 clips exist, and which do not?
 *   3. Are the ones that exist the right format — 16 kHz, mono, PCM?
 *   4. Have any changed since the last look? (`--write-lock` records the answer)
 *
 * Nothing here loads a model, and it works on a machine with no ffmpeg: the WAV header is
 * parsed directly (`audio.mjs`), because "your clips are 44.1 kHz" is most useful on the
 * evening of the recording session and least useful a week later.
 */
import { stat } from 'node:fs/promises';
import { AUDIO_DIR, CONDITIONS, LOCK_FILE, discoverClips, probeClip, readLock, readSpeakers, readSuite, writeLock } from './audio.mjs';
import { repoRoot } from './paths.mjs';

const parseArgs = (argv) => ({
    writeLock: argv.includes('--write-lock'),
    all: argv.includes('--all')
});

const relative = (path) => path.slice(repoRoot.length + 1).replace(/\\/g, '/');

/**
 * `'derived'` when `prepare-audio.sh --noise` made this clip, `'recorded'` when it did not.
 *
 * The sidecar is the whole of the evidence, which is a deliberately weak claim: `'recorded'`
 * means "nothing here says it was synthesised", not "somebody went to a café". The report
 * prints the split so a reader can weigh the noisy numbers accordingly.
 */
const noiseOrigin = async (clipPath) => {
    const sidecar = clipPath.replace(/\.[^.]+$/, '.noise.txt');
    try {
        await stat(sidecar);
        return 'derived';
    } catch {
        return 'recorded';
    }
};

const main = async () => {
    const options = parseArgs(process.argv.slice(2));
    const { transcripts, recordings } = await readSuite();
    const speakers = await readSpeakers();
    const format = recordings.format;

    const out = (line = '') => process.stdout.write(`${line}\n`);

    /* 1. Consent ---------------------------------------------------------------------- */

    out('Speakers');
    if (!speakers.consented.length && !speakers.unconsented.length) {
        out(`  none yet — create ${relative(AUDIO_DIR)}/sp01/ and a row in consent/speakers.json`);
    }
    speakers.consented.forEach(speaker => out(
        `  ok       ${speaker.id.padEnd(20)} ${speaker.kind || 'human'}, ${(speaker.languages || []).join('/') || 'no languages stated'}`
    ));
    speakers.unconsented.forEach(({ id, why }) => out(`  REFUSED  ${id.padEnd(20)} ${why}`));
    speakers.missing.forEach(speaker => out(`  no dir   ${speaker.id.padEnd(20)} row exists, directory does not`));
    out();

    /* 2. and 3. Clips ----------------------------------------------------------------- */

    const { clips, skipped } = await discoverClips({ caseIds: transcripts.map(entry => entry.id) });
    const previous = (await readLock())?.clips || {};

    const problems = [];

    // The two files have to agree about what the suite is. A case with no row has no WER
    // ceiling and would be scored against nothing; a row with no case is a clip nobody will
    // ever be asked to record. `npm test` catches this too — this is the copy an operator sees.
    const rowFor = new Set(recordings.clips.map(row => row.case));
    transcripts.filter(entry => !rowFor.has(entry.id)).forEach(entry => problems.push(
        { level: 'suite', what: entry.id, why: 'no row in recordings.json — it would have no WER ceiling' }
    ));
    const caseIds = new Set(transcripts.map(entry => entry.id));
    recordings.clips.filter(row => !caseIds.has(row.case)).forEach(row => problems.push(
        { level: 'suite', what: row.case, why: 'a row in recordings.json with no case in transcripts.json' }
    ));

    const entries = {};
    let found = 0;
    let changed = 0;

    for (const entry of transcripts) {
        for (const condition of CONDITIONS) {
            const list = clips.get(`${entry.id}|${condition}`) || [];
            if (!list.length) {
                problems.push({ level: 'missing', what: `${entry.id}.${condition}`, why: 'no clip' });
                continue;
            }
            for (const clip of list) {
                const probe = await probeClip(clip.path);
                found += 1;
                const key = `${entry.id}|${condition}|${clip.speaker}`;
                entries[key] = {
                    speaker: clip.speaker, speaker_kind: clip.speakerKind, language: entry.language,
                    file: relative(clip.path), bytes: probe.bytes, sha256: probe.sha256,
                    format: probe.format, sample_rate: probe.sampleRate ?? null,
                    channels: probe.channels ?? null, seconds: probe.seconds ?? null,
                    // Whether this noisy clip was recorded in a room or derived from the clean
                    // take. `prepare-audio.sh --noise` leaves a `.noise.txt` beside every clip
                    // it makes, so its absence means this script did not make it — which is the
                    // stronger evidence, and the report should be able to say how much of the
                    // noisy set is which.
                    noise: condition === 'clean' ? null : await noiseOrigin(clip.path)
                };

                if (previous[key] && previous[key].sha256 !== probe.sha256) {
                    changed += 1;
                    problems.push({ level: 'changed', what: key, why: 're-recorded since the last lock' });
                }
                if (probe.format !== format.container) {
                    problems.push({ level: 'convert', what: relative(clip.path), why: `${probe.format}; run prepare-audio.sh` });
                    continue;
                }
                if (probe.sampleRate !== format.sample_rate) {
                    problems.push({ level: 'format', what: relative(clip.path), why: `${probe.sampleRate} Hz, wants ${format.sample_rate}` });
                }
                if (probe.channels !== format.channels) {
                    problems.push({ level: 'format', what: relative(clip.path), why: `${probe.channels} channels, wants ${format.channels}` });
                }
                if (probe.seconds !== null && probe.seconds > format.max_seconds) {
                    problems.push({ level: 'format', what: relative(clip.path), why: `${probe.seconds.toFixed(1)} s, over the ${format.max_seconds} s cap` });
                }
                if (probe.seconds !== null && probe.seconds < 0.5) {
                    problems.push({ level: 'format', what: relative(clip.path), why: `${probe.seconds.toFixed(2)} s — did the recording start?` });
                }
                const row = recordings.clips.find(clipRow => clipRow.case === entry.id);
                if (row && probe.seconds !== null && probe.seconds > row.seconds_hint * 3) {
                    problems.push({ level: 'long', what: relative(clip.path), why: `${probe.seconds.toFixed(1)} s against a hint of ${row.seconds_hint} s — is this the right case?` });
                }
            }
        }
    }

    const wanted = transcripts.length * CONDITIONS.length;
    const missing = problems.filter(problem => problem.level === 'missing');

    out('Clips');
    out(`  ${found} found, ${missing.length} of ${wanted} case/condition slots empty`);
    if (changed) out(`  ${changed} changed since the last lock`);
    out();

    const groups = ['suite', 'REFUSED', 'convert', 'format', 'long', 'changed'];
    const shown = problems.filter(problem => problem.level !== 'missing');
    if (shown.length) {
        out('Problems');
        groups.forEach((level) => {
            shown.filter(problem => problem.level === level)
                .forEach(problem => out(`  ${level.padEnd(8)} ${problem.what} — ${problem.why}`));
        });
        out();
    }
    skipped.forEach(({ file, why }) => out(`  skipped  ${file} — ${why}`));
    if (skipped.length) out();

    if (missing.length) {
        out(options.all ? 'Missing' : `Missing (first 20 of ${missing.length}; --all for the rest)`);
        (options.all ? missing : missing.slice(0, 20)).forEach(problem => out(`  ${problem.what}`));
        out();
    }

    /* 4. The lock --------------------------------------------------------------------- */

    if (options.writeLock) {
        const lock = await writeLock(entries, { clips_found: found, slots: wanted });
        out(`Wrote ${relative(LOCK_FILE)} — suite_sha ${lock.suite_sha.slice(0, 16)}…`);
    } else if (found) {
        out('Run again with --write-lock to record these hashes, which is what makes a report reproducible.');
    }

    // A missing clip is the normal state of this suite until somebody records it, so it is
    // not an error. A clip that is present and unusable is: an operator who ran this command
    // wants a non-zero exit to notice, and CI would want the same if this ever ran there.
    return shown.length ? 1 : 0;
};

main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
