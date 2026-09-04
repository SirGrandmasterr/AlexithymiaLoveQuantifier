package com.thinkmusic.alexithymia.journal.gemma;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

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
