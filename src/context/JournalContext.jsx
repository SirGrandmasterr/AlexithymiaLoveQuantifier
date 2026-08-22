import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useSubjects } from './SubjectsContext';
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
 * @param {boolean} enabled false while signed out — nothing to fetch, nothing to keep.
 * @param {number} reloadKey bumped by App when a lost session is re-authenticated in place,
 *   for the same reason `SubjectsProvider` takes one: the requests that failed while the
 *   session was dead are not replayed individually, the range is simply fetched again.
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
    // F1's outbox, empty and read-only until that session builds it. It is in the value
    // now so the day view can be written against a shape that will not change under it —
    // an entry saved with no connectivity lands here and carries a "not yet synced" mark.
    const [outbox] = useState([]);

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
        } catch (error) {
            console.error('Failed to fetch journal entries', error);
            // The screen renders this in its own slot and keeps drawing the day around it
            // (Recipe 5). There is no offline cache here: the outbox in F1 is the journal's
            // answer to no connectivity, and half of one now would be a promise the code
            // cannot keep.
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
        }
    }, [enabled, refresh, reloadKey]);

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
     * (§7.2), which is what makes F1's retry safe rather than duplicating.
     *
     * Rejects on failure, like `createSubject`: only the caller knows whether a composer
     * should stay open.
     */
    const createEntry = useCallback(async (entry) => {
        const body = { ...entry, client_id: entry?.client_id || clientId() };
        const response = await axios.post('/api/journal/entries', body);
        const created = response.data;

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
        const mintedTrigger = Array.isArray(entry?.triggers)
            && entry.triggers.some(trigger => trigger?.client_id && trigger?.label);
        if (mintedTrigger) refresh();

        return created;
    }, [refresh]);

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
        return marked;
    }, [days, entries]);

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
        outbox,
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
        range, entries, days, markedDays, triggers, triggerEntries, outbox, loading, loadError,
        loadRange, loadAll, refresh, createEntry, deleteEntry, removePersonFromJournal,
        entriesForDay, resolveTrigger, personName
    ]);

    return <JournalContext.Provider value={value}>{children}</JournalContext.Provider>;
}

export default JournalContext;
