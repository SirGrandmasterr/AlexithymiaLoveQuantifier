import React, { useMemo } from 'react';
import {
    Radar,
    RadarChart,
    PolarGrid,
    PolarAngleAxis,
    PolarRadiusAxis,
    ResponsiveContainer,
    Tooltip
} from 'recharts';
import { CATEGORIES, isScored } from '../constants/categories';

// One hue for the polygon, colour per vertex. Seven filled hues on one shape is noise;
// the shape itself is the thing to recognise.
const SHAPE_STROKE = '#1e293b';   // slate-800
const SHAPE_FILL = '#94a3b8';     // slate-400
const GHOST_STROKE = '#fb7185';   // rose-400
const GHOST_FILL = '#fb7185';

export const buildShapeData = (snapshot, compareTo) => CATEGORIES.map(category => {
    const scored = isScored(snapshot?.stats, category.id);
    const compareScored = isScored(compareTo?.stats, category.id);
    return {
        id: category.id,
        category: category.label,
        hex: category.hex,
        scored,
        uncertain: scored && (snapshot?.uncertain || []).includes(category.id),
        // Geometry needs a number; `scored` is what says whether the number means anything.
        value: scored ? snapshot.stats[category.id] : 0,
        compare: compareScored ? compareTo.stats[category.id] : (compareTo ? 0 : null),
        compareScored
    };
});

/** Vertex markers: filled when scored, hollow when not, dashed when unsure. */
export const ShapeDot = (props) => {
    const { cx, cy, payload, key } = props;
    if (cx == null || cy == null) return <g key={key} />;

    return (
        <circle
            key={key}
            cx={cx}
            cy={cy}
            r={payload.scored ? 3.5 : 4}
            fill={payload.scored ? payload.hex : '#fff'}
            stroke={payload.hex}
            strokeWidth={payload.scored ? 1 : 1.5}
            strokeDasharray={payload.scored && !payload.uncertain ? undefined : '2 2'}
        />
    );
};

const ShapeTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0].payload;

    let reading;
    if (!row.scored) reading = 'not scored';
    else if (row.uncertain) reading = `≈${row.value} — marked unsure`;
    else reading = String(row.value);

    return (
        <div className="bg-white rounded-xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.15)] px-3 py-2 text-xs">
            <p className="font-semibold text-slate-900">{row.category}</p>
            <p className="text-slate-600">{reading}</p>
            {row.compare !== null && (
                <p className="text-rose-500 mt-0.5">
                    {row.compareScored ? `was ${row.compare}` : 'was not scored'}
                </p>
            )}
        </div>
    );
};

export default function LoveShape({ snapshot, compareTo = null, size = 240, className = '' }) {
    const data = useMemo(() => buildShapeData(snapshot, compareTo), [snapshot, compareTo]);
    if (!snapshot) return null;

    return (
        <div className={className} style={{ width: size, height: size }} data-testid="love-shape">
            <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={data} outerRadius="70%">
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="category" tick={{ fill: '#64748b', fontSize: 10 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Tooltip content={<ShapeTooltip />} />
                    {compareTo && (
                        <Radar
                            name="Compared with"
                            dataKey="compare"
                            stroke={GHOST_STROKE}
                            strokeDasharray="4 3"
                            strokeWidth={1.5}
                            fill={GHOST_FILL}
                            fillOpacity={0.15}
                            dot={false}
                            isAnimationActive={false}
                        />
                    )}
                    <Radar
                        name="This snapshot"
                        dataKey="value"
                        stroke={SHAPE_STROKE}
                        strokeWidth={2}
                        fill={SHAPE_FILL}
                        fillOpacity={0.2}
                        dot={<ShapeDot />}
                        isAnimationActive={false}
                    />
                </RadarChart>
            </ResponsiveContainer>
        </div>
    );
}
