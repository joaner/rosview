import { rangeQueryCache } from '@/core/analysis/rangeQueryCache';
import type { GetMessagesInTimeRangeArgs, Player } from '@/core/types/player';
import type { MessageEvent, Time } from '@/core/types/ros';
import { fromNano, toNano } from '@/shared/utils/time';

export interface PlotRangeReadProgress {
  completed: number;
  total: number;
  messages: number;
}

export interface PlotRangeReadArgs {
  player: Player;
  start: Time;
  end: Time;
  topics: string[];
  signal?: AbortSignal;
  onProgress?: (progress: PlotRangeReadProgress) => void;
  /** Stop accumulating after this many messages (non-indexed sources). */
  maxMessages?: number;
}

const DEFAULT_SEGMENTS = 24;

function makeSegments(start: Time, end: Time): Array<{ start: Time; end: Time }> {
  const startNs = toNano(start);
  const endNs = toNano(end);
  if (endNs <= startNs) return [{ start, end }];
  const span = endNs - startNs;
  const segmentCount = Number(span) < 10_000_000_000 ? 1 : DEFAULT_SEGMENTS;
  const step = span / BigInt(segmentCount);
  const segments: Array<{ start: Time; end: Time }> = [];
  let cursor = startNs;
  for (let i = 0; i < segmentCount; i++) {
    const segmentEnd = i === segmentCount - 1 ? endNs : cursor + step;
    segments.push({ start: fromNano(cursor), end: fromNano(segmentEnd) });
    cursor = segmentEnd + 1n;
  }
  return segments;
}

function messageKey(event: MessageEvent): string {
  const receive = toNano(event.receiveTime).toString();
  const publish = event.publishTime ? toNano(event.publishTime).toString() : '';
  return `${event.topic}|${event.schemaName}|${receive}|${publish}`;
}

async function readSegment(player: Player, args: GetMessagesInTimeRangeArgs): Promise<MessageEvent[]> {
  if (!player.getMessagesInTimeRange) return [];
  return rangeQueryCache.getOrCreate(player, args);
}

export async function readPlotRange({
  player,
  start,
  end,
  topics,
  signal,
  onProgress,
  maxMessages,
}: PlotRangeReadArgs): Promise<MessageEvent[]> {
  if (topics.length === 0 || !player.getMessagesInTimeRange) return [];
  const uniqueTopics = Array.from(new Set(topics)).sort();
  const segments = makeSegments(start, end);
  const deduped = new Map<string, MessageEvent>();
  const messageLimit = maxMessages != null && maxMessages > 0 ? maxMessages : undefined;

  for (let i = 0; i < segments.length; i++) {
    if (signal?.aborted) {
      throw new DOMException('Plot range read aborted', 'AbortError');
    }
    if (messageLimit != null && deduped.size >= messageLimit) {
      break;
    }
    const segment = segments[i];
    const messages = await readSegment(player, {
      start: segment.start,
      end: segment.end,
      topics: uniqueTopics,
    });
    for (const event of messages) {
      deduped.set(messageKey(event), event);
      if (messageLimit != null && deduped.size >= messageLimit) {
        break;
      }
    }
    onProgress?.({ completed: i + 1, total: segments.length, messages: deduped.size });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  }

  return [...deduped.values()].sort((a, b) => {
    const diff = toNano(a.receiveTime) - toNano(b.receiveTime);
    return diff < 0n ? -1 : diff > 0n ? 1 : a.topic.localeCompare(b.topic);
  });
}
