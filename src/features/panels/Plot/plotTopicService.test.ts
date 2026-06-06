import { describe, expect, it } from 'vitest';
import { detectPlotSeriesForTopic } from './plotTopicService';

const poseStampedSample = {
  header: {
    stamp: { sec: 1773650610, nsec: 100884418 },
    frame_id: 'base_link',
  },
  pose: {
    position: { x: -0.14, y: 0.48, z: 0.21 },
    orientation: { x: 0.65, y: 0.69, z: -0.19, w: 0.24 },
  },
};

const tfMessageSample = {
  transforms: [{
    header: {
      stamp: { sec: 1739868633, nsec: 389101565 },
      frame_id: 'base_link',
    },
    child_frame_id: 'link_Hips_R',
    transform: {
      translation: { x: 0, y: 0, z: 0.9712 },
      rotation: { x: 0.0338, y: 0, z: 0, w: 0.9994 },
    },
  }],
};

describe('detectPlotSeriesForTopic', () => {
  it('does not let JointState defaults overwrite PoseStamped detected paths', () => {
    const result = detectPlotSeriesForTopic({
      topic: '/pose',
      schemaName: 'geometry_msgs/msg/PoseStamped',
      sample: poseStampedSample,
      existingSeriesId: 's1',
      jointStateFields: ['position'],
    });

    expect(result.series[0]?.path).toBe('pose.position.x,pose.position.y,pose.position.z');
    expect(result.series[0]?.path).not.toBe('position[:]');
  });

  it('keeps JointState fields as combined array paths', () => {
    const result = detectPlotSeriesForTopic({
      topic: '/joint_states',
      schemaName: 'sensor_msgs/msg/JointState',
      sample: { name: ['a'], position: [1], velocity: [2] },
      existingSeriesId: 's1',
      jointStateFields: ['position', 'velocity'],
    });

    expect(result.series[0]?.path).toBe('position[:],velocity[:]');
  });

  it('uses sample discovery for unknown schemas', () => {
    const result = detectPlotSeriesForTopic({
      topic: '/custom',
      schemaName: 'custom_msgs/msg/Foo',
      sample: { foo: { bar: { x: 1, y: 2 } } },
      existingSeriesId: 's1',
    });

    expect(result.series[0]?.path).toBe('foo.bar.x,foo.bar.y');
  });

  it('uses TFMessage translation axes as the default path', () => {
    const result = detectPlotSeriesForTopic({
      topic: '/tf',
      schemaName: 'tf2_msgs/msg/TFMessage',
      sample: tfMessageSample,
      existingSeriesId: 's1',
    });

    expect(result.series[0]?.path).toBe(
      'transforms[:].transform.translation.x,transforms[:].transform.translation.y,transforms[:].transform.translation.z',
    );
    expect(result.series[0]?.label).toBe('translation.x, translation.y, translation.z');
  });
});
