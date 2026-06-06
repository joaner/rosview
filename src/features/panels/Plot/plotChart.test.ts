import { describe, expect, it } from 'vitest';
import {
  clampScaleToRange,
  computeRelativeTimeSplits,
  formatPlotXAxisTicks,
  formatPlotXValue,
  formatPlotYValue,
  panScale,
  pickRelativeTimeIncrement,
  zoomScaleAroundCursor,
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

describe('plot chart viewport helpers', () => {
  it('zooms around the cursor value', () => {
    expect(zoomScaleAroundCursor({ min: 0, max: 10 }, 2.5, 0.5)).toEqual({
      min: 1.25,
      max: 6.25,
    });
  });

  it('zooms Y ranges around the cursor value without requiring a full range', () => {
    expect(zoomScaleAroundCursor({ min: -10, max: 10 }, 5, 0.5)).toEqual({
      min: -2.5,
      max: 7.5,
    });
  });

  it('pans with pixel deltas and clamps to the full range', () => {
    expect(panScale({ min: 20, max: 40 }, 50, 100, { min: 0, max: 100 })).toEqual({
      min: 10,
      max: 30,
    });
    expect(panScale({ min: 0, max: 20 }, 50, 100, { min: 0, max: 100 })).toEqual({
      min: 0,
      max: 20,
    });
  });

  it('pans Y ranges without full-range clamping', () => {
    expect(panScale({ min: -10, max: 10 }, -25, 100)).toEqual({
      min: -5,
      max: 15,
    });
  });

  it('clamps oversized views to the full range', () => {
    expect(clampScaleToRange({ min: -10, max: 120 }, { min: 0, max: 100 })).toEqual({
      min: 0,
      max: 100,
    });
  });
});
