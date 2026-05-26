import { describe, expect, it } from 'vitest';
import {
  isAudioPanelMainTopicSchema,
  isJointStateSchema,
  isPoseStampedSchema,
  isRawAudioSchema,
  isRosImageSchema,
  matchesRosSchema,
  normalizeRosSchemaName,
  ROS_MSG_FOXGLOVE_COMPRESSED_VIDEO,
  ROS_MSG_FOXGLOVE_RAW_AUDIO,
  ROS_MSG_POSE_STAMPED,
  ROS_MSG_SENSOR_COMPRESSED_IMAGE,
} from './rosMessageTypes';

describe('normalizeRosSchemaName', () => {
  it('removes schema source suffixes and normalizes case', () => {
    expect(normalizeRosSchemaName('sensor_msgs/msg/CompressedImage [ros2msg]')).toBe(
      'sensor_msgs/compressedimage',
    );
    expect(normalizeRosSchemaName('SENSOR_MSGS/MSG/COMPRESSEDIMAGE [jsonschema]')).toBe(
      'sensor_msgs/compressedimage',
    );
  });

  it('treats with/without /msg/ as equivalent', () => {
    expect(normalizeRosSchemaName('sensor_msgs/CompressedImage [ros2msg]')).toBe(
      normalizeRosSchemaName('sensor_msgs/msg/CompressedImage'),
    );
  });
});

describe('matchesRosSchema', () => {
  it('matches canonical and source-annotated schema names', () => {
    expect(matchesRosSchema('sensor_msgs/msg/CompressedImage [jsonschema]', ROS_MSG_SENSOR_COMPRESSED_IMAGE)).toBe(
      true,
    );
  });
});

describe('isRosImageSchema', () => {
  it('supports source-annotated schema labels', () => {
    expect(isRosImageSchema('sensor_msgs/msg/Image [ros2msg]')).toBe(true);
    expect(isRosImageSchema('sensor_msgs/msg/CompressedImage [jsonschema]')).toBe(true);
    expect(isRosImageSchema(`${ROS_MSG_FOXGLOVE_COMPRESSED_VIDEO} [ros2msg]`)).toBe(true);
  });
});

describe('isPoseStampedSchema', () => {
  it('matches PoseStamped with source suffixes', () => {
    expect(isPoseStampedSchema('geometry_msgs/msg/PoseStamped [ros2msg]')).toBe(true);
    expect(isPoseStampedSchema(ROS_MSG_POSE_STAMPED)).toBe(true);
  });
});

describe('rosMessageTypes', () => {
  it('detects JointState schema with normalized matching', () => {
    expect(isJointStateSchema('sensor_msgs/msg/JointState')).toBe(true);
    expect(isJointStateSchema('sensor_msgs/msg/JointState ')).toBe(true);
  });

  it('detects image schemas', () => {
    expect(isRosImageSchema('sensor_msgs/msg/Image')).toBe(true);
    expect(isRosImageSchema('sensor_msgs/msg/CompressedImage')).toBe(true);
    expect(isRosImageSchema(ROS_MSG_FOXGLOVE_COMPRESSED_VIDEO)).toBe(true);
    expect(isRosImageSchema('sensor_msgs/msg/CameraInfo')).toBe(false);
  });

  it('detects RawAudio and audio panel main schemas', () => {
    expect(isRawAudioSchema(`${ROS_MSG_FOXGLOVE_RAW_AUDIO} [ros2msg]`)).toBe(true);
    expect(isRawAudioSchema('foxglove_msgs/RawAudio')).toBe(true);
    expect(isAudioPanelMainTopicSchema('audio_common_msgs/msg/AudioData [ros2msg]')).toBe(true);
    expect(isAudioPanelMainTopicSchema('audio_common_msgs/msg/AudioDataStamped')).toBe(true);
    expect(isAudioPanelMainTopicSchema('sensor_msgs/msg/Image')).toBe(false);
  });
});
