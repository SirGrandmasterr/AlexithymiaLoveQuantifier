/**
 * PCM to WAV, and WAV to base64.
 *
 * The recorder hands every runtime the same thing: mono `Float32Array` samples at
 * `TARGET_SAMPLE_RATE` (§4.2). The on-device runtimes take that array as it is, because
 * transformers.js and LiteRT-LM both want raw samples. A model reached over HTTP wants a
 * *file*, so this is the one place that turns the take into one — 16-bit PCM in a RIFF
 * container, which is the plainest thing every decoder agrees on and the format Gemini names
 * first among the audio types it accepts.
 *
 * Nothing here is lossy beyond the float-to-int16 quantisation, and nothing here resamples:
 * the samples arrive at 16 kHz and leave at 16 kHz, so what the cloud model hears is exactly
 * what the on-device model would have heard. That is what makes the two paths comparable
 * when a note is proposed twice.
 */

/** What `encodeWav` writes, and what the relay validates before forwarding. */
export const WAV_MIME_TYPE = 'audio/wav';

/** 16-bit signed PCM, which is `1` in a RIFF `fmt ` chunk. */
const FORMAT_PCM = 1;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;
const HEADER_BYTES = 44;

const writeAscii = (view, at, text) => {
    for (let index = 0; index < text.length; index += 1) {
        view.setUint8(at + index, text.charCodeAt(index));
    }
};

/**
 * Clamp, then scale. The asymmetry is deliberate and is what every encoder does: int16 runs
 * from -32768 to 32767, so a sample of exactly 1.0 has to land on 32767 rather than wrap.
 */
const toInt16 = (sample) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
};

/**
 * One take as a WAV file.
 *
 * @param {Float32Array} samples mono samples in [-1, 1]
 * @param {number} sampleRate the rate the samples were captured at
 * @returns {Uint8Array} the whole file, header included
 */
export const encodeWav = (samples, sampleRate) => {
    const audio = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 16_000;

    const dataBytes = audio.length * (BITS_PER_SAMPLE / 8);
    const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
    const view = new DataView(buffer);
    const byteRate = rate * CHANNELS * (BITS_PER_SAMPLE / 8);
    const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

    // RIFF, little-endian throughout — the `true` on every multi-byte write.
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');

    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);           // the size of this chunk, which PCM fixes at 16
    view.setUint16(20, FORMAT_PCM, true);
    view.setUint16(22, CHANNELS, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, BITS_PER_SAMPLE, true);

    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);

    for (let index = 0; index < audio.length; index += 1) {
        view.setInt16(HEADER_BYTES + index * 2, toInt16(audio[index]), true);
    }

    return new Uint8Array(buffer);
};

/**
 * Base64 without a `data:` prefix, which is what an inline part on the wire is.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)`: a thirty-second take is half a
 * million samples, and spreading a million-element array into an argument list is how a call
 * stack overflows on exactly the input this function exists for.
 */
export const toBase64 = (bytes) => {
    const CHUNK = 0x8000;
    let binary = '';
    for (let at = 0; at < bytes.length; at += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
    }

    if (typeof btoa === 'function') return btoa(binary);
    // Node, where the tests run.
    return Buffer.from(binary, 'binary').toString('base64');
};

/** The whole trip: samples in, the string that goes on the wire out. */
export const wavBase64 = (samples, sampleRate) => toBase64(encodeWav(samples, sampleRate));
