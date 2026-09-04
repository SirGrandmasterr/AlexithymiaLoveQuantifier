import { LocalNotifications } from '@capacitor/local-notifications';
import { JOURNAL_COPY, RITUAL_PATH, isClockTime } from '../constants/journal';
import { readRitualSetting } from '../constants/journalSettings';
import { isNative } from './platform';

export const RITUAL_NOTIFICATION_ID = 1000000001;

/** `'22:30'` → `{ hour: 22, minute: 30 }`, or `null` for anything that is not a clock time. */
export const clockParts = (time) => {
    if (!isClockTime(time)) return null;
    const [hour, minute] = String(time).split(':').map(Number);
    return { hour, minute };
};

export const ritualReminderAvailable = () => isNative();

/** Granted, without asking. `checkPermissions` never shows a dialog. */
const permissionGranted = async () => {
    const status = await LocalNotifications.checkPermissions().catch(() => null);
    return status?.display === 'granted';
};

export const cancelRitualReminder = async () => {
    if (!isNative()) return;
    try {
        await LocalNotifications.cancel({ notifications: [{ id: RITUAL_NOTIFICATION_ID }] });
    } catch {
        // A cancel that fails leaves one stale reminder, which is a smaller problem than an
        // exception thrown through the settings screen that asked for it.
    }
};

const schedule = async (time) => {
    const on = clockParts(time);
    if (!on) return false;

    try {
        await LocalNotifications.schedule({
            notifications: [{
                id: RITUAL_NOTIFICATION_ID,
                // Both strings are constants from `JOURNAL_COPY`, which is what puts them in
                // front of the forbidden-word walk. Neither takes an argument.
                title: JOURNAL_COPY.ritual.heading,
                body: JOURNAL_COPY.ritual.notification,
                schedule: { on, allowWhileIdle: false },
                extra: { path: RITUAL_PATH },
                autoCancel: true
            }]
        });
        return true;
    } catch (error) {
        console.warn('Could not schedule the nightly reminder', error);
        return false;
    }
};

export const syncRitualReminder = async (setting = null) => {
    if (!isNative()) return false;

    const { on, time } = setting ?? readRitualSetting();
    if (on !== true || !await permissionGranted()) {
        await cancelRitualReminder();
        return false;
    }

    return schedule(time);
};

export const setRitualReminder = async ({ on, time } = {}) => {
    if (!isNative()) return false;

    if (on !== true) {
        await cancelRitualReminder();
        return false;
    }

    const status = await LocalNotifications.requestPermissions().catch(() => null);
    if (status?.display !== 'granted') return false;

    return schedule(time);
};
