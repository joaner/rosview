import { describe, expect, it } from 'vitest';
import { detectPlotPaths, normalizeSchemaName } from './autoDetect';

describe('normalizeSchemaName', () => {
  it('normalizes ROS2 schema names', () => {
    expect(normalizeSchemaName('sensor_msgs/msg/JointState')).toBe('sensor_msgs/jointstate');
  });
});

describe('detectPlotPaths', () => {
  it('detects JointState paths from ROS2 schema', () => {
    expect(detectPlotPaths({ schemaName: 'sensor_msgs/msg/JointState' })).toEqual([
      { path: 'position[:]', label: 'position' },
    ]);
  });

  it('detects JointState paths from ROS1 schema', () => {
    expect(detectPlotPaths({ schemaName: 'sensor_msgs/JointState' })).toEqual([
      { path: 'position[:]', label: 'position' },
    ]);
  });

  it('detects Imu component paths', () => {
    const paths = detectPlotPaths({ schemaName: 'sensor_msgs/msg/Imu' });
    expect(paths.map((entry) => entry.path)).toEqual([
      'linear_acceleration.x',
      'linear_acceleration.y',
      'linear_acceleration.z',
      'angular_velocity.x',
      'angular_velocity.y',
      'angular_velocity.z',
    ]);
  });

  it('detects TwistStamped before generic Twist', () => {
    const paths = detectPlotPaths({ schemaName: 'geometry_msgs/msg/TwistStamped' });
    expect(paths[0]?.path).toBe('twist.linear.x');
  });

  it('detects Float64MultiArray', () => {
    expect(detectPlotPaths({ schemaName: 'std_msgs/msg/Float64MultiArray' })).toEqual([
      { path: 'data[:]', label: 'data' },
    ]);
  });

  it('returns empty for unknown schemas', () => {
    expect(detectPlotPaths({ schemaName: 'custom/Unknown' })).toEqual([]);
  });

  it('returns empty for Image schemas', () => {
    expect(detectPlotPaths({ schemaName: 'sensor_msgs/msg/Image' })).toEqual([]);
  });
});
