import { describe, expect, it, vi } from 'vitest';
import {
  clearPlotLegendEntries,
  getPlotLegendEntries,
  setPlotLegendEntries,
  subscribePlotLegendEntries,
} from './plotPanelRuntimeStore';

describe('plotPanelRuntimeStore', () => {
  it('returns a stable empty snapshot when no legend is loaded', () => {
    expect(getPlotLegendEntries('panel-a')).toBe(getPlotLegendEntries('panel-a'));
  });

  it('does not notify subscribers when legend entries are unchanged', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePlotLegendEntries('panel-b', listener);
    const entries = [{ key: 'a', label: 'A', color: '#111' }];

    setPlotLegendEntries('panel-b', entries);
    expect(listener).toHaveBeenCalledTimes(1);
    const snapshot = getPlotLegendEntries('panel-b');

    setPlotLegendEntries('panel-b', [{ key: 'a', label: 'A', color: '#111' }]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getPlotLegendEntries('panel-b')).toBe(snapshot);

    unsubscribe();
    clearPlotLegendEntries('panel-b');
  });
});
