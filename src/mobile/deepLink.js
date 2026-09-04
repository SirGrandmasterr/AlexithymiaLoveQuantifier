import { App as CapacitorApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { JOURNAL_RECORD_PATH, RITUAL_PATH } from '../constants/journal';
import { isNative } from './platform';

/**
 * The two places an Android intent may ask this app to open at, and nothing else.
 *
 * There are exactly two callers on the device: the nightly reminder
 * ([`ritualReminder.js`](ritualReminder.js)), which carries `extra.path`, and the launcher's
 * static *Check in* shortcut (`android-config/app/src/main/res/xml/shortcuts.xml`), which
 * carries a URL. Both are things this app itself declared, so the set of paths they may name
 * is closed and this module keeps the list.
 *
 * **An allow-list rather than a parser** because an intent is input from outside the app: any
 * installed application can send an explicit `ACTION_VIEW` at an exported activity, and
 * `MainActivity` is exported because it is the launcher activity. Turning whatever arrives
 * into a route would let a third party choose the screen — harmless today, since every screen
 * is behind the same session and the same lock, and not a property to leave to luck. Two
 * strings, compared whole.
 *
 * **Where the lock comes in.** This module registers no listeners of its own; `useNativeShell`
 * does, and that hook runs inside `Shell`, which `AppLock` renders **only when the lock is
 * open** (`App.jsx`: the lock is outermost, and `AppLock` returns its children or the lock
 * screen — never both). So a notification tapped on a locked phone reaches the lock screen and
 * stops there. Nothing was needed to make that true and nothing may be added that makes it
 * false: the navigation must not move above `AppLock`. Capacitor holds the event in the
 * meantime — `Plugin.notifyListeners(…, retainUntilConsumed = true)` on the native side keeps
 * an event with no listener and delivers it to the first one that registers — so the ritual
 * opens the moment the passphrase is accepted, rather than being lost.
 */
export const DEEP_LINK_TARGETS = [RITUAL_PATH, JOURNAL_RECORD_PATH];

/** The path if it is one this app asked to be opened at, `null` otherwise. */
export const deepLinkTarget = (path) => (
    DEEP_LINK_TARGETS.includes(path) ? path : null
);

/**
 * The in-app path a launch URL names, or `null`.
 *
 * The shortcut's URL is `<custom scheme>://journal?record=1` — Capacitor's `custom_url_scheme`
 * is the application id, and the segment after `//` is the first part of the path rather than
 * a host, because there is no host: the app is the whole authority. So the conversion is
 * "drop the scheme and the slashes, put one slash back", and the result is checked against the
 * list above like any other candidate.
 */
export const pathFromLaunchUrl = (url) => {
    const raw = String(url ?? '');
    const afterScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    // No scheme means this is not a launch URL at all, and a bare path from an unknown source
    // is exactly what the allow-list exists to refuse.
    if (afterScheme === raw) return null;

    return deepLinkTarget(`/${afterScheme.replace(/^\/+/, '')}`);
};

/**
 * Watch both intent channels, and hand the caller a path when one names a place to go.
 *
 * @param {(path: string) => void} onPath
 * @returns {() => void} a cleanup that removes both listeners.
 */
export const watchDeepLinks = (onPath) => {
    if (!isNative()) return () => { };

    const handles = [
        // The launcher shortcut. Capacitor's App plugin fires this for any `ACTION_VIEW`
        // intent carrying data, including the explicit one the shortcut sends — an intent
        // filter is not needed for an intent addressed to the activity by name.
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
