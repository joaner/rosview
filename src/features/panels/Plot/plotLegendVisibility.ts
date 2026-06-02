import type { PlotLegendEntry } from './plotPanelRuntimeStore';

export function isPlotLegendVisible(hiddenKeys: readonly string[], key: string): boolean {
  return !hiddenKeys.includes(key);
}

export function setPlotLegendVisible(
  hiddenKeys: readonly string[],
  key: string,
  visible: boolean,
): string[] {
  if (visible) return hiddenKeys.filter((entry) => entry !== key);
  return hiddenKeys.includes(key) ? [...hiddenKeys] : [...hiddenKeys, key];
}

export function setAllPlotLegendVisible(allKeys: readonly string[], visible: boolean): string[] {
  return visible ? [] : [...allKeys];
}

export function pruneHiddenLegendKeys(
  hiddenKeys: readonly string[],
  validKeys: readonly string[],
): string[] {
  const valid = new Set(validKeys);
  return hiddenKeys.filter((key) => valid.has(key));
}

export function hiddenSeriesIndices(
  series: readonly PlotLegendEntry[],
  hiddenKeys: readonly string[],
): Set<number> {
  const hidden = new Set(hiddenKeys);
  const indices = new Set<number>();
  series.forEach((entry, index) => {
    if (hidden.has(entry.key)) indices.add(index);
  });
  return indices;
}

export type PlotLegendSelectionState = 'none' | 'partial' | 'all';

export function plotLegendSelectionState(
  entries: readonly PlotLegendEntry[],
  hiddenKeys: readonly string[],
): PlotLegendSelectionState {
  if (entries.length === 0) return 'all';
  const visibleCount = entries.filter((entry) => isPlotLegendVisible(hiddenKeys, entry.key)).length;
  if (visibleCount === 0) return 'none';
  if (visibleCount === entries.length) return 'all';
  return 'partial';
}
