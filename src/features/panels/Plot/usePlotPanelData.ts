import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { buildPlotDataset, type PlotDataset } from './datasets';
import type { PlotConfig } from './defaults';
import { plotDataConfigKey } from './plotConfigSelectors';
import { readPlotRange, type PlotRangeReadProgress } from './rangeReader';
import type { PlotDatasetWarning } from './plotWarnings';

const EMPTY_DATASET: PlotDataset = {
  xLabel: 'time',
  series: [],
  data: [[]],
  pointCount: 0,
  sampleRatio: 1,
  warnings: [],
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface UsePlotPanelDataArgs {
  player: Player;
  config: PlotConfig;
  activeTopics: string[];
  hasPlotPaths: boolean;
  startTime?: Time;
  endTime?: Time;
  randomAccessByTopic?: boolean;
}

export interface UsePlotPanelDataResult {
  dataset: PlotDataset;
  loading: boolean;
  progress: PlotRangeReadProgress | null;
  error: string | null;
}

export function usePlotPanelData({
  player,
  config,
  activeTopics,
  hasPlotPaths,
  startTime,
  endTime,
  randomAccessByTopic,
}: UsePlotPanelDataArgs): UsePlotPanelDataResult {
  const [dataset, setDataset] = useState<PlotDataset>(EMPTY_DATASET);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PlotRangeReadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dataConfigKey = useMemo(() => plotDataConfigKey(config), [config]);
  const progressRef = useRef<PlotRangeReadProgress | null>(null);
  const progressFrameRef = useRef<number | null>(null);

  const flushProgress = useCallback(() => {
    progressFrameRef.current = null;
    if (progressRef.current) {
      setProgress(progressRef.current);
    }
  }, []);

  const onProgress = useCallback(
    (next: PlotRangeReadProgress) => {
      progressRef.current = next;
      if (progressFrameRef.current != null) return;
      progressFrameRef.current = requestAnimationFrame(flushProgress);
    },
    [flushProgress],
  );

  useEffect(() => {
    if (!startTime || !endTime || activeTopics.length === 0 || !hasPlotPaths) {
      setDataset(EMPTY_DATASET);
      setLoading(false);
      setProgress(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setProgress(null);
    setError(null);

    const isIndexed = randomAccessByTopic !== false;
    const maxMessages = isIndexed ? undefined : config.nonIndexedMaxMessages;
    const extraWarnings: PlotDatasetWarning[] = isIndexed
      ? []
      : [{ kind: 'nonIndexedSource' }];

    void readPlotRange({
      player,
      start: startTime,
      end: endTime,
      topics: activeTopics,
      signal: controller.signal,
      onProgress,
      maxMessages,
    })
      .then((messages) => {
        if (controller.signal.aborted) return;
        setDataset(
          buildPlotDataset(messages, config, {
            forceDownsample: !isIndexed,
            extraWarnings,
            logStart: startTime,
            logEnd: endTime,
          }),
        );
      })
      .catch((err: unknown) => {
        if (!isAbortError(err)) {
          setDataset(EMPTY_DATASET);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (progressFrameRef.current != null) {
            cancelAnimationFrame(progressFrameRef.current);
            progressFrameRef.current = null;
          }
        }
      });

    return () => {
      controller.abort();
      if (progressFrameRef.current != null) {
        cancelAnimationFrame(progressFrameRef.current);
        progressFrameRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataConfigKey captures data-affecting config fields
  }, [
    activeTopics,
    dataConfigKey,
    endTime,
    hasPlotPaths,
    onProgress,
    player,
    randomAccessByTopic,
    startTime,
  ]);

  return { dataset, loading, progress, error };
}
