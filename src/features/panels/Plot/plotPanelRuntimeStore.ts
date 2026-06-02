import { useSyncExternalStore } from 'react';

export interface PlotLegendEntry {
  key: string;
  label: string;
  color: string;
}

type Listener = () => void;

const EMPTY_LEGEND_ENTRIES: PlotLegendEntry[] = [];

const legendByPanelId = new Map<string, PlotLegendEntry[]>();
const listenersByPanelId = new Map<string, Set<Listener>>();

function legendEntriesEqual(a: readonly PlotLegendEntry[], b: readonly PlotLegendEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left?.key !== right?.key || left?.label !== right?.label || left?.color !== right?.color) {
      return false;
    }
  }
  return true;
}

function notify(panelId: string): void {
  const listeners = listenersByPanelId.get(panelId);
  if (!listeners) return;
  for (const listener of listeners) {
    listener();
  }
}

export function setPlotLegendEntries(panelId: string, entries: readonly PlotLegendEntry[]): void {
  const prev = legendByPanelId.get(panelId) ?? EMPTY_LEGEND_ENTRIES;
  if (legendEntriesEqual(prev, entries)) return;

  if (entries.length === 0) {
    legendByPanelId.delete(panelId);
  } else {
    legendByPanelId.set(panelId, entries.map((entry) => ({ ...entry })));
  }
  notify(panelId);
}

export function getPlotLegendEntries(panelId: string): PlotLegendEntry[] {
  return legendByPanelId.get(panelId) ?? EMPTY_LEGEND_ENTRIES;
}

export function clearPlotLegendEntries(panelId: string): void {
  if (!legendByPanelId.has(panelId)) return;
  legendByPanelId.delete(panelId);
  notify(panelId);
}

export function subscribePlotLegendEntries(panelId: string, listener: Listener): () => void {
  let bucket = listenersByPanelId.get(panelId);
  if (!bucket) {
    bucket = new Set();
    listenersByPanelId.set(panelId, bucket);
  }
  bucket.add(listener);
  return () => {
    bucket!.delete(listener);
    if (bucket!.size === 0) {
      listenersByPanelId.delete(panelId);
    }
  };
}

export function usePlotLegendEntries(panelId: string): PlotLegendEntry[] {
  return useSyncExternalStore(
    (listener) => subscribePlotLegendEntries(panelId, listener),
    () => getPlotLegendEntries(panelId),
    () => EMPTY_LEGEND_ENTRIES,
  );
}
