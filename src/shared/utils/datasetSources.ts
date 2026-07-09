/**
 * Unified dataset list for ROSView: local files + remote URLs.
 * Merge order: `files` → `file` → `urls` → `url` (files before URLs).
 */

export type DatasetItem = {
  id: string;
  kind: 'file' | 'url';
  /** Display label (file basename or URL tail) */
  name: string;
  file?: File;
  url?: string;
  /** Optional manifest metadata (remote list or host-injected). */
  sizeBytes?: number;
  durationSec?: number;
  topicCount?: number;
  /** Files opened together, e.g. from a directory. Some formats need sibling files to initialize correctly. */
  siblingFiles?: File[];
  /**
   * Session grouping key. Items sharing the same `groupId` are loaded
   * together as one merged multi-source session (topics/time-range unioned
   * via `CombinedSourceProxy`) instead of being independent switchable
   * datasets. Absent for a standalone item, which is equivalent to a group
   * of one (see `datasetGroupKey`).
   */
  groupId?: string;
};

/** Grouping key for a dataset item: shared by every member of a merged session. */
export function datasetGroupKey(item: DatasetItem): string {
  return item.groupId ?? item.id;
}

export interface DatasetGroup {
  groupId: string;
  members: DatasetItem[];
}

/** Group a flat dataset list by `datasetGroupKey`, preserving first-seen order. */
export function groupDatasets(items: DatasetItem[]): DatasetGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, DatasetItem[]>();
  for (const item of items) {
    const key = datasetGroupKey(item);
    const members = byGroup.get(key);
    if (members) {
      members.push(item);
    } else {
      byGroup.set(key, [item]);
      order.push(key);
    }
  }
  return order.map((groupId) => ({ groupId, members: byGroup.get(groupId)! }));
}

let groupIdCounter = 0;

/** Fresh, unique id for a new merged-session group. */
export function createDatasetGroupId(): string {
  groupIdCounter += 1;
  return `group:${Date.now().toString(36)}:${groupIdCounter}`;
}

/** One row from host `fileManifest` or remote dataset JSON. */
export type FileListItem = {
  url: string;
  name?: string;
  sizeBytes?: number;
  durationSec?: number;
  topicCount?: number;
};

const ROS_EXT = /\.(mcap|bag|db3|hdf5|h5|bvh)$/i;

export function isRosRecordingFilename(name: string): boolean {
  return ROS_EXT.test(name);
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function makeFileDataset(file: File): DatasetItem {
  return {
    id: `file:${fileKey(file)}`,
    kind: 'file',
    name: file.name,
    file,
  };
}

function makeUrlDataset(url: string, sizeBytes?: number): DatasetItem {
  const trimmed = url.trim();
  const name = trimmed.split('/').pop() || trimmed;
  return {
    id: `url:${trimmed}`,
    kind: 'url',
    name,
    url: trimmed,
    ...(typeof sizeBytes === 'number' &&
    Number.isFinite(sizeBytes) &&
    sizeBytes > 0
      ? { sizeBytes: Math.floor(sizeBytes) }
      : {}),
  };
}

export type RosViewSourceProps = {
  file?: File;
  files?: File[];
  url?: string;
  urls?: string[];
  /** Inline manifest rows or JSON URL string (embed via `fileManifest` prop). */
  fileManifest?: string | FileListItem[];
  /**
   * When `true`, every item produced from `file`/`files`/`url`/`urls`/
   * `fileManifest` in this call is assigned one shared `groupId`, so they
   * load as a single merged multi-source session instead of independent
   * switchable datasets. Default `false` preserves the existing "list +
   * switch" behavior for embedders that pass multiple files/urls today.
   * @default false
   */
  mergeSources?: boolean;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null;
}

/** Parse remote JSON array into rows; invalid entries skipped (logged). */
export function parseRemoteDatasetListJson(json: unknown): FileListItem[] {
  if (!Array.isArray(json)) {
    throw new Error('Dataset list JSON must be an array');
  }
  const out: FileListItem[] = [];
  for (const row of json) {
    if (!isRecord(row)) continue;
    const url = row.url;
    if (typeof url !== 'string' || !url.trim()) continue;
    const name = typeof row.name === 'string' ? row.name : undefined;
    const sizeBytes = typeof row.sizeBytes === 'number' ? row.sizeBytes : undefined;
    const durationSec = typeof row.durationSec === 'number' ? row.durationSec : undefined;
    const topicCount = typeof row.topicCount === 'number' ? row.topicCount : undefined;
    out.push({ url: url.trim(), name, sizeBytes, durationSec, topicCount });
  }
  return out;
}

export function datasetItemsFromListItems(items: FileListItem[]): DatasetItem[] {
  return items.map((row, i) => {
    const u = row.url.trim();
    const name = row.name?.trim() || u.split('/').pop() || u;
    return {
      id: `url:${u}:${i}`,
      kind: 'url' as const,
      name,
      url: u,
      sizeBytes: row.sizeBytes,
      durationSec: row.durationSec,
      topicCount: row.topicCount,
    };
  });
}

/**
 * Normalize props into a deduplicated dataset list (files first, then URLs).
 */
export function normalizeRosViewSources(props: RosViewSourceProps): DatasetItem[] {
  const out: DatasetItem[] = [];
  const seenFileKeys = new Set<string>();
  const seenUrls = new Set<string>();

  const pushFile = (file: File | undefined) => {
    if (!file || !isRosRecordingFilename(file.name)) return;
    const key = fileKey(file);
    if (seenFileKeys.has(key)) return;
    seenFileKeys.add(key);
    out.push(makeFileDataset(file));
  };

  const pushUrl = (raw: string | undefined) => {
    if (!raw?.trim()) return;
    const u = raw.trim();
    if (seenUrls.has(u)) return;
    seenUrls.add(u);
    out.push(makeUrlDataset(u));
  };

  for (const f of props.files ?? []) {
    pushFile(f);
  }
  pushFile(props.file);
  for (const u of props.urls ?? []) {
    pushUrl(u);
  }
  pushUrl(props.url);

  if (Array.isArray(props.fileManifest)) {
    const rows = datasetItemsFromListItems(props.fileManifest);
    for (const item of rows) {
      if (seenUrls.has(item.url ?? '')) continue;
      seenUrls.add(item.url ?? '');
      out.push(item);
    }
  }

  if (props.mergeSources && out.length > 1) {
    const groupId = createDatasetGroupId();
    for (const item of out) {
      item.groupId = groupId;
    }
  }

  return out;
}

/** Dedupe by id, keeping first occurrence (caller controls order). */
export function dedupeDatasetItems(items: DatasetItem[]): DatasetItem[] {
  const seen = new Set<string>();
  const out: DatasetItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function mergeDatasetLists(base: DatasetItem[], extra: DatasetItem[]): DatasetItem[] {
  return dedupeDatasetItems([...base, ...extra]);
}

/** Collect ROS files from a directory-style FileList (e.g. webkitdirectory). */
export function filterRosFilesFromFileList(fileList: FileList | File[]): File[] {
  const arr = Array.from(fileList as Iterable<File>);
  return arr.filter((f) => isRosRecordingFilename(f.name));
}
