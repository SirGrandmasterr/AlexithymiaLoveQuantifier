package com.thinkmusic.alexithymia.journal;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * The recorded clips, held in memory on the native side and addressed from JavaScript by
 * an opaque handle.
 *
 * This is what "audio never crosses the bridge" means in practice (§4.2, §5.5): the
 * WebView holds `clip-3`, this class holds the 480,000 floats, and the transcriber is
 * handed the floats by handle. Release zero-fills before it forgets, for the same reason
 * `recorder.js`'s discard does — a reference someone kept reads as silence, not a voice.
 * Nothing here touches a file; a killed process takes every clip with it, which is the
 * behaviour §4.2 promises.
 */
final class ClipStore {

    private final Map<String, float[]> clips = new HashMap<>();
    private int counter = 0;

    synchronized String keep(float[] samples) {
        counter += 1;
        String handle = "clip-" + counter;
        clips.put(handle, samples);
        return handle;
    }

    synchronized float[] get(String handle) {
        return handle == null ? null : clips.get(handle);
    }

    /** Idempotent: releasing a handle twice, or one that never existed, is not an error. */
    synchronized void release(String handle) {
        float[] samples = handle == null ? null : clips.remove(handle);
        if (samples != null) Arrays.fill(samples, 0f);
    }

    synchronized void releaseAll() {
        for (float[] samples : clips.values()) Arrays.fill(samples, 0f);
        clips.clear();
    }

    synchronized int size() {
        return clips.size();
    }
}
