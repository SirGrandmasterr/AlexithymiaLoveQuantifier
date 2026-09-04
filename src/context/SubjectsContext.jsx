import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { latestSnapshotDate } from '../constants/cadence';
import { readCache, writeCache, clearCache } from '../mobile/offlineCache';

const SubjectsContext = createContext(null);

export const useSubjects = () => {
    const value = useContext(SubjectsContext);
    if (!value) throw new Error('useSubjects must be used inside a SubjectsProvider');
    return value;
};

export const stackKey = (person) => (
    person.relationship_id ?? `unlinked-${person.ID}`
);

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

export const buildStacks = (people, relationships) => {
    const byId = new Map(relationships.map(relationship => [relationship.ID, relationship]));

    return groupPeople(people).map(versions => {
        const known = byId.get(versions[0].relationship_id);
        return {
            relationship: {
                ID: versions[0].relationship_id,
                name: known?.name ?? versions[0].name,
                cadence_days: known?.cadence_days ?? null,
                snapshot_count: versions.length,
                mention_count: known?.mention_count ?? 0,
                latest_date: latestSnapshotDate(versions)
            },
            versions
        };
    });
};

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
