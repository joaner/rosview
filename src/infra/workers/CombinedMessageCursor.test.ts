import { describe, expect, it } from 'vitest';
import type { MessageEvent, Time } from '@/core/types/ros';
import type { IMessageCursor } from './types';
import { CombinedMessageCursor, getMessageSourceIndex } from './CombinedMessageCursor';

function msg(topic: string, sec: number, nsec = 0): MessageEvent {
  return {
    topic,
    receiveTime: { sec, nsec },
    publishTime: { sec, nsec },
    message: {},
    schemaName: 'test/Msg',
  };
}

/** Simple in-memory `IMessageCursor` backed by a fixed message list, batched by count. */
function makeMockCursor(messages: MessageEvent[], batchSize = 10): IMessageCursor<unknown> {
  let offset = 0;
  return {
    async next(): Promise<IteratorResult<MessageEvent>> {
      if (offset >= messages.length) return { done: true, value: undefined };
      const value = messages[offset];
      offset += 1;
      return { done: false, value };
    },
    async nextBatch(): Promise<MessageEvent[]> {
      const batch = messages.slice(offset, offset + batchSize);
      offset += batch.length;
      return batch;
    },
    async end(): Promise<void> {
      offset = messages.length;
    },
  };
}

describe('CombinedMessageCursor', () => {
  it('nextBatch merges children in overall receiveTime order', async () => {
    const a = makeMockCursor([msg('/a', 0), msg('/a', 2), msg('/a', 4)]);
    const b = makeMockCursor([msg('/b', 1), msg('/b', 3), msg('/b', 5)]);
    const cursor = new CombinedMessageCursor([
      { cursor: a, sourceIndex: 0 },
      { cursor: b, sourceIndex: 1 },
    ]);

    const batch = await cursor.nextBatch(1000);
    expect(batch.map((m) => [m.topic, m.receiveTime.sec])).toEqual([
      ['/a', 0],
      ['/b', 1],
      ['/a', 2],
      ['/b', 3],
      ['/a', 4],
      ['/b', 5],
    ]);
  });

  it('tags every merged message with its originating member index', async () => {
    const a = makeMockCursor([msg('/a', 0)]);
    const b = makeMockCursor([msg('/b', 1)]);
    const cursor = new CombinedMessageCursor([
      { cursor: a, sourceIndex: 0 },
      { cursor: b, sourceIndex: 5 },
    ]);
    const batch = await cursor.nextBatch(1000);
    const bySourceIndex = new Map(batch.map((m) => [m.topic, getMessageSourceIndex(m)]));
    expect(bySourceIndex.get('/a')).toBe(0);
    expect(bySourceIndex.get('/b')).toBe(5);
  });

  it('next() yields messages across children in overall time order', async () => {
    const a = makeMockCursor([msg('/a', 0), msg('/a', 3)]);
    const b = makeMockCursor([msg('/b', 1), msg('/b', 2)]);
    const cursor = new CombinedMessageCursor([
      { cursor: a, sourceIndex: 0 },
      { cursor: b, sourceIndex: 1 },
    ]);
    const order: Array<[string, number]> = [];
    for (;;) {
      const result = await cursor.next();
      if (result.done) break;
      order.push([result.value.topic, result.value.receiveTime.sec]);
    }
    expect(order).toEqual([
      ['/a', 0],
      ['/b', 1],
      ['/b', 2],
      ['/a', 3],
    ]);
  });

  it('handles an empty child list', async () => {
    const cursor = new CombinedMessageCursor([]);
    expect(await cursor.nextBatch(1000)).toEqual([]);
    expect(await cursor.next()).toEqual({ done: true, value: undefined });
    await expect(cursor.end()).resolves.toBeUndefined();
  });

  it('end() ends every child cursor', async () => {
    let aEnded = false;
    let bEnded = false;
    const a: IMessageCursor<unknown> = {
      next: async () => ({ done: true, value: undefined }),
      nextBatch: async () => [],
      end: async () => {
        aEnded = true;
      },
    };
    const b: IMessageCursor<unknown> = {
      next: async () => ({ done: true, value: undefined }),
      nextBatch: async () => [],
      end: async () => {
        bEnded = true;
      },
    };
    const cursor = new CombinedMessageCursor([
      { cursor: a, sourceIndex: 0 },
      { cursor: b, sourceIndex: 1 },
    ]);
    await cursor.end();
    expect(aEnded).toBe(true);
    expect(bEnded).toBe(true);
  });

  it('respects options.endTime per child batch (pass-through)', async () => {
    const messages = [msg('/a', 0), msg('/a', 1), msg('/a', 10)];
    let receivedEndTime: Time | undefined;
    const a: IMessageCursor<unknown> = {
      next: async () => ({ done: true, value: undefined }),
      nextBatch: async (_durationMs, options) => {
        receivedEndTime = options?.endTime;
        return messages.filter((m) => !options?.endTime || m.receiveTime.sec <= options.endTime.sec);
      },
      end: async () => {},
    };
    const cursor = new CombinedMessageCursor([{ cursor: a, sourceIndex: 0 }]);
    const batch = await cursor.nextBatch(1000, { endTime: { sec: 1, nsec: 0 } });
    expect(receivedEndTime).toEqual({ sec: 1, nsec: 0 });
    expect(batch).toHaveLength(2);
  });
});
