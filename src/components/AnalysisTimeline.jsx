import React, { useState, useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ReferenceLine,
    ResponsiveContainer
} from 'recharts';
import { ChevronLeft, X } from 'lucide-react';
import LoveShape from './LoveShape';
import { CATEGORIES, byDateDesc } from '../constants/categories';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Renders one data point for a category. A skipped category has no value at that
 * snapshot, so nothing is drawn (and `connectNulls={false}` leaves the gap visible);
 * a score flagged unsure gets a dashed outline instead of a solid one.
 */
export const makeDotRenderer = (categoryId) => (props) => {
    const { cx, cy, payload, key } = props;
    if (cx == null || cy == null) return <g key={key} />;

    const unsure = (payload?._uncertain || []).includes(categoryId);
    // A pulse is a real reading, drawn a little quieter — it says "I checked" rather than
    // "I sat down with this". Same line, same weight, smaller point.
    const pulse = payload?._kind === 'pulse';
    const category = CATEGORIES.find(c => c.id === categoryId);
    return (
        <circle
            key={key}
            cx={cx}
            cy={cy}
            r={pulse ? 2.5 : 4}
            fill="#fff"
            stroke={category?.hex}
            strokeWidth={2}
            strokeDasharray={unsure ? '2 2' : undefined}
        />
    );
};

/** A snapshot earns a milestone marker when it carries context worth pointing at. */
export const hasMilestone = (snapshot) =>
    (snapshot.tags || []).length > 0 || Boolean((snapshot.description || '').trim());

/**
 * Shapes a stack for the chart. Undated snapshots have no position on a real time axis,
 * so they are excluded and counted rather than silently placed at the origin.
 *
 * Snapshots sharing a date would stack on one x-position, so duplicates are nudged
 * forward 12h **for display only** — the stored dates are untouched.
 */
export const buildTimelineData = (versions) => {
    const dated = (versions || []).filter(v => v.date);
    const undatedCount = (versions || []).length - dated.length;

    const used = new Set();
    const rows = [...dated]
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map(snapshot => {
            let ts = new Date(snapshot.date).getTime();
            while (used.has(ts)) ts += 12 * HOUR;
            used.add(ts);
            return { ts, snapshot };
        });

    return {
        undatedCount,
        chartData: rows.map(({ ts, snapshot }) => ({
            ts,
            _uncertain: snapshot.uncertain || [],
            _kind: snapshot.kind || 'full',
            ...snapshot.stats
        })),
        markers: rows.filter(({ snapshot }) => hasMilestone(snapshot))
    };
};

const formatDate = (ts) => new Date(ts).toLocaleDateString();

export default function AnalysisTimeline({ versions, onBack, maskName = (name) => name }) {
    // Hidden lines state tracking toggled category IDs
    const [hiddenLines, setHiddenLines] = useState(new Set());
    const [activeMarker, setActiveMarker] = useState(null);
    const [compareMode, setCompareMode] = useState('first');

    const { chartData, markers, undatedCount } = useMemo(() => buildTimelineData(versions), [versions]);

    const byDate = useMemo(() => [...(versions || [])].sort(byDateDesc), [versions]);
    const latest = byDate[0];
    const compareTo = compareMode === 'none'
        ? null
        : compareMode === 'previous'
            ? byDate[1] || null
            : byDate[byDate.length - 1] || null;

    const hasUncertain = useMemo(
        () => chartData.some(point => point._uncertain.length > 0),
        [chartData]
    );

    // Handle clicking a legend item to toggle visibility
    const handleLegendClick = (e) => {
        const dataKey = e.dataKey;
        const newHiddenLines = new Set(hiddenLines);
        if (newHiddenLines.has(dataKey)) {
            newHiddenLines.delete(dataKey);
        } else {
            newHiddenLines.add(dataKey);
        }
        setHiddenLines(newHiddenLines);
    };

    if (!versions || versions.length === 0) return null;
    const personName = maskName(versions[0].name);

    // A single point (or several on one day) would collapse the domain to zero width.
    const timestamps = chartData.map(p => p.ts);
    const domain = timestamps.length > 1 && Math.max(...timestamps) > Math.min(...timestamps)
        ? ['dataMin', 'dataMax']
        : [Math.min(...timestamps, Date.now()) - DAY, Math.max(...timestamps, Date.now()) + DAY];

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 md:p-8 animate-in fade-in zoom-in-95 duration-200">
            <header className="flex flex-col lg:flex-row lg:items-start justify-between gap-6 mb-8 pb-6 border-b border-slate-50">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors flex-shrink-0"
                        title="Back to Dashboard"
                    >
                        <ChevronLeft size={24} />
                    </button>
                    <div>
                        <h2 className="text-2xl font-light text-slate-800">
                            Timeline Analysis: <span className="font-medium">{personName}</span>
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            Click on categories in the legend to toggle their visibility.
                            {hasUncertain && ' Dashed points were flagged unsure; gaps are snapshots where the category was skipped.'}
                        </p>
                        {undatedCount > 0 && (
                            <p className="text-xs text-slate-400 mt-1">
                                {undatedCount} undated snapshot{undatedCount === 1 ? '' : 's'} not shown — the axis is real time,
                                and an undated snapshot has no place on it.
                            </p>
                        )}
                    </div>
                </div>

                {latest && (
                    <div className="flex flex-col items-center flex-shrink-0">
                        <LoveShape snapshot={latest} compareTo={compareTo} size={200} />
                        <div className="flex items-center gap-1 mt-1">
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 mr-1">Compare to</span>
                            {[
                                { key: 'first', label: 'first' },
                                { key: 'previous', label: 'previous' },
                                { key: 'none', label: 'none' }
                            ].map(option => (
                                <button
                                    key={option.key}
                                    type="button"
                                    onClick={() => setCompareMode(option.key)}
                                    aria-pressed={compareMode === option.key}
                                    className={`px-2 py-0.5 rounded-md text-[11px] border transition-colors ${compareMode === option.key
                                        ? 'bg-slate-800 text-white border-slate-800'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                                        }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </header>

            <div className="h-[500px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    {/* The top margin is the reserved band the milestone flags sit in. */}
                    <LineChart data={chartData} margin={{ top: 28, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis
                            dataKey="ts"
                            type="number"
                            scale="time"
                            domain={domain}
                            tickFormatter={formatDate}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#64748b', fontSize: 12 }}
                            dy={10}
                        />
                        <YAxis
                            domain={[0, 100]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: '#64748b', fontSize: 12 }}
                            width={50}
                        />
                        <Tooltip
                            labelFormatter={formatDate}
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px -4px rgba(0,0,0,0.1)' }}
                            itemStyle={{ fontWeight: 500 }}
                            labelStyle={{ fontWeight: 600, color: '#0f172a', marginBottom: '4px' }}
                        />
                        <Legend
                            onClick={handleLegendClick}
                            wrapperStyle={{ paddingTop: '20px' }}
                            formatter={(value, entry) => {
                                const isHidden = hiddenLines.has(entry.dataKey);
                                return <span style={{ color: isHidden ? '#cbd5e1' : '#334155', transition: 'color 0.2s', cursor: 'pointer', fontWeight: 500, userSelect: 'none' }}>{value}</span>;
                            }}
                        />

                        {markers.map(({ ts, snapshot }) => (
                            <ReferenceLine
                                key={`marker-${ts}`}
                                x={ts}
                                stroke="#cbd5e1"
                                strokeDasharray="3 3"
                                label={<MilestoneFlag onSelect={() => setActiveMarker({ ts, snapshot })} snapshot={snapshot} />}
                            />
                        ))}

                        {CATEGORIES.map((cat) => (
                            <Line
                                key={cat.id}
                                type="monotone"
                                dataKey={cat.id}
                                name={cat.label}
                                stroke={cat.hex}
                                strokeWidth={3}
                                dot={makeDotRenderer(cat.id)}
                                activeDot={{ r: 6, strokeWidth: 0 }}
                                connectNulls={false}
                                hide={hiddenLines.has(cat.id)}
                            />
                        ))}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {activeMarker && (
                <MilestoneDetail marker={activeMarker} onClose={() => setActiveMarker(null)} />
            )}

            {markers.length > 0 && !activeMarker && (
                <p className="text-xs text-slate-400 mt-4">
                    Flags mark snapshots that carry a note or tags. Select one to read it — a marker
                    says what else was happening, not what caused what.
                </p>
            )}
        </div>
    );
}

/** The clickable glyph a milestone marker draws in the chart's reserved top band. */
const MilestoneFlag = ({ viewBox, snapshot, onSelect }) => {
    if (!viewBox) return null;
    const { x, y } = viewBox;
    const label = `Milestone on ${formatDate(new Date(snapshot.date).getTime())}`;

    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={onSelect}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
            style={{ cursor: 'pointer' }}
        >
            <title>{label}</title>
            {/* Generous transparent hit area over a small flag drawn in slate */}
            <rect x={x - 10} y={y - 24} width={20} height={22} fill="transparent" />
            <path d={`M ${x} ${y - 20} L ${x} ${y - 4}`} stroke="#94a3b8" strokeWidth={1.5} />
            <path d={`M ${x} ${y - 20} L ${x + 9} ${y - 16} L ${x} ${y - 12} Z`} fill="#94a3b8" />
        </g>
    );
};

const MilestoneDetail = ({ marker, onClose }) => (
    <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
        <div className="flex justify-between items-start gap-4">
            <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {formatDate(new Date(marker.snapshot.date).getTime())}
                </p>
                {(marker.snapshot.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                        {marker.snapshot.tags.map(tag => (
                            <span key={tag} className="text-[10px] text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                {marker.snapshot.description && (
                    <p className="text-sm text-slate-600 font-light mt-2 whitespace-pre-wrap">
                        {marker.snapshot.description}
                    </p>
                )}
            </div>
            <button
                type="button"
                onClick={onClose}
                aria-label="Close milestone"
                className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors flex-shrink-0"
            >
                <X size={16} />
            </button>
        </div>
    </div>
);
