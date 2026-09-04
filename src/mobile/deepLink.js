import { App as CapacitorApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { JOURNAL_RECORD_PATH, RITUAL_PATH } from '../constants/journal';
import { isNative } from './platform';

export const DEEP_LINK_TARGETS = [RITUAL_PATH, JOURNAL_RECORD_PATH];

/** The path if it is one this app asked to be opened at, `null` otherwise. */
export const deepLinkTarget = (path) => (
    DEEP_LINK_TARGETS.includes(path) ? path : null
);

export const pathFromLaunchUrl = (url) => {
    const raw = String(url ?? '');
    const afterScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    // No scheme means this is not a launch URL at all, and a bare path from an unknown source
    // is exactly what the allow-list exists to refuse.
    if (afterScheme === raw) return null;

    return deepLinkTarget(`/${afterScheme.replace(/^\/+/, '')}`);
};

export const watchDeepLinks = (onPath) => {
    if (!isNative()) return () => { };

    const handles = [
        CapacitorApp.addListener('appUrlOpen', ({ url }) => {
            const path = pathFromLaunchUrl(url);
            if (path) onPath(path);
        }),
        // The nightly reminder. The plugin fires this on a tap and hands back the whole
        // notification, `extra` included; the path is the only thing this app puts in there.
        LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
            const path = deepLinkTarget(event?.notification?.extra?.path);
            if (path) onPath(path);
        })
    ];

    return () => {
        handles.forEach(handle => handle.then?.(listener => listener.remove()));
    };
};
