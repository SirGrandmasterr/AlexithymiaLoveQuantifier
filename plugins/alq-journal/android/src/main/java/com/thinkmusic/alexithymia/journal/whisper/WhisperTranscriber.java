package com.thinkmusic.alexithymia.journal.whisper;

import java.io.File;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;

/**
 * Whisper tiny, on the device, through ONNX Runtime — the same two pinned ONNX files the
 * web build loads through transformers.js (C3), driven by hand because there is no
 * transformers.js on Android and the audio must not leave the native side to reach one.
 *
 * What it does, in order: the log-mel spectrogram ({@link LogMel}), one encoder pass, one
 * decoder pass on the start token alone to detect the language when none was pinned, then
 * greedy decoding with the merged decoder's KV cache. The cache protocol is the one this
 * export actually has, measured rather than assumed: the first pass carries the whole
 * prompt with `use_cache_branch = false` and empty pasts; every later pass carries one
 * token with `use_cache_branch = true`; and in the cache branch the encoder-side `present`
 * tensors come back **empty** (shape `[0, 6, 1, 64]`), so the ones from the first pass are
 * kept and fed again — feeding the empty ones back breaks the cross-attention outright.
 *
 * It transcribes, never translates, and it applies the two suppression lists the model
 * repository publishes (`suppress_tokens` always, `begin_suppress_tokens` on the first
 * generated token only), which is what keeps the output to words rather than the
 * non-speech tokens Whisper otherwise emits on silence.
 *
 * **One departure from a bare greedy loop, stated so a later session can remove it:** a
 * tail that repeats itself — the same one-to-eight-token span three times running — stops
 * the loop and keeps a single copy. Whisper tiny falls into exactly that loop on poor
 * audio, and on a phone every looped token is time and heat spent on nothing. It removes
 * only words the model already repeated; it never adds one. The web path has no such
 * guard, and D4's golden suite is where the two get compared on real recordings.
 *
 * Nothing here is Android-specific. The JVM harness recorded in the C4 ledger entry runs
 * this class unchanged against the pinned files and the Python prototype's tokens.
 */
public final class WhisperTranscriber implements AutoCloseable {

    /** The words and the language they were read in. */
    public static final class Result {
        public final String text;
        public final String language;
        public final int tokens;

        Result(String text, String language, int tokens) {
            this.text = text;
            this.language = language;
            this.tokens = tokens;
        }
    }

    private static final String INPUT_FEATURES = "input_features";
    private static final String INPUT_IDS = "input_ids";
    private static final String ENCODER_HIDDEN_STATES = "encoder_hidden_states";
    private static final String USE_CACHE_BRANCH = "use_cache_branch";
    private static final String PAST_PREFIX = "past_key_values.";
    private static final String PRESENT_PREFIX = "present.";
    private static final String LOGITS = "logits";

    /** The longest span the loop guard looks for, and how many repeats end the take. */
    private static final int MAX_REPEAT_SPAN = 8;
    private static final int REPEATS_TO_STOP = 3;

    private final OrtEnvironment env;
    private final OrtSession encoder;
    private final OrtSession decoder;
    private final WhisperTokens tokens;
    private final LogMel logMel = new LogMel();

    private final List<String> decoderPastNames = new ArrayList<>();
    private final List<String> encoderPastNames = new ArrayList<>();
    private final int heads;
    private final int headDim;

    public WhisperTranscriber(File encoderOnnx, File decoderOnnx, WhisperTokens tokens, int threads) throws OrtException {
        this.env = OrtEnvironment.getEnvironment();
        this.tokens = tokens;

        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setIntraOpNumThreads(Math.max(1, threads));
        encoder = env.createSession(encoderOnnx.getAbsolutePath(), options);

        OrtSession.SessionOptions decoderOptions = new OrtSession.SessionOptions();
        decoderOptions.setIntraOpNumThreads(Math.max(1, threads));
        decoder = env.createSession(decoderOnnx.getAbsolutePath(), decoderOptions);

        int foundHeads = 0;
        int foundDim = 0;
        for (Map.Entry<String, ai.onnxruntime.NodeInfo> entry : decoder.getInputInfo().entrySet()) {
            String name = entry.getKey();
            if (!name.startsWith(PAST_PREFIX)) continue;
            if (name.contains(".decoder.")) decoderPastNames.add(name);
            else encoderPastNames.add(name);
            long[] shape = ((ai.onnxruntime.TensorInfo) entry.getValue().getInfo()).getShape();
            foundHeads = (int) shape[1];
            foundDim = (int) shape[3];
        }
        if (decoderPastNames.isEmpty() || foundHeads <= 0 || foundDim <= 0) {
            throw new OrtException("the decoder is not the merged export this build expects");
        }
        heads = foundHeads;
        headDim = foundDim;
    }

    /**
     * Transcribe one clip of 16 kHz mono float samples.
     *
     * @param audio        up to thirty seconds; longer input is cut, shorter is padded
     * @param languageCode a two-letter pin, or null to let the model decide
     */
    public Result transcribe(float[] audio, String languageCode) throws OrtException {
        float[] features = logMel.compute(audio);

        float[] hidden;
        long[] hiddenShape;
        try (OnnxTensor input = OnnxTensor.createTensor(env, FloatBuffer.wrap(features), new long[] { 1, LogMel.N_MELS, LogMel.N_FRAMES });
             OrtSession.Result encoded = encoder.run(Map.of(INPUT_FEATURES, input))) {
            OnnxTensor out = (OnnxTensor) encoded.get(0);
            hiddenShape = out.getInfo().getShape();
            hidden = toArray(out);
        }

        try (OnnxTensor encoderHidden = OnnxTensor.createTensor(env, FloatBuffer.wrap(hidden), hiddenShape)) {
            int languageId = tokens.languageId(languageCode);
            if (languageId < 0) languageId = detectLanguage(encoderHidden);

            int[] prompt = { tokens.startOfTranscript, languageId, tokens.transcribeTask, tokens.noTimestamps };
            int[] generated = new int[Math.max(1, tokens.maxLength - prompt.length)];
            int count = decodeGreedy(encoderHidden, prompt, generated);

            String text = tokens.decode(generated, count).trim();
            String language = tokens.languageCode(languageId);
            return new Result(text, language == null ? "" : language, count);
        }
    }

    /** One decoder step on the start token alone; the likeliest language token wins. */
    private int detectLanguage(OnnxTensor encoderHidden) throws OrtException {
        Cache cache = Cache.empty(env, decoderPastNames, encoderPastNames, heads, headDim);
        try {
            float[] logits = step(encoderHidden, new int[] { tokens.startOfTranscript }, cache, false);
            int best = -1;
            float bestScore = Float.NEGATIVE_INFINITY;
            for (int id : tokens.languageIds()) {
                if (id < logits.length && logits[id] > bestScore) {
                    bestScore = logits[id];
                    best = id;
                }
            }
            return best;
        } finally {
            cache.close();
        }
    }

    private int decodeGreedy(OnnxTensor encoderHidden, int[] prompt, int[] out) throws OrtException {
        Cache cache = Cache.empty(env, decoderPastNames, encoderPastNames, heads, headDim);
        try {
            float[] logits = step(encoderHidden, prompt, cache, false);
            int count = 0;
            while (count < out.length) {
                suppress(logits, tokens.suppress);
                if (count == 0) suppress(logits, tokens.beginSuppress);
                int next = argmax(logits);
                if (next == tokens.endOfText) break;
                out[count++] = next;

                int trimmed = repeatedTail(out, count);
                if (trimmed >= 0) return trimmed;

                logits = step(encoderHidden, new int[] { next }, cache, true);
            }
            return count;
        } finally {
            cache.close();
        }
    }

    /**
     * One decoder pass. Returns the logits of the last position and advances the cache.
     */
    private float[] step(OnnxTensor encoderHidden, int[] ids, Cache cache, boolean useCache) throws OrtException {
        long[][] idRows = new long[1][ids.length];
        for (int i = 0; i < ids.length; i++) idRows[0][i] = ids[i];

        Map<String, OnnxTensor> feeds = new HashMap<>();
        try (OnnxTensor inputIds = OnnxTensor.createTensor(env, idRows);
             OnnxTensor branch = OnnxTensor.createTensor(env, new boolean[] { useCache })) {
            feeds.put(INPUT_IDS, inputIds);
            feeds.put(ENCODER_HIDDEN_STATES, encoderHidden);
            feeds.put(USE_CACHE_BRANCH, branch);
            feeds.putAll(cache.tensors);

            try (OrtSession.Result result = decoder.run(feeds)) {
                OnnxTensor logitsTensor = (OnnxTensor) result.get(LOGITS).orElseThrow(() -> new OrtException("no logits"));
                long[] shape = logitsTensor.getInfo().getShape();
                int vocab = (int) shape[2];
                int positions = (int) shape[1];
                FloatBuffer all = logitsTensor.getFloatBuffer();
                float[] last = new float[vocab];
                all.position((positions - 1) * vocab);
                all.get(last);

                cache.advance(result);
                return last;
            }
        }
    }

    private static void suppress(float[] logits, int[] ids) {
        for (int id : ids) if (id >= 0 && id < logits.length) logits[id] = Float.NEGATIVE_INFINITY;
    }

    private static int argmax(float[] values) {
        int best = 0;
        for (int i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
        return best;
    }

    /**
     * The loop guard. If the last `span` tokens have just been produced three times in a
     * row, return the count that keeps one copy; otherwise -1.
     */
    static int repeatedTail(int[] out, int count) {
        for (int span = 1; span <= MAX_REPEAT_SPAN; span++) {
            int needed = span * REPEATS_TO_STOP;
            if (count < needed) break;
            boolean repeats = true;
            for (int i = 0; i < span && repeats; i++) {
                int reference = out[count - span + i];
                for (int r = 2; r <= REPEATS_TO_STOP; r++) {
                    if (out[count - r * span + i] != reference) {
                        repeats = false;
                        break;
                    }
                }
            }
            if (repeats) return count - span * (REPEATS_TO_STOP - 1);
        }
        return -1;
    }

    private static float[] toArray(OnnxTensor tensor) throws OrtException {
        FloatBuffer buffer = tensor.getFloatBuffer();
        float[] out = new float[buffer.remaining()];
        buffer.get(out);
        return out;
    }

    /**
     * The decoder's KV cache: one tensor per `past_key_values.*` input, replaced from the
     * matching `present.*` output after every step — except the encoder-side ones, which
     * this export returns empty in the cache branch and which therefore keep their first
     * value.
     */
    private static final class Cache implements AutoCloseable {
        final Map<String, OnnxTensor> tensors = new HashMap<>();
        private final OrtEnvironment env;
        private final List<String> decoderNames;
        private final List<String> encoderNames;

        private Cache(OrtEnvironment env, List<String> decoderNames, List<String> encoderNames) {
            this.env = env;
            this.decoderNames = decoderNames;
            this.encoderNames = encoderNames;
        }

        static Cache empty(OrtEnvironment env, List<String> decoderNames, List<String> encoderNames, int heads, int headDim) throws OrtException {
            Cache cache = new Cache(env, decoderNames, encoderNames);
            for (String name : decoderNames) cache.tensors.put(name, emptyTensor(env, heads, headDim));
            for (String name : encoderNames) cache.tensors.put(name, emptyTensor(env, heads, headDim));
            return cache;
        }

        private static OnnxTensor emptyTensor(OrtEnvironment env, int heads, int headDim) throws OrtException {
            return OnnxTensor.createTensor(env, FloatBuffer.allocate(0), new long[] { 1, heads, 0, headDim });
        }

        void advance(OrtSession.Result result) throws OrtException {
            for (String name : decoderNames) replace(name, result);
            for (String name : encoderNames) {
                OnnxTensor present = presentFor(name, result);
                if (present == null) continue;
                long[] shape = present.getInfo().getShape();
                // Empty in the cache branch — keep what the first pass produced.
                if (shape.length == 0 || shape[0] == 0 || shape[2] == 0) continue;
                replaceWith(name, present);
            }
        }

        private void replace(String name, OrtSession.Result result) throws OrtException {
            OnnxTensor present = presentFor(name, result);
            if (present != null) replaceWith(name, present);
        }

        private OnnxTensor presentFor(String pastName, OrtSession.Result result) {
            String presentName = PRESENT_PREFIX + pastName.substring(PAST_PREFIX.length());
            java.util.Optional<OnnxValue> value = result.get(presentName);
            return value.isPresent() ? (OnnxTensor) value.get() : null;
        }

        /** Copy the value out — the result that owns `present` is about to be closed. */
        private void replaceWith(String name, OnnxTensor present) throws OrtException {
            long[] shape = present.getInfo().getShape();
            FloatBuffer buffer = present.getFloatBuffer();
            float[] copy = new float[buffer.remaining()];
            buffer.get(copy);
            OnnxTensor previous = tensors.put(name, OnnxTensor.createTensor(env, FloatBuffer.wrap(copy), shape));
            if (previous != null) previous.close();
        }

        @Override
        public void close() {
            for (OnnxTensor tensor : tensors.values()) tensor.close();
            tensors.clear();
        }
    }

    @Override
    public void close() {
        try { decoder.close(); } catch (OrtException ignored) { /* already gone */ }
        try { encoder.close(); } catch (OrtException ignored) { /* already gone */ }
    }
}
