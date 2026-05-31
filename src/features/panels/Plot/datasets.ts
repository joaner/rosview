import type uPlot from 'uplot';
import {
  downsampleMinMaxLast,
  resolveEventTimestamp,
  timeToSec,
  type NumericPoint,
} from '@/core/analysis/timeSeries';
import type { MessageEvent } from '@/core/types/ros';
import { extractPlotPathValues, hasDerivativeModifier } from './messagePath';
import type { PlotConfig, PlotSeriesConfig } from './defaults';

export interface PlotRuntimeSeries {
  key: string;
  label: string;
  color: string;
  showLine: boolean;
  lineSize: number;
  enabled: boolean;
}

export interface PlotDataset {
  xLabel: string;
  series: PlotRuntimeSeries[];
  data: uPlot.AlignedData;
  pointCount: number;
  warnings: string[];
}

interface PointBucket {
  series: PlotRuntimeSeries;
  points: NumericPoint[];
  derivative: boolean;
}

function isEnabledSeries(series: PlotSeriesConfig): boolean {
  return series.enabled && series.topic.length > 0 && series.path.trim().length > 0;
}

function seriesBaseLabel(series: PlotSeriesConfig): string {
  return series.label.trim() || `${series.topic}.${series.path}`;
}

function pushPoint(
  buckets: Map<string, PointBucket>,
  series: PlotSeriesConfig,
  keySuffix: string,
  labelSuffix: string,
  x: number,
  y: number | null,
): void {
  const key = `${series.id}:${keySuffix}`;
  let bucket = buckets.get(key);
  if (!bucket) {
    const base = seriesBaseLabel(series);
    bucket = {
      series: {
        key,
        label: labelSuffix && labelSuffix !== series.path ? `${base} ${labelSuffix}` : base,
        color: series.color,
        showLine: series.showLine,
        lineSize: series.lineSize,
        enabled: series.enabled,
      },
      points: [],
      derivative: hasDerivativeModifier(series.path),
    };
    buckets.set(key, bucket);
  }
  bucket.points.push({ x, y });
}

function collectTimestampPoints(events: MessageEvent[], config: PlotConfig, warnings: string[]): Map<string, PointBucket> {
  const buckets = new Map<string, PointBucket>();
  const enabled = config.series.filter(isEnabledSeries);
  for (const series of enabled) {
    const topicEvents = events.filter((event) => event.topic === series.topic);
    for (const event of topicEvents) {
      const x = timeToSec(resolveEventTimestamp(event, series.timestampMode).time);
      const values = extractPlotPathValues(event.message, series.path);
      for (const item of values) {
        pushPoint(buckets, series, item.key, item.label, x, item.value);
      }
    }
    if (topicEvents.length > 0 && ![...buckets.values()].some((bucket) => bucket.series.key.startsWith(`${series.id}:`))) {
      warnings.push(`No numeric values found for ${series.topic}.${series.path}`);
    }
  }
  return buckets;
}

function collectIndexPoints(events: MessageEvent[], config: PlotConfig): Map<string, PointBucket> {
  const buckets = new Map<string, PointBucket>();
  for (const series of config.series.filter(isEnabledSeries)) {
    const latest = [...events].reverse().find((event) => event.topic === series.topic);
    if (!latest) continue;
    const values = extractPlotPathValues(latest.message, series.path);
    values.forEach((item, index) => {
      pushPoint(buckets, series, 'value', '', index, item.value);
    });
  }
  return buckets;
}

function collectCustomPoints(events: MessageEvent[], config: PlotConfig, latestOnly: boolean, warnings: string[]): Map<string, PointBucket> {
  const buckets = new Map<string, PointBucket>();
  for (const series of config.series.filter(isEnabledSeries)) {
    const xAxisPath = series.xAxisPath?.trim();
    if (!xAxisPath) {
      warnings.push(`Missing X path for ${series.topic}.${series.path}`);
      continue;
    }
    const topicEvents = events.filter((event) => event.topic === series.topic);
    const sourceEvents = latestOnly ? topicEvents.slice(-1) : topicEvents;
    for (const event of sourceEvents) {
      const xs = extractPlotPathValues(event.message, xAxisPath);
      const ys = extractPlotPathValues(event.message, series.path);
      const count = Math.min(xs.length, ys.length);
      if (xs.length !== ys.length) {
        warnings.push(`Mismatched X/Y lengths for ${series.topic}: ${xAxisPath} vs ${series.path}`);
      }
      const singleCurve = xs.length > 1 && ys.length > 1;
      for (let i = 0; i < count; i++) {
        const x = xs[i]?.value;
        const y = ys[i]?.value;
        if (x == null || y == null) continue;
        pushPoint(
          buckets,
          series,
          singleCurve ? 'value' : (ys[i]?.key ?? `${i}`),
          singleCurve ? '' : (ys[i]?.label ?? `${i}`),
          x,
          y,
        );
      }
    }
  }
  return buckets;
}

function uniqueSortedPoints(points: NumericPoint[]): NumericPoint[] {
  const map = new Map<number, number | null>();
  for (const point of points) {
    map.set(point.x, point.y);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([x, y]) => ({ x, y }));
}

function derivative(points: NumericPoint[]): NumericPoint[] {
  const sorted = uniqueSortedPoints(points).filter((point): point is { x: number; y: number } => point.y != null);
  const out: NumericPoint[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    const dx = current.x - previous.x;
    out.push({ x: current.x, y: dx === 0 ? null : (current.y - previous.y) / dx });
  }
  return out;
}

function alignBuckets(buckets: PointBucket[], maxPoints: number, downsample: boolean): uPlot.AlignedData {
  const normalized = buckets.map((bucket) => {
    let points = bucket.derivative ? derivative(bucket.points) : uniqueSortedPoints(bucket.points);
    if (downsample && points.length > maxPoints) {
      points = downsampleMinMaxLast(points, maxPoints);
    }
    return { bucket, points };
  });

  const xValues = Array.from(
    new Set(normalized.flatMap((entry) => entry.points.map((point) => point.x))),
  ).sort((a, b) => a - b);
  const xIndex = new Map(xValues.map((x, index) => [x, index]));
  const ySeries = normalized.map((entry) => {
    const values = Array.from({ length: xValues.length }, () => null as number | null);
    for (const point of entry.points) {
      const index = xIndex.get(point.x);
      if (index != null) values[index] = point.y;
    }
    return values;
  });
  return [xValues, ...ySeries] as uPlot.AlignedData;
}

export function buildPlotDataset(events: MessageEvent[], config: PlotConfig): PlotDataset {
  const warnings: string[] = [];
  const buckets =
    config.xAxisMode === 'timestamp'
      ? collectTimestampPoints(events, config, warnings)
      : config.xAxisMode === 'index'
        ? collectIndexPoints(events, config)
        : collectCustomPoints(events, config, config.xAxisMode === 'currentCustom', warnings);

  const seriesBuckets = [...buckets.values()];
  const perSeriesMax = Math.max(50, Math.floor(config.maxPoints / Math.max(1, seriesBuckets.length)));
  const data = alignBuckets(seriesBuckets, perSeriesMax, config.downsampleMode === 'minMaxLast');
  const pointCount = data.slice(1).reduce((sum, values) => {
    const arr = values as Array<number | null>;
    return sum + arr.filter((value) => value != null).length;
  }, 0);

  return {
    xLabel: config.xAxisMode === 'timestamp' ? 'time' : config.xAxisMode === 'index' ? 'index' : 'x',
    series: seriesBuckets.map((bucket) => bucket.series),
    data,
    pointCount,
    warnings: Array.from(new Set(warnings)),
  };
}
