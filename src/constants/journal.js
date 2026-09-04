import { MAX_TAG_LENGTH } from './contextTags';

/* 1. Feelings */

/**
 * The coarse families the Insights radar sums a feeling into — Plutchik's seven, plus `quiet`
 * for the low-energy entries that are a report of not much rather than of any one of them.
 * `unclear` belongs to none: "can't tell" is not a share of anything.
 */
export const FEELING_FAMILIES = ['joy', 'trust', 'anticipation', 'fear', 'sadness', 'disgust', 'anger', 'quiet'];

/**
 * Every entry sits on three axes. `valence` (−1 unpleasant … +1 pleasant) and `energy`
 * (0 still … 1 activated) are the day graph's two (§8.1); `dominance` (−1 overwhelmed …
 * +1 in control) is the third the drift maths reads, brought in with the EmotionGuesser
 * integration. All three are fixed lookups from the id, so a label and its coordinates can
 * never disagree — and, like the other two, **do not retune one once data exists**, or old
 * entries silently move.
 */
export const FEELINGS = [
    { id: 'joy', label: 'joy', gloss: 'lit up, and wholly pleasant', valence: 0.8, energy: 0.7, dominance: 0.55, family: 'joy', hex: '#fbbf24' },
    { id: 'excitement', label: 'excitement', gloss: 'keyed up, something coming', valence: 0.6, energy: 0.9, dominance: 0.45, family: 'anticipation', hex: '#fb923c' },
    { id: 'pleasure', label: 'pleasure', gloss: 'this is nice, right now', valence: 0.7, energy: 0.5, dominance: 0.45, family: 'joy', hex: '#f472b6' },
    // "rapport" as the id, "connectedness" in the copy: the id is permanent and the label
    // is not, so the word that reads best on a chip can change without moving any data.
    { id: 'rapport', label: 'connectedness', gloss: 'close to someone, in step', valence: 0.7, energy: 0.4, dominance: 0.3, family: 'trust', hex: '#fb7185' },
    { id: 'gratitude', label: 'gratitude', gloss: 'glad something was given', valence: 0.6, energy: 0.3, dominance: 0.2, family: 'trust', hex: '#34d399' },
    { id: 'pride', label: 'pride', gloss: 'this one was yours to do', valence: 0.6, energy: 0.6, dominance: 0.8, family: 'joy', hex: '#a3e635' },
    { id: 'curiosity', label: 'curiosity', gloss: 'pulled toward finding out', valence: 0.4, energy: 0.6, dominance: 0.4, family: 'anticipation', hex: '#22d3ee' },
    { id: 'calm', label: 'calm', gloss: 'settled, nothing pressing', valence: 0.5, energy: 0.2, dominance: 0.35, family: 'joy', hex: '#2dd4bf' },
    { id: 'neutral', label: 'level', gloss: 'nothing in particular', valence: 0.0, energy: 0.3, dominance: 0.0, family: 'quiet', hex: '#94a3b8' },
    { id: 'unclear', label: "can't tell", gloss: 'something is there, and it has no name yet', valence: 0.0, energy: 0.4, dominance: 0.0, family: null, hex: '#a1a1aa' },
    { id: 'tiredness', label: 'tiredness', gloss: 'run down, low on fuel', valence: -0.2, energy: 0.1, dominance: -0.4, family: 'quiet', hex: '#38bdf8' },
    { id: 'boredom', label: 'boredom', gloss: 'nothing here holds you', valence: -0.3, energy: 0.2, dominance: -0.1, family: 'quiet', hex: '#60a5fa' },
    { id: 'longing', label: 'longing', gloss: 'reaching for what is not here', valence: -0.2, energy: 0.5, dominance: -0.35, family: 'sadness', hex: '#a78bfa' },
    { id: 'loneliness', label: 'loneliness', gloss: 'apart from people, and feeling it', valence: -0.6, energy: 0.3, dominance: -0.5, family: 'sadness', hex: '#818cf8' },
    { id: 'sadness', label: 'sadness', gloss: 'heavy, and slow', valence: -0.7, energy: 0.2, dominance: -0.55, family: 'sadness', hex: '#6366f1' },
    { id: 'shame', label: 'shame', gloss: 'wanting to be unseen', valence: -0.7, energy: 0.5, dominance: -0.7, family: 'sadness', hex: '#e879f9' },
    { id: 'irritation', label: 'irritation', gloss: 'rubbed the wrong way', valence: -0.4, energy: 0.6, dominance: 0.35, family: 'anger', hex: '#f97316' },
    { id: 'stress', label: 'stress', gloss: 'too much at once, and pressing', valence: -0.5, energy: 0.8, dominance: -0.45, family: 'fear', hex: '#f43f5e' },
    { id: 'anxiety', label: 'anxiety', gloss: 'braced for something', valence: -0.6, energy: 0.8, dominance: -0.6, family: 'fear', hex: '#a855f7' },
    { id: 'overwhelm', label: 'overwhelm', gloss: 'more than can be held', valence: -0.5, energy: 0.9, dominance: -0.75, family: 'fear', hex: '#d946ef' },
    { id: 'anger', label: 'anger', gloss: 'hot, and pushed against', valence: -0.7, energy: 0.9, dominance: 0.45, family: 'anger', hex: '#ef4444' },
    // The nine below arrived with the EmotionGuesser integration (2026-09-04): the Geneva
    // Emotion Wheel families the list above had no word for. Appended, never inserted — the
    // order is the tie-break `topFeelings` and the day graph read, and a retired id would
    // stay in place for the same reason.
    { id: 'amusement', label: 'amusement', gloss: 'entertained, close to laughing', valence: 0.75, energy: 0.7, dominance: 0.4, family: 'joy', hex: '#fde047' },
    { id: 'affection', label: 'affection', gloss: 'warmth toward someone, tenderness', valence: 0.8, energy: 0.45, dominance: 0.3, family: 'trust', hex: '#f9a8d4' },
    { id: 'admiration', label: 'admiration', gloss: 'impressed by someone', valence: 0.65, energy: 0.55, dominance: 0.05, family: 'trust', hex: '#5eead4' },
    { id: 'relief', label: 'relief', gloss: 'a tension gone, a worry lifted', valence: 0.6, energy: 0.3, dominance: 0.25, family: 'joy', hex: '#86efac' },
    { id: 'compassion', label: 'compassion', gloss: 'moved by what someone else is going through', valence: 0.35, energy: 0.4, dominance: 0.2, family: 'trust', hex: '#a7f3d0' },
    { id: 'regret', label: 'regret', gloss: 'wishing it had gone another way', valence: -0.55, energy: 0.35, dominance: -0.4, family: 'sadness', hex: '#7c3aed' },
    { id: 'disappointment', label: 'disappointment', gloss: 'let down, an expectation not met', valence: -0.6, energy: 0.35, dominance: -0.35, family: 'sadness', hex: '#4f46e5' },
    { id: 'disgust', label: 'disgust', gloss: 'repelled, wanting distance from it', valence: -0.7, energy: 0.65, dominance: 0.15, family: 'disgust', hex: '#65a30d' },
    { id: 'contempt', label: 'contempt', gloss: 'looking down on someone or something', valence: -0.55, energy: 0.55, dominance: 0.6, family: 'disgust', hex: '#9f1239' }
];

/** A feeling's three coordinates, as the drift maths reads them. `null` for an id it does not know. */
export const feelingCoordinates = (id) => {
    const known = FEELINGS.find(feeling => feeling.id === id);
    return known ? { valence: known.valence, energy: known.energy, dominance: known.dominance } : null;
};

/** The feeling the graph draws dashed alongside anything the user marked uncertain. */
export const UNCLEAR_FEELING_ID = 'unclear';

/** Feelings the UI offers. A retired id stays readable and stops being offered. */
export const activeFeelings = () => FEELINGS.filter(feeling => !feeling.retired);

/** One feeling by id, or null. Never invents an entry for an id it does not know. */
export const feelingById = (id) => FEELINGS.find(feeling => feeling.id === id) || null;

/* 2. The nightly ritual's questions */

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

export const ritualDeck = (enabledOptionalIds = []) => {
    const wanted = new Set(Array.isArray(enabledOptionalIds) ? enabledOptionalIds : []);
    const tail = optionalQuestions()
        .filter(question => wanted.has(question.id))
        .slice(0, MAX_OPTIONAL_QUESTIONS);

    return [...coreQuestions(), ...tail];
};

export const RITUAL_QUESTION_SET_VERSION = 1;

/* 3. Limits and other constants */

/** The entry kinds. Matches `domain.JournalKinds`; a new kind is how the journal extends. */
export const ENTRY_KINDS = ['checkin', 'ritual', 'person_fact', 'trigger'];

/** The payload format these readers were written for. */
export const PAYLOAD_VERSION = 1;

/** How many feelings one check-in may carry. Beyond this a check-in stops being a sentence. */
export const MAX_FEELINGS_PER_CHECKIN = 5;

export const TRANSCRIPTION_LANGUAGES = ['de', 'en', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'tr', 'ru'];

/** A transcript is a spoken minute or two, not a document. */
export const MAX_TRANSCRIPT_LENGTH = 4000;

export const MAX_TRIGGER_LABEL = MAX_TAG_LENGTH;

/**
 * A trigger's two halves (the EmotionGuesser integration). An `entity` is who or what a
 * feeling was about when it was not a person — *work*, *the gym*, *my flat*; an
 * `interaction` is what happened with it — *meeting*, *breakup*, *being ignored* — a short
 * generic phrase that can recur across people and things, so *meetings with anyone* and
 * *everything with Lucie* are both readable later. A trigger row minted before this existed
 * carries no role and reads as an entity.
 */
export const TRIGGER_ROLES = ['entity', 'interaction'];

/** The words from the note that show a feeling: a quotation, so it is capped rather than filtered. */
export const MAX_QUOTE_LENGTH = 300;

/** Intensity is 1–3. Its words live in JOURNAL_COPY so the forbidden-word walk sees them. */
export const INTENSITY_LEVELS = [1, 2, 3];

export const DAY_ROLLOVER_HOUR = 4;

/** Where the journal's routes live. */
export const JOURNAL_ROOT = '/journal';

/** The nightly ritual's own route. A static segment, so it is never a day called "ritual". */
export const RITUAL_PATH = `${JOURNAL_ROOT}/ritual`;

/** The two vocabulary screens (§9.1). Static segments, for `RITUAL_PATH`'s reason. */
export const PEOPLE_PATH = `${JOURNAL_ROOT}/people`;
export const TRIGGERS_PATH = `${JOURNAL_ROOT}/triggers`;

export const SEARCH_PATH = `${JOURNAL_ROOT}/search`;

/** The drift analytics screen (the EmotionGuesser integration). A static segment, like the others. */
export const INSIGHTS_PATH = `${JOURNAL_ROOT}/insights`;

export const RECORD_PARAM = 'record';
export const RECORD_PARAM_VALUE = '1';
export const JOURNAL_RECORD_PATH = `${JOURNAL_ROOT}?${RECORD_PARAM}=${RECORD_PARAM_VALUE}`;

export const journalPersonPath = (relationshipId) => (
    Number.isFinite(Number(relationshipId)) && relationshipId !== null && relationshipId !== ''
        ? `${PEOPLE_PATH}/${relationshipId}`
        : PEOPLE_PATH
);

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
    language: 'alq:journal-language',
    tier: 'alq:journal-tier'
};

/** The ritual's default time, if the user never picks one. */
export const DEFAULT_RITUAL_TIME = '22:30';

/** At most three optional questions on top of the five core ones (§3.3). */
export const MAX_OPTIONAL_QUESTIONS = 3;

/* 4. Copy */

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
        done: 'Recorded.',
        close: 'Close',
        // The dot row's spoken label. A position, not a score of how far along anyone is.
        progress: 'Card {index} of {total}',
        saving: 'Saving…',
        // Trap 4 again: the cards stay where they are and every tap is still held, so the
        // sentence says that rather than only that the write did not land.
        saveError: "Could not save tonight's answers. What you tapped is still here.",
        retry: 'Try again',
        // §3.7, the ritual in one breath. Full tier only — the swipe cards are the default
        // and the only path everywhere else, and this copy is unreachable there.
        voice: {
            // The offer, on the first card. Deliberately "or": the cards are already in
            // front of the person reading it and this does not replace them.
            offer: 'Or say it in one breath',
            hint: 'One sentence about your day — sleep, moving, being outside, people, meals. Anything you leave out stays unanswered.',
            listening: 'Listening. Tap when you are done.',
            reading: 'Reading it back…',
            // The confirm card. The same two sentences the check-in's card uses, because it
            // is the same promise: nothing here is saved until it is tapped.
            confirm: 'Is this right?',
            confirmHint: 'Dashed means not saved yet. Tap a row to change it; anything left blank stays unanswered.',
            heard: 'It heard: {names}',
            keep: 'Save these',
            // The exits. Both of them lead to the cards, because the cards are the thing
            // that always works (§3.7).
            cards: 'Use the cards instead',
            nothing: 'No answers in that one — the cards are below.',
            // Named `unavailable` and not `failed`: the copy walk reads the key path as
            // well as the string, and "fail" is on the list wherever it appears.
            unavailable: 'That did not come back. The cards are below.',
            // What a row says before it is confirmed, for a screen reader. The visual cue is
            // the dashed border; this is the same information as words.
            unconfirmed: 'suggested, not saved',
            unanswered: 'left unanswered'
        }
    },

    checkin: {
        prompt: 'What is it like right now?',
        speak: 'Say it',
        type: 'Type it',
        chips: 'Tap a few words',

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

    day: {
        previous: 'Previous day',
        next: 'Next day',
        today: 'Today',
        month: 'Days this month',
        // The ritual sits under the day's check-ins rather than among them: a check-in is
        // a moment inside the day and the ritual is about the whole of it.
        ritualHeading: 'The evening questions',
        unanswered: 'Unanswered',
        // The screen's own error slot (agent guide, Recipe 5). The page keeps rendering
        // under it, and the banner can be put away without the day going with it.
        loadError: 'Could not load your journal. Check that the server is running, then reload.',
        dismiss: 'Dismiss',
        notSynced: 'Not yet synced',
        notSent: 'Not sent — {reason}'
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
        voiceNeedsSecureContext: "Voice isn't available over a plain http:// address — the browser only offers the microphone and the checks this needs over HTTPS or on localhost. Typing works the same way.",
        modelDownloading: 'Downloading the model — {size}. Tapping words works in the meantime.',
        modelDownloadCancel: 'Cancel'
    },

    voice: {
        open: 'Say a check-in',
        openHint: 'Tap to record. Tap again to stop.',
        // The limit is on the button before it is reached, and the number comes from
        // `MAX_CLIP_MS` rather than from this sentence, so the two cannot disagree.
        limit: 'Up to {seconds} seconds',
        recording: 'Recording',
        stop: 'Stop',
        remaining: '{seconds}s left',
        addMore: 'Add more',
        discard: 'Discard',
        again: 'Record again',
        clips: {
            one: 'One clip on this check-in.',
            many: '{count} clips on this check-in.'
        },
        working: 'Writing down what you said…',
        // §4.3: the transcript is the record, and it is editable because a model
        // mishears names most of all.
        transcriptLabel: 'What you said',
        transcriptHint: 'Edit it if a word came out wrong — what you leave here is what is saved.',
        empty: 'Nothing came through. Record again, or tap the words below.',
        // §4.2's register: say the room was loud, do not pretend the text is clean.
        noisy: 'This was a noisy take — check the words.',
        // A microphone that was refused is not an error; it is a path not taken.
        denied: 'The microphone was not allowed, so there is nothing to write down. Tapping words works the same way.',
        // Not `failed`: the walk reads the key path as well as the string, and it is
        // right to — a screen that logs `voice.failed` is one refactor from showing it.
        notWritten: 'The words could not be written down. Your recording was not kept — tap the words below, or record again.',
        keyboard: 'Type instead'
    },

    proposal: {
        suggested: 'Suggested from what you said',
        // Moved here from the U1 fixture card when D2 built the real one, so the walk sees it.
        dashed: 'Dashed means not saved yet. Tap a word to keep it, tap it again to put it down.',
        keep: 'Keep {label}',
        putDown: 'Put {label} down',
        change: 'Change',
        changeHint: 'Pick the word that fits instead of {label}.',
        changeCancel: 'Leave it',
        addWord: 'Add a word',
        addWordClose: 'Close the words',
        // §4.6 `target`: the feelings are here and nothing is attached to them yet.
        attachHint: 'Tap Person, Trigger or Tag to say what this was about.',
        people: {
            heading: 'People',
            matches: '{name} — matches your relationship "{match}"',
            newPerson: '{name} — new person?',
            candidate: '{candidate}?',
            candidateHint: 'Or, if you meant someone you already have:',
            pickExisting: 'Pick existing…',
            keepNew: 'Add {name} as a new person',
            added: '{name} — new person',
            linked: '{name} — as {match}',
            // Nothing dashed is written (§4.4): a person nobody confirmed is not created, and
            // the chips that named them go unsaved with them.
            unresolved: 'Not saved until you say who this is.'
        },
        triggers: {
            keep: 'Keep the new trigger {label}'
        },
        // The words behind a proposed feeling — the model's evidence, quoted from the note.
        // Shown so a wrong suggestion can be put down at a glance rather than after a re-read.
        quote: 'From what you said: “{quote}”',
        ambiguity: {
            feeling: 'Which of these is closest to how that felt?',
            // `{options}` is filled from the mentions the model did find, each as
            // `targetOption`, joined with commas — "about Lucie, about work".
            target: 'Was that {options}, or something else?',
            targetOption: 'about {name}',
            targetUnknown: 'What was that about?',
            conflict: 'Could be either — pick one, or say it another way.'
        },
        notIt: "This isn't it",
        // The three exits §4.6 gives every non-`none` ambiguity and the *This isn't it* link.
        exits: {
            heading: 'Say it another way',
            edit: 'Edit the words',
            rerecord: 'Say it again',
            chips: 'Tap words instead'
        },
        rerunning: 'Reading the new words…',
        save: 'Save',
        saving: 'Saving…',
        discard: 'Discard',
        // Trap 4: the card stays and keeps every confirmation, so the sentence says so.
        saveError: 'Could not save this check-in. Nothing was written, and what you kept is still here.'
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
            label: 'Voice check-ins',
            description: 'One model, and it runs on this device: Whisper tiny, open weights under the Apache 2.0 licence, downloaded once from this server. It writes down a voice note — the audio is never saved and never sent — and it is asked only what you said, never how you sounded. It reads the words back to you before anything is saved, and you tag them yourself. It switches off in your profile at any time.',
            // Said before the download, never after it: §5.6 wants the size in front of the
            // user while the choice is still theirs.
            size: '{label}, {size}. It downloads once and stays on this device.',
            remove: 'Remove downloaded files',
            removed: 'Removed. Turning voice on again downloads it once more.',
            downloadOffer: 'Download {label} — {size}',
            downloading: 'Downloading {label} — {done} of {size}.',
            downloaded: 'On this device.',
            // A wrong sum is never a warning to click past. It is the end of the attempt.
            checksumError: 'The model files on the server do not match what this app expects, so nothing was kept. Ask whoever runs the server to fetch them again.',
            downloadError: 'The download stopped and nothing was kept. Check the server, then try again.'
        },
        suggestions: {
            label: 'Show suggestions',
            description: 'With this off, voice still writes the words down and you tag them yourself with chips.',
            // licence instead of saying there is none. It stays descriptive: what runs, where
            model: '{label} suggests them, on this device, under the {licence} licence. Every suggestion waits for you to keep it or put it down.'
        },
        embeddings: {
            label: 'Similar-entry suggestions and search',
            // Verbatim from §10.2's Vault entry, so the toggle and the privacy page cannot
            // drift apart.
            description: 'A second small model (EmbeddingGemma, under Google\'s Gemma terms) turns your entries into numbers that this device uses to find entries with similar words, and to search what you have written. Those numbers are kept only on this device, never sent, never exported, and deleted when you sign out.',
            // Said before the download, never after it — §5.6's rule, and the same sentence
            // shape the voice block uses so the two screens read alike.
            size: '{label}, {size}. It downloads once and stays on this device.',
            downloadOffer: 'Download {label} — {size}',
            downloading: 'Downloading {label} — {done} of {size}.',
            downloaded: 'On this device.',
            remove: 'Remove downloaded files',
            removed: 'Removed. Turning this on again downloads it once more.',
            licence: '{label} is open weights under the {licence}, which are served from this app beside the files.',
            // Named rather than hidden: a control that is not offered and says nothing about
            // why is a control that lies about being absent.
            unavailable: 'This device has nowhere to keep the numbers, so this stays off here.'
        },
        keepTranscripts: {
            label: 'Keep transcripts',
            description: 'On by default. With this off, a voice check-in keeps only the feelings, people and triggers you confirmed, and the words are dropped when you save.'
        },
        language: {
            label: 'Transcription language',
            description: 'Auto — the model works out which language you spoke. Pin it here when it guesses wrong.',
            auto: 'Auto'
        },
        tier: {
            label: 'What this device can run',
            description: 'Worked out from what the browser reports. You can pin it lower if you would rather this device did less; it cannot be pinned higher than what is actually here.',
            // Android (C4): the number comes from the phone itself, through the plugin,
            // because the WebView rounds memory down to a power of two.
            descriptionNative: 'Worked out from how much memory this phone has. You can pin it lower if you would rather this phone did less; it cannot be pinned higher than what is actually here.',
            memory: 'This phone reports {gb} GB of memory.',
            detected: 'Detected: {tier}.',
            pinned: 'Pinned to {tier}.',
            auto: 'Use what this device reports',
            // Named, not swallowed: a refused choice the user never hears about is a
            // control that lies about being a control.
            refused: 'This device cannot run {tier}, so it is running {actual} instead.',
            names: {
                full: 'the full model',
                light: 'the small transcriber',
                'text-only': 'typing and chips only'
            }
        }
    },

    triggers: {
        heading: 'Triggers',
        subheading: 'What a feeling was about, when it was not a person.',
        newTrigger: 'New trigger: {label}?',
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
        // The two halves a trigger can be (TRIGGER_ROLES). A row with no role says nothing.
        roles: {
            entity: 'who or what',
            interaction: 'what happened'
        },
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

    similar: {
        // Beside *new trigger*, never instead of it: the card offers a word the user already
        // has, and the user may want neither of them.
        offer: "You've called this '{label}' before — same thing?",
        keep: "Use '{label}' instead",
        // Why this word and not another. It says what was compared, not how closely.
        note: 'Found by comparing the words on this device.',

        // The Triggers view's half. It offers pairs; the merge is the dialog behind them,
        // which already says out loud that a merge is one-way.
        pairsHeading: 'Looks similar to…',
        pairsNote: 'Words that look alike, and that you have used around the same people. Nothing is merged until you say so.',
        pair: "'{a}' looks similar to '{b}'",
        pairAction: 'Merge these…',

        past: {
            heading: 'Words you chose before',
            note: 'From entries of yours that name the same people or the same triggers. Dashed means not saved yet.',
            keep: "Keep '{label}'"
        },

        namesake: 'Put in order by which of them your words sound most like. Nothing is picked for you.',

        known: {
            heading: 'Already known?',
            beside: 'Close to something already kept about this person.'
        },

        search: {
            heading: 'Search',
            subheading: 'Find a day by the words that are on it.',
            label: 'What are you looking for?',
            placeholder: 'A word, a name, a phrase',
            words: 'Entries with these words',
            alike: 'Entries with similar words',
            // Said under the second list only, so the two are never read as one kind of
            // result. It says what was compared, never how closely.
            alikeNote: 'Found by comparing the words on this device.',
            empty: 'Nothing here has those words yet.',
            prompt: 'Type a word to look for it.',
            open: 'Open {day}',
            openSnapshot: 'Open the timeline',
            snapshot: 'A snapshot note',
            off: 'Search is off on this device. Turn on similar-entry suggestions and search in your profile.',
            unavailable: 'This device has nowhere to keep the numbers, so search stays off here.'
        }
    },

    dayGraph: {
        infoLabel: 'About this drawing',
        // The half-life is filled from the constant rather than written into the sentence,
        // so tuning the constant cannot leave the sentence saying something untrue.
        fade: 'Each feeling is drawn fading over about {halfLife} unless you mention it again.',
        unstated: 'A feeling recorded without a strength, like the closing word, is drawn at {strength} of three.',
        caveat: 'That is a drawing choice about what you recorded, not a claim about you.',
        extrapolated: 'The faint part is drawn past what you said, not measured.',
        legend: 'Feelings today',

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

    // The Insights screen (the EmotionGuesser integration). Every sentence describes an
    // arithmetic over what was recorded; none of them grades the person who recorded it.
    insights: {
        heading: 'Insights',
        subheading: 'How the same people and triggers have felt over time.',
        // The ⓘ. The first sentence is the whole screen's caveat, on the day graph's rule.
        caveat: 'Every drawing here is arithmetic over what you recorded, not a claim about you.',
        coordinates: 'Each feeling sits at a fixed point on three axes — pleasant to unpleasant, still to energetic, overwhelmed to in control — and a check-in is drawn at the point of the feeling you chose, weighted by its strength.',
        unstated: 'A feeling recorded without a strength is counted at {strength} of three, the same as the day graph draws it.',
        smoothing: 'Smoothed means a weighted average in which the newest entries count most and older ones fade by half every {halflife} entries.',
        infoLabel: 'About these drawings',

        level: {
            label: 'Group by',
            person: 'Person',
            trigger: 'Trigger',
            pair: 'Person or thing · what happened',
            personHint: 'Everything felt about one person, pooled over whatever happened.',
            triggerHint: 'Everything felt about one trigger, pooled over everyone it happened with.',
            pairHint: 'One person or thing together with one thing that happened, kept apart from the rest.'
        },

        series: {
            label: 'What to draw',
            hint: 'Up to {max} at once. Tap one to add it or put it down.',
            entries: {
                one: '{count} entry',
                many: '{count} entries'
            }
        },

        circumplex: {
            heading: 'Where each one sits',
            hint: 'Left to right is unpleasant to pleasant; bottom to top is still to energetic. Each dot is a check-in, sized by its strength, and the ring marks the most recent one.',
            smoothed: 'Smoothed',
            raw: 'As recorded',
            axisX: 'unpleasant → pleasant',
            axisY: 'still → energetic',
            corner: {
                highPleasant: 'energetic · pleasant',
                highUnpleasant: 'energetic · unpleasant',
                lowPleasant: 'still · pleasant',
                lowUnpleasant: 'still · unpleasant'
            }
        },

        drift: {
            heading: 'How far each one has moved',
            hint: 'The smoothed position now, less the very first check-in that named it. Only what has been named at least twice is drawn.',
            axis: {
                valence: 'toward pleasant',
                energy: 'toward energetic',
                dominance: 'toward in control'
            },
            axisAway: {
                valence: 'toward unpleasant',
                energy: 'toward still',
                dominance: 'toward overwhelmed'
            },
            dimension: 'Axis',
            dimensions: {
                valence: 'Pleasant',
                energy: 'Energy',
                dominance: 'Control'
            },
            empty: 'Nothing here has been named twice yet.'
        },

        series1: {
            heading: 'One over time',
            hint: 'Each dot is a check-in on the chosen axis; the line is the smoothed position.',
            pick: 'Which one',
            dimension: 'Axis',
            intensity: 'Strength',
            // The four figures under the drawing, each a sentence, on `SummaryLine`'s rule.
            count: 'Named in {count} check-ins.',
            now: 'Smoothed position now: {value}.',
            since: 'Since the first time: {value}.',
            slope: 'Direction over the last few: {value} per thirty days.',
            slopeNone: 'Direction over the last few: too few to say.',
            distance: 'Distance moved across all three axes: {value}.',
            interactions: 'What happened with it: {list}.',
            entities: 'Who or what it happened with: {list}.',
            withNothing: 'nothing named'
        },

        heatmap: {
            heading: 'Which feelings each one brings',
            hint: 'Strength summed per feeling, across every check-in that names it. Darker is more.',
            empty: 'No feelings attached to anything yet.'
        },

        weekly: {
            heading: 'The weeks, on three axes',
            hint: 'Each week is the average of that week\'s check-ins on each axis, weighted by strength. A week with nothing in it is left out rather than drawn at zero.',
            valence: 'pleasant',
            energy: 'energy',
            dominance: 'control'
        },

        radar: {
            heading: 'Feeling families',
            hint: 'Strength summed by family, for what is drawn above.',
            families: {
                joy: 'joy',
                trust: 'trust',
                anticipation: 'anticipation',
                fear: 'fear',
                sadness: 'sadness',
                disgust: 'disgust',
                anger: 'anger',
                quiet: 'quiet'
            }
        },

        empty: 'Nothing to draw yet. Insights appear once check-ins name a person or a trigger.',
        loadError: 'Could not load your journal. Check that the server is running, then reload.'
    },

    nav: {
        label: 'Journal',
        back: 'Back to the journal'
    }
};

export const fillCopy = (template, values = {}) => (
    String(template).replace(/\{(\w+)\}/g, (placeholder, key) => (
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
    ))
);

export const countCopy = (count, templates, values = {}) => {
    const chosen = count === 1 ? templates?.one : templates?.many;
    return chosen ? fillCopy(chosen, { ...values, count }) : '';
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

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

/* 5. Readers */

const versionOf = (payload) => {
    const declared = payload?.v;
    return Number.isFinite(declared) ? declared : PAYLOAD_VERSION;
};

const asString = (value) => (typeof value === 'string' ? value : null);
const asBool = (value) => (typeof value === 'boolean' ? value : null);
const asNumber = (value) => (Number.isFinite(value) ? value : null);
const asArray = (value) => (Array.isArray(value) ? value : []);

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

const readFeelingEntry = (feeling) => ({
    id: asString(feeling?.id),
    intensity: asNumber(feeling?.intensity),
    uncertain: asBool(feeling?.uncertain),
    about: asArray(feeling?.about).map(readAboutTarget).filter(Boolean),
    // The words behind it, when a model quoted them and the user kept the feeling. Absent
    // on every check-in written before the EmotionGuesser integration, and on every chip.
    ...(typeof feeling?.quote === 'string' && feeling.quote ? { quote: feeling.quote } : {})
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

/* 5b. Triggers, and the chain a reader has to resolve */

const triggerIdentity = (entry) => asString(entry?.client_id ?? entry?.clientId);

const triggerPayload = (entry) => (entry?.payload && typeof entry.payload === 'object' ? entry.payload : {});

/** The ids a correction row speaks for besides its own. A bare string reads as one id. */
const correctedIds = (entry) => {
    const declared = triggerPayload(entry).corrects;
    if (typeof declared === 'string') return [declared];
    return asArray(declared).filter(id => typeof id === 'string');
};

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

export const readTrigger = (entry, allTriggerEntries = []) => {
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
        // Which half of a trigger it is (TRIGGER_ROLES), or null on a row minted before roles
        // existed — which every reader treats as an entity.
        role: TRIGGER_ROLES.includes(payload.role) ? payload.role : null,
        // The surviving trigger as the payload named it, when this id has been merged away;
        // null when it has not.
        mergedInto,
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

/* 5c. The two corrections the trigger vocabulary needs */

const correctionBase = (trigger, now) => {
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
            created_from: asString(trigger?.createdFrom),
            // Carried for the same reason. Absent stays absent (invariant 14).
            ...(TRIGGER_ROLES.includes(trigger?.role) ? { role: trigger.role } : {})
        },
        mentions: [],
        triggers: [],
        // The row-level link. A database id, which is the one thing about a trigger the
        // client does not mint — it comes back on the row `GET /api/journal/entries` served.
        supersedes_id: row?.ID ?? null
    };
};

export const renameTriggerRequest = ({ trigger, label, now = new Date() }) => {
    const request = correctionBase(trigger, now);
    request.payload.label = String(label ?? '').trim();
    request.payload.merged_into = null;
    return request;
};

export const mergeTriggerRequest = ({ trigger, into, now = new Date() }) => {
    const request = correctionBase(trigger, now);
    request.payload.label = asString(trigger?.label) ?? '';
    // `live`, not `clientId`: the survivor may itself have been renamed since, and a merge
    // into a superseded id is a 400 the user would have no way to read.
    request.payload.merged_into = asString(into?.live ?? into?.clientId ?? into) ?? null;
    return request;
};

/* 5d. What the journal knows about one person, and about one trigger */

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

/* 6. Day arithmetic */

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

export const shiftDay = (day, delta = 0) => {
    if (!isDayString(day)) return null;

    const moved = new Date(Date.parse(`${day}T00:00:00Z`) + Math.trunc(Number(delta) || 0) * 86400000);
    if (Number.isNaN(moved.getTime())) return null;

    return `${moved.getUTCFullYear()}-${pad2(moved.getUTCMonth() + 1)}-${pad2(moved.getUTCDate())}`;
};

export const monthBounds = (day) => {
    if (!isDayString(day)) return null;

    const [year, month] = day.split('-').map(Number);
    const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();

    return {
        from: `${year}-${pad2(month)}-01`,
        to: `${year}-${pad2(month)}-${pad2(lastDate)}`
    };
};

export const timeOfDay = (at) => {
    if (at === null || at === undefined || at === '') return null;

    const instant = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(instant.getTime())) return null;

    return `${pad2(instant.getHours())}:${pad2(instant.getMinutes())}`;
};

/** `HH:MM`, 24-hour, as the ritual's time setting stores it and `<input type="time">` uses it. */
export const isClockTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));

export const minutesIntoCivilDay = (value, rolloverHour = DAY_ROLLOVER_HOUR) => {
    const [hours, minutes] = value instanceof Date
        ? [value.getHours(), value.getMinutes()]
        : String(value ?? '').split(':').map(Number);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

    const DAY_MINUTES = 24 * 60;
    return (((hours - rolloverHour) * 60 + minutes) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES;
};

export const ritualTimeReached = (time, now = new Date(), rolloverHour = DAY_ROLLOVER_HOUR) => {
    if (!isClockTime(time)) return false;

    const chosen = minutesIntoCivilDay(time, rolloverHour);
    const current = minutesIntoCivilDay(now, rolloverHour);
    return chosen !== null && current !== null && current >= chosen;
};

export const tzOffsetMinutes = (date = new Date()) => {
    const instant = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(instant.getTime())) return null;
    return -instant.getTimezoneOffset();
};

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

/* 7. Candidate matching */

const fold = (value) => (
    String(value ?? '')
        .trim()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
);

const isTokenPrefix = (text, prefix) => (
    prefix.length > 0
    && text.startsWith(prefix)
    && (text.length === prefix.length || /[\s\-'.]/.test(text[prefix.length]))
);

/** No suggestion list is ever longer than this. Three fit under a field; a fourth is a menu. */
export const MAX_CANDIDATES = 3;

/* 7a. Looks-alike matching (the EmotionGuesser integration) */

/**
 * How alike two labels have to look before one is *offered* for the other. The
 * EmotionGuesser's review band: below this a label is new; at or above it the existing
 * word is put in front of the user as a question. Nothing is ever linked on this score
 * alone — *Lucy* is proposed as *Lucie*, never merged, because no arithmetic can tell a
 * spelling variant from a different person.
 */
export const SIMILAR_FLOOR = 0.62;

/** Shorter than this after folding, and the ratio says nothing worth asking about. */
const SIMILAR_MIN_LENGTH = 3;

const STOP_WORDS = new Set(['my', 'the', 'a', 'an', 'our', 'with', 'at', 'of', 'to', 'in', 'on', 'some', 'this', 'that',
    'mein', 'meine', 'der', 'die', 'das', 'ein', 'eine', 'mit', 'bei', 'von', 'zu', 'im', 'am']);

/** Lower-case, accent-free, letters and digits only, stop words dropped. */
const foldForSimilarity = (value) => (
    fold(value)
        .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
        .split(/\s+/)
        .filter(word => word && !STOP_WORDS.has(word))
        .join(' ')
);

/** Ratcliff/Obershelp: twice the matched characters over the total, as Python's SequenceMatcher reads it. */
const matchedCharacters = (a, b) => {
    if (!a.length || !b.length) return 0;

    let bestA = 0;
    let bestB = 0;
    let bestLength = 0;
    for (let i = 0; i < a.length; i += 1) {
        for (let j = 0; j < b.length; j += 1) {
            let length = 0;
            while (i + length < a.length && j + length < b.length && a[i + length] === b[j + length]) length += 1;
            if (length > bestLength) {
                bestLength = length;
                bestA = i;
                bestB = j;
            }
        }
    }
    if (bestLength === 0) return 0;

    return bestLength
        + matchedCharacters(a.slice(0, bestA), b.slice(0, bestB))
        + matchedCharacters(a.slice(bestA + bestLength), b.slice(bestB + bestLength));
};

const sequenceRatio = (a, b) => (
    a.length + b.length === 0 ? 0 : (2 * matchedCharacters(a, b)) / (a.length + b.length)
);

/**
 * 0…1, how alike two labels look: the best of token overlap (Jaccard), token containment
 * (so *boss* against *meeting boss* scores high), and the character-sequence ratio. The
 * EmotionGuesser's `_string_similarity`, carried over whole so its review band means the
 * same thing here.
 */
export const labelSimilarity = (a, b) => {
    const left = foldForSimilarity(a);
    const right = foldForSimilarity(b);
    if (!left || !right) return 0;
    if (left === right) return 1;
    if (left.length < SIMILAR_MIN_LENGTH || right.length < SIMILAR_MIN_LENGTH) return 0;

    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    let shared = 0;
    leftTokens.forEach(token => { if (rightTokens.has(token)) shared += 1; });
    const union = new Set([...leftTokens, ...rightTokens]).size;
    const jaccard = union === 0 ? 0 : shared / union;
    const containment = shared / Math.min(leftTokens.size, rightTokens.size);

    return Math.max(jaccard, 0.85 * containment, sequenceRatio(left, right));
};

/** The rows that look like `query`, best first, each with its score. Never an exact match. */
const similarRows = (query, rows, labelOf) => (
    rows
        .map(row => ({ row, score: labelSimilarity(query, labelOf(row)) }))
        .filter(({ score }) => score >= SIMILAR_FLOOR && score < 1)
        .sort((a, b) => b.score - a.score || labelOf(a.row).localeCompare(labelOf(b.row)))
);

export const personCandidates = (name, relationships = []) => {
    const trimmed = String(name ?? '').trim();
    if (!trimmed) return [];

    const rows = asArray(relationships).filter(person => typeof person?.name === 'string');

    const candidate = (person, match, score = null) => ({
        relationship: person,
        relationshipId: person.ID,
        name: person.name,
        exact: match === 'exact',
        match,
        ...(score === null ? {} : { score })
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
    const placed = new Set([...insensitive, ...prefix].map(person => person.ID));
    // Spelling variants — *Lucy* for *Lucie* — after the rules above, and only as an offer.
    const similar = similarRows(trimmed, rows.filter(person => !placed.has(person.ID)), person => person.name);

    return [
        ...insensitive.map(person => candidate(person, 'insensitive')),
        ...prefix.map(person => candidate(person, 'prefix')),
        ...similar.map(({ row, score }) => candidate(row, 'similar', score))
    ].slice(0, MAX_CANDIDATES);
};

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

    const candidate = (row, match, score = null) => ({
        ...row, exact: match === 'exact', match, ...(score === null ? {} : { score })
    });

    const exact = rows.find(row => row.label.trim() === trimmed);
    if (exact) return [candidate(exact, 'exact')];

    const query = fold(trimmed);
    const insensitive = rows.filter(row => fold(row.label) === query);
    const placed = new Set(insensitive.map(row => row.clientId));
    // A near miss — *meeting* for *meetings*, *Arbeit* for *arbeit im Büro* — is offered
    // beside *new trigger* and never in its place: §4.5b's rule that the user grows the
    // vocabulary one confirmed word at a time is unchanged, the offer only saves a merge.
    const similar = similarRows(trimmed, rows.filter(row => !placed.has(row.clientId)), row => row.label);

    return [
        ...insensitive.map(row => candidate(row, 'insensitive')),
        ...similar.map(({ row, score }) => candidate(row, 'similar', score))
    ].slice(0, MAX_CANDIDATES);
};

/* 8. Client ids */

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
