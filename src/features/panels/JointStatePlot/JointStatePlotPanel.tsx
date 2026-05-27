import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { messageBus } from '@/core/pipeline/messageBus';
import { useSubscriberSeq } from '@/core/pipeline/useMessageBus';
import { scheduleFrame } from '@/shared/utils/rafScheduler';
import type { Player } from '@/core/types/player';
import type { MessageEvent } from '@/core/types/ros';
import {
  resolveEventTimestamp,
  timeToSec,
  downsampleMinMaxLast,
  type NumericPoint,
  type TimestampMode,
} from '@/core/analysis/timeSeries';
import type { JointField } from './defaults';

interface JointStatePlotComponentProps {
  player: Player;
  panelId: string;
  topic: string;
  field: JointField;
  selectedJoints: string[];
  timestampMode: TimestampMode;
  maxPointsPerJoint: number;
}

interface Accumulator {
  /** X-axis timestamps (seconds). Null entries mark visual gaps between playback segments. */
  timestamps: (number | null)[];
  /** One value array per joint, aligned with `timestamps`. */
  perJoint: (number | null)[][];
  /** Joint names in arrival order. */
  jointNames: string[];
  /** Last real (non-null) timestamp, used for gap detection. */
  lastTs: number;
  /** Exponential moving average of the inter-message interval (seconds). */
  typicalInterval: number;
  /** Count of real (non-null) rows, used for downsampling threshold checks. */
  realRowCount: number;
}

/** How many times the typical interval must be exceeded to insert a gap row. */
const GAP_FACTOR = 3;
/** Minimum time delta (seconds) considered a gap, regardless of message rate. */
const MIN_GAP_SEC = 0.5;

function makeAccumulator(): Accumulator {
  return {
    timestamps: [],
    perJoint: [],
    jointNames: [],
    lastTs: -Infinity,
    typicalInterval: 0.02,
    realRowCount: 0,
  };
}

function extractJointArray(msg: unknown, field: JointField): ArrayLike<number> | null {
  if (!msg || typeof msg !== 'object') return null;
  const arr = (msg as Record<string, unknown>)[field];
  if (arr == null || typeof arr !== 'object' || !('length' in arr)) return null;
  const len = (arr as ArrayLike<unknown>).length;
  if (typeof len !== 'number' || len === 0) return null;
  return arr as ArrayLike<number>;
}

function extractJointNames(msg: unknown): string[] | null {
  if (!msg || typeof msg !== 'object') return null;
  const names = (msg as Record<string, unknown>).name;
  if (!names || typeof names !== 'object' || !('length' in names)) return null;
  const len = (names as ArrayLike<unknown>).length;
  if (typeof len !== 'number' || len === 0) return null;
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const n = (names as ArrayLike<unknown>)[i];
    out.push(typeof n === 'string' ? n : `joint_${i}`);
  }
  return out;
}

/**
 * Append a batch of MessageEvents into the accumulator.
 * Returns whether the joint name topology changed (caller should trigger a
 * re-render so uPlot can be rebuilt with the new series count).
 */
function appendEvents(
  acc: Accumulator,
  events: MessageEvent[],
  field: JointField,
  timestampMode: TimestampMode,
): { topologyChanged: boolean; hasNewData: boolean } {
  let topologyChanged = false;
  let hasNewData = false;

  for (const event of events) {
    const values = extractJointArray(event.message, field);
    if (!values) continue;

    const names = extractJointNames(event.message);
    if (!names || names.length !== values.length) continue;

    if (
      acc.jointNames.length !== names.length ||
      names.some((n, i) => n !== acc.jointNames[i])
    ) {
      acc.timestamps = [];
      acc.perJoint = Array.from({ length: names.length }, () => []);
      acc.jointNames = names;
      acc.lastTs = -Infinity;
      acc.realRowCount = 0;
      topologyChanged = true;
    }

    const resolved = resolveEventTimestamp(event, timestampMode);
    const ts = timeToSec(resolved.time);

    if (acc.lastTs > -Infinity) {
      const gap = ts - acc.lastTs;
      const threshold = Math.max(acc.typicalInterval * GAP_FACTOR, MIN_GAP_SEC);
      if (gap > threshold) {
        acc.timestamps.push((acc.lastTs + ts) / 2);
        for (const series of acc.perJoint) series.push(null);
      }
    }

    acc.timestamps.push(ts);
    for (let i = 0; i < acc.jointNames.length; i++) {
      const v = (values)[i];
      acc.perJoint[i].push(typeof v === 'number' && Number.isFinite(v) ? v : null);
    }

    if (acc.lastTs > -Infinity && ts > acc.lastTs) {
      const interval = ts - acc.lastTs;
      if (interval < MIN_GAP_SEC) {
        acc.typicalInterval = acc.typicalInterval * 0.9 + interval * 0.1;
      }
    }
    acc.lastTs = ts;
    acc.realRowCount += 1;
    hasNewData = true;
  }

  return { topologyChanged, hasNewData };
}

/**
 * Downsample each joint series independently using min/max/last bucketing,
 * preserving null gap rows so segment boundaries remain visible.
 */
function downsampleAccumulator(acc: Accumulator, maxPointsPerJoint: number): void {
  if (acc.jointNames.length === 0 || acc.timestamps.length <= maxPointsPerJoint) return;

  const realIndices: number[] = [];
  for (let i = 0; i < acc.timestamps.length; i++) {
    if (acc.timestamps[i] !== null) realIndices.push(i);
  }
  if (realIndices.length <= maxPointsPerJoint) return;

  const survivingIndexSets: Set<number>[] = acc.perJoint.map((series) => {
    const points: NumericPoint[] = realIndices
      .map((ri) => ({ x: acc.timestamps[ri] as number, y: series[ri] }))
      .filter((p): p is NumericPoint => p.y !== null && p.x !== null);
    const downsampled = downsampleMinMaxLast(points, maxPointsPerJoint);
    const xSet = new Set(downsampled.map((p) => p.x));
    const out = new Set<number>();
    for (const ri of realIndices) {
      if (xSet.has(acc.timestamps[ri] as number)) out.add(ri);
    }
    return out;
  });

  const survivingIndices = new Set<number>();
  for (let i = 0; i < acc.timestamps.length; i++) {
    if (acc.timestamps[i] === null) survivingIndices.add(i);
  }
  for (const set of survivingIndexSets) {
    for (const idx of set) survivingIndices.add(idx);
  }

  const sorted = Array.from(survivingIndices).sort((a, b) => a - b);
  acc.timestamps = sorted.map((i) => acc.timestamps[i]);
  for (let j = 0; j < acc.perJoint.length; j++) {
    acc.perJoint[j] = sorted.map((i) => acc.perJoint[j][i]);
  }
}

/** Build a valid empty uPlot aligned-data structure for `seriesCount` series. */
function makeEmptyUplotData(seriesCount: number): uPlot.AlignedData {
  return [[], ...Array.from({ length: seriesCount }, () => [])] as uPlot.AlignedData;
}

function buildUplotData(acc: Accumulator): uPlot.AlignedData {
  return [acc.timestamps, ...acc.perJoint] as uPlot.AlignedData;
}

function seriesColor(index: number): string {
  return `hsl(${(index * 137.508) % 360}, 70%, 50%)`;
}

export const JointStatePlotComponent: React.FC<JointStatePlotComponentProps> = ({
  player,
  panelId,
  topic,
  field,
  selectedJoints,
  timestampMode,
  maxPointsPerJoint,
}) => {
  const { formatMessage } = useIntl();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const uplotRef = useRef<uPlot | null>(null);
  const accRef = useRef<Accumulator>(makeAccumulator());
  const setDataPendingRef = useRef(false);
  const cancelFlushRef = useRef<(() => void) | null>(null);

  /**
   * Incremented whenever joint topology changes (new names / count).
   * Changing this value triggers the uPlot rebuild effect below.
   */
  const [topologyVersion, setTopologyVersion] = useState(0);

  useEffect(() => {
    if (!topic) {
      player.unregisterSubscriptions(panelId);
      return;
    }
    player.registerSubscriptions(panelId, [{ topic, subscriberId: panelId }]);
    return () => player.unregisterSubscriptions(panelId);
  }, [player, panelId, topic]);

  useEffect(() => {
    accRef.current = makeAccumulator();
    setTopologyVersion(0);
    if (cancelFlushRef.current) {
      cancelFlushRef.current();
      cancelFlushRef.current = null;
      setDataPendingRef.current = false;
    }
    uplotRef.current?.setData(makeEmptyUplotData(0));
  }, [topic, field, timestampMode]);

  const scheduleSetData = useCallback(() => {
    if (setDataPendingRef.current || !uplotRef.current) return;
    setDataPendingRef.current = true;
    cancelFlushRef.current = scheduleFrame(() => {
      setDataPendingRef.current = false;
      cancelFlushRef.current = null;
      uplotRef.current?.setData(buildUplotData(accRef.current));
    });
  }, []);

  const subscriberSeq = useSubscriberSeq(panelId);
  useEffect(() => {
    const messages = messageBus.getSubscriberMessages(panelId);
    if (!messages || messages.length === 0) return;

    const acc = accRef.current;
    const { topologyChanged, hasNewData } = appendEvents(acc, messages, field, timestampMode);

    if (!hasNewData) return;

    const threshold = Math.floor(maxPointsPerJoint * 1.5);
    if (acc.realRowCount > threshold) {
      downsampleAccumulator(acc, maxPointsPerJoint);
    }

    if (topologyChanged) {
      setTopologyVersion((v) => v + 1);
      return;
    }

    scheduleSetData();
  }, [subscriberSeq, panelId, field, timestampMode, maxPointsPerJoint, scheduleSetData]);

  const jointNames = useMemo(
    () => accRef.current.jointNames,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologyVersion],
  );

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container || jointNames.length === 0) return;

    const opts: uPlot.Options = {
      title: '',
      id: panelId,
      width: container.offsetWidth || 400,
      height: Math.max((container.offsetHeight || 200) - 30, 80),
      series: [
        { label: formatMessage({ id: 'panels.jointStatePlot.axis.time' }) },
        ...jointNames.map((name, i) => ({
          label: name,
          stroke: seriesColor(i),
          width: 1.5,
          points: { show: false },
          spanGaps: false,
        })),
      ],
      axes: [
        { grid: { show: true }, stroke: '#888', font: '10px sans-serif' },
        { grid: { show: true }, stroke: '#888', font: '10px sans-serif' },
      ],
      cursor: { drag: { setScale: true } },
      legend: { show: false },
      scales: { x: { time: true } },
    };

    const u = new uPlot(opts, buildUplotData(accRef.current), container);
    uplotRef.current = u;

    for (let i = 0; i < jointNames.length; i++) {
      const visible = selectedJoints.length === 0 || selectedJoints.includes(jointNames[i]);
      u.setSeries(i + 1, { show: visible });
    }

    const observer = new ResizeObserver(() => {
      if (chartContainerRef.current && uplotRef.current) {
        uplotRef.current.setSize({
          width: chartContainerRef.current.offsetWidth,
          height: Math.max(chartContainerRef.current.offsetHeight - 30, 80),
        });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      if (cancelFlushRef.current) {
        cancelFlushRef.current();
        cancelFlushRef.current = null;
        setDataPendingRef.current = false;
      }
      u.destroy();
      uplotRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuild when locale/time label changes
  }, [panelId, topologyVersion, formatMessage]);

  useEffect(() => {
    const u = uplotRef.current;
    if (!u) return;
    const names = accRef.current.jointNames;
    for (let i = 0; i < names.length; i++) {
      const visible = selectedJoints.length === 0 || selectedJoints.includes(names[i]);
      u.setSeries(i + 1, { show: visible });
    }
    u.redraw();
  }, [selectedJoints]);

  return <div ref={chartContainerRef} className="flex-1 min-h-0 w-full overflow-hidden" />;
};
