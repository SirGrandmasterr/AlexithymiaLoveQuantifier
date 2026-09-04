/**
 * What this device can actually run, and what the user is allowed to say about it.
 *
 * §5.5 gives three tiers. Detection is one function over a handful of browser facts — or,
 * on Android, over the memory report the native plugin makes — kept here rather than in a
 * component so it can be tested against a fake `navigator` or a fake report: a tier decided
 * inside a render is a tier nobody can write a test for.
 *
 * **One refinement of §5.5's tier table, for the web, discovered while building C3.** The
 * table reads *"text-only: below 4 GB, or no WebGPU on the web"*, while the same section's
 * desktop-browser table says the Light-tier transcriber runs on *"WebGPU when present, WASM
 * otherwise (slow but functional)"*. Both cannot be true, and the second is the accurate
 * one: **WebGPU is mandatory for Gemma and optional for Whisper.** So on the web the line
 * between `light` and `text-only` is not WebGPU — it is whether the browser can run WASM,
 * record audio, and hash bytes at all. The design document now says so.
 *
 * The secure-context requirement is the sharp edge and it is not theoretical for this
 * product. `getUserMedia`, `crypto.subtle` and `CacheStorage` all exist **only in a secure
 * context**; a self-hosted install reached over plain `http://` on a home network — which is
 * how these installs are most often reached — has none of the three. That device is
 * `text-only`, and the settings screen says so in words rather than showing a toggle that
 * cannot work. It is the same condition `isLockAvailable()` already reports for the app lock.
 */

/** §5.5's three tiers. Ids, not labels — the copy for each lives in `JOURNAL_COPY`. */
export const TIERS = { full: 'full', light: 'light', textOnly: 'text-only' };

/** Below this many GB of reported memory, §5.5 puts a device on the text-only floor. */
export const LIGHT_TIER_MIN_MEMORY_GB = 4;

/**
 * From this many GB, the audio encoder fits beside the model: the Full tier.
 *
 * **Kept at §5.5's 6 GB after D3 measured what it could, and the reasoning matters more than
 * the number.** §5.5 asked for peak RAM *with the audio encoder loaded* and warned to plan for
 * 2–2.5 GB. D3 measured the encoder's **marginal** cost rather than the absolute peak, because
 * the absolute peak is a property of a phone and no phone was available: on x86-64 CPU the
 * same bundle, the same prompt and the same 4,096-token context peaked at **3,291 MB with the
 * audio encoder and 3,122 MB without it — a difference of 169 MB**. The encoder is not what
 * decides this boundary; the language model underneath it is.
 *
 * Against LiteRT-LM's published Android figure of 1,733 MB text-only, that puts a Full-tier
 * pass at roughly **1.9 GB on a phone** — the bottom of §5.5's planning range rather than the
 * top. That is an argument for 6 GB being conservative, and it is deliberately not acted on:
 * the number that would justify moving it is a peak measured on a 4 GB phone under Android's
 * low-memory killer, and an off-device delta is not that number. A user who disagrees has the
 * override, which only ever goes down.
 */
export const FULL_TIER_MIN_MEMORY_GB = 6;

/**
 * The Full tier needs a 64-bit device, and this is a fact about the runtime rather than a
 * judgement about the phone.
 *
 * `litertlm-android` 0.16.1 ships `liblitertlm_jni.so` for **arm64-v8a and x86_64 only** —
 * there is no armeabi-v7a build (checked inside the published AAR, 2026-09-02). ONNX Runtime,
 * which is what the Light tier's Whisper uses, does ship all four. So a 32-bit phone with
 * plenty of memory still gets the Light tier, and it gets it for a reason nobody can fix by
 * closing apps.
 */
export const FULL_TIER_NEEDS_64_BIT = true;

/* ------------------------------------------------------------------------------------ */
/* Android: the plugin's report, and §5.5's memory table                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * What the native plugin reported about this device, or `null` in a browser.
 *
 * Set once by `primeNativeTier()` (`src/mobile/journalPlugin.js`) when the app shell
 * mounts on Android. It is held here rather than read through Capacitor so that this
 * module stays pure and its tests stay device-free: the plugin reads numbers, this file
 * decides, and the boundary between them is a plain object.
 */
let nativeReport = null;

export const setNativeTierReport = (report) => {
    nativeReport = report && typeof report === 'object' ? { ...report } : null;
};

export const nativeTierReport = () => nativeReport;

/**
 * The whole gigabytes a phone is sold with, from the bytes it actually reports.
 *
 * `ActivityManager.totalMem` is what the kernel can see, and the kernel never sees all of
 * it: a "4 GB" phone reports around 3.6 GiB, a "6 GB" one around 5.7. Rounding *up* is the
 * reading that matches the box, and the box is what §5.5's boundaries were written
 * against. A device that genuinely has 3 GB reports ~2.8 and still rounds to 3.
 */
export const nominalMemoryGb = (bytes) => (
    Number.isFinite(bytes) && bytes > 0 ? Math.ceil(bytes / (1024 ** 3)) : null
);

/**
 * §5.5's tier table, from what `ActivityManager` reports: below 4 GB is text-only, 4 to
 * under 6 is Light, 6 and up is Full. `isLowRamDevice()` is the platform's own word that
 * the device should not be asked to carry a model, and it wins whatever the number says.
 *
 * The boundaries are the design document's, not this build's measurement: Light is 4 GB
 * because D3's text-mode Gemma needs it, not because Whisper does — Whisper tiny would run
 * on less. Keeping the floor where the design put it means a phone that has voice today
 * does not lose it the day proposals arrive.
 *
 * D3 added one condition and moved no boundary: a device that is not 64-bit cannot reach the
 * Full tier however much memory it has, because LiteRT-LM has no library for it. See
 * `FULL_TIER_NEEDS_64_BIT`.
 */
export const tierFromMemory = (report) => {
    if (!report || typeof report !== 'object') return TIERS.textOnly;
    if (report.lowRamDevice === true) return TIERS.textOnly;
    const gb = nominalMemoryGb(report.totalMemoryBytes);
    if (gb === null || gb < LIGHT_TIER_MIN_MEMORY_GB) return TIERS.textOnly;
    if (gb < FULL_TIER_MIN_MEMORY_GB) return TIERS.light;
    // A 32-bit device has no LiteRT-LM to run, whatever its memory says. `abi64` is absent on
    // a report written before D3, and an absent field is not a "no" — an old report from a
    // phone that has been running the Light tier all along should not be read as a refusal it
    // never made (invariant 14).
    if (FULL_TIER_NEEDS_64_BIT && report.abi64 === false) return TIERS.light;
    return TIERS.full;
};

/* ------------------------------------------------------------------------------------ */
/* The web: WebGPU, which has to be asked rather than looked for                          */
/* ------------------------------------------------------------------------------------ */

/**
 * Whether this browser can actually give the Full tier a GPU — `null` until it has been
 * asked.
 *
 * **`navigator.gpu` existing is not WebGPU working, and D3 measured the difference.** On a
 * Chromium 148 build with an RTX 3080 behind it, `navigator.gpu` was present,
 * `crossOriginIsolated` was true, WebGL2 reported the card by name — and
 * `navigator.gpu.requestAdapter()` returned `null` for every option, including
 * `forceFallbackAdapter`. A device detected as Full on the strength of the property alone
 * would have downloaded 3.4 GB and then thrown at the first check-in, which is precisely the
 * failure C3 recorded one layer down: *a backend that loads and then throws is worse than one
 * that was never offered.*
 *
 * So the answer is an **adapter request**, which is asynchronous, which is why this is a
 * primed value rather than a branch inside `detectTier`. It follows the shape the Android
 * report already uses: a screen reads the cached answer, and re-reads when the probe lands.
 * Until it lands the answer is "not Full", because claiming less than a device can do costs a
 * user one settings visit and claiming more costs them a download that cannot run.
 */
let webGpuAdapter = null;
let webGpuProbe = null;

/** For tests, and for the settings screen after a user changes a browser flag. */
export const setWebGpuAvailable = (value) => { webGpuAdapter = value === null ? null : Boolean(value); };

export const webGpuAvailable = () => webGpuAdapter;

/**
 * Ask for an adapter, once. Concurrent callers share the one request, and the result is
 * cached — a page that asked and was refused does not ask again on every render.
 */
export const probeWebGpu = (view = globalThis) => {
    if (webGpuAdapter !== null) return Promise.resolve(webGpuAdapter);
    if (webGpuProbe) return webGpuProbe;

    webGpuProbe = (async () => {
        try {
            const adapter = view.navigator?.gpu ? await view.navigator.gpu.requestAdapter() : null;
            webGpuAdapter = Boolean(adapter);
        } catch {
            // A browser that throws on the request has answered it.
            webGpuAdapter = false;
        }
        webGpuProbe = null;
        return webGpuAdapter;
    })();

    return webGpuProbe;
};

/**
 * Everything transcription needs, each checked by its own name so a refusal can say which
 * one is missing rather than "unavailable".
 */
export const captureCapabilities = (view = globalThis) => ({
    secureContext: view.isSecureContext === true,
    microphone: typeof view.navigator?.mediaDevices?.getUserMedia === 'function',
    recorder: typeof view.MediaRecorder === 'function',
    audioContext: typeof view.OfflineAudioContext === 'function' || typeof view.webkitOfflineAudioContext === 'function',
    wasm: typeof view.WebAssembly === 'object' && typeof view.WebAssembly?.instantiate === 'function',
    digest: typeof view.crypto?.subtle?.digest === 'function',
    storage: typeof view.caches?.open === 'function',
    // The property, which is only half the question — see `probeWebGpu`. Kept because a
    // browser without it cannot possibly have an adapter, so it is a cheap early no.
    webgpu: Boolean(view.navigator?.gpu)
});

/** The ones without which there is nothing to offer. WebGPU is deliberately not among them. */
const REQUIRED = ['secureContext', 'microphone', 'recorder', 'audioContext', 'wasm', 'digest', 'storage'];

/** The first missing requirement, or `null`. What the unavailable copy is keyed on. */
export const missingCapability = (capabilities) => REQUIRED.find(name => !capabilities[name]) || null;

/**
 * The tier this device detects itself as.
 *
 * On Android the answer is the plugin's memory report through `tierFromMemory`, and the
 * WebView's own capabilities are not consulted: capture, download, verification and
 * transcription all happen natively there, and `navigator.deviceMemory` in a WebView
 * rounds down to a power of two — a 6 GB phone reads as 4, which is the exact mistake the
 * plugin exists to avoid. `native` is injectable so a test can hand in a report.
 *
 * In a browser, `navigator.deviceMemory` is Chromium-only and coarse (it reports 0.25–8,
 * capped), so its absence is treated as "no reason to think this device is small" rather
 * than as a failure — refusing every Firefox and Safari on a missing API would be reading
 * a gap as a number, which is the mistake this whole app is written against.
 */
export const detectTier = (view = globalThis, { native = nativeReport } = {}) => {
    if (native) return tierFromMemory(native);

    const capabilities = captureCapabilities(view);
    if (missingCapability(capabilities)) return TIERS.textOnly;

    const memory = view.navigator?.deviceMemory;
    if (typeof memory === 'number' && memory > 0 && memory < LIGHT_TIER_MIN_MEMORY_GB) return TIERS.textOnly;

    // The Full tier needs an adapter and not an API. `webGpuAvailable()` is `null` until
    // `probeWebGpu()` has answered, and `null` reads as Light: a device is never promised
    // the Full tier on the strength of a property that D3 watched lie.
    return capabilities.webgpu && webGpuAvailable() === true ? TIERS.full : TIERS.light;
};

/** A tier a user may pin. `null` means "whatever this device detects". */
export const isTier = (value) => Object.values(TIERS).includes(value);

/**
 * What the app will do, given what the device can do and what the user pinned.
 *
 * An override **can only go down**, never up. Pinning `full` on a device with no WebGPU
 * would make the settings screen promise a model that cannot load, and §9.7's "overridable"
 * is there so somebody on a hot laptop can choose to do less — not so the app can be talked
 * into claiming more. A refused override is reported rather than silently ignored.
 */
export const effectiveTier = (detected, override) => {
    if (!isTier(override) || override === detected) return { tier: detected, override: null, refused: null };

    const order = [TIERS.textOnly, TIERS.light, TIERS.full];
    if (order.indexOf(override) > order.indexOf(detected)) {
        return { tier: detected, override: null, refused: override };
    }
    return { tier: override, override, refused: null };
};

/** Both tiers that can carry the transcriber. `text-only` is the one that cannot. */
export const canTranscribe = (tier) => tier === TIERS.full || tier === TIERS.light;

/**
 * Everything a screen needs to decide between a microphone, a keyboard, and a sentence
 * explaining why there is no microphone.
 *
 * `discreet` collapses the first case into the second on purpose (§4.4, §9.6): speaking a
 * note aloud defeats discretion mode, so the app does not offer to. It is not a disabled
 * microphone — a disabled control still says *you could be recording* to anyone looking at
 * the screen — it is the keyboard, which is what the mode is for.
 */
export const voiceAvailability = ({ detected, override, voiceOn, discreet = false } = {}) => {
    const { tier, refused } = effectiveTier(detected, override);
    const capable = canTranscribe(tier);
    // Written once, because the two are one decision. The composer offers the microphone or
    // it offers the keyboard, never both and never neither — and a De Morgan dual maintained
    // as a second expression is a screen with two inputs or none the day one of them is
    // edited and the other is not.
    const showMicrophone = capable && voiceOn === true && !discreet;

    return {
        tier,
        refused,
        capable,
        // The setting may only be turned on where it could do something. A toggle that
        // stores `true` on a device that cannot record is a Vault claim waiting to be false.
        offerToggle: capable,
        showMicrophone,
        showKeyboard: !showMicrophone
    };
};
