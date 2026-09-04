import { LocalNotifications } from '@capacitor/local-notifications';
import { dueStacks, nudgeSentence } from '../constants/cadence';
import { RITUAL_NOTIFICATION_ID } from './ritualReminder';
import { isNative } from './platform';

const ENABLED_KEY = 'alq:reminders-enabled';
const HOUR_OF_DAY = 10;

const notificationId = (relationshipId) => Number(relationshipId) % 2147483647;

export const remindersEnabled = () => {
    try {
        return window.localStorage.getItem(ENABLED_KEY) === 'true';
    } catch {
        return false;
    }
};

export const remindersAvailable = () => isNative();

export const setRemindersEnabled = async (enabled) => {
    if (!isNative()) return false;

    if (!enabled) {
        try { window.localStorage.setItem(ENABLED_KEY, 'false'); } catch { /* not fatal */ }
        await cancelAll();
        return false;
    }

    const status = await LocalNotifications.requestPermissions().catch(() => null);
    if (status?.display !== 'granted') return false;

    try { window.localStorage.setItem(ENABLED_KEY, 'true'); } catch { /* not fatal */ }
    return true;
};

const cancelAll = async () => {
    try {
        const pending = await LocalNotifications.getPending();
        const ours = pending.notifications.filter(({ id }) => id !== RITUAL_NOTIFICATION_ID);
        if (ours.length) {
            await LocalNotifications.cancel({ notifications: ours });
        }
    } catch {
        // A cancel that fails leaves a stale reminder, which is a smaller problem than an
        // exception thrown through the caller's render.
    }
};

/** 10:00 tomorrow — the next civil hour at which a reminder may arrive. */
const nextCivilHour = (now) => {
    const at = new Date(now);
    at.setDate(at.getDate() + 1);
    at.setHours(HOUR_OF_DAY, 0, 0, 0);
    return at;
};

export const syncReminders = async (stacks = []) => {
    if (!isNative() || !remindersEnabled()) return;

    const now = new Date();
    const due = dueStacks(stacks, { now });

    await cancelAll();
    if (!due.length) return;

    const at = nextCivilHour(now);

    try {
        await LocalNotifications.schedule({
            notifications: due.map(({ stack, elapsed }) => ({
                id: notificationId(stack.relationship.ID),
                title: 'A quiet check-in',
                // The one calm sentence, unmodified. See the note at the top of this file.
                body: nudgeSentence(stack.relationship.name, elapsed),
                schedule: { at, allowWhileIdle: false },
                autoCancel: true
            }))
        });
    } catch (error) {
        console.warn('Could not schedule check-in reminders', error);
    }
};
