import { describe, expect, it } from 'vitest';
import { DEFAULT_ARGS, createReferenceRunner, fillArgs } from './runners.mjs';
import { probeWav } from './audio.mjs';
import { CANDIDATES, TIER_DEFAULTS } from './candidates.mjs';

const values = (over = {}) => ({
    '<model>': '/m/gemma.gguf', '<mmproj>': null, '<prompt_file>': '/tmp/p.txt',
    '<schema_file>': '/tmp/s.json', '<audio>': null, ...over
});

describe('fillArgs', () => {
    it('passes temperature 0 and a schema, in both templates', () => {
        const llama = fillArgs(DEFAULT_ARGS['llama-mtmd-cli'], values());
        expect(llama).toContain('--temp');
        expect(llama[llama.indexOf('--temp') + 1]).toBe('0');
        expect(llama).toContain('/tmp/s.json');

        const litert = fillArgs(DEFAULT_ARGS['litert-lm'], values());
        expect(litert).toContain('--temperature=0');
        expect(litert.some(argument => argument.endsWith('s.json'))).toBe(true);
    });

    it('drops a separate-token flag together with its empty value', () => {
        // No mmproj and no audio: `--mmproj <mmproj>` and `--audio <audio>` both go, and the
        // flag does not survive its value, which would make the next argument its operand.
        const args = fillArgs(DEFAULT_ARGS['llama-mtmd-cli'], values());
        expect(args).not.toContain('--mmproj');
        expect(args).not.toContain('--audio');
        expect(args).toEqual(['-m', '/m/gemma.gguf', '--temp', '0', '--seed', '0',
            '--json-schema-file', '/tmp/s.json', '-f', '/tmp/p.txt', '--no-display-prompt', '-no-cnv']);
    });

    it('drops a joined flag whose value is empty', () => {
        expect(fillArgs(DEFAULT_ARGS['litert-lm'], values())).not.toContain('--audio_path=');
        expect(fillArgs(DEFAULT_ARGS['litert-lm'], values()).some(a => a.startsWith('--audio_path'))).toBe(false);
    });

    it('keeps the flags whose values are present', () => {
        const args = fillArgs(DEFAULT_ARGS['llama-mtmd-cli'], values({ '<audio>': '/clips/a.wav', '<mmproj>': '/m/mmproj.gguf' }));
        expect(args[args.indexOf('--audio') + 1]).toBe('/clips/a.wav');
        expect(args[args.indexOf('--mmproj') + 1]).toBe('/m/mmproj.gguf');
    });

    it('takes a template of its own, so a build with different spellings is a variable', () => {
        expect(fillArgs(['--model=<model>', '-t', '0'], values())).toEqual(['--model=/m/gemma.gguf', '-t', '0']);
    });
});

describe('probeWav', () => {
    const wav = ({ seconds = 1, sampleRate = 16000, channels = 1, bits = 16 } = {}) => {
        const frames = Math.round(seconds * sampleRate);
        const data = Buffer.alloc(frames * (bits / 8) * channels);
        const header = Buffer.alloc(44);
        header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
        header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
        header.writeUInt16LE(channels, 22); header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * (bits / 8) * channels, 28);
        header.writeUInt16LE((bits / 8) * channels, 32); header.writeUInt16LE(bits, 34);
        header.write('data', 36); header.writeUInt32LE(data.length, 40);
        return Buffer.concat([header, data]);
    };

    it('reads the four things the format check asks about', () => {
        expect(probeWav(wav({ seconds: 7.5 }))).toMatchObject({
            channels: 1, sampleRate: 16000, bitsPerSample: 16, seconds: 7.5
        });
    });

    it('notices the two ways a phone recording is wrong', () => {
        expect(probeWav(wav({ sampleRate: 44100 })).sampleRate).toBe(44100);
        expect(probeWav(wav({ channels: 2 })).channels).toBe(2);
        expect(probeWav(wav({ channels: 2, seconds: 3 })).seconds).toBe(3);
    });

    it('is null for anything that is not a WAV', () => {
        expect(probeWav(Buffer.from('not audio at all'))).toBe(null);
        expect(probeWav(Buffer.alloc(0))).toBe(null);
    });
});

describe('createReferenceRunner', () => {
    it('hands back the case\'s own reference, unchanged', async () => {
        const entry = { reference: { transcript: 'x', ambiguity: 'none' } };
        const answer = await createReferenceRunner().run({ entry });
        expect(JSON.parse(answer.raw)).toEqual(entry.reference);
        expect(answer.peakBytes).toBe(null);
    });
});

describe('the candidate table', () => {
    it('names one default per tier and no more', () => {
        expect(TIER_DEFAULTS.map(candidate => candidate.id).sort())
            .toEqual(['full-android', 'full-web', 'light-android-whisper', 'light-web']);
    });

    it('gives every candidate a device to be named in the report', () => {
        Object.values(CANDIDATES).forEach((candidate) => {
            expect(candidate.device, candidate.id).toBeTruthy();
            expect(['audio', 'text'], candidate.id).toContain(candidate.mode);
            expect(['PROPOSAL_SCHEMA', 'PROPOSAL_GRAMMAR_SCHEMA'], candidate.id).toContain(candidate.grammar);
        });
    });

    it('marks every candidate that answers an open §12.5 question', () => {
        expect(Object.values(CANDIDATES).filter(candidate => candidate.open_question).map(c => c.id).sort())
            .toEqual(['desktop-e4b', 'light-android-platform', 'light-android-whisper']);
    });

    it('keeps `reference` unable to masquerade as a tier default', () => {
        expect(CANDIDATES.reference.isDefaultFor).toBe(null);
        expect(CANDIDATES.reference.model).toBe(null);
    });
});
