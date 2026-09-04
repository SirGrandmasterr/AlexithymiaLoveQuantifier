package com.thinkmusic.alexithymia.journal;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;

/**
 * The microphone, natively: 16 kHz mono float samples into a buffer that never leaves this
 * process, with a level reading every 50 ms for the meter on screen.
 *
 * It is the native half of C2's recorder and deliberately no more than that. The state
 * machine — tap to start and tap to stop, the two-second silence stop, the thirty-second
 * limit, *add more*, discard on background — stays in `src/journal/recorder.js`, which
 * drives this class through the plugin exactly as it drives `MediaRecorder` on the web.
 * Two things are enforced here regardless, because a stalled WebView must not be able to
 * leave a microphone open: the capture ends itself at `maxMs` (the recorder passes
 * `MAX_CLIP_MS`, so the number has one home), and the plugin aborts it when the activity
 * pauses.
 *
 * The audio source is `VOICE_RECOGNITION`: the source speech recognisers use, which the
 * platform keeps flat — the same request the web build makes by turning noise suppression
 * and automatic gain off (§4.2), so the meter measures the clip the model will see.
 *
 * The level is the RMS of the last 1,024 samples (64 ms), on the same 0…1 scale as the web
 * meter's RMS over an `AnalyserNode` frame, so `SPEECH_LEVEL` and `SILENCE_LEVEL` in the
 * recorder mean the same thing on both platforms.
 */
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

    /**
     * Stop and hand over what was captured. Returns the same samples if the limit stopped
     * the capture first; returns an empty array if nothing was ever started.
     */
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
