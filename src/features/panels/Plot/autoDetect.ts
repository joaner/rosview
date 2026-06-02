import type { JointStateField } from './defaults';
import {
  batteryStateAdapter,
  jointStateAdapter,
  laserScanAdapter,
  multiArrayAdapter,
  numericArrayAdapter,
  odometryAdapter,
  poseAdapter,
  scalarAdapter,
  scalarGroupAdapter,
  twistAdapter,
  validateDetectedPaths,
  vector3GroupAdapter,
  wrenchAdapter,
} from './adapters';
import { lookupPlotSchema } from './schemaRegistry/plotSchemaRegistry';
import type { AdapterContext, DetectedPlotPath, PlotAdapterId, PlotTypeAdapter } from './schemaRegistry/types';

export type { DetectedPlotPath } from './schemaRegistry/types';

const ADAPTERS: Record<PlotAdapterId, PlotTypeAdapter> = {
  jointState: jointStateAdapter,
  vector3Group: vector3GroupAdapter,
  scalar: scalarAdapter,
  scalarGroup: scalarGroupAdapter,
  multiArray: multiArrayAdapter,
  numericArray: numericArrayAdapter,
  laserScan: laserScanAdapter,
  batteryState: batteryStateAdapter,
  twist: twistAdapter,
  pose: poseAdapter,
  wrench: wrenchAdapter,
  odometry: odometryAdapter,
};

export function detectPlotPaths(args: {
  schemaName?: string;
  sample?: unknown;
  jointStateFields?: JointStateField[];
}): DetectedPlotPath[] {
  const { schemaName, sample, jointStateFields } = args;
  if (!schemaName) return [];

  const entry = lookupPlotSchema(schemaName);
  if (!entry) return [];

  const adapter = ADAPTERS[entry.adapterId];
  const ctx: AdapterContext = { schemaName, sample, jointStateFields };
  const paths = adapter.detect(ctx);

  const validated = validateDetectedPaths(sample, paths);
  return validated.length > 0 ? validated : paths;
}

export function getPreferredXAxisMode(schemaName?: string) {
  if (!schemaName) return undefined;
  return lookupPlotSchema(schemaName)?.preferredXAxisMode;
}

export { schemaSuffixFromType as normalizeSchemaName } from './schemaRegistry/plotSchemaRegistry';
