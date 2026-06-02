import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useShallow } from 'zustand/react/shallow';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { timeToSec } from '@/core/analysis/timeSeries';
import type { MessagePipelineState } from '@/core/pipeline/store';
import { useMessagePipeline } from '@/core/pipeline/useMessagePipeline';
import type { Player } from '@/core/types/player';
import type { TopicInfo } from '@/core/types/ros';
import { isJointStateSchema } from '@/shared/ros/rosMessageTypes';
import { scheduleFrame } from '@/shared/utils/rafScheduler';
import { TopicQuickPicker } from '../framework';
import { buildPlotDataset, type PlotDataset } from './datasets';
import type { JointStateField, PlotConfig } from './defaults';
import { JOINT_STATE_FIELDS } from './defaults';
import { filterPlottableTopics, isPlottableTopic } from './plottableSchemas';
import { pickDefaultPlotTopic } from './pickDefaultPlotTopic';
import {
  createPlotUplotOptions,
  mountPlotChart,
  readPlotChartColors,
  secToTime,
} from './plotChart';
import { readPlotRange, type PlotRangeReadProgress } from './rangeReader';
import {
  buildSeriesForTopic,
  mergeDetectedSeries,
  rebuildJointStateSeries,
} from './topicPaths';
import { hiddenSeriesIndices, pruneHiddenLegendKeys } from './plotLegendVisibility';
import {
  clearPlotLegendEntries,
  setPlotLegendEntries,
} from './plotPanelRuntimeStore';
import { formatPlotDatasetWarning } from './plotWarnings';

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
  sampleRatio: 1,
  warnings: [],
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function JointStateFieldChips({
  fields,
  fieldLabels,
  onChange,
}: {
  fields: JointStateField[];
  fieldLabels: Record<JointStateField, string>;
  onChange: (fields: JointStateField[]) => void;
}): React.ReactNode {
  return (
    <div className="flex items-center gap-0.5">
      {JOINT_STATE_FIELDS.map((field) => {
        const active = fields.includes(field);
        return (
          <button
            key={field}
            type="button"
            onClick={() => {
              const next = active ? fields.filter((f) => f !== field) : [...fields, field];
              onChange(next.length > 0 ? next : ['position']);
            }}
            className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${
              active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent'
            }`}
          >
            {fieldLabels[field]}
          </button>
        );
      })}
    </div>
  );
}

export const PlotPanel: React.FC<PlotPanelProps> = ({ player, panelId, config, setConfig }) => {
  const { formatMessage } = useIntl();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const autoTopicAppliedRef = useRef(false);
  const currentTimeSecRef = useRef<number | undefined>(
    (() => {
      const time = player.getCurrentTime();
      return time ? timeToSec(time) : undefined;
    })(),
  );
  const cancelPlayheadFrameRef = useRef<(() => void) | null>(null);
  const followingViewWidthRef = useRef(config.followingViewWidthSec);
  const xAxisModeRef = useRef(config.xAxisMode);

  const [dataset, setDataset] = useState<PlotDataset>(EMPTY_DATASET);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<PlotRangeReadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detectingTopic, setDetectingTopic] = useState(false);

  const hiddenSeries = useMemo(
    () => hiddenSeriesIndices(dataset.series, config.hiddenLegendKeys),
    [config.hiddenLegendKeys, dataset.series],
  );

  followingViewWidthRef.current = config.followingViewWidthSec;
  xAxisModeRef.current = config.xAxisMode;

  const hasPlotPaths = useMemo(
    () => config.series.some((series) => series.enabled && series.topic && series.path.trim().length > 0),
    [config.series],
  );

  const { startTime, endTime, randomAccessByTopic, topics } = useMessagePipeline(
    useShallow((state: MessagePipelineState) => ({
      startTime: state.playerState.activeData?.startTime,
      endTime: state.playerState.activeData?.endTime,
      randomAccessByTopic: state.playerState.activeData?.randomAccessByTopic,
      topics: state.playerState.activeData?.topics ?? [],
    })),
  );

  const plottableTopics = useMemo(() => filterPlottableTopics(topics), [topics]);

  const topicByName = useMemo(() => {
    const map = new Map<string, TopicInfo>();
    for (const topic of topics) map.set(topic.name, topic);
    return map;
  }, [topics]);

  const activeTopics = useMemo(
    () =>
      Array.from(
        new Set(
          config.series
            .filter((series) => series.enabled && series.topic)
            .map((series) => series.topic)
            .filter((topic) => {
              const info = topicByName.get(topic);
              return info ? isPlottableTopic(info) : false;
            }),
        ),
      ).sort(),
    [config.series, topicByName],
  );

  const primary = config.series[0];
  const primarySchema = primary?.topic ? topicByName.get(primary.topic)?.type : undefined;
  const showJointStateFields = primarySchema ? isJointStateSchema(primarySchema) : false;

  const xRange = useMemo(() => {
    if (!startTime || !endTime || config.xAxisMode !== 'timestamp') return undefined;
    return { min: timeToSec(startTime), max: timeToSec(endTime) };
  }, [config.xAxisMode, endTime, startTime]);

  useEffect(() => {
    const subscriptions = activeTopics.map((topic) => ({ topic, subscriberId: panelId }));
    if (subscriptions.length > 0) {
      player.registerSubscriptions(panelId, subscriptions);
    }
    return () => player.unregisterSubscriptions(panelId);
  }, [player, panelId, activeTopics]);

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
    const entries = dataset.series.map((series) => ({
      key: series.key,
      label: series.label,
      color: series.color,
    }));
    setPlotLegendEntries(panelId, entries);

    setConfig((prev) => {
      const keys = entries.map((entry) => entry.key);
      const hiddenLegendKeys = pruneHiddenLegendKeys(prev.hiddenLegendKeys, keys);
      if (hiddenLegendKeys.length === prev.hiddenLegendKeys.length) return prev;
      return { ...prev, hiddenLegendKeys };
    });
  }, [dataset.series, panelId, setConfig]);

  useEffect(() => () => clearPlotLegendEntries(panelId), [panelId]);

  const applyTopicDetection = useCallback(
    async (seriesId: string, topic: string) => {
      if (!topic) {
        setConfig((prev) => ({
          ...prev,
          series: prev.series.map((series) =>
            series.id === seriesId ? { ...series, topic: '', path: '' } : series,
          ),
        }));
        return;
      }
      setDetectingTopic(true);
      try {
        const isPrimary = seriesId === config.series[0]?.id;
        const schemaName = topicByName.get(topic)?.type;
        const result = await buildSeriesForTopic({
          topic,
          schemaName,
          player,
          startTime,
          endTime,
          existingSeriesId: seriesId,
          jointStateFields: isPrimary ? config.jointStateFields : ['position'],
        });
        setConfig((prev) => ({
          ...prev,
          ...(isPrimary && result.xAxisMode ? { xAxisMode: result.xAxisMode } : {}),
          series: mergeDetectedSeries(prev.series, seriesId, result.series),
        }));
      } finally {
        setDetectingTopic(false);
      }
    },
    [config.jointStateFields, config.series, endTime, player, setConfig, startTime, topicByName],
  );

  useEffect(() => {
    if (autoTopicAppliedRef.current || !startTime || !endTime) return;
    if (primary?.topic) {
      autoTopicAppliedRef.current = true;
      return;
    }
    const defaultTopic = pickDefaultPlotTopic(plottableTopics);
    if (!defaultTopic || !config.series[0]?.id) return;
    autoTopicAppliedRef.current = true;
    void applyTopicDetection(config.series[0].id, defaultTopic);
  }, [applyTopicDetection, config.series, endTime, plottableTopics, primary?.topic, startTime]);

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
    const extraWarnings = isIndexed
      ? []
      : [{ kind: 'nonIndexedSource' as const }];

    void readPlotRange({
      player,
      start: startTime,
      end: endTime,
      topics: activeTopics,
      signal: controller.signal,
      onProgress: setProgress,
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
        }
      });

    return () => controller.abort();
  }, [activeTopics, config, endTime, hasPlotPaths, player, randomAccessByTopic, startTime]);

  const rebuildChart = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    uplotRef.current?.destroy();
    uplotRef.current = null;

    const colors = readPlotChartColors();
    const options = createPlotUplotOptions(dataset, hiddenSeries, {
      panelId,
      xAxisMode: config.xAxisMode,
      xRange,
      logStart: startTime,
      getCurrentTimeSec: () => currentTimeSecRef.current,
      colors,
    });

    uplotRef.current = mountPlotChart(container, dataset, options, xRange);

    const observer = new ResizeObserver(() => {
      const chart = uplotRef.current;
      if (!container || !chart) return;
      chart.setSize({
        width: container.offsetWidth || 400,
        height: Math.max(container.offsetHeight || 200, 100),
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [config.xAxisMode, dataset, hiddenSeries, panelId, startTime, xRange]);

  useEffect(() => {
    const cleanup = rebuildChart();
    return () => {
      cleanup?.();
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  }, [rebuildChart]);

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

  const updatePrimaryTopic = (topic: string) => {
    const primaryId = config.series[0]?.id;
    if (primaryId) void applyTopicDetection(primaryId, topic);
  };

  const handleJointStateFieldsChange = (fields: JointStateField[]) => {
    setConfig((prev) => {
      const topic = prev.series[0]?.topic ?? '';
      const schema = topic ? topicByName.get(topic)?.type : undefined;
      const next: PlotConfig = { ...prev, jointStateFields: fields };
      if (topic && schema && isJointStateSchema(schema)) {
        next.series = rebuildJointStateSeries(prev.series, topic, schema, fields);
      }
      return next;
    });
  };

  const jointFieldLabels = useMemo(
    (): Record<JointStateField, string> => ({
      position: formatMessage({ id: 'panels.jointStatePlot.toolbar.field.position' }),
      velocity: formatMessage({ id: 'panels.jointStatePlot.toolbar.field.velocity' }),
      effort: formatMessage({ id: 'panels.jointStatePlot.toolbar.field.effort' }),
    }),
    [formatMessage],
  );

  const primaryWarning = dataset.warnings[0];
  const warningText = primaryWarning
    ? formatPlotDatasetWarning(primaryWarning, formatMessage)
    : undefined;

  const hasSeries = activeTopics.length > 0 && hasPlotPaths;
  const status = detectingTopic
    ? formatMessage({ id: 'panels.plot.status.detectingPaths' })
    : loading
      ? progress
        ? formatMessage(
            { id: 'panels.plot.status.loadingProgress' },
            { count: progress.messages.toLocaleString() },
          )
        : formatMessage({ id: 'panels.plot.status.loading' })
      : error
        ? error
        : hasSeries && dataset.sampleRatio < 1
          ? formatMessage(
              { id: 'panels.plot.status.sampling' },
              { percent: Math.round(dataset.sampleRatio * 100) },
            )
          : null;

  const handleChartClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const chart = uplotRef.current;
    if (!chart || config.xAxisMode !== 'timestamp') return;
    const rect = chart.root.getBoundingClientRect();
    const x = chart.posToVal(event.clientX - rect.left, 'x');
    if (Number.isFinite(x)) {
      player.seek(secToTime(x));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted px-2 py-1">
        <div className="min-w-0 flex-1 max-w-xs">
          <TopicQuickPicker
            value={primary?.topic ?? ''}
            onChange={updatePrimaryTopic}
            topics={plottableTopics}
            placeholder={formatMessage({ id: 'panels.plot.toolbar.selectTopic' })}
            triggerClassName="h-[24px] text-[11px] px-2"
          />
        </div>
        {showJointStateFields && (
          <JointStateFieldChips
            fields={config.jointStateFields}
            fieldLabels={jointFieldLabels}
            onChange={handleJointStateFieldsChange}
          />
        )}
        {status && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{status}</span>
        )}
      </div>
      <div className="relative min-h-0 flex-1 flex flex-col">
        <div
          ref={containerRef}
          className="min-h-0 flex-1 w-full overflow-hidden"
          onClick={handleChartClick}
        />
        {!hasSeries && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {formatMessage({ id: 'panels.plot.empty.selectTopic' })}
          </div>
        )}
        {hasSeries && !loading && !detectingTopic && !error && dataset.pointCount === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {formatMessage({ id: 'panels.plot.empty.noNumericData' })}
          </div>
        )}
        {warningText && (
          <div className="absolute bottom-1 left-1 max-w-[70%] rounded border border-border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground">
            {warningText}
          </div>
        )}
      </div>
    </div>
  );
};
