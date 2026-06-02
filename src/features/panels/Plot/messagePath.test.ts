import { describe, expect, it } from 'vitest';
import { extractPlotPathValues } from './messagePath';

describe('extractPlotPathValues', () => {
  it('extracts scalar numeric fields', () => {
    expect(extractPlotPathValues({ data: 1.5 }, 'data')).toEqual([
      { key: 'data', label: 'data', value: 1.5 },
    ]);
  });

  it('extracts Float64MultiArray data slices', () => {
    expect(extractPlotPathValues({ data: [1, 2, 3] }, 'data[:]')).toEqual([
      { key: 'data[0]', label: 'data[0]', value: 1 },
      { key: 'data[1]', label: 'data[1]', value: 2 },
      { key: 'data[2]', label: 'data[2]', value: 3 },
    ]);
  });

  it('supports typed arrays', () => {
    expect(extractPlotPathValues({ data: new Float64Array([4, 5]) }, 'data[:]')).toEqual([
      { key: 'data[0]', label: 'data[0]', value: 4 },
      { key: 'data[1]', label: 'data[1]', value: 5 },
    ]);
  });

  it('maps JointState arrays by name', () => {
    const message = { name: ['shoulder', 'elbow'], position: [0.1, 0.2] };
    expect(extractPlotPathValues(message, 'position[:]')).toEqual([
      { key: 'position[shoulder]', label: 'position[0] (shoulder)', value: 0.1 },
      { key: 'position[elbow]', label: 'position[1] (elbow)', value: 0.2 },
    ]);
    expect(extractPlotPathValues(message, 'position[elbow]')).toEqual([
      { key: 'position[elbow]', label: 'position[1] (elbow)', value: 0.2 },
    ]);
  });

  it('applies math modifiers', () => {
    expect(extractPlotPathValues({ data: -2 }, 'data@abs')).toEqual([
      { key: 'data', label: 'data', value: 2 },
    ]);
  });
});
