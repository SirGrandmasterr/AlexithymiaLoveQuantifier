import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { App as CapacitorApp } from '@capacitor/app';
import { useSubjects } from './SubjectsContext';
import { isNative } from '../mobile/platform';
import { clearOutbox, readOutbox, writeOutbox } from '../mobile/offlineCache';
import {
    JOURNAL_COPY,
    JOURNAL_HISTORY_FROM,
    activeTriggers,
    civilDay,
    clientId,
    indexTriggers,
    isDayString,
    monthBounds,
    readTrigger
} from '../constants/journal';

/**
 * The journal's entries, for every screen that reads them.
 *
 * A **second context beside `SubjectsContext`, not a second store**. The two hold different
 * things and neither derives from the other: subjects and relationships are the people,
 * journal entries are what was said about them. What this provider must never do is fetch
 * the people itself — it reads them from `useSubjects()` (invariant 17), because a second
 * copy of the subject list is exactly the stale-copy bug `SubjectsContext` exists to kill.
 *
 * Everything goes through the **global `axios`** (trap 11). A private `axios.create()` would
 * sit outside the 401-renew-retry interceptor `App.jsx` installs, and the failure looks like
 * a screen that logs you out while the rest of the app does not.
 */
const JournalContext = createContext(null);

export const useJournal = () => {
    const value = useContext(JournalContext);
    if (!value) throw new Error('useJournal must be used inside a JournalProvider');
    return value;
};

/**
 * The range a freshly mounted provider loads: the month the current civil day falls in.
 *
 * A month rather than a week or a year because that is the unit the day view's strip draws
 * and the unit a reader moves in. Screens widen or move it with `loadRange`.
 */
export const defaultJournalRange = () => monthBounds(civilDay());

/** The kinds that put something on a day. A trigger row is vocabulary, not an event. */
const DAY_KINDS = new Set(['checkin', 'ritual', 'person_fact']);

/**
 * Whether a failed write may be queued rather than surfaced (§9.5), and it is three
 * conditions because the exception is only safe where all three hold.
 *
 * 1. **No response at all.** A transport failure is the tunnel, the airplane switch, or a
 *    server that is not there — the request never reached anything that could have stored it,
 *    so posting it again later cannot be a second write. A response, of any status, means the
 *    server *did* read the body; that is a different conversation and it belongs to the caller.
 * 2. **No `supersedes_id`.** An entry that corrects a stored row is an edit, and this queue
 *    deliberately has no answer for one (§9.5). A correction fails offline and says so.
 * 3. **Native.** In a browser the tab reloads and the server is one hop away; the offline
 *    exception exists for a phone that is carried out of range mid-sentence.
 */
const isQueueable = (body, error) => (
    !error?.response && body?.supersedes_id == null && isNative()
);

/**
 * A queued body, in the shape the day view draws entries in.
 *
 * `ID` is absent, not zero: the row id is the server's and this entry has never seen a server
 * (invariant 14). `pending` is what the *not yet synced* mark reads, and it is also what keeps
 * this row out of every reader that needs a row id — the day graph and the delete control.
 */
const pendingEntry = (item) => ({
    ...item.request,
    pending: true,
    outbox_error: item.error ?? null
});

/**
 * Whether this request creates a trigger row beside the entry it belongs to.
 *
 * A new trigger travels in the **same request** as the check-in that names it — `label` plus
 * a client-minted `client_id` in `triggers[]`, which the server turns into its own row inside
 * the same transaction (§7.2). That is the choice this session made over posting the trigger
 * first: two posts could land the trigger and lose the check-in, leaving a vocabulary entry
 * for a moment that was never recorded, and the outbox would then need to know that one of
 * them had succeeded — which is exactly the sequencing state a general sync engine is made of.
 * One request has no such state, and it is atomic on the server whether it is posted now or a
 * week later from a queue.
 */
const mintsTrigger = (request) => (
    Array.isArray(request?.triggers)
    && request.triggers.some(trigger => trigger?.client_id && trigger?.label)
);

/**
 * @param {boolean} enabled false while signed out — nothing to fetch, nothing to keep, and
 *   the flag a lost session flips to make this refetch when the user signs back in.
 * @param {number} reloadKey a refetch seam, for the same reason `SubjectsProvider` takes one
 *   — and, like that one, no longer passed by App since a dead session signs the user out
 *   rather than re-authenticating in place.
 */
export function JournalProvider({ children, enabled = true, reloadKey = 0 }) {
    // Invariant 17. The names this journal shows belong to the subject list, and this
    // provider reads them rather than fetching a second copy of them.
    const { relationships } = useSubjects();

    const [range, setRange] = useState(defaultJournalRange);
    const [entries, setEntries] = useState([]);
    const [days, setDays] = useState([]);
    const [loading, setLoading] = useState(enabled);
    const [loadError, setLoadError] = useState(null);
    /**
     * The outbox (§9.5) — entries saved with no connectivity, waiting to be posted.
     *
     * **Why a retry here can never create a duplicate, which is the whole safety argument.**
     * Every queued body carries a `client_id` this client minted before the first attempt
     * (`createEntry` below, and `clientId()` in `constants/journal.js`). `POST
     * /api/journal/entries` is idempotent on it: the first post stores the row and answers
     * `201`, and every later post of the same `client_id` answers **`200` with that same
     * stored row** — not `201` with a second one, and not `409` (§7.2). So the flush does not
     * have to know whether the previous attempt got through before the connection dropped, and
     * it never has to ask: it posts, and whichever of the two answers comes back means the
     * entry is stored exactly once. That property is the entire reason the journal may queue
     * writes when the rest of the app may not — see `offlineCache.js`'s header for the scope.
     *
     * Read from the device at mount, so a queue survives the app being killed and relaunched.
     * `[]` on the web, where this is inert.
     */
    const [outbox, setOutboxState] = useState(readOutbox);

    // The queue as the flush and the enqueue see it. State alone is not enough: a `resume`
    // listener registered once holds the array it closed over, and a flush that ran from a
    // stale copy would re-post what a flush a moment earlier had already cleared.
    const outboxRef = useRef(outbox);

    /** The one writer. Memory, disk and the ref move together or the queue is a lie. */
    const setOutbox = useCallback((update) => {
        const next = typeof update === 'function' ? update(outboxRef.current) : update;
        outboxRef.current = next;
        writeOutbox(next);
        setOutboxState(next);
    }, []);

    // One flush at a time. Three signals fire it — a successful fetch, `resume`, and
    // pull-to-refresh — and on a phone waking up on a train they arrive within milliseconds
    // of each other. The server would answer the second post `200` and store nothing twice,
    // so this guard is about the wasted round trip, not about correctness.
    const flushing = useRef(false);

    // The flush, reachable from `refresh` without either depending on the other. They call
    // each other — a successful fetch flushes, and a flush that minted a trigger refetches —
    // and a direct dependency between the two callbacks would be a cycle React cannot build.
    const flushRef = useRef(null);

    /**
     * Put one row the server echoed into the loaded list, wherever it came from.
     *
     * Shared by the online write and the flush because they are the same event arriving at
     * two different times, and a second copy of this reasoning would be a second place for the
     * replay case to be got wrong.
     */
    const absorbEntry = useCallback((created) => {
        if (!created?.client_id) return;

        setEntries(previous => {
            // A replayed post echoes the row that already exists; splicing it twice would
            // draw the same check-in twice on the day it belongs to.
            const withoutReplay = previous.filter(row => row.client_id !== created.client_id);
            // A correction stamped the row it replaces `superseded_at` server-side, and
            // every reader here shows only what is current, so it leaves the list.
            const live = created.supersedes_id
                ? withoutReplay.filter(row => row.ID !== created.supersedes_id)
                : withoutReplay;

            return [...live, created];
        });
    }, []);

    const { from, to } = range;

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            // In parallel, as `SubjectsProvider` does: the day list and the day counts are
            // independent, and the screen wants both before it can draw a month.
            const params = { from, to };
            const [entriesResponse, daysResponse] = await Promise.all([
                axios.get('/api/journal/entries', { params }),
                axios.get('/api/journal/days', { params })
            ]);

            setEntries(Array.isArray(entriesResponse.data) ? entriesResponse.data : []);
            setDays(Array.isArray(daysResponse.data) ? daysResponse.data : []);
            setLoadError(null);

            // A fetch that came back is the app's own proof that there is a connection, and
            // it is the cheapest such proof available: no probe, no `navigator.onLine` (which
            // reports the radio, not reachability), no timer. Pull-to-refresh reaches the
            // flush through this same line, because that gesture calls exactly this function.
            //
            // Not awaited: the day the user is reading is on screen the moment these two
            // responses land, and a queued check-in from yesterday is not a reason to hold it.
            flushRef.current?.();
        } catch (error) {
            console.error('Failed to fetch journal entries', error);
            // The screen renders this in its own slot and keeps drawing the day around it
            // (Recipe 5). There is still no read-through cache here, and there is deliberately
            // none: the outbox below is the journal's whole answer to no connectivity, and it
            // is an answer about *writes*. A day that cannot be fetched says so.
            setLoadError(error?.response?.data?.error || JOURNAL_COPY.day.loadError);
        } finally {
            setLoading(false);
        }
    }, [from, to]);

    useEffect(() => {
        if (enabled) {
            refresh();
        } else {
            setEntries([]);
            setDays([]);
            setLoading(false);
            setLoadError(null);
            // Signed out, or a session that died: the queue goes with it, from memory and
            // from the device both. An unsent check-in is the most private thing this app
            // holds, and leaving it on disk for whoever signs in next — or for a `POST` that
            // would land it under a second user's id — is the one outcome worse than losing
            // it. `SubjectsContext` clears the offline cache on this same branch and for the
            // same reason.
            outboxRef.current = [];
            setOutboxState([]);
            clearOutbox();
        }
    }, [enabled, refresh, reloadKey]);

    /**
     * Post everything queued, oldest first, and stop at the first sign there is still no
     * connection.
     *
     * `200` and `201` are both success and are treated identically — the server either stored
     * it now or had stored it already, and either way the entry is on the server exactly once
     * and has no further business in this queue. Only a rejection keeps an item.
     *
     * The two rejections are different, and telling them apart is what keeps this from being
     * either a data-loss bug or an infinite loop:
     *
     * - **No response** — still no connection. The remaining items would fail the same way, so
     *   the flush stops rather than posting a queue's worth of doomed requests, and everything
     *   stays queued for the next signal.
     * - **A response** — the server read this body and refused it (a `400` naming a field, or
     *   a `404` for a person deleted on another device while this one was offline). Posting it
     *   again cannot change that answer, so the item is marked with the server's message and
     *   skipped from here on. It stays in the queue and stays on the screen: an entry the user
     *   wrote is never dropped without saying so (invariant 13).
     */
    const flushOutbox = useCallback(async () => {
        if (flushing.current || outboxRef.current.length === 0) return;
        flushing.current = true;

        try {
            let mintedTrigger = false;

            for (const item of outboxRef.current.filter(row => !row.error)) {
                try {
                    const response = await axios.post('/api/journal/entries', item.request);
                    absorbEntry(response.data);
                    if (mintsTrigger(item.request)) mintedTrigger = true;
                    setOutbox(previous => previous.filter(row => row.client_id !== item.client_id));
                } catch (error) {
                    if (!error?.response) break;

                    console.error('The server refused a queued journal entry', error);
                    const message = error.response?.data?.error || JOURNAL_COPY.checkin.saveError;
                    setOutbox(previous => previous.map(row => (
                        row.client_id === item.client_id ? { ...row, error: message } : row
                    )));
                }
            }

            // Same reason as `createEntry`'s: the response to a check-in that minted a trigger
            // echoes the check-in and not the trigger row beside it (§7.2), so the vocabulary
            // is only correct after a refetch. This cannot recurse — that refetch flushes an
            // outbox this loop has just emptied of everything postable.
            if (mintedTrigger) refresh();
        } finally {
            flushing.current = false;
        }
    }, [absorbEntry, refresh, setOutbox]);

    flushRef.current = flushOutbox;

    /**
     * The second signal (§9.5). A phone is resumed rather than reloaded, and coming back to
     * the app is both the moment a tunnel is most likely to be behind the user and the moment
     * they are looking at a launcher animation rather than at a screen this could hold up.
     *
     * It overlaps with the fetch signal above on purpose, exactly as `useSessionRenewal` lets
     * `visibilitychange` and `resume` overlap: a doubled signal costs the guard above one
     * comparison, and a missed one costs the user a check-in that sits queued until they
     * happen to pull the day down.
     */
    useEffect(() => {
        if (!enabled || !isNative()) return undefined;

        const handle = CapacitorApp.addListener('resume', () => { flushRef.current?.(); });
        return () => { handle.then?.((listener) => listener.remove()); };
    }, [enabled]);

    /**
     * Move the loaded window. Replaces rather than widens: the day view asks for the month
     * it is showing, and a window that only ever grew would refetch a year to draw a week.
     */
    const loadRange = useCallback((nextFrom, nextTo) => {
        if (!isDayString(nextFrom) || !isDayString(nextTo) || nextTo < nextFrom) return;

        setRange(previous => (
            previous.from === nextFrom && previous.to === nextTo
                ? previous
                : { from: nextFrom, to: nextTo }
        ));
    }, []);

    /**
     * Load the whole history rather than one month.
     *
     * The People and Triggers views count entries, and the *remove this person from the
     * journal* dialog states its count as a fact before doing the thing. Both are wrong if
     * the loaded window is the month the day view happened to leave behind — a person named
     * every week would report four mentions in August and four again in September, and the
     * dialog would promise to remove a number that is not what goes.
     *
     * It replaces the range rather than widening it, like `loadRange`: navigating back to a
     * day narrows it to that month again, so the wide window is the two screens that need
     * it and nothing else. See `JOURNAL_HISTORY_FROM` for what its floor is and is not.
     */
    const loadAll = useCallback(() => {
        loadRange(JOURNAL_HISTORY_FROM, civilDay());
    }, [loadRange]);

    /**
     * Write one entry.
     *
     * The `client_id` is minted here when the caller did not bring one, so that every writer
     * in the app is idempotent by construction: the same entry posted twice is one row
     * (§7.2), which is what makes the outbox's retry safe rather than duplicating.
     *
     * Rejects on failure, like `createSubject`: only the caller knows whether a composer
     * should stay open. **With one exception** — a write that never reached a server, on a
     * phone, that is not a correction, is queued instead and resolves with a pending row
     * (§9.5). The caller closes its composer either way, which is the point: the user's
     * check-in is kept, and the day view marks it *not yet synced* until it lands.
     */
    const createEntry = useCallback(async (entry) => {
        const body = { ...entry, client_id: entry?.client_id || clientId() };

        let created;
        try {
            const response = await axios.post('/api/journal/entries', body);
            created = response.data;
        } catch (error) {
            // §9.5, and the narrowest branch in this file. Only a write that never reached a
            // server, is not a correction, and is running on a phone is queued; everything
            // else rejects exactly as it did before F1, and the caller shows its own message.
            if (!isQueueable(body, error)) throw error;

            console.error('Queued a journal entry with no connectivity', error);
            // Keyed by `client_id`, and that is §9.5's *"a correction of an unsynced entry
            // replaces it in the outbox"*: a caller that saves again under the id it already
            // used replaces what is queued rather than queueing a second check-in of the same
            // moment. It is also what makes enqueueing idempotent under a double tap.
            const item = { client_id: body.client_id, request: body, queued_at: Date.now(), error: null };
            setOutbox(previous => {
                const existing = previous.findIndex(row => row.client_id === item.client_id);
                if (existing === -1) return [...previous, item];

                const next = [...previous];
                // The position is kept, so the queue stays in the order the entries were
                // written; only the body is new.
                next[existing] = { ...item, queued_at: previous[existing].queued_at };
                return next;
            });

            // The composer closes on this, and it should: the check-in is kept and marked,
            // which is a different thing from lost. `day` is the caller's own, so a screen
            // that follows the saved entry to its day still follows it.
            return pendingEntry(item);
        }

        absorbEntry(created);

        // A new trigger is created **as its own row, in the same transaction** (§7.2), and
        // the response echoes only the entry that named it. So a trigger minted a moment
        // ago is in no list this provider holds, and the next composer would offer the user
        // nothing but "new trigger: work?" a second time — one label, two rows, and every
        // question asked afterwards grouped on the wrong key. Asking the server what it
        // actually stored is the only honest answer; inventing the row here would be a
        // guess at an id and an `at` this client never saw.
        //
        // Deliberately **not** awaited: the write has landed, and a composer that sits on
        // "Saving…" for two more round trips is a worse thing than a vocabulary that
        // catches up a moment later. `refresh` swallows its own failures into `loadError`.
        if (mintsTrigger(body)) refresh();

        return created;
    }, [absorbEntry, refresh, setOutbox]);

    /** Soft-delete, by row id. The server answers 404 for an id that is not this user's. */
    const deleteEntry = useCallback(async (id) => {
        await axios.delete(`/api/journal/entries/${id}`);
        setEntries(previous => previous.filter(row => row.ID !== id));
    }, []);

    /**
     * §10.6 — everything the journal holds *about* one person, gone in one action: their
     * confirmed facts soft-deleted, every mention of them detached from the person.
     *
     * It is one server call rather than a loop of deletes because the two halves belong in
     * one transaction: a run that soft-deleted three facts and then failed to detach would
     * leave the user having asked for one thing and got half of it, with no way to tell.
     *
     * The entries themselves survive, and so does each mention's `label` — the name as it
     * was said that day. Deleting a person should not rewrite the user's own record of a
     * day, which is the rule `DeleteRelationship` already follows for its own mentions.
     *
     * Refetched rather than spliced: the change is spread across entries of three kinds and
     * a mention rows the client would have to edit in place, and the range is the one this
     * screen already asked for.
     */
    const removePersonFromJournal = useCallback(async (relationshipId) => {
        const response = await axios.delete(`/api/journal/people/${relationshipId}`);
        await refresh();
        return response.data;
    }, [refresh]);

    const entriesByDay = useMemo(() => {
        const byDay = new Map();
        entries.forEach(entry => {
            if (!byDay.has(entry.day)) byDay.set(entry.day, []);
            byDay.get(entry.day).push(entry);
        });
        return byDay;
    }, [entries]);

    /** One day's entries, in the server's order: `day`, then `at`, then id. */
    const entriesForDay = useCallback((day) => entriesByDay.get(day) ?? [], [entriesByDay]);

    /**
     * The queue in entry shape, oldest first.
     *
     * Kept **beside** `entries` rather than merged into it, and that is the deliberate half
     * of this. `entries` is what the server holds, and half the app reads it through a row
     * id: the day graph opens a check-in by `ID`, the delete dialog names one, the People and
     * Triggers views count them. A pending row has no id, so merging it would put an
     * id-shaped hole into every one of those readers at once. The day view asks for both
     * lists and draws the pending ones with their mark; nothing else has to know.
     */
    const pendingEntries = useMemo(() => outbox.map(pendingEntry), [outbox]);

    /** One day's queued entries. The day view draws these under the day's stored ones. */
    const pendingForDay = useCallback(
        (day) => pendingEntries.filter(entry => entry.day === day),
        [pendingEntries]
    );

    const triggerEntries = useMemo(
        () => entries.filter(entry => entry.kind === 'trigger'),
        [entries]
    );

    /**
     * The vocabulary indexed by every id it speaks for, built once per set of rows.
     *
     * `readTrigger` builds this itself when handed the array, which is right for resolving
     * one id and wrong for the two screens that resolve thousands: the triggers view walks
     * every reference in the whole history for every trigger, so a per-call rebuild is N×T
     * index builds in one render. Memoising it here is what makes those callers one pass —
     * and it stays as fresh as the rows, because `triggerEntries` is its only dependency.
     */
    const triggerIndex = useMemo(() => indexTriggers(triggerEntries), [triggerEntries]);

    /** The trigger vocabulary as the UI may offer it: live rows, resolved to their labels. */
    const triggers = useMemo(
        () => activeTriggers(triggerEntries).map(entry => readTrigger(entry, triggerIndex)),
        [triggerEntries, triggerIndex]
    );

    /**
     * What one trigger id means now. A check-in references whatever id was live the day it
     * was written, and this walks that id forward through every rename and merge since —
     * see `readTrigger` for why the walk needs `corrects` rather than one hop.
     */
    const resolveTrigger = useCallback(
        (idOrEntry) => readTrigger(idOrEntry, triggerIndex),
        [triggerIndex]
    );

    const relationshipsById = useMemo(
        () => new Map(relationships.map(relationship => [relationship.ID, relationship])),
        [relationships]
    );

    /**
     * The name to show for one mention.
     *
     * The relationship's current name wins, so a rename is visible on every entry that ever
     * named the person. The label stored on the mention is the fallback, and it is what is
     * left when the relationship has been deleted — a quotation of the name as it was said
     * that day, which is the honest thing to show and never enough to recreate the person.
     */
    const personName = useCallback((mention) => {
        const known = mention?.relationship_id != null
            ? relationshipsById.get(mention.relationship_id)
            : null;
        return known?.name || mention?.label || '';
    }, [relationshipsById]);

    /**
     * Which days in the loaded range have something on them — what the month strip marks.
     *
     * Both sources are consulted on purpose. `/api/journal/days` is the cheap grouped count
     * the strip is built on; the entries in state are what a write since the last fetch has
     * added, so a check-in saved a moment ago marks its day without waiting for a refetch.
     */
    const markedDays = useMemo(() => {
        const marked = new Set(
            days.filter(row => row.checkins > 0 || row.ritual || row.people > 0).map(row => row.day)
        );
        entries.forEach(entry => {
            if (DAY_KINDS.has(entry.kind)) marked.add(entry.day);
        });
        // And a queued one marks its day too. It is the user's own record of that day whether
        // or not it has reached a server yet, and a strip that unmarked the day a check-in was
        // saved on, because the train was in a tunnel, would be reporting the connection.
        pendingEntries.forEach(entry => {
            if (DAY_KINDS.has(entry.kind)) marked.add(entry.day);
        });
        return marked;
    }, [days, entries, pendingEntries]);

    const value = useMemo(() => ({
        range,
        entries,
        days,
        markedDays,
        triggers,
        // The raw `kind: "trigger"` rows, superseded ones already filtered out by the
        // server. The triggers view needs them and `triggers` is not enough: a correction
        // carries `supersedes_id`, which is the **row** id, and that only exists here.
        triggerEntries,
        // §9.5. The raw queue, its derived entry rows, and the day reader the view uses.
        outbox,
        pendingEntries,
        pendingForDay,
        flushOutbox,
        loading,
        loadError,
        dismissLoadError: () => setLoadError(null),
        loadRange,
        loadAll,
        refresh,
        createEntry,
        deleteEntry,
        removePersonFromJournal,
        entriesForDay,
        resolveTrigger,
        personName
    }), [
        range, entries, days, markedDays, triggers, triggerEntries, outbox, pendingEntries,
        pendingForDay, flushOutbox, loading, loadError,
        loadRange, loadAll, refresh, createEntry, deleteEntry, removePersonFromJournal,
        entriesForDay, resolveTrigger, personName
    ]);

    return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
}

export default JournalContext;
