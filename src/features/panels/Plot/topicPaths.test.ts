import { describe, expect, it } from 'vitest';
import { createPlotSeries } from './defaults';
import { mergeDetectedSeries, rebuildJointStateSeries } from './topicPaths';

describe('mergeDetectedSeries', () => {
  it('updates only the targeted series slot when topic changes', () => {
    const current = [
      createPlotSeries({ id: 's1', topic: '/joint_cmd', path: 'position[:]', color: '#111111' }),
      createPlotSeries({ id: 's2', topic: '/other', path: 'data', color: '#222222' }),
    ];
    const detected = [
      createPlotSeries({ id: 'new-1', topic: '/joint_states', path: 'position[:]' }),
    ];
    const merged = mergeDetectedSeries(current, 's1', detected);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.topic).toBe('/joint_states');
    expect(merged[0]?.path).toBe('position[:]');
    expect(merged[0]?.id).toBe('s1');
    expect(merged[0]?.color).toBe('#111111');
    expect(merged[1]?.topic).toBe('/other');
    expect(merged[1]?.path).toBe('data');
  });

  it('preserves user-added series when updating a non-primary slot', () => {
    const current = [
      createPlotSeries({ id: 's1', topic: '/joint_cmd', path: 'position[:]' }),
      createPlotSeries({ id: 's2', topic: '', path: '' }),
    ];
    const detected = [
      createPlotSeries({ id: 'new-2', topic: '/joint_states', path: 'position[:]' }),
    ];
    const merged = mergeDetectedSeries(current, 's2', detected);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.topic).toBe('/joint_cmd');
    expect(merged[1]?.topic).toBe('/joint_states');
    expect(merged[1]?.id).toBe('s2');
  });
});

describe('rebuildJointStateSeries', () => {
  it('rebuilds primary joint fields while keeping manually added series', () => {
    const current = [
      createPlotSeries({ id: 's1', topic: '/joint_cmd', path: 'position[:]' }),
      createPlotSeries({ id: 's2', topic: '/joint_states', path: 'position[0]' }),
    ];
    const rebuilt = rebuildJointStateSeries(
      current,
      '/joint_cmd',
      'sensor_msgs/msg/JointState',
      ['position', 'velocity'],
    );
    expect(rebuilt.length).toBeGreaterThanOrEqual(3);
    expect(rebuilt[0]?.path).toBe('position[:]');
    expect(rebuilt[1]?.path).toBe('velocity[:]');
    expect(rebuilt.at(-1)?.id).toBe('s2');
    expect(rebuilt.at(-1)?.topic).toBe('/joint_states');
  });
});
