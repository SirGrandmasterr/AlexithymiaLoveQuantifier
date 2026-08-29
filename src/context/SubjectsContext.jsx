import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { latestSnapshotDate } from '../constants/cadence';
import { readCache, writeCache, clearCache } from '../mobile/offlineCache';

/**
 * One copy of the subject list, shared by every screen that reads it.
 *
 * Before this existed the dashboard owned `people` and handed the timeline a captured
 * array, so an edit made while the timeline was open left it showing stale numbers. Now
 * both screens derive from the same state and a mutation is visible everywhere at once.
 */
const SubjectsContext = createContext(null);

export const useSubjects = () => {
    const value = useContext(SubjectsContext);
    if (!value) throw new Error('useSubjects must be used inside a SubjectsProvider');
    return value;
};

/**
 * The key a snapshot groups under. Every snapshot carries a relationship_id: the server's
 * find-or-create sets it on write and the startup backfill sets it on everything older.
 * A row arriving without one would be a server bug, so it gets a stack of its own rather
 * than silently merging with every other unlinked row.
 */
export const stackKey = (person) => (
    person.relationship_id ?? `unlinked-${person.ID}`
);

/**
 * The stack abstraction: all versions of one relationship.
 *
 * Grouping used to be exact equality on the name string, which is why a stack could not be
 * renamed and two different people called Alex merged into one. It is now the relationship
 * id, so the name is just a label — see docs/01-concepts.md#the-stack-abstraction.
 */
export const groupPeople = (people) => {
    const groups = new Map();
    people.forEach(person => {
        const key = stackKey(person);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(person);
    });
    return [...groups.values()];
};

/** All versions of one relationship, or an empty array when the id is unknown. */
export const findStack = (people, relationshipId) => (
    people.filter(person => person.relationship_id === relationshipId)
);

/**
 * Pairs each group of versions with the relationship it belongs to.
 *
 * The server owns identity and ordering; the count comes from the versions actually
 * loaded, so what a stack reports is always what the user can see. A group whose
 * relationship is missing from the list falls back to the name denormalized on its
 * snapshots, so a card is never silently dropped.
 */
export const buildStacks = (people, relationships) => {
    const byId = new Map(relationships.map(relationship => [relationship.ID, relationship]));

    return groupPeople(people).map(versions => {
        const known = byId.get(versions[0].relationship_id);
        return {
            relationship: {
                ID: versions[0].relationship_id,
                name: known?.name ?? versions[0].name,
                // The rhythm is the server's to hold; the count and the latest date are
                // derived from the versions actually loaded, so both stay correct the
                // instant a snapshot is added without waiting for a refetch.
                cadence_days: known?.cadence_days ?? null,
                snapshot_count: versions.length,
                // The journal's count, unlike the two above, has no client-side source to
                // derive it from — the dashboard holds no entries. It comes through as the
                // server sent it, and falls back to 0 for a stack whose relationship is
                // missing from the list, which is the same case the name falls back in.
                // The delete dialog omits its journal clause at 0, so a fallback understates
                // rather than inventing a number.
                mention_count: known?.mention_count ?? 0,
                latest_date: latestSnapshotDate(versions)
            },
            versions
        };
    });
};

/**
 * @param {boolean} enabled false while signed out — nothing to fetch, nothing to keep.
 *   This is also how a lost session refetches: it sets the token to null and signing back in
 *   sets it again, so this flips false and true and the effect below re-runs on its own.
 * @param {number} reloadKey a refetch seam for a caller that needs one without `enabled`
 *   changing. **App no longer passes it.** It existed for re-authenticating *in place*,
 *   behind an overlay, and that path was removed — a dead session now signs the user out.
 *   Kept because it costs one line and forcing a refetch is a reasonable thing to want.
 */
export function SubjectsProvider({ children, enabled = true, reloadKey = 0 }) {
    const [people, setPeople] = useState([]);
    const [relationships, setRelationships] = useState([]);
    const [loading, setLoading] = useState(enabled);
    const [loadError, setLoadError] = useState(null);
    // Non-null while the screen is showing cached data rather than a live fetch; carries the
    // timestamp, because "offline" without "as of when" is not enough to act on.
    const [staleSince, setStaleSince] = useState(null);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            // In parallel: neither depends on the other, and both are needed before the
            // dashboard can draw a single stack.
            const [subjectsResponse, relationshipsResponse] = await Promise.all([
                axios.get('/api/subjects'),
                axios.get('/api/relationships')
            ]);
            setPeople(subjectsResponse.data);
            setRelationships(relationshipsResponse.data);
            setLoadError(null);
            setStaleSince(null);
            // Native only — `writeCache` is a no-op on web. See `src/mobile/offlineCache.js`
            // for why this is read-through and does not queue writes.
            writeCache(subjectsResponse.data, relationshipsResponse.data);
        } catch (error) {
            console.error('Failed to fetch subjects', error);

            // A transport failure on a phone is ordinary — a tunnel, a dropped Wi-Fi hop —
            // and the last good list is a better answer than an empty screen. A response
            // *with* a status is the server talking, so it is reported as before.
            const cached = error.response ? null : readCache();
            if (cached) {
                setPeople(cached.people);
                setRelationships(cached.relationships);
                setLoadError(null);
                setStaleSince(cached.savedAt);
            } else {
                setLoadError(
                    error?.response?.data?.error ||
                    'Could not load your analyses. Check that the server is running, then reload.'
                );
            }
        } finally {
            setLoading(false);
        }
    }, []);

    // Anonymous visitors have nothing to fetch, and logging out should not leave the
    // previous user's snapshots in memory.
    useEffect(() => {
        if (enabled) {
            refresh();
        } else {
            setPeople([]);
            setRelationships([]);
            setLoading(false);
            setStaleSince(null);
            // Logging out must not leave the previous user's snapshots on disk for the next
            // one to find. The in-memory reset above would otherwise be undone by the first
            // failed fetch after a new sign-in.
            //
            // This now also runs when a session is *lost* rather than only when the user
            // signs out deliberately. It did not before: a dead session used to keep `token`
            // set behind an overlay, so `enabled` stayed true and the Android offline cache
            // outlived the session it belonged to.
            clearCache();
        }
        // `reloadKey` stays in the dependency list so the seam works for any caller that
        // passes one; App does not.
    }, [enabled, refresh, reloadKey]);

    // Mutations reject on failure: the caller owns the message, since only it knows
    // whether a form should stay open. All of them splice the echoed row into state.
    const createSubject = useCallback(async (payload) => {
        const response = await axios.post('/api/subjects', payload);
        const created = response.data;

        setPeople(prev => [...prev, created]);
        // A snapshot under a new name creates its relationship server-side; without this
        // the stack would render off the fallback name until the next reload.
        setRelationships(prev => (
            prev.some(relationship => relationship.ID === created.relationship_id)
                ? prev
                : [...prev, { ID: created.relationship_id, name: created.name }]
        ));

        return created;
    }, []);

    const updateSubject = useCallback(async (id, payload) => {
        const response = await axios.put(`/api/subjects/${id}`, payload);
        setPeople(prev => prev.map(person => (person.ID === id ? response.data : person)));
        return response.data;
    }, []);

    const deleteSubject = useCallback(async (id) => {
        await axios.delete(`/api/subjects/${id}`);
        setPeople(prev => prev.filter(person => person.ID !== id));
    }, []);

    // Renaming the stack renames every version with it — the server syncs the name it
    // keeps denormalized on each snapshot, and this mirrors that locally.
    const renameRelationship = useCallback(async (relationshipId, name) => {
        const response = await axios.patch(`/api/relationships/${relationshipId}`, { name });
        const renamed = response.data;

        setRelationships(prev => prev.map(relationship => (
            relationship.ID === relationshipId ? { ...relationship, name: renamed.name } : relationship
        )));
        setPeople(prev => prev.map(person => (
            person.relationship_id === relationshipId ? { ...person, name: renamed.name } : person
        )));

        return renamed;
    }, []);

    // `null` is sent explicitly, not omitted: the server reads an absent key as "leave the
    // rhythm alone" and an explicit null as "turn reminders off".
    const setCadence = useCallback(async (relationshipId, days) => {
        const response = await axios.patch(`/api/relationships/${relationshipId}`, {
            cadence_days: days ?? null
        });

        setRelationships(prev => prev.map(relationship => (
            relationship.ID === relationshipId
                ? { ...relationship, cadence_days: response.data.cadence_days }
                : relationship
        )));

        return response.data;
    }, []);

    const mergeRelationships = useCallback(async (targetId, sourceId) => {
        const response = await axios.post(`/api/relationships/${targetId}/merge`, { source_id: sourceId });
        const merged = response.data;

        setPeople(prev => prev.map(person => (
            person.relationship_id === sourceId
                ? { ...person, relationship_id: targetId, name: merged.name }
                : person
        )));
        setRelationships(prev => prev.filter(relationship => relationship.ID !== sourceId));

        return merged;
    }, []);

    const deleteRelationship = useCallback(async (relationshipId) => {
        await axios.delete(`/api/relationships/${relationshipId}`);
        setPeople(prev => prev.filter(person => person.relationship_id !== relationshipId));
        setRelationships(prev => prev.filter(relationship => relationship.ID !== relationshipId));
    }, []);

    const stacks = useMemo(() => buildStacks(people, relationships), [people, relationships]);

    const value = {
        people,
        relationships,
        stacks,
        loading,
        loadError,
        staleSince,
        dismissLoadError: () => setLoadError(null),
        refresh,
        createSubject,
        updateSubject,
        deleteSubject,
        renameRelationship,
        setCadence,
        mergeRelationships,
        deleteRelationship
    };

    return <SubjectsContext.Provider value={value}>{children}</SubjectsContext.Provider>;
}

export default SubjectsContext;
