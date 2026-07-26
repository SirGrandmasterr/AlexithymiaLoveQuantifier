import {
    dueStacks,
    humanGap,
    latestSnapshotDate,
    nudgeSentence,
    cadenceLabel,
    snoozeUntil,
    SNOOZE_DAYS
} from './cadence';

const NOW = new Date('2026-06-01T12:00:00Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

const stack = ({ id = 1, name = 'Alex', cadence = 30, dates = [daysAgo(60)] }) => ({
    relationship: { ID: id, name, cadence_days: cadence },
    versions: dates.map((date, index) => ({ ID: id * 100 + index, relationship_id: id, name, date }))
});

describe('humanGap', () => {
    it('scales the unit to the gap', () => {
        expect(humanGap(1)).toBe('1 day');
        expect(humanGap(7)).toBe('7 days');
        expect(humanGap(77)).toBe('11 weeks');
        expect(humanGap(182)).toBe('6 months');
        expect(humanGap(2192)).toBe('6 years');
    });
});

describe('latestSnapshotDate', () => {
    it('takes the most recent date regardless of list order', () => {
        const latest = latestSnapshotDate([
            { date: '2026-01-01T00:00:00Z' },
            { date: '2026-05-01T00:00:00Z' },
            { date: '2026-03-01T00:00:00Z' }
        ]);
        expect(latest.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    });

    it('ignores undated snapshots and returns null when nothing is dated', () => {
        expect(latestSnapshotDate([{ date: null }, { date: undefined }])).toBeNull();
        expect(latestSnapshotDate([])).toBeNull();
        expect(latestSnapshotDate([{ date: null }, { date: '2026-02-02T00:00:00Z' }]).toISOString())
            .toBe('2026-02-02T00:00:00.000Z');
    });
});

describe('dueStacks', () => {
    it('reports a stack whose rhythm has elapsed', () => {
        const due = dueStacks([stack({ cadence: 30, dates: [daysAgo(45)] })], { now: NOW });

        expect(due).toHaveLength(1);
        expect(due[0].elapsed).toBe(45);
    });

    it('says nothing until the rhythm has actually elapsed', () => {
        expect(dueStacks([stack({ cadence: 30, dates: [daysAgo(29)] })], { now: NOW })).toEqual([]);
    });

    it('treats the exact day as due', () => {
        expect(dueStacks([stack({ cadence: 30, dates: [daysAgo(30)] })], { now: NOW })).toHaveLength(1);
    });

    it('never nudges a relationship with no rhythm set — off is the default', () => {
        expect(dueStacks([stack({ cadence: null, dates: [daysAgo(900)] })], { now: NOW })).toEqual([]);

        // A relationship record that predates cadence entirely has no key at all.
        const withoutTheField = {
            relationship: { ID: 9, name: 'Legacy' },
            versions: [{ ID: 900, relationship_id: 9, name: 'Legacy', date: daysAgo(900) }]
        };
        expect(dueStacks([withoutTheField], { now: NOW })).toEqual([]);
    });

    it('never nudges a stack with no dated snapshot', () => {
        // An undated snapshot has no position in time, so it cannot make anything overdue.
        expect(dueStacks([stack({ cadence: 30, dates: [null] })], { now: NOW })).toEqual([]);
        expect(dueStacks([stack({ cadence: 30, dates: [] })], { now: NOW })).toEqual([]);
    });

    it('stays quiet while a stack is snoozed, and speaks again once it lapses', () => {
        const stacks = [stack({ id: 1, cadence: 30, dates: [daysAgo(45)] })];

        const stillSnoozed = { 1: new Date(NOW.getTime() + 86400000).toISOString() };
        expect(dueStacks(stacks, { now: NOW, snoozedUntil: stillSnoozed })).toEqual([]);

        const lapsed = { 1: new Date(NOW.getTime() - 86400000).toISOString() };
        expect(dueStacks(stacks, { now: NOW, snoozedUntil: lapsed })).toHaveLength(1);
    });

    it('drops anything already seen this session', () => {
        const stacks = [stack({ id: 1, cadence: 30, dates: [daysAgo(45)] })];
        expect(dueStacks(stacks, { now: NOW, seen: [1] })).toEqual([]);
    });

    it('puts the longest wait first', () => {
        const due = dueStacks([
            stack({ id: 1, name: 'Alex', cadence: 30, dates: [daysAgo(40)] }),
            stack({ id: 2, name: 'Sam', cadence: 30, dates: [daysAgo(200)] })
        ], { now: NOW });

        expect(due.map(entry => entry.stack.relationship.name)).toEqual(['Sam', 'Alex']);
    });
});

describe('nudgeSentence', () => {
    it('states an interval and stops', () => {
        expect(nudgeSentence('Alex', 63)).toBe("It's been 9 weeks since your last snapshot of Alex.");
    });

    it('never uses urgency or failure vocabulary', () => {
        const sentence = nudgeSentence('Alex', 400).toLowerCase();
        ['overdue', 'missed', 'streak', 'forgot', 'should', 'behind', '!'].forEach(word => {
            expect(sentence).not.toContain(word);
        });
    });
});

describe('cadenceLabel', () => {
    it('names the presets and spells out anything else', () => {
        expect(cadenceLabel(null)).toBe('Off');
        expect(cadenceLabel(30)).toBe('Monthly');
        expect(cadenceLabel(182)).toBe('Twice a year');
        expect(cadenceLabel(45)).toBe('Every 45 days');
    });
});

describe('snoozeUntil', () => {
    it('is a week of quiet', () => {
        const until = new Date(snoozeUntil(NOW));
        expect(Math.round((until - NOW) / 86400000)).toBe(SNOOZE_DAYS);
    });
});
