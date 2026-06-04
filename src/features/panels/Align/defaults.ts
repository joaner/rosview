import type { AlignPlotTimeMode } from './core/alignTimeUtils';

export interface AlignConfig {
  /** Empty ⇒ all image topics from the dataset. */
  topics: string[];
  timeMode: AlignPlotTimeMode;
  /** Half-span in milliseconds (±window around current playback time). */
  windowHalfMs: number;
  dotRadius: number;
  dotOpacity: number;
}

export const defaultAlignConfig = (): AlignConfig => ({
  topics: [],
  timeMode: 'receiveTime',
  windowHalfMs: 1000,
  dotRadius: 2,
  dotOpacity: 0.55,
});
