import { feelingById, readCheckin, TRIGGER_ROLES } from '../../constants/journal';
import { UNSTATED_INTENSITY } from '../../components/dayGraph.js';

/* 1. The table every drawing reads
 *
 * The EmotionGuesser's `observations()`: one long-format row per (check-in, feeling, thing it
 * was about), carrying the feeling's three coordinates so every delta downstream is a vector
 * subtraction. Nothing here is stored — it is derived from `GET /api/journal/entries` on read,
 * the way the timeline and What Changed derive theirs (§6.4).
 *
 * A trigger is two halves (TRIGGER_ROLES). For one feeling, the *sides* are the people it
 * names plus the triggers whose role is `entity` (or unknown — every trigger minted before
 * roles existed), and the *happenings* are the triggers whose role is `interaction`. A row is
 * one side with one happening; a feeling with only sides, or only happenings, gives a row per
 * half; a feeling about nothing gives no row here at all, and is read by `weeklyMood` alone.
 */

/** The three groupings `atLevel` can re-key the table to. `pair` keeps both halves apart. */
export const LEVELS = ['pair', 'person', 'trigger'];

/** The strength scale the user authors on; `intensity` below is a level over this. */
export const INTENSITY_SCALE = 3;

/** The separator a pair's label uses, the EmotionGuesser's own. */
export const PAIR_SEPARATOR = ' · ';

const instantOf = (at) => {
    if (at === null || at === undefined || at === '') return null;
    const parsed = at instanceof Date ? at : new Date(at);
    const ms = parsed.getTime();
    return Number.isNaN(ms) ? null : ms;
};

/** A level on 1…3, with the day graph's stated constant standing in for an absent one. */
export const levelOf = (intensity) => (
    Number.isFinite(intensity)
        ? Math.min(INTENSITY_SCALE, Math.max(1, intensity))
        : UNSTATED_INTENSITY
);

const defaultResolve = (id) => ({ live: id, label: null, role: null });
const defaultPersonName = (mention) => mention?.label ?? '';

export const observationsOf = (entries, { resolveTrigger = defaultResolve, personName = defaultPersonName } = {}) => {
    const rows = [];

    (Array.isArray(entries) ? entries : []).forEach((entry) => {
        if (entry?.kind !== 'checkin') return;
        const at = instantOf(entry.at);
        if (at === null) return;

        const mentionsByRef = new Map((entry.mentions ?? []).map(mention => [mention.ref, mention]));
        const checkin = readCheckin(entry.payload);

        checkin.feelings.forEach((feeling) => {
            const known = feelingById(feeling.id);
            if (!known) return;

            const sides = [];
            const happenings = [];
            const seenTriggers = new Set();

            feeling.about.forEach((about) => {
                if (about.kind === 'person') {
                    const mention = mentionsByRef.get(about.ref);
                    if (!mention || mention.relationship_id == null) return;
                    if (sides.some(side => side.person?.id === mention.relationship_id)) return;
                    sides.push({ person: { id: mention.relationship_id, name: personName(mention) }, entity: null });
                    return;
                }
                if (about.kind !== 'trigger' || !about.trigger) return;

                const resolved = resolveTrigger(about.trigger);
                const live = resolved?.live ?? about.trigger;
                if (seenTriggers.has(live)) return;
                seenTriggers.add(live);

                const trigger = { id: live, label: resolved?.label ?? about.trigger };
                const role = TRIGGER_ROLES.includes(resolved?.role) ? resolved.role : 'entity';
                if (role === 'interaction') happenings.push(trigger);
                else sides.push({ person: null, entity: trigger });
            });

            if (sides.length === 0 && happenings.length === 0) return;

            const level = levelOf(feeling.intensity);
            const base = {
                entryId: entry.ID ?? entry.client_id ?? null,
                clientId: entry.client_id ?? null,
                day: entry.day ?? null,
                at,
                feelingId: known.id,
                level,
                intensity: level / INTENSITY_SCALE,
                valence: known.valence,
                energy: known.energy,
                dominance: known.dominance,
                uncertain: feeling.uncertain === true,
                quote: feeling.quote ?? null
            };

            const combine = (side, happening) => rows.push({
                ...base,
                person: side?.person ?? null,
                entity: side?.entity ?? null,
                interaction: happening ?? null
            });

            if (sides.length === 0) happenings.forEach(happening => combine(null, happening));
            else if (happenings.length === 0) sides.forEach(side => combine(side, null));
            else sides.forEach(side => happenings.forEach(happening => combine(side, happening)));
        });
    });

    rows.sort((a, b) => (a.at - b.at) || String(a.entryId).localeCompare(String(b.entryId)));
    return rows;
};

/* 2. Re-keying */

const sideKeyOf = (row) => {
    if (row.person) return { key: `person:${row.person.id}`, label: row.person.name, kind: 'person' };
    if (row.entity) return { key: `trigger:${row.entity.id}`, label: row.entity.label, kind: 'trigger' };
    return null;
};

const happeningKeyOf = (row) => (
    row.interaction ? { key: `trigger:${row.interaction.id}`, label: row.interaction.label, kind: 'trigger' } : null
);

const pairKeyOf = (row) => {
    const side = sideKeyOf(row);
    const happening = happeningKeyOf(row);
    if (side && happening) {
        return {
            key: `${side.key}|${happening.key}`,
            label: `${side.label}${PAIR_SEPARATOR}${happening.label}`,
            kind: 'pair',
            parts: { side, happening }
        };
    }
    const only = side ?? happening;
    return only ? { ...only, kind: 'pair', parts: { side, happening } } : null;
};

/**
 * The table keyed to one grouping. `pair` (the default) keeps a side and a happening
 * together; `person` pools everything felt about one person over whatever happened;
 * `trigger` pools everything felt about one trigger over everyone it happened with. A
 * feeling is counted once per key, however many rows it spread into.
 */
export const atLevel = (rows, level = 'pair') => {
    if (!LEVELS.includes(level)) throw new Error(`atLevel: unknown level "${level}"`);

    const seen = new Set();
    const keyed = [];
    const place = (row, keyed_) => {
        if (!keyed_) return;
        const identity = `${row.entryId}#${row.feelingId}#${keyed_.key}`;
        if (seen.has(identity)) return;
        seen.add(identity);
        keyed.push({ ...row, key: keyed_.key, label: keyed_.label, kind: keyed_.kind, parts: keyed_.parts ?? null });
    };

    (Array.isArray(rows) ? rows : []).forEach((row) => {
        switch (level) {
            case 'person':
                if (row.person) place(row, sideKeyOf(row));
                break;
            case 'trigger':
                if (row.entity) place(row, sideKeyOf(row));
                if (row.interaction) place(row, happeningKeyOf(row));
                break;
            default:
                place(row, pairKeyOf(row));
        }
    });

    return keyed;
};

/** The keys in a keyed table, most-named first, each with its label, kind and count. */
export const seriesOf = (keyed) => {
    const byKey = new Map();
    (Array.isArray(keyed) ? keyed : []).forEach((row) => {
        if (!byKey.has(row.key)) byKey.set(row.key, { key: row.key, label: row.label, kind: row.kind, count: 0, parts: row.parts ?? null });
        byKey.get(row.key).count += 1;
    });
    return [...byKey.values()].sort((a, b) => (b.count - a.count) || String(a.label).localeCompare(String(b.label)));
};
