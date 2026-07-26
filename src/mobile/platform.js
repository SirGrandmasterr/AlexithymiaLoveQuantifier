import { Capacitor } from '@capacitor/core';

/**
 * Platform predicates.
 *
 * Everything under `src/mobile/` is written so that the **web build is byte-for-byte
 * unaffected**: every helper here short-circuits to the existing behaviour when
 * `isNative()` is false. That is the price of admission for shipping one codebase to two
 * targets — a mobile affordance that changes the web app is a regression, not a feature.
 */

export const isNative = () => Capacitor.isNativePlatform();

export const isAndroid = () => Capacitor.getPlatform() === 'android';

/** Coarse viewport test, used for layout decisions that are about size, not about OS. */
export const isHandsetViewport = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
