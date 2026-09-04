import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { useJournal } from '../context/JournalContext';
import { useDiscretion } from '../context/DiscretionContext';
import { Frame, LoadFailed, Loading } from './Journal';
import { UNSTATED_INTENSITY } from './dayGraph.js';
import { JOURNAL_COPY, countCopy, feelingById, fillCopy } from '../constants/journal';
import { LEVELS, atLevel, observationsOf, seriesOf } from '../journal/analytics/observations';
import {
    AXES,
    EWMA_HALFLIFE,
    addSmoothing,
    familyProfile,
    labelHeatmap,
    triggerSummary,
    weeklyMood
} from '../journal/analytics/drift';
import {
    MAGNITUDE,
    MAX_SERIES,
    POLARITY,
    circumplexLayout,
    driftBarsLayout,
    heatmapLayout,
    radarLayout,
    seriesColor,
    timeseriesLayout,
    weeklyLayout
} from '../journal/analytics/charts';

/* 1. Small pieces */

const copy = JOURNAL_COPY.insights;

/** Dashed exactly as the day graph's uncertain branch and the radar's ghost are. */
const DASH = '4 3';

/** How many series are drawn before the user picks: the EmotionGuesser's default. */
export const DEFAULT_SERIES = 5;

const signed = (value) => (Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}` : '—');

const Card = ({ heading, hint, children, ...rest }) => (
    <section {...rest} className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-3">
        <div className="space-y-1">
            <h2 className="text-sm font-medium text-slate-700">{heading}</h2>
            {hint && <p className="text-[11px] text-slate-400 font-light leading-relaxed">{hint}</p>}
        </div>
        {children}
    </section>
);

const Segmented = ({ label, options, value, onChange, name }) => (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">{label}</span>
        {options.map(option => (
            <button
                key={option.value}
                type="button"
                data-segment={`${name}:${option.value}`}
                aria-pressed={value === option.value}
                title={option.hint}
                onClick={() => onChange(option.value)}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${value === option.value
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                    }`}
            >
                {option.label}
            </button>
        ))}
    </div>
);

/** A series label under discretion: a person is masked, a trigger is blurred. */
const useSeriesLabel = () => {
    const { maskName, blurClass } = useDiscretion();
    return useCallback((series) => {
        if (series?.kind === 'person') return { text: maskName(series.label), className: '' };
        if (series?.kind === 'pair' && series.parts?.side?.kind === 'person') {
            const happening = series.parts.happening ? ` · ${series.parts.happening.label}` : '';
            return { text: `${maskName(series.parts.side.label)}${happening}`, className: blurClass };
        }
        return { text: series?.label ?? '', className: blurClass };
    }, [maskName, blurClass]);
};

/* 2. The drawings — each a map over its layout */

const Circumplex = ({ layout, labelOf }) => (
    <svg data-insights-circumplex viewBox={`0 0 ${layout.view.width} ${layout.view.height}`} className="w-full h-auto overflow-visible">
        <line x1={layout.axes.xLine.x1} x2={layout.axes.xLine.x2} y1={layout.axes.xLine.y} y2={layout.axes.xLine.y} stroke="#e2e8f0" strokeWidth="1" />
        <line x1={layout.axes.yLine.x} x2={layout.axes.yLine.x} y1={layout.axes.yLine.y1} y2={layout.axes.yLine.y2} stroke="#e2e8f0" strokeWidth="1" />
        <line x1={layout.axes.xLine.x1} x2={layout.axes.xLine.x2} y1={layout.axes.midY} y2={layout.axes.midY} stroke="#f1f5f9" strokeWidth="1" />

        {layout.anchors.map(anchor => (
            <text key={anchor.id} data-anchor={anchor.id} x={anchor.x} y={anchor.y} fill="#cbd5e1" fontSize="10" textAnchor="middle">
                {anchor.label}
            </text>
        ))}

        <text x={layout.view.width - layout.view.right} y={layout.view.top + 10} fill="#94a3b8" fontSize="10" textAnchor="end">{copy.circumplex.corner.highPleasant}</text>
        <text x={layout.view.left} y={layout.view.top + 10} fill="#94a3b8" fontSize="10" textAnchor="start">{copy.circumplex.corner.highUnpleasant}</text>
        <text x={layout.view.width - layout.view.right} y={layout.view.height - layout.view.bottom - 6} fill="#94a3b8" fontSize="10" textAnchor="end">{copy.circumplex.corner.lowPleasant}</text>
        <text x={layout.view.left} y={layout.view.height - layout.view.bottom - 6} fill="#94a3b8" fontSize="10" textAnchor="start">{copy.circumplex.corner.lowUnpleasant}</text>
        <text x={(layout.view.left + layout.view.width - layout.view.right) / 2} y={layout.view.height - 8} fill="#94a3b8" fontSize="11" textAnchor="middle">{copy.circumplex.axisX}</text>
        <text x={14} y={(layout.view.top + layout.view.height - layout.view.bottom) / 2} fill="#94a3b8" fontSize="11" textAnchor="middle" transform={`rotate(-90 14 ${(layout.view.top + layout.view.height - layout.view.bottom) / 2})`}>{copy.circumplex.axisY}</text>

        {layout.series.map(series => {
            const { text } = labelOf(series);
            return (
                <g key={series.key} data-series={series.key}>
                    <path d={series.path} fill="none" stroke={series.color} strokeWidth="1.5" strokeOpacity="0.4" strokeLinejoin="round" strokeLinecap="round" />
                    {series.points.map((point, index) => (
                        <circle key={`${point.entryId}-${index}`} data-point={point.feelingId} cx={point.x} cy={point.y} r={point.r} fill={series.color} fillOpacity="0.8" stroke="#ffffff" strokeWidth="1.5">
                            <title>{`${text} · ${point.day ?? ''} · ${feelingById(point.feelingId)?.label ?? point.feelingId}`}</title>
                        </circle>
                    ))}
                    {series.last && (
                        <circle data-last cx={series.last.x} cy={series.last.y} r={series.last.r + 4} fill="none" stroke={series.color} strokeWidth="1.5" />
                    )}
                </g>
            );
        })}
    </svg>
);

const DriftBars = ({ layout, axis, labelOf }) => (
    <div className="overflow-x-auto">
        <svg data-insights-drift viewBox={`0 0 ${layout.view.width} ${layout.view.height}`} className="w-full h-auto overflow-visible" style={{ minWidth: 320 }}>
            <line x1={layout.center} x2={layout.center} y1={layout.view.top - 4} y2={layout.view.height - layout.view.bottom + 4} stroke="#cbd5e1" strokeWidth="1" />
            {layout.bars.map(bar => {
                const { text, className } = labelOf(bar);
                return (
                    <g key={bar.key} data-bar={bar.key} data-polarity={bar.polarity}>
                        <text x={layout.view.labelWidth - 10} y={bar.y + bar.height / 2 + 4} fill="#475569" fontSize="11" textAnchor="end" className={className}>
                            {text.length > 28 ? `${text.slice(0, 27)}…` : text}
                        </text>
                        <rect x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx="3" fill={bar.color} fillOpacity="0.75">
                            <title>{`${text}: ${signed(bar.value)} · ${countCopy(bar.count, copy.series.entries)}`}</title>
                        </rect>
                        <text x={bar.polarity === 'away' ? bar.x - 6 : bar.x + bar.width + 6} y={bar.y + bar.height / 2 + 4} fill="#94a3b8" fontSize="10" textAnchor={bar.polarity === 'away' ? 'end' : 'start'}>
                            {signed(bar.value)}
                        </text>
                    </g>
                );
            })}
            <text x={layout.view.labelWidth} y={layout.view.height - 6} fill="#94a3b8" fontSize="10" textAnchor="start">{copy.drift.axisAway[axis]}</text>
            <text x={layout.view.width - layout.view.gap} y={layout.view.height - 6} fill="#94a3b8" fontSize="10" textAnchor="end">{copy.drift.axis[axis]}</text>
        </svg>
    </div>
);

const Timeseries = ({ layout, color }) => (
    <svg data-insights-timeseries viewBox={`0 0 ${layout.view.width} ${layout.view.height}`} className="w-full h-auto overflow-visible">
        <line x1={layout.view.left} x2={layout.view.width - layout.view.right} y1={layout.topY} y2={layout.topY} stroke="#f1f5f9" strokeWidth="1" />
        <line x1={layout.view.left} x2={layout.view.width - layout.view.right} y1={layout.bottomY} y2={layout.bottomY} stroke="#f1f5f9" strokeWidth="1" />
        {layout.zeroY !== null && (
            <line x1={layout.view.left} x2={layout.view.width - layout.view.right} y1={layout.zeroY} y2={layout.zeroY} stroke="#cbd5e1" strokeWidth="1" strokeDasharray={DASH} />
        )}
        <text x={layout.view.left - 6} y={layout.topY + 4} fill="#cbd5e1" fontSize="10" textAnchor="end">{layout.range[1]}</text>
        <text x={layout.view.left - 6} y={layout.bottomY + 4} fill="#cbd5e1" fontSize="10" textAnchor="end">{layout.range[0]}</text>
        {layout.ticks.map(tick => (
            <text key={tick.at} x={tick.x} y={layout.view.height - 8} fill="#cbd5e1" fontSize="10" textAnchor="middle">
                {new Date(tick.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </text>
        ))}
        {layout.line && <path data-smoothed d={layout.line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {layout.points.map((point, index) => (
            <circle key={`${point.at}-${index}`} data-point={point.feelingId} cx={point.x} cy={point.y} r={point.r} fill={color} fillOpacity="0.45" stroke="#ffffff" strokeWidth="1.5">
                <title>{`${point.day ?? ''} · ${feelingById(point.feelingId)?.label ?? point.feelingId} · ${signed(point.value)}${point.quote ? ` · “${point.quote}”` : ''}`}</title>
            </circle>
        ))}
    </svg>
);

const Heatmap = ({ layout, labelOf }) => (
    <div className="overflow-x-auto">
        <svg data-insights-heatmap viewBox={`0 0 ${layout.view.width} ${layout.view.height}`} width={layout.view.width} height={layout.view.height} className="h-auto max-w-none">
            {layout.columns.map(column => (
                <text
                    key={column.id}
                    x={column.x + layout.view.cell / 2}
                    y={layout.view.headerHeight - 6}
                    fill="#64748b"
                    fontSize="10"
                    textAnchor="start"
                    transform={`rotate(-55 ${column.x + layout.view.cell / 2} ${layout.view.headerHeight - 6})`}
                >
                    {column.label}
                </text>
            ))}
            {layout.rows.map(row => {
                const { text, className } = labelOf(row);
                return (
                    <g key={row.key} data-heat-row={row.key}>
                        <text x={layout.view.labelWidth - 8} y={row.y + layout.view.cell / 2 + 4} fill="#475569" fontSize="11" textAnchor="end" className={className}>
                            {text.length > 24 ? `${text.slice(0, 23)}…` : text}
                        </text>
                        {row.cells.map(cell => (
                            <rect
                                key={cell.feelingId}
                                data-cell={`${row.key}:${cell.feelingId}`}
                                x={cell.x + 1}
                                y={row.y + 1}
                                width={layout.view.cell - 2}
                                height={layout.view.cell - 2}
                                rx="3"
                                fill={cell.empty ? '#f8fafc' : MAGNITUDE}
                                fillOpacity={cell.empty ? 1 : cell.opacity}
                            >
                                <title>{`${text} · ${feelingById(cell.feelingId)?.label ?? cell.feelingId}: ${cell.value}`}</title>
                            </rect>
                        ))}
                    </g>
                );
            })}
        </svg>
    </div>
);

const Weekly = ({ layout }) => (
    <svg data-insights-weekly viewBox={`0 0 ${layout.view.width} ${layout.view.height}`} className="w-full h-auto overflow-visible">
        {layout.strips.map(strip => (
            <g key={strip.axis} data-strip={strip.axis}>
                <line x1={layout.view.left} x2={layout.view.width - layout.view.right} y1={strip.zeroY} y2={strip.zeroY} stroke="#e2e8f0" strokeWidth="1" />
                <text x={layout.view.left - 6} y={strip.top + 12} fill="#94a3b8" fontSize="10" textAnchor="end">{copy.weekly[strip.axis]}</text>
                <path d={strip.line} fill="none" stroke={strip.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {strip.points.map(point => (
                    <circle key={point.week} data-week={point.week} cx={point.x} cy={point.y} r="3.5" fill={strip.color} stroke="#ffffff" strokeWidth="1.5">
                        <title>{`${point.week} · ${copy.weekly[strip.axis]} ${signed(point.value)} · ${countCopy(point.count, copy.series.entries)}`}</title>
                    </circle>
                ))}
            </g>
        ))}
        {layout.ticks.map(tick => (
            <text key={tick.week} x={tick.x} y={layout.view.height + 12} fill="#cbd5e1" fontSize="10" textAnchor="middle">{tick.week.slice(5)}</text>
        ))}
    </svg>
);

const Radar = ({ layout }) => (
    <svg data-insights-radar viewBox={`0 0 ${layout.view.size} ${layout.view.size}`} className="w-full max-w-[260px] h-auto mx-auto overflow-visible">
        {layout.rings.map(ring => (
            <circle key={ring} cx={layout.center} cy={layout.center} r={ring} fill="none" stroke="#e2e8f0" strokeWidth="1" />
        ))}
        {layout.families.map(family => (
            <g key={family.family}>
                <line x1={layout.center} y1={layout.center} x2={family.axisX} y2={family.axisY} stroke="#e2e8f0" strokeWidth="1" />
                <text x={family.labelX} y={family.labelY + 3} fill="#64748b" fontSize="10" textAnchor="middle">{copy.radar.families[family.family]}</text>
            </g>
        ))}
        {layout.max > 0 && (
            <polygon data-radar-polygon points={layout.polygon} fill="#94a3b8" fillOpacity="0.2" stroke="#1e293b" strokeWidth="2" strokeLinejoin="round" />
        )}
        {layout.max > 0 && layout.families.map(family => (
            <circle key={family.family} data-family={family.family} cx={family.x} cy={family.y} r="3" fill="#1e293b">
                <title>{`${copy.radar.families[family.family]}: ${family.total}`}</title>
            </circle>
        ))}
    </svg>
);

/* 3. The screen */

const Empty = ({ message }) => (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-8 sm:p-12 text-center">
        <p className="text-sm text-slate-500 font-light">{message}</p>
    </div>
);

export const insightsInfo = () => [
    copy.caveat,
    copy.coordinates,
    fillCopy(copy.unstated, { strength: UNSTATED_INTENSITY }),
    fillCopy(copy.smoothing, { halflife: EWMA_HALFLIFE })
];

export default function JournalInsights() {
    const { entries, loading, loadError, dismissLoadError, loadAll, resolveTrigger, personName } = useJournal();
    const labelOf = useSeriesLabel();

    // Drift is over the whole record, never over whichever month the day view last loaded.
    useEffect(() => { loadAll(); }, [loadAll]);

    const [level, setLevel] = useState('pair');
    const [picked, setPicked] = useState(null);
    const [smoothed, setSmoothed] = useState(true);
    const [driftAxis, setDriftAxis] = useState('valence');
    const [focus, setFocus] = useState(null);
    const [focusDim, setFocusDim] = useState('valence');
    const [showInfo, setShowInfo] = useState(false);

    const observations = useMemo(
        () => observationsOf(entries, { resolveTrigger, personName }),
        [entries, resolveTrigger, personName]
    );
    const keyed = useMemo(() => atLevel(observations, level), [observations, level]);
    const smoothedRows = useMemo(() => addSmoothing(keyed), [keyed]);
    const series = useMemo(() => seriesOf(keyed), [keyed]);
    const summary = useMemo(() => triggerSummary(keyed), [keyed]);
    const weeks = useMemo(() => weeklyMood(entries), [entries]);

    // The user's pick, or the most-named few until they make one. A level change resets
    // it, because a key from one grouping means nothing in another.
    const chosen = useMemo(() => {
        const available = new Set(series.map(entry => entry.key));
        const kept = (picked ?? []).filter(key => available.has(key));
        if (picked !== null && kept.length > 0) return kept;
        return series.slice(0, DEFAULT_SERIES).map(entry => entry.key);
    }, [series, picked]);

    const focused = focus && series.some(entry => entry.key === focus) ? focus : (series[0]?.key ?? null);

    const togglePick = (key) => setPicked(previous => {
        const current = previous ?? chosen;
        if (current.includes(key)) return current.filter(entry => entry !== key);
        if (current.length >= MAX_SERIES) return current;
        return [...current, key];
    });

    const changeLevel = (next) => {
        setLevel(next);
        setPicked(null);
        setFocus(null);
    };

    const circumplex = useMemo(() => circumplexLayout(smoothedRows, chosen, { smoothed }), [smoothedRows, chosen, smoothed]);
    const drift = useMemo(() => driftBarsLayout(summary, driftAxis), [summary, driftAxis]);
    const timeseries = useMemo(() => timeseriesLayout(smoothedRows, focused, focusDim), [smoothedRows, focused, focusDim]);
    const heatmap = useMemo(() => heatmapLayout(labelHeatmap(keyed)), [keyed]);
    const weekly = useMemo(() => weeklyLayout(weeks), [weeks]);
    const radar = useMemo(
        () => radarLayout(familyProfile(keyed.filter(row => chosen.includes(row.key)))),
        [keyed, chosen]
    );

    const focusedSummary = summary.find(entry => entry.key === focused) ?? null;
    const focusedRows = useMemo(() => keyed.filter(row => row.key === focused), [keyed, focused]);
    const focusedSeries = series.find(entry => entry.key === focused) ?? null;
    const focusColor = seriesColor(Math.max(0, chosen.indexOf(focused)));

    const companions = useMemo(() => {
        const counts = new Map();
        focusedRows.forEach((row) => {
            const other = level === 'trigger' && row.interaction && `trigger:${row.interaction.id}` === focused
                ? (row.person?.name ?? row.entity?.label ?? null)
                : (row.interaction?.label ?? null);
            const label = other ?? copy.series1.withNothing;
            counts.set(label, (counts.get(label) ?? 0) + 1);
        });
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => `${label} (${count})`);
    }, [focusedRows, level, focused]);

    const empty = observations.length === 0;

    return (
        <Frame>
            <header className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                        <h1 className="text-xl sm:text-2xl font-light text-slate-800">{copy.heading}</h1>
                        <p className="text-sm text-slate-400 font-light">{copy.subheading}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowInfo(previous => !previous)}
                        aria-expanded={showInfo}
                        aria-label={copy.infoLabel}
                        data-insights-info
                        className="p-2 rounded-lg text-slate-300 hover:text-slate-600 transition-colors flex-shrink-0"
                    >
                        <Info size={16} />
                    </button>
                </div>
                {showInfo && (
                    <div data-insights-info-body className="space-y-1 border-l-2 border-slate-100 pl-3 pt-2">
                        {insightsInfo().map(sentence => (
                            <p key={sentence} className="text-[11px] text-slate-400 font-light leading-relaxed">{sentence}</p>
                        ))}
                    </div>
                )}
            </header>

            {loadError && <LoadFailed message={loadError} onDismiss={dismissLoadError} />}

            {loading && empty && !loadError ? (
                <Loading />
            ) : empty ? (
                <Empty message={copy.empty} />
            ) : (
                <div data-journal-view="insights" className="space-y-4">
                    <section className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-3">
                        <Segmented
                            name="level"
                            label={copy.level.label}
                            value={level}
                            onChange={changeLevel}
                            options={LEVELS.map(value => ({ value, label: copy.level[value], hint: copy.level[`${value}Hint`] }))}
                        />
                        <div className="space-y-2">
                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                                {copy.series.label}
                                <span className="ml-2 normal-case font-light tracking-normal">{fillCopy(copy.series.hint, { max: MAX_SERIES })}</span>
                            </p>
                            <div className="flex flex-wrap gap-2" data-series-picker>
                                {series.map(entry => {
                                    const selected = chosen.includes(entry.key);
                                    const { text, className } = labelOf(entry);
                                    const color = seriesColor(chosen.indexOf(entry.key));
                                    return (
                                        <button
                                            key={entry.key}
                                            type="button"
                                            data-series-pick={entry.key}
                                            aria-pressed={selected}
                                            onClick={() => togglePick(entry.key)}
                                            title={countCopy(entry.count, copy.series.entries)}
                                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition-colors ${selected ? 'text-slate-800' : 'text-slate-500 border-slate-200 hover:border-slate-400'}`}
                                            style={selected ? { borderColor: color, backgroundColor: `${color}22` } : undefined}
                                        >
                                            {selected && <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
                                            <span className={className}>{text}</span>
                                            <span className="text-slate-400 font-normal">{entry.count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </section>

                    <Card data-insights-card="circumplex" heading={copy.circumplex.heading} hint={copy.circumplex.hint}>
                        <div className="flex justify-end">
                            <button
                                type="button"
                                data-smoothed={smoothed ? 'true' : 'false'}
                                onClick={() => setSmoothed(previous => !previous)}
                                className="px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                            >
                                {smoothed ? copy.circumplex.smoothed : copy.circumplex.raw}
                            </button>
                        </div>
                        <Circumplex layout={circumplex} labelOf={labelOf} />
                        <ul className="flex flex-wrap gap-x-3 gap-y-1">
                            {circumplex.series.map(entry => {
                                const { text, className } = labelOf(entry);
                                return (
                                    <li key={entry.key} data-legend={entry.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                                        <span className="h-0 w-4 border-t-2" style={{ borderColor: entry.color }} />
                                        <span className={className}>{text}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </Card>

                    <Card data-insights-card="drift" heading={copy.drift.heading} hint={copy.drift.hint}>
                        <Segmented
                            name="drift"
                            label={copy.drift.dimension}
                            value={driftAxis}
                            onChange={setDriftAxis}
                            options={AXES.map(axis => ({ value: axis, label: copy.drift.dimensions[axis] }))}
                        />
                        {drift.bars.length === 0 ? (
                            <p className="text-sm text-slate-500 font-light">{copy.drift.empty}</p>
                        ) : (
                            <DriftBars layout={drift} axis={driftAxis} labelOf={labelOf} />
                        )}
                        <p className="text-[11px] text-slate-400 font-light flex flex-wrap gap-x-3">
                            <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: POLARITY.toward }} />{copy.drift.axis[driftAxis]}</span>
                            <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded-sm" style={{ backgroundColor: POLARITY.away }} />{copy.drift.axisAway[driftAxis]}</span>
                        </p>
                    </Card>

                    {focusedSeries && (
                        <Card data-insights-card="series" heading={copy.series1.heading} hint={copy.series1.hint}>
                            <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <label htmlFor="insights-focus" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{copy.series1.pick}</label>
                                    <select
                                        id="insights-focus"
                                        data-focus-pick
                                        value={focused ?? ''}
                                        onChange={(event) => setFocus(event.target.value)}
                                        className="text-sm border-b-2 border-slate-200 py-1 focus:border-slate-800 focus:outline-none bg-transparent text-slate-700"
                                    >
                                        {series.map(entry => (
                                            <option key={entry.key} value={entry.key}>{labelOf(entry).text}</option>
                                        ))}
                                    </select>
                                </div>
                                <Segmented
                                    name="focus-dim"
                                    label={copy.series1.dimension}
                                    value={focusDim}
                                    onChange={setFocusDim}
                                    options={[
                                        ...AXES.map(axis => ({ value: axis, label: copy.drift.dimensions[axis] })),
                                        { value: 'intensity', label: copy.series1.intensity }
                                    ]}
                                />
                            </div>
                            <Timeseries layout={timeseries} color={focusColor} />
                            <div data-focus-figures className="space-y-1 text-[11px] text-slate-500 font-light">
                                <p>{countCopy(focusedRows.length, { one: copy.series1.count, many: copy.series1.count })}</p>
                                {focusedSummary && (
                                    <>
                                        <p>{fillCopy(copy.series1.now, { value: signed(focusedSummary.now[focusDim === 'intensity' ? 'valence' : focusDim]) })}</p>
                                        <p>{fillCopy(copy.series1.since, { value: signed(focusedSummary.drift[focusDim === 'intensity' ? 'valence' : focusDim]) })}</p>
                                        <p>{Number.isFinite(focusedSummary.slope30[focusDim === 'intensity' ? 'valence' : focusDim])
                                            ? fillCopy(copy.series1.slope, { value: signed(focusedSummary.slope30[focusDim === 'intensity' ? 'valence' : focusDim]) })
                                            : copy.series1.slopeNone}</p>
                                        <p>{fillCopy(copy.series1.distance, { value: focusedSummary.distance.toFixed(2) })}</p>
                                    </>
                                )}
                                {level !== 'pair' && companions.length > 0 && (
                                    <p data-companions className={labelOf(focusedSeries).className}>
                                        {fillCopy(level === 'person' || focusedRows.some(row => row.entity && `trigger:${row.entity.id}` === focused)
                                            ? copy.series1.interactions
                                            : copy.series1.entities, { list: companions.join(', ') })}
                                    </p>
                                )}
                            </div>
                        </Card>
                    )}

                    <Card data-insights-card="heatmap" heading={copy.heatmap.heading} hint={copy.heatmap.hint}>
                        {heatmap.rows.length === 0 ? (
                            <p className="text-sm text-slate-500 font-light">{copy.heatmap.empty}</p>
                        ) : (
                            <Heatmap layout={heatmap} labelOf={labelOf} />
                        )}
                    </Card>

                    {weeks.length > 0 && (
                        <Card data-insights-card="weekly" heading={copy.weekly.heading} hint={copy.weekly.hint}>
                            <Weekly layout={weekly} />
                        </Card>
                    )}

                    <Card data-insights-card="radar" heading={copy.radar.heading} hint={copy.radar.hint}>
                        <Radar layout={radar} />
                    </Card>
                </div>
            )}
        </Frame>
    );
}
