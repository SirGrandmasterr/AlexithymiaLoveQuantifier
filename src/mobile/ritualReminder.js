import { LocalNotifications } from '@capacitor/local-notifications';
import { JOURNAL_COPY, RITUAL_PATH, isClockTime } from '../constants/journal';
import { readRitualSetting } from '../constants/journalSettings';
import { isNative } from './platform';

/**
 * The nightly ritual, delivered as a system notification (§3.6).
 *
 * This is [`cadenceReminders.js`](cadenceReminders.js) again, for the journal's hour, and it
 * is deliberately the same shape: the rules written at the top of that file bind this one
 * too, and a second notification channel written to its own taste is how a codebase ends up
 * with two products' worth of manners.
 *
 * - **The body is fixed.** `JOURNAL_COPY.ritual.notification` — *"Tonight's questions are
 *   ready."* — with nothing interpolated into it, ever. Not the day, not a count, not a
 *   name, not what last night said. A lock-screen notification is readable by anyone holding
 *   the phone, which is a different audience from the one that unlocked it, and §9.6 states
 *   the rule as *"nothing else, ever"*. The title is the feature's own heading and is fixed
 *   for the same reason.
 * - **No badge.** The count on a launcher icon is a count of missed nights by another name,
 *   and §1's whole position is that a missed night is nothing.
 * - **One pending notification, replaced rather than stacked.** One fixed id and a cron-like
 *   `on: { hour, minute }` schedule, so a phone that is not opened for a fortnight has one
 *   pending row the whole time and produces one notification a night.
 * - **Nothing is sent anywhere.** No push token, no server, no scheduler off the device. The
 *   ritual's hour is a `localStorage` key this module reads; it has never left the phone, and
 *   the Vault page says so.
 *
 * What it deliberately is not: a background service, a widget, a wake word, or a second nudge
 * of any kind. The one thing it schedules is the one sentence, and the app it opens is the
 * app the user already has.
 */

/**
 * The one id this channel owns.
 *
 * Android notification ids are 32-bit ints and the cadence channel maps relationship ids
 * straight onto them, so this has to sit somewhere no relationship id will reach: the ids are
 * GORM's autoincrement from 1, for one person's own relationships, on their own server. A
 * billion is not a boundary that argument can cross. It is a **constant** rather than a
 * counter because "one pending notification per night, replaced" is exactly what one id and
 * one schedule mean — a per-night id would stack, which is the thing §3.6 forbids.
 *
 * The two channels share one pending list, which is why `cadenceReminders.cancelAll()` now
 * skips this id. Neither channel may cancel the other's work.
 */
export const RITUAL_NOTIFICATION_ID = 1000000001;

/** `'22:30'` → `{ hour: 22, minute: 30 }`, or `null` for anything that is not a clock time. */
export const clockParts = (time) => {
    if (!isClockTime(time)) return null;
    const [hour, minute] = String(time).split(':').map(Number);
    return { hour, minute };
};

/**
 * Whether a reminder is possible here at all.
 *
 * The ritual itself is a screen and works everywhere (`Profile.jsx` says so); what is
 * native-only is being reminded of it. On the web §3.6 gives the dashboard's one line in the
 * cadence nudge's slot instead, which A8 built and which needs nothing from this file.
 */
export const ritualReminderAvailable = () => isNative();

/** Granted, without asking. `checkPermissions` never shows a dialog. */
const permissionGranted = async () => {
    const status = await LocalNotifications.checkPermissions().catch(() => null);
    return status?.display === 'granted';
};

/**
 * Remove the pending reminder, and only it.
 *
 * By id rather than over `getPending()`, so a cancel cannot reach the cadence channel's
 * notifications the way the cadence channel's own `cancelAll` used to reach this one.
 */
export const cancelRitualReminder = async () => {
    if (!isNative()) return;
    try {
        await LocalNotifications.cancel({ notifications: [{ id: RITUAL_NOTIFICATION_ID }] });
    } catch {
        // A cancel that fails leaves one stale reminder, which is a smaller problem than an
        // exception thrown through the settings screen that asked for it.
    }
};

/**
 * Schedule tonight's — and every following night's — reminder at `time`.
 *
 * `on: { hour, minute }` is the plugin's cron-like schedule: it fires at that wall-clock time
 * and re-arms itself, so the notification survives the app never being opened and follows the
 * phone across a timezone change and the end of summer time. `at` with a computed `Date`
 * would not: it is one instant, and the app would have to be launched to compute the next.
 *
 * Scheduling the same id replaces the pending row rather than adding one — the plugin keys
 * both its storage and its `PendingIntent` on the id — which is what "rescheduling replaces"
 * means here.
 */
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
                // The route to open, and nothing else. A path constant is not content: it is
                // the same string for every user and every night, and it is what lets a tap
                // land on the cards instead of on whatever screen the app was last on.
                extra: { path: RITUAL_PATH },
                // Explicitly absent: `badge`, and `smallIcon` for `cadenceReminders.js`'s
                // reason — naming a drawable the project does not contain is what produces a
                // blank grey square in the status bar.
                autoCancel: true
            }]
        });
        return true;
    } catch (error) {
        // A reminder is an enhancement and the ritual is a screen without it. A scheduling
        // failure — permission revoked in Settings, an OEM battery manager, an exact-alarm
        // policy — must not break the settings screen that triggered it.
        console.warn('Could not schedule the nightly reminder', error);
        return false;
    }
};

/**
 * Bring the pending reminder in line with the stored setting, asking for nothing.
 *
 * Called when the app shell mounts, so that a phone which has been reinstalled, restored, or
 * simply had its alarms cleared by the system gets the reminder back without the user
 * visiting a screen. It never prompts: a permission dialog at launch, for a feature the user
 * turned on weeks ago, is the reliable way to have it denied permanently.
 *
 * @returns {Promise<boolean>} whether a reminder is scheduled afterwards.
 */
export const syncRitualReminder = async (setting = null) => {
    if (!isNative()) return false;

    const { on, time } = setting ?? readRitualSetting();
    if (on !== true || !await permissionGranted()) {
        await cancelRitualReminder();
        return false;
    }

    return schedule(time);
};

/**
 * The settings screen's call: the ritual has just been turned on, off, or moved.
 *
 * The permission is asked for here and nowhere else, at the moment the user opts in — the
 * same policy `setRemindersEnabled` follows for the cadence channel and the same one the
 * manifest's CHANGE 4 comment states. A refusal is not an error: the ritual is a screen, the
 * user keeps it, and they are simply not reminded of it. This function writes no setting;
 * `Profile.jsx` owns the key and calls this after it has written.
 *
 * @returns {Promise<boolean>} whether a reminder is scheduled afterwards.
 */
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
