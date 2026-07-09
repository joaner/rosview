import { describe, expect, it } from 'vitest';
import {
  createDatasetGroupId,
  datasetGroupKey,
  dedupeDatasetItems,
  fileDatasetId,
  groupDatasets,
  mergeDatasetLists,
  normalizeRosViewSources,
  resolveActiveId,
  resolveAppendGroupId,
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

describe('resolveAppendGroupId', () => {
  it('uses the fallback id when none of the files are already loaded', () => {
    const file = makeFile('a.mcap');
    const groupId = resolveAppendGroupId([], [file], 'fallback');
    expect(groupId).toBe('fallback');
  });

  it('reuses the existing group id when a file is already loaded under a different group', () => {
    const file = makeFile('a.mcap');
    const existing = [makeDataset(fileDatasetId(file), { groupId: 'group:existing' })];
    const groupId = resolveAppendGroupId(existing, [file], 'fallback-fresh-id');
    expect(groupId).toBe('group:existing');
  });

  it('falls back when the existing item has no groupId of its own (standalone dataset)', () => {
    const file = makeFile('a.mcap');
    const existing = [makeDataset(fileDatasetId(file))];
    const groupId = resolveAppendGroupId(existing, [file], 'fallback');
    expect(groupId).toBe('fallback');
  });

  it('matches on the first file in the batch that is already known', () => {
    const known = makeFile('known.mcap');
    const fresh = makeFile('fresh.mcap');
    const existing = [makeDataset(fileDatasetId(known), { groupId: 'group:existing' })];
    expect(resolveAppendGroupId(existing, [fresh, known], 'fallback')).toBe('group:existing');
  });

  it('regression: reopening an already-loaded file with a forced new-session id lands on a real group', () => {
    // Reproduces the bug: replaying a file via remembered history (or
    // re-extracting a tar) always mints a brand-new group id, ignoring
    // whether the file is already loaded under a different one.
    const file = makeFile('episode_00044.mcap');
    const originalGroupId = 'group:original';
    const prev: DatasetItem[] = [
      { id: fileDatasetId(file), kind: 'file', name: file.name, file, groupId: originalGroupId },
    ];

    const forcedFreshGroupId = createDatasetGroupId();
    const resolvedGroupId = resolveAppendGroupId(prev, [file], forcedFreshGroupId);
    const items = dedupeDatasetItems([
      { id: fileDatasetId(file), kind: 'file', name: file.name, file, groupId: resolvedGroupId },
    ]);
    const merged = mergeDatasetLists(prev, items);

    // The id we'd activate must correspond to a real, live group — not an
    // orphan that `mergeDatasetLists`'s dedup silently discarded.
    expect(resolvedGroupId).toBe(originalGroupId);
    expect(groupDatasets(merged).some((g) => g.groupId === resolvedGroupId)).toBe(true);
  });
});

describe('resolveActiveId', () => {
  it('returns null when there are no datasets', () => {
    expect(resolveActiveId([], 'anything')).toBeNull();
    expect(resolveActiveId([], null)).toBeNull();
  });

  it('keeps the current id when it still names a real group', () => {
    const datasets = [makeDataset('a', { groupId: 'g1' }), makeDataset('b')];
    expect(resolveActiveId(datasets, 'g1')).toBe('g1');
  });

  it('falls back to the first dataset group when current is null or stale', () => {
    const datasets = [makeDataset('a', { groupId: 'g1' }), makeDataset('b')];
    expect(resolveActiveId(datasets, null)).toBe('g1');
    expect(resolveActiveId(datasets, 'group:gone')).toBe('g1');
  });
});

describe('resolveAppendGroupId <-> resolveActiveId agreement (regression)', () => {
  // These two functions are called from different places (appending files,
  // and an Effect that keeps `activeId` valid whenever the dataset list
  // changes) but must always agree on which group is "real" — otherwise
  // `activeId` bounces between them on every render. That bounce is exactly
  // what caused the production bug: each bounce tore down and recreated the
  // player/worker, producing a flickering UI and hundreds of
  // `WorkerSourceCancelledError`s until the tab crashed.
  function simulateAppend(
    existing: DatasetItem[],
    files: File[],
    forceNewSession: boolean,
    currentActiveId: string | null,
  ) {
    const groupId = forceNewSession
      ? resolveAppendGroupId(existing, files, createDatasetGroupId())
      : (currentActiveId ?? createDatasetGroupId());
    const items = dedupeDatasetItems(
      files.map((f) => ({ id: fileDatasetId(f), kind: 'file' as const, name: f.name, file: f, groupId })),
    );
    const datasets = mergeDatasetLists(existing, items);
    return { datasets, activatedId: groupId };
  }

  it('a forced-new-session append of an already-loaded file never bounces', () => {
    const file = makeFile('episode_00044.mcap');
    const originalGroupId = 'group:original';
    const existing: DatasetItem[] = [
      { id: fileDatasetId(file), kind: 'file', name: file.name, file, groupId: originalGroupId },
    ];

    const { datasets, activatedId } = simulateAppend(existing, [file], true, null);
    const correctedId = resolveActiveId(datasets, activatedId);

    expect(activatedId).toBe(originalGroupId);
    expect(correctedId).toBe(activatedId);
  });

  it('appending a genuinely new file never bounces either', () => {
    const file = makeFile('brand-new.mcap');
    const { datasets, activatedId } = simulateAppend([], [file], true, null);
    const correctedId = resolveActiveId(datasets, activatedId);
    expect(correctedId).toBe(activatedId);
  });

  it('repeated replays of the same already-loaded file converge immediately, not after N renders', () => {
    const file = makeFile('episode_00044.mcap');
    let existing: DatasetItem[] = [];
    let activeId: string | null = null;

    // First "open": genuinely new, becomes its own group.
    ({ datasets: existing, activatedId: activeId } = simulateAppend(existing, [file], true, activeId));
    activeId = resolveActiveId(existing, activeId);
    const firstGroupId = activeId;

    // Replaying the same file via history N more times (forceNewSession
    // true every time) must keep resolving back to the same real group
    // instead of drifting to a new orphan id on each pass.
    for (let i = 0; i < 5; i++) {
      const appended = simulateAppend(existing, [file], true, activeId);
      existing = appended.datasets;
      activeId = resolveActiveId(existing, appended.activatedId);
      expect(activeId).toBe(firstGroupId);
    }
  });
});

describe('fileDatasetId', () => {
  it('is stable for the same name/size/lastModified', () => {
    const a = makeFile('a.mcap', 10);
    const b = makeFile('a.mcap', 10);
    expect(fileDatasetId(a)).toBe(fileDatasetId(b));
  });

  it('differs when name, size, or lastModified differ', () => {
    const a = makeFile('a.mcap', 10);
    const b = makeFile('b.mcap', 10);
    const c = makeFile('a.mcap', 20);
    expect(fileDatasetId(a)).not.toBe(fileDatasetId(b));
    expect(fileDatasetId(a)).not.toBe(fileDatasetId(c));
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
