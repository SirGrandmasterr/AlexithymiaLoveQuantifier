package com.thinkmusic.alexithymia.journal;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;

/**
 * What this device can carry, as the facts §5.5 keys its tier table on — reported, never
 * decided. The mapping from memory to `full` / `light` / `text-only` lives in
 * `src/journal/inference/tier.js` beside the web one, so the boundaries have a single home
 * and a single test; this class only reads the numbers.
 *
 * `ActivityManager` rather than the WebView's `navigator.deviceMemory`, because the latter
 * rounds down to a power of two and caps at 8: a 6 GB phone reports 4, which would put a
 * device that can carry the Full tier on the Light one for no reason but the API's
 * coarseness.
 */
final class TierProbe {

    private TierProbe() { }

    static JSObject report(Context context) {
        ActivityManager manager = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo info = new ActivityManager.MemoryInfo();
        long total = 0;
        long available = 0;
        boolean lowRam = false;
        if (manager != null) {
            manager.getMemoryInfo(info);
            total = info.totalMem;
            available = info.availMem;
            lowRam = manager.isLowRamDevice();
        }

        JSObject out = new JSObject();
        out.put("totalMemoryBytes", total);
        out.put("availableMemoryBytes", available);
        out.put("lowRamDevice", lowRam);
        out.put("apiLevel", Build.VERSION.SDK_INT);
        out.put("androidVersion", Build.VERSION.RELEASE == null ? "" : Build.VERSION.RELEASE);
        out.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        out.put("model", Build.MODEL == null ? "" : Build.MODEL);
        out.put("cores", Runtime.getRuntime().availableProcessors());
        // Whether this device can run LiteRT-LM at all (D3). Its JNI library ships for
        // arm64-v8a and x86_64 only, so a 32-bit phone is on the Light tier however much
        // memory it has — a fact about the runtime, reported here and decided in tier.js.
        // Build.SUPPORTED_64_BIT_ABIS has existed since API 21 and this app's floor is 24.
        out.put("abi64", Build.SUPPORTED_64_BIT_ABIS != null && Build.SUPPORTED_64_BIT_ABIS.length > 0);
        return out;
    }
}
