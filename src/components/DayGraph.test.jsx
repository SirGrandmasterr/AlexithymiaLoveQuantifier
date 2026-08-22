import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// `.jsx` spelled out, and it has to be. `dayGraph.js` and `DayGraph.jsx` differ only in case,
// Windows and macOS filesystems do not, and Vite tries `.js` before `.jsx` — so a bare
// `'./DayGraph'` resolves to the *geometry* module here, with no default export and no error
// beyond "element type is invalid". See the same comment in `Journal.jsx`.
import DayGraph, { MAX_YAW, ROTATE_PX, dayGraphInfo, dayWindow, opacityStops, timeMarks } from './DayGraph.jsx';
import {
    EXTRAPOLATED_OPACITY,
    FEELING_HALF_LIFE_MIN,
    UNSTATED_INTENSITY,
    branchPaths,
    buildDayCurve
} from './dayGraph.js';
import { DiscretionProvider } from '../context/DiscretionContext';
import { JOURNAL_COPY, fillCopy, humanMinutes } from '../constants/journal';

/**
 * The component tests §8.4 says are only possible because this is hand-drawn SVG: a count of
 * `<path>`s, a `stroke-dasharray`, and an opacity — none of which a Recharts chart renders
 * under jsdom at all (invariant 19).
 *
 * Everything about *where* a line goes is `dayGraph.test.js`'s, with 62 tests against fixtures
 * and no DOM. What is here is the other half: that the drawing is a faithful `map` over that
 * geometry, that the camera moves, and that the gesture takes the axis it is allowed to take
 * and no more.
 */

const DAY = '2026-08-21';

/** Local wall-clock, so the fixture lands inside the civil day the component draws. */
const at = (hour, minute = 0) => new Date(2026, 7, 21, hour, minute).toISOString();

const checkin = (id, hour, minute, feelings, extra = {}) => ({
    ID: id,
    client_id: `c-${id}`,
    kind: 'checkin',
    day: DAY,
    at: at(hour, minute),
    schema_version: 1,
    payload: { v: 1, source: 'chips', feelings, ...extra },
    superseded_at: null,
    supersedes_id: null,
    mentions: []
});

/**
 * A day with something of everything in it: two feelings at one moment, one of them marked
 * unsure, one repeated three and a half hours later, `unclear` in the evening, and the
 * ritual's closing word — which carries no strength at all (§6.5).
 *
 * The one at 09:00 also names a person and a trigger, so the discretion test has something to
 * find if the graph ever grew a name.
 */
const PERSON = 'Lucie';
const TRIGGER = 'the deadline';

const day = [
    checkin(21, 9, 0, [
        { id: 'stress', intensity: 2, uncertain: false, about: [{ kind: 'trigger', trigger: 'trig-1' }] },
        { id: 'anxiety', intensity: 3, uncertain: true, about: [{ kind: 'person', ref: 0 }] }
    ], { tags: ['work'], note: `${PERSON} again, about ${TRIGGER}` }),
    checkin(22, 12, 30, [{ id: 'stress', intensity: 3, uncertain: false, about: [] }]),
    checkin(23, 18, 0, [{ id: 'unclear', intensity: 2, about: [] }]),
    // The ritual's day word, written as a check-in by A8. No `intensity` anywhere in it.
    checkin(24, 22, 30, [{ id: 'calm', about: [] }], { source: 'ritual_word' })
];

day[0].mentions = [{ ID: 1, entry_id: 21, relationship_id: 7, label: PERSON, ref: 0 }];

const curve = () => buildDayCurve(day);
const drawing = () => document.querySelector('[data-day-curve]');
const plot = () => document.querySelector('[data-day-graph-plot]');
const paths = () => [...drawing().querySelectorAll('path')];
const pathFor = (feeling) => drawing().querySelector(`path[data-feeling="${feeling}"]`);

const draw = (props = {}) => render(<DayGraph day={DAY} entries={day} {...props} />);

/**
 * Dispatched directly rather than through `fireEvent`, and wrapped in `act`: the graph listens
 * with `{ passive: false }` on the plot container, outside React's own event system, and what
 * these tests are about is whether that listener claims the gesture. Copied from the card
 * stack's tests, which is also where the 45 px and the 12 px come from.
 */
const touch = (element, type, x, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    event.touches = [{ clientX: x, clientY: y }];
    act(() => { element.dispatchEvent(event); });
    return event;
};

/* ------------------------------------------------------------------------------------ */
/* The drawing is a map over the geometry                                                 */
/* ------------------------------------------------------------------------------------ */

describe('what gets drawn', () => {
    it('draws exactly one path per branch lifetime', () => {
        draw();

        // Not "some paths": the number `branchPaths` returns, so a branch that stopped being
        // drawn — or one drawn twice — fails here rather than looking fine.
        expect(paths()).toHaveLength(branchPaths(curve()).length);
        expect(paths().length).toBeGreaterThan(3);
    });

    it('draws the trunk between the first check-in and the last, and the day as an axis', () => {
        draw();

        expect(drawing().querySelector('[data-trunk]')).toBeInTheDocument();
        // The axis is the civil day, so the six-hourly marks are there whether or not the
        // record reaches them.
        const marks = [...drawing().querySelectorAll('[data-axis-mark]')].map(node => node.getAttribute('data-axis-mark'));
        expect(marks).toEqual(['06:00', '12:00', '18:00', '00:00']);
    });

    it('dashes what is uncertain, and only that', () => {
        draw();

        // The feeling that *is* uncertainty, and a feeling the user marked unsure: the same
        // drawing for two different records (§8.1's `≈` convention).
        expect(pathFor('unclear')).toHaveAttribute('stroke-dasharray');
        expect(pathFor('anxiety')).toHaveAttribute('stroke-dasharray');

        // And a feeling recorded plainly is not dashed, or the channel says nothing.
        expect(pathFor('stress')).not.toHaveAttribute('stroke-dasharray');
        expect(pathFor('calm')).not.toHaveAttribute('stroke-dasharray');
    });

    it('draws a guess faintly, and what was said at full strength', () => {
        draw();

        // `stress` was reported at 09:00 and again at 12:30, so the middle of it — and its
        // whole tail — sit further than `CONFIDENT_MIN` from anything the user actually said.
        const gradient = document.getElementById(pathFor('stress').getAttribute('stroke').slice(5, -1));
        expect(gradient).toBeInTheDocument();

        const opacities = [...gradient.querySelectorAll('stop')].map(stop => Number(stop.getAttribute('stop-opacity')));
        expect(opacities).toContain(EXTRAPOLATED_OPACITY);
        expect(opacities).toContain(1);
        expect(EXTRAPOLATED_OPACITY).toBeLessThan(1);
    });

    it('takes the width from the strength, so the strong branch is the wider one', () => {
        draw();

        const width = (feeling) => Number(pathFor(feeling).getAttribute('stroke-width'));
        // `anxiety` was tapped at 3, `calm` carries no strength at all and draws at
        // `UNSTATED_INTENSITY`, which is the lightest of the three.
        expect(width('anxiety')).toBeGreaterThan(width('calm'));
        expect(UNSTATED_INTENSITY).toBe(1);
    });

    it('names every feeling in the legend and nothing else', () => {
        draw();

        const legend = document.querySelector('[data-day-graph-legend]');
        expect(legend).toHaveTextContent('stress');
        expect(legend).toHaveTextContent('anxiety');
        expect(legend).toHaveTextContent("can't tell");
        expect(legend).toHaveTextContent('calm');
    });
});

/* ------------------------------------------------------------------------------------ */
/* The camera                                                                             */
/* ------------------------------------------------------------------------------------ */

describe('turning the drawing', () => {
    it('changes the projection when a button is pressed', async () => {
        draw();
        const before = pathFor('stress').getAttribute('d');

        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.rotateRight }));
        const turned = pathFor('stress').getAttribute('d');
        expect(turned).not.toBe(before);

        // And back, so the two buttons are one control rather than two.
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.rotateLeft }));
        expect(pathFor('stress').getAttribute('d')).toBe(before);
    });

    it('stops at the last angle rather than turning for ever', async () => {
        draw();
        const right = () => screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.rotateRight });

        for (let press = 0; press * 15 < MAX_YAW; press += 1) {
            await userEvent.click(right());
        }
        expect(right()).toBeDisabled();
    });

    it('changes the projection on a horizontal drag of at least 45 px', () => {
        draw();
        const before = pathFor('stress').getAttribute('d');

        touch(plot(), 'touchstart', 200, 300);
        const moved = touch(plot(), 'touchmove', 200 - ROTATE_PX - 15, 302);
        touch(plot(), 'touchend', 140, 302);

        expect(pathFor('stress').getAttribute('d')).not.toBe(before);
        // The graph claimed this one, which is what stops the page moving with it.
        expect(moved.defaultPrevented).toBe(true);
    });

    it('leaves a drag shorter than the threshold alone', () => {
        draw();
        const before = pathFor('stress').getAttribute('d');

        touch(plot(), 'touchstart', 200, 300);
        const moved = touch(plot(), 'touchmove', 200 - (ROTATE_PX - 5), 302);
        touch(plot(), 'touchend', 160, 302);

        expect(pathFor('stress').getAttribute('d')).toBe(before);
        expect(moved.defaultPrevented).toBe(false);
    });

    it('flattens to the 2-D ribbon, and back', async () => {
        draw();
        const tilted = pathFor('stress').getAttribute('d');

        await userEvent.click(screen.getByText(JOURNAL_COPY.dayGraph.flatten));
        const flat = pathFor('stress').getAttribute('d');
        expect(flat).not.toBe(tilted);

        // Flat is a camera setting, not a second drawing: the same branches are still there.
        expect(paths()).toHaveLength(branchPaths(curve()).length);
        // And there is nothing to turn while it is flat, so the buttons say so.
        expect(screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.rotateRight })).toBeDisabled();

        await userEvent.click(screen.getByText(JOURNAL_COPY.dayGraph.tilt));
        expect(pathFor('stress').getAttribute('d')).toBe(tilted);
    });

    it('does not take the gesture while it is flat', async () => {
        draw();
        await userEvent.click(screen.getByText(JOURNAL_COPY.dayGraph.flatten));
        const before = pathFor('stress').getAttribute('d');

        touch(plot(), 'touchstart', 200, 300);
        const moved = touch(plot(), 'touchmove', 100, 302);
        touch(plot(), 'touchend', 100, 302);

        expect(moved.defaultPrevented).toBe(false);
        expect(pathFor('stress').getAttribute('d')).toBe(before);
    });
});

/* ------------------------------------------------------------------------------------ */
/* Touch-axis ownership (invariant 2g)                                                    */
/* ------------------------------------------------------------------------------------ */

describe('the axis the graph is allowed to take', () => {
    it('declares `pan-y` on the plot, and claims nothing above it', () => {
        draw();

        expect(plot().style.touchAction).toBe('pan-y');

        for (let node = plot().parentElement; node; node = node.parentElement) {
            expect(node.style.touchAction).toBe('');
            expect(node.className || '').not.toMatch(/touch-/);
        }
    });

    it('leaves a vertical drag that starts on the graph to the page', () => {
        draw();
        const before = pathFor('stress').getAttribute('d');

        touch(plot(), 'touchstart', 200, 300);
        const moved = touch(plot(), 'touchmove', 204, 180);
        touch(plot(), 'touchend', 204, 180);

        // Nobody called `preventDefault`, so the page scrolls — which is the whole of the
        // contract. A graph that swallowed this would be the card stack's old bug again.
        expect(moved.defaultPrevented).toBe(false);
        expect(pathFor('stress').getAttribute('d')).toBe(before);
    });

    it('does not turn a scroll into a turn halfway through', () => {
        draw();
        const before = pathFor('stress').getAttribute('d');

        touch(plot(), 'touchstart', 200, 300);
        touch(plot(), 'touchmove', 202, 260);
        const moved = touch(plot(), 'touchmove', 60, 250);
        touch(plot(), 'touchend', 60, 250);

        expect(moved.defaultPrevented).toBe(false);
        expect(pathFor('stress').getAttribute('d')).toBe(before);
    });

    it('gives the gesture back at the last angle rather than swallowing it', () => {
        draw();

        // Turn to the stop by drag, then keep pushing the same way.
        for (let press = 0; press * 15 < MAX_YAW; press += 1) {
            touch(plot(), 'touchstart', 200, 300);
            touch(plot(), 'touchmove', 120, 300);
            touch(plot(), 'touchend', 120, 300);
        }

        touch(plot(), 'touchstart', 200, 300);
        const moved = touch(plot(), 'touchmove', 120, 300);
        touch(plot(), 'touchend', 120, 300);

        expect(moved.defaultPrevented).toBe(false);
    });
});

/* ------------------------------------------------------------------------------------ */
/* The ⓘ                                                                                  */
/* ------------------------------------------------------------------------------------ */

describe('the ⓘ', () => {
    it('states the half-life the drawing actually uses', async () => {
        draw();
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.infoLabel }));

        const sentence = fillCopy(JOURNAL_COPY.dayGraph.fade, { halfLife: humanMinutes(FEELING_HALF_LIFE_MIN) });
        expect(screen.getByText(sentence)).toBeInTheDocument();
        expect(sentence).toContain('two and a half hours');
    });

    it('changes when the constant does, because it is computed and not written out', () => {
        // The property §8.2's closing paragraph asks for: tuning a constant cannot leave the
        // sentence saying something untrue, because the sentence is made out of the constant.
        expect(dayGraphInfo({ halfLifeMin: 60 })[0]).not.toBe(dayGraphInfo()[0]);
        expect(dayGraphInfo({ halfLifeMin: 60 })[0]).toContain('an hour');
        expect(dayGraphInfo({ halfLifeMin: 60 })[0]).not.toContain('two and a half');

        // And the same for the strength an unstated feeling is drawn at (§8.2 rule 7).
        expect(dayGraphInfo()[1]).toContain(`${UNSTATED_INTENSITY} of three`);
        expect(dayGraphInfo({ unstatedIntensity: 3 })[1]).toContain('3 of three');
    });

    it('says the constants are a drawing choice rather than a claim about the reader', async () => {
        draw();
        await userEvent.click(screen.getByRole('button', { name: JOURNAL_COPY.dayGraph.infoLabel }));

        expect(screen.getByText(JOURNAL_COPY.dayGraph.caveat)).toBeInTheDocument();
        expect(screen.getByText(JOURNAL_COPY.dayGraph.extrapolated)).toBeInTheDocument();
        expect(screen.getByText(dayGraphInfo()[1])).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------------------------ */
/* A tap on a branch                                                                      */
/* ------------------------------------------------------------------------------------ */

describe('a tap on a branch', () => {
    it('opens the check-in it came from', async () => {
        const opened = vi.fn();
        draw({ onOpenCheckin: opened });

        const label = fillCopy(JOURNAL_COPY.dayGraph.branch, { feeling: 'stress', time: '09:00' });
        await userEvent.click(screen.getByRole('button', { name: label }));

        // The 09:00 row, not the 12:30 one that also carried `stress`: a branch is born at the
        // check-in that first reported it.
        expect(opened).toHaveBeenCalledWith(21);
    });

    it('names the branch for a reader who cannot see it', () => {
        draw({ onOpenCheckin: vi.fn() });

        expect(screen.getByRole('button', {
            name: fillCopy(JOURNAL_COPY.dayGraph.branch, { feeling: "can't tell", time: '18:00' })
        })).toBeInTheDocument();
    });

    it('shows which branch has focus in the drawing rather than around it', () => {
        draw({ onOpenCheckin: vi.fn() });

        const label = fillCopy(JOURNAL_COPY.dayGraph.branch, { feeling: 'stress', time: '09:00' });
        const before = Number(pathFor('stress').getAttribute('stroke-width'));

        act(() => screen.getByRole('button', { name: label }).focus());

        // The browser's own ring would be drawn around the branch's bounding box, which for a
        // line that crosses the day is most of the picture.
        expect(Number(pathFor('stress').getAttribute('stroke-width'))).toBeGreaterThan(before);
        expect(pathFor('stress')).toHaveAttribute('data-focused', 'true');
    });

    it('offers no tap target when there is nothing to open it in', () => {
        draw();
        expect(drawing().querySelectorAll('[role="button"]')).toHaveLength(0);
    });
});

/* ------------------------------------------------------------------------------------ */
/* A day with nothing in it, and a day under discretion                                   */
/* ------------------------------------------------------------------------------------ */

describe('a day with nothing in it', () => {
    it('draws nothing at all, and does not throw', () => {
        const { container } = render(<DayGraph day={DAY} entries={[]} />);

        // Not an empty frame and not an axis with no record on it: §9.4's empty state below
        // is the day's answer, and a second, emptier one above it would be noise.
        expect(container).toBeEmptyDOMElement();
        expect(container.querySelectorAll('path')).toHaveLength(0);
        expect(document.querySelector('[data-day-graph-legend]')).toBeNull();
    });

    it('draws nothing for a day that holds only a ritual row', () => {
        const ritual = { ID: 30, kind: 'ritual', day: DAY, at: at(22, 30), payload: { v: 1 }, mentions: [] };
        const { container } = render(<DayGraph day={DAY} entries={[ritual]} />);
        expect(container).toBeEmptyDOMElement();
    });
});

describe('discretion mode', () => {
    beforeEach(() => window.localStorage.setItem('alq:discreet', 'true'));
    afterEach(() => window.localStorage.removeItem('alq:discreet'));

    it('keeps drawing, and holds no names to hide', () => {
        render(
            <DiscretionProvider>
                <DayGraph day={DAY} entries={day} />
            </DiscretionProvider>
        );

        // The drawing is unchanged — it is colours and coordinates, and there was never a name
        // in it to mask (§9.6).
        expect(paths()).toHaveLength(branchPaths(curve()).length);

        const section = document.querySelector('[data-day-graph]');
        expect(section.textContent).not.toContain(PERSON);
        expect(section.textContent).not.toContain(TRIGGER);
        expect(section.textContent).not.toContain('work');
        // The legend is feeling labels, and those are the whole of what it holds.
        expect(document.querySelector('[data-day-graph-legend]')).toHaveTextContent('stress');
    });
});

/* ------------------------------------------------------------------------------------ */
/* The axis, as a function                                                                */
/* ------------------------------------------------------------------------------------ */

describe('dayWindow', () => {
    it('runs the civil day, 04:00 to 04:00', () => {
        const frame = dayWindow(DAY, null);

        expect(new Date(frame.from).getHours()).toBe(4);
        expect(new Date(frame.to).getHours()).toBe(4);
        expect(new Date(frame.from).getDate()).toBe(21);
        expect(new Date(frame.to).getDate()).toBe(22);
    });

    it('falls back to the record when there is no day to read', () => {
        const bounds = { startAt: new Date(2026, 7, 21, 9).getTime(), endAt: new Date(2026, 7, 21, 12).getTime() };
        const frame = dayWindow(undefined, bounds);

        expect(frame.from).toBeLessThan(bounds.startAt);
        expect(frame.to).toBeGreaterThan(bounds.endAt);
        expect(dayWindow(undefined, null)).toBeNull();
    });

    it('labels the six-hourly marks inside the day and none outside it', () => {
        expect(timeMarks(dayWindow(DAY, null))).toHaveLength(4);
        expect(timeMarks(null)).toEqual([]);
    });
});

describe('opacityStops', () => {
    it('returns nothing to fade for a branch that is all one thing', () => {
        expect(opacityStops([{ x: 0, opacity: 1 }, { x: 40, opacity: 1 }])).toBeNull();
    });

    it('steps rather than fades where the geometry steps', () => {
        const stops = opacityStops([
            { x: 0, opacity: 1 },
            { x: 50, opacity: 1 },
            { x: 60, opacity: EXTRAPOLATED_OPACITY },
            { x: 100, opacity: EXTRAPOLATED_OPACITY }
        ]);

        // Two stops at one offset: SVG's way of writing a step, which is what
        // `extrapolated: true` at a minute is. And no stop of zero extent at the end,
        // which would describe a run that is not drawn.
        expect(stops.filter(stop => stop.offset === 0.6)).toHaveLength(2);
        expect(stops[0]).toEqual({ offset: 0, opacity: 1 });
        expect(stops[stops.length - 1]).toEqual({ offset: 1, opacity: EXTRAPOLATED_OPACITY });
    });

    it('has no direction to lay a gradient along for a branch drawn at one instant', () => {
        expect(opacityStops([{ x: 12, opacity: 1 }, { x: 12, opacity: EXTRAPOLATED_OPACITY }])).toBeNull();
    });
});
