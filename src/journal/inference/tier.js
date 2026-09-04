/** §5.5's three tiers. Ids, not labels — the copy for each lives in `JOURNAL_COPY`. */
export const TIERS = { full: 'full', light: 'light', textOnly: 'text-only' };

/** Below this many GB of reported memory, §5.5 puts a device on the text-only floor. */
export const LIGHT_TIER_MIN_MEMORY_GB = 4;

export const FULL_TIER_MIN_MEMORY_GB = 6;

export const FULL_TIER_NEEDS_64_BIT = true;

/* Android: the plugin's report, and §5.5's memory table */

let nativeReport = null;

export const setNativeTierReport = (report) => {
    nativeReport = report && typeof report === 'object' ? { ...report } : null;
};

export const nativeTierReport = () => nativeReport;

export const nominalMemoryGb = (bytes) => (
    Number.isFinite(bytes) && bytes > 0 ? Math.ceil(bytes / (1024 ** 3)) : null
);

export const tierFromMemory = (report) => {
    if (!report || typeof report !== 'object') return TIERS.textOnly;
    if (report.lowRamDevice === true) return TIERS.textOnly;
    const gb = nominalMemoryGb(report.totalMemoryBytes);
    if (gb === null || gb < LIGHT_TIER_MIN_MEMORY_GB) return TIERS.textOnly;
    if (gb < FULL_TIER_MIN_MEMORY_GB) return TIERS.light;
    if (FULL_TIER_NEEDS_64_BIT && report.abi64 === false) return TIERS.light;
    return TIERS.full;
};

/* The web: WebGPU, which has to be asked rather than looked for */

let webGpuAdapter = null;
let webGpuProbe = null;

/** For tests, and for the settings screen after a user changes a browser flag. */
export const setWebGpuAvailable = (value) => { webGpuAdapter = value === null ? null : Boolean(value); };

export const webGpuAvailable = () => webGpuAdapter;

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

export const detectTier = (view = globalThis, { native = nativeReport } = {}) => {
    if (native) return tierFromMemory(native);

    const capabilities = captureCapabilities(view);
    if (missingCapability(capabilities)) return TIERS.textOnly;

    const memory = view.navigator?.deviceMemory;
    if (typeof memory === 'number' && memory > 0 && memory < LIGHT_TIER_MIN_MEMORY_GB) return TIERS.textOnly;

    return capabilities.webgpu && webGpuAvailable() === true ? TIERS.full : TIERS.light;
};

/** A tier a user may pin. `null` means "whatever this device detects". */
export const isTier = (value) => Object.values(TIERS).includes(value);

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

export const voiceAvailability = ({ detected, override, voiceOn, discreet = false } = {}) => {
    const { tier, refused } = effectiveTier(detected, override);
    const capable = canTranscribe(tier);
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
