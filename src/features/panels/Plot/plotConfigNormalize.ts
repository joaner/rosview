import {
  defaultPlotConfig,
  JOINT_STATE_FIELDS,
  type JointStateField,
  type PlotConfig,
  type PlotSeriesConfig,
} from './defaults';
import {
  buildJointStateCombinedPath,
  combinePlotPaths,
  stripAutoJointStateSeriesSlots,
} from './jointStatePaths';
import { splitPlotPathList } from './messagePath';

const JOINT_STATE_SLICE_PATHS = new Set(['position[:]', 'velocity[:]', 'effort[:]']);

function fieldFromSlicePath(path: string): JointStateField | undefined {
  if (!JOINT_STATE_SLICE_PATHS.has(path)) return undefined;
  const field = path.slice(0, path.indexOf('['));
  return JOINT_STATE_FIELDS.includes(field as JointStateField) ? (field as JointStateField) : undefined;
}

function inferJointStateFieldsFromPath(path: string): JointStateField[] {
  const fields: JointStateField[] = [];
  for (const subPath of splitPlotPathList(path)) {
    const field = fieldFromSlicePath(subPath);
    if (field && !fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

function collectAutoSplitFields(series: readonly PlotSeriesConfig[], topic: string): JointStateField[] {
  const fields: JointStateField[] = [];
  for (const entry of series) {
    if (entry.topic !== topic) continue;
    const field = fieldFromSlicePath(entry.path);
    if (field && !fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

function mergePrimaryJointStateSeries(config: PlotConfig): PlotConfig {
  const primary = config.series[0];
  if (!primary?.topic) return config;

  const autoSplitOnPrimaryTopic = config.series.filter(
    (entry) => entry.topic === primary.topic && JOINT_STATE_SLICE_PATHS.has(entry.path),
  );
  if (autoSplitOnPrimaryTopic.length <= 1) return config;

  const fields = collectAutoSplitFields(config.series, primary.topic);
  if (fields.length === 0) return config;

  const combinedPath = buildJointStateCombinedPath(fields);
  const userSeries = stripAutoJointStateSeriesSlots(config.series.slice(1), primary.topic);

  return {
    ...config,
    series: [{ ...primary, path: combinedPath }, ...userSeries],
    jointStateFields: fields,
  };
}

function syncJointStateFieldsFromPath(config: PlotConfig): PlotConfig {
  const primary = config.series[0];
  if (!primary?.path.trim()) return config;

  const inferred = inferJointStateFieldsFromPath(primary.path);
  if (inferred.length === 0) return config;

  const defaultFields = defaultPlotConfig().jointStateFields;
  const shouldReplace =
    config.jointStateFields.length === defaultFields.length
    && config.jointStateFields.every((field, index) => field === defaultFields[index]);

  if (!shouldReplace && inferred.every((field) => config.jointStateFields.includes(field))) {
    return config;
  }

  if (shouldReplace || inferred.some((field) => !config.jointStateFields.includes(field))) {
    return { ...config, jointStateFields: inferred };
  }

  return config;
}

/** Merge legacy per-field JointState series and align jointStateFields with combined paths. */
export function normalizePlotConfig(config: PlotConfig): PlotConfig {
  let next = mergePrimaryJointStateSeries(config);
  next = syncJointStateFieldsFromPath(next);

  const primary = next.series[0];
  if (primary?.path.includes(',')) {
    const normalizedPath = combinePlotPaths(splitPlotPathList(primary.path));
    if (normalizedPath !== primary.path) {
      next = {
        ...next,
        series: [{ ...primary, path: normalizedPath }, ...next.series.slice(1)],
      };
    }
  }

  return next;
}
