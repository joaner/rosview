import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { timeToSec } from '@/core/analysis/timeSeries';
import type { MessagePipelineState } from '@/core/pipeline/store';
import { useMessagePipeline } from '@/core/pipeline/useMessagePipeline';
import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { fromNano } from '@/shared/utils/time';
import { TopicQuickPicker } from '../framework';
import { buildPlotDataset, type PlotDataset } from './datasets';
import type { PlotConfig, PlotSeriesConfig, PlotXAxisMode } from './defaults';
import { readPlotRange, type PlotRangeReadProgress } from './rangeReader';

interface PlotPanelProps {
  player: Player;
  panelId: string;
  config: PlotConfig;
  setConfig: (next: PlotConfig | ((prev: PlotConfig) => PlotConfig)) => void;
}

const EMPTY_DATASET: PlotDataset = {
  xLabel: 'time',
  series: [],
  data: [[]] as uPlot.AlignedData,
  pointCount: 0,
  warnings: [],
};

function timeFromSeconds(seconds: number): Time {
  return fromNano(BigInt(Math.round(seconds * 1e9)));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatProgress(progress: PlotRangeReadProgress | null): string {
  if (!progress) return '';
  return `${progress.completed}/${progress.total} chunks, ${progress.messages.toLocaleString()} messages`;
}

function csvEscape(value: unknown): string {
  const text =
    value == null
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function downloadCsv(dataset: PlotDataset): void {
  const xValues = dataset.data[0] as number[];
  const rows: string[] = [
    ['x', ...dataset.series.map((series) => series.label)].map(csvEscape).join(','),
  ];
  for (let i = 0; i < xValues.length; i++) {
    rows.push(
      [
        xValues[i],
        ...dataset.series.map((_, seriesIndex) => {
          const values = dataset.data[seriesIndex + 1] as Array<number | null>;
          return values[i] ?? '';
        }),
      ].map(csvEscape).join(','),
    );
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'plot.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function seriesColor(index: number): string {
  return `hsl(${(index * 137.508) % 360}, 70%, 50%)`;
}

export const PlotPanel: React.FC<PlotPanelProps> = ({ player, panelId, config, setConfig }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const [dataset, setDataset] = useState<PlotDataset>(EMPTY_DATASET);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PlotRangeReadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [currentTime, setCurrentTime] = useState<Time | undefined>(() => player.getCurrentTime());

  const { startTime, endTime } = useMessagePipeline(
    useShallow((state: MessagePipelineState) => ({
      startTime: state.playerState.activeData?.startTime,
      endTime: state.playerState.activeData?.endTime,
    })),
  );

  const activeTopics = useMemo(
    () => Array.from(new Set(config.series.filter((series) => series.enabled && series.topic).map((series) => series.topic))).sort(),
    [config.series],
  );

  useEffect(() => {
    const subscriptions = activeTopics.map((topic) => ({ topic, subscriberId: panelId }));
    if (subscriptions.length > 0) {
      player.registerSubscriptions(panelId, subscriptions);
    }
    return () => player.unregisterSubscriptions(panelId);
  }, [player, panelId, activeTopics]);

  useEffect(() => player.subscribeCurrentTime(setCurrentTime), [player]);

  useEffect(() => {
    if (!startTime || !endTime || activeTopics.length === 0) {
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

    void readPlotRange({
      player,
      start: startTime,
      end: endTime,
      topics: activeTopics,
      signal: controller.signal,
      onProgress: setProgress,
    })
      .then((messages) => {
        if (controller.signal.aborted) return;
        setDataset(buildPlotDataset(messages, config));
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
        }
      });

    return () => controller.abort();
  }, [activeTopics, config, endTime, player, reloadNonce, startTime]);

  const rebuildChart = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    uplotRef.current?.destroy();
    uplotRef.current = null;

    const opts: uPlot.Options = {
      id: panelId,
      width: container.offsetWidth || 400,
      height: Math.max(container.offsetHeight || 200, 100),
      series: [
        { label: dataset.xLabel },
        ...dataset.series.map((series, index) => ({
          label: series.label,
          stroke: series.color || seriesColor(index),
          width: series.lineSize,
          points: { show: false },
          paths: series.showLine ? undefined : () => null,
          spanGaps: false,
        })),
      ],
      axes: [
        { grid: { show: true }, stroke: '#888', font: '10px sans-serif' },
        { grid: { show: true }, stroke: '#888', font: '10px sans-serif' },
      ],
      cursor: {
        drag: { setScale: true },
      },
      legend: { show: true },
      scales: { x: { time: config.xAxisMode === 'timestamp' } },
    };

    uplotRef.current = new uPlot(opts, dataset.data, container);
    const observer = new ResizeObserver(() => {
      if (!container || !uplotRef.current) return;
      uplotRef.current.setSize({
        width: container.offsetWidth || 400,
        height: Math.max(container.offsetHeight || 200, 100),
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [config.xAxisMode, dataset, panelId]);

  useEffect(() => {
    const cleanup = rebuildChart();
    return () => {
      cleanup?.();
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [rebuildChart]);

  useEffect(() => {
    const u = uplotRef.current;
    if (!u || config.xAxisMode !== 'timestamp' || !currentTime) return;
    if (config.followingViewWidthSec > 0) {
      const end = timeToSec(currentTime);
      u.setScale('x', { min: end - config.followingViewWidthSec, max: end });
    }
  }, [config.followingViewWidthSec, config.xAxisMode, currentTime]);

  const updatePrimarySeries = (patch: Partial<PlotSeriesConfig>) => {
    setConfig((prev) => {
      const first = prev.series[0] ?? {
        id: 'series-1',
        topic: '',
        path: 'data',
        label: '',
        color: '#3b82f6',
        enabled: true,
        timestampMode: 'headerStamp' as const,
        showLine: true,
        lineSize: 1.5,
      };
      return { ...prev, series: [{ ...first, ...patch }, ...prev.series.slice(1)] };
    });
  };

  const primary = config.series[0];
  const hasSeries = activeTopics.length > 0;
  const status = loading
    ? `Loading ${formatProgress(progress)}`
    : error
      ? `Error: ${error}`
      : `${dataset.pointCount.toLocaleString()} points`;

  const handleChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const u = uplotRef.current;
    if (!u || config.xAxisMode !== 'timestamp') return;
    const rect = u.root.getBoundingClientRect();
    const x = u.posToVal(event.clientX - rect.left, 'x');
    if (Number.isFinite(x)) {
      player.seek(timeFromSeconds(x));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-muted px-1.5 py-0.5">
        <div className="min-w-0 flex-1 max-w-[240px]">
          <TopicQuickPicker
            value={primary?.topic ?? ''}
            onChange={(topic) => updatePrimarySeries({ topic })}
            placeholder="/topic"
            triggerClassName="h-[22px] text-[10px] px-1.5"
          />
        </div>
        <input
          value={primary?.path ?? 'data'}
          onChange={(event) => updatePrimarySeries({ path: event.target.value })}
          placeholder="data[:]"
          className="h-[22px] w-36 rounded border border-input bg-background px-1.5 text-[10px] font-mono"
        />
        <select
          value={config.xAxisMode}
          onChange={(event) => setConfig((prev) => ({ ...prev, xAxisMode: event.target.value as PlotXAxisMode }))}
          className="h-[22px] rounded border border-input bg-background px-1 text-[10px]"
        >
          <option value="timestamp">timestamp</option>
          <option value="index">index</option>
          <option value="custom">custom</option>
          <option value="currentCustom">current custom</option>
        </select>
        <button
          type="button"
          onClick={() => setReloadNonce((value) => value + 1)}
          className="rounded border border-border bg-background p-1 hover:bg-accent"
          title="Reload plot data"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => downloadCsv(dataset)}
          disabled={dataset.pointCount === 0}
          className="rounded border border-border bg-background p-1 hover:bg-accent disabled:opacity-50"
          title="Export CSV"
        >
          <Download className="h-3 w-3" />
        </button>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{status}</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 min-h-0 w-full overflow-hidden"
          onClick={handleChartClick}
        />
        {!hasSeries && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            Select a topic and numeric path to plot.
          </div>
        )}
        {hasSeries && !loading && !error && dataset.pointCount === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            No numeric values found. Try paths like data, data[:], position[:], or pose.position.x.
          </div>
        )}
        {dataset.warnings.length > 0 && (
          <div className="absolute bottom-1 left-1 max-w-[70%] rounded border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">
            {dataset.warnings[0]}
          </div>
        )}
      </div>
    </div>
  );
};
