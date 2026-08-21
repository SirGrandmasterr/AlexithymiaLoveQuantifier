import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VaultKnob from './VaultKnob';

// The feedback channels are mocked rather than exercised: jsdom has no AudioContext and no
// vibration motor, and what is worth asserting here is *when* a detent fires, not what it
// sounds like.
vi.mock('../mobile/knobFeedback', () => ({
    startTurn: vi.fn(),
    detent: vi.fn(),
    endTurn: vi.fn()
}));

import { startTurn, detent, endTurn } from '../mobile/knobFeedback';

/** The dial reports upward; a host holds the value, as PersonForm does. */
const Harness = ({ initial = 0, ...props }) => {
    const [value, setValue] = useState(initial);
    return (
        <>
            <VaultKnob value={value} onChange={setValue} label="Eros" {...props} />
            <output data-testid="value">{value}</output>
        </>
    );
};

const dial = () => screen.getByRole('slider', { name: 'Eros dial' });
const reading = () => Number(screen.getByTestId('value').textContent);

/** 2.6px of travel per unit, so 26px is ten units. Down is up-the-scale. */
const turn = (pixels, { from = 0 } = {}) => {
    fireEvent.pointerDown(dial(), { pointerId: 1, clientY: from });
    fireEvent.pointerMove(dial(), { pointerId: 1, clientY: from + pixels });
    fireEvent.pointerUp(dial(), { pointerId: 1, clientY: from + pixels });
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('VaultKnob — turning it', () => {
    // The direction is the one thing a user has to guess right the first time, and it is
    // fixed by the metaphor: push the wheel down, the numbers climb.
    it('raises the value on a downward drag and lowers it on an upward one', () => {
        render(<Harness initial={50} />);

        turn(26);
        expect(reading()).toBe(60);

        turn(-52);
        expect(reading()).toBe(50 - 20 + 10);
    });

    it('clicks once per unit crossed', () => {
        render(<Harness initial={0} />);

        fireEvent.pointerDown(dial(), { pointerId: 1, clientY: 0 });
        fireEvent.pointerMove(dial(), { pointerId: 1, clientY: 2.6 });
        fireEvent.pointerMove(dial(), { pointerId: 1, clientY: 5.2 });
        fireEvent.pointerMove(dial(), { pointerId: 1, clientY: 7.8 });

        expect(reading()).toBe(3);
        expect(detent).toHaveBeenCalledTimes(3);
    });

    it('opens and closes the feedback channels with the gesture', () => {
        render(<Harness />);

        fireEvent.pointerDown(dial(), { pointerId: 1, clientY: 0 });
        expect(startTurn).toHaveBeenCalledTimes(1);
        expect(endTurn).not.toHaveBeenCalled();

        fireEvent.pointerUp(dial(), { pointerId: 1, clientY: 0 });
        expect(endTurn).toHaveBeenCalledTimes(1);
    });

    it('stops at the ends of the scale', () => {
        render(<Harness initial={95} />);

        turn(500);
        expect(reading()).toBe(100);

        turn(-500);
        expect(reading()).toBe(0);
    });

    // Without re-anchoring, a drag that ran thirty units past the stop has to travel thirty
    // units back before anything moves, which reads as the dial having jammed.
    it('responds immediately after being driven into a stop', () => {
        render(<Harness initial={90} />);

        fireEvent.pointerDown(dial(), { pointerId: 1, clientY: 0 });
        fireEvent.pointerMove(dial(), { pointerId: 1, clientY: 260 });   // far past 100
        expect(reading()).toBe(100);

        fireEvent.pointerMove(dial(), { pointerId: 1, clientY: 234 });   // ten units back
        expect(reading()).toBe(90);
    });

    it('shows the reading while held, since the finger is on the dial', () => {
        render(<Harness initial={40} />);
        // The badge is decorative to a screen reader — the dial's own aria-valuenow is the
        // accessible reading — so it is found by structure rather than by role.
        // `:scope >` so the dial's own decorative <svg> is not what gets found.
        const badge = () => dial().parentElement.querySelector(':scope > [aria-hidden="true"]');

        expect(badge()).toBeNull();

        fireEvent.pointerDown(dial(), { pointerId: 1, clientY: 0 });
        expect(badge()).toHaveTextContent('40');

        fireEvent.pointerUp(dial(), { pointerId: 1, clientY: 0 });
        expect(badge()).toBeNull();
    });

    it('ignores a drag when the category is skipped', () => {
        render(<Harness initial={30} disabled />);

        turn(52);
        expect(reading()).toBe(30);
        expect(startTurn).not.toHaveBeenCalled();
    });
});

describe('VaultKnob — without a pointer', () => {
    it('is a slider in the accessibility tree', () => {
        render(<Harness initial={62} />);

        expect(dial()).toHaveAttribute('aria-valuenow', '62');
        expect(dial()).toHaveAttribute('aria-valuemin', '0');
        expect(dial()).toHaveAttribute('aria-valuemax', '100');
    });

    it('takes the arrow, page and home/end keys', async () => {
        render(<Harness initial={50} />);
        dial().focus();

        await userEvent.keyboard('{ArrowUp}');
        expect(reading()).toBe(51);

        await userEvent.keyboard('{ArrowDown}{ArrowDown}');
        expect(reading()).toBe(49);

        await userEvent.keyboard('{PageUp}');
        expect(reading()).toBe(59);

        await userEvent.keyboard('{Home}');
        expect(reading()).toBe(0);

        await userEvent.keyboard('{End}');
        expect(reading()).toBe(100);
    });

    it('is not focusable when the category is skipped', () => {
        render(<Harness initial={30} disabled />);
        expect(dial()).toHaveAttribute('tabindex', '-1');
    });
});
