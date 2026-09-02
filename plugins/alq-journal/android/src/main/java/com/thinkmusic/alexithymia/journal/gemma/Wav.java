package com.thinkmusic.alexithymia.journal.gemma;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * The recorder's samples, as the bytes LiteRT-LM's audio front-end reads.
 *
 * The whole app carries audio as {@code float[]} at 16 kHz mono, because that is what the
 * capture layer produces and what Whisper's spectrogram takes (§4.2). LiteRT-LM's
 * {@code Content.AudioBytes} takes a byte array, and what it decodes is a RIFF/WAVE file —
 * measured on 2026-09-02 by handing it one and watching its mel filterbank run. So this class
 * exists, and it is forty lines of header rather than a dependency.
 *
 * <p><b>16-bit PCM, and the rounding matters slightly.</b> A float sample is scaled by 32767
 * and clamped, not by 32768: −1.0 and +1.0 then map to −32767 and +32767, which is symmetric
 * and cannot overflow to the wrong sign on the positive rail. The error against a
 * 32768-scaling is one part in 32767 on the loudest sample of a note nobody is measuring.
 */
public final class Wav {

    private Wav() { }

    /** The sample rate everything in this feature agrees on. */
    public static final int SAMPLE_RATE = 16000;

    private static final int HEADER_BYTES = 44;
    private static final short PCM = 1;
    private static final short MONO = 1;
    private static final short BITS = 16;

    /** One mono 16 kHz clip as a complete RIFF/WAVE file. */
    public static byte[] mono16k(float[] samples) {
        int frames = samples == null ? 0 : samples.length;
        int dataBytes = frames * 2;

        ByteBuffer out = ByteBuffer.allocate(HEADER_BYTES + dataBytes).order(ByteOrder.LITTLE_ENDIAN);

        out.put(new byte[] { 'R', 'I', 'F', 'F' });
        out.putInt(36 + dataBytes);
        out.put(new byte[] { 'W', 'A', 'V', 'E' });

        out.put(new byte[] { 'f', 'm', 't', ' ' });
        out.putInt(16);                                  // PCM fmt chunk size
        out.putShort(PCM);
        out.putShort(MONO);
        out.putInt(SAMPLE_RATE);
        out.putInt(SAMPLE_RATE * MONO * BITS / 8);       // byte rate
        out.putShort((short) (MONO * BITS / 8));         // block align
        out.putShort(BITS);

        out.put(new byte[] { 'd', 'a', 't', 'a' });
        out.putInt(dataBytes);

        for (int i = 0; i < frames; i++) {
            float value = samples[i];
            if (value > 1f) value = 1f;
            if (value < -1f) value = -1f;
            out.putShort((short) Math.round(value * 32767f));
        }

        return out.array();
    }

    /** Several clips of one take are one note (§4.2) — joined before the header goes on. */
    public static byte[] mono16k(java.util.List<float[]> parts) {
        int total = 0;
        for (float[] part : parts) total += part.length;
        float[] joined = new float[total];
        int at = 0;
        for (float[] part : parts) {
            System.arraycopy(part, 0, joined, at, part.length);
            at += part.length;
        }
        return mono16k(joined);
    }

    /** Seconds of audio in a clip, for the log line that says how long a pass took per second. */
    public static double seconds(int samples) {
        return samples / (double) SAMPLE_RATE;
    }

    /** Unused buffer helper kept out of the public surface. */
    static ByteArrayOutputStream buffer() {
        return new ByteArrayOutputStream();
    }
}
