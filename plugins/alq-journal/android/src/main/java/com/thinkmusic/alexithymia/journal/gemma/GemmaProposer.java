package com.thinkmusic.alexithymia.journal.gemma;

import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Channel;
import com.google.ai.edge.litertlm.Content;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.LoraConfig;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.ResponseFormat;
import com.google.ai.edge.litertlm.SamplerConfig;
import com.google.ai.edge.litertlm.ThinkingConfig;
import com.google.ai.edge.litertlm.ToolProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Gemma 4 E2B on the phone, through LiteRT-LM — the Full tier's single pass (§5.1, §5.5).
 *
 * One clip in, one JSON object out. The audio is handed to the engine as a RIFF/WAVE buffer
 * built by {@link Wav} and never leaves this process; the answer is constrained by the JSON
 * Schema the JavaScript side passes down, which LiteRT-LM enforces through LLGuidance.
 *
 * <p><b>Three things measured on 2026-09-02, against this exact runtime and bundle, that a
 * later reader should not have to rediscover:</b>
 *
 * <ol>
 *   <li><b>The audio path works, and it takes a WAV.</b> {@code Content.AudioBytes} decodes a
 *       RIFF/WAVE container; handed one, the engine's mel filterbank runs and the model
 *       transcribes. That is why {@link Wav} exists rather than this class passing the
 *       recorder's {@code float[]} through as bytes.</li>
 *   <li><b>{@code extraContext} is non-null in Kotlin.</b> Passing {@code null} to
 *       {@code sendMessage} throws a {@code NullPointerException} from inside the Kotlin
 *       intrinsics, which reads like a runtime fault and is an API contract. An empty map is
 *       the correct "nothing to add".</li>
 *   <li><b>The grammar has a complexity cannot bind an enum member containing a space.</b> Handed
 *       §5.2's schema as written, generation died mid-answer on {@code "routine period"} — a
 *       real context tag — with {@code token "▁period" doesn't satisfy the grammar}: Gemma's
 *       tokeniser carries the space inside the token and LLGuidance's forced-bytes path
 *       cannot line the two up. Three of the seven context tags contain a space. What this
 *       class is handed is {@code PROPOSAL_GRAMMAR_SCHEMA} ({@code schema.js}), which differs
 *       in exactly that one field, and the strict contract is enforced above by
 *       {@code validateProposal} — a grammar is a guarantee about tokens, not about
 *       meaning.</li>
 * </ol>
 *
 * <p><b>The engine is held, and let go.</b> Opening the bundle costs seconds and gigabytes, so
 * a check-in, its correction and the transcript edit that follows share one engine; an idle
 * timer then closes it (§12.1's battery row). The timer is here rather than in JavaScript
 * because the memory is here: a WebView torn down mid-check-in must not leave the model
 * resident, and a promise nobody is waiting on cannot be relied upon to arrive.
 */
public final class GemmaProposer implements AutoCloseable {

    /**
     * What one pass produced, with the two numbers the settings screen and the ledger want.
     *
     * <p>Timed here rather than read from LiteRT-LM's own {@code BenchmarkInfo}: that call
     * throws {@code "Benchmark is not enabled. Please make sure the BenchmarkParams is set in
     * the EngineSettings"} unless the engine was built with benchmark parameters, and the
     * Kotlin {@code EngineConfig} exposes no way to set them (measured 2026-09-02). A
     * wall-clock millisecond is what the copy promises anyway.
     */
    public static final class Result {
        public final String text;
        /** How long opening the bundle took, or 0 when it was already open. */
        public final long loadMs;
        public final long totalMs;

        Result(String text, long loadMs, long totalMs) {
            this.text = text;
            this.loadMs = loadMs;
            this.totalMs = totalMs;
        }
    }

    private final File bundle;
    private final boolean audio;
    private final File cacheDir;

    /**
     * The context window the engine is opened with.
     *
     * 4,096 holds a 4,000-character transcript, the §5.4 prompt and the answer with room to
     * spare, and the bundle supports 32k. It is a memory decision rather than a capability
     * one: the KV cache is most of what a pass costs above the weights.
     */
    private static final int CONTEXT_TOKENS = 4096;

    private final ScheduledExecutorService idle =
            Executors.newSingleThreadScheduledExecutor(runnable -> {
                Thread thread = new Thread(runnable, "alq-gemma-idle");
                thread.setDaemon(true);
                return thread;
            });

    private Engine engine;
    private ScheduledFuture<?> unloadAt;

    public GemmaProposer(File bundle, boolean audio, File cacheDir) {
        this.bundle = bundle;
        this.audio = audio;
        this.cacheDir = cacheDir;
    }

    /** Whether this proposer is configured the way a request wants it. */
    public synchronized boolean matches(File otherBundle, boolean wantsAudio) {
        return bundle.getAbsolutePath().equals(otherBundle.getAbsolutePath()) && audio == wantsAudio;
    }

    /**
     * Open the engine, or return the one already open.
     *
     * <p>The vision backend is {@code null} always: this app never shows the model an image,
     * and a vision encoder loaded on demand that is never demanded costs nothing. The audio
     * backend is {@code null} on the Light tier for the same reason — that is what makes one
     * 2.6 GB bundle serve both tiers, with only the encoders the tier needs ever resident.
     */
    public synchronized long load() throws Exception {
        if (engine != null) return 0L;
        long started = System.currentTimeMillis();
        EngineConfig config = new EngineConfig(
                bundle.getAbsolutePath(),
                new Backend.CPU(),
                null,
                audio ? new Backend.CPU() : null,
                Integer.valueOf(CONTEXT_TOKENS),
                null,
                cacheDir == null ? null : cacheDir.getAbsolutePath());
        Engine opened = new Engine(config);
        opened.initialize();
        engine = opened;
        return System.currentTimeMillis() - started;
    }

    /**
     * One pass: a system prompt, a note as audio or as words, and the model's JSON answer.
     *
     * <p>A fresh conversation per call, deliberately. The system prompt carries this user's
     * own people and trigger labels (§5.1) and those change between check-ins; a held
     * conversation would also accumulate turns, and the second note would be labelled in the
     * light of the first — which is a memory nobody asked this feature to have.
     */
    public synchronized Result propose(String system, byte[] wav, String text, String schema, int maxTokens)
            throws Exception {
        cancelUnload();
        long loadMs = load();

        ConversationConfig config = new ConversationConfig(
                Contents.Companion.of(system),
                new ArrayList<Message>(),
                new ArrayList<ToolProvider>(),
                // Greedy. The same words must produce the same proposal twice: the
                // "This isn't it" loop would otherwise be a slot machine (§4.6).
                new SamplerConfig(1, 1.0, 0.0, 0),
                false,
                new ArrayList<Channel>(),
                new LinkedHashMap<String, Object>(),
                new LoraConfig(),
                false,
                Integer.valueOf(maxTokens),
                new ThinkingConfig(false),
                true);

        Conversation conversation = engine.createConversation(config);
        try {
            List<Content> parts = new ArrayList<>();
            if (wav != null) {
                parts.add(new Content.AudioBytes(wav));
                parts.add(new Content.Text("Listen to the note and answer with the JSON object."));
            } else {
                parts.add(new Content.Text("The note is:\n\n" + text));
            }

            long started = System.currentTimeMillis();
            Message reply = conversation.sendMessage(
                    Message.Companion.user(Contents.Companion.of(parts)),
                    // Non-null or Kotlin throws. See the class comment.
                    new LinkedHashMap<String, Object>(),
                    null, null, null, null, null,
                    ResponseFormat.Companion.json(schema));
            long totalMs = System.currentTimeMillis() - started;

            return new Result(textOf(reply), loadMs, totalMs);
        } finally {
            try { conversation.close(); } catch (RuntimeException ignored) { /* already gone */ }
        }
    }

    /** Every text part of a reply, joined. Tool calls and channels are not asked for here. */
    private static String textOf(Message reply) {
        StringBuilder out = new StringBuilder();
        for (Content content : reply.getContents().getContents()) {
            if (content instanceof Content.Text) out.append(((Content.Text) content).getText());
        }
        return out.toString();
    }

    /** Start the idle countdown. Called after every pass, successful or not. */
    public synchronized void unloadAfter(long millis) {
        cancelUnload();
        if (millis <= 0) return;
        unloadAt = idle.schedule(this::close, millis, TimeUnit.MILLISECONDS);
    }

    private synchronized void cancelUnload() {
        if (unloadAt != null) {
            unloadAt.cancel(false);
            unloadAt = null;
        }
    }

    /** Let the model go. Safe to call twice, and safe to call from the idle thread. */
    @Override
    public synchronized void close() {
        cancelUnload();
        if (engine != null) {
            try { engine.close(); } catch (RuntimeException ignored) { /* already gone */ }
            engine = null;
        }
    }

    /** Whether the weights are resident right now. The settings screen has no use for it; a test does. */
    public synchronized boolean isLoaded() {
        return engine != null;
    }
}
