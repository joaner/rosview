import type { JointStateField } from '../defaults';
import type { AdapterContext, DetectedPlotPath, PlotTypeAdapter } from '../schemaRegistry/types';
import { extractPlotPathValues } from '../messagePath';

const DEFAULT_JOINT_FIELDS: JointStateField[] = ['position'];

export const jointStateAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const fields = ctx.jointStateFields?.length ? ctx.jointStateFields : DEFAULT_JOINT_FIELDS;
    return fields.map((field) => ({ path: `${field}[:]`, label: field }));
  },
  validate(sample: unknown): boolean {
    if (!sample || typeof sample !== 'object') return false;
    const record = sample as Record<string, unknown>;
    return ['position', 'velocity', 'effort'].some((field) => {
      const arr = record[field];
      return Array.isArray(arr) && arr.length > 0;
    });
  },
};

export const LASER_SCAN_ANGLE_X_PATH = '__laser_scan_angle__';

export const laserScanAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase() ?? '';
    if (suffix.includes('multiecho')) {
      return [{ path: 'ranges[0][:]', label: 'ranges[0]', xAxisPath: LASER_SCAN_ANGLE_X_PATH }];
    }
    return [{ path: 'ranges[:]', label: 'ranges', xAxisPath: LASER_SCAN_ANGLE_X_PATH }];
  },
  validate(sample: unknown): boolean {
    if (!sample || typeof sample !== 'object') return false;
    const ranges = (sample as Record<string, unknown>).ranges;
    return Array.isArray(ranges) && ranges.length > 0;
  },
};

export function imuPaths(): DetectedPlotPath[] {
  return [
    { path: 'linear_acceleration.x', label: 'linear_acceleration.x' },
    { path: 'linear_acceleration.y', label: 'linear_acceleration.y' },
    { path: 'linear_acceleration.z', label: 'linear_acceleration.z' },
    { path: 'angular_velocity.x', label: 'angular_velocity.x' },
    { path: 'angular_velocity.y', label: 'angular_velocity.y' },
    { path: 'angular_velocity.z', label: 'angular_velocity.z' },
  ];
}

export function magneticFieldPaths(): DetectedPlotPath[] {
  return [
    { path: 'magnetic_field.x', label: 'magnetic_field.x' },
    { path: 'magnetic_field.y', label: 'magnetic_field.y' },
    { path: 'magnetic_field.z', label: 'magnetic_field.z' },
  ];
}

export const vector3GroupAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    if (suffix.endsWith('/imu')) return imuPaths();
    if (suffix.endsWith('/magneticfield')) return magneticFieldPaths();
    return [
      { path: 'x', label: 'x' },
      { path: 'y', label: 'y' },
      { path: 'z', label: 'z' },
    ];
  },
};

export const scalarAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    if (suffix.endsWith('/temperature')) return [{ path: 'temperature', label: 'temperature' }];
    if (suffix.endsWith('/fluidpressure')) return [{ path: 'fluid_pressure', label: 'fluid_pressure' }];
    if (suffix.endsWith('/illuminance')) return [{ path: 'illuminance', label: 'illuminance' }];
    if (suffix.endsWith('/relativehumidity')) return [{ path: 'relative_humidity', label: 'relative_humidity' }];
    if (suffix.endsWith('/range')) return [{ path: 'range', label: 'range' }];
    return [{ path: 'data', label: 'data' }];
  },
};

export const scalarGroupAdapter: PlotTypeAdapter = {
  detect(): DetectedPlotPath[] {
    return [
      { path: 'latitude', label: 'latitude' },
      { path: 'longitude', label: 'longitude' },
      { path: 'altitude', label: 'altitude' },
    ];
  },
};

export const multiArrayAdapter: PlotTypeAdapter = {
  detect(): DetectedPlotPath[] {
    return [{ path: 'data[:]', label: 'data' }];
  },
};

export const numericArrayAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    if (suffix.endsWith('/joy')) {
      return [{ path: 'axes[:]', label: 'axes' }];
    }
    if (suffix.endsWith('/channelfloat32')) {
      return [{ path: 'values[:]', label: 'values' }];
    }
    return [{ path: 'data[:]', label: 'data' }];
  },
};

export const batteryStateAdapter: PlotTypeAdapter = {
  detect(): DetectedPlotPath[] {
    return [
      { path: 'percentage', label: 'percentage' },
      { path: 'voltage', label: 'voltage' },
    ];
  },
};

export const twistAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    const prefix = suffix.endsWith('/twiststamped') ? 'twist.' : '';
    return [
      { path: `${prefix}linear.x`, label: 'linear.x' },
      { path: `${prefix}linear.y`, label: 'linear.y' },
      { path: `${prefix}angular.z`, label: 'angular.z' },
    ];
  },
};

export const poseAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    if (suffix.endsWith('/pointstamped')) {
      return [
        { path: 'point.x', label: 'point.x' },
        { path: 'point.y', label: 'point.y' },
        { path: 'point.z', label: 'point.z' },
      ];
    }
    const prefix = suffix.endsWith('/posestamped') ? 'pose.' : '';
    return [
      { path: `${prefix}position.x`, label: 'position.x' },
      { path: `${prefix}position.y`, label: 'position.y' },
      { path: `${prefix}position.z`, label: 'position.z' },
    ];
  },
};

export const wrenchAdapter: PlotTypeAdapter = {
  detect(ctx: AdapterContext): DetectedPlotPath[] {
    const suffix = ctx.schemaName?.toLowerCase().replace(/\/msg\//, '/') ?? '';
    const prefix = suffix.endsWith('/wrenchstamped') ? 'wrench.' : '';
    return [
      { path: `${prefix}force.x`, label: 'force.x' },
      { path: `${prefix}force.y`, label: 'force.y' },
      { path: `${prefix}force.z`, label: 'force.z' },
    ];
  },
};

export const odometryAdapter: PlotTypeAdapter = {
  detect(): DetectedPlotPath[] {
    return [
      { path: 'pose.pose.position.x', label: 'position.x' },
      { path: 'pose.pose.position.y', label: 'position.y' },
      { path: 'twist.twist.linear.x', label: 'linear.x' },
    ];
  },
};

export function validateDetectedPaths(sample: unknown, paths: DetectedPlotPath[]): DetectedPlotPath[] {
  if (!sample) return paths;
  return paths.filter((entry) => {
    if (entry.xAxisPath === LASER_SCAN_ANGLE_X_PATH) {
      return laserScanAdapter.validate?.(sample) ?? false;
    }
    return extractPlotPathValues(sample, entry.path).length > 0;
  });
}
