import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { isJointStateSchema } from '@/shared/ros/rosMessageTypes';
import { fromNano, toNano } from '@/shared/utils/time';
import { detectPlotPaths, getPreferredXAxisMode } from './autoDetect';
import { isPlottableSchema } from './plottableSchemas';
import type { JointStateField, PlotSeriesConfig, PlotXAxisMode } from './defaults';
import { createPlotSeries, paletteColor } from './defaults';
import { buildJointStateCombinedPath } from './jointStatePaths';
import { isArrayLikePlotPath } from './messagePath';
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

function commonXAxisPath(paths: ReturnType<typeof detectPlotPaths>): string {
  const xAxisPaths = paths
    .map((entry) => entry.xAxisPath ?? '')
    .filter((path) => path.trim().length > 0);
  if (xAxisPaths.length === 0) return '';
  const [first] = xAxisPaths;
  return xAxisPaths.every((path) => path === first) ? first : '';
}

function defaultPathCandidates(paths: ReturnType<typeof detectPlotPaths>) {
  const defaults = paths.filter((entry) => entry.default !== false);
  return defaults.length > 0 ? defaults : paths;
}

function firstSlicePrefix(path: string): string {
  const match = /(^|\.)([A-Za-z_$][\w$]*\[[^\]]*(?::|-)[^\]]*\])/.exec(path);
  return match?.[2] ?? '';
}

function defaultDetectedPath(paths: ReturnType<typeof detectPlotPaths>): string {
  const candidates = defaultPathCandidates(paths);
  if (candidates.length === 0) return '';
  const arrayEntries = candidates.filter((entry) => isArrayLikePlotPath(entry.path));
  if (arrayEntries.length > 1) {
    const prefixes = new Set(arrayEntries.map((entry) => firstSlicePrefix(entry.path)).filter(Boolean));
    if (prefixes.size === 1 && arrayEntries.length === candidates.length) {
      return candidates.map((entry) => entry.path).filter(Boolean).join(',');
    }
  }
  const arrayEntry = arrayEntries[0];
  if (arrayEntry) return arrayEntry.path;
  return candidates.map((entry) => entry.path).filter(Boolean).join(',');
}

function defaultDetectedLabel(paths: ReturnType<typeof detectPlotPaths>): string {
  return defaultPathCandidates(paths)
    .map((entry) => entry.label ?? entry.path)
    .filter(Boolean)
    .join(', ');
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

  const selectedJointStateFields = isJointStateSchema(schemaName) && (jointStateFields?.length ?? 0) > 0
    ? jointStateFields
    : undefined;
  const detected = detectPlotPaths({
    schemaName,
    sample,
    jointStateFields: selectedJointStateFields,
  });
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
  const path = selectedJointStateFields
    ? buildJointStateCombinedPath(selectedJointStateFields)
    : defaultDetectedPath(detected);
  return {
    series: [
      createPlotSeries({
        id: existingSeriesId,
        topic,
        path,
        xAxisPath: commonXAxisPath(detected),
        label: defaultDetectedLabel(detected),
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
