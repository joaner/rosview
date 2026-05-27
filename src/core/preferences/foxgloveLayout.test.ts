import { describe, expect, it } from 'vitest';
import agibotLikeRaw from '../../../test-fixtures/layouts/agibot-like.json';
import multiCanvasRaw from '../../../test-fixtures/layouts/multi-canvas.json';
import {
  buildFoxgloveLayout,
  collectMosaicPanelIds,
  dockviewGridToMosaic,
  importFoxgloveLayout,
  mosaicToDockviewGrid,
  parseFoxgloveLayout,
  type FoxgloveLayoutData,
  type FoxgloveMosaicNode,
} from './foxgloveLayout';

/**
 * Committed Foxglove layout fixtures (test-fixtures/layouts/). Each sample is
 * walked through import -> export and we verify that:
 * - Panel ids and topology survive the round-trip.
 * - Unknown panel config fields (e.g. 3D.cameraState) are preserved verbatim
 *   in the re-exported `configById` via the per-panel extras.
 * - Canvas ids round-trip back to Canvas type (not Image).
 */

function parseFixture(raw: unknown): FoxgloveLayoutData {
  const parsed = parseFoxgloveLayout(raw);
  if (parsed == null) {
    throw new Error('Invalid layout fixture');
  }
  return parsed;
}

const sampleAgibot = parseFixture(agibotLikeRaw);
const sampleStudio = parseFixture(multiCanvasRaw);

function getAllMosaicLeaves(node: FoxgloveMosaicNode): string[] {
  return collectMosaicPanelIds(node);
}

describe('foxgloveLayout parse/normalize', () => {
  it('returns null for non-layout inputs', () => {
    expect(parseFoxgloveLayout(null)).toBeNull();
    expect(parseFoxgloveLayout(42)).toBeNull();
    expect(parseFoxgloveLayout({})).toBeNull();
    expect(parseFoxgloveLayout({ foo: 'bar' })).toBeNull();
  });

  it('accepts layouts with only configById', () => {
    const parsed = parseFoxgloveLayout({
      configById: { 'Plot!abc': { paths: [] } },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.configById['Plot!abc']).toBeDefined();
    expect(parsed?.layout).toBeUndefined();
  });

  it('normalizes splitPercentage to a clamped number', () => {
    const parsed = parseFoxgloveLayout({
      layout: { first: '3D!a', second: '3D!b', direction: 'row', splitPercentage: 200 },
      configById: {},
    });
    expect(parsed).not.toBeNull();
    const layout = parsed!.layout;
    expect(typeof layout === 'object' && layout).toBeTruthy();
    if (typeof layout !== 'string' && layout) {
      expect(layout.splitPercentage).toBeLessThanOrEqual(99);
    }
  });
});

describe('mosaicToDockviewGrid', () => {
  it('converts a simple binary tree with alternating directions', () => {
    const layout: FoxgloveMosaicNode = {
      first: '3D!a',
      second: '3D!b',
      direction: 'row',
      splitPercentage: 40,
    };
    const state = mosaicToDockviewGrid({
      mosaic: layout,
      panels: {
        '3D!a': { id: '3D!a', contentComponent: '3D' },
        '3D!b': { id: '3D!b', contentComponent: '3D' },
      },
    });
    expect(state.grid.orientation).toBe('HORIZONTAL');
    expect(state.grid.root.type).toBe('branch');
    if (state.grid.root.type === 'branch') {
      expect(state.grid.root.data).toHaveLength(2);
      const [left, right] = state.grid.root.data;
      expect(left.type).toBe('leaf');
      expect(right.type).toBe('leaf');
      expect(Math.abs((left.size ?? 0) - 0.4) < 1e-6).toBe(true);
      expect(Math.abs((right.size ?? 0) - 0.6) < 1e-6).toBe(true);
    }
  });

  it('wraps non-alternating nested branches in an orthogonal envelope', () => {
    // Both levels use direction=row, which in DockView cannot be consecutive.
    const layout: FoxgloveMosaicNode = {
      first: {
        first: '3D!x',
        second: '3D!y',
        direction: 'row',
      },
      second: '3D!z',
      direction: 'row',
    };
    const state = mosaicToDockviewGrid({
      mosaic: layout,
      panels: {
        '3D!x': { id: '3D!x', contentComponent: '3D' },
        '3D!y': { id: '3D!y', contentComponent: '3D' },
        '3D!z': { id: '3D!z', contentComponent: '3D' },
      },
    });
    // The root is row, children depth-1 must effectively be row-oriented
    // which in DockView's alternating grid requires a depth-2 wrap for the
    // first child's inner branch.
    expect(state.grid.root.type).toBe('branch');
  });
});

describe('dockviewGridToMosaic (round-trip)', () => {
  it('round-trips a 3-panel column/row layout without losing ids', () => {
    const layout: FoxgloveMosaicNode = {
      first: '3D!a',
      second: {
        first: '3D!b',
        second: '3D!c',
        direction: 'row',
        splitPercentage: 50,
      },
      direction: 'column',
      splitPercentage: 30,
    };
    const state = mosaicToDockviewGrid({
      mosaic: layout,
      panels: {
        '3D!a': { id: '3D!a', contentComponent: '3D' },
        '3D!b': { id: '3D!b', contentComponent: '3D' },
        '3D!c': { id: '3D!c', contentComponent: '3D' },
      },
    });
    const { mosaic } = dockviewGridToMosaic(state);
    expect(mosaic).toBeDefined();
    expect(getAllMosaicLeaves(mosaic!).sort()).toEqual(['3D!a', '3D!b', '3D!c']);
  });

  it('flattens a tab group (multi-view leaf) and records it in tabGroups', () => {
    const state = {
      grid: {
        root: {
          type: 'leaf' as const,
          size: 1,
          data: {
            id: 'group-1',
            views: ['Image!one', 'Image!two', 'Image!three'],
            activeView: 'Image!two',
          },
        },
        width: 1000,
        height: 1000,
        orientation: 'HORIZONTAL' as const,
      },
      panels: {
        'Image!one': { id: 'Image!one' },
        'Image!two': { id: 'Image!two' },
        'Image!three': { id: 'Image!three' },
      },
    };
    const { mosaic, tabGroups } = dockviewGridToMosaic(state);
    expect(mosaic).toBeDefined();
    expect(getAllMosaicLeaves(mosaic!).sort()).toEqual([
      'Image!one',
      'Image!three',
      'Image!two',
    ]);
    expect(tabGroups['group-1']).toEqual({
      activePanelId: 'Image!two',
      panelIds: ['Image!one', 'Image!two', 'Image!three'],
    });
  });
});

describe('Canvas round-trip', () => {
  it('keeps Canvas!xxx ids as Canvas type on export even though rendered as Image', () => {
    const input: FoxgloveLayoutData = {
      layout: 'Canvas!cam1',
      configById: {
        'Canvas!cam1': {
          topicPath: '/camera/head/compressed',
          foxglovePanelTitle: 'Head Cam',
        },
      },
      globalVariables: {},
      userNodes: {},
    };

    const imported = importFoxgloveLayout(input);
    expect(imported.restored).toBe(1);
    const snapshot = imported.panelStates['Canvas!cam1'];
    expect(snapshot.type).toBe('Image');
    expect(snapshot.foxgloveType).toBe('Canvas');
    expect((snapshot.config as Record<string, string>).topic).toBe('/camera/head/compressed');
    expect(snapshot.title).toBe('Head Cam');

    // Simulate DockView serialization that api.toJSON would produce after import.
    const apiState = {
      grid: {
        root: {
          type: 'leaf' as const,
          size: 1,
          data: { id: 'g1', views: ['Canvas!cam1'], activeView: 'Canvas!cam1' },
        },
        width: 1000,
        height: 1000,
        orientation: 'HORIZONTAL' as const,
      },
      panels: {
        'Canvas!cam1': { id: 'Canvas!cam1', contentComponent: 'Image', title: 'Head Cam' },
      },
    };
    const exported = buildFoxgloveLayout({
      apiState,
      panels: imported.panelStates,
    });
    expect(exported.layout).toBe('Canvas!cam1');
    const cfg = exported.configById['Canvas!cam1'];
    expect(cfg).toBeDefined();
    // Canvas uses `topicPath` (not `topic`).
    expect(cfg.topicPath).toBe('/camera/head/compressed');
    expect(cfg.topic).toBeUndefined();
    expect(cfg.foxglovePanelTitle).toBe('Head Cam');
  });
});

describe('3D extras round-trip (preserve unknown fields)', () => {
  it('retains cameraState/layers/scene/publish/imageMode verbatim', () => {
    const cameraState = {
      perspective: true,
      distance: 4.29,
      phi: 53.53,
      thetaOffset: -88.35,
      target: [0, 0, 0],
      targetOffset: [0.1, 0.2, 0.3],
      targetOrientation: [0, 0, 0, 1],
      fovy: 45,
      near: 0.5,
      far: 5000,
    };
    const layers = {
      'layer-urdf': {
        visible: true,
        label: 'URDF',
        layerId: 'foxglove.Urdf',
        url: '',
        topic: 'robot_description',
        order: 1,
      },
      'layer-grid': {
        visible: true,
        label: 'Grid',
        layerId: 'foxglove.Grid',
        size: 10,
        order: 2,
      },
    };
    const input: FoxgloveLayoutData = {
      layout: '3D!ekxxpf',
      configById: {
        '3D!ekxxpf': {
          cameraState,
          followMode: 'follow-pose',
          scene: { meshUpAxis: 'y_up' },
          layers,
          topics: {},
          transforms: {},
          publish: {
            type: 'point',
            poseTopic: '/move_base_simple/goal',
          },
          imageMode: {},
        },
      },
      globalVariables: { globalVariable: 0 },
      userNodes: {},
    };

    const imported = importFoxgloveLayout(input);
    const snapshot = imported.panelStates['3D!ekxxpf'];
    expect(snapshot.type).toBe('3D');
    expect(snapshot.foxgloveType).toBeUndefined(); // id prefix already matches internal type
    expect(snapshot.extras?.cameraState).toEqual(cameraState);
    expect(snapshot.extras?.layers).toEqual(layers);
    expect(snapshot.extras?.publish).toEqual({ type: 'point', poseTopic: '/move_base_simple/goal' });

    const apiState = {
      grid: {
        root: {
          type: 'leaf' as const,
          size: 1,
          data: { id: 'g1', views: ['3D!ekxxpf'], activeView: '3D!ekxxpf' },
        },
        width: 1000,
        height: 1000,
        orientation: 'HORIZONTAL' as const,
      },
      panels: {
        '3D!ekxxpf': { id: '3D!ekxxpf', contentComponent: '3D' },
      },
    };
    const exported = buildFoxgloveLayout({
      apiState,
      panels: imported.panelStates,
      globalVariables: { globalVariable: 0 },
    });
    const cfg = exported.configById['3D!ekxxpf'];
    expect(cfg.cameraState).toEqual(cameraState);
    expect(cfg.layers).toEqual(layers);
    expect(cfg.publish).toEqual({ type: 'point', poseTopic: '/move_base_simple/goal' });
    expect(cfg.imageMode).toEqual({});
    expect(cfg.followMode).toBe('follow-pose');
  });
});

describe('committed Foxglove layout fixtures round-trip', () => {
  it('agibot-like layout import preserves all panels', () => {
    const layout = sampleAgibot;
    const ids = collectMosaicPanelIds(layout.layout);
    const imported = importFoxgloveLayout(layout);
    expect(imported.restored).toBe(ids.length);
    for (const id of ids) {
      expect(imported.panelStates[id]).toBeDefined();
    }
    expect(imported.dockviewState).toBeDefined();
  });

  it('agibot-like layout export keeps Canvas.topicPath and 3D extras', () => {
    const layout = sampleAgibot;
    const imported = importFoxgloveLayout(layout);
    // Build a synthetic apiState where every panel lives in its own leaf
    // (the real runtime goes through DockView first, but for export logic
    // only the panels map + their snapshots matter).
    const apiState = buildApiStateFromMosaic(layout.layout!, imported.panelStates);
    const exported = buildFoxgloveLayout({
      apiState,
      panels: imported.panelStates,
      globalVariables: layout.globalVariables,
      userNodes: layout.userNodes,
    });

    for (const [id, originalCfg] of Object.entries(layout.configById)) {
      const exportedCfg = exported.configById[id];
      expect(exportedCfg).toBeDefined();
      if (id.startsWith('Canvas!')) {
        expect(exportedCfg.topicPath).toBe(originalCfg.topicPath);
      }
      if (id.startsWith('3D!')) {
        // Deep fields retained verbatim via extras.
        expect(exportedCfg.cameraState).toEqual(originalCfg.cameraState);
        expect(exportedCfg.layers).toEqual(originalCfg.layers);
        expect(exportedCfg.publish).toEqual(originalCfg.publish);
        expect(exportedCfg.scene).toEqual(originalCfg.scene);
      }
    }
    expect(exported.globalVariables).toEqual(layout.globalVariables);
  });

  it('multi-canvas layout import+export round-trip keeps configById keys', () => {
    const layout = sampleStudio;
    const imported = importFoxgloveLayout(layout);
    const apiState = buildApiStateFromMosaic(layout.layout!, imported.panelStates);
    const exported = buildFoxgloveLayout({
      apiState,
      panels: imported.panelStates,
      globalVariables: layout.globalVariables,
    });
    expect(new Set(Object.keys(exported.configById))).toEqual(new Set(Object.keys(layout.configById)));
  });
});

// Helper: synthesize a DockView serialized state where the mosaic is
// preserved as independent leaves (one per id). Good enough for verifying
// that our export layer maps ids -> Foxglove types/configs correctly.
function buildApiStateFromMosaic(
  mosaic: FoxgloveMosaicNode,
  panelStates: Record<string, { type: string }>,
) {
  const ids = collectMosaicPanelIds(mosaic);
  const panels: Record<string, { id: string; contentComponent: string }> = {};
  for (const id of ids) {
    panels[id] = { id, contentComponent: panelStates[id]?.type ?? 'Unavailable' };
  }
  // Build a simple horizontally-split tree.
  const buildLeaf = (id: string) => ({
    type: 'leaf' as const,
    size: 1,
    data: { id: `g-${id}`, views: [id], activeView: id },
  });
  type LayoutNode =
    | ReturnType<typeof buildLeaf>
    | { type: 'branch'; size: 1; data: [LayoutNode, LayoutNode] };
  let root: LayoutNode = buildLeaf(ids[0]);
  for (let i = 1; i < ids.length; i += 1) {
    root = {
      type: 'branch' as const,
      size: 1,
      data: [root, buildLeaf(ids[i])],
    };
  }
  return {
    grid: {
      root,
      width: 1000,
      height: 1000,
      orientation: 'HORIZONTAL' as const,
    },
    panels,
  };
}
