import { detectPlotPaths } from './autoDetect';
import type { JointStateField, PlotSeriesConfig } from './defaults';
import { createPlotSeries, paletteColor } from './defaults';
import {
  buildJointStateCombinedPath,
  stripAutoJointStateSeriesSlots,
} from './jointStatePaths';

export { buildSeriesForTopic, type BuildSeriesResult } from './plotTopicService';

export function mergeDetectedSeries(
  current: PlotSeriesConfig[],
  seriesId: string,
  detected: PlotSeriesConfig[],
): PlotSeriesConfig[] {
  const index = current.findIndex((series) => series.id === seriesId);
  if (index < 0) return current;

  const preserved = current[index];
  const next = detected[0];

  if (!next?.path) {
    return current.map((series) =>
      series.id === seriesId
        ? { ...series, topic: next?.topic ?? series.topic, path: '' }
        : series,
    );
  }

  const updated: PlotSeriesConfig = {
    ...next,
    id: preserved.id,
    enabled: preserved.enabled,
    timestampMode: preserved.timestampMode,
    lineStyle: preserved.lineStyle,
    lineSize: preserved.lineSize,
    color: preserved.color || next.color,
  };

  return current.map((series, i) => (i === index ? updated : series));
}

export function rebuildJointStateSeries(
  current: PlotSeriesConfig[],
  topic: string,
  schemaName: string,
  jointStateFields: JointStateField[],
): PlotSeriesConfig[] {
  const detected = detectPlotPaths({ schemaName, jointStateFields });
  if (detected.length === 0) return current;

  const combinedPath = buildJointStateCombinedPath(jointStateFields);
  const primary = current[0];
  const userSeries = stripAutoJointStateSeriesSlots(current.slice(1), topic);

  const updated = createPlotSeries({
    id: primary?.id ?? `series-${Date.now().toString(36)}-0`,
    topic,
    path: combinedPath,
    label: primary?.label ?? detected.map((entry) => entry.label).filter(Boolean).join(', '),
    color: primary?.color ?? paletteColor(0),
    enabled: primary?.enabled ?? true,
    timestampMode: primary?.timestampMode ?? 'headerStamp',
    lineStyle: primary?.lineStyle ?? 'solid',
    lineSize: primary?.lineSize ?? 1.5,
  });

  return [updated, ...userSeries];
}
