import { downsampleMinMaxLast, type NumericPoint } from '@/core/analysis/timeSeries';
import type uPlot from 'uplot';
import type { PointBucket } from './types';
import { quantizePlotX } from './plotPointCollector';

export function uniqueSortedPoints(points: NumericPoint[]): NumericPoint[] {
  const map = new Map<number, number | null>();
  for (const point of points) {
    const x = quantizePlotX(point.x);
    map.set(x, point.y);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([x, y]) => ({ x, y }));
}

export function derivativePoints(points: NumericPoint[]): NumericPoint[] {
  const sorted = uniqueSortedPoints(points).filter(
    (point): point is { x: number; y: number } => point.y != null,
  );
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

export function alignBuckets(
  buckets: PointBucket[],
  maxPoints: number,
  downsample: boolean,
): { data: uPlot.AlignedData; sampleRatio: number } {
  if (buckets.length === 0) {
    return { data: [[]] as uPlot.AlignedData, sampleRatio: 1 };
  }

  const normalized = buckets.map((bucket) => {
    const rawPoints = bucket.derivative
      ? derivativePoints(bucket.points)
      : uniqueSortedPoints(bucket.points);
    let points = rawPoints;
    if (downsample && points.length > maxPoints) {
      points = downsampleMinMaxLast(points, maxPoints);
    }
    return { bucket, rawPoints, points };
  });

  const rawXSet = new Set<number>();
  for (const entry of normalized) {
    for (const point of entry.rawPoints) {
      rawXSet.add(point.x);
    }
  }
  const rawXCount = rawXSet.size;

  // Fast path: single runtime series needs no union alignment.
  if (normalized.length === 1) {
    const entry = normalized[0];
    if (!entry) {
      return { data: [[]] as uPlot.AlignedData, sampleRatio: 1 };
    }
    let xValues = entry.points.map((point) => point.x);
    let yValues = entry.points.map((point) => point.y ?? null);
    if (downsample && xValues.length > maxPoints) {
      const paired: NumericPoint[] = xValues.map((x, i) => ({ x, y: yValues[i] ?? null }));
      const sampled = downsampleMinMaxLast(paired, maxPoints);
      xValues = sampled.map((p) => p.x);
      yValues = sampled.map((p) => p.y ?? null);
    }
    const sampleRatio = rawXCount > 0 ? Math.min(1, xValues.length / rawXCount) : 1;
    return { data: [xValues, yValues] as uPlot.AlignedData, sampleRatio };
  }

  const xSet = new Set<number>();
  for (const entry of normalized) {
    for (const point of entry.points) {
      xSet.add(point.x);
    }
  }
  let xValues = Array.from(xSet).sort((a, b) => a - b);

  const pointMaps = normalized.map(
    (entry) => new Map(entry.points.map((point) => [point.x, point.y])),
  );
  let ySeries = pointMaps.map((map) => xValues.map((x) => map.get(x) ?? null));

  if (downsample && xValues.length > maxPoints) {
    [xValues, ySeries] = downsampleSharedXAxis(xValues, ySeries, maxPoints);
  }

  const sampleRatio = rawXCount > 0 ? Math.min(1, xValues.length / rawXCount) : 1;
  return { data: [xValues, ...ySeries] as uPlot.AlignedData, sampleRatio };
}
