package com.thinkmusic.alexithymia.journal;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

public final class AudioCapture {

    public interface Listener {
        void onLevel(float rms);

        /** The capture reached `maxMs` and stopped itself. `stop()` returns the samples. */
        void onLimit();
    }

    public static final int SAMPLE_RATE = 16_000;
    private static final int LEVEL_WINDOW = 1024;
    private static final int READ_CHUNK = SAMPLE_RATE / 20; // 50 ms

    private final Listener listener;
    private final Object lock = new Object();

    private AudioRecord record;
    private Thread thread;
    private float[] buffer;
    private int written;
    private volatile boolean running;
    private boolean finished;

    public AudioCapture(Listener listener) {
        this.listener = listener;
    }

    /** Open the device and start filling the buffer. Throws if the device will not open. */
    public void start(int maxMs) {
        synchronized (lock) {
            if (running || record != null) throw new IllegalStateException("already capturing");

            int maxSamples = (int) Math.min((long) SAMPLE_RATE * Math.max(1000, maxMs) / 1000L, (long) SAMPLE_RATE * 60);
            int minBytes = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT);
            int bufferBytes = Math.max(minBytes, SAMPLE_RATE * 4); // a second, so a slow tick loses nothing

            AudioRecord opened = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_FLOAT,
                bufferBytes
            );
            if (opened.getState() != AudioRecord.STATE_INITIALIZED) {
                opened.release();
                throw new IllegalStateException("the microphone did not open");
            }

            record = opened;
            buffer = new float[maxSamples];
            written = 0;
            finished = false;
            running = true;
            opened.startRecording();

            thread = new Thread(this::pump, "alq-journal-capture");
            thread.start();
        }
    }

    private void pump() {
        float[] chunk = new float[READ_CHUNK];
        boolean hitLimit = false;
        while (running) {
            int want;
            synchronized (lock) {
                want = Math.min(chunk.length, buffer.length - written);
            }
            if (want <= 0) {
                hitLimit = true;
                break;
            }
            int read = record.read(chunk, 0, want, AudioRecord.READ_BLOCKING);
            if (read <= 0) {
                if (!running) break;
                if (read < 0) break;
                continue;
            }
            float rms;
            synchronized (lock) {
                if (!running) break;
                System.arraycopy(chunk, 0, buffer, written, read);
                written += read;
                rms = levelOf(buffer, written);
            }
            listener.onLevel(rms);
        }
        synchronized (lock) {
            running = false;
            finished = true;
        }
        if (hitLimit) listener.onLimit();
    }

    private static float levelOf(float[] samples, int count) {
        int from = Math.max(0, count - LEVEL_WINDOW);
        int n = count - from;
        if (n <= 0) return 0f;
        double sum = 0.0;
        for (int i = from; i < count; i++) sum += samples[i] * samples[i];
        return (float) Math.sqrt(sum / n);
    }

    public float[] stop() {
        Thread toJoin;
        synchronized (lock) {
            running = false;
            if (record != null) {
                try { record.stop(); } catch (IllegalStateException ignored) { /* never started */ }
            }
            toJoin = thread;
        }
        if (toJoin != null && toJoin != Thread.currentThread()) {
            try { toJoin.join(2000); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
        }
        synchronized (lock) {
            float[] out = buffer == null ? new float[0] : java.util.Arrays.copyOf(buffer, written);
            release();
            return out;
        }
    }

    /** Stop and throw the audio away — zero-filled before it is dropped. */
    public void abort() {
        float[] samples = stop();
        java.util.Arrays.fill(samples, 0f);
    }

    public boolean isRunning() {
        return running;
    }

    /** Milliseconds captured so far. */
    public long durationMs() {
        synchronized (lock) {
            return written * 1000L / SAMPLE_RATE;
        }
    }

    private void release() {
        if (record != null) {
            try { record.release(); } catch (RuntimeException ignored) { /* already released */ }
            record = null;
        }
        if (buffer != null) java.util.Arrays.fill(buffer, 0f);
        buffer = null;
        written = 0;
        thread = null;
    }
}
