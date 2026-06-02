import { describe, expect, it } from 'vitest';
import { parsePlotConfig } from './schema';
import { defaultPlotConfig } from './defaults';

describe('parsePlotConfig', () => {
  it('returns defaults for invalid input', () => {
    const parsed = parsePlotConfig(null);
    expect(parsed.maxPoints).toBe(defaultPlotConfig().maxPoints);
    expect(parsed.series.length).toBeGreaterThan(0);
  });

  it('clamps maxPoints and nonIndexedMaxMessages', () => {
    const parsed = parsePlotConfig({
      maxPoints: 999_999,
      nonIndexedMaxMessages: 50,
    });
    expect(parsed.maxPoints).toBeLessThanOrEqual(200_000);
    expect(parsed.nonIndexedMaxMessages).toBeGreaterThanOrEqual(1000);
  });

  it('parses hiddenLegendKeys and jointStateFields', () => {
    const parsed = parsePlotConfig({
      hiddenLegendKeys: ['a', '', 'b'],
      jointStateFields: ['position', 'velocity', 'invalid'],
    });
    expect(parsed.hiddenLegendKeys).toEqual(['a', 'b']);
    expect(parsed.jointStateFields).toEqual(['position', 'velocity']);
  });

  it('maps legacy showLine false to dashed lineStyle', () => {
    const parsed = parsePlotConfig({
      series: [{ showLine: false }],
    });
    expect(parsed.series[0]?.lineStyle).toBe('dashed');
  });
});
