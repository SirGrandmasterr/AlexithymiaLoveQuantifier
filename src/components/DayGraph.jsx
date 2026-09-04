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

/* 1. The camera and the canvas */

export const DEFAULT_PITCH = 26;

/** One press of a rotate button, in degrees, and how far the two of them reach. */
export const ROTATE_STEP = 15;
export const MAX_YAW = 45;

export const ROTATE_PX = 45;
const YIELD_PX = 12;

const DEPTH_SCALE = 1;
const Z_HALF = 0.5 * DEPTH_SCALE;

const Y_EXTENT = Math.max(...FEELINGS.map(feeling => Math.abs(feeling.valence)));

const VIEW = Object.freeze({ width: 720, height: 300 });
const PLOT = Object.freeze({ cx: 360, cy: 138, halfWidth: 350, halfHeight: 112, labelY: 288 });

/** Dashed exactly as the radar's ghost polygon is: one `≈` convention across the app. */
const DASH = '4 3';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const MS_PER_MIN = 60000;

/* 2. The day as an axis */

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

/* 3. Graph space → screen */

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

/* 4. The ⓘ */

export const dayGraphInfo = ({
    halfLifeMin = FEELING_HALF_LIFE_MIN,
    unstatedIntensity = UNSTATED_INTENSITY
} = {}) => [
    fillCopy(JOURNAL_COPY.dayGraph.fade, { halfLife: humanMinutes(halfLifeMin) }),
    fillCopy(JOURNAL_COPY.dayGraph.unstated, { strength: unstatedIntensity }),
    JOURNAL_COPY.dayGraph.extrapolated,
    JOURNAL_COPY.dayGraph.caveat
];

/* 5. Branch → check-in */

export const sourceCheckin = (entries, bounds, path) => {
    if (!bounds || !path) return null;
    const at = bounds.startAt + path.birth.t * MS_PER_MIN;

    return (Array.isArray(entries) ? entries : []).find(entry => (
        entry?.kind === 'checkin'
        && new Date(entry.at).getTime() === at
        && readCheckin(entry.payload).feelings.some(feeling => feeling.id === path.feeling)
    )) ?? null;
};

/* 6. The component */

/** Gradient ids have to be unique in a document, and two day graphs on one page is legal. */
let graphSequence = 0;

export default function DayGraph({ day, entries = [], onOpenCheckin = null }) {
    const [yaw, setYaw] = useState(0);
    const yawRef = useRef(0);
    const [flat, setFlat] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
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
