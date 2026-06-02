import type { DownsampleMode, TimestampMode } from '@/core/analysis/timeSeries';

export const PLOT_X_AXIS_MODES = ['timestamp', 'index', 'custom', 'currentCustom'] as const;
export type PlotXAxisMode = (typeof PLOT_X_AXIS_MODES)[number];

export const JOINT_STATE_FIELDS = ['position', 'velocity', 'effort'] as const;
export type JointStateField = (typeof JOINT_STATE_FIELDS)[number];

export const PLOT_LINE_STYLES = ['solid', 'dashed'] as const;
export type PlotLineStyle = (typeof PLOT_LINE_STYLES)[number];

export interface PlotSeriesConfig {
  id: string;
  topic: string;
  path: string;
  xAxisPath?: string;
  label: string;
  color: string;
  enabled: boolean;
  timestampMode: TimestampMode;
  lineStyle: PlotLineStyle;
  lineSize: number;
}

export interface PlotConfig {
  series: PlotSeriesConfig[];
  xAxisMode: PlotXAxisMode;
  maxPoints: number;
  followingViewWidthSec: number;
  syncX: boolean;
  downsampleMode: DownsampleMode;
  /** Max messages to read from non-indexed sources (e.g. streaming bag). */
  nonIndexedMaxMessages: number;
  /** Enabled JointState array fields when plotting JointState topics. */
  jointStateFields: JointStateField[];
  /** Runtime legend keys hidden on the chart (persisted per panel). */
  hiddenLegendKeys: string[];
}

export const MIN_PLOT_POINTS = 200;
export const MAX_PLOT_POINTS = 200_000;
export const DEFAULT_NON_INDEXED_MAX_MESSAGES = 20_000;

/** Tailwind 500/600 theme palette for multi-series plots. */
export const PLOT_PALETTE = [
  '#3b82f6', // blue-500
  '#ef4444', // red-500
  '#22c55e', // green-500
  '#f59e0b', // amber-500
  '#a855f7', // purple-500
  '#06b6d4', // cyan-500
  '#f97316', // orange-500
  '#84cc16', // lime-500
  '#ec4899', // pink-500
  '#14b8a6', // teal-500
  '#6366f1', // indigo-500
  '#eab308', // yellow-500
  '#0ea5e9', // sky-500
  '#d946ef', // fuchsia-500
  '#10b981', // emerald-500
  '#64748b', // slate-500
] as const;

/** @deprecated Use PLOT_PALETTE / paletteColor instead. */
export const DEFAULT_PLOT_COLORS = PLOT_PALETTE;

export function paletteColor(index: number): string {
  return PLOT_PALETTE[index % PLOT_PALETTE.length] ?? PLOT_PALETTE[0];
}

export function createPlotSeries(overrides: Partial<PlotSeriesConfig> = {}): PlotSeriesConfig {
  const id = overrides.id ?? `series-${Math.random().toString(36).slice(2, 10)}`;
  const colorIndex = overrides.color ? -1 : 0;
  return {
    id,
    topic: '',
    path: '',
    xAxisPath: '',
    label: '',
    color: overrides.color ?? paletteColor(colorIndex),
    enabled: true,
    timestampMode: 'headerStamp',
    lineStyle: 'solid',
    lineSize: 1.5,
    ...overrides,
  };
}

export const defaultPlotConfig = (): PlotConfig => ({
  series: [createPlotSeries()],
  xAxisMode: 'timestamp',
  maxPoints: 20_000,
  followingViewWidthSec: 0,
  syncX: false,
  downsampleMode: 'minMaxLast',
  nonIndexedMaxMessages: DEFAULT_NON_INDEXED_MAX_MESSAGES,
  jointStateFields: ['position'],
  hiddenLegendKeys: [],
});
