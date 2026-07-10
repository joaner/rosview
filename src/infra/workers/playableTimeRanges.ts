import type { TimeRange } from '@/core/types/ros';
import type { Range } from '@/shared/utils/ranges';
import { fromNano } from '@/shared/utils/time';

export type ChunkCoverage = {
  byteRange: Range;
  timeRange: TimeRange;
  startNs: bigint;
  endNs: bigint;
};

export function isByteRangeCovered(query: Range, downloaded: readonly Range[]): boolean {
  return downloaded.some((range) => range.start <= query.start && range.end >= query.end);
}

/**
 * Map currently-downloaded byte ranges onto chunk time coverage.
 * Returns every contiguous playable segment (not only a prefix from file start),
 * so LRU eviction of early chunks does not collapse the buffer bar to empty.
 */
export function getPlayableTimeRanges(
  chunkCoverage: readonly ChunkCoverage[],
  downloadedByteRanges: readonly Range[],
  maxContiguousGapNs: bigint,
): TimeRange[] {
  if (chunkCoverage.length === 0) {
    return [];
  }

  const ranges: TimeRange[] = [];
  let segmentStart: TimeRange['start'] | undefined;
  let segmentEndNs: bigint | undefined;

  const flush = () => {
    if (segmentStart == undefined || segmentEndNs == undefined) {
      return;
    }
    ranges.push({
      start: { ...segmentStart },
      end: fromNano(segmentEndNs),
    });
    segmentStart = undefined;
    segmentEndNs = undefined;
  };

  for (const chunk of chunkCoverage) {
    const covered = isByteRangeCovered(chunk.byteRange, downloadedByteRanges);
    if (!covered) {
      flush();
      continue;
    }

    if (segmentStart == undefined || segmentEndNs == undefined) {
      segmentStart = chunk.timeRange.start;
      segmentEndNs = chunk.endNs;
      continue;
    }

    if (chunk.startNs > segmentEndNs + maxContiguousGapNs) {
      flush();
      segmentStart = chunk.timeRange.start;
      segmentEndNs = chunk.endNs;
      continue;
    }

    if (chunk.endNs > segmentEndNs) {
      segmentEndNs = chunk.endNs;
    }
  }

  flush();
  return ranges;
}
