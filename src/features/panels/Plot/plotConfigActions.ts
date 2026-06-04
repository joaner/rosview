import type { TopicInfo } from '@/core/types/ros';
import { isJointStateSchema } from '@/shared/ros/rosMessageTypes';
import {
  createPlotSeries,
  type JointStateField,
  type PlotConfig,
  type PlotSeriesConfig,
} from './defaults';
import { pruneHiddenLegendKeys } from './plotLegendVisibility';
import type { BuildSeriesResult } from './plotTopicService';
import { mergeDetectedSeries, rebuildJointStateSeries } from './plotTopicService';

export function updateSeriesInConfig(
  config: PlotConfig,
  id: string,
  patch: Partial<PlotSeriesConfig>,
): PlotConfig {
  return {
    ...config,
    series: config.series.map((series) => (series.id === id ? { ...series, ...patch } : series)),
  };
}

export function clearSeriesTopic(config: PlotConfig, seriesId: string): PlotConfig {
  return {
    ...config,
    series: config.series.map((series) =>
      series.id === seriesId ? { ...series, topic: '', path: '' } : series,
    ),
  };
}

export function applyDetectedTopicToConfig(
  config: PlotConfig,
  seriesId: string,
  result: BuildSeriesResult,
  isPrimary: boolean,
): PlotConfig {
  return {
    ...config,
    ...(isPrimary && result.xAxisMode ? { xAxisMode: result.xAxisMode } : {}),
    series: mergeDetectedSeries(config.series, seriesId, result.series),
  };
}

export function applyJointStateFieldsToConfig(
  config: PlotConfig,
  topicByName: ReadonlyMap<string, TopicInfo>,
  fields: JointStateField[],
): PlotConfig {
  const topic = config.series[0]?.topic ?? '';
  const schema = topic ? topicByName.get(topic)?.type : undefined;
  const next: PlotConfig = { ...config, jointStateFields: fields };
  if (topic && schema && isJointStateSchema(schema)) {
    next.series = rebuildJointStateSeries(config.series, topic, schema, fields);
  }
  return next;
}

export function addPlotSeriesToConfig(config: PlotConfig): PlotConfig {
  return {
    ...config,
    series: [
      ...config.series,
      createPlotSeries({
        id: `series-${Date.now().toString(36)}`,
      }),
    ],
  };
}

export function toggleSeriesEnabled(config: PlotConfig, seriesId: string): PlotConfig {
  return {
    ...config,
    series: config.series.map((series) =>
      series.id === seriesId ? { ...series, enabled: !series.enabled } : series,
    ),
  };
}

export function pruneHiddenLegendKeysForDataset(
  config: PlotConfig,
  legendKeys: readonly string[],
): PlotConfig {
  const hiddenLegendKeys = pruneHiddenLegendKeys(config.hiddenLegendKeys, legendKeys);
  if (hiddenLegendKeys.length === config.hiddenLegendKeys.length) return config;
  return { ...config, hiddenLegendKeys };
}
