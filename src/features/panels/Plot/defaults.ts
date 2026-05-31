import type { DownsampleMode, TimestampMode } from '@/core/analysis/timeSeries';

export const PLOT_X_AXIS_MODES = ['timestamp', 'index', 'custom', 'currentCustom'] as const;
export type PlotXAxisMode = (typeof PLOT_X_AXIS_MODES)[number];

export interface PlotSeriesConfig {
  id: string;
  topic: string;
  path: string;
  xAxisPath?: string;
  label: string;
  color: string;
  enabled: boolean;
  timestampMode: TimestampMode;
  showLine: boolean;
  lineSize: number;
}

export interface PlotConfig {
  series: PlotSeriesConfig[];
  xAxisMode: PlotXAxisMode;
  maxPoints: number;
  followingViewWidthSec: number;
  syncX: boolean;
  downsampleMode: DownsampleMode;
}

export const MIN_PLOT_POINTS = 200;
export const MAX_PLOT_POINTS = 200_000;

export const DEFAULT_PLOT_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#a855f7',
  '#06b6d4',
  '#f97316',
  '#84cc16',
] as const;

export function createPlotSeries(overrides: Partial<PlotSeriesConfig> = {}): PlotSeriesConfig {
  const id = overrides.id ?? `series-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    topic: '',
    path: 'data',
    xAxisPath: '',
    label: '',
    color: DEFAULT_PLOT_COLORS[0],
    enabled: true,
    timestampMode: 'headerStamp',
    showLine: true,
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
});
