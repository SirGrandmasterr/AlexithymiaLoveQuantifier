import { describe, it, expect, afterEach } from 'vitest';
import {
    TIERS,
    captureCapabilities,
    missingCapability,
    detectTier,
    effectiveTier,
    canTranscribe,
    isTier,
    voiceAvailability,
    LIGHT_TIER_MIN_MEMORY_GB,
    FULL_TIER_MIN_MEMORY_GB,
    nominalMemoryGb,
    tierFromMemory,
    setNativeTierReport,
    probeWebGpu,
    webGpuAvailable,
    setWebGpuAvailable
} from './tier';

/** A browser that can do everything. Each test takes one thing away from it. */
const capable = (overrides = {}) => ({
    isSecureContext: true,
    MediaRecorder: function MediaRecorder() { },
    OfflineAudioContext: function OfflineAudioContext() { },
    WebAssembly: { instantiate: () => { } },
    crypto: { subtle: { digest: () => { } } },
    caches: { open: () => { } },
    navigator: { mediaDevices: { getUserMedia: () => { } }, deviceMemory: 8 },
    ...overrides
});

describe('what a device can do', () => {
    // The adapter answer is cached for the life of the module, which is what makes it
    // one request per session in the app and one leak per test without this line.
    afterEach(() => setWebGpuAvailable(null));

    it('reports every capability by name, so a refusal can say which one is missing', () => {
        const found = captureCapabilities(capable());
        expect(found).toEqual({
            secureContext: true, microphone: true, recorder: true, audioContext: true,
            wasm: true, digest: true, storage: true, webgpu: false
        });
        expect(missingCapability(found)).toBeNull();
    });

    it.each([
        ['a page served over plain http', { isSecureContext: false }, 'secureContext'],
        ['no microphone API at all', { navigator: { deviceMemory: 8 } }, 'microphone'],
        ['no MediaRecorder', { MediaRecorder: undefined }, 'recorder'],
        ['no Web Audio', { OfflineAudioContext: undefined }, 'audioContext'],
        ['no WebAssembly', { WebAssembly: undefined }, 'wasm'],
        ['no WebCrypto to verify a download with', { crypto: {} }, 'digest'],
        ['nowhere to keep the model', { caches: undefined }, 'storage']
    ])('is text-only with %s', (_name, missing, expected) => {
        const view = capable(missing);
        expect(missingCapability(captureCapabilities(view))).toBe(expected);
        expect(detectTier(view)).toBe(TIERS.textOnly);
    });

    it('does not require WebGPU for the transcriber — that is the Full tier model', () => {
        // §5.5's tier table reads "no WebGPU on the web → text-only"; its own desktop table
        // says the Light-tier transcriber runs on "WASM otherwise (slow but functional)".
        // The second is the one this code follows, and the design document now says so.
        expect(detectTier(capable({ navigator: { mediaDevices: { getUserMedia: () => { } }, deviceMemory: 8 } }))).toBe(TIERS.light);
    });

    it('is full only where WebGPU actually hands over an adapter', async () => {
        const view = capable();

        // The property alone is not the answer, and D3 measured a browser where it lied:
        // `navigator.gpu` present, `crossOriginIsolated` true, an RTX 3080 behind WebGL2 —
        // and `requestAdapter()` returning `null` for every option. A device promised the
        // Full tier on that basis downloads 3.4 GB and throws at the first check-in.
        view.navigator.gpu = { requestAdapter: async () => null };
        setWebGpuAvailable(null);
        expect(detectTier(view)).toBe(TIERS.light);       // unasked reads as Light
        await probeWebGpu(view);
        expect(webGpuAvailable()).toBe(false);
        expect(detectTier(view)).toBe(TIERS.light);

        view.navigator.gpu = { requestAdapter: async () => ({ name: 'an adapter' }) };
        setWebGpuAvailable(null);
        await probeWebGpu(view);
        expect(webGpuAvailable()).toBe(true);
        expect(detectTier(view)).toBe(TIERS.full);
    });

    it('reads a browser that throws on the request as a no, not as an error', async () => {
        const view = capable();
        view.navigator.gpu = { requestAdapter: async () => { throw new Error('no'); } };
        setWebGpuAvailable(null);
        expect(await probeWebGpu(view)).toBe(false);
        expect(detectTier(view)).toBe(TIERS.light);
    });

    it('asks once, however many callers ask', async () => {
        const view = capable();
        let asked = 0;
        view.navigator.gpu = { requestAdapter: async () => { asked += 1; return {}; } };
        setWebGpuAvailable(null);

        await Promise.all([probeWebGpu(view), probeWebGpu(view), probeWebGpu(view)]);
        await probeWebGpu(view);
        expect(asked).toBe(1);
    });

    it('is text-only below the memory floor, and light where memory is not reported at all', () => {
        const small = capable();
        small.navigator.deviceMemory = LIGHT_TIER_MIN_MEMORY_GB - 1;
        expect(detectTier(small)).toBe(TIERS.textOnly);

        // Firefox and Safari do not implement `deviceMemory`. A missing number is not a small
        // number — reading a gap as a value is the mistake this whole app is written against.
        const unreported = capable();
        delete unreported.navigator.deviceMemory;
        expect(detectTier(unreported)).toBe(TIERS.light);
    });
});

describe('the user override', () => {
    it('accepts only the three tier ids', () => {
        expect(isTier('light')).toBe(true);
        expect(isTier('text-only')).toBe(true);
        ['', null, undefined, 'huge', 'FULL'].forEach(bad => expect(isTier(bad)).toBe(false));
    });

    it('lets a user ask this device to do less', () => {
        expect(effectiveTier(TIERS.full, TIERS.light)).toEqual({
            tier: TIERS.light, override: TIERS.light, refused: null
        });
        expect(effectiveTier(TIERS.light, TIERS.textOnly).tier).toBe(TIERS.textOnly);
    });

    it('refuses one that would claim more than the device has, and says so', () => {
        // A pinned `full` on a machine with no WebGPU would make the settings screen promise
        // a model that cannot load. §9.7's "overridable" is there so somebody on a hot laptop
        // can choose to do less, not so the app can be talked into claiming more.
        expect(effectiveTier(TIERS.light, TIERS.full)).toEqual({
            tier: TIERS.light, override: null, refused: TIERS.full
        });
        expect(effectiveTier(TIERS.textOnly, TIERS.light).refused).toBe(TIERS.light);
    });

    it('treats no override and a matching override the same', () => {
        expect(effectiveTier(TIERS.light, null).tier).toBe(TIERS.light);
        expect(effectiveTier(TIERS.light, 'nonsense').refused).toBeNull();
        expect(effectiveTier(TIERS.light, TIERS.light).override).toBeNull();
    });
});

describe('voiceAvailability', () => {
    it('offers the toggle only where the transcriber could run', () => {
        expect(canTranscribe(TIERS.full)).toBe(true);
        expect(canTranscribe(TIERS.light)).toBe(true);
        expect(canTranscribe(TIERS.textOnly)).toBe(false);

        expect(voiceAvailability({ detected: TIERS.textOnly, voiceOn: true }).offerToggle).toBe(false);
        expect(voiceAvailability({ detected: TIERS.light, voiceOn: false }).offerToggle).toBe(true);
    });

    it('shows the microphone only when the device can, the user asked, and discretion is off', () => {
        const on = voiceAvailability({ detected: TIERS.light, voiceOn: true });
        expect(on.showMicrophone).toBe(true);
        expect(on.showKeyboard).toBe(false);

        expect(voiceAvailability({ detected: TIERS.light, voiceOn: false }).showMicrophone).toBe(false);
        expect(voiceAvailability({ detected: TIERS.textOnly, voiceOn: true }).showMicrophone).toBe(false);
    });

    it('replaces the microphone with the keyboard under discretion, never disables it', () => {
        // A greyed-out microphone still says *you could be recording* to anyone looking over
        // a shoulder, which is the exact thing the mode exists to prevent (§4.4, §9.6).
        const discreet = voiceAvailability({ detected: TIERS.light, voiceOn: true, discreet: true });
        expect(discreet.showMicrophone).toBe(false);
        expect(discreet.showKeyboard).toBe(true);
        // And it is still a capable device — the mode hides the offer, it does not downgrade
        // the machine, so leaving the mode restores the microphone with no further decision.
        expect(discreet.capable).toBe(true);
        expect(discreet.tier).toBe(TIERS.light);
    });

    it('carries a refused override through, so the screen can say what happened', () => {
        const refused = voiceAvailability({ detected: TIERS.light, override: TIERS.full, voiceOn: true });
        expect(refused.refused).toBe(TIERS.full);
        expect(refused.tier).toBe(TIERS.light);
        expect(refused.showMicrophone).toBe(true);
    });
});

/* ------------------------------------------------------------------------------------ */
/* C4: Android, from the plugin's memory report                                          */
/* ------------------------------------------------------------------------------------ */

describe('the tier on Android, from what ActivityManager reports', () => {
    const gib = (n) => n * 1024 ** 3;
    afterEach(() => setNativeTierReport(null));

    it('rounds the reported bytes up to the gigabytes the phone is sold with', () => {
        // The kernel never sees all of it: a "4 GB" phone reports about 3.6 GiB.
        expect(nominalMemoryGb(gib(3.6))).toBe(4);
        expect(nominalMemoryGb(gib(5.7))).toBe(6);
        expect(nominalMemoryGb(gib(7.6))).toBe(8);
        expect(nominalMemoryGb(gib(2.8))).toBe(3);
        expect(nominalMemoryGb(0)).toBeNull();
        expect(nominalMemoryGb(undefined)).toBeNull();
    });

    it.each([
        ['a 3 GB phone', gib(2.8), TIERS.textOnly],
        ['a 4 GB phone', gib(3.6), TIERS.light],
        ['a 5 GB phone', gib(4.7), TIERS.light],
        ['a 6 GB phone', gib(5.7), TIERS.full],
        ['an 8 GB phone', gib(7.6), TIERS.full],
        ['a 12 GB phone', gib(11.5), TIERS.full]
    ])('maps %s to §5.5\'s tier', (_name, totalMemoryBytes, expected) => {
        expect(tierFromMemory({ totalMemoryBytes, lowRamDevice: false })).toBe(expected);
    });

    it('holds §5.5\'s two boundaries', () => {
        expect(tierFromMemory({ totalMemoryBytes: gib(LIGHT_TIER_MIN_MEMORY_GB - 0.4) })).toBe(TIERS.light);
        expect(tierFromMemory({ totalMemoryBytes: gib(LIGHT_TIER_MIN_MEMORY_GB - 1.2) })).toBe(TIERS.textOnly);
        expect(tierFromMemory({ totalMemoryBytes: gib(FULL_TIER_MIN_MEMORY_GB - 0.4) })).toBe(TIERS.full);
        expect(tierFromMemory({ totalMemoryBytes: gib(FULL_TIER_MIN_MEMORY_GB - 1.2) })).toBe(TIERS.light);
    });

    it('takes the platform\'s word that a device is low-RAM, whatever the number says', () => {
        expect(tierFromMemory({ totalMemoryBytes: gib(7.6), lowRamDevice: true })).toBe(TIERS.textOnly);
    });

    it('reads a missing report as the floor, never as a number', () => {
        expect(tierFromMemory(null)).toBe(TIERS.textOnly);
        expect(tierFromMemory({})).toBe(TIERS.textOnly);
        expect(tierFromMemory({ totalMemoryBytes: 'lots' })).toBe(TIERS.textOnly);
    });

    it('beats the WebView\'s own guess once the report is in', () => {
        // `navigator.deviceMemory` rounds down to a power of two: a 6 GB phone says 4.
        const view = capable({ navigator: { mediaDevices: { getUserMedia: () => { } }, deviceMemory: 4 } });
        expect(detectTier(view)).toBe(TIERS.light);
        expect(detectTier(view, { native: { totalMemoryBytes: gib(5.7) } })).toBe(TIERS.full);

        setNativeTierReport({ totalMemoryBytes: gib(5.7), lowRamDevice: false });
        expect(detectTier(view)).toBe(TIERS.full);
        // And the WebView's capabilities are not consulted at all: capture is native.
        expect(detectTier(capable({ isSecureContext: false }))).toBe(TIERS.full);
    });

    it('lets the user pin a full phone down to the small transcriber, and refuses the other way', () => {
        setNativeTierReport({ totalMemoryBytes: gib(7.6), lowRamDevice: false });
        expect(detectTier()).toBe(TIERS.full);
        expect(effectiveTier(detectTier(), TIERS.light)).toEqual({ tier: TIERS.light, override: TIERS.light, refused: null });
        expect(voiceAvailability({ detected: detectTier(), override: TIERS.light, voiceOn: true }).tier).toBe(TIERS.light);
        expect(voiceAvailability({ detected: detectTier(), override: TIERS.textOnly, voiceOn: true }).showMicrophone).toBe(false);

        setNativeTierReport({ totalMemoryBytes: gib(3.6), lowRamDevice: false });
        expect(detectTier()).toBe(TIERS.light);
        expect(effectiveTier(detectTier(), TIERS.full).refused).toBe(TIERS.full);
    });
});
