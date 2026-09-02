import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Keyboard } from '@capacitor/keyboard';
import { isNative } from './platform';
import { primeNativeTier } from './journalPlugin';

/** Routes from which "back" means "leave the app" rather than "go up". */
const ROOT_ROUTES = new Set(['/', '/login']);

/**
 * Native chrome that has no web equivalent: the hardware back button, the status bar, and
 * the soft keyboard.
 *
 * All of it is a no-op on web, so `Shell` can call this unconditionally.
 */
export default function useNativeShell() {
    const navigate = useNavigate();
    const location = useLocation();

    // The hardware back button.
    //
    // Capacitor's default is to pop the WebView's history, which sounds right and is not:
    // it walks *behind* the React Router entry stack and can strand the app on a blank
    // document. Owning the handler keeps one notion of "back" — and makes the root case
    // explicit, since a back press on the dashboard should minimise the app the way every
    // other Android app does, not sign the user out or dead-end on a white screen.
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

    // What this device can run (§5.5). One read of the memory report through the journal
    // plugin, so the settings screen and the Vault page have the number before they are
    // reached. It asks for no permission and opens no device — the microphone is asked for
    // on the first tap of the button and nowhere else.
    useEffect(() => {
        if (!isNative()) return;
        primeNativeTier();
    }, []);

    // The status bar. The app is light-on-white (`bg-slate-50`), so the icons must be dark —
    // `Style.Light` in this API means "light background, dark content", which reads backwards
    // the first time and is the usual source of invisible white-on-white status icons.
    useEffect(() => {
        if (!isNative()) return;
        StatusBar.setStyle({ style: Style.Light }).catch(() => { });
        StatusBar.setBackgroundColor({ color: '#f8fafc' }).catch(() => { });
    }, []);

    // Tell the layout how tall the keyboard is, so a focused field can sit above it.
    // `--alq-keyboard` is consumed by the bottom navigation and the sheet padding in
    // `index.css`; the bar hides itself entirely while the keyboard is up, because a form
    // that is being typed into does not want four tab targets under the cursor.
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
