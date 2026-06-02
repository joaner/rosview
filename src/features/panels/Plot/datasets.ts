import type uPlot from 'uplot';
import type { MessageEvent } from '@/core/types/ros';
import { paletteColor, type PlotConfig } from './defaults';
import { plotWarningKey, type PlotDatasetWarning } from './plotWarnings';
import type { BuildPlotDatasetOptions, PlotDataset } from './types';
import { alignBuckets } from './plotAlign';
import {
  assignBucketColors,
  collectCustomPoints,
  collectIndexPoints,
  collectTimestampPoints,
} from './plotPointCollector';

export type { PlotRuntimeSeries, PlotDataset, BuildPlotDatasetOptions } from './types';
export { quantizePlotX } from './plotPointCollector';
export { indexEventsByTopic } from './plotEventIndex';

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

  let pointCount = 0;
  for (let i = 1; i < data.length; i++) {
    const arr = data[i] as Array<number | null>;
    for (let j = 0; j < arr.length; j++) {
      if (arr[j] != null) pointCount++;
    }
  }

  return {
    xLabel: config.xAxisMode === 'timestamp' ? 'time' : config.xAxisMode === 'index' ? 'index' : 'x',
    series: seriesBuckets.map((bucket) => bucket.series),
    data,
    pointCount,
    sampleRatio,
    warnings: Array.from(new Map(warnings.map((w) => [plotWarningKey(w), w])).values()),
  };
}

// Re-export palette for tests
export { paletteColor };
