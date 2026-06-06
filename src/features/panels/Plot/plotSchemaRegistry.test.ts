import { describe, expect, it } from 'vitest';
import { isPlottableSchema, lookupPlotSchema } from './schemaRegistry/plotSchemaRegistry';
import { detectPlotPaths, normalizeSchemaName } from './autoDetect';
import { buildPlotDataset } from './datasets';
import { defaultPlotConfig } from './defaults';
import type { MessageEvent } from '@/core/types/ros';
import {
  GRIPPER_JOINT_STATE_SAMPLE,
  GRIPPER_JOINT_STATE_SCHEMA,
  GRIPPER_JOINT_STATE_TOPIC,
} from './fixtures/gripperPickAndPlace.fixture';
import { pickDefaultPlotTopic } from './pickDefaultPlotTopic';
import { filterPlottableTopics } from './plottableSchemas';

describe('plotSchemaRegistry', () => {
  it('includes JointState and excludes Image', () => {
    expect(isPlottableSchema('sensor_msgs/msg/JointState')).toBe(true);
    expect(isPlottableSchema('tf2_msgs/msg/TFMessage')).toBe(true);
    expect(isPlottableSchema('sensor_msgs/msg/Image')).toBe(false);
    expect(isPlottableSchema('sensor_msgs/msg/CompressedImage')).toBe(false);
    expect(isPlottableSchema('sensor_msgs/msg/PointCloud2')).toBe(false);
  });

  it('assigns highest priority to JointState', () => {
    const joint = lookupPlotSchema('sensor_msgs/JointState');
    const imu = lookupPlotSchema('sensor_msgs/Imu');
    const tf = lookupPlotSchema('tf2_msgs/msg/TFMessage');
    expect(joint?.defaultPriority).toBeGreaterThan(imu?.defaultPriority ?? 0);
    expect(imu?.defaultPriority).toBeGreaterThan(tf?.defaultPriority ?? 0);
  });
});

describe('detectPlotPaths adapters', () => {
  it('detects JointState position with jointStateFields', () => {
    expect(
      detectPlotPaths({
        schemaName: GRIPPER_JOINT_STATE_SCHEMA,
        sample: GRIPPER_JOINT_STATE_SAMPLE,
        jointStateFields: ['position', 'effort'],
      }),
    ).toEqual([
      { path: 'position[:]', label: 'position' },
      { path: 'effort[:]', label: 'effort' },
    ]);
  });

  it('detects Imu paths', () => {
    const paths = detectPlotPaths({ schemaName: 'sensor_msgs/msg/Imu' });
    expect(paths.length).toBe(6);
  });

  it('detects LaserScan with custom x axis path', () => {
    const paths = detectPlotPaths({ schemaName: 'sensor_msgs/msg/LaserScan' });
    expect(paths[0]).toMatchObject({ path: 'ranges[:]', xAxisPath: '__laser_scan_angle__' });
  });

  it('normalizes ROS2 schema names', () => {
    expect(normalizeSchemaName('sensor_msgs/msg/JointState')).toBe('sensor_msgs/jointstate');
  });
});

describe('gripperPickAndPlace fixture', () => {
  function event(sec: number, message: unknown): MessageEvent {
    return {
      topic: GRIPPER_JOINT_STATE_TOPIC,
      receiveTime: { sec, nsec: 0 },
      publishTime: { sec, nsec: 0 },
      message,
      schemaName: GRIPPER_JOINT_STATE_SCHEMA,
    };
  }

  it('builds joint labels with index and name', () => {
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 'joints',
        topic: GRIPPER_JOINT_STATE_TOPIC,
        path: 'position[:]',
      }],
    };
    const dataset = buildPlotDataset(
      [
        event(1, GRIPPER_JOINT_STATE_SAMPLE),
        event(2, { ...GRIPPER_JOINT_STATE_SAMPLE, position: [0.2, -0.1, 0.9] }),
      ],
      config,
    );
    expect(dataset.series.map((s) => s.label)).toEqual([
      'position[0] (head_joint1)',
      'position[1] (head_joint2)',
      'position[2] (drive_joint)',
    ]);
  });
});

describe('pickDefaultPlotTopic', () => {
  it('prefers JointState over other plottable topics', () => {
    const topic = pickDefaultPlotTopic([
      { name: '/imu', type: 'sensor_msgs/msg/Imu' },
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
      { name: '/joint_states', type: 'sensor_msgs/msg/JointState' },
      { name: '/camera/image', type: 'sensor_msgs/msg/Image' },
    ]);
    expect(topic).toBe('/joint_states');
  });

  it('can default to TFMessage when it is the only plottable topic', () => {
    const topic = pickDefaultPlotTopic([
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
      { name: '/camera/image', type: 'sensor_msgs/msg/Image' },
    ]);
    expect(topic).toBe('/tf');
  });

  it('filters to plottable topics only', () => {
    const filtered = filterPlottableTopics([
      { name: '/camera', type: 'sensor_msgs/msg/Image' },
      { name: '/scan', type: 'sensor_msgs/msg/LaserScan' },
    ]);
    expect(filtered.map((t) => t.name)).toEqual(['/scan']);
  });
});
