import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
    FEELINGS,
    RITUAL_QUESTIONS,
    ENTRY_KINDS,
    JOURNAL_COPY,
    JOURNAL_HISTORY_FROM,
    PEOPLE_PATH,
    TRIGGERS_PATH,
    MAX_FEELINGS_PER_CHECKIN,
    MAX_TRANSCRIPT_LENGTH,
    MAX_TRIGGER_LABEL,
    INTENSITY_LEVELS,
    DAY_ROLLOVER_HOUR,
    MAX_CANDIDATES,
    MAX_OPTIONAL_QUESTIONS,
    coreQuestions,
    isClockTime,
    minutesIntoCivilDay,
    ritualDeck,
    ritualTimeReached,
    readCheckin,
    readRitual,
    readTrigger,
    readPersonFact,
    activeTriggers,
    indexTriggers,
    civilDay,
    journalDayPath,
    dayRange,
    isDayString,
    shiftDay,
    monthBounds,
    timeOfDay,
    tzOffsetMinutes,
    rfc3339Local,
    personCandidates,
    triggerCandidates,
    clientId,
    fillCopy,
    countCopy,
    humanMinutes,
    isDayString,
    journalPersonPath,
    topFeelings,
    summarizePerson,
    summarizeTrigger,
    renameTriggerRequest,
    mergeTriggerRequest
} from './journal';
import { MAX_TAG_LENGTH } from './contextTags';

/* ------------------------------------------------------------------------------------ */
/* Rail 1 — the forbidden-word walk                                                       */
/* ------------------------------------------------------------------------------------ */

/**
 * The words this feature may not say, extended from cadence.test.js's six. The point of
 * walking the object rather than listing the strings is that a sentence added next session
 * is covered without anyone remembering to add it here.
 */
const FORBIDDEN = [
    'overdue', 'missed', 'streak', 'forgot', 'should', 'behind', '!',
    'healthy', 'unhealthy', 'concerning', 'symptom', 'disorder', 'diagnos',
    'fail', 'guilt', 'lazy', 'bad', 'good job'
];

/** Every string anywhere inside a value, with the path that reaches it. */
const walkStrings = (value, path = '') => {
    if (typeof value === 'string') return [{ path, text: value }];
    if (Array.isArray(value)) return value.flatMap((item, index) => walkStrings(item, `${path}[${index}]`));
    if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) => walkStrings(item, path ? `${path}.${key}` : key));
    }
    return [];
};

describe('the forbidden-word walk', () => {
    it('reaches every string in JOURNAL_COPY, however deeply nested', () => {
        const found = walkStrings(JOURNAL_COPY);
        // A guard on the walk itself: if a refactor flattened the object away, the
        // assertions below would pass over nothing and prove nothing.
        expect(found.length).toBeGreaterThan(40);
        expect(found.map(entry => entry.path)).toContain('empty.pastDay');
        expect(found.map(entry => entry.path)).toContain('triggers.merge.oneWay');
        expect(found.map(entry => entry.path)).toContain('checkin.intensity.1');
        // The day view's own group, added in A6. Every word that screen says is in here.
        expect(found.map(entry => entry.path)).toContain('day.loadError');
        expect(found.map(entry => entry.path)).toContain('nav.label');
        // The ritual's own group, filled in by A8. Every word those cards say is in here.
        expect(found.map(entry => entry.path)).toContain('ritual.saveError');
        expect(found.map(entry => entry.path)).toContain('ritual.progress');
        expect(found.map(entry => entry.path)).toContain('settings.questions.atLimit');
        // A9's two vocabulary views, including the counted pairs — both halves of a plural
        // live in this object so the walk reads the one a screen actually shows.
        expect(found.map(entry => entry.path)).toContain('people.mentionCount.one');
        expect(found.map(entry => entry.path)).toContain('triggers.entryCount.many');
        expect(found.map(entry => entry.path)).toContain('people.remove.mentions.one');
        expect(found.map(entry => entry.path)).toContain('people.stackActions');
        expect(found.map(entry => entry.path)).toContain('triggers.attachedFormula');
        // B2's controls and the sentence a branch says to a screen reader. The graph's own
        // vocabulary is in this object too, so the walk reads it with everything else.
        expect(found.map(entry => entry.path)).toContain('dayGraph.rotateRight');
        expect(found.map(entry => entry.path)).toContain('dayGraph.branch');
    });

    it('finds no evaluative or urgency vocabulary in JOURNAL_COPY', () => {
        walkStrings(JOURNAL_COPY).forEach(({ path, text }) => {
            const lowered = text.toLowerCase();
            FORBIDDEN.forEach(word => {
                expect(`${path}: ${lowered}`).not.toContain(word);
            });
        });
    });

    it('finds none in the ritual questions, their text or their settings notes', () => {
        walkStrings(RITUAL_QUESTIONS.map(({ id, text, note }) => ({ id, text, note })))
            .forEach(({ path, text }) => {
                const lowered = text.toLowerCase();
                FORBIDDEN.forEach(word => {
                    expect(`${path}: ${lowered}`).not.toContain(word);
                });
            });
    });

    it('finds none in the feeling labels or glosses', () => {
        walkStrings(FEELINGS.map(({ id, label, gloss }) => ({ id, label, gloss })))
            .forEach(({ path, text }) => {
                const lowered = text.toLowerCase();
                FORBIDDEN.forEach(word => {
                    expect(`${path}: ${lowered}`).not.toContain(word);
                });
            });
    });

    it('would catch a word added later', () => {
        // The walk is the test; this proves the walk actually looks, rather than passing
        // because it found nothing to look at.
        const planted = { settings: { ritual: { description: 'You are behind on this.' } } };
        const offences = walkStrings(planted).filter(({ text }) => (
            FORBIDDEN.some(word => text.toLowerCase().includes(word))
        ));
        expect(offences).toHaveLength(1);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Rail 2 — id parity with the backend                                                    */
/* ------------------------------------------------------------------------------------ */

// Read from the project root rather than from import.meta.url: Vite rewrites that to a
// module URL that is not a file: URL, and the point of this test is to read the real file
// off disk. The "reads the Go file" case below fails loudly if the path ever stops working.
const goSource = readFileSync(resolve(process.cwd(), 'backend/internal/domain/journal.go'), 'utf8');

/** The ids inside `var <name> = []string{ … }`, in declaration order. */
const goList = (name) => {
    const block = goSource.match(new RegExp(`var\\s+${name}\\s*=\\s*\\[\\]string\\{([\\s\\S]*?)\\}`));
    if (!block) throw new Error(`domain/journal.go has no ${name}`);
    return Array.from(block[1].matchAll(/"([^"]+)"/g), match => match[1]);
};

describe('id parity with backend/internal/domain/journal.go', () => {
    it('reads the Go file it is asserting against', () => {
        // If the file moves or the declarations are rewritten, this test must fail loudly
        // rather than silently compare two empty lists.
        expect(goList('FeelingIDs')).toHaveLength(21);
        expect(goList('RitualQuestionIDs')).toHaveLength(13);
        expect(goList('JournalKinds')).toHaveLength(4);
    });

    it('has the same feeling ids, in the same order, in both directions', () => {
        expect(FEELINGS.map(feeling => feeling.id)).toEqual(goList('FeelingIDs'));
    });

    it('has the same ritual question ids in both directions', () => {
        expect(RITUAL_QUESTIONS.map(question => question.id)).toEqual(goList('RitualQuestionIDs'));
    });

    it('puts the five core questions first, in the fixed order', () => {
        expect(RITUAL_QUESTIONS.filter(question => question.core).map(question => question.id))
            .toEqual(['slept_well', 'moved_body', 'daylight', 'with_people', 'ate_regularly']);
        expect(RITUAL_QUESTIONS.slice(0, 5).every(question => question.core)).toBe(true);
        expect(RITUAL_QUESTIONS.filter(question => !question.core)).toHaveLength(8);
    });

    it('has the same entry kinds in both directions', () => {
        expect(ENTRY_KINDS).toEqual(goList('JournalKinds'));
    });

    it('holds no labels or colours on the Go side', () => {
        // The Go file is ids only, on categories.go's precedent. A label there would be a
        // second place the copy lives, and the forbidden-word walk cannot reach it.
        FEELINGS.forEach(feeling => {
            expect(goSource).not.toContain(`"${feeling.hex}"`);
        });
        expect(goSource).not.toContain('connectedness');
    });
});

/* ------------------------------------------------------------------------------------ */
/* The vocabulary's own shape                                                             */
/* ------------------------------------------------------------------------------------ */

describe('FEELINGS', () => {
    it('places every entry on both axes, in range', () => {
        FEELINGS.forEach(feeling => {
            expect(feeling.valence).toBeGreaterThanOrEqual(-1);
            expect(feeling.valence).toBeLessThanOrEqual(1);
            expect(feeling.energy).toBeGreaterThanOrEqual(0);
            expect(feeling.energy).toBeLessThanOrEqual(1);
        });
    });

    it('has a unique id and a unique colour for every entry', () => {
        expect(new Set(FEELINGS.map(feeling => feeling.id)).size).toBe(FEELINGS.length);
        expect(new Set(FEELINGS.map(feeling => feeling.hex)).size).toBe(FEELINGS.length);
    });

    it('writes colours as complete literal hex values (invariant 4)', () => {
        FEELINGS.forEach(feeling => {
            expect(feeling.hex).toMatch(/^#[0-9a-f]{6}$/);
        });
    });

    it('labels feelings without grading them — strength is the intensity, not the word', () => {
        FEELINGS.forEach(feeling => {
            const label = feeling.label.toLowerCase();
            ['very', 'slightly', 'extremely'].forEach(grade => {
                expect(label).not.toContain(grade);
            });
        });
    });

    it('keeps the entry the thesis depends on', () => {
        const unclear = FEELINGS.find(feeling => feeling.id === 'unclear');
        expect(unclear).toBeDefined();
        expect(unclear.label).toBe("can't tell");
        expect(unclear.retired).toBeUndefined();
    });

    it('gives every entry a gloss', () => {
        FEELINGS.forEach(feeling => {
            expect(typeof feeling.gloss).toBe('string');
            expect(feeling.gloss.trim().length).toBeGreaterThan(0);
        });
    });
});

describe('the limits', () => {
    it('are the numbers the design document fixes', () => {
        expect(MAX_FEELINGS_PER_CHECKIN).toBe(5);
        expect(MAX_TRANSCRIPT_LENGTH).toBe(4000);
        expect(INTENSITY_LEVELS).toEqual([1, 2, 3]);
        expect(DAY_ROLLOVER_HOUR).toBe(4);
    });

    it('borrows the tag limit rather than declaring a second forty', () => {
        expect(MAX_TRIGGER_LABEL).toBe(MAX_TAG_LENGTH);
        expect(MAX_TRIGGER_LABEL).toBe(40);
    });

    it('names every intensity level in the copy the walk reaches', () => {
        INTENSITY_LEVELS.forEach(level => {
            expect(typeof JOURNAL_COPY.checkin.intensity[level]).toBe('string');
        });
    });
});

describe('ritualDeck', () => {
    it('is the five core questions, in the fixed order, with nothing turned on', () => {
        expect(ritualDeck().map(question => question.id)).toEqual([
            'slept_well', 'moved_body', 'daylight', 'with_people', 'ate_regularly'
        ]);
    });

    it('appends the optional ones in the set\u2019s order, not the order they were chosen', () => {
        // A deck that reordered itself under the user would defeat the whole reason the set
        // is fixed (\u00a73.3): the ritual\u2019s value is that it can be done with the eyes closed.
        expect(ritualDeck(['water', 'alcohol']).map(question => question.id)).toEqual([
            'slept_well', 'moved_body', 'daylight', 'with_people', 'ate_regularly',
            'alcohol', 'water'
        ]);
    });

    it('caps the tail at three however many are handed to it', () => {
        const deck = ritualDeck(['alcohol', 'caffeine_late', 'in_pain', 'worked_late', 'cycle']);
        expect(deck).toHaveLength(coreQuestions().length + MAX_OPTIONAL_QUESTIONS);
    });

    it('drops an id no build knows, rather than putting a card with no text on screen', () => {
        expect(ritualDeck(['alcohol', 'hydrated', 'slept_well']).map(question => question.id))
            .toEqual([...coreQuestions().map(question => question.id), 'alcohol']);
    });

    it('is not moved by a value that is not a list', () => {
        expect(ritualDeck(null).map(question => question.id))
            .toEqual(coreQuestions().map(question => question.id));
        expect(ritualDeck('alcohol')).toHaveLength(coreQuestions().length);
    });
});

describe('minutesIntoCivilDay and ritualTimeReached', () => {
    it('measures from the rollover hour, so the small hours are late in the day and not early', () => {
        expect(minutesIntoCivilDay('04:00')).toBe(0);
        expect(minutesIntoCivilDay('22:30')).toBe((22 - 4) * 60 + 30);
        // 01:00 belongs to the civil day that began at 04:00 the morning before.
        expect(minutesIntoCivilDay('01:00')).toBe(21 * 60);
        expect(minutesIntoCivilDay('03:59')).toBe(24 * 60 - 1);
    });

    it('reads a Date the same way it reads a clock string', () => {
        const at = new Date();
        at.setHours(22, 30, 0, 0);
        expect(minutesIntoCivilDay(at)).toBe(minutesIntoCivilDay('22:30'));
    });

    it('stays true past midnight, because the ritual can be started late', () => {
        const at = (hours, minutes = 0) => {
            const moment = new Date();
            moment.setHours(hours, minutes, 0, 0);
            return moment;
        };

        expect(ritualTimeReached('22:30', at(20))).toBe(false);
        expect(ritualTimeReached('22:30', at(22, 29))).toBe(false);
        expect(ritualTimeReached('22:30', at(22, 30))).toBe(true);
        expect(ritualTimeReached('22:30', at(23))).toBe(true);
        expect(ritualTimeReached('22:30', at(1))).toBe(true);
        expect(ritualTimeReached('22:30', at(3, 59))).toBe(true);
        // 04:00 is a new civil day, and tonight's questions have not come round again yet.
        expect(ritualTimeReached('22:30', at(4))).toBe(false);
        expect(ritualTimeReached('22:30', at(12))).toBe(false);
    });

    it('answers no for a time that is not a time, rather than guessing at one', () => {
        expect(ritualTimeReached(null)).toBe(false);
        expect(ritualTimeReached('half past ten')).toBe(false);
        expect(ritualTimeReached('25:00')).toBe(false);
        expect(isClockTime('22:30')).toBe(true);
        expect(isClockTime('9:30')).toBe(false);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Readers                                                                                */
/* ------------------------------------------------------------------------------------ */

describe('readCheckin', () => {
    const v1 = {
        v: 1,
        source: 'voice',
        tz_offset_min: 120,
        transcript: 'I had a nice day with Lucie today.',
        transcript_kept: true,
        language: 'en',
        feelings: [
            {
                id: 'rapport',
                intensity: 3,
                uncertain: false,
                about: [
                    { kind: 'person', ref: 0 },
                    { kind: 'tag', tag: 'conflict' },
                    { kind: 'trigger', trigger: '0b7e0000-0000-4000-8000-000000000001' }
                ]
            }
        ],
        tags: ['routine period'],
        note: 'after dinner',
        proposal: {
            model: 'gemma-4-e2b', runtime: 'webgpu', prompt_version: 3,
            proposed: ['pleasure', 'rapport', 'stress'], accepted: ['pleasure', 'rapport'],
            replaced: { stress: 'irritation' }, dropped_by_filter: 0,
            ambiguity: 'none', edited_transcript: false
        }
    };

    it('reads a v1 payload into the shape the screens use', () => {
        const read = readCheckin(v1);

        expect(read.v).toBe(1);
        expect(read.source).toBe('voice');
        expect(read.tzOffsetMin).toBe(120);
        expect(read.transcriptKept).toBe(true);
        expect(read.tags).toEqual(['routine period']);
        expect(read.note).toBe('after dinner');
        expect(read.feelings).toEqual([{
            id: 'rapport',
            intensity: 3,
            uncertain: false,
            about: [
                { kind: 'person', ref: 0 },
                { kind: 'tag', tag: 'conflict' },
                { kind: 'trigger', trigger: '0b7e0000-0000-4000-8000-000000000001' }
            ]
        }]);
        expect(read.provenance.promptVersion).toBe(3);
        expect(read.provenance.replaced).toEqual({ stress: 'irritation' });
        expect(read.provenance.editedTranscript).toBe(false);
    });

    it('reads a payload with no v as version 1', () => {
        expect(readCheckin({ source: 'chips', feelings: [] }).v).toBe(1);
    });

    it('preserves keys it has never heard of', () => {
        const read = readCheckin({ ...v1, location: 'kitchen', weather: { sky: 'grey' } });

        expect(read.raw).toEqual({ location: 'kitchen', weather: { sky: 'grey' } });
        // and the known keys are not swept into raw with them
        expect(read.raw.source).toBeUndefined();
        expect(read.source).toBe('voice');
    });

    it('keeps an about target of a kind it does not know', () => {
        const read = readCheckin({
            v: 1,
            feelings: [{ id: 'calm', about: [{ kind: 'place', place: 'the lake' }] }]
        });

        expect(read.feelings[0].about).toEqual([
            { kind: 'place', raw: { kind: 'place', place: 'the lake' } }
        ]);
    });

    it('never turns an absent uncertain into false, or an absent intensity into zero', () => {
        const read = readCheckin({ v: 1, feelings: [{ id: 'unclear' }] });

        expect(read.feelings[0].uncertain).toBeNull();
        expect(read.feelings[0].intensity).toBeNull();
        expect(read.feelings[0].uncertain).not.toBe(false);
    });

    it('has no provenance when no model was consulted', () => {
        expect(readCheckin({ v: 1, source: 'chips', feelings: [] }).provenance).toBeNull();
    });

    it('reads an empty or missing payload without throwing', () => {
        expect(readCheckin(undefined).feelings).toEqual([]);
        expect(readCheckin(null).tags).toEqual([]);
        expect(readCheckin({}).transcript).toBeNull();
    });
});

describe('readRitual', () => {
    const asked = ['slept_well', 'moved_body', 'daylight', 'with_people', 'ate_regularly', 'alcohol'];

    const v1 = {
        v: 1,
        question_set: { version: 1, asked },
        answers: { slept_well: true, moved_body: false, daylight: true, with_people: true, alcohol: false },
        day_word: { id: 'calm', uncertain: false },
        rollover_hour: 4,
        duration_ms: 38000
    };

    it('reads a v1 payload', () => {
        const read = readRitual(v1);

        expect(read.v).toBe(1);
        expect(read.questionSetVersion).toBe(1);
        expect(read.asked).toEqual(asked);
        expect(read.dayWord).toEqual({ id: 'calm', uncertain: false });
        expect(read.rolloverHour).toBe(4);
        expect(read.durationMs).toBe(38000);
    });

    it('reports a skipped question as absent, never as false', () => {
        const read = readRitual(v1);

        expect(read.skipped).toEqual(['ate_regularly']);
        expect('ate_regularly' in read.answers).toBe(false);
        expect(read.answers.ate_regularly).toBeUndefined();
        // and a real no is still a no
        expect(read.answers.moved_body).toBe(false);
    });

    it('separates a question that was never asked from one that was skipped', () => {
        const read = readRitual(v1);

        expect(read.asked).toContain('alcohol');
        expect(read.asked).not.toContain('water');
        expect(read.skipped).not.toContain('water');
    });

    it('reports every asked question as skipped when nothing was answered', () => {
        const read = readRitual({ v: 1, question_set: { asked } });

        expect(read.skipped).toEqual(asked);
        expect(read.answers).toEqual({});
    });

    it('preserves keys it has never heard of', () => {
        const read = readRitual({ ...v1, mood_of_the_room: 'quiet' });
        expect(read.raw).toEqual({ mood_of_the_room: 'quiet' });
    });

    it('has no day word when the closing card was skipped', () => {
        const { day_word: dropped, ...withoutWord } = v1;
        expect(dropped).toBeDefined();
        expect(readRitual(withoutWord).dayWord).toBeNull();
    });

    it('reads an empty payload without throwing', () => {
        expect(readRitual(undefined).asked).toEqual([]);
        expect(readRitual({}).skipped).toEqual([]);
    });
});

describe('readPersonFact', () => {
    it('reads a v1 payload and keeps unknown keys', () => {
        const read = readPersonFact({
            v: 1,
            text: 'moved to Lyon',
            source: 'voice',
            from_entry_client_id: '6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1',
            confidence: 0.8
        });

        expect(read.text).toBe('moved to Lyon');
        expect(read.source).toBe('voice');
        expect(read.fromEntryClientId).toBe('6f1c3a0e-9d4b-4a71-8f2e-1c0b7a5e33d1');
        expect(read.raw).toEqual({ confidence: 0.8 });
    });
});

describe('readTrigger', () => {
    const trigger = (id, payload) => ({ client_id: id, kind: 'trigger', payload: { v: 1, ...payload } });

    it('reads a live trigger', () => {
        const work = trigger('id-work', { label: 'work', merged_into: null, created_from: 'id-checkin' });
        const read = readTrigger(work, [work]);

        expect(read.label).toBe('work');
        expect(read.merged).toBe(false);
        expect(read.mergedInto).toBeNull();
        expect(read.live).toBe('id-work');
        expect(read.createdFrom).toBe('id-checkin');
    });

    /**
     * The triggers view resolves every reference in the whole history once per trigger, so
     * it hands in an index the provider memoised rather than the rows. Both forms have to
     * answer identically, including through a merge chain — otherwise the screen that needs
     * the fast path is the one path no test covers.
     */
    it('takes a prebuilt index as well as the rows, and answers the same either way', () => {
        // The rows a client actually holds: the merge correction and the survivor. The
        // superseded `id-work` row is not among them — the server filters it out — which is
        // exactly why the walk has to go through `corrects`.
        const merged = trigger('id-2', { label: 'work', corrects: 'id-work', merged_into: 'id-commute' });
        const commute = trigger('id-commute', { label: 'the commute' });
        const rows = [merged, commute];

        const index = indexTriggers(rows);
        expect(index).toBeInstanceOf(Map);

        expect(readTrigger('id-work', index)).toEqual(readTrigger('id-work', rows));
        expect(readTrigger('id-work', index).live).toBe('id-commute');
        expect(readTrigger(commute, index).label).toBe('the commute');

        // An index built from nothing is not the same as no index: it answers "unknown"
        // rather than falling back to re-reading an array it was not given.
        expect(readTrigger('id-work', indexTriggers([])).label).toBeNull();
    });

    it('gives a renamed trigger its new label, and the id a new entry must reference', () => {
        // A rename is a correction row with a new client_id; `corrects` names the row it
        // replaced, because the row-level supersedes_id is a database id the client never
        // sees (GET /api/journal/entries returns only superseded_at IS NULL).
        const renamed = trigger('id-2', { label: 'paid work', corrects: 'id-work' });
        const read = readTrigger('id-work', [renamed]);

        expect(read.label).toBe('paid work');
        expect(read.live).toBe('id-2');
        expect(read.merged).toBe(false);
        // A bare string is read as a one-element list, because the first rename is the case
        // a writer is most likely to get lazy about.
        expect(read.corrects).toEqual(['id-work']);
    });

    it('still answers for the original id after a second rename', () => {
        // The case `corrects` is a list for. Rename twice and the middle row is superseded
        // too, so it is in no list the client holds: a reader that could only walk one hop
        // would find id-2 and then hit a gap, and every entry written before the first
        // rename would resolve to nothing.
        const renamedTwice = trigger('id-3', { label: 'the job', corrects: ['id-work', 'id-2'] });

        expect(readTrigger('id-work', [renamedTwice]).label).toBe('the job');
        expect(readTrigger('id-2', [renamedTwice]).label).toBe('the job');
        expect(readTrigger('id-work', [renamedTwice]).live).toBe('id-3');
    });

    it('lets a live row win over another row claiming to correct its id', () => {
        const stale = trigger('id-2', { label: 'stale', corrects: ['id-work'] });
        const live = trigger('id-work', { label: 'work' });

        expect(readTrigger('id-work', [stale, live]).label).toBe('work');
    });

    it('resolves a merge chain two deep to its end', () => {
        // work → Arbeit → job. Each merge is a correction row: it corrects the trigger it
        // moves away and names the survivor in merged_into.
        const workMerged = trigger('id-2', { label: 'work', corrects: 'id-work', merged_into: 'id-arbeit' });
        const arbeitMerged = trigger('id-3', { label: 'Arbeit', corrects: 'id-arbeit', merged_into: 'id-job' });
        const job = trigger('id-job', { label: 'job' });
        const all = [workMerged, arbeitMerged, job];

        const fromWork = readTrigger('id-work', all);
        expect(fromWork.label).toBe('job');
        expect(fromWork.merged).toBe(true);
        expect(fromWork.mergedInto).toBe('id-job');
        expect(fromWork.live).toBe('id-job');

        const fromArbeit = readTrigger('id-arbeit', all);
        expect(fromArbeit.label).toBe('job');
        expect(fromArbeit.live).toBe('id-job');

        // and the survivor still answers for itself
        expect(readTrigger(job, all).merged).toBe(false);
    });

    it('does not loop on a trigger merged into itself', () => {
        const looping = trigger('id-loop', { label: 'work', merged_into: 'id-loop' });
        const read = readTrigger(looping, [looping]);

        expect(read.label).toBe('work');
        expect(read.merged).toBe(false);
        expect(read.live).toBe('id-loop');
    });

    it('does not loop on two triggers merged into each other', () => {
        const first = trigger('id-a', { label: 'work', merged_into: 'id-b' });
        const second = trigger('id-b', { label: 'Arbeit', merged_into: 'id-a' });
        const read = readTrigger('id-a', [first, second]);

        expect(read.label).toBe('Arbeit');
        expect(read.mergedInto).toBe('id-b');
        expect(read.live).toBe('id-b');
    });

    it('keeps the last label it found when the survivor is not in the list it was given', () => {
        const merged = trigger('id-a', { label: 'work', merged_into: 'id-gone' });
        const read = readTrigger('id-a', [merged]);

        expect(read.label).toBe('work');
        expect(read.merged).toBe(true);
        expect(read.mergedInto).toBe('id-gone');
    });

    it('answers for an id it has never seen without throwing', () => {
        const read = readTrigger('id-unknown', []);
        expect(read.label).toBeNull();
        expect(read.live).toBe('id-unknown');
    });

    it('offers only triggers that have not been merged away', () => {
        const merged = trigger('id-a', { label: 'work', merged_into: 'id-b' });
        const live = trigger('id-b', { label: 'Arbeit' });

        expect(activeTriggers([merged, live]).map(entry => entry.client_id)).toEqual(['id-b']);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Day arithmetic                                                                         */
/* ------------------------------------------------------------------------------------ */

describe('civilDay', () => {
    const ORIGINAL_TZ = process.env.TZ;

    // Fixed to a zone with a DST rule, so "across a DST change" means something wherever
    // this suite runs. Restored afterwards so no other file inherits it.
    beforeAll(() => { process.env.TZ = 'Europe/Berlin'; });
    afterAll(() => {
        // Assigning undefined would set the string "undefined" and leave the process in a
        // zone that does not exist. Delete it instead.
        if (ORIGINAL_TZ === undefined) delete process.env.TZ;
        else process.env.TZ = ORIGINAL_TZ;
    });

    const local = (year, month, day, hour, minute) => new Date(year, month - 1, day, hour, minute, 0);

    it('puts a moment before the rollover hour on the day before', () => {
        expect(civilDay(local(2026, 8, 22, 3, 59))).toBe('2026-08-21');
    });

    it('puts the rollover hour itself on the new day', () => {
        expect(civilDay(local(2026, 8, 22, 4, 0))).toBe('2026-08-22');
    });

    it('leaves an ordinary evening on its own day', () => {
        expect(civilDay(local(2026, 8, 22, 22, 30))).toBe('2026-08-22');
        expect(civilDay(local(2026, 8, 22, 0, 1))).toBe('2026-08-21');
    });

    it('crosses a month boundary', () => {
        expect(civilDay(local(2026, 3, 1, 3, 59))).toBe('2026-02-28');
        expect(civilDay(local(2026, 3, 1, 4, 0))).toBe('2026-03-01');
    });

    it('crosses a year boundary', () => {
        expect(civilDay(local(2026, 1, 1, 2, 0))).toBe('2025-12-31');
    });

    it('really is running in a zone that has a DST rule', () => {
        // Without this, the two cases below would pass in a zone with no DST while
        // asserting nothing about DST at all.
        expect(new Date(Date.UTC(2026, 2, 29, 0, 0)).getTimezoneOffset())
            .not.toBe(new Date(Date.UTC(2026, 2, 29, 3, 0)).getTimezoneOffset());
        expect(new Date(Date.UTC(2026, 9, 25, 0, 0)).getTimezoneOffset())
            .not.toBe(new Date(Date.UTC(2026, 9, 25, 3, 0)).getTimezoneOffset());
    });

    it('is right on the morning the clocks go forward', () => {
        // Berlin, 2026-03-29: 02:00 becomes 03:00, so the night is 23 hours long. 04:30
        // local is 02:30 UTC — subtracting four hours from the *instant* lands on the
        // previous evening and would answer 2026-03-28. Shifting the date field does not.
        expect(civilDay(local(2026, 3, 29, 4, 30))).toBe('2026-03-29');
        expect(civilDay(local(2026, 3, 29, 3, 30))).toBe('2026-03-28');
        expect(civilDay(local(2026, 3, 29, 23, 0))).toBe('2026-03-29');
    });

    it('is right on the morning the clocks go back, for both passes of the same hour', () => {
        // Berlin, 2026-10-25: 03:00 becomes 02:00, so 02:30 local happens twice. Both are
        // before the rollover, so both belong to the 24th — and they must agree.
        const firstPass = new Date(Date.UTC(2026, 9, 25, 0, 30));
        const secondPass = new Date(Date.UTC(2026, 9, 25, 1, 30));

        expect(civilDay(firstPass)).toBe('2026-10-24');
        expect(civilDay(secondPass)).toBe('2026-10-24');
        expect(civilDay(new Date(Date.UTC(2026, 9, 25, 3, 30)))).toBe('2026-10-25');
    });

    it('honours a rollover hour other than the constant', () => {
        expect(civilDay(local(2026, 8, 22, 3, 59), 0)).toBe('2026-08-22');
        expect(civilDay(local(2026, 8, 22, 5, 0), 6)).toBe('2026-08-21');
    });

    it('answers null for something that is not a date', () => {
        expect(civilDay(new Date('nonsense'))).toBeNull();
    });
});

describe('journalDayPath', () => {
    it('builds the day route', () => {
        expect(journalDayPath('2026-08-22')).toBe('/journal/2026-08-22');
    });

    it('falls back to the journal root rather than building a broken route', () => {
        expect(journalDayPath('22-08-2026')).toBe('/journal');
        expect(journalDayPath('2026-02-31')).toBe('/journal');
        expect(journalDayPath(undefined)).toBe('/journal');
    });
});

describe('isDayString', () => {
    it('is strict about the shape and the day existing', () => {
        expect(isDayString('2026-08-22')).toBe(true);
        expect(isDayString('2024-02-29')).toBe(true);
        expect(isDayString('2026-02-29')).toBe(false);
        expect(isDayString('2026-8-22')).toBe(false);
        expect(isDayString('2026-08-22T10:00:00Z')).toBe(false);
        expect(isDayString(null)).toBe(false);
    });
});

describe('dayRange', () => {
    it('is inclusive at both ends', () => {
        expect(dayRange('2026-08-20', '2026-08-22'))
            .toEqual(['2026-08-20', '2026-08-21', '2026-08-22']);
        expect(dayRange('2026-08-22', '2026-08-22')).toEqual(['2026-08-22']);
    });

    it('crosses a month and a leap day', () => {
        expect(dayRange('2026-02-27', '2026-03-02'))
            .toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
        expect(dayRange('2024-02-28', '2024-03-01'))
            .toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    });

    it('does not lose or double a day across a DST change', () => {
        // Day strings carry no offset, so the arithmetic runs in UTC and the clocks moving
        // is not its problem. This is the assertion that says so.
        const spring = dayRange('2026-03-28', '2026-03-30');
        expect(spring).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);

        const autumn = dayRange('2026-10-24', '2026-10-26');
        expect(autumn).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    });

    it('answers nothing for a reversed or malformed range', () => {
        expect(dayRange('2026-08-22', '2026-08-20')).toEqual([]);
        expect(dayRange('nonsense', '2026-08-22')).toEqual([]);
    });
});

describe('shiftDay', () => {
    it('steps one day either way', () => {
        expect(shiftDay('2026-08-21', 1)).toBe('2026-08-22');
        expect(shiftDay('2026-08-21', -1)).toBe('2026-08-20');
        expect(shiftDay('2026-08-21', 0)).toBe('2026-08-21');
    });

    it('crosses a month, a year and a leap day without a special case', () => {
        expect(shiftDay('2026-08-31', 1)).toBe('2026-09-01');
        expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
        expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
        expect(shiftDay('2027-01-01', -1)).toBe('2026-12-31');
        expect(shiftDay('2024-02-28', 1)).toBe('2024-02-29');
        expect(shiftDay('2026-02-28', 1)).toBe('2026-03-01');
    });

    it('does not lose a day across a DST change, because it never leaves UTC', () => {
        // The header's prev/next walks with this, and a day that vanished on the morning the
        // clocks moved would be unreachable from the day beside it.
        expect(shiftDay('2026-03-28', 1)).toBe('2026-03-29');
        expect(shiftDay('2026-03-29', 1)).toBe('2026-03-30');
        expect(shiftDay('2026-10-25', 1)).toBe('2026-10-26');
    });

    it('answers null for something that is not a day', () => {
        expect(shiftDay('2026-02-31', 1)).toBeNull();
        expect(shiftDay(undefined, 1)).toBeNull();
    });
});

describe('monthBounds', () => {
    it('spans the whole month the day falls in', () => {
        expect(monthBounds('2026-08-21')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
        expect(monthBounds('2026-09-15')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    });

    it('knows how long February is', () => {
        expect(monthBounds('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
        expect(monthBounds('2024-02-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    });

    it('handles the first and last months of a year', () => {
        expect(monthBounds('2026-01-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
        expect(monthBounds('2026-12-31')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });

    it('answers null for something that is not a day', () => {
        expect(monthBounds('2026-13-01')).toBeNull();
        expect(monthBounds(null)).toBeNull();
    });
});

describe('timeOfDay', () => {
    it('reads an instant as a local 24-hour clock time', () => {
        const at = new Date(2026, 7, 21, 16, 42, 10);
        expect(timeOfDay(at)).toBe('16:42');
        expect(timeOfDay(at.toISOString())).toBe('16:42');
    });

    it('pads both halves', () => {
        expect(timeOfDay(new Date(2026, 7, 21, 4, 5))).toBe('04:05');
    });

    it('answers null rather than a plausible wrong time', () => {
        // `new Date(null)` is the epoch, not an invalid date, and would print 00:00 in UTC
        // and something else everywhere — the check for it comes before the parse.
        expect(timeOfDay(null)).toBeNull();
        expect(timeOfDay(undefined)).toBeNull();
        expect(timeOfDay('')).toBeNull();
        expect(timeOfDay('not a time')).toBeNull();
    });
});

/**
 * The two halves of "when was this", written from one call so they cannot disagree.
 *
 * The zone is pinned rather than assumed: without it a sign error in `tzOffsetMinutes`
 * passes on a machine sitting on UTC and fails nowhere the suite is ever run. The guard case
 * asserts the pin took, because `process.env.TZ` silently doing nothing would make every
 * assertion below true of whatever zone the runner happens to be in.
 */
describe('tzOffsetMinutes and rfc3339Local', () => {
    let originalTZ;

    beforeAll(() => {
        originalTZ = process.env.TZ;
        process.env.TZ = 'Europe/Berlin';
    });

    afterAll(() => {
        // Assigning `undefined` sets the *string* "undefined" and leaves the process in a
        // zone that does not exist.
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    });

    it('is really in the zone these cases assert against', () => {
        expect(new Date('2026-08-21T12:00:00Z').getTimezoneOffset()).toBe(-120);
        expect(new Date('2026-01-21T12:00:00Z').getTimezoneOffset()).toBe(-60);
    });

    it('counts minutes east of Greenwich, the opposite way to getTimezoneOffset', () => {
        expect(tzOffsetMinutes(new Date('2026-08-21T12:00:00Z'))).toBe(120);
        // And it follows the zone's own rules across a DST boundary rather than a constant.
        expect(tzOffsetMinutes(new Date('2026-01-21T12:00:00Z'))).toBe(60);
    });

    it('writes an instant with its local offset, never a Z', () => {
        expect(rfc3339Local(new Date('2026-08-21T12:00:00Z'))).toBe('2026-08-21T14:00:00+02:00');
        expect(rfc3339Local(new Date('2026-01-21T12:00:00Z'))).toBe('2026-01-21T13:00:00+01:00');
    });

    it('carries the same fact as tz_offset_min, from the same instant', () => {
        const at = new Date('2026-08-21T12:00:00Z');
        expect(rfc3339Local(at).slice(-6)).toBe('+02:00');
        expect(tzOffsetMinutes(at)).toBe(120);
    });

    it('answers null for something that is not an instant', () => {
        expect(rfc3339Local('not a time')).toBeNull();
        expect(tzOffsetMinutes('not a time')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------ */
/* Candidate matching                                                                     */
/* ------------------------------------------------------------------------------------ */

describe('personCandidates', () => {
    const person = (id, name) => ({ ID: id, name });

    it('resolves an exact match after trim, alone and marked exact', () => {
        const lucie = person(1, 'Lucie');
        const candidates = personCandidates('  Lucie  ', [person(2, 'Lucie M'), lucie]);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].exact).toBe(true);
        expect(candidates[0].relationshipId).toBe(1);
        expect(candidates[0].name).toBe('Lucie');
    });

    it('offers Lucie M for Lucie when there is no exact Lucie', () => {
        const candidates = personCandidates('Lucie', [person(2, 'Lucie M')]);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].name).toBe('Lucie M');
        expect(candidates[0].exact).toBe(false);
        expect(candidates[0].match).toBe('prefix');
    });

    it('matches case-insensitively', () => {
        const candidates = personCandidates('lucie', [person(1, 'Lucie')]);

        expect(candidates.map(entry => entry.name)).toEqual(['Lucie']);
        expect(candidates[0].exact).toBe(false);
        expect(candidates[0].match).toBe('insensitive');
    });

    it('matches across diacritics, in both directions', () => {
        expect(personCandidates('José', [person(1, 'Jose')])[0].name).toBe('Jose');
        expect(personCandidates('Jose', [person(1, 'José')])[0].name).toBe('José');
    });

    it('does not match a partial word', () => {
        expect(personCandidates('Luc', [person(1, 'Lucie')])).toEqual([]);
    });

    it('never offers more than three', () => {
        const many = ['Lucie M', 'Lucie B', 'Lucie K', 'Lucie T', 'Lucie R'].map((name, i) => person(i + 1, name));
        expect(personCandidates('Lucie', many)).toHaveLength(MAX_CANDIDATES);
        expect(MAX_CANDIDATES).toBe(3);
    });

    it('never selects anything — it returns candidates and stops', () => {
        const candidates = personCandidates('Lucie', [person(2, 'Lucie M'), person(3, 'Lucie B')]);

        // No entry claims to be chosen; nothing here writes a relationship_id anywhere.
        expect(candidates.every(entry => entry.exact === false)).toBe(true);
        expect(candidates.every(entry => 'relationship' in entry)).toBe(true);
    });

    it('returns nothing for an empty name', () => {
        expect(personCandidates('', [person(1, 'Lucie')])).toEqual([]);
        expect(personCandidates('   ', [person(1, 'Lucie')])).toEqual([]);
        expect(personCandidates(undefined, [person(1, 'Lucie')])).toEqual([]);
    });

    it('returns nothing when there is nobody to match against', () => {
        expect(personCandidates('Lucie', [])).toEqual([]);
        expect(personCandidates('Lucie')).toEqual([]);
    });
});

describe('triggerCandidates', () => {
    const trigger = (id, label) => ({ client_id: id, payload: { v: 1, label } });

    it('treats Arbeit and arbeit as one trigger', () => {
        const arbeit = trigger('id-arbeit', 'Arbeit');
        const candidates = triggerCandidates('arbeit', [arbeit]);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].label).toBe('Arbeit');
        expect(candidates[0].clientId).toBe('id-arbeit');
        expect(candidates[0].match).toBe('insensitive');
    });

    it('does not treat work and Arbeit as one trigger', () => {
        expect(triggerCandidates('work', [trigger('id-arbeit', 'Arbeit')])).toEqual([]);
    });

    it('has no prefix rule — the merge is the user\'s to make, not a substring\'s', () => {
        expect(triggerCandidates('work', [trigger('id-workshop', 'workshop')])).toEqual([]);
        expect(triggerCandidates('workshop', [trigger('id-work', 'work')])).toEqual([]);
    });

    it('marks an exact match exact and returns it alone', () => {
        const candidates = triggerCandidates(' work ', [trigger('id-a', 'work'), trigger('id-b', 'Work')]);

        expect(candidates).toHaveLength(1);
        expect(candidates[0].exact).toBe(true);
        expect(candidates[0].clientId).toBe('id-a');
    });

    it('matches across diacritics', () => {
        expect(triggerCandidates('umzug', [trigger('id-a', 'Umzug')])[0].label).toBe('Umzug');
    });

    it('reads a plain { client_id, label } row as well as an entry', () => {
        expect(triggerCandidates('work', [{ client_id: 'id-a', label: 'work' }])[0].clientId).toBe('id-a');
    });

    it('returns nothing for an empty label', () => {
        expect(triggerCandidates('', [trigger('id-a', 'work')])).toEqual([]);
        expect(triggerCandidates('work', [])).toEqual([]);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Client ids and the copy helpers                                                        */
/* ------------------------------------------------------------------------------------ */

describe('clientId', () => {
    it('mints a UUID v4', () => {
        expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('does not repeat itself', () => {
        const ids = new Set(Array.from({ length: 200 }, () => clientId()));
        expect(ids.size).toBe(200);
    });

    it('still mints one where crypto.randomUUID does not exist', () => {
        // Not hypothetical: randomUUID needs a secure context, and a self-hosted install
        // reached over plain http:// on a home network does not have one.
        const original = globalThis.crypto;
        try {
            Object.defineProperty(globalThis, 'crypto', {
                value: { getRandomValues: original.getRandomValues.bind(original) },
                configurable: true
            });
            expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        } finally {
            Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
        }
    });

    it('still mints one where there is no crypto at all', () => {
        const original = globalThis.crypto;
        try {
            Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
            expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        } finally {
            Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
        }
    });
});

describe('fillCopy', () => {
    it('fills a placeholder', () => {
        expect(fillCopy(JOURNAL_COPY.triggers.merge.body, { from: 'work', into: 'Arbeit', count: 3 }))
            .toBe('Everything that names work will name Arbeit instead — 3 so far.');
    });

    it('leaves an unfilled placeholder standing rather than blanking it', () => {
        expect(fillCopy('{count} so far.', {})).toBe('{count} so far.');
    });
});

describe('humanMinutes', () => {
    it('says the half-life the day graph draws with', () => {
        expect(humanMinutes(150)).toBe('two and a half hours');
        expect(humanMinutes(120)).toBe('two hours');
        expect(humanMinutes(90)).toBe('an hour and a half');
        expect(humanMinutes(60)).toBe('an hour');
        expect(humanMinutes(45)).toBe('45 minutes');
    });

    it('lets the day graph name the strength it draws an unstated one at', () => {
        // §8.2 rule 7 and A8's hand-forward: the ritual's day word carries no intensity, and
        // whatever the graph draws it at has to be a constant this sentence names.
        expect(fillCopy(JOURNAL_COPY.dayGraph.unstated, { strength: 1 }))
            .toBe('A feeling recorded without a strength, like the closing word, is drawn at 1 of three.');
        expect(JOURNAL_COPY.dayGraph.unstated).toMatch(/\{strength\}/);
    });

    it('lets the day graph derive its sentence from the constant rather than write it out', () => {
        expect(fillCopy(JOURNAL_COPY.dayGraph.fade, { halfLife: humanMinutes(150) }))
            .toBe('Each feeling is drawn fading over about two and a half hours unless you mention it again.');
        expect(fillCopy(JOURNAL_COPY.dayGraph.fade, { halfLife: humanMinutes(60) }))
            .toBe('Each feeling is drawn fading over about an hour unless you mention it again.');
    });
});

/* ------------------------------------------------------------------------------------ */
/* A9 — the two vocabulary views                                                          */
/* ------------------------------------------------------------------------------------ */

describe('the journal’s routes', () => {
    it('keeps every static segment out of the day route’s way', () => {
        // A day is `YYYY-MM-DD`, so a static segment can never be mistaken for one — which
        // is what lets `/journal/people` and `/journal/:day` share a prefix safely.
        expect(PEOPLE_PATH).toBe('/journal/people');
        expect(TRIGGERS_PATH).toBe('/journal/triggers');
        expect(isDayString('people')).toBe(false);
        expect(isDayString('triggers')).toBe(false);
    });
});

describe('JOURNAL_HISTORY_FROM', () => {
    it('is a day the server will accept, and earlier than anything this app can write', () => {
        // The two vocabulary views count the whole record rather than one month, and this
        // is the floor they ask from. A malformed one would be a 400 on both screens.
        expect(isDayString(JOURNAL_HISTORY_FROM)).toBe(true);
        expect(JOURNAL_HISTORY_FROM < civilDay(new Date('1971-01-01T12:00:00Z'))).toBe(true);
    });
});

describe('journalPersonPath', () => {
    it('builds a person route from the relationship id, never from the name', () => {
        expect(journalPersonPath(7)).toBe('/journal/people/7');
        expect(journalPersonPath('7')).toBe('/journal/people/7');
    });

    it('falls back to the list rather than building a broken route', () => {
        // `journalDayPath`'s rule: a path builder never builds a path that cannot resolve.
        expect(journalPersonPath(null)).toBe('/journal/people');
        expect(journalPersonPath('')).toBe('/journal/people');
        expect(journalPersonPath('Lucie')).toBe('/journal/people');
    });
});

describe('countCopy', () => {
    it('fills whatever else the clause names, not only the count', () => {
        // Each counted clause carries its own verb, so "1 entry stops" and "2 entries stop"
        // are two templates rather than one with a number dropped into it.
        expect(countCopy(1, JOURNAL_COPY.people.remove.mentions, { name: 'Lucie' }))
            .toBe('1 entry stops being linked to Lucie.');
        expect(countCopy(3, JOURNAL_COPY.people.remove.mentions, { name: 'Lucie' }))
            .toBe('3 entries stop being linked to Lucie.');
    });

    it('picks the singular and the plural, and fills the count', () => {
        expect(countCopy(1, JOURNAL_COPY.people.mentionCount)).toBe('1 entry names this person.');
        expect(countCopy(2, JOURNAL_COPY.people.mentionCount)).toBe('2 entries name this person.');
        // Zero is a plural in English, and it is a number a row genuinely reports: a person
        // known only from a snapshot has no entries naming them.
        expect(countCopy(0, JOURNAL_COPY.people.mentionCount)).toBe('0 entries name this person.');
    });

    it('returns nothing rather than the word "undefined" for a template that is not there', () => {
        expect(countCopy(1, undefined)).toBe('');
        expect(countCopy(1, { many: 'only a plural' })).toBe('');
    });
});

describe('topFeelings', () => {
    it('takes the two most often attached, most first', () => {
        const top = topFeelings({ calm: 1, stress: 5, joy: 3 });

        expect(top.map(feeling => feeling.id)).toEqual(['stress', 'joy']);
        expect(top[0].count).toBe(5);
        // The label the vocabulary carries, not the id: "rapport" is stored, "connectedness"
        // is what a row says.
        expect(topFeelings({ rapport: 1 })[0].label).toBe('connectedness');
    });

    it('breaks a tie on taxonomy order, so the same data always names the same two', () => {
        // Three feelings tied at one. FEELINGS order decides, and it decides the same way
        // whichever order they arrive in — a row that named a different pair on every
        // render would read as the app changing its mind about the user.
        const order = FEELINGS.map(feeling => feeling.id);
        expect(order.indexOf('joy')).toBeLessThan(order.indexOf('calm'));
        expect(order.indexOf('calm')).toBeLessThan(order.indexOf('anger'));

        expect(topFeelings({ anger: 1, calm: 1, joy: 1 }).map(f => f.id)).toEqual(['joy', 'calm']);
        expect(topFeelings({ joy: 1, anger: 1, calm: 1 }).map(f => f.id)).toEqual(['joy', 'calm']);
        expect(topFeelings(new Map([['calm', 1], ['anger', 1], ['joy', 1]])).map(f => f.id))
            .toEqual(['joy', 'calm']);
    });

    it('keeps an id it has never heard of, after every known one, and alphabetically', () => {
        // A retired or newer feeling is still one somebody recorded — `FeelingChip` shows
        // it under its own id rather than dropping it, and this sorts it the same way.
        const top = topFeelings({ zebra: 1, aardvark: 1, joy: 1 }, 3);

        expect(top.map(feeling => feeling.id)).toEqual(['joy', 'aardvark', 'zebra']);
        expect(top[1].label).toBe('aardvark');
    });

    it('says nothing about a count of zero, or about nothing at all', () => {
        expect(topFeelings({ calm: 0 })).toEqual([]);
        expect(topFeelings({})).toEqual([]);
        expect(topFeelings(null)).toEqual([]);
    });
});

/* The two summaries, over the shape `GET /api/journal/entries` returns. */

const mention = (relationshipId, ref = 0, label = 'Lucie') => ({
    ID: ref + 1, relationship_id: relationshipId, label, ref
});

const summaryCheckin = (id, day, feelings, mentions = []) => ({
    ID: id,
    client_id: `checkin-${id}`,
    kind: 'checkin',
    day,
    at: `${day}T09:00:00Z`,
    payload: { v: 1, feelings },
    mentions
});

describe('summarizePerson', () => {
    const entries = [
        summaryCheckin(1, '2026-08-01', [
            { id: 'calm', about: [{ kind: 'person', ref: 0 }] },
            // Attached to nobody. It happened on a day she is named on and it is not
            // about her, so it must not reach her summary.
            { id: 'anger', about: [] }
        ], [mention(7)]),
        summaryCheckin(2, '2026-08-02', [
            { id: 'calm', about: [{ kind: 'person', ref: 1 }] },
            { id: 'joy', about: [{ kind: 'person', ref: 0 }] }
        ], [mention(9, 0, 'Noor'), mention(7, 1)]),
        { ID: 3, kind: 'ritual', day: '2026-08-03', at: '2026-08-03T22:30:00Z', payload: { v: 1 }, mentions: [mention(7)] },
        { ID: 4, kind: 'person_fact', day: '2026-08-04', at: '2026-08-04T09:00:00Z', payload: { v: 1, text: 'moved to Lyon' }, mentions: [mention(7)] }
    ];

    it('counts every entry that names them, whatever kind it is', () => {
        expect(summarizePerson(entries, 7).count).toBe(4);
        expect(summarizePerson(entries, 9).count).toBe(1);
        expect(summarizePerson(entries, 99).count).toBe(0);
    });

    it('splits the facts from everything else, and the two do not overlap', () => {
        const summary = summarizePerson(entries, 7);

        // These two lengths are the remove dialog's two numbers, and it states them as
        // facts before doing the thing — so nothing may be in both.
        expect(summary.facts.map(entry => entry.ID)).toEqual([4]);
        expect(summary.mentions.map(entry => entry.ID)).toEqual([3, 2, 1]);
        expect(summary.facts.length + summary.mentions.length).toBe(summary.count);
    });

    it('reads newest first, the opposite of the server order', () => {
        expect(summarizePerson(entries, 7).entries.map(entry => entry.ID)).toEqual([4, 3, 2, 1]);
    });

    it('counts only the feelings attached to them, through the ref and never the name', () => {
        const summary = summarizePerson(entries, 7);

        // Lucie is ref 0 on entry 1 and ref 1 on entry 2 — the position is per entry, which
        // is exactly why a summary that trusted the ref alone would be wrong. `calm` is
        // hers twice; the `joy` on entry 2 points at ref 0, who is Noor there.
        expect(summary.feelings).toEqual([{ id: 'calm', count: 2, label: 'calm' }]);
        expect(summarizePerson(entries, 9).feelings.map(feeling => feeling.id)).toEqual(['joy']);
        // `anger` was attached to nobody.
        expect(summary.feelings.some(feeling => feeling.id === 'anger')).toBe(false);
    });
});

describe('summarizeTrigger', () => {
    const resolve = (id) => (id === 'old' || id === 'older' ? 'live' : id);
    const entries = [
        // Two feelings, one trigger, one entry: the row's two numbers mean different things.
        summaryCheckin(1, '2026-08-01', [
            { id: 'stress', about: [{ kind: 'trigger', trigger: 'live' }] },
            { id: 'anxiety', about: [{ kind: 'trigger', trigger: 'live' }] }
        ]),
        // Written before a rename, pointing at the id that was live that day.
        summaryCheckin(2, '2026-08-02', [{ id: 'stress', about: [{ kind: 'trigger', trigger: 'old' }] }]),
        // Written before the rename before that.
        summaryCheckin(3, '2026-08-03', [{ id: 'calm', about: [{ kind: 'trigger', trigger: 'older' }] }]),
        summaryCheckin(4, '2026-08-04', [{ id: 'joy', about: [{ kind: 'trigger', trigger: 'other' }] }]),
        { ID: 5, kind: 'trigger', day: '2026-08-05', payload: { v: 1, label: 'live' }, mentions: [] }
    ];

    it('gathers every entry along the chain, and counts the entry once', () => {
        const summary = summarizeTrigger(entries, 'live', resolve);

        expect(summary.count).toBe(3);
        expect(summary.entries.map(entry => entry.ID)).toEqual([3, 2, 1]);
        // stress ×2, anxiety ×1, calm ×1 — the tie between the last two goes to calm, which
        // comes first in FEELINGS.
        expect(summary.feelings.map(feeling => feeling.id)).toEqual(['stress', 'calm']);
    });

    it('never counts a trigger row as an entry that names one', () => {
        // A trigger is vocabulary, not an event — the same reason `DAY_KINDS` leaves it out.
        expect(summarizeTrigger(entries, 'live', resolve).entries.some(entry => entry.kind === 'trigger'))
            .toBe(false);
    });

    it('resolves through the reader rather than comparing ids as written', () => {
        // Without the resolver the two pre-rename entries would be a different trigger, and
        // the vocabulary would look fragmented in exactly the way ids exist to prevent.
        expect(summarizeTrigger(entries, 'live').count).toBe(1);
    });
});

describe('the two corrections', () => {
    const live = {
        clientId: 'id-work',
        label: 'work',
        live: 'id-work',
        corrects: [],
        createdFrom: 'checkin-0',
        raw: { ID: 12, client_id: 'id-work', payload: { v: 1, label: 'work', created_from: 'checkin-0' } }
    };

    it('renames with a new client id, the row-level link, and the old id carried forward', () => {
        const request = renameTriggerRequest({ trigger: live, label: ' the job ' });

        expect(request.kind).toBe('trigger');
        expect(request.schema_version).toBe(1);
        expect(request.payload.v).toBe(1);
        expect(request.payload.label).toBe('the job');
        expect(request.payload.merged_into).toBeNull();
        // A correction row cannot reuse the client id it replaces — they are unique per
        // user — so the client-visible link back is `corrects`.
        expect(request.client_id).not.toBe('id-work');
        expect(request.client_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(request.payload.corrects).toEqual(['id-work']);
        // The row-level link is the database id, which only the server can have minted.
        expect(request.supersedes_id).toBe(12);
        // `created_from` records the check-in it was born in. A correction is not a birth.
        expect(request.payload.created_from).toBe('checkin-0');
        // A trigger row names nobody and mints nothing.
        expect(request.mentions).toEqual([]);
        expect(request.triggers).toEqual([]);
    });

    it('accumulates the list across two renames rather than pointing one hop back', () => {
        const once = renameTriggerRequest({ trigger: live, label: 'the job' });
        const renamed = {
            clientId: once.client_id,
            label: 'the job',
            live: once.client_id,
            corrects: once.payload.corrects,
            createdFrom: 'checkin-0',
            raw: { ID: 13, client_id: once.client_id, payload: once.payload }
        };

        const twice = renameTriggerRequest({ trigger: renamed, label: 'paid work' });

        // Both ids, in order. The middle row is superseded and in no list the client holds,
        // so a one-hop link would strand every entry written before the first rename.
        expect(twice.payload.corrects).toEqual(['id-work', once.client_id]);
        expect(readTrigger('id-work', [{ client_id: twice.client_id, payload: twice.payload }]).label)
            .toBe('paid work');
    });

    it('merges by naming the survivor, and carries the label rather than inventing one', () => {
        const into = { clientId: 'id-old', live: 'id-new', label: 'Arbeit' };
        const request = mergeTriggerRequest({ trigger: live, into });

        // `live`, not `clientId`: the survivor may have been renamed since, and the server
        // rejects a merge into a superseded id.
        expect(request.payload.merged_into).toBe('id-new');
        // The user asked to merge, not to rename — and the server requires a label on every
        // trigger row, so an empty one here would be a 400 nobody could read.
        expect(request.payload.label).toBe('work');
        expect(request.payload.corrects).toEqual(['id-work']);
        expect(request.supersedes_id).toBe(12);
    });

    it('produces a row every reader resolves to the survivor', () => {
        const request = mergeTriggerRequest({
            trigger: live,
            into: { live: 'id-arbeit', label: 'Arbeit' }
        });
        const vocabulary = [
            { client_id: request.client_id, kind: 'trigger', payload: request.payload },
            { client_id: 'id-arbeit', kind: 'trigger', payload: { v: 1, label: 'Arbeit' } }
        ];

        // The id every check-in written so far still points at.
        const resolved = readTrigger('id-work', vocabulary);
        expect(resolved.label).toBe('Arbeit');
        expect(resolved.live).toBe('id-arbeit');
        expect(resolved.merged).toBe(true);
        // And the merged-away row is not offered as vocabulary any more.
        expect(activeTriggers(vocabulary).map(entry => entry.client_id)).toEqual(['id-arbeit']);
    });
});
