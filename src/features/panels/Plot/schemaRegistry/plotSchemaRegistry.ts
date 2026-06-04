import { normalizeRosSchemaName } from '@/shared/ros/rosMessageTypes';
import type { PlotSchemaEntry } from './types';

const ENTRIES: PlotSchemaEntry[] = [
  // sensor_msgs
  { schemaSuffix: 'sensor_msgs/jointstate', adapterId: 'jointState', defaultPriority: 100 },
  { schemaSuffix: 'sensor_msgs/imu', adapterId: 'vector3Group', defaultPriority: 80 },
  { schemaSuffix: 'sensor_msgs/magneticfield', adapterId: 'vector3Group', defaultPriority: 70 },
  { schemaSuffix: 'sensor_msgs/laserscan', adapterId: 'laserScan', defaultPriority: 40, preferredXAxisMode: 'custom' },
  { schemaSuffix: 'sensor_msgs/multiecholaserscan', adapterId: 'laserScan', defaultPriority: 40, preferredXAxisMode: 'custom' },
  { schemaSuffix: 'sensor_msgs/joy', adapterId: 'numericArray', defaultPriority: 50 },
  { schemaSuffix: 'sensor_msgs/channelfloat32', adapterId: 'numericArray', defaultPriority: 50 },
  { schemaSuffix: 'sensor_msgs/batterystate', adapterId: 'batteryState', defaultPriority: 55 },
  { schemaSuffix: 'sensor_msgs/temperature', adapterId: 'scalar', defaultPriority: 45 },
  { schemaSuffix: 'sensor_msgs/fluidpressure', adapterId: 'scalar', defaultPriority: 45 },
  { schemaSuffix: 'sensor_msgs/illuminance', adapterId: 'scalar', defaultPriority: 45 },
  { schemaSuffix: 'sensor_msgs/relativehumidity', adapterId: 'scalar', defaultPriority: 45 },
  { schemaSuffix: 'sensor_msgs/range', adapterId: 'scalar', defaultPriority: 45 },
  { schemaSuffix: 'sensor_msgs/navsatfix', adapterId: 'scalarGroup', defaultPriority: 50 },
  // std_msgs scalars
  { schemaSuffix: 'std_msgs/float32', adapterId: 'scalar', defaultPriority: 60 },
  { schemaSuffix: 'std_msgs/float64', adapterId: 'scalar', defaultPriority: 60 },
  { schemaSuffix: 'std_msgs/int8', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int16', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int32', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int64', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint8', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint16', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint32', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint64', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/bool', adapterId: 'scalar', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/byte', adapterId: 'scalar', defaultPriority: 50 },
  { schemaSuffix: 'std_msgs/char', adapterId: 'scalar', defaultPriority: 50 },
  // std_msgs multi arrays
  { schemaSuffix: 'std_msgs/float32multiarray', adapterId: 'multiArray', defaultPriority: 60 },
  { schemaSuffix: 'std_msgs/float64multiarray', adapterId: 'multiArray', defaultPriority: 60 },
  { schemaSuffix: 'std_msgs/int8multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int16multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int32multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/int64multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint8multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint16multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint32multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/uint64multiarray', adapterId: 'multiArray', defaultPriority: 55 },
  { schemaSuffix: 'std_msgs/bytemultiarray', adapterId: 'multiArray', defaultPriority: 50 },
  // geometry_msgs
  { schemaSuffix: 'geometry_msgs/vector3', adapterId: 'vector3Group', defaultPriority: 65 },
  { schemaSuffix: 'geometry_msgs/point', adapterId: 'vector3Group', defaultPriority: 65 },
  { schemaSuffix: 'geometry_msgs/twist', adapterId: 'twist', defaultPriority: 75 },
  { schemaSuffix: 'geometry_msgs/twiststamped', adapterId: 'twist', defaultPriority: 75 },
  { schemaSuffix: 'geometry_msgs/pose', adapterId: 'pose', defaultPriority: 70 },
  { schemaSuffix: 'geometry_msgs/posestamped', adapterId: 'pose', defaultPriority: 70 },
  { schemaSuffix: 'geometry_msgs/pointstamped', adapterId: 'pose', defaultPriority: 70 },
  { schemaSuffix: 'geometry_msgs/wrench', adapterId: 'wrench', defaultPriority: 65 },
  { schemaSuffix: 'geometry_msgs/wrenchstamped', adapterId: 'wrench', defaultPriority: 65 },
  // nav_msgs
  { schemaSuffix: 'nav_msgs/odometry', adapterId: 'odometry', defaultPriority: 80 },
];

const REGISTRY = new Map<string, PlotSchemaEntry>(
  ENTRIES.map((entry) => [entry.schemaSuffix, entry]),
);

export function schemaSuffixFromType(type: string): string {
  return normalizeRosSchemaName(type).toLowerCase();
}

export function lookupPlotSchema(type: string): PlotSchemaEntry | undefined {
  const suffix = schemaSuffixFromType(type);
  return REGISTRY.get(suffix);
}

export function isPlottableSchema(type: string): boolean {
  return lookupPlotSchema(type) != null;
}

export function getSchemaDefaultPriority(type: string): number {
  return lookupPlotSchema(type)?.defaultPriority ?? 0;
}

export function listPlotSchemaEntries(): readonly PlotSchemaEntry[] {
  return ENTRIES;
}
