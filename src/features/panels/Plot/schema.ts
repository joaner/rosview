import type { DownsampleMode, TimestampMode } from '@/core/analysis/timeSeries';
import { isRecord } from '@/shared/utils/guards';
import {
  createPlotSeries,
  defaultPlotConfig,
  DEFAULT_PLOT_COLORS,
  JOINT_STATE_FIELDS,
  MAX_PLOT_POINTS,
  MIN_PLOT_POINTS,
  PLOT_LINE_STYLES,
  PLOT_X_AXIS_MODES,
  type JointStateField,
  type PlotConfig,
  type PlotLineStyle,
  type PlotSeriesConfig,
  type PlotXAxisMode,
} from './defaults';
import { normalizePlotConfig } from './plotConfigNormalize';

function parseLineStyle(input: Record<string, unknown>, fallback: PlotLineStyle): PlotLineStyle {
  if (PLOT_LINE_STYLES.includes(input.lineStyle as PlotLineStyle)) {
    return input.lineStyle as PlotLineStyle;
  }
  if (input.showLine === false) return 'dashed';
  return fallback;
}

function parseTimestampMode(value: unknown, fallback: TimestampMode): TimestampMode {
  return value === 'receiveTime' || value === 'publishTime' || value === 'headerStamp'
    ? value
    : fallback;
}

function parseXAxisMode(value: unknown, fallback: PlotXAxisMode): PlotXAxisMode {
  return PLOT_X_AXIS_MODES.includes(value as PlotXAxisMode) ? (value as PlotXAxisMode) : fallback;
}

function parseDownsampleMode(value: unknown, fallback: DownsampleMode): DownsampleMode {
  return value === 'none' || value === 'minMaxLast' ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function parseSeries(input: unknown, index: number): PlotSeriesConfig {
  const color = DEFAULT_PLOT_COLORS[index % DEFAULT_PLOT_COLORS.length] ?? DEFAULT_PLOT_COLORS[0];
  const base = createPlotSeries({ id: `series-${index + 1}`, color });
  if (!isRecord(input)) return base;
  return createPlotSeries({
    id: typeof input.id === 'string' && input.id.length > 0 ? input.id : base.id,
    topic: typeof input.topic === 'string' ? input.topic : base.topic,
    path: typeof input.path === 'string' && input.path.length > 0 ? input.path : base.path,
    xAxisPath: typeof input.xAxisPath === 'string' ? input.xAxisPath : base.xAxisPath,
    label: typeof input.label === 'string' ? input.label : base.label,
    color: typeof input.color === 'string' && input.color.length > 0 ? input.color : base.color,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : base.enabled,
    timestampMode: parseTimestampMode(input.timestampMode, base.timestampMode),
    lineStyle: parseLineStyle(input, base.lineStyle),
    lineSize: clampNumber(input.lineSize, base.lineSize, 0.5, 8),
  });
}

function parseJointStateFields(value: unknown, fallback: JointStateField[]): JointStateField[] {
  if (!Array.isArray(value)) return fallback;
  const fields = value.filter((item): item is JointStateField =>
    typeof item === 'string' && JOINT_STATE_FIELDS.includes(item as JointStateField),
  );
  return fields.length > 0 ? fields : fallback;
}

function parseHiddenLegendKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function parsePlotConfig(input: unknown): PlotConfig {
  const base = defaultPlotConfig();
  if (!isRecord(input)) return base;

  const series = Array.isArray(input.series)
    ? input.series.map(parseSeries).filter((item) => item.id.length > 0)
    : base.series;

  return normalizePlotConfig({
    series: series.length > 0 ? series : base.series,
    xAxisMode: parseXAxisMode(input.xAxisMode, base.xAxisMode),
    maxPoints: clampNumber(input.maxPoints, base.maxPoints, MIN_PLOT_POINTS, MAX_PLOT_POINTS),
    followingViewWidthSec: clampNumber(input.followingViewWidthSec, base.followingViewWidthSec, 0, 86_400),
    syncX: typeof input.syncX === 'boolean' ? input.syncX : base.syncX,
    downsampleMode: parseDownsampleMode(input.downsampleMode, base.downsampleMode),
    nonIndexedMaxMessages: clampNumber(
      input.nonIndexedMaxMessages,
      base.nonIndexedMaxMessages,
      1000,
      MAX_PLOT_POINTS,
    ),
    jointStateFields: parseJointStateFields(input.jointStateFields, base.jointStateFields),
    hiddenLegendKeys: parseHiddenLegendKeys(input.hiddenLegendKeys),
  });
}
