import { useCallback, useEffect, useEffectEvent, useRef } from 'react';
import {
  getLatestReplayableHistoryByLocalLocator,
  type SpaLocalHistoryLocator,
} from '@/shared/utils/datasetHistory';
import { getSampleDatasetsManifestUrl, loadSampleDatasets } from '@/services/sampleDatasets';
import type { SampleDataset } from '@/services/sampleDatasets';
import { parseSourceLocator, type SourceLocator } from '@/shared/utils/sourceLocator';

export type SpaUrlBootstrapHandlers = {
  /** Called with a hint (or `null` to clear it) any time bootstrap starts or needs manual follow-up. */
  onManualOpenHint: (hint: string | null) => void;
  /** No remembered local file/folder matches this locator; caller shows a "please pick it manually" hint. */
  onNoLocalHistoryMatch: (loc: SpaLocalHistoryLocator) => void;
  /** A remembered local file/folder history row matched; caller replays it (e.g. re-requests FS permission). */
  onReplayHistoryRow: (rowId: string) => void | Promise<void>;
  /** `sample://<id>` resolved to a real sample dataset; caller opens it. */
  onSelectSample: (sample: SampleDataset) => void | Promise<void>;
  /** The embedder has no sample manifest configured. */
  onSampleManifestNotConfigured: () => void;
  /** `sample://<id>` doesn't match any entry in the manifest. */
  onSampleNotFound: (sampleId: string) => void;
};

/**
 * Drives the SPA `?url=` bootstrap: resolves a `file://` / `folder://` /
 * `sample://` locator into either a sample dataset or a remembered local
 * file/folder history entry, then hands off to the matching `handlers`
 * callback.
 *
 * ## Why this is its own hook, and why it uses `useEffectEvent`
 *
 * Every `handlers` callback is invoked through a React "Effect Event"
 * (`useEffectEvent`) instead of being listed as an Effect dependency. An
 * Effect Event's returned function always calls the *latest* version of the
 * callback passed to it (like reading a ref) while its own identity never
 * changes, so the bootstrap Effect below only re-runs for a genuine
 * `(active, url)` change — never merely because a `handlers` callback was
 * recreated. `react-hooks/exhaustive-deps` actively errors if the Effect
 * Event result is ever added back to that Effect's dependency array, so
 * this guarantee is enforced at lint time, not just by convention.
 *
 * This matters because of a real production bug: the previous inline
 * version of this logic listed its `onReplayHistoryRow` equivalent
 * (`handleReplayHistory`) as an Effect dependency. That handler set
 * `activeId` state, and its own identity depended on `activeId` — so
 * replaying history changed `activeId`, which changed the handler's
 * identity, which re-ran the bootstrap Effect, which replayed history
 * again, forever. Symptoms were a flickering UI (sidebar mounting/
 * unmounting), hundreds of `WorkerSourceCancelledError`s as the player was
 * torn down and rebuilt on every iteration, and eventual tab crashes from
 * resource exhaustion. See `useSpaUrlBootstrap.test.tsx` for a regression
 * test that pins this down: it feeds in handlers whose identity changes on
 * every render (the worst case) and asserts the bootstrap still only runs
 * once per URL.
 */
export function useSpaUrlBootstrap(
  active: boolean,
  url: string | undefined,
  handlers: SpaUrlBootstrapHandlers,
): { reset: () => void } {
  const genRef = useRef(0);
  const lastBootstrappedUrlRef = useRef<string | null>(null);

  const run = useEffectEvent(async (loc: Exclude<SourceLocator, { kind: 'remote' }>, gen: number) => {
    handlers.onManualOpenHint(null);
    if (loc.kind === 'sample') {
      if (!getSampleDatasetsManifestUrl()) {
        handlers.onSampleManifestNotConfigured();
        return;
      }
      const samples = await loadSampleDatasets();
      if (genRef.current !== gen) return;
      const found = samples.find((s) => s.id === loc.sampleId);
      if (!found) {
        handlers.onSampleNotFound(loc.sampleId);
        return;
      }
      await handlers.onSelectSample(found);
      return;
    }

    const row = await getLatestReplayableHistoryByLocalLocator(loc);
    if (genRef.current !== gen) return;
    if (!row) {
      handlers.onNoLocalHistoryMatch(loc);
      return;
    }
    await handlers.onReplayHistoryRow(row.id);
  });

  useEffect(() => {
    if (!active) return;
    const raw = url?.trim();
    if (!raw) return;
    const loc = parseSourceLocator(raw);
    if (!loc || loc.kind === 'remote') return;
    if (lastBootstrappedUrlRef.current === raw) return;
    lastBootstrappedUrlRef.current = raw;

    const gen = ++genRef.current;
    void run(loc, gen);

    return () => {
      genRef.current += 1;
    };
  }, [active, url]);

  const reset = useCallback(() => {
    genRef.current += 1;
    lastBootstrappedUrlRef.current = null;
  }, []);

  return { reset };
}
