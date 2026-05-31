import { describe, expect, it } from 'vitest';
import type { MessageEvent } from '@/core/types/ros';
import { buildPlotDataset } from './datasets';
import { defaultPlotConfig } from './defaults';

function event(topic: string, sec: number, message: unknown, schemaName = 'std_msgs/msg/Float64MultiArray'): MessageEvent {
  return {
    topic,
    receiveTime: { sec, nsec: 0 },
    publishTime: { sec, nsec: 0 },
    message,
    schemaName,
  };
}

describe('buildPlotDataset', () => {
  it('builds timestamp datasets for Float64MultiArray slices before playback', () => {
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/array',
        path: 'data[:]',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset(
      [
        event('/array', 1, { data: [1, 2] }),
        event('/array', 2, { data: [3, 4] }),
      ],
      config,
    );
    expect(dataset.series.map((series) => series.label)).toEqual([
      '/array.data[:] data[0]',
      '/array.data[:] data[1]',
    ]);
    expect(dataset.data[0]).toEqual([1, 2]);
    expect(dataset.data[1]).toEqual([1, 3]);
    expect(dataset.data[2]).toEqual([2, 4]);
  });

  it('builds JointState datasets using joint names', () => {
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 'joints',
        topic: '/joint_states',
        path: 'position[:]',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset(
      [
        event('/joint_states', 1, { name: ['a', 'b'], position: [0.1, 0.2] }, 'sensor_msgs/msg/JointState'),
        event('/joint_states', 2, { name: ['a', 'b'], position: [0.3, 0.4] }, 'sensor_msgs/msg/JointState'),
      ],
      config,
    );
    expect(dataset.series.map((series) => series.label)).toEqual([
      '/joint_states.position[:] a',
      '/joint_states.position[:] b',
    ]);
    expect(dataset.data[1]).toEqual([0.1, 0.3]);
    expect(dataset.data[2]).toEqual([0.2, 0.4]);
  });

  it('uses only the latest message in index mode', () => {
    const config = {
      ...defaultPlotConfig(),
      xAxisMode: 'index' as const,
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/array',
        path: 'data[:]',
      }],
    };
    const dataset = buildPlotDataset(
      [
        event('/array', 1, { data: [1, 2] }),
        event('/array', 2, { data: [3, 4] }),
      ],
      config,
    );
    expect(dataset.data[0]).toEqual([0, 1]);
    expect(dataset.data[1]).toEqual([3, 4]);
  });

  it('pairs custom x and y arrays', () => {
    const config = {
      ...defaultPlotConfig(),
      xAxisMode: 'custom' as const,
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/scan',
        xAxisPath: 'x[:]',
        path: 'y[:]',
      }],
    };
    const dataset = buildPlotDataset([event('/scan', 1, { x: [10, 20], y: [5, 6] })], config);
    expect(dataset.data[0]).toEqual([10, 20]);
    expect(dataset.data[1]).toEqual([5, 6]);
  });

  it('derives values without appending seek backfill into existing history', () => {
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/value',
        path: 'data@derivative',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset(
      [
        event('/value', 1, { data: 1 }),
        event('/value', 3, { data: 5 }),
      ],
      config,
    );
    expect(dataset.data[0]).toEqual([3]);
    expect(dataset.data[1]).toEqual([2]);
  });
});
