import type { PlotXAxisMode } from '../defaults';
import type { JointStateField } from '../defaults';

export type PlotAdapterId =
  | 'jointState'
  | 'vector3Group'
  | 'scalar'
  | 'scalarGroup'
  | 'multiArray'
  | 'numericArray'
  | 'laserScan'
  | 'batteryState'
  | 'twist'
  | 'pose'
  | 'wrench'
  | 'odometry';

export interface PlotSchemaEntry {
  /** Normalized suffix, e.g. sensor_msgs/jointstate */
  schemaSuffix: string;
  adapterId: PlotAdapterId;
  defaultPriority: number;
  preferredXAxisMode?: PlotXAxisMode;
}

export interface DetectedPlotPath {
  path: string;
  label?: string;
  xAxisPath?: string;
}

export interface AdapterContext {
  schemaName?: string;
  sample?: unknown;
  jointStateFields?: JointStateField[];
}

export interface PlotTypeAdapter {
  detect(ctx: AdapterContext): DetectedPlotPath[];
  validate?(sample: unknown): boolean;
}
