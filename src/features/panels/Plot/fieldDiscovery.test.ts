import { describe, expect, it } from 'vitest';
import { discoverNumericPlotFields } from './fieldDiscovery';

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

describe('discoverNumericPlotFields', () => {
  it('discovers nested PoseStamped numeric leaves and skips header metadata', () => {
    const paths = discoverNumericPlotFields(poseStampedSample).map((field) => field.path);
    expect(paths).toContain('pose.position.x');
    expect(paths).toContain('pose.position.y');
    expect(paths).toContain('pose.position.z');
    expect(paths).toContain('pose.orientation.w');
    expect(paths).not.toContain('header.stamp.sec');
    expect(paths).not.toContain('header.frame_id');
  });

  it('discovers booleans, numeric strings, and numeric arrays', () => {
    const fields = discoverNumericPlotFields({
      enabled: true,
      gain: '1.25',
      samples: [1, 2, 3],
      label: 'not numeric',
    });
    expect(fields.map((field) => field.path)).toEqual(expect.arrayContaining([
      'samples[:]',
      'enabled',
      'gain',
    ]));
  });

  it('does not expand object arrays into many accidental curves', () => {
    const fields = discoverNumericPlotFields({
      poses: [{ x: 1 }, { x: 2 }],
      value: 3,
    });
    expect(fields.map((field) => field.path)).toEqual(['value']);
  });
});
