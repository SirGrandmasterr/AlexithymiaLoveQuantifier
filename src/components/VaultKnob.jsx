import React, { useRef, useState } from 'react';
import { startTurn, detent, endTurn } from '../mobile/knobFeedback';

/** Pixels of vertical travel per unit. The full 0–100 sweep is one comfortable thumb drag. */
const PX_PER_UNIT = 2.6;

/** One full revolution per 100 units, exactly as a hundred-number dial is laid out. */
const DEGREES_PER_UNIT = 3.6;

const clamp = (value) => Math.min(100, Math.max(0, value));

const pointAt = (units, radius) => {
    // Angles run clockwise from twelve o'clock, where the fixed index sits.
    const radians = (units * DEGREES_PER_UNIT * Math.PI) / 180;
    return {
        x: 50 + radius * Math.sin(radians),
        y: 50 - radius * Math.cos(radians)
    };
};

const TICKS = (() => {
    const segments = [];
    for (let units = 0; units < 100; units += 4) {
        const major = units % 20 === 0;
        const outer = pointAt(-units, 40);
        const inner = pointAt(-units, major ? 31 : 35);
        segments.push(`M${outer.x.toFixed(2)} ${outer.y.toFixed(2)}L${inner.x.toFixed(2)} ${inner.y.toFixed(2)}`);
    }
    return segments.join('');
})();

const KNURL = (() => {
    const segments = [];
    for (let units = 0; units < 100; units += 2.5) {
        const outer = pointAt(-units, 49);
        const inner = pointAt(-units, 44);
        segments.push(`M${outer.x.toFixed(2)} ${outer.y.toFixed(2)}L${inner.x.toFixed(2)} ${inner.y.toFixed(2)}`);
    }
    return segments.join('');
})();

/** Engraved numerals every ten, oriented outward the way a real dial's are. */
const NUMERALS = Array.from({ length: 10 }, (unused, index) => {
    const units = index * 10;
    const position = pointAt(-units, 24);
    return { units, ...position, rotation: -units * DEGREES_PER_UNIT };
});

export default function VaultKnob({
    value,
    onChange,
    label,
    disabled = false,
    size = 60
}) {
    const [turning, setTurning] = useState(false);
    // Held in a ref rather than state: it is read and written inside the pointer handlers on
    // every move, and a re-render per pixel would be both pointless and slow.
    const drag = useRef(null);

    const move = (next) => {
        const bounded = clamp(next);
        if (bounded === value) return bounded;
        onChange(bounded);
        return bounded;
    };

    const onPointerDown = (event) => {
        if (disabled) return;

        // Claim the gesture before the page can read it as a scroll.
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);

        drag.current = { startY: event.clientY, startValue: value, lastValue: value };
        setTurning(true);
        startTurn();
    };

    const onPointerMove = (event) => {
        const state = drag.current;
        if (!state) return;

        // Down is clockwise is up-the-scale: the dial turns the way the finger pushes it.
        const travelled = event.clientY - state.startY;
        const next = clamp(Math.round(state.startValue + travelled / PX_PER_UNIT));
        if (next === state.lastValue) return;

        // One detent per unit crossed. The feedback module rate-limits both channels, so a
        // fast flick is a run of clicks rather than a hundred of them.
        detent();
        state.lastValue = next;
        move(next);

        if (next === 0 || next === 100) {
            state.startY = event.clientY;
            state.startValue = next;
        }
    };

    const onPointerUp = (event) => {
        if (!drag.current) return;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        drag.current = null;
        setTurning(false);
        endTurn();
    };

    const onKeyDown = (event) => {
        if (disabled) return;

        const steps = {
            ArrowUp: 1, ArrowRight: 1,
            ArrowDown: -1, ArrowLeft: -1,
            PageUp: 10, PageDown: -10
        };

        let next;
        if (event.key in steps) next = value + steps[event.key];
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = 100;
        else return;

        event.preventDefault();
        if (move(next) !== value) detent();
    };

    return (
        <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            {turning && (
                <span
                    aria-hidden="true"
                    className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-slate-900 text-white text-sm font-mono tabular-nums shadow-lg pointer-events-none z-20"
                >
                    {value}
                </span>
            )}

            <div
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={`${label} dial`}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-orientation="vertical"
                aria-disabled={disabled || undefined}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
                style={{ touchAction: 'none', width: size, height: size }}
                className={`rounded-full outline-none transition-transform duration-100 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-grab active:cursor-grabbing'
                    } ${turning ? 'scale-105' : ''}`}
            >
                <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
                    <defs>
                        <linearGradient id="alq-dial-rim" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#f1f5f9" />
                            <stop offset="45%" stopColor="#cbd5e1" />
                            <stop offset="55%" stopColor="#94a3b8" />
                            <stop offset="100%" stopColor="#e2e8f0" />
                        </linearGradient>
                        <radialGradient id="alq-dial-face" cx="38%" cy="30%" r="80%">
                            <stop offset="0%" stopColor="#475569" />
                            <stop offset="55%" stopColor="#334155" />
                            <stop offset="100%" stopColor="#1e293b" />
                        </radialGradient>
                        <radialGradient id="alq-dial-hub" cx="35%" cy="30%" r="70%">
                            <stop offset="0%" stopColor="#e2e8f0" />
                            <stop offset="100%" stopColor="#94a3b8" />
                        </radialGradient>
                    </defs>

                    {/* Everything that turns, in one group: one transform per frame. */}
                    <g transform={`rotate(${value * DEGREES_PER_UNIT} 50 50)`}>
                        <circle cx="50" cy="50" r="49" fill="url(#alq-dial-rim)" />
                        <path d={KNURL} stroke="#64748b" strokeWidth="1.1" opacity="0.55" />
                        <circle cx="50" cy="50" r="43" fill="url(#alq-dial-face)" />
                        <circle cx="50" cy="50" r="43" fill="none" stroke="#0f172a" strokeWidth="1" opacity="0.6" />
                        <path d={TICKS} stroke="#cbd5e1" strokeWidth="1.4" opacity="0.75" strokeLinecap="round" />

                        {NUMERALS.map(({ units, x, y, rotation }) => (
                            <text
                                key={units}
                                x={x}
                                y={y}
                                fill="#e2e8f0"
                                fontSize="11"
                                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                transform={`rotate(${rotation} ${x} ${y})`}
                            >
                                {units}
                            </text>
                        ))}

                        <circle cx="50" cy="50" r="9" fill="url(#alq-dial-hub)" />
                        <circle cx="50" cy="50" r="9" fill="none" stroke="#475569" strokeWidth="0.8" />
                    </g>

                    <path d="M50 2 L45 12 L55 12 Z" fill="#f43f5e" />
                    <circle cx="50" cy="50" r="49" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
                    <path
                        d="M18 22 A45 45 0 0 1 72 14"
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="5"
                        opacity="0.25"
                        strokeLinecap="round"
                    />
                </svg>
            </div>
        </div>
    );
}
