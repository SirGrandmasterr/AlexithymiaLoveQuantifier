import { describe, it, expect } from 'vitest';
import { encodeWav, toBase64, wavBase64, WAV_MIME_TYPE } from './wav';
import { TARGET_SAMPLE_RATE } from '../recorder';

const readAscii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));

const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

describe('encodeWav', () => {
    it('writes a RIFF header a decoder can read', () => {
        const bytes = encodeWav(Float32Array.from([0, 0, 0, 0]), TARGET_SAMPLE_RATE);
        const data = view(bytes);

        expect(readAscii(bytes, 0, 4)).toBe('RIFF');
        expect(readAscii(bytes, 8, 4)).toBe('WAVE');
        expect(readAscii(bytes, 12, 4)).toBe('fmt ');
        expect(readAscii(bytes, 36, 4)).toBe('data');

        // Mono, 16-bit, at the rate the recorder captured — the three numbers a decoder
        // needs to play back what was actually said rather than a chipmunk.
        expect(data.getUint16(20, true)).toBe(1);
        expect(data.getUint16(22, true)).toBe(1);
        expect(data.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE);
        expect(data.getUint16(34, true)).toBe(16);
    });

    it('states the two sizes that have to agree with the bytes that follow', () => {
        const samples = Float32Array.from([0.1, -0.1, 0.2, -0.2, 0.3]);
        const bytes = encodeWav(samples, TARGET_SAMPLE_RATE);
        const data = view(bytes);

        expect(bytes.length).toBe(44 + samples.length * 2);
        // A wrong `data` size is the classic silent corruption: players read the header and
        // stop early, so a note is cut off with nothing to say it was.
        expect(data.getUint32(40, true)).toBe(samples.length * 2);
        expect(data.getUint32(4, true)).toBe(36 + samples.length * 2);
        expect(data.getUint32(28, true)).toBe(TARGET_SAMPLE_RATE * 2);
    });

    it('quantises the full-scale samples without wrapping', () => {
        const bytes = encodeWav(Float32Array.from([1, -1, 0]), TARGET_SAMPLE_RATE);
        const data = view(bytes);

        // 1.0 lands on 32767 and not on -32768, which is what a naive `* 0x8000` produces.
        expect(data.getInt16(44, true)).toBe(32767);
        expect(data.getInt16(46, true)).toBe(-32768);
        expect(data.getInt16(48, true)).toBe(0);
    });

    it('clamps samples that overshoot rather than letting them wrap round', () => {
        const bytes = encodeWav(Float32Array.from([1.8, -2.5]), TARGET_SAMPLE_RATE);
        const data = view(bytes);

        expect(data.getInt16(44, true)).toBe(32767);
        expect(data.getInt16(46, true)).toBe(-32768);
    });

    it('writes a valid empty file for a take with no samples', () => {
        const bytes = encodeWav(new Float32Array(0), TARGET_SAMPLE_RATE);
        expect(bytes.length).toBe(44);
        expect(view(bytes).getUint32(40, true)).toBe(0);
    });
});

describe('toBase64', () => {
    it('encodes bytes the way an inline part expects', () => {
        expect(toBase64(Uint8Array.from([104, 105]))).toBe('aGk=');
    });

    it('survives a take long enough to blow an argument list', () => {
        // Half a million samples is a thirty-second take at 16 kHz, which is precisely the
        // input `String.fromCharCode(...bytes)` cannot survive.
        const encoded = wavBase64(new Float32Array(480_000), TARGET_SAMPLE_RATE);
        expect(encoded.length).toBeGreaterThan(1000);
        expect(() => atob(encoded)).not.toThrow();
    });
});

describe('wavBase64', () => {
    it('round-trips through base64 back to the same header', () => {
        const encoded = wavBase64(Float32Array.from([0.5]), TARGET_SAMPLE_RATE);
        const decoded = Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0));

        expect(readAscii(decoded, 0, 4)).toBe('RIFF');
        // `setInt16` truncates toward zero, so half scale is 16383 and not 16384. Half a bit
        // at the bottom of a 16-bit sample, written down because a future "fix" that rounds
        // would change every byte of every file for no audible reason.
        expect(view(decoded).getInt16(44, true)).toBe(16383);
    });
});

describe('WAV_MIME_TYPE', () => {
    it('is the type the relay validates against', () => {
        expect(WAV_MIME_TYPE).toBe('audio/wav');
    });
});
