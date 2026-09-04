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

export const humanGap = (days) => {
    const unit = (count, singular) => `${count} ${singular}${count === 1 ? '' : 's'}`;
    if (days < 14) return unit(days, 'day');
    if (days < 90) return unit(Math.round(days / 7), 'week');
    if (days < 730) return unit(Math.round(days / 30.44), 'month');
    return unit(Math.round(days / 365.25), 'year');
};

export const latestSnapshotDate = (versions = []) => {
    const times = versions
        .filter(version => version.date)
        .map(version => new Date(version.date).getTime())
        .filter(time => !Number.isNaN(time));

    return times.length ? new Date(Math.max(...times)) : null;
};

export const daysSince = (date, now) => Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);

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
