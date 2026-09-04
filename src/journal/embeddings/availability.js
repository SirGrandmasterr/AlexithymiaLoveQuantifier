/**
 * Whether this device can keep an embedding index at all.
 *
 * The same rule `voiceAvailability` follows and for the same reason: **the setting may only
 * be turned on where it could do something.** A stored `true` on a device with no index is a
 * Vault claim waiting to be false — §10.2 says these numbers exist and are kept here, and a
 * page that says so on a device that has never made one is saying something untrue.
 *
 * Two conditions, and each is a thing that is either there or not:
 *
 * - **IndexedDB.** There is nowhere else to put ten megabytes of `Float32Array`. Absent in
 *   some private-mode configurations, and absent in jsdom, which is why every test that
 *   wants the feature injects a backing store rather than relying on the environment.
 * - **Not the Android shell.** There is no native embedding runtime in this slice. The
 *   plugin opens Whisper and LiteRT-LM (C4, D3); EmbeddingGemma through it is a Kotlin
 *   change with a Gradle build behind it, and G1 deliberately did not start one. Offering a
 *   toggle on a phone that cannot answer it would be worse than the phone not offering it,
 *   and this is written as a *missing runtime* rather than as a platform opinion so that the
 *   session which adds one deletes a condition rather than arguing with a rule.
 *
 * WebGPU is deliberately **not** a condition. This is a 300M model over a handful of
 * two-word labels, running on WASM like the Light tier's transcriber; requiring an adapter
 * that D3 watched be reported and then not exist would cost the feature on machines that can
 * perfectly well run it.
 */

import { isNative } from '../../mobile/platform';

export const embeddingsAvailable = (view = globalThis) => Boolean(
    view?.indexedDB && !isNative()
);
