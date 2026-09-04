import {
    RITUAL_NOTIFICATION_ID,
    cancelRitualReminder,
    clockParts,
    ritualReminderAvailable,
    setRitualReminder,
    syncRitualReminder
} from './ritualReminder';
import { syncReminders } from './cadenceReminders';
import { JOURNAL_COPY, JOURNAL_STORAGE_KEYS, RITUAL_PATH } from '../constants/journal';

/**
 * The nightly reminder (§3.6, §9.6).
 *
 * The plugin is faked with a **store** rather than with bare spies, because the two claims
 * that matter most are about state and not about calls: *one pending notification per night*
 * and *rescheduling replaces it*. A `vi.fn()` can only say that `schedule` was called twice;
 * a fake that keeps a pending list by id can say that twice produced one row, which is the
 * sentence the design document actually makes.
 */

const platformState = vi.hoisted(() => ({ native: true }));

vi.mock('./platform', async (importOriginal) => ({
    ...(await importOriginal()),
    isNative: () => platformState.native
}));

const notifications = vi.hoisted(() => {
    const state = {
        pending: new Map(),
        permission: 'granted',
        requests: 0,
        throwOnSchedule: false
    };

    return {
        state,
        plugin: {
            checkPermissions: vi.fn(async () => ({ display: state.permission })),
            requestPermissions: vi.fn(async () => {
                state.requests += 1;
                return { display: state.permission };
            }),
            schedule: vi.fn(async ({ notifications: list }) => {
                if (state.throwOnSchedule) throw new Error('exact alarm policy');
                // What the platform does: the id is the key, in storage and in the
                // PendingIntent both, so the same id replaces rather than adds.
                list.forEach(notification => state.pending.set(notification.id, notification));
            }),
            cancel: vi.fn(async ({ notifications: list }) => {
                list.forEach(({ id }) => state.pending.delete(id));
            }),
            getPending: vi.fn(async () => ({ notifications: [...state.pending.values()] }))
        }
    };
});

vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: notifications.plugin }));

const { state, plugin } = notifications;

const pending = () => [...state.pending.values()];
const ritualPending = () => state.pending.get(RITUAL_NOTIFICATION_ID) ?? null;

const storeRitual = (setting) => window.localStorage.setItem(
    JOURNAL_STORAGE_KEYS.ritual,
    JSON.stringify(setting)
);

beforeEach(() => {
    platformState.native = true;
    state.pending.clear();
    state.permission = 'granted';
    state.requests = 0;
    state.throwOnSchedule = false;
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------------------ */
/* The body, which is the whole point                                                     */
/* ------------------------------------------------------------------------------------ */

describe('what the notification says', () => {
    it('carries the fixed sentence and nothing else', async () => {
        await setRitualReminder({ on: true, time: '22:30' });

        const notification = ritualPending();
        expect(notification.body).toBe("Tonight's questions are ready.");
        expect(notification.body).toBe(JOURNAL_COPY.ritual.notification);
        expect(notification.title).toBe(JOURNAL_COPY.ritual.heading);
    });

    it('interpolates nothing into it — the same string at every hour, on every night', async () => {
        await setRitualReminder({ on: true, time: '21:05' });
        const first = ritualPending();

        // A different hour, a different day of the week, a device that has been used since.
        vi.setSystemTime(new Date('2026-09-07T23:14:00'));
        window.localStorage.setItem('alq:journal-questions', JSON.stringify(['alcohol']));
        await setRitualReminder({ on: true, time: '23:45' });
        const second = ritualPending();

        expect(second.body).toBe(first.body);
        expect(second.title).toBe(first.title);
        // No template survived into the string, and no number reached it: a count of nights,
        // of questions, or of anything else is the thing §1 says this app never shows.
        expect(second.body).not.toMatch(/[{}]/);
        expect(second.body).not.toMatch(/\d/);

        vi.useRealTimers();
    });

    it('carries no badge, and nothing but the route in its extra', async () => {
        await setRitualReminder({ on: true, time: '22:30' });

        const notification = ritualPending();
        expect('badge' in notification).toBe(false);
        expect(notification.extra).toEqual({ path: RITUAL_PATH });
        // Everything the notification holds, listed rather than sampled: a field added later
        // that carries something a lock screen could read should fail here first.
        expect(Object.keys(notification).sort()).toEqual(
            ['autoCancel', 'body', 'extra', 'id', 'schedule', 'title']
        );
    });
});

/* ------------------------------------------------------------------------------------ */
/* One per night, replaced rather than stacked                                            */
/* ------------------------------------------------------------------------------------ */

describe('what is pending', () => {
    it('schedules exactly one, at the hour the user chose', async () => {
        await setRitualReminder({ on: true, time: '22:30' });

        expect(pending()).toHaveLength(1);
        expect(ritualPending().schedule).toEqual({
            on: { hour: 22, minute: 30 },
            allowWhileIdle: false
        });
    });

    it('replaces the pending notification rather than adding one', async () => {
        await setRitualReminder({ on: true, time: '22:30' });
        await setRitualReminder({ on: true, time: '23:15' });
        await syncRitualReminder({ on: true, time: '23:15' });

        expect(pending()).toHaveLength(1);
        expect(ritualPending().id).toBe(RITUAL_NOTIFICATION_ID);
        expect(ritualPending().schedule.on).toEqual({ hour: 23, minute: 15 });
    });

    it('cancels it when the ritual is turned off', async () => {
        await setRitualReminder({ on: true, time: '22:30' });
        expect(pending()).toHaveLength(1);

        await setRitualReminder({ on: false, time: '22:30' });

        expect(pending()).toHaveLength(0);
        expect(plugin.schedule).toHaveBeenCalledTimes(1);
    });

    it('schedules nothing for a ritual that is off, however it is asked', async () => {
        storeRitual({ on: false, time: '22:30' });

        await syncRitualReminder();

        expect(pending()).toHaveLength(0);
        expect(plugin.schedule).not.toHaveBeenCalled();
    });

    it('reads the stored setting when it is handed none', async () => {
        storeRitual({ on: true, time: '21:00' });

        await syncRitualReminder();

        expect(ritualPending().schedule.on).toEqual({ hour: 21, minute: 0 });
    });

    it('schedules nothing at all on the web', async () => {
        platformState.native = false;

        expect(ritualReminderAvailable()).toBe(false);
        expect(await setRitualReminder({ on: true, time: '22:30' })).toBe(false);
        expect(await syncRitualReminder({ on: true, time: '22:30' })).toBe(false);

        expect(plugin.schedule).not.toHaveBeenCalled();
        expect(plugin.requestPermissions).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------------------------ */
/* The permission, and the failures that must not reach a screen                          */
/* ------------------------------------------------------------------------------------ */

describe('the permission', () => {
    it('is asked for when the ritual is switched on, and only then', async () => {
        storeRitual({ on: true, time: '22:30' });

        await syncRitualReminder();
        expect(plugin.requestPermissions).not.toHaveBeenCalled();
        expect(plugin.checkPermissions).toHaveBeenCalledTimes(1);

        await setRitualReminder({ on: true, time: '22:30' });
        expect(plugin.requestPermissions).toHaveBeenCalledTimes(1);
    });

    it('costs the reminder and not the setting when it is refused', async () => {
        state.permission = 'denied';

        expect(await setRitualReminder({ on: true, time: '22:30' })).toBe(false);

        expect(pending()).toHaveLength(0);
        expect(plugin.schedule).not.toHaveBeenCalled();
    });

    it('schedules nothing on a launch where the permission was revoked in Settings', async () => {
        await setRitualReminder({ on: true, time: '22:30' });
        state.permission = 'denied';

        expect(await syncRitualReminder({ on: true, time: '22:30' })).toBe(false);
        expect(pending()).toHaveLength(0);
    });

    it('does not throw at the screen that asked when scheduling fails', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        state.throwOnSchedule = true;

        expect(await setRitualReminder({ on: true, time: '22:30' })).toBe(false);
        expect(console.warn).toHaveBeenCalled();
    });

    it('refuses a time that is not a clock time rather than guessing one', async () => {
        expect(clockParts('22:30')).toEqual({ hour: 22, minute: 30 });
        expect(clockParts('24:00')).toBeNull();
        expect(clockParts(undefined)).toBeNull();

        expect(await setRitualReminder({ on: true, time: 'bedtime' })).toBe(false);
        expect(pending()).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------ */
/* The two channels                                                                       */
/* ------------------------------------------------------------------------------------ */

describe('beside the cadence reminders', () => {
    it('survives a cadence re-sync, which used to cancel every pending notification', async () => {
        window.localStorage.setItem('alq:reminders-enabled', 'true');
        await setRitualReminder({ on: true, time: '22:30' });

        // No stack is due, so the cadence channel cancels its own and schedules nothing.
        await syncReminders([]);

        expect(ritualPending()).not.toBeNull();
        expect(ritualPending().body).toBe(JOURNAL_COPY.ritual.notification);
    });

    it('cancels only its own id', async () => {
        state.pending.set(7, { id: 7, body: 'a cadence reminder' });
        await setRitualReminder({ on: true, time: '22:30' });

        await cancelRitualReminder();

        expect(pending().map(one => one.id)).toEqual([7]);
    });
});
