/**
 * Foxglove layout JSON <-> DockView conversion.
 *
 * Foxglove shape (see `@foxglove/studio-base/util/layout.ts`):
 *   {
 *     layout?: MosaicNode<PanelId>,
 *     configById: Record<PanelId, PanelConfig>,
 *     globalVariables: Record<string, unknown>,
 *     userNodes: Record<string, unknown>,
 *     playbackConfig?: {...},
 *     version?: number,
 *   }
 *
 * DockView serialization is an N-ary grid with implicit alternating
 * orientation. This module is intentionally decoupled from React/DockView
 * runtime so it can be unit-tested in isolation.
 */

import type { DockviewApi } from 'dockview';
import type {
  FoxgloveConfig,
  PanelInstanceSnapshot,
} from '@/features/panels/framework';
import {
  FOXGLOVE_PANEL_TITLE_KEY,
  getPanelTypeFromId,
} from '@/features/panels/framework';
import {
  getFoxgloveAdapter,
  getPanelDefinition,
  hasFoxgloveAdapter,
} from '@/features/panels/registry';

// ---------- Foxglove wire types ----------

export type FoxgloveMosaicDirection = 'row' | 'column';

export type FoxgloveMosaicNode =
  | string
  | {
      first: FoxgloveMosaicNode;
      second: FoxgloveMosaicNode;
      direction: FoxgloveMosaicDirection;
      splitPercentage?: number;
    };

export interface FoxgloveTabGroupSnapshot {
  activePanelId?: string;
  panelIds: string[];
}

export interface FoxgloveLayoutData {
  layout?: FoxgloveMosaicNode;
  configById: Record<string, FoxgloveConfig>;
  globalVariables: Record<string, unknown>;
  userNodes: Record<string, unknown>;
  playbackConfig?: Record<string, unknown>;
  version?: number;
  /** Private field used by this product to round-trip DockView tab groups. */
  __embodiflow?: {
    tabGroups?: Record<string, FoxgloveTabGroupSnapshot>;
  };
}

// ---------- DockView serialization types (locally typed for safety) ----------

type DockviewOrientation = 'HORIZONTAL' | 'VERTICAL';

interface DockviewLeafData {
  id: string;
  views: string[];
  activeView?: string;
}

interface DockviewSerializedLeaf {
  type: 'leaf';
  data: DockviewLeafData;
  size?: number;
}

interface DockviewSerializedBranch {
  type: 'branch';
  data: DockviewSerializedNode[];
  size?: number;
}

type DockviewSerializedNode = DockviewSerializedLeaf | DockviewSerializedBranch;

interface DockviewSerializedPanel {
  id: string;
  contentComponent?: string;
  tabComponent?: string;
  title?: string;
  params?: Record<string, unknown>;
}

interface DockviewSerializedState {
  grid: {
    root: DockviewSerializedNode;
    height: number;
    width: number;
    orientation: DockviewOrientation;
  };
  panels: Record<string, DockviewSerializedPanel>;
  activeGroup?: string;
}

// ---------- Helpers ----------

function orthogonal(orientation: DockviewOrientation): DockviewOrientation {
  return orientation === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
}

function orientationToDirection(orientation: DockviewOrientation): FoxgloveMosaicDirection {
  return orientation === 'HORIZONTAL' ? 'row' : 'column';
}

function directionToOrientation(direction: FoxgloveMosaicDirection): DockviewOrientation {
  return direction === 'row' ? 'HORIZONTAL' : 'VERTICAL';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

function randomGroupId(): string {
  return Math.round(Math.random() * 1e10).toString(36);
}

// ---------- Parse/validate Foxglove layout JSON ----------

/**
 * Validate and normalize an arbitrary JSON value to the Foxglove layout
 * shape. Returns null when the value is clearly not a layout (not an object,
 * or missing both `layout` and `configById`).
 */
export function parseFoxgloveLayout(raw: unknown): FoxgloveLayoutData | null {
  if (!isRecord(raw)) {
    return null;
  }
  const hasLayout = 'layout' in raw;
  const hasConfigById = isRecord(raw.configById);
  if (!hasLayout && !hasConfigById) {
    return null;
  }
  const configById: Record<string, FoxgloveConfig> = {};
  if (hasConfigById) {
    for (const [key, value] of Object.entries(raw.configById as Record<string, unknown>)) {
      if (isRecord(value)) {
        configById[key] = value;
      }
    }
  }
  const layout = normalizeMosaic(raw.layout);
  const globalVariables = isRecord(raw.globalVariables)
    ? (raw.globalVariables)
    : {};
  const userNodes = isRecord(raw.userNodes)
    ? (raw.userNodes)
    : {};
  const playbackConfig = isRecord(raw.playbackConfig)
    ? (raw.playbackConfig)
    : undefined;
  const version = typeof raw.version === 'number' ? raw.version : undefined;
  const embodiflow = isRecord(raw.__embodiflow)
    ? (raw.__embodiflow)
    : undefined;
  const tabGroupsRaw = embodiflow && isRecord(embodiflow.tabGroups) ? embodiflow.tabGroups : undefined;
  const tabGroups = tabGroupsRaw ? parseTabGroups(tabGroupsRaw) : undefined;

  return {
    layout,
    configById,
    globalVariables,
    userNodes,
    playbackConfig,
    version,
    __embodiflow: tabGroups ? { tabGroups } : undefined,
  };
}

function parseTabGroups(raw: Record<string, unknown>): Record<string, FoxgloveTabGroupSnapshot> {
  const out: Record<string, FoxgloveTabGroupSnapshot> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const panelIds = Array.isArray(value.panelIds)
      ? value.panelIds.filter((id): id is string => typeof id === 'string')
      : [];
    if (panelIds.length === 0) continue;
    out[key] = {
      activePanelId: typeof value.activePanelId === 'string' ? value.activePanelId : undefined,
      panelIds,
    };
  }
  return out;
}

function normalizeMosaic(value: unknown): FoxgloveMosaicNode | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const first = normalizeMosaic(value.first);
  const second = normalizeMosaic(value.second);
  if (first == null || second == null) {
    return first ?? second;
  }
  const direction: FoxgloveMosaicDirection = value.direction === 'column' ? 'column' : 'row';
  const splitPercentage =
    typeof value.splitPercentage === 'number' && Number.isFinite(value.splitPercentage)
      ? clamp(value.splitPercentage, 1, 99)
      : undefined;
  return { first, second, direction, ...(splitPercentage != null ? { splitPercentage } : {}) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------- Mosaic -> DockView ----------

/**
 * Collect every panel id referenced by a Mosaic tree (in traversal order).
 */
export function collectMosaicPanelIds(node: FoxgloveMosaicNode | undefined): string[] {
  if (!node) return [];
  if (typeof node === 'string') return [node];
  return [...collectMosaicPanelIds(node.first), ...collectMosaicPanelIds(node.second)];
}

export interface MosaicToDockviewInput {
  mosaic: FoxgloveMosaicNode;
  /** Map from panel id -> serialized panel entry. Caller provides component/params/title. */
  panels: Record<string, DockviewSerializedPanel>;
  /**
   * Optional: pre-parsed tab-group info captured in the prior export. When
   * provided, panels that share a `groupId` are placed in the same DockView
   * group so tab grouping is preserved.
   */
  tabGroups?: Record<string, FoxgloveTabGroupSnapshot>;
}

/**
 * Convert a Foxglove Mosaic layout into a DockView `SerializedDockview`
 * payload that can be fed to `DockviewApi.fromJSON`.
 */
export function mosaicToDockviewGrid(input: MosaicToDockviewInput): DockviewSerializedState {
  const rootDirection = typeof input.mosaic === 'string' ? 'row' : input.mosaic.direction;
  const rootOrientation = directionToOrientation(rootDirection);

  // panelId -> groupId; filled in on the fly so multiple panels within the
  // same tab group share the same DockView group.
  const panelIdToGroup = new Map<string, string>();
  if (input.tabGroups) {
    for (const [groupId, snapshot] of Object.entries(input.tabGroups)) {
      for (const panelId of snapshot.panelIds) {
        panelIdToGroup.set(panelId, groupId);
      }
    }
  }

  // A leaf in Mosaic maps to either a single-panel group or, when multiple
  // adjacent sibling leaves share a tabGroup, folds into one shared group.
  // For simplicity we emit one leaf per id here; when tab groups are present
  // we dedupe leaves that map to the same group id before folding.
  const groupActive = new Map<string, string>();
  if (input.tabGroups) {
    for (const [groupId, snapshot] of Object.entries(input.tabGroups)) {
      if (snapshot.activePanelId) {
        groupActive.set(groupId, snapshot.activePanelId);
      }
    }
  }

  function leafForPanel(panelId: string): DockviewSerializedLeaf {
    const groupId = panelIdToGroup.get(panelId) ?? `group-${randomGroupId()}`;
    // When imported as a fresh layout, every panel gets its own DockView
    // group. Later `restoreTabGroups` (runtime-only) merges them using api.moveGroup.
    const views = [panelId];
    const active = groupActive.get(groupId) ?? panelId;
    return {
      type: 'leaf',
      size: 1,
      data: {
        id: groupId,
        views,
        activeView: active,
      },
    };
  }

  function convert(
    node: FoxgloveMosaicNode,
    expectedOrientation: DockviewOrientation,
  ): DockviewSerializedNode {
    if (typeof node === 'string') {
      return leafForPanel(node);
    }
    const nodeOrientation = directionToOrientation(node.direction);
    const [firstSize, secondSize] = computeSizes(node.splitPercentage ?? 50);

    // Build children with expected orientation (orthogonal to current node).
    const firstChild = convert(node.first, orthogonal(nodeOrientation));
    const secondChild = convert(node.second, orthogonal(nodeOrientation));
    firstChild.size = firstSize;
    secondChild.size = secondSize;

    const branch: DockviewSerializedBranch = {
      type: 'branch',
      data: [firstChild, secondChild],
      size: 1,
    };

    if (nodeOrientation === expectedOrientation) {
      return branch;
    }
    // Non-alternating: wrap in an orthogonal single-child branch so DockView's
    // implicit alternation still renders the intended orientation.
    return {
      type: 'branch',
      data: [branch],
      size: 1,
    };
  }

  const converted = convert(input.mosaic, rootOrientation);
  // Dockview requires `grid.root` to be a branch. A single-panel mosaic produces
  // a `leaf` root, which makes `DockviewApi.fromJSON` throw "root must be of type
  // branch". Wrap it in a 1-child branch — `dockviewGridToMosaic` already
  // unwraps single-child branches, so the round-trip is preserved.
  const root: DockviewSerializedNode =
    converted.type === 'leaf'
      ? { type: 'branch', data: [converted], size: 1 }
      : converted;
  const firstGroupId = findFirstLeafGroupId(root);

  return {
    grid: {
      root,
      height: 1000,
      width: 1000,
      orientation: rootOrientation,
    },
    panels: input.panels,
    activeGroup: firstGroupId,
  };
}

function computeSizes(splitPercentage: number): [number, number] {
  const pct = Number.isFinite(splitPercentage) ? clamp(splitPercentage, 1, 99) : 50;
  return [pct / 100, 1 - pct / 100];
}

function findFirstLeafGroupId(node: DockviewSerializedNode): string | undefined {
  if (node.type === 'leaf') {
    return node.data.id;
  }
  for (const child of node.data) {
    const match = findFirstLeafGroupId(child);
    if (match) return match;
  }
  return undefined;
}

// ---------- DockView -> Mosaic ----------

export interface DockviewToMosaicResult {
  mosaic?: FoxgloveMosaicNode;
  tabGroups: Record<string, FoxgloveTabGroupSnapshot>;
}

/**
 * Convert a DockView serialized state into a Foxglove Mosaic layout.
 * Tab groups are flattened: each additional view in a group becomes a
 * sibling panel along the parent's orthogonal direction. The original
 * grouping is preserved in `tabGroups` for round-trip.
 *
 * `ignoreIds` is used to drop panels that do not belong in the Foxglove
 * output (e.g. the local welcome placeholder).
 */
export function dockviewGridToMosaic(
  state: DockviewSerializedState,
  ignoreIds: ReadonlySet<string> = new Set(),
): DockviewToMosaicResult {
  const tabGroups: Record<string, FoxgloveTabGroupSnapshot> = {};

  function convertLeaf(
    leaf: DockviewSerializedLeaf,
    parentOrientation: DockviewOrientation,
  ): FoxgloveMosaicNode | undefined {
    const filtered = leaf.data.views.filter((id) => !ignoreIds.has(id));
    if (filtered.length === 0) return undefined;
    if (filtered.length > 1) {
      tabGroups[leaf.data.id] = {
        activePanelId: leaf.data.activeView,
        panelIds: filtered,
      };
    }
    if (filtered.length === 1) {
      return filtered[0];
    }
    return buildBalancedBinary(filtered, orientationToDirection(orthogonal(parentOrientation)));
  }

  function convert(
    node: DockviewSerializedNode,
    currentOrientation: DockviewOrientation,
  ): FoxgloveMosaicNode | undefined {
    if (node.type === 'leaf') {
      return convertLeaf(node, currentOrientation);
    }
    // Branch: children are laid out along currentOrientation.
    const childOrientation = orthogonal(currentOrientation);
    const childResults: { mosaic: FoxgloveMosaicNode; size: number }[] = [];
    for (const child of node.data) {
      const converted = convert(child, childOrientation);
      if (converted != null) {
        childResults.push({ mosaic: converted, size: child.size ?? 1 });
      }
    }
    if (childResults.length === 0) return undefined;
    if (childResults.length === 1) return childResults[0].mosaic;

    const direction = orientationToDirection(currentOrientation);
    return foldChildrenWithSizes(childResults, direction);
  }

  const mosaic = convert(state.grid.root, state.grid.orientation);
  return { mosaic, tabGroups };
}

function buildBalancedBinary(
  ids: string[],
  direction: FoxgloveMosaicDirection,
): FoxgloveMosaicNode {
  if (ids.length === 1) return ids[0];
  // Left-associative fold keeps it simple and deterministic.
  let acc: FoxgloveMosaicNode = ids[0];
  for (let i = 1; i < ids.length; i += 1) {
    acc = {
      first: acc,
      second: ids[i],
      direction,
      splitPercentage: (100 * i) / (i + 1),
    };
  }
  return acc;
}

function foldChildrenWithSizes(
  children: { mosaic: FoxgloveMosaicNode; size: number }[],
  direction: FoxgloveMosaicDirection,
): FoxgloveMosaicNode {
  if (children.length === 1) return children[0].mosaic;
  let acc: FoxgloveMosaicNode = children[0].mosaic;
  let sizeSoFar = children[0].size;
  for (let i = 1; i < children.length; i += 1) {
    const { mosaic, size } = children[i];
    const total = sizeSoFar + size;
    const splitPercentage = total > 0 ? clamp((sizeSoFar / total) * 100, 1, 99) : 50;
    acc = {
      first: acc,
      second: mosaic,
      direction,
      splitPercentage,
    };
    sizeSoFar = total;
  }
  return acc;
}

// ---------- buildFoxgloveLayout: high-level DockView export ----------

/**
 * Inputs required by `buildFoxgloveLayout`. Accepts a narrowed subset of
 * `DockviewApi` so the function is easy to test.
 */
export interface BuildFoxgloveLayoutInput {
  apiState: DockviewSerializedState;
  panels: Record<string, PanelInstanceSnapshot>;
  /** Panels that exist in DockView but should not appear in the Foxglove JSON. */
  ignoreIds?: ReadonlySet<string>;
  globalVariables?: Record<string, unknown>;
  userNodes?: Record<string, unknown>;
}

/**
 * Build a Foxglove-compatible LayoutData from the current DockView state
 * plus our runtime panel-state registry.
 */
export function buildFoxgloveLayout(input: BuildFoxgloveLayoutInput): FoxgloveLayoutData {
  const ignore = input.ignoreIds ?? new Set<string>();
  const { mosaic, tabGroups } = dockviewGridToMosaic(input.apiState, ignore);

  const configById: Record<string, FoxgloveConfig> = {};
  for (const [panelId, snapshot] of Object.entries(input.panels)) {
    if (ignore.has(panelId)) continue;
    const foxgloveType = snapshot.foxgloveType ?? getPanelTypeFromId(panelId);
    const adapter = getFoxgloveAdapter(foxgloveType);
    configById[panelId] = adapter.toConfig({
      config: snapshot.config,
      extras: snapshot.extras,
      title: snapshot.title,
    });
  }

  return {
    layout: mosaic,
    configById,
    globalVariables: input.globalVariables ?? {},
    userNodes: input.userNodes ?? {},
    __embodiflow:
      Object.keys(tabGroups).length > 0 ? { tabGroups } : undefined,
  };
}

// ---------- importFoxgloveLayout: decode -> DockView + panel state ----------

export interface ImportFoxgloveLayoutResult {
  /** Normalized panel snapshots keyed by id, ready to feed `replacePanelStates`. */
  panelStates: Record<string, PanelInstanceSnapshot>;
  /**
   * DockView serialized state ready for `api.fromJSON`. Undefined when the
   * input had no `layout` (shouldn't normally happen; caller can fall back
   * to ad-hoc panel placement).
   */
  dockviewState?: DockviewSerializedState;
  tabGroups: Record<string, FoxgloveTabGroupSnapshot>;
  /** Count of successfully restored panels whose type we recognize. */
  restored: number;
  /** Count of panels that degraded to `Unavailable`. */
  degraded: number;
  /** Count of entries skipped (panel referenced by layout but missing from configById, or invalid). */
  skipped: number;
}

export interface ImportFoxgloveLayoutOptions {
  /**
   * DockView panel component name used for panels whose type is degraded to
   * `Unavailable`. When omitted, falls back to `'Unavailable'`.
   */
  unavailableComponent?: string;
}

/**
 * Decode a parsed Foxglove layout into everything needed to hydrate the
 * runtime: panel state snapshots, tab-group metadata, and the DockView
 * serialized payload.
 */
export function importFoxgloveLayout(
  parsed: FoxgloveLayoutData,
  options: ImportFoxgloveLayoutOptions = {},
): ImportFoxgloveLayoutResult {
  const panelStates: Record<string, PanelInstanceSnapshot> = {};
  let restored = 0;
  let degraded = 0;
  let skipped = 0;

  // Collect all ids referenced by both the layout tree and the configById
  // map; the layout tree is authoritative for what's rendered, but configById
  // may carry panels that are momentarily detached.
  const layoutIds = collectMosaicPanelIds(parsed.layout);
  const idSet = new Set<string>([...layoutIds, ...Object.keys(parsed.configById)]);

  const serializedPanels: Record<string, DockviewSerializedPanel> = {};

  for (const panelId of idSet) {
    const foxgloveType = getPanelTypeFromId(panelId);
    const config = parsed.configById[panelId] ?? {};
    if (!hasFoxgloveAdapter(foxgloveType)) {
      // Degrade to Unavailable but keep the original config verbatim in extras.
      const adapter = getFoxgloveAdapter(foxgloveType);
      const decoded = adapter.fromConfig(config);
      const definition = getPanelDefinition('Unavailable');
      const unavailableConfig = definition.configSchema.parse({
        originalType: foxgloveType,
        reason: `Panel type "${foxgloveType}" is not available in current build.`,
      });
      const title =
        decoded.title ??
        (typeof config[FOXGLOVE_PANEL_TITLE_KEY] === 'string'
          ? (config[FOXGLOVE_PANEL_TITLE_KEY])
          : `${foxgloveType} (unavailable)`);
      panelStates[panelId] = {
        id: panelId,
        type: 'Unavailable',
        title,
        config: unavailableConfig,
        configVersion: definition.configSchema.version,
        foxgloveType,
        extras: decoded.extras,
      };
      degraded += 1;
      serializedPanels[panelId] = {
        id: panelId,
        contentComponent: options.unavailableComponent ?? 'Unavailable',
        tabComponent: 'default',
        title,
        params: unavailableConfig as Record<string, unknown>,
      };
      continue;
    }

    const adapter = getFoxgloveAdapter(foxgloveType);
    const decoded = adapter.fromConfig(config);
    const definition = getPanelDefinition(adapter.internalType);
    const parsedConfig = definition.configSchema.parse(decoded.config);
    const title = decoded.title ?? definition.defaultTitle;
    panelStates[panelId] = {
      id: panelId,
      type: adapter.internalType,
      title,
      config: parsedConfig,
      configVersion: definition.configSchema.version,
      // Preserve original Foxglove type iff the id prefix's type differs
      // from our internal type (e.g. `Canvas!xxx` -> internal `Image`).
      foxgloveType:
        foxgloveType !== adapter.internalType ? foxgloveType : undefined,
      extras: decoded.extras,
    };
    restored += 1;
    if (
      adapter.internalType === 'JointStatePlot'
      || foxgloveType === 'JointStatePlot'
      || foxgloveType === 'Joints'
    ) {
      console.warn(
        `[rosview] Layout panel "${panelId}" uses deprecated JointStatePlot and will stop working in a future version. ` +
        'Please migrate to the Plot panel for joint state visualization.',
      );
    }
    serializedPanels[panelId] = {
      id: panelId,
      contentComponent: adapter.internalType,
      tabComponent: 'default',
      title,
      params: parsedConfig as Record<string, unknown>,
    };
  }

  if (parsed.layout == null) {
    return {
      panelStates,
      tabGroups: parsed.__embodiflow?.tabGroups ?? {},
      restored,
      degraded,
      skipped,
    };
  }

  // Drop any layout ids that we failed to turn into a panel state (shouldn't
  // happen given the loop above, but guard anyway).
  const retainedLayout = pruneMosaic(parsed.layout, (id) => id in serializedPanels);
  if (!retainedLayout) {
    skipped = layoutIds.length;
    return {
      panelStates,
      tabGroups: parsed.__embodiflow?.tabGroups ?? {},
      restored,
      degraded,
      skipped,
    };
  }

  const dockviewState = mosaicToDockviewGrid({
    mosaic: retainedLayout,
    panels: serializedPanels,
    tabGroups: parsed.__embodiflow?.tabGroups,
  });

  return {
    panelStates,
    dockviewState,
    tabGroups: parsed.__embodiflow?.tabGroups ?? {},
    restored,
    degraded,
    skipped,
  };
}

function pruneMosaic(
  node: FoxgloveMosaicNode,
  isAllowed: (id: string) => boolean,
): FoxgloveMosaicNode | undefined {
  if (typeof node === 'string') {
    return isAllowed(node) ? node : undefined;
  }
  const first = pruneMosaic(node.first, isAllowed);
  const second = pruneMosaic(node.second, isAllowed);
  if (first && second) {
    return { ...node, first, second };
  }
  return first ?? second;
}

// ---------- DockView runtime helper: serialize api ----------

/** Type-narrowed view of `DockviewApi.toJSON()` for this module. */
export function serializeDockviewApi(api: DockviewApi): DockviewSerializedState {
  return api.toJSON() as unknown as DockviewSerializedState;
}

/**
 * Move panels that share a Foxglove tab group into the same DockView group.
 * Call AFTER `api.fromJSON(dockviewState)` has laid out the initial panels
 * (one-per-group). Silently ignores groups whose panels do not exist.
 */
export function restoreTabGroups(
  api: DockviewApi,
  tabGroups: Record<string, FoxgloveTabGroupSnapshot>,
): void {
  for (const snapshot of Object.values(tabGroups)) {
    const [first, ...rest] = snapshot.panelIds;
    if (!first || rest.length === 0) continue;
    const anchor = api.getPanel(first);
    if (!anchor) continue;
    for (const panelId of rest) {
      const panel = api.getPanel(panelId);
      if (!panel) continue;
      try {
        panel.api.moveTo({ group: anchor.group });
      } catch (error) {
        console.warn('[foxgloveLayout] Failed to restore tab group for', panelId, error);
      }
    }
    if (snapshot.activePanelId) {
      const active = api.getPanel(snapshot.activePanelId);
      active?.api.setActive();
    }
  }
}
