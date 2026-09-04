/**
 * The scan, the gate, and the two things this slice is allowed to offer.
 *
 * Everything here is pure. No storage, no model, no React — which is what lets the three
 * rules of §5.8 be tested as arithmetic rather than as behaviour.
 *
 * ---
 *
 * **Rule 2 — similarity proposes, never writes, and never shows a number.**
 *
 * It is enforced by the *return type* rather than by care. `scan` is the only function here
 * that hands a similarity back, and the two functions a screen actually calls strip it: an
 * offer is `{ clientId, label }` and a pair is two of those, with no number on either for a
 * component to render by accident. Ordering is the only thing a score is for here, and once
 * the list is ordered the score has no further business existing. `journal.test.js` walks the
 * similarity copy for digits; this is the other half of the same promise.
 *
 * **Rule 3 — a semantic match needs a structural witness, as a hard gate.**
 *
 * Short colloquial sentences embed badly around negation: *"not angry, just tired"* sits
 * near *angry*. That is tolerable for recall, where the user reads the result and decides,
 * and dangerous for a suggestion, which arrives already phrased as a claim about their own
 * vocabulary. So a candidate is dropped unless a *structural* fact agrees with the geometry:
 * the candidate trigger has appeared alongside a person, or alongside another trigger, that
 * the thing being asked about also names.
 *
 * It is a gate and not a weight, deliberately. A weight lets a similarity high enough
 * outvote the absence of any structural agreement, which is precisely the case — two
 * unrelated things the model happens to think are alike — the rule exists to refuse. The
 * witness sets are built from the user's own confirmed check-ins by `buildWitnesses`; a
 * vocabulary with no history has no witnesses, and therefore makes no offers at all, which
 * is the right answer on a device with nothing to go on.
 *
 * `SIMILARITY_FLOOR` is a shortlist device and **not** the safety rule. It keeps the scan
 * from proposing the least-distant of a set of unrelated words on a device with three
 * triggers; the gate below it is what keeps a proposal honest. It is a starting value chosen
 * without a retrieval golden set — §5.8 asks for one and G2 is where it belongs — and it is
 * stated here rather than buried so that the next session can move it knowing what it does.
 */

import { readCheckin } from '../../constants/journal';

/** How alike two labels have to look before they are worth putting to the gate. */
export const SIMILARITY_FLOOR = 0.65;

/** At most this many offers, on the card and in the Triggers view alike. */
export const MAX_SIMILAR = 3;

/* ------------------------------------------------------------------------------------ */
/* 1. The scan                                                                            */
/* ------------------------------------------------------------------------------------ */

/**
 * Cosine, computed in one pass over both vectors.
 *
 * The vectors this app stores are unit length — `toIndexVector` normalises after Matryoshka
 * truncation — so the two norms are 1 and this is a dot product. It divides by them anyway:
 * the cost is two multiplies per element on a scan that is already milliseconds, and the
 * alternative is a function whose answer is silently wrong for any caller that hands it a
 * vector from somewhere else.
 *
 * Different widths return 0 rather than comparing a prefix. Two vectors of different widths
 * are from different models or different truncations, and the honest answer to "how alike
 * are they" is that the question does not apply.
 */
export const cosine = (a, b) => {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i += 1) {
        const x = a[i];
        const y = b[i];
        dot += x * y;
        na += x * x;
        nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / Math.sqrt(na * nb);
};

/**
 * Brute force over every row, most alike first.
 *
 * §5.8's whole architecture is this function: ten thousand rows of 256 floats is 10 MB and
 * one pass, and there is no index to build, keep warm, or invalidate. `similar.test.js`
 * scans ten thousand synthetic vectors against a stated budget so that a later change which
 * makes this quadratic is caught by a number rather than by a user.
 *
 * `rows` are `{ entryClientId, vector }`; anything else on them is ignored and carried.
 */
export const scan = (query, rows, { limit = MAX_SIMILAR, floor = SIMILARITY_FLOOR } = {}) => {
    if (!query || query.length === 0) return [];

    const hits = [];
    for (const row of rows) {
        const similarity = cosine(query, row.vector);
        if (similarity >= floor) hits.push({ entryClientId: row.entryClientId, similarity });
    }

    // A stable order for equal similarities: the id, so two runs over the same data agree.
    hits.sort((a, b) => (
        b.similarity - a.similarity || a.entryClientId.localeCompare(b.entryClientId)
    ));
    return limit > 0 ? hits.slice(0, limit) : hits;
};

/* ------------------------------------------------------------------------------------ */
/* 2. The structural witness                                                              */
/* ------------------------------------------------------------------------------------ */

const emptyWitness = () => ({ people: new Set(), triggers: new Set() });

/**
 * What each live trigger has been seen beside, across the user's own confirmed check-ins.
 *
 * For one trigger: the relationship ids of the people named on an entry that names it, and
 * the ids of the *other* triggers named on that entry. Both are structural — a mention is a
 * row the user confirmed with a tap, not a guess — which is exactly what rule 3 wants to
 * weigh against a geometric hunch.
 *
 * `resolve` maps a referenced trigger id to the id that is live now, so a merge does not
 * split one trigger's history into two half-witnesses.
 *
 * Built once per pass over the history and handed to the callers below, for the reason
 * `summarizeTrigger` takes a `resolve`: building it per candidate would make one pass a
 * quadratic one.
 */
export const buildWitnesses = (entries, resolve = (id) => id) => {
    const witnesses = new Map();
    const witnessFor = (id) => {
        if (!witnesses.has(id)) witnesses.set(id, emptyWitness());
        return witnesses.get(id);
    };

    (Array.isArray(entries) ? entries : []).forEach(entry => {
        if (entry?.kind !== 'checkin') return;

        const people = new Set(
            (Array.isArray(entry.mentions) ? entry.mentions : [])
                .map(mention => mention?.relationship_id)
                .filter(id => Number.isFinite(id))
        );

        const triggers = new Set();
        readCheckin(entry.payload).feelings.forEach(feeling => {
            feeling.about.forEach(about => {
                if (about.kind === 'trigger' && about.trigger) triggers.add(resolve(about.trigger));
            });
        });

        triggers.forEach(id => {
            const witness = witnessFor(id);
            people.forEach(person => witness.people.add(person));
            // A trigger is not its own witness: an entry naming only *work* says nothing
            // about whether *work* and anything else are the same thing.
            triggers.forEach(other => { if (other !== id) witness.triggers.add(other); });
        });
    });

    return witnesses;
};

const shares = (a, b) => {
    if (!a || !b) return false;
    for (const value of a) if (b.has(value)) return true;
    return false;
};

/**
 * The gate. `true` only when a person or a trigger is genuinely on both sides.
 *
 * Two empty sets are not agreement. A candidate the user has never used alongside anything
 * has no structural evidence for or against, and rule 3 says the absence of evidence is a
 * refusal rather than a pass — the whole point is that geometry alone may not speak.
 */
export const witnessAgrees = (witness, { people, triggers } = {}) => (
    shares(witness?.people, people) || shares(witness?.triggers, triggers)
);

/* ------------------------------------------------------------------------------------ */
/* 3. What the two screens may offer                                                      */
/* ------------------------------------------------------------------------------------ */

const labelOf = (trigger) => String(trigger?.label ?? '').trim();
// The id a new check-in must reference, which for an active trigger is its own client id
// and after a rename is the surviving row's. Every other reader in this app keys on `live`
// and so does this one, or a renamed word would be embedded twice under two ids.
const idOf = (trigger) => String(trigger?.live ?? trigger?.clientId ?? trigger?.client_id ?? '');

/**
 * *"You've called this 'work' before — same thing?"* — the card's offer (§5.8, use 1).
 *
 * Called when the model's label matched no trigger exactly (§4.5b step 1) and the card is
 * about to show *new trigger*. What comes back goes **beside** that, never instead of it:
 * this function proposes a word the user already has, and the user may want neither.
 *
 * `context` is what this check-in already names — the relationship ids of its people and the
 * live ids of the triggers it has already resolved. That is the witness side of rule 3.
 *
 * Returns `[{ clientId, label }]`, in order, and **carries no similarity**: there is no
 * number here for a screen to render.
 */
export const similarTriggerOffers = ({
    vector,
    triggers = [],
    vectors = new Map(),
    witnesses = new Map(),
    context = {},
    limit = MAX_SIMILAR
} = {}) => {
    if (!vector || vector.length === 0) return [];

    const byId = new Map();
    const rows = [];
    triggers.forEach(trigger => {
        const id = idOf(trigger);
        const stored = vectors.get(id);
        if (!id || !stored || !labelOf(trigger)) return;
        byId.set(id, labelOf(trigger));
        rows.push({ entryClientId: id, vector: stored.vector });
    });

    const people = context.people instanceof Set ? context.people : new Set(context.people || []);
    const named = context.triggers instanceof Set ? context.triggers : new Set(context.triggers || []);

    // The gate runs *before* the limit, not after it: three close-but-unwitnessed candidates
    // must not crowd out the one the user's own history agrees with.
    return scan(vector, rows, { limit: 0 })
        .filter(hit => witnessAgrees(witnesses.get(hit.entryClientId), { people, triggers: named }))
        .slice(0, limit)
        .map(hit => ({ clientId: hit.entryClientId, label: byId.get(hit.entryClientId) }));
};

/**
 * *"looks similar to…"* — the Triggers view's pairs (§5.8, use 1, second half).
 *
 * The same gate, with both sides of the pair supplying their own witnesses: two triggers are
 * only ever offered for merging when the user has used them beside a common person or a
 * common third trigger. **Nothing here merges anything.** It returns pairs for a screen to
 * show; the merge is `mergeTriggerRequest`, behind the dialog that says out loud that a
 * merge is one-way.
 *
 * Each unordered pair appears once, keyed on the two ids, so a list of *n* triggers does not
 * become 2*n* rows saying the same thing twice.
 */
export const similarTriggerPairs = ({
    triggers = [],
    vectors = new Map(),
    witnesses = new Map(),
    limit = MAX_SIMILAR
} = {}) => {
    const rows = triggers
        .map(trigger => ({ id: idOf(trigger), label: labelOf(trigger) }))
        .filter(row => row.id && row.label && vectors.has(row.id));

    const seen = new Set();
    const pairs = [];

    rows.forEach(row => {
        const others = rows
            .filter(other => other.id !== row.id)
            .map(other => ({ entryClientId: other.id, vector: vectors.get(other.id).vector }));

        scan(vectors.get(row.id).vector, others, { limit: 0 }).forEach(hit => {
            const key = [row.id, hit.entryClientId].sort().join(' ');
            if (seen.has(key)) return;

            const mine = witnesses.get(row.id) || emptyWitness();
            const theirs = witnesses.get(hit.entryClientId) || emptyWitness();
            if (!witnessAgrees(mine, theirs)) return;

            seen.add(key);
            pairs.push({
                similarity: hit.similarity,
                a: { clientId: row.id, label: row.label },
                b: {
                    clientId: hit.entryClientId,
                    label: rows.find(other => other.id === hit.entryClientId)?.label ?? ''
                }
            });
        });
    });

    // Ordered here, stripped here: what leaves this function has no number on it either.
    return pairs
        .sort((one, two) => (
            two.similarity - one.similarity || one.a.clientId.localeCompare(two.a.clientId)
        ))
        .slice(0, limit)
        .map(({ a, b }) => ({ a, b }));
};
