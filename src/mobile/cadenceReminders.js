import { LocalNotifications } from '@capacitor/local-notifications';
import { dueStacks, nudgeSentence } from '../constants/cadence';
import { isNative } from './platform';

/**
 * The check-in rhythm, delivered as a system notification.
 *
 * `src/constants/cadence.js` opens with a product rule that this file is bound by:
 *
 *   > **no streaks, no badges, no counts of missed check-ins, no urgency.** A missed rhythm
 *   > produces exactly one calm sentence and nothing else.
 *
 * A notification channel is the easiest place in a codebase to break that rule, so the
 * constraints are enforced here rather than left to whoever writes the copy:
 *
 * - The body is `nudgeSentence(...)` **verbatim** — the same sentence the in-app nudge shows.
 *   There is one vocabulary for this and it lives in `cadence.js`.
 * - No badge count. A number on the launcher icon is a count of missed check-ins by another
 *   name, and that is the thing the rule names outright.
 * - One notification per relationship, replaced rather than stacked, keyed on the
 *   relationship id. A rhythm that has been missed for a year produces one notification, not
 *   fifty-two.
 * - Scheduled for 10:00 local. A reminder about a relationship arriving at 03:00 is not calm
 *   regardless of what it says.
 *
 * The other rule it is bound by is the one about where data lives: cadence is computed
 * client-side precisely so that "nothing leaves this machine" is literally true. Local
 * notifications preserve that — nothing here contacts a server, and there is no push token.
 * Anything that needed one would have to answer for that sentence on the Vault page first.
 */

const ENABLED_KEY = 'alq:reminders-enabled';
const HOUR_OF_DAY = 10;

/**
 * Android notification ids are 32-bit ints, and relationship ids are small sequential
 * integers, so the id maps directly. Using it as the notification id is what makes a
 * reschedule *replace* the pending notification for that relationship instead of adding one.
 */
const notificationId = (relationshipId) => Number(relationshipId) % 2147483647;

export const remindersEnabled = () => {
    try {
        return window.localStorage.getItem(ENABLED_KEY) === 'true';
    } catch {
        return false;
    }
};

export const remindersAvailable = () => isNative();

/**
 * Turn reminders on, asking for the OS permission at the moment the user opts in.
 *
 * Deliberately not at launch: a permission prompt before the user has seen what it is for is
 * the reliable way to get it denied permanently, and on Android a denied POST_NOTIFICATIONS
 * cannot be re-requested — it can only be fixed in Settings.
 *
 * @returns {Promise<boolean>} whether reminders are on afterwards.
 */
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
        if (pending.notifications.length) {
            await LocalNotifications.cancel({ notifications: pending.notifications });
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

/**
 * Bring the scheduled set in line with what is currently due.
 *
 * Cancel-then-reschedule rather than diffing: the pending set is small (one per relationship
 * with a rhythm), and a diff would have to reason about snoozes, renames, and deletions
 * separately. Recomputing from `dueStacks` — the same function the in-app nudge uses — means
 * the notification and the banner can never disagree about what is due.
 *
 * @param {Array} stacks from `useSubjects()`
 */
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
                // Explicitly absent: `badge`. See the note at the top of this file.
                //
                // Also absent: `smallIcon`. The plugin falls back to the launcher icon, which
                // is correct here — naming a drawable the project does not contain is the
                // usual cause of a blank grey square in the status bar. Supplying a real one
                // means adding a white-on-transparent alpha mask at each density; until that
                // exists, the fallback is the better of the two.
                autoCancel: true
            }))
        });
    } catch (error) {
        // Reminders are an enhancement. A scheduling failure — permission revoked in
        // Settings, exact-alarm policy, an OEM battery manager — must not break the screen
        // that triggered it.
        console.warn('Could not schedule check-in reminders', error);
    }
};
