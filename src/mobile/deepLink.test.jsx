import React, { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEEP_LINK_TARGETS, deepLinkTarget, pathFromLaunchUrl, watchDeepLinks } from './deepLink';
import { JOURNAL_RECORD_PATH, RITUAL_PATH } from '../constants/journal';
import AppLock, { hashPassphrase, setLockHash } from '../components/AppLock';

/**
 * The two intents that name a screen: the reminder's tap and the launcher's shortcut.
 *
 * The second half of this file is the one §9.6 asks to be **verified rather than assumed** —
 * that a deep link lands on the lock screen first. It is a structural claim (the listener
 * lives under `AppLock`, which renders its children or the lock and never both), so it is
 * tested structurally: with a passphrase set, nothing registers and nothing navigates, and the
 * event Capacitor retained arrives only once the passphrase has been accepted.
 */

const platformState = vi.hoisted(() => ({ native: true }));

vi.mock('./platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

/**
 * A Capacitor listener registry with **retention**, because that is the behaviour the lock
 * case rests on: `Plugin.notifyListeners(name, data, retainUntilConsumed = true)` on the
 * native side holds an event that has no listener and hands it to the first one to register
 * (`Plugin.java`, `sendRetainedArgumentsForEvent`; the JavaScript side does the same in
 * `@capacitor/core`). Both events this app listens for are fired with that flag.
 */
const bridge = vi.hoisted(() => {
    const state = { listeners: new Map(), retained: new Map() };

    const addListener = (event, handler) => {
        const list = state.listeners.get(event) ?? [];
        const first = list.length === 0;
        state.listeners.set(event, [...list, handler]);

        if (first) {
            (state.retained.get(event) ?? []).forEach(data => handler(data));
            state.retained.delete(event);
        }

        return Promise.resolve({
            remove: () => {
                state.listeners.set(event, (state.listeners.get(event) ?? []).filter(one => one !== handler));
            }
        });
    };

    const fire = (event, data) => {
        const list = state.listeners.get(event) ?? [];
        if (list.length === 0) {
            state.retained.set(event, [...(state.retained.get(event) ?? []), data]);
            return;
        }
        list.forEach(handler => handler(data));
    };

    return { state, addListener, fire };
});

vi.mock('@capacitor/app', () => ({ App: { addListener: bridge.addListener } }));
vi.mock('@capacitor/local-notifications', () => ({
    LocalNotifications: { addListener: bridge.addListener }
}));

const listenerCount = (event) => (bridge.state.listeners.get(event) ?? []).length;

const tapNotification = (path) => bridge.fire('localNotificationActionPerformed', {
    actionId: 'tap',
    notification: { id: 1000000001, extra: { path } }
});

const openShortcut = (url) => bridge.fire('appUrlOpen', { url });

/** A component that does what `useNativeShell` does, and only that. */
const Consumer = ({ onPath }) => {
    useEffect(() => watchDeepLinks(onPath), [onPath]);
    return <p>the app</p>;
};

beforeEach(() => {
    platformState.native = true;
    bridge.state.listeners.clear();
    bridge.state.retained.clear();
    window.localStorage.clear();
});

/* ------------------------------------------------------------------------------------ */
/* What a path may be                                                                     */
/* ------------------------------------------------------------------------------------ */

describe('the paths an intent may name', () => {
    it('reads the launcher shortcut as the journal, armed', () => {
        expect(pathFromLaunchUrl('com.thinkmusic.alexithymia://journal?record=1'))
            .toBe(JOURNAL_RECORD_PATH);
        expect(JOURNAL_RECORD_PATH).toBe('/journal?record=1');
    });

    it('reads the reminder as the ritual', () => {
        expect(deepLinkTarget(RITUAL_PATH)).toBe(RITUAL_PATH);
        expect(DEEP_LINK_TARGETS).toEqual([RITUAL_PATH, JOURNAL_RECORD_PATH]);
    });

    it('refuses anything this app did not declare', () => {
        // Every screen is behind the same session and the same lock, so none of these is a
        // hole today. `MainActivity` is exported because it is the launcher activity, which
        // means any installed app can send it an intent, and choosing the screen is not a
        // decision to hand to one.
        expect(pathFromLaunchUrl('com.thinkmusic.alexithymia://profile')).toBeNull();
        expect(pathFromLaunchUrl('com.thinkmusic.alexithymia://journal?record=2')).toBeNull();
        expect(pathFromLaunchUrl('https://example.com/journal/ritual')).toBeNull();
        expect(pathFromLaunchUrl('/journal/ritual')).toBeNull();
        expect(pathFromLaunchUrl('')).toBeNull();
        expect(pathFromLaunchUrl(null)).toBeNull();
        expect(deepLinkTarget('/journal/people')).toBeNull();
        expect(deepLinkTarget(undefined)).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------ */
/* The two channels                                                                       */
/* ------------------------------------------------------------------------------------ */

describe('watching for one', () => {
    it('hands over the ritual when the reminder is tapped', () => {
        const onPath = vi.fn();
        render(<Consumer onPath={onPath} />);

        tapNotification(RITUAL_PATH);

        expect(onPath).toHaveBeenCalledWith(RITUAL_PATH);
    });

    it('hands over the armed journal when the shortcut is used', () => {
        const onPath = vi.fn();
        render(<Consumer onPath={onPath} />);

        openShortcut('com.thinkmusic.alexithymia://journal?record=1');

        expect(onPath).toHaveBeenCalledWith(JOURNAL_RECORD_PATH);
    });

    it('says nothing for an intent naming somewhere else', () => {
        const onPath = vi.fn();
        render(<Consumer onPath={onPath} />);

        openShortcut('com.thinkmusic.alexithymia://vault');
        tapNotification('/journal/people');

        expect(onPath).not.toHaveBeenCalled();
    });

    it('listens for nothing on the web', () => {
        platformState.native = false;
        const onPath = vi.fn();

        render(<Consumer onPath={onPath} />);

        expect(listenerCount('appUrlOpen')).toBe(0);
        expect(listenerCount('localNotificationActionPerformed')).toBe(0);
    });

    it('removes both listeners when the shell goes away', () => {
        const { unmount } = render(<Consumer onPath={vi.fn()} />);
        expect(listenerCount('appUrlOpen')).toBe(1);

        unmount();

        return Promise.resolve().then(() => {
            expect(listenerCount('appUrlOpen')).toBe(0);
            expect(listenerCount('localNotificationActionPerformed')).toBe(0);
        });
    });
});

/* ------------------------------------------------------------------------------------ */
/* §9.6: the lock is outermost, and the deep link lands on it first                        */
/* ------------------------------------------------------------------------------------ */

describe('a deep link on a locked phone', () => {
    it('lands on the lock screen, and opens the ritual only once the passphrase is accepted', async () => {
        setLockHash(await hashPassphrase('open sesame'));
        const onPath = vi.fn();

        render(<AppLock><Consumer onPath={onPath} /></AppLock>);

        // The listener does not exist, because the component that registers it does not:
        // `AppLock` returns the lock screen *instead of* its children.
        expect(screen.getByRole('heading', { name: 'Locked' })).toBeInTheDocument();
        expect(screen.queryByText('the app')).not.toBeInTheDocument();
        expect(listenerCount('localNotificationActionPerformed')).toBe(0);

        tapNotification(RITUAL_PATH);

        expect(onPath).not.toHaveBeenCalled();
        expect(screen.getByRole('heading', { name: 'Locked' })).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Passphrase'), 'open sesame');
        await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));

        expect(await screen.findByText('the app')).toBeInTheDocument();
        // Retained by Capacitor while nothing was listening, delivered to the first listener.
        expect(onPath).toHaveBeenCalledWith(RITUAL_PATH);
    });
});
