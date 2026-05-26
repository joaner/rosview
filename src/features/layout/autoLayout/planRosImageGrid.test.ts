import { describe, expect, it } from 'vitest';
import type { TopicInfo } from '@/core/types/ros';
import {
  classifyCameraSide,
  isDepthImageTopicName,
  planColorDepthCameraRows,
  planTwoByThreeImageRows,
} from '@/features/layout/autoLayout/planRosImageGrid';

describe('classifyCameraSide', () => {
  it('detects /camera/left|right|top/', () => {
    expect(classifyCameraSide('/camera/left/color/x')).toBe('left');
    expect(classifyCameraSide('/camera/right/color/x')).toBe('right');
    expect(classifyCameraSide('/camera/top/color/x')).toBe('top');
  });

  it('detects left/right tokens in underscore camera names', () => {
    expect(classifyCameraSide('/sensor/Left_Gripper_Camera_0/image/compressed')).toBe('left');
    expect(classifyCameraSide('/sensor/Right_Gripper_Camera_0/image/compressed')).toBe('right');
    expect(classifyCameraSide('/sensor/EgoCentric_Camera_0/image/compressed')).toBe('other');
  });

  it('maps /head/ streams to the top column', () => {
    expect(classifyCameraSide('/head/color/image')).toBe('top');
    expect(classifyCameraSide('/head/depth/image')).toBe('top');
  });
});

describe('isDepthImageTopicName', () => {
  it('matches /depth/ segments', () => {
    expect(isDepthImageTopicName('/camera/left/depth/image_raw')).toBe(true);
    expect(isDepthImageTopicName('/camera/left/color/image_raw')).toBe(false);
  });
});

describe('planColorDepthCameraRows', () => {
  it('fills two rows from one unified candidate pool', () => {
    const topics: TopicInfo[] = [
      { name: '/camera/left/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/left/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/right/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/right/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/top/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/top/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ];
    const { colorRow, depthRow } = planColorDepthCameraRows(topics);
    expect(colorRow.every((c) => c !== null)).toBe(true);
    expect(depthRow.every((c) => c !== null)).toBe(true);
    for (const row of [colorRow, depthRow]) {
      expect(classifyCameraSide(row[0]!)).toBe('left');
      expect(classifyCameraSide(row[1]!)).toBe('top');
      expect(classifyCameraSide(row[2]!)).toBe('right');
    }
    expect(colorRow.every((topic) => topic == null || !isDepthImageTopicName(topic))).toBe(true);
    expect(depthRow.every((topic) => topic == null || isDepthImageTopicName(topic))).toBe(true);
  });

  it('lays out six head/left/right CompressedVideo streams as color row + depth row', () => {
    const topics: TopicInfo[] = [
      { name: '/head/color/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
      { name: '/head/depth/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
      { name: '/left/color/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
      { name: '/left/depth/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
      { name: '/right/color/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
      { name: '/right/depth/image', type: 'foxglove_msgs/msg/CompressedVideo [ros2msg]' },
    ];
    const { colorRow, depthRow } = planColorDepthCameraRows(topics);
    expect(colorRow).toEqual([
      '/left/color/image',
      '/head/color/image',
      '/right/color/image',
    ]);
    expect(depthRow).toEqual([
      '/left/depth/image',
      '/head/depth/image',
      '/right/depth/image',
    ]);
  });

  it('shows up to six streams even when side tokens are missing', () => {
    const topics: TopicInfo[] = [
      { name: '/sensor/Left_Gripper_Camera_0/image/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/Right_Gripper_Camera_0/image/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/EgoCentric_Camera_0/image/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/Left_Gripper_Camera_0/depth/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/Right_Gripper_Camera_0/depth/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/EgoCentric_Camera_0/depth/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ];
    const { colorRow, depthRow } = planColorDepthCameraRows(topics);
    const picked = [...colorRow, ...depthRow].filter((name): name is string => name != null);
    expect(new Set(picked).size).toBe(6);
    expect(picked).toContain('/sensor/Left_Gripper_Camera_0/image/compressed');
    expect(picked).toContain('/sensor/Right_Gripper_Camera_0/image/compressed');
    expect(picked).toContain('/sensor/EgoCentric_Camera_0/image/compressed');
    expect(picked).toContain('/sensor/Left_Gripper_Camera_0/depth/compressed');
    expect(picked).toContain('/sensor/Right_Gripper_Camera_0/depth/compressed');
    expect(picked).toContain('/sensor/EgoCentric_Camera_0/depth/compressed');
  });
});

describe('planTwoByThreeImageRows', () => {
  it('places left and right in column slots for each row when streams exist', () => {
    const topics: TopicInfo[] = [
      { name: '/camera/left/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/left/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/right/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/right/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/top/color/a/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/top/depth/z/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ];
    const rows = planTwoByThreeImageRows(topics);
    expect(rows).toHaveLength(2);
    expect(rows[0].every((c) => c !== null)).toBe(true);
    expect(rows[1].every((c) => c !== null)).toBe(true);
    for (const row of rows) {
      expect(classifyCameraSide(row[0]!)).toBe('left');
      expect(classifyCameraSide(row[1]!)).toBe('top');
      expect(classifyCameraSide(row[2]!)).toBe('right');
    }
  });
});
