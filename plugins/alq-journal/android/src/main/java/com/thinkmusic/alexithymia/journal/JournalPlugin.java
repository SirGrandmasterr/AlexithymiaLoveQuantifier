package com.thinkmusic.alexithymia.journal;

import android.Manifest;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import com.thinkmusic.alexithymia.journal.gemma.GemmaProposer;
import com.thinkmusic.alexithymia.journal.gemma.Wav;
import com.thinkmusic.alexithymia.journal.whisper.WhisperTokens;
import com.thinkmusic.alexithymia.journal.whisper.WhisperTranscriber;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "AlqJournal",
    permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = JournalPlugin.MICROPHONE) }
)
public class JournalPlugin extends Plugin {

    static final String MICROPHONE = "microphone";
    private static final String TAG = "AlqJournal";

    private static final String EVENT_LEVEL = "level";
    private static final String EVENT_CAPTURE_ENDED = "captureEnded";
    private static final String EVENT_FETCH_PROGRESS = "fetchProgress";

    private static final String CODE_DENIED = "denied";
    private static final String CODE_BUSY = "busy";
    private static final String CODE_IDLE = "idle";
    private static final String CODE_UNAVAILABLE = "unavailable";
    private static final String CODE_NO_AUDIO = "no_audio";
    private static final String CODE_MODEL_MISSING = "model_missing";
    private static final String CODE_FAILED = "failed";
    private static final String CODE_CAPTURE = "capture";

    private static final int DEFAULT_MAX_MS = 30_000;

    /** Enough tokens for the largest answer §5.2 admits. Mirrors MAX_NEW_TOKENS in web.js. */
    private static final int DEFAULT_MAX_TOKENS = 1024;

    /** Let the model go this long after the last question (§12.1). Mirrors IDLE_UNLOAD_MS. */
    private static final int DEFAULT_IDLE_UNLOAD_MS = 120_000;

    private final ClipStore clips = new ClipStore();
    private final Object captureLock = new Object();
    private AudioCapture capture;
    private JSObject pendingClip;

    private ModelStore store;
    private final Map<String, AtomicBoolean> fetches = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "alq-journal-worker");
        thread.setPriority(Thread.NORM_PRIORITY);
        return thread;
    });

    private WhisperTranscriber transcriber;
    private String transcriberKey;

    private GemmaProposer proposer;

    @Override
    public void load() {
        // Private to the app and off Google's backup (allowBackup="false"). Nothing in it is
        // the user's: it is model weights, re-fetchable from the configured server.
        store = new ModelStore(new File(getContext().getFilesDir(), "models"));
    }

    /* 1. Record                                                                           */

    @PluginMethod
    public void startCapture(PluginCall call) {
        if (getPermissionState(MICROPHONE) != PermissionState.GRANTED) {
            // JavaScript asks first (checkPermissions → requestPermissions, on the first
            // tap). This refusal is the structural guarantee behind it.
            call.reject("the microphone permission was not granted", CODE_DENIED);
            return;
        }

        int maxMs = call.getInt("maxMs", DEFAULT_MAX_MS);
        synchronized (captureLock) {
            if (capture != null) {
                call.reject("already capturing", CODE_BUSY);
                return;
            }
            pendingClip = null;

            AudioCapture opened = new AudioCapture(new AudioCapture.Listener() {
                @Override
                public void onLevel(float rms) {
                    JSObject level = new JSObject();
                    level.put("rms", rms);
                    notifyListeners(EVENT_LEVEL, level);
                }

                @Override
                public void onLimit() {
                    JSObject clip = null;
                    synchronized (captureLock) {
                        if (capture != null) {
                            clip = keep(capture.stop(), "limit");
                            capture = null;
                            pendingClip = clip;
                        }
                    }
                    if (clip != null) notifyListeners(EVENT_CAPTURE_ENDED, clip);
                }
            });

            try {
                opened.start(maxMs);
            } catch (RuntimeException e) {
                Log.w(TAG, "capture did not start: " + e.getMessage());
                call.reject("the microphone did not open", CODE_CAPTURE, e);
                return;
            }
            capture = opened;
        }
        call.resolve();
    }

    @PluginMethod
    public void stopCapture(PluginCall call) {
        JSObject clip;
        synchronized (captureLock) {
            if (capture != null) {
                clip = keep(capture.stop(), "tap");
                capture = null;
            } else if (pendingClip != null) {
                // The native limit ended it first; hand over what it kept.
                clip = pendingClip;
            } else {
                call.reject("nothing is being captured", CODE_IDLE);
                return;
            }
            pendingClip = null;
        }
        call.resolve(clip);
    }

    @PluginMethod
    public void abortCapture(PluginCall call) {
        abortAnyCapture();
        call.resolve();
    }

    @PluginMethod
    public void releaseClip(PluginCall call) {
        clips.release(call.getString("handle"));
        call.resolve();
    }

    private JSObject keep(float[] samples, String reason) {
        String handle = clips.keep(samples);
        JSObject clip = new JSObject();
        clip.put("handle", handle);
        clip.put("samples", samples.length);
        clip.put("durationMs", samples.length * 1000L / AudioCapture.SAMPLE_RATE);
        clip.put("sampleRate", AudioCapture.SAMPLE_RATE);
        clip.put("reason", reason);
        return clip;
    }

    private void abortAnyCapture() {
        AudioCapture toAbort;
        synchronized (captureLock) {
            toAbort = capture;
            capture = null;
            if (pendingClip != null) {
                clips.release(pendingClip.getString("handle"));
                pendingClip = null;
            }
        }
        if (toAbort != null) toAbort.abort();
    }

    /* 2. Transcribe                                                                       */

    @PluginMethod
    public void transcribe(PluginCall call) {
        JSArray handles = call.getArray("handles");
        String language = call.getString("language");
        JSObject model = call.getObject("model");

        List<String> handleList = strings(handles);
        if (handleList.isEmpty()) {
            call.reject("no clips to transcribe", CODE_NO_AUDIO);
            return;
        }

        int total = 0;
        List<float[]> parts = new ArrayList<>();
        for (String handle : handleList) {
            float[] samples = clips.get(handle);
            if (samples == null) {
                call.reject("clip " + handle + " is no longer held", CODE_NO_AUDIO);
                return;
            }
            parts.add(samples);
            total += samples.length;
        }
        // Several clips of one take are one note (§4.2) — joined here exactly as the web
        // runtime's `concatClips` joins them.
        float[] audio = new float[total];
        int at = 0;
        for (float[] part : parts) {
            System.arraycopy(part, 0, audio, at, part.length);
            at += part.length;
        }

        File encoder;
        File decoder;
        File vocab;
        File generation;
        try {
            encoder = modelFile(model, "encoder_model_quantized.onnx");
            decoder = modelFile(model, "decoder_model_merged_quantized.onnx");
            vocab = modelFile(model, "vocab.json");
            generation = modelFile(model, "generation_config.json");
        } catch (ModelStore.Failure | JSONException e) {
            call.reject("the model files are not on this device", CODE_MODEL_MISSING);
            return;
        }
        if (!encoder.isFile() || !decoder.isFile() || !vocab.isFile() || !generation.isFile()) {
            call.reject("the model files are not on this device", CODE_MODEL_MISSING);
            return;
        }

        worker.execute(() -> {
            long started = System.currentTimeMillis();
            try {
                WhisperTranscriber whisper = openTranscriber(encoder, decoder, vocab, generation);
                WhisperTranscriber.Result result = whisper.transcribe(audio, language);
                JSObject out = new JSObject();
                out.put("text", result.text);
                out.put("language", result.language);
                out.put("tokens", result.tokens);
                out.put("durationMs", System.currentTimeMillis() - started);
                call.resolve(out);
            } catch (Exception e) {
                Log.w(TAG, "transcription failed: " + e.getMessage());
                closeTranscriber();
                call.reject("transcription failed", CODE_FAILED, e);
            }
        });
    }

    private File modelFile(JSObject model, String suffix) throws ModelStore.Failure, JSONException {
        if (model == null) throw new ModelStore.Failure(ModelStore.Failure.STORAGE, suffix, "no model given");
        // A plain JSONArray: JSObject offers getJSObject but no array accessor of its own.
        JSONArray files = model.optJSONArray("files");
        if (files != null) {
            for (int i = 0; i < files.length(); i++) {
                JSONObject file = files.getJSONObject(i);
                String path = file.optString("path", "");
                if (path.endsWith("/" + suffix) || path.equals(suffix)) return store.fileFor(path);
            }
        }
        throw new ModelStore.Failure(ModelStore.Failure.STORAGE, suffix, "the manifest names no " + suffix);
    }

    private synchronized WhisperTranscriber openTranscriber(File encoder, File decoder, File vocab, File generation) throws Exception {
        String key = encoder.getAbsolutePath() + "|" + decoder.getAbsolutePath() + "|" + encoder.length() + "|" + decoder.length();
        if (transcriber != null && key.equals(transcriberKey)) return transcriber;
        closeTranscriber();
        WhisperTokens tokens = WhisperTokens.load(vocab, generation);
        int threads = Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors() - 1));
        transcriber = new WhisperTranscriber(encoder, decoder, tokens, threads);
        transcriberKey = key;
        return transcriber;
    }

    private synchronized void closeTranscriber() {
        if (transcriber != null) {
            try { transcriber.close(); } catch (RuntimeException ignored) { /* already gone */ }
            transcriber = null;
            transcriberKey = null;
        }
    }

    /* 3. Propose — Gemma 4 E2B through LiteRT-LM (D3)                                     */

    @PluginMethod
    public void loadProposer(PluginCall call) {
        File bundle;
        try {
            bundle = bundleFile(call.getObject("model"));
        } catch (ModelStore.Failure e) {
            call.reject("the model files are not on this device", CODE_MODEL_MISSING);
            return;
        }
        boolean audio = Boolean.TRUE.equals(call.getBoolean("audio", Boolean.TRUE));
        long idleMs = call.getInt("idleUnloadMs", DEFAULT_IDLE_UNLOAD_MS).longValue();

        worker.execute(() -> {
            try {
                GemmaProposer opened = openProposer(bundle, audio);
                opened.load();
                opened.unloadAfter(idleMs);
                JSObject out = new JSObject();
                out.put("loaded", true);
                call.resolve(out);
            } catch (Exception e) {
                Log.w(TAG, "the proposal model would not open: " + e.getMessage());
                closeProposer();
                call.reject("the proposal model would not open", CODE_FAILED, e);
            }
        });
    }

    @PluginMethod
    public void propose(PluginCall call) {
        String system = call.getString("system", "");
        String schema = call.getString("schema", "");
        String text = call.getString("text", "");
        JSArray handles = call.getArray("handles");
        boolean audio = Boolean.TRUE.equals(call.getBoolean("audio", Boolean.TRUE));
        int maxTokens = call.getInt("maxTokens", DEFAULT_MAX_TOKENS);
        long idleMs = call.getInt("idleUnloadMs", DEFAULT_IDLE_UNLOAD_MS).longValue();

        if (system.isEmpty() || schema.isEmpty()) {
            call.reject("a proposal needs a prompt and a schema", CODE_FAILED);
            return;
        }

        File bundle;
        try {
            bundle = bundleFile(call.getObject("model"));
        } catch (ModelStore.Failure e) {
            call.reject("the model files are not on this device", CODE_MODEL_MISSING);
            return;
        }

        byte[] wav = null;
        List<String> handleList = strings(handles);
        if (!handleList.isEmpty()) {
            List<float[]> parts = new ArrayList<>();
            for (String handle : handleList) {
                float[] samples = clips.get(handle);
                if (samples == null) {
                    call.reject("clip " + handle + " is no longer held", CODE_NO_AUDIO);
                    return;
                }
                parts.add(samples);
            }
            wav = Wav.mono16k(parts);
        } else if (text.isEmpty()) {
            call.reject("a proposal needs a clip or a transcript", CODE_NO_AUDIO);
            return;
        }

        final byte[] audioBytes = wav;
        final boolean withAudio = audio && audioBytes != null;
        worker.execute(() -> {
            try {
                GemmaProposer opened = openProposer(bundle, withAudio);
                GemmaProposer.Result result = opened.propose(system, audioBytes, text, schema, maxTokens);
                opened.unloadAfter(idleMs);

                JSObject out = new JSObject();
                out.put("text", result.text);
                out.put("durationMs", result.totalMs);
                out.put("loadMs", result.loadMs);
                call.resolve(out);
            } catch (Exception e) {
                Log.w(TAG, "the proposal failed: " + e.getMessage());
                closeProposer();
                call.reject("the proposal failed", CODE_FAILED, e);
            }
        });
    }

    /** Let the weights go now, rather than when the idle timer says so. */
    @PluginMethod
    public void releaseProposer(PluginCall call) {
        closeProposer();
        call.resolve();
    }

    private File bundleFile(JSObject model) throws ModelStore.Failure {
        String bundle = model == null ? null : model.getString("bundle");
        if (bundle == null || bundle.isEmpty()) {
            throw new ModelStore.Failure(ModelStore.Failure.STORAGE, "bundle", "no bundle path given");
        }
        File file = store.fileFor(bundle);
        if (!file.isFile()) {
            throw new ModelStore.Failure(ModelStore.Failure.STORAGE, bundle, "not on this device");
        }
        return file;
    }

    private synchronized GemmaProposer openProposer(File bundle, boolean audio) {
        if (proposer != null && proposer.matches(bundle, audio)) return proposer;
        closeProposer();
        proposer = new GemmaProposer(bundle, audio, getContext().getCacheDir());
        return proposer;
    }

    private synchronized void closeProposer() {
        if (proposer != null) {
            try { proposer.close(); } catch (RuntimeException ignored) { /* already gone */ }
            proposer = null;
        }
    }

    /* 4. Embed — a stub, and honest about it                                              */

    @PluginMethod
    public void embed(PluginCall call) {
        // G1's. The same reasoning `propose` carried until D3.
        call.reject("no embedding model in this build", CODE_UNAVAILABLE);
    }

    /* 5. Report memory and tier                                                           */

    @PluginMethod
    public void tier(PluginCall call) {
        call.resolve(TierProbe.report(getContext()));
    }

    /* The weight store beneath `transcribe`                                               */

    @PluginMethod
    public void fetchModel(PluginCall call) {
        String id = call.getString("id", "");
        String baseUrl = call.getString("baseUrl", "");
        List<ModelStore.FileSpec> files;
        try {
            files = specs(call.getArray("files"));
        } catch (JSONException e) {
            call.reject("the file list is malformed", ModelStore.Failure.STORAGE);
            return;
        }
        if (baseUrl.isEmpty() || files.isEmpty()) {
            call.reject("nothing to fetch: no server or no files", ModelStore.Failure.NETWORK);
            return;
        }
        if (fetches.containsKey(id)) {
            call.reject("this model is already downloading", CODE_BUSY);
            return;
        }

        AtomicBoolean cancel = new AtomicBoolean(false);
        fetches.put(id, cancel);
        worker.execute(() -> {
            try {
                store.fetch(baseUrl, files, (path, filesDone, filesTotal, loaded, total) -> {
                    JSObject progress = new JSObject();
                    progress.put("id", id);
                    progress.put("path", path);
                    progress.put("filesDone", filesDone);
                    progress.put("filesTotal", filesTotal);
                    progress.put("loaded", loaded);
                    progress.put("total", total);
                    notifyListeners(EVENT_FETCH_PROGRESS, progress);
                }, cancel);
                JSObject done = new JSObject();
                done.put("state", "ready");
                call.resolve(done);
            } catch (ModelStore.Failure failure) {
                if (ModelStore.Failure.CANCELLED.equals(failure.kind)) {
                    JSObject cancelled = new JSObject();
                    cancelled.put("state", "cancelled");
                    call.resolve(cancelled);
                } else {
                    Log.w(TAG, "model fetch stopped (" + failure.kind + "): " + failure.getMessage());
                    JSObject data = new JSObject();
                    data.put("path", failure.path == null ? "" : failure.path);
                    call.reject(failure.getMessage(), failure.kind, data);
                }
            } catch (RuntimeException e) {
                Log.w(TAG, "model fetch failed: " + e.getMessage());
                call.reject("the download failed", ModelStore.Failure.STORAGE, e);
            } finally {
                fetches.remove(id);
            }
        });
    }

    @PluginMethod
    public void cancelFetch(PluginCall call) {
        AtomicBoolean cancel = fetches.get(call.getString("id", ""));
        if (cancel != null) cancel.set(true);
        call.resolve();
    }

    @PluginMethod
    public void modelStatus(PluginCall call) {
        try {
            JSObject out = new JSObject();
            out.put("ready", store.isReady(specs(call.getArray("files"))));
            call.resolve(out);
        } catch (JSONException e) {
            call.reject("the file list is malformed", ModelStore.Failure.STORAGE);
        }
    }

    @PluginMethod
    public void removeModel(PluginCall call) {
        try {
            closeTranscriber();
            JSObject out = new JSObject();
            out.put("removed", store.remove(specs(call.getArray("files"))));
            call.resolve(out);
        } catch (JSONException e) {
            call.reject("the file list is malformed", ModelStore.Failure.STORAGE);
        }
    }

    private static List<ModelStore.FileSpec> specs(JSArray files) throws JSONException {
        List<ModelStore.FileSpec> out = new ArrayList<>();
        if (files == null) return out;
        for (int i = 0; i < files.length(); i++) {
            JSONObject file = files.getJSONObject(i);
            out.add(new ModelStore.FileSpec(file.getString("path"), file.getLong("bytes"), file.optString("sha256", "")));
        }
        return out;
    }

    private static List<String> strings(JSArray array) {
        List<String> out = new ArrayList<>();
        if (array == null) return out;
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, null);
            if (value != null && !value.isEmpty()) out.add(value);
        }
        return out;
    }

    /* Lifecycle                                                                           */

    /** Nothing records in the background — the activity pausing ends any capture. */
    @Override
    protected void handleOnPause() {
        abortAnyCapture();
    }

    @Override
    protected void handleOnStop() {
        closeTranscriber();
        closeProposer();
    }

    @Override
    protected void handleOnDestroy() {
        abortAnyCapture();
        clips.releaseAll();
        closeTranscriber();
        closeProposer();
        worker.shutdownNow();
    }
}
