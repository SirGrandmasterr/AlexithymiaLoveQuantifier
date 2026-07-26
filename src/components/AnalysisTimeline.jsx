import React, { useState, useMemo } from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from 'recharts';
import { ChevronLeft } from 'lucide-react';

// Hardcoded hex colors matching the tailwind classes from CATEGORIES
export const CATEGORY_COLORS = {
    eros: '#fb7185',        // bg-rose-400
    ludus: '#fb923c',       // bg-orange-400
    storge: '#fbbf24',      // bg-amber-400
    pragma: '#34d399',      // bg-emerald-400
    mania: '#a78bfa',       // bg-violet-400
    agape: '#60a5fa',       // bg-blue-400
    selflessness: '#94a3b8' // bg-slate-400
};

/**
 * Renders one data point for a category. A skipped category has no value at that
 * snapshot, so nothing is drawn (and `connectNulls={false}` leaves the gap visible);
 * a score flagged unsure gets a dashed outline instead of a solid one.
 */
export const makeDotRenderer = (categoryId) => (props) => {
    const { cx, cy, payload, key } = props;
    if (cx == null || cy == null) return <g key={key} />;

    const unsure = (payload?._uncertain || []).includes(categoryId);
    return (
        <circle
            key={key}
            cx={cx}
            cy={cy}
            r={4}
            fill="#fff"
            stroke={CATEGORY_COLORS[categoryId]}
            strokeWidth={2}
            strokeDasharray={unsure ? '2 2' : undefined}
        />
    );
};

export default function AnalysisTimeline({ versions, onBack, categories }) {
    // Hidden lines state tracking toggled category IDs
    const [hiddenLines, setHiddenLines] = useState(new Set());

    // Sort versions by date ascending for timeline (oldest to newest)
    const sortedData = useMemo(() => {
        if (!versions || versions.length === 0) return [];
        return [...versions].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0)).map(v => {
            // For recharts, we need date and flatted stats. Categories absent from stats
            // stay absent — an unscored category must not be drawn as a zero.
            const dataPoint = {
                date: v.date ? new Date(v.date).toLocaleDateString() : 'Unknown',
                _uncertain: v.uncertain || [],
                ...v.stats // spreads eros: 50, ludus: 20 etc.
            };
            return dataPoint;
        });
    }, [versions]);

    const hasUncertain = useMemo(() => sortedData.some(point => point._uncertain.length > 0), [sortedData]);

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
    const personName = versions[0].name;

    return (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 md:p-8 animate-in fade-in zoom-in-95 duration-200">
            <header className="flex items-center justify-between mb-8 pb-6 border-b border-slate-50">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 text-slate-400 hover:text-slate-700 bg-slate-50 hover:bg-slate-100 rounded-xl transition-colors"
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
                    </div>
                </div>
            </header>

            <div className="h-[500px] w-full mt-4">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sortedData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                        <XAxis
                            dataKey="date"
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
                        {categories.map((cat) => (
                            <Line
                                key={cat.id}
                                type="monotone"
                                dataKey={cat.id}
                                name={cat.label}
                                stroke={CATEGORY_COLORS[cat.id]}
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
        </div>
    );
}
