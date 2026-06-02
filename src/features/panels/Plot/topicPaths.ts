import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { fromNano, toNano } from '@/shared/utils/time';
import { detectPlotPaths, getPreferredXAxisMode } from './autoDetect';
import { isPlottableSchema } from './plottableSchemas';
import type { JointStateField, PlotSeriesConfig, PlotXAxisMode } from './defaults';
import { createPlotSeries, paletteColor } from './defaults';

function sampleEndTime(start: Time, end: Time): Time {
  const startNs = toNano(start);
  const endNs = toNano(end);
  const oneSec = 1_000_000_000n;
  const sampleEnd = startNs + oneSec < endNs ? startNs + oneSec : endNs;
  return fromNano(sampleEnd);
}

export interface BuildSeriesResult {
  series: PlotSeriesConfig[];
  xAxisMode?: PlotXAxisMode;
}

export async function buildSeriesForTopic(args: {
  topic: string;
  schemaName?: string;
  player: Player;
  startTime?: Time;
  endTime?: Time;
  existingSeriesId?: string;
  jointStateFields?: JointStateField[];
}): Promise<BuildSeriesResult> {
  const { topic, schemaName, player, startTime, endTime, existingSeriesId, jointStateFields } = args;

  if (!topic || !schemaName || !isPlottableSchema(schemaName)) {
    return {
      series: [
        createPlotSeries({
          id: existingSeriesId,
          topic: topic || '',
          path: '',
        }),
      ],
    };
  }

  let sample: unknown;
  if (player.getMessagesInTimeRange && startTime && endTime) {
    try {
      const messages = await player.getMessagesInTimeRange({
        start: startTime,
        end: sampleEndTime(startTime, endTime),
        topics: [topic],
      });
      sample = messages[0]?.message;
    } catch {
      sample = undefined;
    }
  }

  const detected = detectPlotPaths({ schemaName, sample, jointStateFields });
  const entry = detected[0];
  if (!entry) {
    return {
      series: [
        createPlotSeries({
          id: existingSeriesId,
          topic,
          path: '',
        }),
      ],
    };
  }

  const preferredXAxis = getPreferredXAxisMode(schemaName);
  return {
    series: [
      createPlotSeries({
        id: existingSeriesId,
        topic,
        path: entry.path,
        xAxisPath: entry.xAxisPath ?? '',
        label: entry.label ?? '',
        color: paletteColor(0),
      }),
    ],
    xAxisMode: preferredXAxis,
  };
}

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

  const primary = current[0];
  const userSeries = current.slice(1);

  const rebuilt = detected.map((entry, index) => {
    const existing = index === 0 ? primary : undefined;
    return createPlotSeries({
      id: existing?.id ?? `series-${Date.now().toString(36)}-${index}`,
      topic,
      path: entry.path,
      label: entry.label ?? '',
      color: existing?.color ?? paletteColor(index),
      enabled: existing?.enabled ?? true,
      timestampMode: existing?.timestampMode ?? 'headerStamp',
      lineStyle: existing?.lineStyle ?? 'solid',
      lineSize: existing?.lineSize ?? 1.5,
    });
  });

  return [...rebuilt, ...userSeries];
}
