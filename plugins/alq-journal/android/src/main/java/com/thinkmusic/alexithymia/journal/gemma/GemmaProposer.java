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

public final class GemmaProposer implements AutoCloseable {

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
