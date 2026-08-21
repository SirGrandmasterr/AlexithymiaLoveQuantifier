import { Haptics } from '@capacitor/haptics';
import { isNative } from './platform';
import { isDiscreetOnThisDevice } from '../context/DiscretionContext';

/**
 * The detent — what a turn of the vault dial feels and sounds like.
 *
 * A dial that moves silently is a slider with extra steps. The click is what tells you a
 * unit has passed without looking, which is the entire point of an input you operate with
 * the thumb that is covering the screen: the number is *heard*, and the eyes stay on the
 * label and the anchor phrase.
 *
 * Two channels, both throttled, both optional:
 *
 * - **Haptics**, native only, through the selection API rather than `impact`. Android's
 *   selection haptic is the one tuned for picker detents — an impact per unit at thumb speed
 *   is a buzz, not a click.
 * - **Sound**, synthesised rather than sampled. A short burst of noise through a pair of
 *   high-Q bandpasses is a small metal object being struck; an audio file would be four
 *   kilobytes and one more thing in the build for a worse result.
 *
 * Both are deliberately cheap to skip: the throttles below mean a fast flick costs a bounded
 * number of clicks rather than one per unit, which is both kinder to the ear and the
 * difference between a smooth drag and a stuttering one on a low-end phone.
 */

const SOUND_KEY = 'alq:dial-sound';

/** Below this, two clicks are one sound to a listener, so the second is wasted work. */
const SOUND_INTERVAL_MS = 22;
/** Haptics are coarser and more expensive; a vibration motor cannot keep up with 45 Hz. */
const HAPTIC_INTERVAL_MS = 32;

let audioContext = null;
let noiseBuffer = null;
let lastSoundAt = 0;
let lastHapticAt = 0;

/**
 * Sound is on by default where the dial is the primary input and off where it is not.
 *
 * On a phone the click is load-bearing. In a browser tab it is a page making noise at
 * someone who dragged a control with a mouse, which is bad manners — and where autoplay
 * policy may refuse it anyway.
 */
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

/**
 * The AudioContext is created on the first press and never before.
 *
 * A context constructed at import time starts suspended under every browser's autoplay
 * policy and stays that way until a gesture resumes it; building it inside `pointerdown` —
 * which *is* the gesture — is what makes the first click of the first turn audible instead
 * of the second.
 */
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

    // One second of white noise, generated once and re-pointed at for every click. Each
    // tick reads a different random offset, so no two clicks are the same sample twice —
    // that variation is most of what separates "a mechanism" from "a beep".
    const length = audioContext.sampleRate;
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) channel[i] = Math.random() * 2 - 1;

    return audioContext;
};

/**
 * One click: a 12 ms noise burst through two resonant bandpasses.
 *
 * The low band gives the body of the strike and the high one the metal in it. Both are
 * detuned a little per click, because a dial whose every detent is acoustically identical
 * sounds like a UI sound effect rather than a mechanism.
 */
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

/**
 * Whether this turn may make a sound.
 *
 * Discretion mode silences it outright, and that is not a nicety: the mode exists because
 * someone may be sitting next to you, and a dial clicking away announces both that you are
 * scoring something and how far you moved it. The haptic channel is unaffected — a
 * vibration in your own hand is not overheard.
 */
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
