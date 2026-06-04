import { describe, expect, it } from 'vitest';
import { createPlotSeries } from './defaults';
import { normalizePlotConfig } from './plotConfigNormalize';
import { parsePlotConfig } from './schema';

describe('normalizePlotConfig', () => {
  it('merges legacy auto-split JointState series on the primary topic', () => {
    const normalized = normalizePlotConfig({
      series: [
        createPlotSeries({ id: 's1', topic: '/joint_states', path: 'position[:]' }),
        createPlotSeries({ id: 's2', topic: '/joint_states', path: 'velocity[:]' }),
        createPlotSeries({ id: 's3', topic: '/other', path: 'data' }),
      ],
      xAxisMode: 'timestamp',
      maxPoints: 20_000,
      followingViewWidthSec: 0,
      syncX: false,
      downsampleMode: 'minMaxLast',
      nonIndexedMaxMessages: 20_000,
      jointStateFields: ['position'],
      hiddenLegendKeys: [],
    });

    expect(normalized.series).toHaveLength(2);
    expect(normalized.series[0]?.path).toBe('position[:],velocity[:]');
    expect(normalized.jointStateFields).toEqual(['position', 'velocity']);
    expect(normalized.series[1]?.topic).toBe('/other');
  });

  it('infers jointStateFields from a combined primary path', () => {
    const normalized = normalizePlotConfig({
      series: [
        createPlotSeries({
          id: 's1',
          topic: '/joint_states',
          path: 'position[:],velocity[:],effort[:]',
        }),
      ],
      xAxisMode: 'timestamp',
      maxPoints: 20_000,
      followingViewWidthSec: 0,
      syncX: false,
      downsampleMode: 'minMaxLast',
      nonIndexedMaxMessages: 20_000,
      jointStateFields: ['position'],
      hiddenLegendKeys: [],
    });

    expect(normalized.jointStateFields).toEqual(['position', 'velocity', 'effort']);
  });
});

describe('parsePlotConfig normalization', () => {
  it('normalizes legacy multi-series JointState layouts on load', () => {
    const parsed = parsePlotConfig({
      series: [
        { id: 's1', topic: '/joint_cmd', path: 'position[:]' },
        { id: 's2', topic: '/joint_cmd', path: 'effort[:]' },
      ],
      jointStateFields: ['position'],
    });

    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0]?.path).toBe('position[:],effort[:]');
    expect(parsed.jointStateFields).toEqual(['position', 'effort']);
  });
});
