import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { renewIfDue } from './session';
import { isNative } from '../mobile/platform';

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
