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

  it('detects PoseStamped position paths', () => {
    const paths = detectPlotPaths({ schemaName: 'geometry_msgs/msg/PoseStamped' });
    expect(paths.map((entry) => entry.path)).toEqual([
      'pose.position.x',
      'pose.position.y',
      'pose.position.z',
    ]);
  });

  it('falls back to sample discovery for unknown schemas', () => {
    const paths = detectPlotPaths({
      schemaName: 'custom_msgs/msg/Foo',
      sample: { foo: { bar: { x: 1, y: 2 } } },
    });
    expect(paths.map((entry) => entry.path)).toEqual(['foo.bar.x', 'foo.bar.y']);
  });

  it('detects TFMessage translation paths and exposes rotation for manual selection', () => {
    const paths = detectPlotPaths({
      schemaName: 'tf2_msgs/msg/TFMessage',
      sample: {
        transforms: [{
          child_frame_id: 'link_Hips_R',
          transform: {
            translation: { x: 0, y: 0, z: 0.9712 },
            rotation: { x: 0.03, y: 0, z: 0, w: 0.99 },
          },
        }],
      },
    });
    expect(paths.map((entry) => entry.path)).toEqual([
      'transforms[:].transform.translation.x',
      'transforms[:].transform.translation.y',
      'transforms[:].transform.translation.z',
      'transforms[:].transform.rotation.x',
      'transforms[:].transform.rotation.y',
      'transforms[:].transform.rotation.z',
      'transforms[:].transform.rotation.w',
    ]);
    expect(paths.filter((entry) => entry.default === false).map((entry) => entry.path)).toEqual([
      'transforms[:].transform.rotation.x',
      'transforms[:].transform.rotation.y',
      'transforms[:].transform.rotation.z',
      'transforms[:].transform.rotation.w',
    ]);
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
