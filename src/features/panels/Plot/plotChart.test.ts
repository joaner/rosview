import { describe, expect, it } from 'vitest';
import {
  computeRelativeTimeSplits,
  formatPlotXAxisTicks,
  formatPlotXValue,
  formatPlotYValue,
  pickRelativeTimeIncrement,
} from './plotChart';

describe('plotChart formatting', () => {
  it('formats Y values with adaptive precision', () => {
    expect(formatPlotYValue(12345)).toBe('12345');
    expect(formatPlotYValue(1.23456)).toBe('1.235');
    expect(formatPlotYValue(0.00012)).toBe('1.20e-4');
  });

  it('formats timestamp X values as relative time when log start is known', () => {
    const logStart = { sec: 1_735_689_600, nsec: 0 };
    expect(formatPlotXValue(1_735_689_610.5, 'timestamp', logStart)).toBe('00:10.500');
  });

  it('formats X axis ticks with the same relative time as hover labels', () => {
    const logStart = { sec: 1_735_689_600, nsec: 0 };
    const splits = [1_735_689_600, 1_735_689_610, 1_735_689_620];
    expect(formatPlotXAxisTicks(splits, 'timestamp', logStart)).toEqual([
      '00:00.000',
      '00:10.000',
      '00:20.000',
    ]);
  });

  it('formats index X values', () => {
    expect(formatPlotXValue(3, 'index')).toBe('3');
    expect(formatPlotXValue(1.25, 'index')).toBe('1.250');
  });
});

describe('relative time axis splits', () => {
  it('picks increasing human-friendly increments', () => {
    expect(pickRelativeTimeIncrement(0.3)).toBe(0.5);
    expect(pickRelativeTimeIncrement(3)).toBe(5);
    expect(pickRelativeTimeIncrement(40)).toBe(60);
  });

  it('aligns the first grid line to relative 0 when the view starts at log start', () => {
    const origin = 1_735_689_600.529;
    const splits = computeRelativeTimeSplits(origin, origin + 10, origin, 40, 400);
    expect(splits[0]).toBeCloseTo(origin, 9);
    expect(splits[1]).toBeCloseTo(origin + 1, 9);
    expect(splits[2]).toBeCloseTo(origin + 2, 9);
  });

  it('labels splits from relative 0 even when log start has sub-second offset', () => {
    const logStart = { sec: 1_735_689_600, nsec: 529_000_000 };
    const origin = 1_735_689_600.529;
    const splits = computeRelativeTimeSplits(origin, origin + 10, origin, 40, 400);
    expect(formatPlotXAxisTicks(splits.slice(0, 3), 'timestamp', logStart)).toEqual([
      '00:00.000',
      '00:01.000',
      '00:02.000',
    ]);
  });
});
