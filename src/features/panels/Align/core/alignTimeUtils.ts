import type { MessageEvent } from '@/core/types/ros';
import { toNano } from '@/shared/utils/time';

export type AlignPlotTimeMode = 'receiveTime' | 'headerStamp';

export type AlignPoint = {
  topic: string;
  /** Time used for X position */
  plotNs: bigint;
  receiveNs: bigint;
  stampNs: bigint | null;
};

export function receiveTimeNs(ev: MessageEvent): bigint {
  return toNano(ev.receiveTime);
}

export function headerStampNsFromMessage(message: Record<string, unknown> | null | undefined): bigint | null {
  if (!message) {
    return null;
  }
  const header = message.header as { stamp?: { sec?: number; nsec?: number } } | undefined;
  const stamp = header?.stamp;
  if (stamp && typeof stamp.sec === 'number' && typeof stamp.nsec === 'number') {
    return BigInt(stamp.sec) * 1_000_000_000n + BigInt(stamp.nsec);
  }
  return null;
}

/**
 * X-axis time for the Align plot.
 * - receiveTime: log receive time
 * - headerStamp: header stamp when present, else receive time (matches image sort semantics)
 */
export function plotTimeNsForMessage(ev: MessageEvent, mode: AlignPlotTimeMode): bigint {
  if (mode === 'receiveTime') {
    return receiveTimeNs(ev);
  }
  const stamp = headerStampNsFromMessage(ev.message as Record<string, unknown>);
  return stamp ?? receiveTimeNs(ev);
}

export function messageToAlignPoint(ev: MessageEvent, mode: AlignPlotTimeMode): AlignPoint {
  return {
    topic: ev.topic,
    plotNs: plotTimeNsForMessage(ev, mode),
    receiveNs: receiveTimeNs(ev),
    stampNs: headerStampNsFromMessage(ev.message as Record<string, unknown>),
  };
}

export function filterPointsInWindow(
  points: readonly AlignPoint[],
  centerNs: bigint,
  halfWindowNs: bigint,
): AlignPoint[] {
  const lo = centerNs - halfWindowNs;
  const hi = centerNs + halfWindowNs;
  return points.filter((p) => p.plotNs >= lo && p.plotNs <= hi);
}

export function formatOffsetMs(plotNs: bigint, centerNs: bigint): string {
  const deltaMs = Number((plotNs - centerNs) / 1_000_000n);
  const sign = deltaMs >= 0 ? '+' : '';
  return `${sign}${deltaMs} ms`;
}
