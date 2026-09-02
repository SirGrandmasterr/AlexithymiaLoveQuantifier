import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RitualVoiceConfirm } from './RitualVoice';
import { JOURNAL_COPY, fillCopy, ritualDeck } from '../constants/journal';
import { buildRitualRequest } from './RitualCards';

/**
 * §3.7's confirm card, and the one rule it exists to keep: **a question the note did not
 * mention is absent, not false.**
 *
 * The card is tested apart from the recorder because that is the boundary that matters. What
 * the microphone does is C2's and C4's; what happens between a proposal and a saved row is
 * this, and it is where invariant 14 and invariant 15 both live.
 */

const deck = ritualDeck([]);

const renderCard = (proposed, { people = [], onKeep = vi.fn(), onCards = vi.fn() } = {}) => {
    render(
        <RitualVoiceConfirm
            deck={deck}
            proposed={proposed}
            people={people}
            onKeep={onKeep}
            onCards={onCards}
        />
    );
    return { onKeep, onCards };
};

const row = (id, value) => document.querySelector(`[data-ritual-row="${id}"][data-choice="${value}"]`);
const picked = (id) => ['true', 'false'].find(value => row(id, value)?.getAttribute('aria-pressed') === 'true') ?? null;
const dashed = (id, value) => row(id, value).className.includes('border-dashed');

describe('the ritual-by-voice confirm card', () => {
    /** What a real pass produced on 2026-09-02, for "Slept okay, didn't move, was outside, saw Lucie, ate late." */
    const fixture = { slept_well: false, moved_body: false, daylight: true, with_people: true };

    it('draws one row per question the deck asked, not per answer the model gave', () => {
        renderCard(fixture);
        deck.forEach((question) => {
            expect(screen.getByText(question.text)).toBeInTheDocument();
            expect(row(question.id, 'true')).toBeInTheDocument();
            expect(row(question.id, 'false')).toBeInTheDocument();
        });
    });

    it('pre-selects exactly the questions the fixture answered, and leaves the others empty', () => {
        renderCard(fixture);

        expect(picked('slept_well')).toBe('false');
        expect(picked('moved_body')).toBe('false');
        expect(picked('daylight')).toBe('true');
        expect(picked('with_people')).toBe('true');
        // The note said "ate late", which answers nothing about eating *regularly*. Nothing
        // is chosen, and nothing implies a choice.
        expect(picked('ate_regularly')).toBeNull();
    });

    it('draws every pre-selected answer dashed, because none of them is saved yet', () => {
        renderCard(fixture);
        Object.entries(fixture).forEach(([id, value]) => {
            expect(dashed(id, String(value))).toBe(true);
        });
    });

    it('saves exactly the confirmed answers, with the unmentioned question **absent**', async () => {
        const { onKeep } = renderCard(fixture);
        await userEvent.click(screen.getByText(JOURNAL_COPY.ritual.voice.keep));

        const answers = onKeep.mock.calls[0][0];
        expect(answers).toEqual(fixture);
        // The assertion this whole file exists for. `false` would be a statement this person
        // never made about their meals (invariant 14, §6.3).
        expect('ate_regularly' in answers).toBe(false);
        expect(answers.ate_regularly).toBeUndefined();
    });

    it('saves nothing at all when the model answered nothing', async () => {
        const { onKeep } = renderCard({});
        await userEvent.click(screen.getByText(JOURNAL_COPY.ritual.voice.keep));
        expect(onKeep.mock.calls[0][0]).toEqual({});
    });

    it('lets a row be changed, and stops being dashed once it is', async () => {
        renderCard(fixture);
        expect(dashed('slept_well', 'false')).toBe(true);

        await userEvent.click(row('slept_well', 'true'));
        expect(picked('slept_well')).toBe('true');
        expect(dashed('slept_well', 'true')).toBe(false);
    });

    it('lets a question the model missed be answered by hand', async () => {
        const { onKeep } = renderCard(fixture);
        await userEvent.click(row('ate_regularly', 'true'));
        await userEvent.click(screen.getByText(JOURNAL_COPY.ritual.voice.keep));

        expect(onKeep.mock.calls[0][0].ate_regularly).toBe(true);
    });

    it('lets a confirmed answer be put back down, and it goes back to absent', async () => {
        // Not to `false`. Tapping a confirmed choice again is "I did not mean to answer
        // that", and the record has to be able to say so.
        const { onKeep } = renderCard(fixture);
        await userEvent.click(row('daylight', 'true'));   // confirm
        await userEvent.click(row('daylight', 'true'));   // and put it down
        await userEvent.click(screen.getByText(JOURNAL_COPY.ritual.voice.keep));

        expect('daylight' in onKeep.mock.calls[0][0]).toBe(false);
    });

    it('names the people it heard without attaching them to anything', async () => {
        // §3.5 keeps person resolution on the *Who?* card, where ids are chosen by tapping.
        // This line reports; it does not resolve, and there is nothing here to tap.
        renderCard(fixture, { people: ['Lucie'] });
        expect(screen.getByText(fillCopy(JOURNAL_COPY.ritual.voice.heard, { names: 'Lucie' })))
            .toBeInTheDocument();
    });

    it('offers the cards as an exit that saves nothing', async () => {
        const { onKeep, onCards } = renderCard(fixture);
        await userEvent.click(screen.getByText(JOURNAL_COPY.ritual.voice.cards));

        expect(onCards).toHaveBeenCalledOnce();
        expect(onKeep).not.toHaveBeenCalled();
    });
});

describe('the row a spoken ritual writes', () => {
    const ids = { ritual: 'r-1', dayWord: 'w-1' };
    const base = {
        asked: deck.map(question => question.id),
        answers: { slept_well: false, daylight: true },
        dayWord: null,
        durationMs: 12_000,
        at: '2026-09-02T22:40:00+02:00',
        day: '2026-09-02',
        ids
    };

    it('carries `source: "voice"` and is otherwise identical to a swiped one', () => {
        // §3.7, word for word: "A ritual answered by voice carries `source: "voice"` and is
        // otherwise identical to one answered by swipes."
        const swiped = buildRitualRequest(base);
        const spoken = buildRitualRequest({ ...base, source: 'voice' });

        expect(spoken.payload.source).toBe('voice');
        expect({ ...spoken.payload, source: undefined }).toEqual({ ...swiped.payload, source: undefined });
        expect({ ...spoken, payload: null }).toEqual({ ...swiped, payload: null });
    });

    it('writes no `source` at all for the swipes, so every row before D3 still means what it meant', () => {
        const swiped = buildRitualRequest(base);
        expect('source' in swiped.payload).toBe(false);
    });

    it('writes only the answers it was given', () => {
        const spoken = buildRitualRequest({ ...base, source: 'voice' });
        expect(spoken.payload.answers).toEqual({ slept_well: false, daylight: true });
        expect(spoken.payload.question_set.asked).toEqual(base.asked);
    });
});
