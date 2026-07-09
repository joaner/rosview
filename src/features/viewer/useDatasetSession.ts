import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDatasetGroupId,
  datasetItemsFromListItems,
  dedupeDatasetItems,
  fileDatasetId,
  groupDatasets,
  mergeDatasetLists,
  normalizeRosViewSources,
  parseRemoteDatasetListJson,
  resolveActiveId,
  resolveAppendGroupId,
  type DatasetItem,
  type FileListItem,
} from '@/shared/utils/datasetSources';
import { resolveBrowserHttpUrl } from '@/shared/utils/resolveBrowserHttpUrl';
import { isCustomLocalLocatorString } from '@/shared/utils/sourceLocator';
import type { RosViewerProps } from './RosViewer.types';

export interface AppendFilesResult {
  groupId: string;
  /** True when this batch was folded into an already-active group (as opposed to starting a fresh one), and at least one file was genuinely new. */
  merged: boolean;
  /** Dataset ids newly added by this call (excludes files that were already present), for the "switch to replace" undo action. */
  addedItemIds: string[];
}

/**
 * Owns the dataset/session state machine: the flat list of loaded
 * datasets (from props + files/URLs/tar/history opened at runtime), which
 * group (`activeId`) is selected, and `appendFilesAsDatasets` — the single
 * place new files are folded into that list.
 *
 * `appendFilesAsDatasets` reads `activeId` and `datasets` through refs
 * rather than as `useCallback` dependencies, so its identity stays stable
 * no matter how often the session changes. That stability is load-bearing:
 * this hook (and callers built on it, e.g. `useSpaUrlBootstrap` /
 * `useRecordingSourceActions`) previously caused a production incident
 * where an unstable append callback in an Effect's dependency array
 * self-triggered repeated history replays, tearing the player down and
 * rebuilding it in a tight loop (visible as UI flicker and eventual tab
 * crashes). See `resolveAppendGroupId` / `resolveActiveId` in
 * `datasetSources.ts` for the other half of that fix.
 */
export function useDatasetSession(
  props: RosViewerProps,
  urlState: 'spa' | 'off',
  propSig: string,
  clearOpenFeedback: () => void,
  setManualOpenHint: (hint: string | null) => void,
) {
  const fromProps = useMemo(
    () =>
      normalizeRosViewSources({
        file: props.file,
        files: props.files,
        url: isCustomLocalLocatorString(props.url) ? undefined : props.url,
        urls: urlState === 'spa' ? undefined : props.urls,
        fileManifest: Array.isArray(props.fileManifest) ? props.fileManifest : undefined,
        mergeSources: props.mergeSources,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- propSig fingerprints File identity and source props
    [propSig, urlState],
  );

  const [extraDatasets, setExtraDatasets] = useState<DatasetItem[]>([]);

  useEffect(() => {
    const targets: string[] = [];
    if (typeof props.fileManifest === 'string' && props.fileManifest.trim()) {
      targets.push(resolveBrowserHttpUrl(props.fileManifest.trim()));
    }
    if (targets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const merged: FileListItem[] = [];
      for (const t of targets) {
        try {
          const res = await fetch(t);
          if (!res.ok) {
            console.warn('[RosViewer] dataset list HTTP', res.status, t);
            continue;
          }
          const json: unknown = await res.json();
          merged.push(...parseRemoteDatasetListJson(json));
        } catch (e) {
          console.warn('[RosViewer] dataset list fetch failed', t, e);
        }
      }
      if (cancelled || merged.length === 0) return;
      setExtraDatasets((prev) => mergeDatasetLists(prev, datasetItemsFromListItems(merged)));
    })();
    return () => {
      cancelled = true;
    };
  }, [propSig, props.fileManifest]);

  const datasets = useMemo(() => mergeDatasetLists(fromProps, extraDatasets), [fromProps, extraDatasets]);

  const datasetsRef = useRef(datasets);
  // eslint-disable-next-line react-hooks/refs -- sync latest datasets for async player init
  datasetsRef.current = datasets;

  /** Holds a group key (see `datasetGroupKey`); a standalone dataset is a group of one. */
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef(activeId);
  // eslint-disable-next-line react-hooks/refs -- read latest activeId in callbacks without churning their identity
  activeIdRef.current = activeId;
  /** When fallback loads a non-selected group, highlights it in the sidebar without re-running the activeId load effect. */
  const [loadedGroupId, setLoadedGroupId] = useState<string | null>(null);

  useEffect(() => {
    setExtraDatasets([]);
    setLoadedGroupId(null);
    setManualOpenHint(null);
  }, [propSig, setManualOpenHint]);

  const groups = useMemo(() => groupDatasets(datasets), [datasets]);

  useEffect(() => {
    setActiveId((prev) => resolveActiveId(datasets, prev));
  }, [datasets]);

  /** Members of the group the load effect targets, stable while unrelated datasets change. */
  const activeGroupMembersKey = useMemo(() => {
    const resolvedGroupId = loadedGroupId ?? activeId;
    const group = groups.find((g) => g.groupId === resolvedGroupId);
    return group ? group.members.map((m) => m.id).join('\u0000') : '';
  }, [groups, loadedGroupId, activeId]);

  const resolvedDatasetId = loadedGroupId ?? activeId;
  const activeGroup = useMemo(
    () => (resolvedDatasetId ? groups.find((g) => g.groupId === resolvedDatasetId) ?? null : null),
    [groups, resolvedDatasetId],
  );
  const activeDataset = activeGroup?.members[0] ?? null;

  const loadingSourceName = activeGroup
    ? activeGroup.members.length > 1
      ? `${activeGroup.members[0].name} +${String(activeGroup.members.length - 1)}`
      : activeDataset?.kind === 'url'
        ? activeDataset.url
        : activeDataset?.file?.name
    : undefined;
  const effectiveSourceName = props.navbarSourceName ?? loadingSourceName;

  const hasSource = datasets.length > 0;

  const fileInputDomIdRef = useRef('rosview-landing-file');
  const tarInputDomIdRef = useRef('rosview-landing-tar');
  useEffect(() => {
    fileInputDomIdRef.current = hasSource ? 'rosview-inline-file' : 'rosview-landing-file';
    tarInputDomIdRef.current = hasSource ? 'rosview-inline-tar' : 'rosview-landing-tar';
  }, [hasSource]);

  const appendFilesAsDatasets = useCallback(
    (files: File[], focusFirstNew = true, groupFiles?: File[], forceNewSession = false): AppendFilesResult => {
      const siblingFiles = groupFiles && groupFiles.length > 1 ? [...groupFiles] : undefined;
      const activeId = activeIdRef.current;
      const currentDatasets = datasetsRef.current;
      // Default behavior: new recording files merge into whatever session is
      // currently active (topics/time-range union), matching the common
      // "open base recording, later add an incrementally-produced file"
      // workflow. When nothing is active yet, the whole batch becomes one
      // fresh session together. `forceNewSession` opts out (used by
      // tar-archive extraction and history replay, which represent opening a
      // self-contained recording bundle rather than adding to the workspace).
      const currentGroups = groupDatasets(currentDatasets);
      const hasActiveGroup =
        !forceNewSession && activeId != null && currentGroups.some((g) => g.groupId === activeId);
      // If this batch is already loaded under some group (e.g. reopening the
      // same recording via a remembered file-handle from history), reuse that
      // group instead of minting a fresh id — see `resolveAppendGroupId` for
      // why a fresh id would otherwise leave `activeId` pointed at an "orphan"
      // group, causing flicker / repeated worker re-init.
      const groupId = hasActiveGroup
        ? activeId
        : resolveAppendGroupId(currentDatasets, files, createDatasetGroupId());
      const items = dedupeDatasetItems(
        files.map((f) => ({
          id: fileDatasetId(f),
          kind: 'file' as const,
          name: f.name,
          file: f,
          groupId,
          ...(siblingFiles ? { siblingFiles } : {}),
        })),
      );
      const existingIds = new Set(currentDatasets.map((d) => d.id));
      const addedItemIds = items.filter((i) => !existingIds.has(i.id)).map((i) => i.id);
      setExtraDatasets((prev) => mergeDatasetLists(prev, items));
      if (items.length > 0 && focusFirstNew) {
        setActiveId(groupId);
        setLoadedGroupId(null);
        clearOpenFeedback();
      } else if (items.length > 0) {
        setLoadedGroupId(null);
        clearOpenFeedback();
      }
      return { groupId, merged: hasActiveGroup && addedItemIds.length > 0, addedItemIds };
    },
    [clearOpenFeedback],
  );

  return {
    datasets,
    datasetsRef,
    setExtraDatasets,
    activeId,
    setActiveId,
    loadedGroupId,
    setLoadedGroupId,
    groups,
    activeGroupMembersKey,
    resolvedDatasetId,
    activeGroup,
    activeDataset,
    loadingSourceName,
    effectiveSourceName,
    hasSource,
    fileInputDomIdRef,
    tarInputDomIdRef,
    appendFilesAsDatasets,
  };
}
