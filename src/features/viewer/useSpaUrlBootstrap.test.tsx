/**
 * @vitest-environment happy-dom
 *
 * Regression coverage for the production bug this hook was extracted to
 * fix: replaying SPA `?url=file://…` history used to be wired up as a
 * direct Effect dependency, and the replay handler set state that the
 * handler's own identity depended on — so every replay recreated the
 * handler, which re-ran the bootstrap Effect, which replayed again,
 * forever (flickering UI, hundreds of cancelled worker inits, tab crash).
 *
 * `useSpaUrlBootstrap` structurally prevents this by calling every handler
 * through a React "Effect Event" (`useEffectEvent`), so its Effect only
 * depends on `(active, url)`. These tests feed in handlers with a *worse*
 * identity churn than production ever had (a brand-new closure on every
 * render, referencing state that changes on every call) and assert the
 * bootstrap still only fires once per URL.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpaUrlBootstrap, type SpaUrlBootstrapHandlers } from './useSpaUrlBootstrap';

const { getLatestReplayableHistoryByLocalLocatorMock } = vi.hoisted(() => ({
  getLatestReplayableHistoryByLocalLocatorMock: vi.fn<() => Promise<{ id: string } | null>>(),
}));
vi.mock('@/shared/utils/datasetHistory', () => ({
  getLatestReplayableHistoryByLocalLocator: getLatestReplayableHistoryByLocalLocatorMock,
}));

const { getSampleDatasetsManifestUrlMock, loadSampleDatasetsMock } = vi.hoisted(() => ({
  getSampleDatasetsManifestUrlMock: vi.fn<() => string | undefined>(),
  loadSampleDatasetsMock: vi.fn<() => Promise<Array<{ id: string; name: string; title: string }>>>(),
}));
vi.mock('@/services/sampleDatasets', () => ({
  getSampleDatasetsManifestUrl: getSampleDatasetsManifestUrlMock,
  loadSampleDatasets: loadSampleDatasetsMock,
}));

async function flushMicrotasks(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function noopHandlers(): SpaUrlBootstrapHandlers {
  return {
    onManualOpenHint: () => {},
    onNoLocalHistoryMatch: () => {},
    onReplayHistoryRow: () => {},
    onSelectSample: () => {},
    onSampleManifestNotConfigured: () => {},
    onSampleNotFound: () => {},
  };
}

describe('useSpaUrlBootstrap', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    getLatestReplayableHistoryByLocalLocatorMock.mockReset();
    getSampleDatasetsManifestUrlMock.mockReset();
    loadSampleDatasetsMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it(
    'regression: an unstable onReplayHistoryRow identity that mutates state does not ' +
      'self-trigger repeated replays',
    async () => {
      getLatestReplayableHistoryByLocalLocatorMock.mockResolvedValue({ id: 'row-1' });
      const replayCalls: string[] = [];
      let renderCount = 0;

      function Probe() {
        renderCount += 1;
        // Mirrors the real bug's `activeId`: state that changes every time
        // history is replayed.
        const [activeId, setActiveId] = useState<string | null>(null);

        // Deliberately a *fresh object every render* — worse than
        // production, where only some callbacks were unstable.
        const handlers: SpaUrlBootstrapHandlers = {
          ...noopHandlers(),
          onReplayHistoryRow: (rowId) => {
            replayCalls.push(`${rowId}:${activeId ?? 'null'}`);
            setActiveId(`group:${replayCalls.length}`);
          },
        };

        useSpaUrlBootstrap(true, 'file://episode_00044.mcap', handlers);
        return null;
      }

      act(() => {
        root.render(<Probe />);
      });
      await flushMicrotasks();

      expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);
      expect(replayCalls).toEqual(['row-1:null']);
      // A real self-triggering loop would drive this into the hundreds
      // within a few microtask flushes.
      expect(renderCount).toBeLessThan(5);
    },
  );

  it('does not re-bootstrap on unrelated re-renders of the same url', async () => {
    getLatestReplayableHistoryByLocalLocatorMock.mockResolvedValue({ id: 'row-1' });

    function Probe({ tick }: { tick: number }) {
      const handlers = { ...noopHandlers() };
      useSpaUrlBootstrap(true, 'file://same.mcap', handlers);
      return <span data-tick={tick} />;
    }

    act(() => {
      root.render(<Probe tick={0} />);
    });
    await flushMicrotasks();
    expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);

    // Re-render several times with the same url but a changing unrelated prop.
    for (let tick = 1; tick <= 5; tick++) {
      act(() => {
        root.render(<Probe tick={tick} />);
      });
    }
    await flushMicrotasks();

    expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);
  });

  it('bootstraps again when the url actually changes', async () => {
    getLatestReplayableHistoryByLocalLocatorMock.mockResolvedValue({ id: 'row-1' });

    function Probe({ url }: { url: string }) {
      useSpaUrlBootstrap(true, url, noopHandlers());
      return null;
    }

    act(() => {
      root.render(<Probe url="file://a.mcap" />);
    });
    await flushMicrotasks();
    expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<Probe url="file://b.mcap" />);
    });
    await flushMicrotasks();
    expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(2);
  });

  it('calls onNoLocalHistoryMatch when no history row matches', async () => {
    getLatestReplayableHistoryByLocalLocatorMock.mockResolvedValue(null);
    const noMatchCalls: string[] = [];

    function Probe() {
      const handlers: SpaUrlBootstrapHandlers = {
        ...noopHandlers(),
        onNoLocalHistoryMatch: (loc) => noMatchCalls.push(loc.displayName),
      };
      useSpaUrlBootstrap(true, 'file://never-opened.mcap', handlers);
      return null;
    }

    act(() => {
      root.render(<Probe />);
    });
    await flushMicrotasks();

    expect(noMatchCalls).toEqual(['never-opened.mcap']);
  });

  it('resolves sample:// locators against the manifest and reports missing ids', async () => {
    getSampleDatasetsManifestUrlMock.mockReturnValue('https://example.com/samples.json');
    loadSampleDatasetsMock.mockResolvedValue([{ id: 'known', name: 'Known', title: 'Known' }]);
    const notFound: string[] = [];
    const selected: string[] = [];

    function Probe({ sampleId }: { sampleId: string }) {
      const handlers: SpaUrlBootstrapHandlers = {
        ...noopHandlers(),
        onSelectSample: (sample) => selected.push(sample.id),
        onSampleNotFound: (id) => notFound.push(id),
      };
      useSpaUrlBootstrap(true, `sample://${sampleId}`, handlers);
      return null;
    }

    act(() => {
      root.render(<Probe sampleId="missing" />);
    });
    await flushMicrotasks();
    expect(notFound).toEqual(['missing']);
    expect(selected).toEqual([]);
  });

  it(
    'reset() allows re-bootstrapping the same url again after it round-trips through empty ' +
      '(e.g. "go home" then reopening the same recording)',
    async () => {
      getLatestReplayableHistoryByLocalLocatorMock.mockResolvedValue({ id: 'row-1' });
      let resetFn: (() => void) | undefined;

      function Probe({ url }: { url: string | undefined }) {
        const { reset } = useSpaUrlBootstrap(true, url, noopHandlers());
        resetFn = reset;
        return null;
      }

      act(() => {
        root.render(<Probe url="file://same.mcap" />);
      });
      await flushMicrotasks();
      expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);

      // "Go home": clears the url and resets the bootstrap guard, mirroring
      // `handleGoHome` (`resetSpaUrlBootstrap()` + `pushSpaUrlParam(null)`).
      act(() => {
        resetFn?.();
        root.render(<Probe url={undefined} />);
      });
      await flushMicrotasks();
      expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(1);

      // Reopening the exact same url again must bootstrap fresh, not be
      // silently swallowed by the "already bootstrapped this url" guard.
      act(() => {
        root.render(<Probe url="file://same.mcap" />);
      });
      await flushMicrotasks();
      expect(getLatestReplayableHistoryByLocalLocatorMock).toHaveBeenCalledTimes(2);
    },
  );
});
