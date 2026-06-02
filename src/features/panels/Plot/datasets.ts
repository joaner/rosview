import type uPlot from 'uplot';
import {
  downsampleMinMaxLast,
  resolvePlotEventTimestamp,
  timeToSec,
  type NumericPoint,
} from '@/core/analysis/timeSeries';
import type { MessageEvent, Time } from '@/core/types/ros';
import { extractPlotPathValues, hasDerivativeModifier } from './messagePath';
import { LASER_SCAN_ANGLE_X_PATH } from './adapters';
import { paletteColor, type PlotConfig, type PlotLineStyle, type PlotSeriesConfig } from './defaults';
import { plotWarningKey, type PlotDatasetWarning } from './plotWarnings';

export interface PlotRuntimeSeries {
  key: string;
  label: string;
  color: string;
  lineStyle: PlotLineStyle;
  lineSize: number;
  enabled: boolean;
}

export interface PlotDataset {
  xLabel: string;
  series: PlotRuntimeSeries[];
  data: uPlot.AlignedData;
  pointCount: number;
  /** Share of raw X-axis samples kept after downsampling; 1 when nothing was dropped. */
  sampleRatio: number;
  warnings: PlotDatasetWarning[];
}

export interface BuildPlotDatasetOptions {
  /** When true, force downsampling regardless of config.downsampleMode. */
  forceDownsample?: boolean;
  /** Prepended warnings (e.g. non-indexed source notice). */
  extraWarnings?: PlotDatasetWarning[];
  /** Log bounds used to reject invalid header stamps for timestamp mode. */
  logStart?: Time;
  logEnd?: Time;
}

interface PointBucket {
  series: PlotRuntimeSeries;
  points: NumericPoint[];
  derivative: boolean;
  seriesConfigId: string;
}

function isEnabledSeries(series: PlotSeriesConfig): boolean {
  return series.enabled && series.topic.length > 0 && series.path.trim().length > 0;
}

/** Millisecond grid avoids float-key mismatches when merging multi-series timelines. */
export function quantizePlotX(sec: number): number {
  return Math.round(sec * 1000) / 1000;
}

function legendLabel(series: PlotSeriesConfig, labelSuffix: string): string {
  if (labelSuffix && labelSuffix !== series.path) return labelSuffix;
  if (series.label.trim()) return series.label.trim();
  const pathLabel = labelSuffix || series.path || 'value';
  return series.topic ? `${series.topic} · ${pathLabel}` : pathLabel;
}

function extractXValues(message: unknown, xAxisPath: string) {
  if (xAxisPath === LASER_SCAN_ANGLE_X_PATH) {
    if (!message || typeof message !== 'object') return [];
    const record = message as Record<string, unknown>;
    const ranges = record.ranges;
    const angleMin = typeof record.angle_min === 'number' ? record.angle_min : 0;
    const angleIncrement = typeof record.angle_increment === 'number' ? record.angle_increment : 0;
    if (!Array.isArray(ranges)) return [];
    return ranges.map((_, index) => ({
      key: `angle[${index}]`,
      label: `angle[${index}]`,
      value: angleMin + index * angleIncrement,
    }));
  }
  return extractPlotPathValues(message, xAxisPath);
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
    bucket = {
      series: {
        key,
        label: legendLabel(series, labelSuffix),
        color: series.color,
        lineStyle: series.lineStyle,
        lineSize: series.lineSize,
        enabled: series.enabled,
      },
      points: [],
      derivative: hasDerivativeModifier(series.path),
      seriesConfigId: series.id,
    };
    buckets.set(key, bucket);
  }
  bucket.points.push({ x, y });
}

function assignBucketColors(buckets: Map<string, PointBucket>): void {
  const bucketsBySeries = new Map<string, PointBucket[]>();
  for (const bucket of buckets.values()) {
    const list = bucketsBySeries.get(bucket.seriesConfigId) ?? [];
    list.push(bucket);
    bucketsBySeries.set(bucket.seriesConfigId, list);
  }

  let paletteIndex = 0;
  for (const seriesBuckets of bucketsBySeries.values()) {
    if (seriesBuckets.length === 1) {
      const bucket = seriesBuckets[0];
      if (!bucket.series.color) {
        bucket.series.color = paletteColor(paletteIndex++);
      }
      continue;
    }
    for (const bucket of seriesBuckets) {
      bucket.series.color = paletteColor(paletteIndex++);
    }
  }
}

function collectTimestampPoints(
  events: MessageEvent[],
  config: PlotConfig,
  warnings: PlotDatasetWarning[],
  logStart?: Time,
  logEnd?: Time,
): Map<string, PointBucket> {
  const buckets = new Map<string, PointBucket>();
  const enabled = config.series.filter(isEnabledSeries);
  for (const series of enabled) {
    const topicEvents = events.filter((event) => event.topic === series.topic);
    for (const event of topicEvents) {
      const x = quantizePlotX(
        timeToSec(resolvePlotEventTimestamp(event, series.timestampMode, logStart, logEnd).time),
      );
      const values = extractPlotPathValues(event.message, series.path);
      for (const item of values) {
        pushPoint(buckets, series, item.key, item.label, x, item.value);
      }
    }
    if (topicEvents.length > 0 && ![...buckets.values()].some((bucket) => bucket.series.key.startsWith(`${series.id}:`))) {
      warnings.push({ kind: 'noNumericValues', topic: series.topic, path: series.path });
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
      pushPoint(buckets, series, item.key || `${index}`, item.label, index, item.value);
    });
  }
  return buckets;
}

function collectCustomPoints(events: MessageEvent[], config: PlotConfig, latestOnly: boolean, warnings: PlotDatasetWarning[]): Map<string, PointBucket> {
  const buckets = new Map<string, PointBucket>();
  for (const series of config.series.filter(isEnabledSeries)) {
    const xAxisPath = series.xAxisPath?.trim();
    if (!xAxisPath) {
      warnings.push({ kind: 'missingXPath', topic: series.topic, path: series.path });
      continue;
    }
    const topicEvents = events.filter((event) => event.topic === series.topic);
    const sourceEvents = latestOnly ? topicEvents.slice(-1) : topicEvents;
    for (const event of sourceEvents) {
      const xs = extractXValues(event.message, xAxisPath);
      const ys = extractPlotPathValues(event.message, series.path);
      const count = Math.min(xs.length, ys.length);
      if (xs.length !== ys.length) {
        warnings.push({
          kind: 'mismatchedXY',
          topic: series.topic,
          xPath: xAxisPath,
          yPath: series.path,
        });
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
    const x = quantizePlotX(point.x);
    map.set(x, point.y);
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

function downsampleSharedXAxis(
  xValues: number[],
  ySeries: (number | null)[][],
  maxPoints: number,
): [number[], (number | null)[][]] {
  if (xValues.length <= maxPoints) return [xValues, ySeries];

  const coveragePoints: NumericPoint[] = xValues.map((x, index) => ({
    x,
    y: ySeries.reduce((count, values) => count + (values[index] != null ? 1 : 0), 0),
  }));
  const sampled = downsampleMinMaxLast(coveragePoints, maxPoints);
  const newX = [...new Set(sampled.map((point) => point.x))].sort((a, b) => a - b);
  const xToIdx = new Map(xValues.map((x, index) => [x, index]));
  const newY = ySeries.map((values) =>
    newX.map((x) => {
      const index = xToIdx.get(x);
      return index != null ? (values[index] ?? null) : null;
    }),
  );
  return [newX, newY];
}

function alignBuckets(
  buckets: PointBucket[],
  maxPoints: number,
  downsample: boolean,
): { data: uPlot.AlignedData; sampleRatio: number } {
  const normalized = buckets.map((bucket) => {
    const rawPoints = bucket.derivative ? derivative(bucket.points) : uniqueSortedPoints(bucket.points);
    let points = rawPoints;
    if (downsample && points.length > maxPoints) {
      points = downsampleMinMaxLast(points, maxPoints);
    }
    return { bucket, rawPoints, points };
  });

  const rawXCount = new Set(
    normalized.flatMap((entry) => entry.rawPoints.map((point) => point.x)),
  ).size;

  let xValues = Array.from(
    new Set(normalized.flatMap((entry) => entry.points.map((point) => point.x))),
  ).sort((a, b) => a - b);

  const pointMaps = normalized.map((entry) => new Map(entry.points.map((point) => [point.x, point.y])));
  let ySeries = pointMaps.map((map) => xValues.map((x) => map.get(x) ?? null));

  if (downsample && xValues.length > maxPoints) {
    [xValues, ySeries] = downsampleSharedXAxis(xValues, ySeries, maxPoints);
  }

  const sampleRatio = rawXCount > 0 ? Math.min(1, xValues.length / rawXCount) : 1;
  return { data: [xValues, ...ySeries] as uPlot.AlignedData, sampleRatio };
}

export function buildPlotDataset(
  events: MessageEvent[],
  config: PlotConfig,
  options: BuildPlotDatasetOptions = {},
): PlotDataset {
  const warnings: PlotDatasetWarning[] = [...(options.extraWarnings ?? [])];
  const buckets =
    config.xAxisMode === 'timestamp'
      ? collectTimestampPoints(events, config, warnings, options.logStart, options.logEnd)
      : config.xAxisMode === 'index'
        ? collectIndexPoints(events, config)
        : collectCustomPoints(events, config, config.xAxisMode === 'currentCustom', warnings);

  assignBucketColors(buckets);

  const seriesBuckets = [...buckets.values()];
  const shouldDownsample = options.forceDownsample === true || config.downsampleMode === 'minMaxLast';
  const { data, sampleRatio } = alignBuckets(seriesBuckets, config.maxPoints, shouldDownsample);
  const pointCount = data.slice(1).reduce((sum, values) => {
    const arr = values as Array<number | null>;
    return sum + arr.filter((value) => value != null).length;
  }, 0);

  return {
    xLabel: config.xAxisMode === 'timestamp' ? 'time' : config.xAxisMode === 'index' ? 'index' : 'x',
    series: seriesBuckets.map((bucket) => bucket.series),
    data,
    pointCount,
    sampleRatio,
    warnings: Array.from(new Map(warnings.map((w) => [plotWarningKey(w), w])).values()),
  };
}
