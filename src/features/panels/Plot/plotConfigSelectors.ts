import type { TopicInfo } from '@/core/types/ros';
import { isJointStateSchema } from '@/shared/ros/rosMessageTypes';
import type { PlotConfig, PlotSeriesConfig } from './defaults';
import { isPlottableTopic } from './plottableSchemas';

export function buildTopicByName(topics: ReadonlyArray<TopicInfo>): Map<string, TopicInfo> {
  const map = new Map<string, TopicInfo>();
  for (const topic of topics) map.set(topic.name, topic);
  return map;
}

export function hasEnabledPlotPaths(config: PlotConfig): boolean {
  return config.series.some(
    (series) => series.enabled && series.topic && series.path.trim().length > 0,
  );
}

export function selectPrimarySeries(config: PlotConfig): PlotSeriesConfig | undefined {
  return config.series[0];
}

export function selectActivePlotTopics(
  config: PlotConfig,
  topicByName: ReadonlyMap<string, TopicInfo>,
): string[] {
  return Array.from(
    new Set(
      config.series
        .filter((series) => series.enabled && series.topic)
        .map((series) => series.topic)
        .filter((topic) => {
          const info = topicByName.get(topic);
          return info ? isPlottableTopic(info) : false;
        }),
    ),
  ).sort();
}

export function isPrimaryJointState(
  config: PlotConfig,
  topicByName: ReadonlyMap<string, TopicInfo>,
): boolean {
  const primary = selectPrimarySeries(config);
  const schema = primary?.topic ? topicByName.get(primary.topic)?.type : undefined;
  return schema ? isJointStateSchema(schema) : false;
}

/** Stable key for config fields that affect range read + dataset build. */
export function plotDataConfigKey(config: PlotConfig): string {
  const seriesKey = config.series
    .map(
      (s) =>
        `${s.id}|${s.enabled ? 1 : 0}|${s.topic}|${s.path}|${s.xAxisPath ?? ''}|${s.timestampMode}`,
    )
    .join(';');
  return JSON.stringify({
    xAxisMode: config.xAxisMode,
    maxPoints: config.maxPoints,
    downsampleMode: config.downsampleMode,
    nonIndexedMaxMessages: config.nonIndexedMaxMessages,
    jointStateFields: config.jointStateFields,
    series: seriesKey,
  });
}

/** Stable key for uPlot series topology (rebuild when this changes). */
export function plotChartTopologyKey(dataset: {
  series: ReadonlyArray<{
    key: string;
    label: string;
    color: string;
    lineStyle: string;
    lineSize: number;
  }>;
}): string {
  return dataset.series
    .map((s) => `${s.key}|${s.label}|${s.color}|${s.lineStyle}|${s.lineSize}`)
    .join(';');
}
