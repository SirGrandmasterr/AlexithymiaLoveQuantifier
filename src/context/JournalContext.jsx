import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { App as CapacitorApp } from '@capacitor/app';
import { useSubjects } from './SubjectsContext';
import { isNative } from '../mobile/platform';
import { clearOutbox, readOutbox, writeOutbox } from '../mobile/offlineCache';
import { clearVectorIndex } from '../journal/embeddings/store';
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

const JournalContext = createContext(null);

export const useJournal = () => {
    const value = useContext(JournalContext);
    if (!value) throw new Error('useJournal must be used inside a JournalProvider');
    return value;
};

export const defaultJournalRange = () => monthBounds(civilDay());

/** The kinds that put something on a day. A trigger row is vocabulary, not an event. */
const DAY_KINDS = new Set(['checkin', 'ritual', 'person_fact']);

const isQueueable = (body, error) => (
    !error?.response && body?.supersedes_id == null && isNative()
);

const pendingEntry = (item) => ({
    ...item.request,
    pending: true,
    outbox_error: item.error ?? null
});

const mintsTrigger = (request) => (
    Array.isArray(request?.triggers)
    && request.triggers.some(trigger => trigger?.client_id && trigger?.label)
);

export function JournalProvider({ children, enabled = true, reloadKey = 0 }) {
    // Invariant 17. The names this journal shows belong to the subject list, and this
    // provider reads them rather than fetching a second copy of them.
    const { relationships } = useSubjects();

    const [range, setRange] = useState(defaultJournalRange);
    const [entries, setEntries] = useState([]);
    const [days, setDays] = useState([]);
    const [loading, setLoading] = useState(enabled);
    const [loadError, setLoadError] = useState(null);
    const [outbox, setOutboxState] = useState(readOutbox);

    const outboxRef = useRef(outbox);

    /** The one writer. Memory, disk and the ref move together or the queue is a lie. */
    const setOutbox = useCallback((update) => {
        const next = typeof update === 'function' ? update(outboxRef.current) : update;
        outboxRef.current = next;
        writeOutbox(next);
        setOutboxState(next);
    }, []);

    const flushing = useRef(false);

    const flushRef = useRef(null);

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

            flushRef.current?.();
        } catch (error) {
            console.error('Failed to fetch journal entries', error);
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
            outboxRef.current = [];
            setOutboxState([]);
            clearOutbox();
            clearVectorIndex().catch(() => { /* nothing to do; there is no screen for it */ });
        }
    }, [enabled, refresh, reloadKey]);

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

            if (mintedTrigger) refresh();
        } finally {
            flushing.current = false;
        }
    }, [absorbEntry, refresh, setOutbox]);

    flushRef.current = flushOutbox;

    useEffect(() => {
        if (!enabled || !isNative()) return undefined;

        const handle = CapacitorApp.addListener('resume', () => { flushRef.current?.(); });
        return () => { handle.then?.((listener) => listener.remove()); };
    }, [enabled]);

    const loadRange = useCallback((nextFrom, nextTo) => {
        if (!isDayString(nextFrom) || !isDayString(nextTo) || nextTo < nextFrom) return;

        setRange(previous => (
            previous.from === nextFrom && previous.to === nextTo
                ? previous
                : { from: nextFrom, to: nextTo }
        ));
    }, []);

    const loadAll = useCallback(() => {
        loadRange(JOURNAL_HISTORY_FROM, civilDay());
    }, [loadRange]);

    const createEntry = useCallback(async (entry) => {
        const body = { ...entry, client_id: entry?.client_id || clientId() };

        let created;
        try {
            const response = await axios.post('/api/journal/entries', body);
            created = response.data;
        } catch (error) {
            if (!isQueueable(body, error)) throw error;

            console.error('Queued a journal entry with no connectivity', error);
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

            return pendingEntry(item);
        }

        absorbEntry(created);

        if (mintsTrigger(body)) refresh();

        return created;
    }, [absorbEntry, refresh, setOutbox]);

    /** Soft-delete, by row id. The server answers 404 for an id that is not this user's. */
    const deleteEntry = useCallback(async (id) => {
        await axios.delete(`/api/journal/entries/${id}`);
        setEntries(previous => previous.filter(row => row.ID !== id));
    }, []);

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

    const triggerIndex = useMemo(() => indexTriggers(triggerEntries), [triggerEntries]);

    /** The trigger vocabulary as the UI may offer it: live rows, resolved to their labels. */
    const triggers = useMemo(
        () => activeTriggers(triggerEntries).map(entry => readTrigger(entry, triggerIndex)),
        [triggerEntries, triggerIndex]
    );

    const resolveTrigger = useCallback(
        (idOrEntry) => readTrigger(idOrEntry, triggerIndex),
        [triggerIndex]
    );

    const relationshipsById = useMemo(
        () => new Map(relationships.map(relationship => [relationship.ID, relationship])),
        [relationships]
    );

    const personName = useCallback((mention) => {
        const known = mention?.relationship_id != null
            ? relationshipsById.get(mention.relationship_id)
            : null;
        return known?.name || mention?.label || '';
    }, [relationshipsById]);

    const markedDays = useMemo(() => {
        const marked = new Set(
            days.filter(row => row.checkins > 0 || row.ritual || row.people > 0).map(row => row.day)
        );
        entries.forEach(entry => {
            if (DAY_KINDS.has(entry.kind)) marked.add(entry.day);
        });
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
