/**
 * SPA `?url=` datasource locator: remote HTTP(S) / same-origin path, live
 * WebSocket (`ws://` / `wss://` / `foxglove://`), or app-specific `file://` /
 * `folder://` / `sample://` (not the browser's native file: protocol).
 */

import { isLiveWebsocketUrl, normalizeLiveWebsocketUrl } from '@/core/live/liveUrl';
import { resolveBrowserHttpUrl } from '@/shared/utils/resolveBrowserHttpUrl';

export type SourceLocatorRemote = { kind: 'remote'; raw: string; resolvedUrl: string };

export type SourceLocatorWebsocket = { kind: 'websocket'; raw: string; wsUrl: string };

export type SourceLocatorLocalFile = { kind: 'local_file'; displayName: string };

export type SourceLocatorLocalFolder = { kind: 'local_folder'; displayName: string };

export type SourceLocatorSample = { kind: 'sample'; sampleId: string };

export type SourceLocator =
  | SourceLocatorRemote
  | SourceLocatorWebsocket
  | SourceLocatorLocalFile
  | SourceLocatorLocalFolder
  | SourceLocatorSample;

const FILE_PREFIX = /^file:\/\//i;
const FOLDER_PREFIX = /^folder:\/\//i;
const SAMPLE_PREFIX = /^sample:\/\//i;

function stripLeadingSlashes(s: string): string {
  return s.replace(/^\/+/, '');
}

/**
 * Parse `?url=` value into a structured locator.
 * - `file://name` / `folder://name` — local display names (IndexedDB handle replay).
 * - `sample://id` — built-in sample id (resolved via sample manifest at runtime).
 * - `ws://` / `wss://` / `foxglove://` — live Foxglove WebSocket bridge.
 * - Otherwise treated as remote: resolved with {@link resolveBrowserHttpUrl}.
 */
export function parseSourceLocator(raw: string): SourceLocator | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (isLiveWebsocketUrl(trimmed)) {
    return {
      kind: 'websocket',
      raw: trimmed,
      wsUrl: normalizeLiveWebsocketUrl(trimmed),
    };
  }

  if (SAMPLE_PREFIX.test(trimmed)) {
    const rest = stripLeadingSlashes(trimmed.replace(SAMPLE_PREFIX, ''));
    let id: string;
    try {
      id = decodeURIComponent(rest);
    } catch {
      id = rest;
    }
    const sampleId = id.trim();
    if (!sampleId) return null;
    return { kind: 'sample', sampleId };
  }

  if (FILE_PREFIX.test(trimmed)) {
    const rest = stripLeadingSlashes(trimmed.replace(FILE_PREFIX, ''));
    let name: string;
    try {
      name = decodeURIComponent(rest);
    } catch {
      name = rest;
    }
    const displayName = name.trim();
    if (!displayName) return null;
    return { kind: 'local_file', displayName };
  }

  if (FOLDER_PREFIX.test(trimmed)) {
    const rest = stripLeadingSlashes(trimmed.replace(FOLDER_PREFIX, ''));
    let name: string;
    try {
      name = decodeURIComponent(rest);
    } catch {
      name = rest;
    }
    const displayName = name.trim();
    if (!displayName) return null;
    return { kind: 'local_folder', displayName };
  }

  const resolvedUrl = resolveBrowserHttpUrl(trimmed);
  return { kind: 'remote', raw: trimmed, resolvedUrl };
}

/** Safe path segment for `file://` / `folder://` (readable when ASCII). */
function encodeLocalLocatorSegment(displayName: string): string {
  if (/^[\w.+-]+$/.test(displayName)) return displayName;
  return encodeURIComponent(displayName);
}

/** Serialize locator for `?url=` (address bar / share link). */
export function serializeSourceLocator(locator: SourceLocator): string {
  if (locator.kind === 'local_file') {
    return `file://${encodeLocalLocatorSegment(locator.displayName)}`;
  }
  if (locator.kind === 'local_folder') {
    return `folder://${encodeLocalLocatorSegment(locator.displayName)}`;
  }
  if (locator.kind === 'sample') {
    return `sample://${encodeLocalLocatorSegment(locator.sampleId)}`;
  }
  if (locator.kind === 'websocket') {
    return locator.wsUrl;
  }
  return formatRemoteLocatorForAddressBar(locator.resolvedUrl);
}

/**
 * Prefer same-origin relative path for shorter URLs; otherwise absolute URL.
 */
export function formatRemoteLocatorForAddressBar(resolvedUrl: string): string {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return resolvedUrl;
  }
  try {
    const u = new URL(resolvedUrl, window.location.href);
    if (u.origin === window.location.origin) {
      return `${u.pathname}${u.search}`;
    }
    return u.toString();
  } catch {
    return resolvedUrl;
  }
}

/** True if this `url` prop should not be passed to remote URL normalization. */
export function isCustomLocalLocatorString(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  const t = raw.trim();
  return FILE_PREFIX.test(t) || FOLDER_PREFIX.test(t) || SAMPLE_PREFIX.test(t);
}

/** Query keys preserved when rewriting SPA `?url=` (theme / language / debug). */
const SPA_PRESERVED_SEARCH_KEYS = new Set(['theme', 'language', 'lang', 'workerPerf']);

/**
 * Build `?…` for SPA: keep UI keys, set or drop `url`, drop legacy `urls[]` / `list`.
 */
export function mergeSpaSearchForUrlParam(currentSearch: string, nextUrlParam: string | null): string {
  const qs = currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch;
  const prev = new URLSearchParams(qs);
  const out = new URLSearchParams();
  for (const key of SPA_PRESERVED_SEARCH_KEYS) {
    if (!prev.has(key)) continue;
    for (const v of prev.getAll(key)) {
      out.append(key, v);
    }
  }
  if (nextUrlParam) {
    out.set('url', nextUrlParam);
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Append history entry with normalized SPA search (see {@link mergeSpaSearchForUrlParam}). */
export function pushSpaUrlParam(nextUrlParam: string | null): void {
  if (typeof window === 'undefined') return;
  const merged = mergeSpaSearchForUrlParam(window.location.search, nextUrlParam);
  const nextHref = `${window.location.pathname}${merged}`;
  const curHref = `${window.location.pathname}${window.location.search}`;
  if (curHref === nextHref) return;
  window.history.pushState({}, '', nextHref);
}
