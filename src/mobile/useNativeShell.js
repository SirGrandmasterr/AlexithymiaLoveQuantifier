import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { isNative } from './platform';
import { primeNativeTier } from './journalPlugin';
import { watchDeepLinks } from './deepLink';
import { syncRitualReminder } from './ritualReminder';

/** Routes from which "back" means "leave the app" rather than "go up". */
const ROOT_ROUTES = new Set(['/', '/login']);

export default function useNativeShell() {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (!isNative()) return undefined;

        const handle = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
            if (ROOT_ROUTES.has(location.pathname)) {
                CapacitorApp.minimizeApp();
                return;
            }
            if (canGoBack) navigate(-1);
            else navigate('/');
        });

        return () => { handle.then((listener) => listener.remove()); };
    }, [navigate, location.pathname]);

    useEffect(() => {
        if (!isNative()) return;
        primeNativeTier();
    }, []);

    useEffect(() => {
        if (!isNative()) return undefined;
        return watchDeepLinks((path) => navigate(path));
    }, [navigate]);

    useEffect(() => {
        if (!isNative()) return;
        syncRitualReminder();
    }, []);

    useEffect(() => {
        if (!isNative()) return;
        StatusBar.setStyle({ style: Style.Light }).catch(() => { });
        StatusBar.setBackgroundColor({ color: '#f8fafc' }).catch(() => { });
    }, []);

    useEffect(() => {
        if (!isNative()) return undefined;

        const root = document.documentElement;
        const show = Keyboard.addListener('keyboardWillShow', (info) => {
            root.style.setProperty('--alq-keyboard', `${info.keyboardHeight}px`);
            root.classList.add('alq-keyboard-open');
        });
        const hide = Keyboard.addListener('keyboardWillHide', () => {
            root.style.setProperty('--alq-keyboard', '0px');
            root.classList.remove('alq-keyboard-open');
        });

        return () => {
            show.then((listener) => listener.remove());
            hide.then((listener) => listener.remove());
        };
    }, []);
}
