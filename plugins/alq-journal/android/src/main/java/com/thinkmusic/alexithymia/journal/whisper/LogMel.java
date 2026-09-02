package com.thinkmusic.alexithymia.journal.whisper;

/**
 * Whisper's input: an 80-band log-mel spectrogram of thirty seconds of 16 kHz audio, in
 * plain Java with no Android and no native dependency.
 *
 * It is a line-for-line port of what the model was trained on — the same arithmetic
 * transformers.js runs on the web (C3) and openai/whisper's `log_mel_spectrogram`: a
 * periodic Hann window of 400 samples, a hop of 160, reflect padding of 200 on each side,
 * the last frame dropped, power (not magnitude), Slaney-scale mel filters normalised by
 * band width, `log10` clamped at 1e-10, a floor eight decades under the loudest bin, and
 * `(x + 4) / 4`. Every one of those details changes what the encoder sees; the Python
 * prototype this was ported from matches PyTorch's `torch.stft` version to 1.4e-5, and the
 * JVM harness in the C4 ledger entry compares this class against that prototype's dump.
 *
 * The transform itself is a table-driven DFT rather than an FFT: 400 is not a power of
 * two, and an exact 400-point transform is what the model expects. It costs about half a
 * billion multiply-adds for a full clip, which is a fraction of a second on a phone and
 * well under the encoder's own time. If that ever matters, a mixed-radix FFT replaces
 * `frameSpectrum` and nothing else changes.
 */
public final class LogMel {

    public static final int SAMPLE_RATE = 16_000;
    public static final int N_FFT = 400;
    public static final int HOP = 160;
    public static final int N_MELS = 80;
    public static final int CHUNK_SECONDS = 30;
    /** Thirty seconds of audio; shorter clips are zero-padded, longer ones cut. */
    public static final int N_SAMPLES = SAMPLE_RATE * CHUNK_SECONDS;
    /** The encoder takes exactly this many frames: [1, 80, 3000]. */
    public static final int N_FRAMES = N_SAMPLES / HOP;

    private static final int N_FREQS = N_FFT / 2 + 1;
    private static final int PAD = N_FFT / 2;

    private final float[] window = new float[N_FFT];
    private final float[] cosTable = new float[N_FREQS * N_FFT];
    private final float[] sinTable = new float[N_FREQS * N_FFT];
    /** Each band's non-zero bins, so the filter multiply skips the zeros. */
    private final int[] bandStart = new int[N_MELS];
    private final int[] bandEnd = new int[N_MELS];
    private final float[][] filters = new float[N_MELS][N_FREQS];

    public LogMel() {
        // Periodic Hann: numpy's hanning(N + 1)[:-1], which is torch.hann_window's default.
        for (int i = 0; i < N_FFT; i++) {
            window[i] = (float) (0.5 - 0.5 * Math.cos(2.0 * Math.PI * i / N_FFT));
        }
        for (int k = 0; k < N_FREQS; k++) {
            for (int i = 0; i < N_FFT; i++) {
                double angle = 2.0 * Math.PI * k * i / N_FFT;
                cosTable[k * N_FFT + i] = (float) Math.cos(angle);
                sinTable[k * N_FFT + i] = (float) Math.sin(angle);
            }
        }
        buildFilters();
    }

    /** Slaney's mel scale: linear to 1 kHz, logarithmic above it. */
    private static double hzToMel(double hz) {
        if (hz >= 1000.0) return 15.0 + Math.log(hz / 1000.0) / (Math.log(6.4) / 27.0);
        return 3.0 * hz / 200.0;
    }

    private static double melToHz(double mel) {
        if (mel >= 15.0) return 1000.0 * Math.exp((Math.log(6.4) / 27.0) * (mel - 15.0));
        return 200.0 * mel / 3.0;
    }

    /** librosa's `mel(sr=16000, n_fft=400, n_mels=80)` with Slaney normalisation. */
    private void buildFilters() {
        double[] fftFreqs = new double[N_FREQS];
        for (int k = 0; k < N_FREQS; k++) fftFreqs[k] = (SAMPLE_RATE / 2.0) * k / (N_FREQS - 1);

        double melMin = hzToMel(0.0);
        double melMax = hzToMel(SAMPLE_RATE / 2.0);
        double[] hzPoints = new double[N_MELS + 2];
        for (int i = 0; i < N_MELS + 2; i++) {
            hzPoints[i] = melToHz(melMin + (melMax - melMin) * i / (N_MELS + 1));
        }

        for (int m = 0; m < N_MELS; m++) {
            double lowerWidth = hzPoints[m + 1] - hzPoints[m];
            double upperWidth = hzPoints[m + 2] - hzPoints[m + 1];
            double norm = 2.0 / (hzPoints[m + 2] - hzPoints[m]);
            int start = -1;
            int end = 0;
            for (int k = 0; k < N_FREQS; k++) {
                double lower = (fftFreqs[k] - hzPoints[m]) / lowerWidth;
                double upper = (hzPoints[m + 2] - fftFreqs[k]) / upperWidth;
                double weight = Math.max(0.0, Math.min(lower, upper)) * norm;
                filters[m][k] = (float) weight;
                if (weight > 0.0) {
                    if (start < 0) start = k;
                    end = k + 1;
                }
            }
            bandStart[m] = Math.max(0, start);
            bandEnd[m] = end;
        }
    }

    /**
     * The spectrogram of one clip, as the encoder wants it: `N_MELS * N_FRAMES` floats,
     * row-major, band first — the flat form of a `[1, 80, 3000]` tensor.
     */
    public float[] compute(float[] audio) {
        // Zero-pad or cut to thirty seconds, then reflect-pad 200 samples at each end.
        float[] padded = new float[N_SAMPLES + 2 * PAD];
        int n = Math.min(audio.length, N_SAMPLES);
        System.arraycopy(audio, 0, padded, PAD, n);
        for (int j = 1; j <= PAD; j++) {
            padded[PAD - j] = padded[PAD + j];
            padded[PAD + N_SAMPLES - 1 + j] = padded[PAD + N_SAMPLES - 1 - j];
        }

        float[] frame = new float[N_FFT];
        float[] power = new float[N_FREQS];
        float[] mel = new float[N_MELS * N_FRAMES];
        float loudest = Float.NEGATIVE_INFINITY;

        for (int t = 0; t < N_FRAMES; t++) {
            int offset = t * HOP;
            for (int i = 0; i < N_FFT; i++) frame[i] = padded[offset + i] * window[i];
            frameSpectrum(frame, power);

            for (int m = 0; m < N_MELS; m++) {
                float[] band = filters[m];
                double sum = 0.0;
                for (int k = bandStart[m]; k < bandEnd[m]; k++) sum += band[k] * power[k];
                float value = (float) Math.log10(Math.max(sum, 1e-10));
                mel[m * N_FRAMES + t] = value;
                if (value > loudest) loudest = value;
            }
        }

        float floor = loudest - 8.0f;
        for (int i = 0; i < mel.length; i++) {
            mel[i] = (Math.max(mel[i], floor) + 4.0f) / 4.0f;
        }
        return mel;
    }

    /** The power spectrum of one windowed frame: |DFT|² for bins 0…200. */
    private void frameSpectrum(float[] frame, float[] power) {
        for (int k = 0; k < N_FREQS; k++) {
            int base = k * N_FFT;
            float re = 0f;
            float im = 0f;
            for (int i = 0; i < N_FFT; i++) {
                float x = frame[i];
                re += x * cosTable[base + i];
                im -= x * sinTable[base + i];
            }
            power[k] = re * re + im * im;
        }
    }
}
