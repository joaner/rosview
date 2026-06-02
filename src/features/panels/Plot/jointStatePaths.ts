import type { DetectedPlotPath } from './schemaRegistry/types';
import type { JointStateField } from './defaults';

const JOINT_STATE_SLICE_PATHS = new Set(['position[:]', 'velocity[:]', 'effort[:]']);

/** Comma-separated Y paths for one config series (e.g. `position[:],velocity[:]`). */
export function combinePlotPaths(paths: readonly string[]): string {
  return paths.filter(Boolean).join(',');
}

export function buildJointStateCombinedPath(fields: readonly JointStateField[]): string {
  return combinePlotPaths(fields.map((field) => `${field}[:]`));
}

export function combinedPathFromDetected(detected: readonly DetectedPlotPath[]): string {
  return combinePlotPaths(detected.map((entry) => entry.path));
}

/** Remove legacy auto-split JointState slots (one field path per extra series). */
export function stripAutoJointStateSeriesSlots<T extends { topic: string; path: string }>(
  series: readonly T[],
  topic: string,
): T[] {
  return series.filter(
    (entry) => entry.topic !== topic || !JOINT_STATE_SLICE_PATHS.has(entry.path),
  );
}
