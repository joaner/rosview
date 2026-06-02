import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { fromNano, toNano } from '@/shared/utils/time';
import { detectPlotPaths, getPreferredXAxisMode } from './autoDetect';
import { isPlottableSchema } from './plottableSchemas';
import type { JointStateField, PlotSeriesConfig, PlotXAxisMode } from './defaults';
import { createPlotSeries, paletteColor } from './defaults';
import { buildJointStateCombinedPath } from './jointStatePaths';
import { mergeDetectedSeries, rebuildJointStateSeries } from './topicPaths';

export { mergeDetectedSeries, rebuildJointStateSeries };

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

export async function sampleTopicMessage(args: {
  player: Player;
  topic: string;
  startTime?: Time;
  endTime?: Time;
}): Promise<unknown> {
  const { player, topic, startTime, endTime } = args;
  if (!player.getMessagesInTimeRange || !startTime || !endTime) return undefined;
  try {
    const messages = await player.getMessagesInTimeRange({
      start: startTime,
      end: sampleEndTime(startTime, endTime),
      topics: [topic],
    });
    return messages[0]?.message;
  } catch {
    return undefined;
  }
}

export function detectPlotSeriesForTopic(args: {
  topic: string;
  schemaName?: string;
  sample?: unknown;
  existingSeriesId?: string;
  jointStateFields?: JointStateField[];
}): BuildSeriesResult {
  const { topic, schemaName, sample, existingSeriesId, jointStateFields } = args;

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
  const path = jointStateFields?.length
    ? buildJointStateCombinedPath(jointStateFields)
    : entry.path;
  return {
    series: [
      createPlotSeries({
        id: existingSeriesId,
        topic,
        path,
        xAxisPath: entry.xAxisPath ?? '',
        label: entry.label ?? '',
        color: paletteColor(0),
      }),
    ],
    xAxisMode: preferredXAxis,
  };
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
  const { topic, schemaName, player, startTime, endTime, existingSeriesId, jointStateFields } =
    args;
  const sample = await sampleTopicMessage({ player, topic, startTime, endTime });
  return detectPlotSeriesForTopic({
    topic,
    schemaName,
    sample,
    existingSeriesId,
    jointStateFields,
  });
}
