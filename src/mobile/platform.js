import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

export const isAndroid = () => Capacitor.getPlatform() === 'android';

/** Coarse viewport test, used for layout decisions that are about size, not about OS. */
export const isHandsetViewport = () =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
