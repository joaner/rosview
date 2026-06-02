import { describe, expect, it, vi } from 'vitest';
import type { MessageEvent } from '@/core/types/ros';
import { buildPlotDataset, indexEventsByTopic } from './datasets';
import { defaultPlotConfig } from './defaults';
import * as messagePath from './messagePath';
import * as plotEventIndex from './plotEventIndex';

function event(topic: string, sec: number, message: unknown): MessageEvent {
  return {
    topic,
    receiveTime: { sec, nsec: 0 },
    publishTime: { sec, nsec: 0 },
    message,
    schemaName: 'std_msgs/msg/Float64MultiArray',
  };
}

describe('plotEventIndex', () => {
  it('groups events by topic in one pass', () => {
    const events = [
      event('/a', 1, { data: 1 }),
      event('/b', 2, { data: 2 }),
      event('/a', 3, { data: 3 }),
    ];
    const index = indexEventsByTopic(events);
    expect(index.get('/a')?.length).toBe(2);
    expect(index.get('/b')?.length).toBe(1);
  });
});

describe('buildPlotDataset performance characteristics', () => {
  it('indexes events once for multi-series multi-topic builds', () => {
    const indexSpy = vi.spyOn(plotEventIndex, 'indexEventsByTopic');
    const events = Array.from({ length: 300 }, (_, i) =>
      event(i % 3 === 0 ? '/a' : i % 3 === 1 ? '/b' : '/c', i, { data: i }),
    );
    const config = {
      ...defaultPlotConfig(),
      series: [
        { ...defaultPlotConfig().series[0], id: 's1', topic: '/a', path: 'data', enabled: true },
        { ...defaultPlotConfig().series[0], id: 's2', topic: '/b', path: 'data', enabled: true },
        { ...defaultPlotConfig().series[0], id: 's3', topic: '/c', path: 'data', enabled: true },
      ],
    };
    buildPlotDataset(events, config);
    expect(indexSpy).toHaveBeenCalledTimes(1);
    indexSpy.mockRestore();
  });
});

describe('buildPlotDataset sampleRatio', () => {
  it('returns 1 when no downsampling occurs', () => {
    const config = {
      ...defaultPlotConfig(),
      downsampleMode: 'none' as const,
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/value',
        path: 'data',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset(
      [event('/value', 1, { data: 1 }), event('/value', 2, { data: 2 })],
      config,
    );
    expect(dataset.sampleRatio).toBe(1);
  });

  it('returns less than 1 when downsampling reduces X count', () => {
    const config = {
      ...defaultPlotConfig(),
      maxPoints: 10,
      downsampleMode: 'minMaxLast' as const,
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/value',
        path: 'data',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const events = Array.from({ length: 200 }, (_, i) => event('/value', i, { data: i }));
    const dataset = buildPlotDataset(events, config);
    expect(dataset.sampleRatio).toBeLessThan(1);
  });
});

describe('buildPlotDataset warnings', () => {
  it('emits noNumericValues when path yields nothing', () => {
    vi.spyOn(messagePath, 'extractPlotPathValues').mockReturnValue([]);
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/value',
        path: 'missing',
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset([event('/value', 1, {})], config);
    expect(dataset.warnings.some((w) => w.kind === 'noNumericValues')).toBe(true);
    vi.restoreAllMocks();
  });

  it('skips disabled series', () => {
    const config = {
      ...defaultPlotConfig(),
      series: [{
        ...defaultPlotConfig().series[0],
        id: 's1',
        topic: '/value',
        path: 'data',
        enabled: false,
        timestampMode: 'receiveTime' as const,
      }],
    };
    const dataset = buildPlotDataset([event('/value', 1, { data: 1 })], config);
    expect(dataset.series).toHaveLength(0);
  });
});
