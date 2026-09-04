package com.thinkmusic.alexithymia.journal;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

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
