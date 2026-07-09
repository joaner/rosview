import { describe, expect, it } from 'vitest';
import {
  createDatasetGroupId,
  datasetGroupKey,
  groupDatasets,
  normalizeRosViewSources,
  type DatasetItem,
} from './datasetSources';

function makeFile(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { lastModified: 1 });
}

function makeDataset(id: string, overrides: Partial<DatasetItem> = {}): DatasetItem {
  return { id, kind: 'file', name: id, ...overrides };
}

describe('datasetGroupKey', () => {
  it('falls back to the item id when groupId is unset', () => {
    expect(datasetGroupKey(makeDataset('a'))).toBe('a');
  });

  it('uses groupId when set', () => {
    expect(datasetGroupKey(makeDataset('a', { groupId: 'g1' }))).toBe('g1');
  });
});

describe('groupDatasets', () => {
  it('treats each ungrouped item as its own group, preserving order', () => {
    const items = [makeDataset('a'), makeDataset('b')];
    const groups = groupDatasets(items);
    expect(groups).toEqual([
      { groupId: 'a', members: [items[0]] },
      { groupId: 'b', members: [items[1]] },
    ]);
  });

  it('collects members that share a groupId, in first-seen order', () => {
    const a = makeDataset('a', { groupId: 'g1' });
    const b = makeDataset('b', { groupId: 'g1' });
    const c = makeDataset('c');
    const groups = groupDatasets([a, c, b]);
    expect(groups.map((g) => g.groupId)).toEqual(['g1', 'c']);
    expect(groups[0].members).toEqual([a, b]);
    expect(groups[1].members).toEqual([c]);
  });
});

describe('createDatasetGroupId', () => {
  it('produces unique ids across calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createDatasetGroupId()));
    expect(ids.size).toBe(20);
  });
});

describe('normalizeRosViewSources with mergeSources', () => {
  it('does not assign a groupId by default (existing switcher behavior unchanged)', () => {
    const items = normalizeRosViewSources({ files: [makeFile('a.mcap'), makeFile('b.mcap')] });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.groupId == null)).toBe(true);
    expect(groupDatasets(items)).toHaveLength(2);
  });

  it('assigns one shared groupId to every item when mergeSources is true', () => {
    const items = normalizeRosViewSources({
      files: [makeFile('base.mcap'), makeFile('incremental.mcap')],
      mergeSources: true,
    });
    expect(items).toHaveLength(2);
    const groupId = items[0].groupId;
    expect(groupId).toBeTruthy();
    expect(items[1].groupId).toBe(groupId);
    expect(groupDatasets(items)).toHaveLength(1);
  });

  it('mergeSources with a single resulting item is a no-op (no groupId needed)', () => {
    const items = normalizeRosViewSources({ files: [makeFile('only.mcap')], mergeSources: true });
    expect(items).toHaveLength(1);
    expect(items[0].groupId).toBeUndefined();
  });

  it('mergeSources merges files and urls together into one group', () => {
    const items = normalizeRosViewSources({
      files: [makeFile('base.mcap')],
      urls: ['https://example.com/incremental.mcap'],
      mergeSources: true,
    });
    expect(items).toHaveLength(2);
    expect(groupDatasets(items)).toHaveLength(1);
  });
});
