import { describe, expect, it, vi } from 'vitest';
import type { Player } from '@/core/types/player';
import type { MessageEvent } from '@/core/types/ros';
import { readPlotRangeIncremental } from './rangeReader';

function event(sec: number, data = sec): MessageEvent {
  return {
    topic: '/value',
    receiveTime: { sec, nsec: 0 },
    publishTime: { sec, nsec: 0 },
    message: { data },
    schemaName: 'std_msgs/msg/Float64',
  };
}

function playerWithStream(batches: MessageEvent[][]): Player {
  return {
    streamMessagesInTimeRange: async function* () {
      for (const batch of batches) {
        yield batch;
      }
    },
    getMessagesInTimeRange: vi.fn(),
  } as unknown as Player;
}

describe('readPlotRangeIncremental', () => {
  it('emits batches from streamMessagesInTimeRange as they arrive', async () => {
    const first = event(1);
    const second = event(2);
    const player = playerWithStream([[first], [second]]);
    const batches: MessageEvent[][] = [];

    const messages = await readPlotRangeIncremental({
      player,
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      topics: ['/value'],
      onBatch: ({ messages: batch }) => batches.push(batch),
    });

    expect(batches).toEqual([[first], [second]]);
    expect(messages).toEqual([first, second]);
  });

  it('dedupes repeated messages before invoking onBatch', async () => {
    const first = event(1);
    const second = event(2);
    const progressMessages: number[] = [];
    const batches: MessageEvent[][] = [];

    await readPlotRangeIncremental({
      player: playerWithStream([[first, first], [second]]),
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      topics: ['/value'],
      onBatch: ({ messages }) => batches.push(messages),
      onProgress: (progress) => progressMessages.push(progress.messages),
    });

    expect(batches).toEqual([[first], [second]]);
    expect(progressMessages).toContain(1);
    expect(progressMessages).toContain(2);
  });

  it('falls back to getMessagesInTimeRange when streaming is unavailable', async () => {
    const first = event(1);
    const getMessagesInTimeRange = vi.fn(async () => [first]);
    const batches: MessageEvent[][] = [];
    const player = { getMessagesInTimeRange } as unknown as Player;

    const messages = await readPlotRangeIncremental({
      player,
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      topics: ['/value'],
      onBatch: ({ messages: batch }) => batches.push(batch),
    });

    expect(getMessagesInTimeRange).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([[first]]);
    expect(messages).toEqual([first]);
  });

  it('throws AbortError and stops after abort', async () => {
    const first = event(1);
    const controller = new AbortController();
    const onBatch = vi.fn(() => controller.abort());

    await expect(readPlotRangeIncremental({
      player: playerWithStream([[first], [event(2)]]),
      start: { sec: 0, nsec: 0 },
      end: { sec: 5, nsec: 0 },
      topics: ['/value'],
      signal: controller.signal,
      onBatch,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(onBatch).toHaveBeenCalledTimes(1);
  });
});
