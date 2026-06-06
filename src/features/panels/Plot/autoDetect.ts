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
  tfMessageAdapter,
  twistAdapter,
  validateDetectedPaths,
  vector3GroupAdapter,
  wrenchAdapter,
} from './adapters';
import { discoverNumericPlotFields } from './fieldDiscovery';
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
  tfMessage: tfMessageAdapter,
};

export function detectPlotPaths(args: {
  schemaName?: string;
  sample?: unknown;
  jointStateFields?: JointStateField[];
}): DetectedPlotPath[] {
  const { schemaName, sample, jointStateFields } = args;
  if (!schemaName) return [];

  const entry = lookupPlotSchema(schemaName);
  if (!entry) {
    return discoverNumericPlotFields(sample).map((field) => ({
      path: field.path,
      label: field.label,
    }));
  }

  const adapter = ADAPTERS[entry.adapterId];
  const ctx: AdapterContext = { schemaName, sample, jointStateFields };
  const paths = adapter.detect(ctx);

  const validated = validateDetectedPaths(sample, paths);
  if (validated.length > 0) return validated;
  if (!sample) return paths;

  const discovered = discoverNumericPlotFields(sample).map((field) => ({
    path: field.path,
    label: field.label,
  }));
  return discovered.length > 0 ? discovered : paths;
}

export function getPreferredXAxisMode(schemaName?: string) {
  if (!schemaName) return undefined;
  return lookupPlotSchema(schemaName)?.preferredXAxisMode;
}

export { schemaSuffixFromType as normalizeSchemaName } from './schemaRegistry/plotSchemaRegistry';
