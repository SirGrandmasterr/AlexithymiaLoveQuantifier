import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { renewIfDue } from './session';
import { isNative } from '../mobile/platform';

/**
 * Renew the session at the moments it is most likely to have gone stale.
 *
 * The 401-and-retry path in `session.js` is the safety net; this is the thing that means the
 * net is rarely needed. A phone is resumed rather than reloaded — the app can sit in the
 * background for a week — so "when the user comes back" is precisely when the token is old,
 * and it is also the one moment when a round trip costs the user nothing: they are still
 * looking at the launcher animation.
 *
 * Both signals are wired, and they overlap deliberately. `visibilitychange` covers a browser
 * tab and usually fires in the WebView too; Capacitor's `resume` is the one that can be
 * relied on after Android has killed and restored the activity. `renewIfDue` is cheap and
 * idempotent — it returns immediately unless the token is inside its renewal margin — so a
 * doubled signal costs one comparison, not one request.
 *
 * @param {boolean} enabled false while signed out, when there is nothing to renew.
 */
export default function useSessionRenewal(enabled) {
    useEffect(() => {
        if (!enabled) return undefined;

        // On mount: a reload, or a cold start with a token stored days ago.
        renewIfDue();

        const onVisible = () => {
            if (document.visibilityState === 'visible') renewIfDue();
        };
        document.addEventListener('visibilitychange', onVisible);

        let resume;
        if (isNative()) {
            resume = CapacitorApp.addListener('resume', () => { renewIfDue(); });
        }

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            resume?.then((listener) => listener.remove());
        };
    }, [enabled]);
}
