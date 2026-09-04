package com.thinkmusic.alexithymia.journal;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;

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
        out.put("abi64", Build.SUPPORTED_64_BIT_ABIS != null && Build.SUPPORTED_64_BIT_ABIS.length > 0);
        return out;
    }
}
