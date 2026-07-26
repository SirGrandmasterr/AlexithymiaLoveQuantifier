/**
 * Check-in rhythm: the arithmetic behind the one nudge this app makes.
 *
 * The product rule this file exists to enforce is negative: **no streaks, no badges, no
 * counts of missed check-ins, no urgency.** A missed rhythm produces exactly one calm
 * sentence and nothing else. Anything here that starts counting failures is a bug.
 *
 * Nothing on the server acts on a cadence — there is no scheduler, no email, no push. Due
 * dates are computed here, in the browser, from data the client already has, which is what
 * keeps "nothing leaves this machine" literally true.
 */

const MS_PER_DAY = 86400000;

export const MIN_CADENCE_DAYS = 7;
export const MAX_CADENCE_DAYS = 365;

/** How long "Later" quiets a relationship for. */
export const SNOOZE_DAYS = 7;

export const CADENCE_OPTIONS = [
    { days: null, label: 'Off', hint: 'No reminders — the default' },
    { days: 30, label: 'Monthly', hint: 'About every 4 weeks' },
    { days: 90, label: 'Quarterly', hint: 'Four times a year' },
    { days: 182, label: 'Twice a year', hint: 'Every six months' }
];

/**
 * A duration in words. Shared with What Changed so the app has one vocabulary for elapsed
 * time: weeks stay useful up to about a quarter, because "11 weeks" reads more concretely
 * than "3 months" at the scale people actually re-snapshot.
 */
export const humanGap = (days) => {
    const unit = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`;
    if (days < 14) return unit(days, 'day');
    if (days < 90) return unit(Math.round(days / 7), 'week');
    if (days < 730) return unit(Math.round(days / 30.44), 'month');
    return unit(Math.round(days / 365.25), 'year');
};

/**
 * The most recent date recorded in a stack, or null when nothing in it is dated.
 *
 * An undated snapshot has no position in time, so it cannot make a relationship due — a
 * stack with no dated snapshot at all is never due rather than immediately overdue.
 */
export const latestSnapshotDate = (versions = []) => {
    const times = versions
        .filter(version => version.date)
        .map(version => new Date(version.date).getTime())
        .filter(time => !Number.isNaN(time));

    return times.length ? new Date(Math.max(...times)) : null;
};

export const daysSince = (date, now) => Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);

/**
 * Which stacks are asking to be revisited.
 *
 * A stack is due when it has a rhythm, has at least one dated snapshot, and more days have
 * passed than the rhythm asks for. Snoozed and already-seen-this-session stacks drop out
 * here rather than in the component, so the "at most once per session" rule is testable.
 */
export const dueStacks = (stacks = [], { now = new Date(), snoozedUntil = {}, seen = [] } = {}) => (
    stacks
        .map(stack => {
            const cadence = stack.relationship?.cadence_days;
            if (!cadence) return null;

            const latest = latestSnapshotDate(stack.versions);
            if (!latest) return null;

            const elapsed = daysSince(latest, now);
            if (elapsed < cadence) return null;

            const snooze = snoozedUntil[stack.relationship.ID];
            if (snooze && new Date(snooze).getTime() > now.getTime()) return null;

            if (seen.includes(stack.relationship.ID)) return null;

            return { stack, elapsed, latest };
        })
        .filter(Boolean)
        // Longest since last seen first: if only one line is shown, show the oldest.
        .sort((a, b) => b.elapsed - a.elapsed)
);

/**
 * The nudge sentence. Descriptive, never evaluative — it states an interval and stops.
 * No "overdue", no "you haven't", no exclamation mark.
 */
export const nudgeSentence = (name, elapsed) => (
    `It's been ${humanGap(elapsed)} since your last snapshot of ${name}.`
);

/** When a snooze started now would expire. */
export const snoozeUntil = (now = new Date()) => (
    new Date(now.getTime() + SNOOZE_DAYS * MS_PER_DAY).toISOString()
);

/** Describes a stored rhythm for the stack menu and the cadence dialog. */
export const cadenceLabel = (days) => {
    if (!days) return 'Off';
    const preset = CADENCE_OPTIONS.find(option => option.days === days);
    return preset ? preset.label : `Every ${days} days`;
};
