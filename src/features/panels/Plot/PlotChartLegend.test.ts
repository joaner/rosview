import { describe, expect, it } from 'vitest';
import { collapsedPlotLegendEntries, filterPlotLegendEntries } from './PlotChartLegend';

const entries = [
  { key: 's1:a', label: '/joint_states · shoulder', color: '#111111' },
  { key: 's1:b', label: '/joint_states · elbow', color: '#222222' },
  { key: 's2:x', label: '/tf · base_link', color: '#333333' },
];

describe('filterPlotLegendEntries', () => {
  it('returns all entries for an empty query', () => {
    expect(filterPlotLegendEntries(entries, '')).toEqual(entries);
  });

  it('filters labels case-insensitively', () => {
    expect(filterPlotLegendEntries(entries, 'TF').map((entry) => entry.key)).toEqual(['s2:x']);
    expect(filterPlotLegendEntries(entries, 'joint').map((entry) => entry.key)).toEqual(['s1:a', 's1:b']);
  });
});

describe('collapsedPlotLegendEntries', () => {
  it('prioritizes visible entries so Only remains visible when collapsed', () => {
    expect(collapsedPlotLegendEntries(entries, ['s1:a', 's1:b']).map((entry) => entry.key)).toEqual([
      's2:x',
    ]);
  });

  it('falls back to original order when everything is hidden', () => {
    expect(collapsedPlotLegendEntries(entries, entries.map((entry) => entry.key)).map((entry) => entry.key)).toEqual([
      's1:a',
    ]);
  });
});
