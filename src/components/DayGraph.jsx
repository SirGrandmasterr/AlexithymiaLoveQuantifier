import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Info, RotateCcw, RotateCw } from 'lucide-react';
import {
    DAY_ROLLOVER_HOUR,
    FEELINGS,
    JOURNAL_COPY,
    fillCopy,
    humanMinutes,
    readCheckin,
    timeOfDay
} from '../constants/journal';
import {
    FEELING_HALF_LIFE_MIN,
    TRUNK,
    UNSTATED_INTENSITY,
    branchPaths,
    buildDayCurve,
    dayGraphLegend,
    paintersOrder,
    project
} from './dayGraph.js';

/**
 * The day graph — one day of check-ins, drawn.
 *
 * ## Where the decisions are
 *
 * Not here. Every rule about *where a line goes* lives in `dayGraph.js`, which has no React
 * import and is tested to the minute against fixtures; this file is a `map` over what
 * `buildDayCurve` → `branchPaths` returns, plus a camera. That is `LoveShape`'s arrangement
 * (`buildShapeData` holds the honesty rules, the component draws them) with rather more
 * arithmetic behind it, and it is invariant 19 made structural: a component that decided
 * geometry would be a component whose geometry only a rendered-pixel test could check, and
 * under jsdom there are no pixels.
 *
 * ## Why hand-drawn SVG and not a chart library
 *
 * §8.3. Recharts has no branching primitive — a branch that leaves a trunk, decays and merges
 * back would be built from overlapping `<Line>`s fighting the library at every join — and it
 * draws nothing under jsdom, so its tests prove nothing. Hand-drawn SVG costs 0 KB, renders in
 * the WebView, prints, and lets a test count `<path>`s and read a `stroke-dasharray`. three.js
 * stays the upgrade path rather than a fork: everything below feeds on (x, y, z) and minutes,
 * so a WebGL renderer would consume the same geometry unchanged.
 *
 * ## The camera, and why the flat ribbon is a setting rather than a fallback
 *
 * `project` at `pitch = 0` is the exact identity on x and y, so **the 2-D ribbon and the
 * tilted drawing are one code path with a camera between them**. That is what makes §12.4's
 * open question ("is the tilt legible, or is the ribbon enough?") cheap to answer: the
 * *Show it flat* button is the whole of the ribbon implementation.
 *
 * ## The five channels (§8.1)
 *
 * - **x** — time of day, proportional, across the whole civil day (see `dayWindow`).
 * - **y** — valence scaled by the strength at that minute, so a branch stands away from the
 *   trunk while it is strong and returns to it as it fades.
 * - **z** — the feeling's energy, fixed per vocabulary entry, so a feeling is always at the
 *   same depth and a shape stays recognisable (invariant 18's rule for the radar's axes).
 * - **colour** — the feeling's identity, a complete literal hex from `FEELINGS` (invariant 4).
 * - **stroke width** — strength; **dashed** — uncertain or `unclear`; **faint** — extrapolated.
 *
 * ## Discretion
 *
 * There is no `useDiscretion` in this file and there is nothing for it to do. The graph is fed
 * by `buildDayCurve` and `dayGraphLegend`, whose input is feeling ids, strengths and
 * coordinates — no person, no trigger, no note, no transcript ever reaches it. It holds
 * colours and no names, so it keeps drawing under discretion because it never had anything to
 * hide (§9.6).
 */

/* ------------------------------------------------------------------------------------ */
/* 1. The camera and the canvas                                                           */
/* ------------------------------------------------------------------------------------ */

/**
 * The tilt the day opens at. `0` is the flat ribbon, and the toggle is the whole of it.
 *
 * Tuned against real days rather than chosen: at 30° with the depth axis at full reach, a
 * low-energy feeling was lifted further by the tilt than a strong pleasant one was by its own
 * valence — so *up* stopped meaning *pleasant*, which is the one thing §8.1 says the y axis is
 * for. At 26°, with `DEPTH_SCALE` at 1, the deepest a feeling can be pushed is about a fifth
 * of the valence axis: enough to see the floor recede, not enough to outvote it. The angle is
 * the honest knob here — the fix is not to hide depth but to keep it second.
 */
export const DEFAULT_PITCH = 26;

/** One press of a rotate button, in degrees, and how far the two of them reach. */
export const ROTATE_STEP = 15;
export const MAX_YAW = 45;

/**
 * The horizontal travel that turns the drawing, and the vertical travel that gives the
 * gesture back to the page. Both are the card stack's numbers, deliberately: two surfaces
 * that take a horizontal drag on the same phone should not disagree about how far a drag is.
 */
export const ROTATE_PX = 45;
const YIELD_PX = 12;

/**
 * How far the energy axis reaches into the scene.
 *
 * `project`'s depth cues are calibrated on a depth of −1…+1 — `nearness` is `(depth + 1) / 2`
 * — while x is handed over as −0.5…+0.5 so that a rotation turns about the middle of the day.
 * Energy therefore arrives as `energy − 0.5`, in the same units as x, and the camera's own
 * `depthScale` opens it out to the range the width and opacity gains were written for.
 */
const DEPTH_SCALE = 1;
const Z_HALF = 0.5 * DEPTH_SCALE;

/**
 * How far the valence axis actually reaches, taken from the vocabulary rather than from ±1.
 *
 * No feeling in `FEELINGS` is at valence 1, so a canvas drawn for ±1 leaves a fifth of itself
 * permanently empty and draws every real day a fifth smaller than it could. Reading the
 * constant means a feeling added at a stronger valence rescales the drawing instead of
 * overflowing it — and it is still a **fixed** scale, set by the vocabulary and not by the
 * day, so a quiet day cannot be drawn as dramatically as a loud one.
 */
const Y_EXTENT = Math.max(...FEELINGS.map(feeling => Math.abs(feeling.valence)));

const VIEW = Object.freeze({ width: 720, height: 300 });
const PLOT = Object.freeze({ cx: 360, cy: 138, halfWidth: 350, halfHeight: 112, labelY: 288 });

/** Dashed exactly as the radar's ghost polygon is: one `≈` convention across the app. */
const DASH = '4 3';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const MS_PER_MIN = 60000;

/* ------------------------------------------------------------------------------------ */
/* 2. The day as an axis                                                                  */
/* ------------------------------------------------------------------------------------ */

/**
 * The instants the x axis runs between.
 *
 * §8.1 gives x as *time of day, proportional* — the axis is **the day**, not the span the
 * check-ins happen to cover. Two check-ins ten minutes apart draw ten minutes' worth of line
 * on a full day, which is the honest picture; an axis fitted to the record would draw the same
 * two check-ins as a full day of data.
 *
 * It is the **civil** day, 04:00 → 04:00 (`DAY_ROLLOVER_HOUR`), not midnight to midnight: a
 * 02:00 check-in belongs to the day before (§6.3, Appendix D), so an axis that started at
 * midnight would have nowhere to put one. Both ends are constructed as local dates rather
 * than as `from + 24 h`, which is what makes the axis 23 or 25 hours long on the two days a
 * year that are — the same reason `buildDayCurve` counts elapsed minutes rather than clock
 * minutes.
 *
 * With no readable day — a caller that has entries but no date — it falls back to the
 * record's own extent with half an hour of air at each end, because a drawing on an axis
 * nobody can name is still better than no drawing.
 */
export const dayWindow = (day, bounds) => {
    // `frame` rather than `window` throughout this file, for the obvious reason.
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));

    if (parts) {
        const year = Number(parts[1]);
        const month = Number(parts[2]);
        const date = Number(parts[3]);
        return {
            from: new Date(year, month - 1, date, DAY_ROLLOVER_HOUR).getTime(),
            to: new Date(year, month - 1, date + 1, DAY_ROLLOVER_HOUR).getTime()
        };
    }

    if (!bounds) return null;
    const from = bounds.startAt - 30 * MS_PER_MIN;
    return { from, to: Math.max(bounds.endAt + 30 * MS_PER_MIN, from + MS_PER_MIN) };
};

/**
 * The hours the axis is labelled at: every six, built as local wall-clock times rather than
 * stepped in milliseconds, so the labels still read 06:00 and 12:00 on a day with a clock
 * change in it.
 */
export const timeMarks = (frame) => {
    if (!frame) return [];
    const start = new Date(frame.from);
    const marks = [];

    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
        [0, 6, 12, 18].forEach(hour => {
            const at = new Date(start.getFullYear(), start.getMonth(), start.getDate() + dayOffset, hour).getTime();
            if (at > frame.from && at < frame.to) marks.push(at);
        });
    }

    return marks.sort((a, b) => a - b);
};

/* ------------------------------------------------------------------------------------ */
/* 3. Graph space → screen                                                                */
/* ------------------------------------------------------------------------------------ */

/**
 * The scale that maps projected graph units onto the canvas.
 *
 * It follows the camera. Turning the scene spreads the depth axis sideways and foreshortens
 * the time axis, so a fixed scale would either waste two thirds of the canvas at `yaw = 0` or
 * push the drawing off it at full turn. Fitting the extent instead keeps the drawing in the
 * frame at every angle, and costs nothing in honesty: within one view, and along one branch,
 * screen x stays affine in time — a six-hour gap is six hours of pixels.
 */
const scaleFor = ({ yaw, pitch }) => {
    const cosYaw = Math.abs(Math.cos((yaw * Math.PI) / 180));
    const sinYaw = Math.abs(Math.sin((yaw * Math.PI) / 180));
    const sinPitch = Math.abs(Math.sin((pitch * Math.PI) / 180));

    return {
        x: PLOT.halfWidth / (0.5 * cosYaw + Z_HALF * sinYaw),
        y: PLOT.halfHeight / (Y_EXTENT + Z_HALF * cosYaw * sinPitch)
    };
};

/** Minutes of the civil day, as −0.5…+0.5 — centred, because the yaw turns about the middle. */
const graphX = (instant, frame) => (instant - frame.from) / (frame.to - frame.from) - 0.5;

/** Energy as −0.5…+0.5, in the same units as x. `DEPTH_SCALE` opens it out inside the camera. */
const graphZ = (energy) => energy - 0.5;

const screenPoint = (point, camera, scale) => {
    const projected = project(point, camera);
    return {
        x: PLOT.cx + projected.x * scale.x,
        y: PLOT.cy - projected.y * scale.y,
        depth: projected.depth,
        widthGain: projected.width,
        opacityGain: projected.opacity
    };
};

const polyline = (points) => points.map(point => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

const pathD = (points) => points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(' ');

/**
 * The opacity stops along one branch.
 *
 * SVG strokes **one** opacity per element, and a branch is routinely part measured and part
 * guess — §8.2 rule 6 marks anything further than `CONFIDENT_MIN` from a check-in that
 * carried the feeling. Splitting the branch into an element per run would draw a guess as a
 * guess at the cost of the property that makes this drawing checkable: one `<path>` per
 * branch lifetime. A gradient along the stroke keeps both.
 *
 * It is exact rather than decorative. Screen x is `x·cos(yaw) + z·sin(yaw)` and z is constant
 * along a branch (energy is fixed per feeling), so screen x is affine in time and strictly
 * increasing for every yaw inside `MAX_YAW` — a `userSpaceOnUse` gradient laid along it maps
 * offsets to minutes exactly. Pairs of stops at one offset make the change a step rather than
 * a fade, because the geometry's answer is a step.
 *
 * `null` where no gradient is needed: a branch that is all one thing, or one drawn at a single
 * instant, where there is no direction to lay a gradient along.
 */
export const opacityStops = (points) => {
    const first = points[0];
    const last = points[points.length - 1];
    const span = last.x - first.x;
    if (!Number.isFinite(span) || Math.abs(span) < 0.5) return null;

    const stops = [{ offset: 0, opacity: first.opacity }];

    points.forEach(point => {
        const previous = stops[stops.length - 1];
        if (previous.opacity === point.opacity) return;
        const offset = clamp((point.x - first.x) / span, 0, 1);
        stops.push({ offset, opacity: previous.opacity });
        stops.push({ offset, opacity: point.opacity });
    });

    // Only if the last step did not already land on the end: a stop of zero extent paints
    // nothing, and two of them at offset 1 is a gradient describing a run that is not there.
    if (stops[stops.length - 1].offset < 1) stops.push({ offset: 1, opacity: last.opacity });
    return stops.length > 2 ? stops : null;
};

/* ------------------------------------------------------------------------------------ */
/* 4. The ⓘ                                                                               */
/* ------------------------------------------------------------------------------------ */

/**
 * What the ⓘ says, assembled from the constants it describes.
 *
 * §8.2's closing paragraph asks the graph to state its own tunables and to say what they are:
 * the half-life, the strength an unstated one is drawn at, what the faint stretches mean, and
 * that all of it is *a drawing choice about a record, not a claim about the user*. Every
 * number in the sentences is filled from the constant that produced it — `humanMinutes` turns
 * 150 into *two and a half hours* — so tuning a constant cannot leave the copy saying
 * something untrue, which is the property the tests hold by passing a different one in.
 */
export const dayGraphInfo = ({
    halfLifeMin = FEELING_HALF_LIFE_MIN,
    unstatedIntensity = UNSTATED_INTENSITY
} = {}) => [
    fillCopy(JOURNAL_COPY.dayGraph.fade, { halfLife: humanMinutes(halfLifeMin) }),
    fillCopy(JOURNAL_COPY.dayGraph.unstated, { strength: unstatedIntensity }),
    JOURNAL_COPY.dayGraph.extrapolated,
    JOURNAL_COPY.dayGraph.caveat
];

/* ------------------------------------------------------------------------------------ */
/* 5. Branch → check-in                                                                   */
/* ------------------------------------------------------------------------------------ */

/**
 * The check-in a branch was born at, or `null`.
 *
 * A branch starts at the minute a check-in reported the feeling, and `bounds.startAt + t·60000`
 * is the instant of any minute — so the row is found by the instant and the feeling together
 * rather than by an id the geometry would have to carry. That keeps `dayGraph.js` free of
 * anything about a *row*: it knows minutes and feelings, and the component knows which record
 * a minute came from.
 */
export const sourceCheckin = (entries, bounds, path) => {
    if (!bounds || !path) return null;
    const at = bounds.startAt + path.birth.t * MS_PER_MIN;

    return (Array.isArray(entries) ? entries : []).find(entry => (
        entry?.kind === 'checkin'
        && new Date(entry.at).getTime() === at
        && readCheckin(entry.payload).feelings.some(feeling => feeling.id === path.feeling)
    )) ?? null;
};

/* ------------------------------------------------------------------------------------ */
/* 6. The component                                                                       */
/* ------------------------------------------------------------------------------------ */

/** Gradient ids have to be unique in a document, and two day graphs on one page is legal. */
let graphSequence = 0;

export default function DayGraph({ day, entries = [], onOpenCheckin = null }) {
    const [yaw, setYaw] = useState(0);
    // Mirrored in a ref because the drag listener below is a plain DOM one: it has to know the
    // current angle *while the finger is moving*, and a functional `setState` updater is not a
    // place to decide whether to claim the gesture — it does not run when it is called.
    const yawRef = useRef(0);
    const [flat, setFlat] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    // Which branch has keyboard focus. The browser's own focus ring on an SVG element is drawn
    // around its *bounding box*, which for a branch that crosses the day is most of the
    // drawing and says nothing about which line is focused — so the branch shows its own focus
    // by thickening, and the ring is turned off rather than left to cover the picture.
    const [focused, setFocused] = useState(null);
    const plotRef = useRef(null);
    const idRef = useRef(null);
    if (idRef.current === null) {
        graphSequence += 1;
        idRef.current = `alq-day-graph-${graphSequence}`;
    }

    const curve = useMemo(() => buildDayCurve(entries), [entries]);
    const paths = useMemo(() => branchPaths(curve), [curve]);
    const legend = useMemo(() => dayGraphLegend(curve), [curve]);
    const frame = useMemo(() => dayWindow(day, curve.bounds), [day, curve.bounds]);

    const camera = useMemo(
        () => ({ yaw: flat ? 0 : yaw, pitch: flat ? 0 : DEFAULT_PITCH, depthScale: DEPTH_SCALE }),
        [flat, yaw]
    );

    const turnTo = useCallback((next) => {
        yawRef.current = next;
        setYaw(next);
    }, []);

    const turn = useCallback((direction) => {
        turnTo(clamp(yawRef.current + direction * ROTATE_STEP, -MAX_YAW, MAX_YAW));
    }, [turnTo]);

    /*
     * Rotation by horizontal drag (§8.3, invariant 2g).
     *
     * Registered by hand with `{ passive: false }` rather than through React, for the reason
     * the card stack does it: a passive listener cannot `preventDefault`, and claiming the
     * gesture is the whole point. The axis split is the card stack's, number for number —
     * vertical intent is settled early and permanently so a scroll cannot become a turn
     * halfway through, and a drag that pushes past the last angle is released to the page
     * rather than swallowed.
     */
    useEffect(() => {
        const node = plotRef.current;
        if (!node || flat) return undefined;

        let startX = null;
        let startY = null;
        let decided = false;

        const onStart = (event) => {
            if (event.touches.length !== 1) return;
            startX = event.touches[0].clientX;
            startY = event.touches[0].clientY;
            decided = false;
        };

        const onMove = (event) => {
            if (startX === null) return;

            const deltaX = event.touches[0].clientX - startX;
            const deltaY = event.touches[0].clientY - startY;

            if (!decided && Math.abs(deltaY) > YIELD_PX && Math.abs(deltaY) > Math.abs(deltaX)) {
                startX = null;
                return;
            }
            if (Math.abs(deltaX) < ROTATE_PX) return;

            const direction = deltaX < 0 ? -1 : 1;
            const next = clamp(yawRef.current + direction * ROTATE_STEP, -MAX_YAW, MAX_YAW);
            // Past the last angle the drawing turns to, the gesture goes back to the page
            // rather than being swallowed — the card stack's rule at the ends of its pile.
            if (next === yawRef.current) {
                startX = null;
                return;
            }

            event.preventDefault();
            decided = true;
            startX = event.touches[0].clientX;
            turnTo(next);
        };

        const onEnd = () => { startX = null; decided = false; };

        node.addEventListener('touchstart', onStart, { passive: true });
        node.addEventListener('touchmove', onMove, { passive: false });
        node.addEventListener('touchend', onEnd, { passive: true });
        node.addEventListener('touchcancel', onEnd, { passive: true });

        return () => {
            node.removeEventListener('touchstart', onStart);
            node.removeEventListener('touchmove', onMove);
            node.removeEventListener('touchend', onEnd);
            node.removeEventListener('touchcancel', onEnd);
        };
    }, [flat, turnTo]);

    // A day with nothing said in it draws nothing — not an empty frame, not an axis with no
    // record on it. §9.4's rule: a day with nothing in it is a day with nothing in it, and the
    // day's own empty state below says so in words.
    if (!curve.bounds || paths.length === 0 || !frame) return null;

    const scale = scaleFor(camera);
    const trunkZ = graphZ(TRUNK.energy);

    const drawn = paintersOrder(paths.map(path => {
        const z = graphZ(path.points[0].z);
        const points = path.points.map(point => ({
            ...point,
            ...screenPoint({ x: graphX(curve.bounds.startAt + point.t * MS_PER_MIN, frame), y: point.y, z }, camera, scale)
        }));
        const head = screenPoint({ x: 0, y: 0, z }, camera, scale);

        return {
            ...path,
            points,
            depth: head.depth,
            widthGain: head.widthGain,
            opacityGain: head.opacityGain,
            stops: opacityStops(points),
            source: sourceCheckin(entries, curve.bounds, path)
        };
    }));

    const axis = timeMarks(frame).map(at => {
        const x = graphX(at, frame);
        return {
            at,
            label: timeOfDay(new Date(at)),
            top: screenPoint({ x, y: 1, z: trunkZ }, camera, scale),
            foot: screenPoint({ x, y: -1, z: trunkZ }, camera, scale)
        };
    });

    const trunkSpan = [graphX(curve.bounds.startAt, frame), graphX(curve.bounds.endAt, frame)];
    const trunk = {
        from: screenPoint({ x: trunkSpan[0], y: TRUNK.valence, z: trunkZ }, camera, scale),
        to: screenPoint({ x: trunkSpan[1], y: TRUNK.valence, z: trunkZ }, camera, scale)
    };

    /*
     * The receding floor §8.3 names — one neutral line per depth the day actually holds.
     *
     * Without it the tilt is unreadable rather than merely subtle: a branch drawn above the
     * trunk is either a pleasant feeling or a low-energy one seen from above, and nothing on
     * the screen says which. Each floor line is the neutral level *at one energy*, so a branch
     * is born exactly on its own line and its distance from that line is its valence — which
     * is the reading §8.1 asks for. They span the record and not the day, for rule 1's reason:
     * a line running back to 04:00 would look like a claim about a morning nobody described.
     *
     * Flat has no depth to show, so it has no floor either — one line, the trunk.
     */
    const floor = flat ? [] : [...new Set(legend.map(feeling => feeling.energy))]
        .filter(energy => energy !== TRUNK.energy)
        .map(energy => ({
            energy,
            from: screenPoint({ x: trunkSpan[0], y: TRUNK.valence, z: graphZ(energy) }, camera, scale),
            to: screenPoint({ x: trunkSpan[1], y: TRUNK.valence, z: graphZ(energy) }, camera, scale)
        }));

    const controlClass = 'p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors';

    return (
        <section
            data-day-graph
            aria-label={JOURNAL_COPY.dayGraph.label}
            className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 sm:p-4 space-y-3"
        >
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    {/* The two buttons exist so the drag is never anybody's only way in — the
                        card stack's pager, in the graph's vocabulary. */}
                    <button
                        type="button"
                        onClick={() => turn(-1)}
                        disabled={flat || yaw <= -MAX_YAW}
                        aria-label={JOURNAL_COPY.dayGraph.rotateLeft}
                        data-rotate="left"
                        className={controlClass}
                    >
                        <RotateCcw size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => turn(1)}
                        disabled={flat || yaw >= MAX_YAW}
                        aria-label={JOURNAL_COPY.dayGraph.rotateRight}
                        data-rotate="right"
                        className={controlClass}
                    >
                        <RotateCw size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={() => { setFlat(previous => !previous); turnTo(0); }}
                        data-flat={flat ? 'true' : 'false'}
                        className="ml-1 px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                    >
                        {flat ? JOURNAL_COPY.dayGraph.tilt : JOURNAL_COPY.dayGraph.flatten}
                    </button>
                </div>

                <button
                    type="button"
                    onClick={() => setShowInfo(previous => !previous)}
                    aria-expanded={showInfo}
                    aria-label={JOURNAL_COPY.dayGraph.infoLabel}
                    data-day-graph-info
                    className="p-2 rounded-lg text-slate-300 hover:text-slate-600 transition-colors"
                >
                    <Info size={14} />
                </button>
            </div>

            {showInfo && (
                <div data-day-graph-info-body className="space-y-1 border-l-2 border-slate-100 pl-3">
                    {dayGraphInfo().map(sentence => (
                        <p key={sentence} className="text-[11px] text-slate-400 font-light leading-relaxed">
                            {sentence}
                        </p>
                    ))}
                </div>
            )}

            <div
                ref={plotRef}
                data-day-graph-plot
                // Invariant 2g, in one line: the graph takes the horizontal axis for the turn
                // and the page keeps the vertical, so a scroll that starts on the drawing is
                // still a scroll. The listener above implements the same split in JavaScript;
                // this is what tells the compositor without waiting to be asked.
                style={{ touchAction: 'pan-y' }}
                className="-mx-1"
            >
                <svg
                    data-day-curve
                    viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
                    className="w-full h-auto overflow-visible"
                >
                    <defs>
                        {drawn.filter(path => path.stops).map(path => (
                            <linearGradient
                                key={path.key}
                                id={`${idRef.current}-${path.key}`}
                                gradientUnits="userSpaceOnUse"
                                x1={path.points[0].x}
                                y1="0"
                                x2={path.points[path.points.length - 1].x}
                                y2="0"
                            >
                                {path.stops.map((stop, index) => (
                                    <stop
                                        key={`${stop.offset}-${index}`}
                                        offset={stop.offset}
                                        stopColor={path.hex}
                                        stopOpacity={stop.opacity}
                                    />
                                ))}
                            </linearGradient>
                        ))}
                    </defs>

                    {axis.map(mark => (
                        <g key={mark.at}>
                            <line
                                data-axis-mark={mark.label}
                                x1={mark.top.x}
                                y1={mark.top.y}
                                x2={mark.foot.x}
                                y2={mark.foot.y}
                                stroke="#f1f5f9"
                                strokeWidth="1"
                            />
                            <text
                                x={mark.foot.x}
                                y={PLOT.labelY}
                                fill="#cbd5e1"
                                fontSize="11"
                                textAnchor="middle"
                            >
                                {mark.label}
                            </text>
                        </g>
                    ))}

                    {floor.map(level => (
                        <line
                            key={level.energy}
                            data-floor={level.energy}
                            x1={level.from.x}
                            y1={level.from.y}
                            x2={level.to.x}
                            y2={level.to.y}
                            stroke={TRUNK.hex}
                            strokeWidth="1"
                            strokeOpacity="0.16"
                        />
                    ))}

                    {/* The trunk runs first check-in → last, never 04:00 → 04:00: a line back
                        to the start of the day would claim the user was level all morning,
                        when what is true is that they had not said anything yet (§8.2 rule 1).
                        A round cap so a day with one check-in in it still shows its neutral
                        point: the trunk of a single moment is a point, and a point drawn as
                        nothing would leave the one branch with no baseline to be read against. */}
                    <line
                        data-trunk
                        strokeLinecap="round"
                        x1={trunk.from.x}
                        y1={trunk.from.y}
                        x2={trunk.to.x}
                        y2={trunk.to.y}
                        stroke={TRUNK.hex}
                        strokeWidth="1.5"
                        strokeOpacity="0.55"
                    />

                    {drawn.map(path => {
                        const label = fillCopy(JOURNAL_COPY.dayGraph.branch, {
                            feeling: path.label ?? path.feeling,
                            time: timeOfDay(new Date(curve.bounds.startAt + path.birth.t * MS_PER_MIN)) ?? ''
                        });
                        const openable = Boolean(path.source && onOpenCheckin);
                        const open = () => { if (openable) onOpenCheckin(path.source.ID); };

                        return (
                            <g key={path.key} data-branch={path.feeling} data-branch-key={path.key}>
                                {/* The tap target, as a `<polyline>` and not a second `<path>`:
                                    a 1–3 px line is not something a thumb can land on, and the
                                    count of `<path>`s in this drawing is one per branch
                                    lifetime — a property the suite holds and a second path per
                                    branch would quietly break. */}
                                <polyline
                                    data-hit
                                    points={polyline(path.points)}
                                    fill="none"
                                    stroke="transparent"
                                    strokeWidth="16"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    role={openable ? 'button' : undefined}
                                    tabIndex={openable ? 0 : undefined}
                                    aria-label={openable ? label : undefined}
                                    onClick={openable ? open : undefined}
                                    onFocus={openable ? () => setFocused(path.key) : undefined}
                                    onBlur={openable ? () => setFocused(null) : undefined}
                                    onKeyDown={openable ? (event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            open();
                                        }
                                    } : undefined}
                                    style={{ outline: 'none', cursor: openable ? 'pointer' : 'default', pointerEvents: openable ? 'stroke' : 'none' }}
                                />
                                <path
                                    data-feeling={path.feeling}
                                    data-extrapolated={path.stops ? 'partly' : String(path.points[0].extrapolated === true)}
                                    d={pathD(path.points)}
                                    fill="none"
                                    stroke={path.stops ? `url(#${idRef.current}-${path.key})` : path.hex}
                                    data-focused={focused === path.key ? 'true' : undefined}
                                    strokeWidth={(path.width * path.widthGain * (focused === path.key ? 2 : 1)).toFixed(2)}
                                    strokeOpacity={(path.opacityGain * (path.stops ? 1 : path.points[0].opacity)).toFixed(3)}
                                    strokeDasharray={path.dashed ? DASH : undefined}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    style={{ pointerEvents: 'none' }}
                                />
                            </g>
                        );
                    })}
                </svg>
            </div>

            {legend.length > 0 && (
                <div data-day-graph-legend className="space-y-1">
                    <p className="text-[11px] font-medium text-slate-400">{JOURNAL_COPY.dayGraph.legend}</p>
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                        {legend.map(feeling => (
                            <li key={feeling.id} data-legend-feeling={feeling.id} className="flex items-center gap-1.5 text-xs text-slate-600">
                                <span
                                    className={`h-0 w-4 border-t-2 ${feeling.dashed ? 'border-dashed' : 'border-solid'}`}
                                    style={{ borderColor: feeling.hex }}
                                />
                                {feeling.label}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    );
}
