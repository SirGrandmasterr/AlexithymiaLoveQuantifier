import { Haptics } from '@capacitor/haptics';
import { isNative } from './platform';
import { isDiscreetOnThisDevice } from '../context/DiscretionContext';

const SOUND_KEY = 'alq:dial-sound';

/** Below this, two clicks are one sound to a listener, so the second is wasted work. */
const SOUND_INTERVAL_MS = 22;
/** Haptics are coarser and more expensive; a vibration motor cannot keep up with 45 Hz. */
const HAPTIC_INTERVAL_MS = 32;

let audioContext = null;
let noiseBuffer = null;
let lastSoundAt = 0;
let lastHapticAt = 0;

export const dialSoundEnabled = () => {
    try {
        const stored = window.localStorage.getItem(SOUND_KEY);
        if (stored !== null) return stored === 'true';
    } catch {
        // No storage: fall through to the platform default.
    }
    return isNative();
};

export const setDialSoundEnabled = (enabled) => {
    try {
        window.localStorage.setItem(SOUND_KEY, String(Boolean(enabled)));
    } catch {
        // The preference is lost at the next launch, which is not worth an error.
    }
};

const ensureContext = () => {
    if (audioContext) {
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => { });
        return audioContext;
    }

    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;

    try {
        audioContext = new Ctor();
    } catch {
        return null;
    }

    const length = audioContext.sampleRate;
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1;

    return audioContext;
};

const playClick = (context) => {
    const now = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    source.playbackRate.value = 1;
    // Start from a random offset into the noise, so consecutive clicks differ.
    const offset = Math.random() * (noiseBuffer.duration - 0.05);

    const body = context.createBiquadFilter();
    body.type = 'bandpass';
    body.frequency.value = 2400 + Math.random() * 220;
    body.Q.value = 9;

    const ring = context.createBiquadFilter();
    ring.type = 'bandpass';
    ring.frequency.value = 5200 + Math.random() * 500;
    ring.Q.value = 14;

    const gain = context.createGain();
    // A hard attack and a near-immediate decay. Anything slower is a tap on wood.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

    source.connect(body);
    body.connect(ring);
    ring.connect(gain);
    gain.connect(context.destination);

    source.start(now, offset, 0.05);
    source.stop(now + 0.05);
};

const mayPlay = () => dialSoundEnabled() && !isDiscreetOnThisDevice();

/** Prime the feedback channels at the start of a turn. */
export const startTurn = () => {
    if (mayPlay()) ensureContext();
    if (isNative()) Haptics.selectionStart().catch(() => { });
};

/** One detent passed. Safe to call per unit — everything inside is rate-limited. */
export const detent = () => {
    const now = Date.now();

    if (mayPlay() && now - lastSoundAt >= SOUND_INTERVAL_MS) {
        lastSoundAt = now;
        const context = ensureContext();
        if (context && context.state === 'running') playClick(context);
    }

    if (isNative() && now - lastHapticAt >= HAPTIC_INTERVAL_MS) {
        lastHapticAt = now;
        Haptics.selectionChanged().catch(() => { });
    }
};

export const endTurn = () => {
    if (isNative()) Haptics.selectionEnd().catch(() => { });
};
