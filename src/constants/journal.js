/**
 * The emotional journal: its closed vocabularies, every string it can show, and the
 * arithmetic that reads a stored entry back.
 *
 * The product rule this file exists to enforce is negative: **no mood score, no daily
 * average, no counting of missed nights, no evaluative vocabulary.** A night with no
 * ritual leaves no row and no trace — there is nothing here that could count one, and
 * anything added here that starts scoring a day is a bug. The forbidden list in
 * `journal.test.js` is what makes that mechanical rather than remembered: every string in
 * this file is walked, so a word cannot arrive by being written carefully once.
 *
 * Ids are permanent and they are a contract with the server. `FEELINGS`,
 * `RITUAL_QUESTIONS` and `ENTRY_KINDS` hold the same ids as `domain.FeelingIDs`,
 * `domain.RitualQuestionIDs` and `domain.JournalKinds` in
 * backend/internal/domain/journal.go, and a test reads that Go file and asserts both
 * directions. Labels, glosses, the two axes the day graph draws on, and colours are
 * frontend-owned; the server has no opinion about what a feeling is called. Removing an id
 * is forbidden — mark it `retired: true` here so the UI stops offering it while the server
 * keeps accepting it for the rows already written.
 *
 * Nothing in this file renders, imports React, or talks to the network. It is content and
 * pure functions, which is what lets the readers be tested without a DOM and lets the copy
 * be tested without a screen. That claim is load-bearing — `journalSettings.js` rests on it,
 * and `MobileBottomNav` imports this module for a single route constant — so the one thing
 * it shares with the snapshot form, the tag limit, comes from `constants/contextTags.js`
 * rather than from the component that used to hold it.
 */

import { MAX_TAG_LENGTH } from './contextTags';

/* ------------------------------------------------------------------------------------ */
/* 1. Feelings                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * The feeling vocabulary. Twenty-one entries, in the order the UI lays them out.
 *
 * `valence` (−1 … +1) and `energy` (0 … 1) are the two axes of the day graph (§8.1): y is
 * valence scaled by the intensity the user set, z is energy, fixed per feeling so the same
 * feeling always sits at the same depth. They are **content, not computation** — authored
 * constants, the way the slider anchor phrases are, not something derived from anything.
 *
 * `hex` is a complete literal colour. It is never assembled from parts and never used to
 * build a Tailwind class name: `bg-${x}-400` is purged at build time and renders colourless
 * (invariant 4). SVG takes the hex directly, which is what the graph and the chips want.
 *
 * Labels are nouns, descriptive, and never graded — there is no "very anxious" entry.
 * Strength is the separate 1–3 intensity the user sets per check-in.
 */
export const FEELINGS = [
    { id: 'joy', label: 'joy', gloss: 'lit up, and wholly pleasant', valence: 0.8, energy: 0.7, hex: '#fbbf24' },
    { id: 'excitement', label: 'excitement', gloss: 'keyed up, something coming', valence: 0.6, energy: 0.9, hex: '#fb923c' },
    { id: 'pleasure', label: 'pleasure', gloss: 'this is nice, right now', valence: 0.7, energy: 0.5, hex: '#f472b6' },
    // "rapport" as the id, "connectedness" in the copy: the id is permanent and the label
    // is not, so the word that reads best on a chip can change without moving any data.
    { id: 'rapport', label: 'connectedness', gloss: 'close to someone, in step', valence: 0.7, energy: 0.4, hex: '#fb7185' },
    { id: 'gratitude', label: 'gratitude', gloss: 'glad something was given', valence: 0.6, energy: 0.3, hex: '#34d399' },
    { id: 'pride', label: 'pride', gloss: 'this one was yours to do', valence: 0.6, energy: 0.6, hex: '#a3e635' },
    { id: 'curiosity', label: 'curiosity', gloss: 'pulled toward finding out', valence: 0.4, energy: 0.6, hex: '#22d3ee' },
    { id: 'calm', label: 'calm', gloss: 'settled, nothing pressing', valence: 0.5, energy: 0.2, hex: '#2dd4bf' },
    { id: 'neutral', label: 'level', gloss: 'nothing in particular', valence: 0.0, energy: 0.3, hex: '#94a3b8' },
    // The entry the whole thesis depends on. Alexithymia is not the absence of feeling, it
    // is the absence of a name for one, so "can't tell" has to be a first-class answer a
    // user can tap and the graph can draw — dashed, like every other uncertainty in this
    // app — rather than a gap the record reads as nothing having happened. Every other
    // entry in this list is optional. This one is the reason the list exists.
    { id: 'unclear', label: "can't tell", gloss: 'something is there, and it has no name yet', valence: 0.0, energy: 0.4, hex: '#a1a1aa' },
    { id: 'tiredness', label: 'tiredness', gloss: 'run down, low on fuel', valence: -0.2, energy: 0.1, hex: '#38bdf8' },
    { id: 'boredom', label: 'boredom', gloss: 'nothing here holds you', valence: -0.3, energy: 0.2, hex: '#60a5fa' },
    { id: 'longing', label: 'longing', gloss: 'reaching for what is not here', valence: -0.2, energy: 0.5, hex: '#a78bfa' },
    { id: 'loneliness', label: 'loneliness', gloss: 'apart from people, and feeling it', valence: -0.6, energy: 0.3, hex: '#818cf8' },
    { id: 'sadness', label: 'sadness', gloss: 'heavy, and slow', valence: -0.7, energy: 0.2, hex: '#6366f1' },
    { id: 'shame', label: 'shame', gloss: 'wanting to be unseen', valence: -0.7, energy: 0.5, hex: '#e879f9' },
    { id: 'irritation', label: 'irritation', gloss: 'rubbed the wrong way', valence: -0.4, energy: 0.6, hex: '#f97316' },
    { id: 'stress', label: 'stress', gloss: 'too much at once, and pressing', valence: -0.5, energy: 0.8, hex: '#f43f5e' },
    { id: 'anxiety', label: 'anxiety', gloss: 'braced for something', valence: -0.6, energy: 0.8, hex: '#a855f7' },
    { id: 'overwhelm', label: 'overwhelm', gloss: 'more than can be held', valence: -0.5, energy: 0.9, hex: '#d946ef' },
    { id: 'anger', label: 'anger', gloss: 'hot, and pushed against', valence: -0.7, energy: 0.9, hex: '#ef4444' }
];

/** The feeling the graph draws dashed alongside anything the user marked uncertain. */
export const UNCLEAR_FEELING_ID = 'unclear';

/** Feelings the UI offers. A retired id stays readable and stops being offered. */
export const activeFeelings = () => FEELINGS.filter(feeling => !feeling.retired);

/** One feeling by id, or null. Never invents an entry for an id it does not know. */
export const feelingById = (id) => FEELINGS.find(feeling => feeling.id === id) || null;

/* ------------------------------------------------------------------------------------ */
/* 2. The nightly ritual's questions                                                      */
/* ------------------------------------------------------------------------------------ */

/**
 * Every question the ritual can ask. The five core ones are always asked, in this order;
 * the eight optional ones are off by default and the user turns on at most three.
 *
 * `note` is the sentence the settings screen shows beside the question. It says why the
 * question is here, in the plain register the Vault uses, and it is walked by the
 * forbidden-word test like everything else. `water`'s note says out loud that its evidence
 * is weak, because a setting that oversells itself is a claim the app cannot support.
 *
 * The order is fixed and the set does not rotate: a condition asked on alternate nights is
 * half a dataset, and a ritual whose value is its sameness cannot change under the user.
 */
export const RITUAL_QUESTIONS = [
    {
        id: 'slept_well',
        text: 'Slept well last night?',
        core: true,
        note: 'Sleep is the strongest single day-level predictor of how a day feels, and a bedtime question can still answer for the night before.'
    },
    {
        id: 'moved_body',
        text: 'Moved your body today?',
        core: true,
        note: 'Movement tracks with same-day mood. "Moved" rather than "exercised" — a walk counts, and you do not have to decide whether it does.'
    },
    {
        id: 'daylight',
        text: 'Spent time outside today?',
        core: true,
        note: 'Daylight tracks seasonal and weekly changes in mood, and it is trivially observable.'
    },
    {
        id: 'with_people',
        text: 'Spent time with someone today?',
        core: true,
        note: 'Time with people is the other large same-day effect, and it is the question that connects the ritual to the rest of the app: a yes can name who.'
    },
    {
        id: 'ate_regularly',
        text: 'Ate at regular times today?',
        core: true,
        note: 'Irregular meals track with irritation and low energy, and this is one people can answer about today even when they cannot about yesterday.'
    },
    {
        id: 'alcohol',
        text: 'Had alcohol today?',
        core: false,
        note: 'A strong next-day effect. Off by default because it is a question some people would rather a database did not hold.'
    },
    {
        id: 'caffeine_late',
        text: 'Caffeine after mid-afternoon?',
        core: false,
        note: 'Works through sleep, and it is cheap to answer.'
    },
    {
        id: 'in_pain',
        text: 'Body hurting or unwell today?',
        core: false,
        note: 'Pain and illness take over how a day feels while they last. The wording stays plain on purpose — this is a question about your body, not about a condition.'
    },
    {
        id: 'worked_late',
        text: 'Work ran past its hours today?',
        core: false,
        note: 'The most common trigger that is not a person.'
    },
    {
        id: 'time_alone',
        text: 'Had time to yourself today?',
        core: false,
        note: 'The counterpart of time with people. For many people this is the protective one rather than contact.'
    },
    {
        id: 'conflict',
        text: 'A disagreement with someone today?',
        core: false,
        note: 'Maps onto the conflict context tag the snapshots already use, so the two halves of the app describe the same day the same way.'
    },
    {
        id: 'cycle',
        text: 'Period today?',
        core: false,
        note: 'Only ever shown once you turn it on. The app never suggests it.'
    },
    {
        id: 'water',
        text: 'Drank enough water?',
        core: false,
        note: 'Cheap to answer and often asked for. Its evidence as a mood predictor is weak — it is here because you may want it, not because it tells you much.'
    }
];

/** The five core questions, in the fixed order the cards use. */
export const coreQuestions = () => RITUAL_QUESTIONS.filter(question => question.core);

/** The eight the settings screen offers. */
export const optionalQuestions = () => RITUAL_QUESTIONS.filter(question => !question.core);

/** One question by id, or null. */
export const questionById = (id) => RITUAL_QUESTIONS.find(question => question.id === id) || null;

/**
 * Tonight's deck: the five core questions in their fixed order, then the optional ones this
 * device has turned on.
 *
 * The optional tail is ordered by `RITUAL_QUESTIONS`, **not** by the order the user switched
 * them on, and it is capped here as well as in the settings screen. A deck that reordered
 * itself would defeat the whole reason the set is fixed (§3.3): the ritual's value is that it
 * can be done with the eyes closed, and an eyes-closed swipe is muscle memory of a sequence.
 *
 * Unknown ids are dropped rather than passed through — a stored list can outlive a build that
 * retired a question, and a card with no text is worse than a question not asked.
 */
export const ritualDeck = (enabledOptionalIds = []) => {
    const wanted = new Set(Array.isArray(enabledOptionalIds) ? enabledOptionalIds : []);
    const tail = optionalQuestions()
        .filter(question => wanted.has(question.id))
        .slice(0, MAX_OPTIONAL_QUESTIONS);

    return [...coreQuestions(), ...tail];
};

/**
 * The version of the *question set*, stored as `question_set.version` (§6.3).
 *
 * It is not the payload's `v`, and the two version different things: `v` says how to read the
 * shape, this says which core five were asked. It moves only if the core set itself ever
 * changes, which is what would make an old row's `asked` list mean something different.
 */
export const RITUAL_QUESTION_SET_VERSION = 1;

/* ------------------------------------------------------------------------------------ */
/* 3. Limits and other constants                                                          */
/* ------------------------------------------------------------------------------------ */

/** The entry kinds. Matches `domain.JournalKinds`; a new kind is how the journal extends. */
export const ENTRY_KINDS = ['checkin', 'ritual', 'person_fact', 'trigger'];

/** The payload format these readers were written for. */
export const PAYLOAD_VERSION = 1;

/** How many feelings one check-in may carry. Beyond this a check-in stops being a sentence. */
export const MAX_FEELINGS_PER_CHECKIN = 5;

/** A transcript is a spoken minute or two, not a document. */
export const MAX_TRANSCRIPT_LENGTH = 4000;

/**
 * A trigger label is a few words. It borrows the context tag's limit rather than declaring
 * a second forty, because they are the same kind of thing written in two places and two
 * constants would drift the day one of them changed.
 */
export const MAX_TRIGGER_LABEL = MAX_TAG_LENGTH;

/** Intensity is 1–3. Its words live in JOURNAL_COPY so the forbidden-word walk sees them. */
export const INTENSITY_LEVELS = [1, 2, 3];

/**
 * The hour a civil day turns over, local. A check-in at 02:00 belongs to the day before,
 * because the day a person means at 02:00 is the one they have not gone to bed from yet.
 * It is stored on the ritual entry (`rollover_hour`) so it can change later without
 * reinterpreting the rows already written.
 */
export const DAY_ROLLOVER_HOUR = 4;

/** Where the journal's routes live. */
export const JOURNAL_ROOT = '/journal';

/** The nightly ritual's own route. A static segment, so it is never a day called "ritual". */
export const RITUAL_PATH = `${JOURNAL_ROOT}/ritual`;

/** The two vocabulary screens (§9.1). Static segments, for `RITUAL_PATH`'s reason. */
export const PEOPLE_PATH = `${JOURNAL_ROOT}/people`;
export const TRIGGERS_PATH = `${JOURNAL_ROOT}/triggers`;

/**
 * One person's screen, keyed by `relationship_id` and never by name — which is the whole
 * reason it survives a rename (§9.1, invariant 2a). An id that is not a number answers with
 * the list, on `journalDayPath`'s rule: a path builder never builds a broken path.
 */
export const journalPersonPath = (relationshipId) => (
    Number.isFinite(Number(relationshipId)) && relationshipId !== null && relationshipId !== ''
        ? `${PEOPLE_PATH}/${relationshipId}`
        : PEOPLE_PATH
);

/**
 * The earliest day the client will ask the server for.
 *
 * The People and Triggers views count *entries*, and a count over the month the day view
 * happens to have loaded would be a number that changes when you walk to March — worse, the
 * *remove this person from the journal* dialog states its count as a fact before doing the
 * thing, so a month's worth would make that sentence untrue. Both screens therefore load the
 * whole history, and this is its floor.
 *
 * It costs one string comparison on the server (`day` is a varchar precisely so the range is
 * lexical — §6.2), and it is early enough that nothing this app can write falls before it:
 * `civilDay` derives from a local `Date`, and an import carries days some copy of this app
 * wrote. It is not "the beginning of time" and does not pretend to be.
 */
export const JOURNAL_HISTORY_FROM = '1970-01-01';

/** The per-device settings keys from §9.7. Values are per device and never sent anywhere. */
export const JOURNAL_STORAGE_KEYS = {
    ritual: 'alq:journal-ritual',
    questions: 'alq:journal-questions',
    askWho: 'alq:journal-ask-who',
    voice: 'alq:journal-voice',
    suggestions: 'alq:journal-suggestions',
    embeddings: 'alq:journal-embeddings',
    keepTranscripts: 'alq:journal-keep-transcripts',
    language: 'alq:journal-language'
};

/** The ritual's default time, if the user never picks one. */
export const DEFAULT_RITUAL_TIME = '22:30';

/** At most three optional questions on top of the five core ones (§3.3). */
export const MAX_OPTIONAL_QUESTIONS = 3;

/* ------------------------------------------------------------------------------------ */
/* 4. Copy                                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * Every string the journal can render.
 *
 * From here on nothing in a journal component is a bare string literal: components read
 * this object. That is not tidiness — it is the only way the forbidden-word walk can see
 * the whole surface of the feature, and a sentence a component owns privately is a
 * sentence no test has ever read.
 *
 * Where a number belongs in a sentence, the string carries a `{placeholder}` and the
 * component fills it with `fillCopy`. The template stays walkable, and a constant that is
 * tuned later (the graph's half-life, a merge's count) cannot make the sentence false.
 *
 * The settings block covers all eight settings in §9.7, including the four that belong to
 * later slices. **A description here is not permission to render the toggle** — the voice,
 * suggestion, embedding and language settings arrive with 6-C, 6-D and 6-G, and rendering
 * a toggle for something that does not exist would make a Vault claim false (invariant 2e).
 */
export const JOURNAL_COPY = {
    ritual: {
        heading: 'The nightly questions',
        prompt: "Tonight's questions are ready.",
        start: 'Start',
        dismiss: 'Not tonight',
        // The notification body. Nothing else, ever — a lock screen is readable by anyone
        // holding the phone.
        notification: "Tonight's questions are ready.",
        yes: 'Yes',
        no: 'No',
        skip: 'Skip',
        skipHint: 'Skipping leaves this one unanswered, which is its own answer.',
        who: 'Who?',
        whoHint: 'Optional. Tap the people this evening had in it.',
        whoDone: 'Done',
        dayWord: 'And today, in a word?',
        // The closing card's chips carry the vocabulary's own labels — including "can't
        // tell", which is a feeling id here and not a way of declining to answer. Declining
        // is `skip`, and the two are different records (§3.2, invariant 14).
        done: 'Recorded.',
        // Leaving before the last card writes nothing at all, which is the whole of what a
        // missed night is (§3.6). The button says what it does and nothing about what was
        // left behind.
        close: 'Close',
        // The dot row's spoken label. A position, not a score of how far along anyone is.
        progress: 'Card {index} of {total}',
        saving: 'Saving…',
        // Trap 4 again: the cards stay where they are and every tap is still held, so the
        // sentence says that rather than only that the write did not land.
        saveError: "Could not save tonight's answers. What you tapped is still here.",
        retry: 'Try again'
    },

    checkin: {
        prompt: 'What is it like right now?',
        speak: 'Say it',
        type: 'Type it',
        chips: 'Tap a few words',

        // The two ways in (§9.2): the header button above `md`, where the dashboard puts
        // its own primary action, and the round one over the bottom bar on a handset. The
        // microphone takes this place in 6-C on a device that can run it; until then the
        // way in is the keyboard and the chips, which is the feature and not a fallback.
        open: 'Check in',
        openHint: 'Record how right now is',
        close: 'Close',

        intensityLabel: 'How strong?',
        // The dots button's spoken label. The dots themselves are never read aloud, and a
        // number is never drawn — the word is what a strength means (§4.4 item 2).
        intensityAria: 'How strong: {word}',
        uncertainLabel: 'Not sure about this one',
        aboutLabel: 'About',
        noteLabel: 'Anything to add?',
        tagsLabel: 'What was going on?',
        save: 'Save',
        saving: 'Saving…',
        cancel: 'Cancel',
        notSynced: 'Not yet synced',

        // The grid of twenty-one words, and the field that narrows it.
        find: 'Find a word',
        findEmpty: 'Nothing here matches that.',
        // Stated, never silently enforced. It is on screen before the cap is reached, so
        // the limit is something the user was told rather than something they ran into.
        cap: 'Up to {max} words in one check-in.',
        // "can't tell" is exclusive, and the sentence says so where it can be read rather
        // than only in a design document.
        unclearAlone: 'That one stands on its own — picking it puts the others down.',

        // What a feeling was about: a person, a trigger, or a context tag.
        addPerson: 'Person',
        addTrigger: 'Trigger',
        addTag: 'Tag',
        personLabel: 'Who was it about?',
        personPlaceholder: 'Type a name',
        triggerLabel: 'What was it about?',
        triggerPlaceholder: 'Type a word or two',
        tagLabel: 'Or a word for the moment',
        tagPlaceholder: 'Add your own',
        add: 'Add',
        remove: 'Remove {label}',
        pickUp: 'Move {label} to another word',
        moveHint: 'Now tap the one it belongs to.',
        moveHere: 'Move here',

        // Trap 4: the sheet stays open and keeps every selection, so the sentence has to
        // say that the words are still here rather than only that the write did not land.
        saveError: 'Could not save this check-in. Nothing was written, and what you picked is still here.',

        // §7.1 — a journal row is a statement made at a moment. It can be withdrawn; it
        // cannot be edited, and the dialog states what the withdrawal takes with it.
        delete: {
            action: 'Delete this check-in',
            title: 'Delete this check-in',
            body: 'This removes the check-in from {time} — {feelings} — and what each was about. The people and triggers it named stay where they are.',
            confirm: 'Delete',
            cancel: 'Keep it',
            error: 'Could not delete this check-in.'
        },

        // Intensity is the graded axis by design, so its words may be graded. The feelings
        // themselves may not be — that separation is the whole reason intensity exists.
        intensity: {
            1: 'a little',
            2: 'clearly',
            3: 'strongly'
        }
    },

    // The day view — `/journal` and `/journal/:day`. The date itself is not copy: it is
    // formatted by the browser in the reader's own locale, which is why no month name and
    // no weekday appears in this object.
    day: {
        previous: 'Previous day',
        next: 'Next day',
        today: 'Today',
        month: 'Days this month',
        // The ritual sits under the day's check-ins rather than among them: a check-in is
        // a moment inside the day and the ritual is about the whole of it.
        ritualHeading: 'The evening questions',
        // A question that was shown and not answered. Never "skipped" in the day view —
        // `asked` minus `answers` is a fact about the row, and the word for it here is the
        // plainest one available (invariant 14).
        unanswered: 'Unanswered',
        // The screen's own error slot (agent guide, Recipe 5). The page keeps rendering
        // under it, and the banner can be put away without the day going with it.
        loadError: 'Could not load your journal. Check that the server is running, then reload.',
        dismiss: 'Dismiss'
    },

    empty: {
        today: 'A check-in is a sentence about right now. Say one, type one, or tap a few words.',
        firstRun: 'Before bed, five quick questions can put the day in context. Turn the ritual on in settings whenever you like.',
        // Never "you didn't check in". A day with nothing in it is a day with nothing in it.
        pastDay: 'Nothing recorded for this day.',
        // What a screen that exists but has nothing to show says. Used by the journal's
        // routes that later slices fill in, so a link is never a dead end.
        nothingHere: 'Nothing here yet.',
        voiceUnavailable: "Voice isn't available here — this device can't run the transcriber on its own, and the app won't send audio anywhere. Typing works the same way.",
        modelDownloading: 'Downloading the model — {size}. Tapping words works in the meantime.',
        modelDownloadCancel: 'Cancel'
    },

    settings: {
        heading: 'Journal',
        subheading: 'All of this is per device, and none of it is sent anywhere.',
        // The two words a toggle shows for its own state. One pair for the whole section,
        // so a control cannot end up describing itself differently from the one beside it.
        on: 'On',
        off: 'Off',
        ritual: {
            label: 'Nightly ritual',
            description: 'Five short questions at a time you choose, {time} by default. A night you skip leaves no row and no trace.',
            time: 'Time'
        },
        questions: {
            label: 'Optional questions',
            description: 'Up to {max} more questions on top of the five. Each is stored under its own permanent id, so turning one on later never changes what an older night meant.',
            // Stated before the cap is reached, never discovered by tapping — the same rule
            // the check-in's word cap follows.
            atLimit: '{max} chosen. Turn one off to choose another.'
        },
        askWho: {
            label: 'Ask who I was with',
            description: 'With this on, a yes to "spent time with someone" shows your people as chips so you can name them. It is off by default because it is a list of names on a screen at bedtime.'
        },
        voice: {
            label: 'Voice check-ins and suggestions',
            // Verbatim from the Vault's "What about AI features?" paragraph (§10.2), so the
            // toggle and the privacy page cannot drift apart.
            description: 'One model, and it runs on this device: Gemma 4 E2B, open weights under the Apache 2.0 licence, downloaded once from this server. It writes down a voice note — the audio is never saved and never sent — and suggests feelings, people and triggers to tag from what was said. It is asked only what you said, never how you sounded. Every suggestion waits for you to confirm, change, or discard it — nothing it proposes is saved on its own, and it never touches your love snapshots. It switches off in your profile at any time.',
            remove: 'Remove downloaded files'
        },
        suggestions: {
            label: 'Show suggestions',
            description: 'With this off, voice still writes the words down and you tag them yourself with chips.'
        },
        embeddings: {
            label: 'Similar-entry suggestions and search',
            description: 'A second small model (EmbeddingGemma, under Google\'s Gemma terms) turns your entries into numbers that this device uses to find entries with similar words. Those numbers are kept only on this device, never sent, never exported, and deleted when you sign out.'
        },
        keepTranscripts: {
            label: 'Keep transcripts',
            description: 'On by default. With this off, a voice check-in keeps only the feelings, people and triggers you confirmed, and the words are dropped when you save.'
        },
        language: {
            label: 'Transcription language',
            description: 'Auto — the model works out which language you spoke. Pin it here when it guesses wrong.'
        }
    },

    triggers: {
        heading: 'Triggers',
        subheading: 'What a feeling was about, when it was not a person.',
        newTrigger: 'New trigger: {label}?',
        // A pair rather than one plural-blind template, filled by `countCopy`. "1 entries"
        // is the kind of small wrongness a reader notices and then trusts the screen less
        // for, and both halves are in this object so the walk still sees them.
        entryCount: {
            one: '{count} entry names this.',
            many: '{count} entries name this.'
        },
        // The ⓘ beside the two feelings, on `SummaryLine`'s rule: every number shown is
        // arithmetic the screen can state in a sentence.
        attached: '{feelings} most often',
        attachedFormula: 'The two feelings attached to this trigger most often, across every check-in that names it. A tie goes to whichever word comes first in the list of feelings.',
        // The vocabulary with nothing in it yet. A trigger is only ever minted from a
        // check-in, so this says where they come from rather than offering to make one.
        empty: 'Triggers appear here once a check-in names one.',
        entries: 'Where this comes up',
        // The row's own disclosure. It opens the entries below it rather than a route:
        // §9.1 gives the vocabulary one screen and the detail lives inside it.
        expand: 'Show what names {label}',
        collapse: 'Hide what names {label}',
        actions: 'Actions for {label}',
        renameAction: 'Rename',
        mergeAction: 'Merge into…',
        rename: {
            title: 'Rename this trigger',
            body: 'The new name shows everywhere {label} appears now. Everything already written keeps pointing at the same trigger.',
            label: 'Name',
            confirm: 'Rename',
            cancel: 'Cancel',
            error: 'Could not rename this trigger.'
        },
        merge: {
            title: 'Merge two triggers',
            body: 'Everything that names {from} will name {into} instead — {count} so far.',
            // The dialog says this out loud because it is true and because a user who finds
            // out afterwards has no way back.
            oneWay: 'This is one-way: once merged, the two cannot be split apart again.',
            // The radio group above the sentence, and what it says when there is nothing to
            // pick — the shape `MergeRelationshipDialog` uses for the same moment.
            legend: 'Merge into',
            alone: 'There is nothing to merge into yet — this is your only trigger.',
            confirm: 'Merge',
            cancel: 'Cancel',
            error: 'Could not merge these triggers.'
        }
    },

    dayGraph: {
        infoLabel: 'About this drawing',
        // The half-life is filled from the constant rather than written into the sentence,
        // so tuning the constant cannot leave the sentence saying something untrue.
        fade: 'Each feeling is drawn fading over about {halfLife} unless you mention it again.',
        // The closing card is one tap on one word and records no strength (§6.5), so the
        // graph has to choose one to draw it at. §8.2 rule 7 says that choice is a stated
        // constant rather than a silent middle number, which is what this sentence states.
        unstated: 'A feeling recorded without a strength, like the closing word, is drawn at {strength} of three.',
        caveat: 'That is a drawing choice about what you recorded, not a claim about you.',
        extrapolated: 'The faint part is drawn past what you said, not measured.',
        legend: 'Feelings today',

        // B2's own words: the drawing's name, its two rotation buttons, the camera
        // toggle, and what a branch says when a screen reader reaches it. The graph shows
        // no person, no trigger and no note, so there is nothing here that discretion mode
        // would have to mask — the legend is feeling labels and nothing else (§9.6).
        label: 'The day as a curve',
        rotateLeft: 'Turn the drawing left',
        rotateRight: 'Turn the drawing right',
        // The two halves of one button. Flat is the 2-D ribbon — the same geometry with the
        // camera's tilt set to nothing (§8.3).
        flatten: 'Show it flat',
        tilt: 'Show it tilted',
        branch: 'Open the {feeling} check-in from {time}'
    },

    people: {
        heading: 'People',
        subheading: 'Everyone the journal has heard about, including those with no snapshot yet.',
        // See `triggers.entryCount` for why this is a pair.
        mentionCount: {
            one: '{count} entry names this person.',
            many: '{count} entries name this person.'
        },
        newPerson: 'New person: {name}?',
        candidateHint: 'Or one of these, if you meant them:',

        attached: '{feelings} most often',
        attachedFormula: 'The two feelings attached to this person most often, across every entry that names them. A tie goes to whichever word comes first in the list of feelings.',

        // The link to the stack, present only when a snapshot exists. §2.2: the dashboard
        // is snapshot-driven, so a person known only from the journal has no stack to link
        // to, and the row says that rather than offering a link to nothing.
        timeline: 'Open the timeline',
        journalOnly: 'No snapshot yet',
        // Rename, merge and delete are the dashboard's (§9.3). This is the line that says
        // where they are, so the absence reads as a decision rather than an omission.
        stackActions: 'Renaming, merging and deleting a person live on the dashboard.',

        empty: 'People appear here once an entry names one.',
        mentions: 'Where they come up',
        facts: 'What you kept about them',
        noFacts: 'Nothing kept about this person.',
        noMentions: 'Nothing names this person yet.',
        back: 'Back to people',
        // The suggestion list on the dashboard's New Analysis name field (§2.2), so the
        // first snapshot of someone the journal already knows lands on the existing row.
        suggestionsLabel: 'People the journal already knows',

        // §10.6. The one action that removes journal content about a third party, worded
        // with the exact count of what goes — and with what stays, because a check-in is
        // the user's own record of a day and this does not rewrite it.
        //
        // Two clauses rather than one sentence with two numbers dropped into it, and each
        // carries **its own verb**. A single template cannot agree with two counts at once:
        // the first draft read *"0 facts … go, and 1 entry stop being linked"*, which the
        // unit tests could not see and one run of the real screen showed immediately. A
        // clause whose count is zero is not shown at all — "0 facts" is a sentence about
        // nothing — and each names the person, so either can stand on its own.
        remove: {
            action: 'Remove this person from the journal',
            title: 'Remove this person from the journal',
            facts: {
                one: '{count} fact kept about {name} goes.',
                many: '{count} facts kept about {name} go.'
            },
            mentions: {
                one: '{count} entry stops being linked to {name}.',
                many: '{count} entries stop being linked to {name}.'
            },
            stays: 'The entries themselves stay, with the name as it was said on the day.',
            confirm: 'Remove',
            cancel: 'Keep them',
            error: 'Could not remove this person from the journal.'
        }
    },

    // The two navigations. The label is here rather than beside `Analysis` and `Vault` in
    // the nav files because it is the journal's word, and every word the journal says is
    // walked by the forbidden-word test.
    nav: {
        label: 'Journal',
        back: 'Back to the journal'
    }
};

/**
 * Fills `{placeholder}` slots in a copy string.
 *
 * A placeholder with no value is left standing rather than blanked, on the same rule as the
 * server's: never silently discard, and a visible `{count}` in a screenshot is a bug report
 * where an empty gap is a mystery (invariant 13).
 */
export const fillCopy = (template, values = {}) => (
    String(template).replace(/\{(\w+)\}/g, (placeholder, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
    ))
);

/**
 * A counted sentence, picking the singular or the plural template and filling `{count}`.
 *
 * The pair lives in `JOURNAL_COPY` rather than being assembled from a stem and an `s`, so
 * the forbidden-word walk reads both halves and a language whose plural is not a suffix is
 * a copy change rather than a code change. It carries the **whole clause, verb included**:
 * a template that ends before its verb cannot agree with its own number, which is how
 * *"1 entry stop being linked"* reached a running screen past a green suite.
 *
 * `values` fills whatever else the clause names — a person, usually. A missing template
 * returns an empty string rather than the word `undefined`, on `fillCopy`'s rule that a
 * visible bug beats a mysterious one — and an empty slot next to a name is the visible one.
 */
export const countCopy = (count, templates, values = {}) => {
    const chosen = count === 1 ? templates?.one : templates?.many;
    return chosen ? fillCopy(chosen, { ...values, count }) : '';
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/**
 * A duration in words, for the sentences that describe a rendering constant. The sibling of
 * `humanGap` in cadence.js: the app has one vocabulary for elapsed time, and half-hours are
 * the granularity these sentences are ever tuned at.
 */
export const humanMinutes = (minutes) => {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    if (total < 60) return `${total} minutes`;

    const halfHours = Math.round(total / 30);
    const hours = Math.floor(halfHours / 2);
    const half = halfHours % 2 === 1;

    if (hours === 1) return half ? 'an hour and a half' : 'an hour';
    const word = NUMBER_WORDS[hours] || String(hours);
    return half ? `${word} and a half hours` : `${word} hours`;
};

/* ------------------------------------------------------------------------------------ */
/* 5. Readers                                                                             */
/* ------------------------------------------------------------------------------------ */

/**
 * The version a payload declares. An absent `v` is version 1: the first writer wrote it,
 * and treating absence as unknown would make the oldest rows the unreadable ones.
 */
const versionOf = (payload) => {
    const declared = payload?.v;
    return Number.isFinite(declared) ? declared : PAYLOAD_VERSION;
};

const asString = (value) => (typeof value === 'string' ? value : null);
const asBool = (value) => (typeof value === 'boolean' ? value : null);
const asNumber = (value) => (Number.isFinite(value) ? value : null);
const asArray = (value) => (Array.isArray(value) ? value : []);

/**
 * One `about` target. Unknown kinds are kept whole rather than dropped — a newer client may
 * point a feeling at something this reader has never heard of, and losing it would lose the
 * only record that the user said it.
 */
const readAboutTarget = (target) => {
    if (!target || typeof target !== 'object') return null;
    switch (target.kind) {
        case 'person':
            return { kind: 'person', ref: asNumber(target.ref) };
        case 'tag':
            return { kind: 'tag', tag: asString(target.tag) };
        case 'trigger':
            return { kind: 'trigger', trigger: asString(target.trigger) };
        default:
            return { kind: asString(target.kind), raw: target };
    }
};

/**
 * One feeling on a check-in.
 *
 * `uncertain` is `true`, `false`, or `null` when the writer said nothing — absence is not
 * `false` here any more than it is in a ritual's answers (invariant 14). Only `true` draws
 * dashed, so the three behave identically on screen and the record stays honest about which
 * of them it holds. `intensity` is `null` when absent, never 0: a feeling with no strength
 * recorded is not a feeling of no strength.
 */
const readFeelingEntry = (feeling) => ({
    id: asString(feeling?.id),
    intensity: asNumber(feeling?.intensity),
    uncertain: asBool(feeling?.uncertain),
    about: asArray(feeling?.about).map(readAboutTarget).filter(Boolean)
});

/** The model's provenance block, present only when a model was consulted. */
const readProvenance = (proposal) => {
    if (!proposal || typeof proposal !== 'object') return null;

    const {
        model, runtime, prompt_version: promptVersion, proposed, accepted, replaced,
        dropped_by_filter: droppedByFilter, ambiguity, edited_transcript: editedTranscript,
        ...raw
    } = proposal;

    return {
        model: asString(model),
        runtime: asString(runtime),
        promptVersion: asNumber(promptVersion),
        proposed: asArray(proposed),
        accepted: asArray(accepted),
        replaced: replaced && typeof replaced === 'object' ? { ...replaced } : {},
        droppedByFilter: asNumber(droppedByFilter),
        ambiguity: asString(ambiguity),
        editedTranscript: asBool(editedTranscript),
        raw
    };
};

const readCheckinV1 = (payload) => {
    const {
        v, source, tz_offset_min: tzOffsetMin, transcript, transcript_kept: transcriptKept,
        language, feelings, tags, note, proposal,
        ...raw
    } = payload && typeof payload === 'object' ? payload : {};

    return {
        v: versionOf(payload),
        source: asString(source),
        tzOffsetMin: asNumber(tzOffsetMin),
        transcript: asString(transcript),
        transcriptKept: asBool(transcriptKept),
        language: asString(language),
        feelings: asArray(feelings).map(readFeelingEntry),
        tags: asArray(tags).filter(tag => typeof tag === 'string'),
        note: asString(note),
        provenance: readProvenance(proposal),
        // Keys this reader has never heard of, kept so a newer writer's field survives a
        // round trip through an older screen. `v` is excluded because it is read above.
        raw
    };
};

/**
 * Reads a `kind: "checkin"` payload into the shape screens and the day graph use.
 *
 * The switch is the extension seam §6.4 describes: a v2 gets its own branch. Until one
 * exists, a payload declaring a higher version is read with the v1 rules rather than
 * dropped — a row that reads as nothing disappears from the day it belongs to, and a
 * partly-read one at least still shows what the user said.
 */
export const readCheckin = (payload) => {
    switch (versionOf(payload)) {
        case 1:
        default:
            return readCheckinV1(payload);
    }
};

const readRitualV1 = (payload) => {
    const {
        v, question_set: questionSet, answers, day_word: dayWord,
        rollover_hour: rolloverHour, duration_ms: durationMs,
        ...raw
    } = payload && typeof payload === 'object' ? payload : {};

    const asked = asArray(questionSet?.asked).filter(id => typeof id === 'string');

    // Every key the writer put here is an answer, whatever it says. A key that is not here
    // was skipped. This reader never invents a key and never turns an absent one into
    // `false` — that is invariant 14 applied to questions, and it is the difference between
    // "I did not sleep well" and "I did not answer".
    const stored = answers && typeof answers === 'object' ? answers : {};
    const readAnswers = {};
    Object.keys(stored).forEach(id => { readAnswers[id] = stored[id]; });

    return {
        v: versionOf(payload),
        questionSetVersion: asNumber(questionSet?.version),
        asked,
        answers: readAnswers,
        // asked − keys(answers). A question never shown is in neither list, which is what
        // `asked` exists to record: only the row can tell "not asked" from "not answered".
        skipped: asked.filter(id => !Object.prototype.hasOwnProperty.call(readAnswers, id)),
        dayWord: dayWord && typeof dayWord === 'object'
            ? { id: asString(dayWord.id), uncertain: asBool(dayWord.uncertain) }
            : null,
        rolloverHour: asNumber(rolloverHour),
        durationMs: asNumber(durationMs),
        raw
    };
};

/** Reads a `kind: "ritual"` payload. See `readCheckin` for why the switch looks like this. */
export const readRitual = (payload) => {
    switch (versionOf(payload)) {
        case 1:
        default:
            return readRitualV1(payload);
    }
};

/** Reads a `kind: "person_fact"` payload — the one entry kind whose text is about someone else. */
export const readPersonFact = (payload) => {
    const {
        v, text, source, from_entry_client_id: fromEntryClientId,
        ...raw
    } = payload && typeof payload === 'object' ? payload : {};

    switch (versionOf(payload)) {
        case 1:
        default:
            return {
                v: versionOf(payload),
                text: asString(text),
                source: asString(source),
                fromEntryClientId: asString(fromEntryClientId),
                raw
            };
    }
};

/* ------------------------------------------------------------------------------------ */
/* 5b. Triggers, and the chain a reader has to resolve                                    */
/* ------------------------------------------------------------------------------------ */

/**
 * How a trigger keeps its identity across a correction, decided here because A2 and A3 both
 * left it open.
 *
 * A trigger's identity is its `client_id` and a check-in references it by that id. But a
 * rename or a merge is a **correction row**, and a correction row needs a new `client_id`
 * of its own — client ids are unique per user, so it cannot reuse the one it replaces. The
 * row-level link is `supersedes_id`, a database row id the client never sees, because
 * `GET /api/journal/entries` only ever returns rows with `superseded_at IS NULL`. So the
 * correction payload carries the client's own name for the same link: `corrects`, **every**
 * `client_id` this trigger has been referenced by before this row.
 *
 * It is a list rather than a single predecessor, and that is not tidiness. Rename twice and
 * the middle row is superseded too, so it is in no list the client holds — a reader walking
 * one hop at a time would find the second id and then hit a gap, and every check-in written
 * before the first rename would resolve to nothing. Each correction carries its
 * predecessor's list plus the predecessor's own id, which is one map lookup at read time and
 * a handful of ids on a row that changes about as often as a person gets renamed. A bare
 * string is read as a one-element list, because the first rename is the common case.
 *
 * That fixes the two halves in opposite directions, which is the point:
 *
 * - **The writer never resolves.** A new check-in must reference a *live* trigger id, and
 *   the server's check (`superseded_at IS NULL`) stays exactly as A2 wrote it. It cannot
 *   be tripped by accident, because `triggerCandidates` is only ever shown live triggers —
 *   there is no path through the UI to a dead id. Loosening that check would let a
 *   merged-away trigger keep collecting entries.
 * - **Readers resolve.** Every check-in already written still points at whatever id was
 *   live the day it was made, and `readTrigger` walks that id forward to the trigger that
 *   speaks for it now.
 *
 * `corrects` is absent on every row written before this decision, and absence reads as "this
 * row speaks only for itself" — which is what §6.4 means by a field readers can treat as
 * unknown, and why it needs no payload version bump.
 */
const triggerIdentity = (entry) => asString(entry?.client_id ?? entry?.clientId);

const triggerPayload = (entry) => (entry?.payload && typeof entry.payload === 'object' ? entry.payload : {});

/** The ids a correction row speaks for besides its own. A bare string reads as one id. */
const correctedIds = (entry) => {
    const declared = triggerPayload(entry).corrects;
    if (typeof declared === 'string') return [declared];
    return asArray(declared).filter(id => typeof id === 'string');
};

/**
 * Indexes trigger entries by every client id they speak for: their own, and every id they
 * declare they correct. **Never cached on the module** — a stale index would answer with a
 * label that no longer exists, quietly, which is worse than slowly.
 *
 * Exported so a caller with many ids to resolve can build it once and hand it to
 * `readTrigger` instead of the array. `JournalContext` does exactly that, memoised on
 * `triggerEntries`, which ties the index's lifetime to the rows it was built from and keeps
 * the "never stale" rule without paying for it per call.
 *
 * A row's own id always wins over another row's claim to correct it, so a live trigger can
 * never be shadowed by a stale pointer.
 */
export const indexTriggers = (allTriggerEntries) => {
    const rows = asArray(allTriggerEntries).filter(entry => triggerIdentity(entry));
    const speaksFor = new Map();

    rows.forEach(entry => {
        correctedIds(entry).forEach(id => {
            if (!speaksFor.has(id)) speaksFor.set(id, entry);
        });
    });
    rows.forEach(entry => speaksFor.set(triggerIdentity(entry), entry));

    return speaksFor;
};

/**
 * The live state of one trigger.
 *
 * Takes either a trigger entry or a bare `client_id` — a check-in's `about` carries the id,
 * and the triggers view carries the row, and both want the same answer.
 *
 * Returns the label that is current for that id and, when the trigger has been merged away,
 * the surviving trigger's `client_id`. A merge chain is followed to its end (`a → b → c`
 * answers `c`) and it is cycle-safe: a row that names itself, or a pair that name each
 * other, stops at the last id it could resolve rather than looping. That is not a
 * hypothetical — merging is one-way and a user with two triggers can reach the dialog from
 * either side.
 */
export const readTrigger = (entry, allTriggerEntries = []) => {
    // Either the rows or an index already built from them (`indexTriggers`). Callers that
    // resolve many ids against one vocabulary — the triggers view resolves every reference in
    // the history against every trigger — must pass the index, or this rebuilds it per call
    // and the walk over N check-ins for T triggers costs N×T index builds. Passing the array
    // stays supported because most callers resolve exactly one id.
    const speaksFor = allTriggerEntries instanceof Map
        ? allTriggerEntries
        : indexTriggers(allTriggerEntries);
    const startId = typeof entry === 'string' ? entry : triggerIdentity(entry);

    const resolve = (id) => speaksFor.get(id) || (triggerIdentity(entry) === id ? entry : null);

    let currentId = startId;
    let current = resolve(currentId) || (typeof entry === 'object' ? entry : null);
    let mergedInto = null;
    const seen = new Set();

    while (currentId && !seen.has(currentId)) {
        seen.add(currentId);

        const row = resolve(currentId);
        // A link the client cannot see — the survivor was deleted, or the range loaded does
        // not reach it — keeps the last label this walk found rather than blanking it, and
        // still reports the merge the payload recorded.
        if (row) current = row;

        const next = asString(triggerPayload(row).merged_into);
        if (!next || seen.has(next)) break;

        mergedInto = next;
        currentId = next;
    }

    const payload = triggerPayload(current);

    return {
        // The id that was asked about.
        clientId: startId,
        // The label that is current for it.
        label: asString(payload.label),
        // The surviving trigger as the payload named it, when this id has been merged away;
        // null when it has not.
        mergedInto,
        // The id a new check-in must reference: the client_id of the row that is live at the
        // end of the walk. It is not always `mergedInto` — the survivor may itself have been
        // renamed since, and a rename mints a new client_id. Equal to clientId when nothing
        // has moved.
        live: triggerIdentity(current) || mergedInto || startId,
        merged: mergedInto !== null,
        corrects: correctedIds(current),
        createdFrom: asString(payload.created_from),
        v: versionOf(payload),
        raw: current || null
    };
};

/** The triggers the UI may offer: live rows that have not been merged away. */
export const activeTriggers = (allTriggerEntries = []) => (
    asArray(allTriggerEntries).filter(entry => (
        triggerIdentity(entry) && !asString(triggerPayload(entry).merged_into)
    ))
);

/* ------------------------------------------------------------------------------------ */
/* 5c. The two corrections the trigger vocabulary needs                                   */
/* ------------------------------------------------------------------------------------ */

/**
 * Both corrections are the **same** write: a new `kind: "trigger"` row with `supersedes_id`
 * pointing at the row it replaces (§7.1). There is no rename endpoint and no merge endpoint
 * and there is not going to be one — a journal row is a statement made at a moment, so
 * changing it is a new statement, and giving the vocabulary its own verbs would be a second
 * way to write history that the export, the import and `readTrigger` would all have to learn.
 *
 * The two differ in one key: a rename carries a new `label`, and a merge carries
 * `merged_into`. Everything else — the new `client_id`, the `corrects` list that lets a
 * check-in written before the correction still resolve, the `created_from` the row was born
 * with — is shared, which is why it is built once here.
 */
const correctionBase = (trigger, now) => {
    // `raw` is the row that answered for the id, which is the row a correction supersedes.
    // Taking the id from the row rather than from what was asked about matters after a
    // rename: `clientId` is what the caller looked up, and `raw.client_id` is what is live.
    const row = trigger?.raw ?? null;
    const identity = asString(row?.client_id ?? row?.clientId) ?? asString(trigger?.clientId);

    return {
        client_id: clientId(),
        kind: 'trigger',
        at: rfc3339Local(now),
        day: civilDay(now, DAY_ROLLOVER_HOUR),
        schema_version: 1,
        payload: {
            v: PAYLOAD_VERSION,
            // Its predecessor's list plus its predecessor's own id, deduped and in order.
            // One hop would be enough for one rename and wrong for two — see `readTrigger`.
            corrects: [...new Set([...asArray(trigger?.corrects).filter(id => typeof id === 'string'), identity].filter(Boolean))],
            // Carried rather than re-derived: it records the check-in this trigger was first
            // confirmed in, and a correction is not a new birth.
            created_from: asString(trigger?.createdFrom)
        },
        mentions: [],
        triggers: [],
        // The row-level link. A database id, which is the one thing about a trigger the
        // client does not mint — it comes back on the row `GET /api/journal/entries` served.
        supersedes_id: row?.ID ?? null
    };
};

/**
 * Rename: the same trigger, said differently. Everything already written keeps pointing at
 * the id it was written with, and `readTrigger` walks it forward to this row.
 */
export const renameTriggerRequest = ({ trigger, label, now = new Date() }) => {
    const request = correctionBase(trigger, now);
    request.payload.label = String(label ?? '').trim();
    request.payload.merged_into = null;
    return request;
};

/**
 * Merge: this trigger stops being one, and every reader resolves its id to `into` from now
 * on. One-way, and the dialog says so — there is no row that could undo it, because undoing
 * would mean deciding which of the merged entries had belonged to which trigger, and nothing
 * stored knows that.
 *
 * The label is carried unchanged. The server requires one on every trigger row (§6.5), and
 * inventing a new one here would quietly rename a trigger the user only asked to merge.
 */
export const mergeTriggerRequest = ({ trigger, into, now = new Date() }) => {
    const request = correctionBase(trigger, now);
    request.payload.label = asString(trigger?.label) ?? '';
    // `live`, not `clientId`: the survivor may itself have been renamed since, and a merge
    // into a superseded id is a 400 the user would have no way to read.
    request.payload.merged_into = asString(into?.live ?? into?.clientId ?? into) ?? null;
    return request;
};

/* ------------------------------------------------------------------------------------ */
/* 5d. What the journal knows about one person, and about one trigger                     */
/* ------------------------------------------------------------------------------------ */

/**
 * The two feelings most often attached to something, in `summarizeStack`'s pattern: sort by
 * the count, break the tie on the order the vocabulary is laid out in, and stop at two.
 *
 * The tie-break is the part that matters. Two feelings attached the same number of times is
 * the common case on a short history, and without a fixed order the row would name a
 * different pair on every render — which reads as the app changing its mind about the user.
 * `FEELINGS` order is the taxonomy order, the same rôle `CATEGORIES.indexOf` plays there.
 *
 * An id this build has never heard of keeps its id as its label rather than disappearing,
 * for the reason `FeelingChip` does: a retired or newer feeling is still one somebody
 * recorded. Its sort position is after every known one, and then alphabetical, so even that
 * case is deterministic.
 */
export const topFeelings = (counts, limit = 2) => {
    const order = new Map(FEELINGS.map((feeling, index) => [feeling.id, index]));
    const pairs = counts instanceof Map ? [...counts.entries()] : Object.entries(counts || {});

    return pairs
        .filter(([id, count]) => typeof id === 'string' && count > 0)
        .sort(([aId, aCount], [bId, bCount]) => (
            (bCount - aCount)
            || ((order.get(aId) ?? FEELINGS.length) - (order.get(bId) ?? FEELINGS.length))
            || aId.localeCompare(bId)
        ))
        .slice(0, Math.max(0, limit))
        .map(([id, count]) => ({ id, count, label: feelingById(id)?.label ?? id }));
};

const bump = (counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1);

/**
 * Everything the People views show about one person, from the entries already loaded.
 *
 * It reads `entries` rather than the day counts, on purpose. `/api/journal/days` is a
 * grouped count that a write since the last fetch has not reached, and these are the first
 * screens in the journal that render a *number* rather than a mark — a stale one here would
 * put a wrong figure inside the sentence the remove dialog states as a fact.
 *
 * `facts` and `mentions` are disjoint, and the remove dialog's two numbers are exactly these
 * two lengths: the facts are soft-deleted whole, and the mentions on everything else are
 * detached from the person while the entry itself stays. Nothing is counted twice.
 */
export const summarizePerson = (entries, relationshipId) => {
    const id = Number(relationshipId);
    const naming = asArray(entries).filter(entry => (
        asArray(entry?.mentions).some(mention => mention?.relationship_id === id)
    ));

    const counts = new Map();
    naming.forEach(entry => {
        if (entry.kind !== 'checkin') return;
        // Which `about.ref`s point at this person on this entry. A feeling reaches a person
        // through the mention's position, never through a name (invariant 2a).
        const refs = new Set(
            asArray(entry.mentions).filter(mention => mention?.relationship_id === id).map(mention => mention.ref)
        );
        readCheckin(entry.payload).feelings.forEach(feeling => {
            if (!feeling.id) return;
            if (feeling.about.some(about => about.kind === 'person' && refs.has(about.ref))) bump(counts, feeling.id);
        });
    });

    return {
        // Newest first, the order the detail screen reads in — the opposite of the server's,
        // which is oldest-first because the day graph reads left to right.
        entries: [...naming].reverse(),
        facts: naming.filter(entry => entry.kind === 'person_fact').reverse(),
        mentions: naming.filter(entry => entry.kind !== 'person_fact').reverse(),
        count: naming.length,
        feelings: topFeelings(counts)
    };
};

/**
 * The same for one trigger, resolved through the merge chain.
 *
 * `resolve` maps a referenced id to the id that is live now — the provider's
 * `resolveTrigger`, or anything with the same contract. It is a parameter rather than a
 * `readTrigger` call inside the loop because the vocabulary is one index and this walks
 * every check-in in the history: building that index per reference is the difference between
 * one pass and a quadratic one.
 *
 * A check-in that names the same trigger from two feelings is **one** entry and two counted
 * feelings, which is what the row's two numbers mean.
 */
export const summarizeTrigger = (entries, liveId, resolve = (id) => id) => {
    const naming = [];
    const counts = new Map();

    asArray(entries).forEach(entry => {
        if (entry?.kind !== 'checkin') return;

        let named = false;
        readCheckin(entry.payload).feelings.forEach(feeling => {
            const hit = feeling.about.some(about => (
                about.kind === 'trigger' && about.trigger && resolve(about.trigger) === liveId
            ));
            if (!hit) return;
            named = true;
            if (feeling.id) bump(counts, feeling.id);
        });

        if (named) naming.push(entry);
    });

    return {
        entries: naming.reverse(),
        count: naming.length,
        feelings: topFeelings(counts)
    };
};

/* ------------------------------------------------------------------------------------ */
/* 6. Day arithmetic                                                                      */
/* ------------------------------------------------------------------------------------ */

const pad2 = (value) => String(value).padStart(2, '0');

/** Strictly YYYY-MM-DD, and a day that exists — the same round trip the server does. */
export const isDayString = (day) => {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const [year, month, date] = day.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, date));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === date;
};

/**
 * Which civil day an instant belongs to, local, with the rollover applied.
 *
 * The shift is a calendar operation, not four hours of milliseconds, and that is the whole
 * trick: on the morning the clocks go forward, a check-in at 04:30 local is 02:30 UTC, and
 * subtracting four hours from the instant lands on the previous evening and answers with
 * yesterday. Moving the *date* field and leaving the clock alone is correct on a 23-hour
 * day, a 25-hour day and an ordinary one, and it is correct across a month and a year
 * boundary for free.
 */
export const civilDay = (date = new Date(), rolloverHour = DAY_ROLLOVER_HOUR) => {
    const instant = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(instant.getTime())) return null;

    const local = new Date(instant.getTime());
    if (local.getHours() < rolloverHour) {
        local.setDate(local.getDate() - 1);
    }

    return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-${pad2(local.getDate())}`;
};

/** The route for one day, or the journal root when the day is not a day. */
export const journalDayPath = (day) => (isDayString(day) ? `${JOURNAL_ROOT}/${day}` : JOURNAL_ROOT);

/**
 * The day `delta` days away from `day`, as a day string. What prev/next in the day header
 * walk with, so a month or a year boundary is one subtraction rather than a special case.
 *
 * UTC, for `dayRange`'s reason: a day string carries no offset, so there is nothing local
 * about the arithmetic and nothing for DST to shorten. `civilDay` is the other half of that
 * rule and is deliberately the opposite.
 */
export const shiftDay = (day, delta = 0) => {
    if (!isDayString(day)) return null;

    const moved = new Date(Date.parse(`${day}T00:00:00Z`) + Math.trunc(Number(delta) || 0) * 86400000);
    if (Number.isNaN(moved.getTime())) return null;

    return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
};

/**
 * The first and last day of the month `day` falls in — the range the month strip draws and
 * the window the provider loads.
 *
 * `Date.UTC(year, month, 0)` is the last day of `month` counting from one, which is the one
 * place where the month being one-based reads as an advantage rather than a trap.
 */
export const monthBounds = (day) => {
    if (!isDayString(day)) return null;

    const [year, month] = day.split('-').map(Number);
    const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
        from: `${year}-${pad2(month)}-01`,
        to: `${year}-${pad2(month)}-${pad2(lastDate)}`
    };
};

/**
 * The clock time of an instant, local, `HH:MM`.
 *
 * Deliberately not `toLocaleTimeString`: the entry list puts this beside a date the browser
 * *does* localise, and a 12-hour clock with an am/pm marker is twice as wide for a line that
 * has to fit beside a row of chips on a 360 dp screen. `null` in, `null` out — and `null`
 * is checked before `new Date`, because `new Date(null)` is the epoch rather than an
 * invalid date and would print a plausible, wrong time.
 */
export const timeOfDay = (at) => {
    if (at === null || at === undefined || at === '') return null;

    const instant = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(instant.getTime())) return null;

    return `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`;
};

/** `HH:MM`, 24-hour, as the ritual's time setting stores it and `<input type="time">` uses it. */
export const isClockTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));

/**
 * How far into the civil day a local wall-clock time sits, in minutes.
 *
 * The civil day starts at `DAY_ROLLOVER_HOUR`, so 22:30 is 1110 minutes into it and 01:00 —
 * which belongs to the *same* civil day — is 1260, not 60. Doing the arithmetic in this
 * frame is what makes "has the ritual's hour arrived?" a single comparison that stays right
 * across midnight, rather than two cases and an off-by-one at 04:00.
 */
export const minutesIntoCivilDay = (value, rolloverHour = DAY_ROLLOVER_HOUR) => {
    const [hours, minutes] = value instanceof Date
        ? [value.getHours(), value.getMinutes()]
        : String(value ?? '').split(':').map(Number);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    const DAY_MINUTES = 24 * 60;
    return (((hours - rolloverHour) * 60 + minutes) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
};

/**
 * Whether the ritual's chosen hour has arrived within the civil day `now` falls in.
 *
 * It stays true until the rollover rather than until midnight, because §3.6 says the ritual
 * can be started late and records the day it is *about*. At 01:00 the questions for the day
 * that has not been slept off yet are still tonight's.
 */
export const ritualTimeReached = (time, now = new Date(), rolloverHour = DAY_ROLLOVER_HOUR) => {
    if (!isClockTime(time)) return false;

    const chosen = minutesIntoCivilDay(time, rolloverHour);
    const current = minutesIntoCivilDay(now, rolloverHour);
    return chosen !== null && current !== null && current >= chosen;
};

/**
 * The device's offset from UTC at an instant, in minutes east of Greenwich.
 *
 * `getTimezoneOffset` counts the other way — minutes to *add* to local time to reach UTC —
 * so Berlin in summer reports −120 and the value `tz_offset_min` wants is +120. The sign
 * flip is the whole function, and it lives here rather than in a component because getting
 * it backwards writes a record that reconstructs to the wrong local time and reads as
 * plausible for every user east of Greenwich.
 */
export const tzOffsetMinutes = (date = new Date()) => {
    const instant = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(instant.getTime())) return null;
    return -instant.getTimezoneOffset();
};

/**
 * An instant as RFC 3339 **with the local offset**, which is what `at` must carry (§7.2).
 *
 * Deliberately not `toISOString()`: that answers in UTC with a `Z`, and while the server
 * stores UTC either way, the offset is the only thing that says what o'clock it was where
 * the user was standing. `tz_offset_min` carries the same fact and the two are written
 * from the same call, so they cannot disagree.
 */
export const rfc3339Local = (date = new Date()) => {
    const instant = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(instant.getTime())) return null;

    const offset = tzOffsetMinutes(instant);
    const sign = offset < 0 ? '-' : '+';
    const magnitude = Math.abs(offset);

    const calendar = `${instant.getFullYear()}-${pad2(instant.getMonth() + 1)}-${pad2(instant.getDate())}`;
    const clock = `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}:${pad2(instant.getSeconds())}`;

    return `${calendar}T${clock}${sign}${pad2(Math.floor(magnitude / 60))}:${pad2(magnitude % 60)}`;
};

/** How many days a single range may span, so a bad `from` cannot build an endless array. */
const MAX_RANGE_DAYS = 3660;

/**
 * Every civil day from `from` to `to`, inclusive.
 *
 * Both ends are day strings with no time in them, so the arithmetic runs in UTC: a day
 * string has no offset to lose and UTC has no DST to trip over. This is the one place where
 * *not* using local time is the correct answer, and `civilDay` above is the other half of
 * the same rule.
 */
export const dayRange = (from, to) => {
    if (!isDayString(from) || !isDayString(to)) return [];

    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];

    const days = [];
    for (let time = start; time <= end && days.length < MAX_RANGE_DAYS; time += 86400000) {
        const day = new Date(time);
        days.push(`${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`);
    }
    return days;
};

/* ------------------------------------------------------------------------------------ */
/* 7. Candidate matching                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * Lower-cased and stripped of diacritics, so *José* and *Jose* are the same query. Both
 * sides are folded — a user who typed the accent and a user who did not are looking for the
 * same person.
 */
const fold = (value) => (
    String(value ?? '')
        .trim()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
);

/**
 * True when `text` starts with `prefix` and stops there or at a word boundary. *Lucie*
 * matches *Lucie M*; *Luc* does not match *Lucie*. A partial word is a typo far more often
 * than it is a person, and a wrong suggestion beside a name costs more than a missing one.
 */
const isTokenPrefix = (text, prefix) => (
    prefix.length > 0
    && text.startsWith(prefix)
    && (text.length === prefix.length || /[\s\-'.]/.test(text[prefix.length]))
);

/** No suggestion list is ever longer than this. Three fit under a field; a fourth is a menu. */
export const MAX_CANDIDATES = 3;

/**
 * Who the user might have meant, for a name the model heard or the user typed.
 *
 * **Suggestion only.** Nothing here selects anything: the return value goes to a picker and
 * a person becomes a `relationship_id` when the user taps one (invariant 15). The rules are
 * §4.5's, in order:
 *
 * 1. Exact after trim → resolved, and returned **alone**. That is the same comparison
 *    `database.FindOrCreateRelationship` makes, so what the card shows as a match is what
 *    the server would have done anyway; offering alternatives beside it would invite the
 *    user to pick something the server would not have picked.
 * 2. Otherwise case- and diacritic-insensitive equality, then prefix/first-token match,
 *    capped at three.
 * 3. Otherwise nothing, and the card offers a new person.
 *
 * An empty name returns nothing: there is no such thing as a candidate for silence.
 */
export const personCandidates = (name, relationships = []) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return [];

    const rows = asArray(relationships).filter(person => typeof person?.name === 'string');

    const candidate = (person, match) => ({
        relationship: person,
        relationshipId: person.ID,
        name: person.name,
        exact: match === 'exact',
        match
    });

    const exact = rows.find(person => person.name.trim() === trimmed);
    if (exact) return [candidate(exact, 'exact')];

    const query = fold(trimmed);
    const insensitive = rows.filter(person => fold(person.name) === query);
    const prefix = rows.filter(person => {
        const folded = fold(person.name);
        if (folded === query) return false;
        return isTokenPrefix(folded, query) || isTokenPrefix(query, folded);
    });

    return [
        ...insensitive.map(person => candidate(person, 'insensitive')),
        ...prefix.map(person => candidate(person, 'prefix'))
    ].slice(0, MAX_CANDIDATES);
};

/**
 * The same idea for triggers, **without the prefix rule** (§4.5b).
 *
 * *Arbeit* and *arbeit* are one trigger. *work* and *Arbeit* are not — not until the
 * embedding index in §5.8 can say they are close and the user agrees. A prefix rule here
 * would quietly merge *work* into *workshop*, and a trigger is a grouping key: a wrong
 * merge is not a wrong suggestion, it is a wrong answer to every question asked afterwards.
 *
 * Accepts trigger entries or plain `{ client_id, label }` rows, and is suggestion only.
 */
export const triggerCandidates = (label, triggers = []) => {
    const trimmed = String(label ?? '').trim();
    if (!trimmed) return [];

    const rows = asArray(triggers)
        .map(trigger => ({
            trigger,
            clientId: triggerIdentity(trigger),
            label: asString(trigger?.label) ?? asString(triggerPayload(trigger).label)
        }))
        .filter(row => typeof row.label === 'string' && row.label.trim());

    const candidate = (row, match) => ({ ...row, exact: match === 'exact', match });

    const exact = rows.find(row => row.label.trim() === trimmed);
    if (exact) return [candidate(exact, 'exact')];

    const query = fold(trimmed);
    return rows
        .filter(row => fold(row.label) === query)
        .map(row => candidate(row, 'insensitive'))
        .slice(0, MAX_CANDIDATES);
};

/* ------------------------------------------------------------------------------------ */
/* 8. Client ids                                                                          */
/* ------------------------------------------------------------------------------------ */

/**
 * A UUID v4, minted here before the entry is ever sent.
 *
 * It is what makes a retried POST idempotent, which is what makes the outbox in §9.5 safe:
 * the same entry posted twice produces one row, so a queue can retry without inventing
 * duplicates.
 *
 * `crypto.randomUUID` is the implementation, and the fallback is not theoretical. It exists
 * only in a **secure context**, and this app is self-hosted: reached over plain `http://` on
 * a home network — which is how a self-hosted install is most often reached — the method is
 * simply undefined, and so is it in older Android WebViews behind the Capacitor shell. The
 * fallback uses `crypto.getRandomValues` where that exists and `Math.random` only where
 * neither does. A `Math.random` id is fine for this job: it identifies a row within one
 * user's account, it is never a secret, and it is never used for anything but matching a
 * retry to the row it already wrote.
 */
export const clientId = () => {
    const source = globalThis.crypto;

    if (source && typeof source.randomUUID === 'function') {
        return source.randomUUID();
    }

    const bytes = new Uint8Array(16);
    if (source && typeof source.getRandomValues === 'function') {
        source.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }

    // Version 4, variant 1, as RFC 4122 lays them out.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
