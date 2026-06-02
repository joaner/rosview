import { useCallback, useEffect, useRef, type RefObject } from 'react';
import uPlot from 'uplot';
import { timeToSec } from '@/core/analysis/timeSeries';
import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { scheduleFrame } from '@/shared/utils/rafScheduler';
import type { PlotDataset } from './datasets';
import type { PlotConfig } from './defaults';
import { plotChartTopologyKey } from './plotConfigSelectors';
import {
  createPlotUplotOptions,
  mountPlotChart,
  readPlotChartColors,
} from './plotChart';

export interface UsePlotChartArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  player: Player;
  panelId: string;
  config: PlotConfig;
  dataset: PlotDataset;
  hiddenSeries: Set<number>;
  xRange?: { min: number; max: number };
  logStart?: Time;
}

export function usePlotChart({
  containerRef,
  player,
  panelId,
  config,
  dataset,
  hiddenSeries,
  xRange,
  logStart,
}: UsePlotChartArgs): RefObject<uPlot | null> {
  const uplotRef = useRef<uPlot | null>(null);
  const currentTimeSecRef = useRef<number | undefined>(
    (() => {
      const time = player.getCurrentTime();
      return time ? timeToSec(time) : undefined;
    })(),
  );
  const cancelPlayheadFrameRef = useRef<(() => void) | null>(null);
  const followingViewWidthRef = useRef(config.followingViewWidthSec);
  const xAxisModeRef = useRef(config.xAxisMode);
  const topologyKeyRef = useRef('');
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  followingViewWidthRef.current = config.followingViewWidthSec;
  xAxisModeRef.current = config.xAxisMode;

  const destroyChart = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    uplotRef.current?.destroy();
    uplotRef.current = null;
  }, []);

  const mountChart = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    destroyChart();

    const colors = readPlotChartColors();
    const options = createPlotUplotOptions(dataset, hiddenSeries, {
      panelId,
      xAxisMode: config.xAxisMode,
      xRange,
      logStart,
      getCurrentTimeSec: () => currentTimeSecRef.current,
      colors,
    });

    uplotRef.current = mountPlotChart(container, dataset, options, xRange);
    topologyKeyRef.current = plotChartTopologyKey(dataset);

    const observer = new ResizeObserver(() => {
      const chart = uplotRef.current;
      if (!container || !chart) return;
      chart.setSize({
        width: container.offsetWidth || 400,
        height: Math.max(container.offsetHeight || 200, 100),
      });
    });
    observer.observe(container);
    resizeObserverRef.current = observer;
  }, [config.xAxisMode, containerRef, dataset, destroyChart, hiddenSeries, logStart, panelId, xRange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || dataset.series.length === 0) {
      destroyChart();
      return;
    }

    const nextTopology = plotChartTopologyKey(dataset);
    const chart = uplotRef.current;

    if (!chart || topologyKeyRef.current !== nextTopology || config.xAxisMode !== xAxisModeRef.current) {
      mountChart();
      return;
    }

    chart.setData(dataset.data);
    for (let index = 0; index < dataset.series.length; index++) {
      chart.setSeries(index + 1, { show: !hiddenSeries.has(index) });
    }
  }, [config.xAxisMode, containerRef, dataset, destroyChart, hiddenSeries, mountChart]);

  useEffect(() => () => destroyChart(), [destroyChart]);

  useEffect(() => {
    const unsub = player.subscribeCurrentTime((time) => {
      currentTimeSecRef.current = timeToSec(time);
      if (cancelPlayheadFrameRef.current) return;

      cancelPlayheadFrameRef.current = scheduleFrame(() => {
        cancelPlayheadFrameRef.current = null;
        const chart = uplotRef.current;
        if (!chart) return;

        if (xAxisModeRef.current === 'timestamp' && followingViewWidthRef.current > 0) {
          const end = currentTimeSecRef.current;
          if (end != null && Number.isFinite(end)) {
            chart.setScale('x', {
              min: end - followingViewWidthRef.current,
              max: end,
            });
          }
        }

        chart.redraw(false);
      });
    });

    return () => {
      unsub();
      cancelPlayheadFrameRef.current?.();
      cancelPlayheadFrameRef.current = null;
    };
  }, [player]);

  useEffect(() => {
    const chart = uplotRef.current;
    if (!chart || config.xAxisMode !== 'timestamp') return;
    if (config.followingViewWidthSec > 0) {
      const end = currentTimeSecRef.current;
      if (end != null && Number.isFinite(end)) {
        chart.setScale('x', { min: end - config.followingViewWidthSec, max: end });
      }
    } else if (xRange) {
      chart.setScale('x', xRange);
    }
  }, [config.followingViewWidthSec, config.xAxisMode, xRange]);

  useEffect(() => {
    const chart = uplotRef.current;
    if (!chart) return;
    for (let index = 0; index < dataset.series.length; index++) {
      chart.setSeries(index + 1, { show: !hiddenSeries.has(index) });
    }
  }, [dataset.series.length, hiddenSeries]);

  return uplotRef;
}
