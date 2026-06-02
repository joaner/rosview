import type uPlot from 'uplot';
import type { Time } from '@/core/types/ros';
import type { PlotLineStyle } from './defaults';
import type { PlotDatasetWarning } from './plotWarnings';

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

export interface PointBucket {
  series: PlotRuntimeSeries;
  points: import('@/core/analysis/timeSeries').NumericPoint[];
  derivative: boolean;
  seriesConfigId: string;
}

export type PlotStatusKind =
  | { kind: 'detecting' }
  | { kind: 'loading'; messages?: number }
  | { kind: 'error'; message: string }
  | { kind: 'sampling'; percent: number }
  | { kind: 'idle' };
