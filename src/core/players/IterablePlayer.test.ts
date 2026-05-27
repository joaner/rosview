import { afterEach, describe, expect, it, vi } from 'vitest';
import { IterablePlayer } from './IterablePlayer';
import { messageBus } from '@/core/pipeline/messageBus';
import { useMessagePipelineStore } from '@/core/pipeline/store';
import type { Initialization, MessageEvent } from '@/core/types/ros';
import type { PlayerState } from '@/core/types/player';
import type { WorkerSerializedSource } from '@/infra/workers/WorkerSerializedSource';

const TOPIC = '/camera/front/image/compressed';

function makeInitialization(): Initialization {
  return {
    topics: [{ name: TOPIC, type: 'sensor_msgs/CompressedImage' }],
    datatypes: {},
    start: { sec: 0, nsec: 0 },
    end: { sec: 10, nsec: 0 },
    publishersByTopic: {},
    topicStats: {},
    problems: [],
  };
}

function makeInitializationWithTopicStats(): Initialization {
  return {
    topics: [{ name: TOPIC, type: 'sensor_msgs/CompressedImage' }],
    datatypes: {},
    start: { sec: 0, nsec: 0 },
    end: { sec: 10, nsec: 0 },
    publishersByTopic: {},
    topicStats: {
      [TOPIC]: {
        messageCount: 120,
        frequency: 30,
        durationSec: 4,
      },
    },
    problems: [],
  };
}

function makeImageMessage(): MessageEvent {
  return {
    topic: TOPIC,
    schemaName: 'sensor_msgs/CompressedImage',
    receiveTime: { sec: 1, nsec: 0 },
    publishTime: { sec: 1, nsec: 0 },
    message: {
      format: 'jpeg',
      data: new Uint8Array([1, 2, 3, 4]),
    },
  };
}

function makeImageMessageAt(sec: number): MessageEvent {
  return {
    ...makeImageMessage(),
    receiveTime: { sec, nsec: 0 },
    publishTime: { sec, nsec: 0 },
  };
}

function makeSource(messages: MessageEvent[]): WorkerSerializedSource {
  return {
    initialize: vi.fn(async () => makeInitialization()),
    getTransportDiagnostics: vi.fn(async () => ({
      mode: 'transfer',
      crossOriginIsolated: false,
      binaryPayloadThresholdBytes: 64 * 1024,
      droppedPayloads: 0,
      stalePayloadRefs: 0,
    })),
    getLoadProgress: vi.fn(async () => ({
      percent: 100,
      totalBytes: 0,
      downloadedByteRanges: [],
      parsedMessageRanges: [],
    })),
    getBackfillMessages: vi.fn(async () => messages),
    getMessageCursor: vi.fn(),
    getAdjacentMessage: vi.fn(),
    resolveMessageBatch: vi.fn((batch: MessageEvent[]) => batch),
    resolveMessageForHighFrequencyLane: vi.fn((message: MessageEvent) => message),
    terminate: vi.fn(),
    getTransportMode: vi.fn(() => 'transfer'),
    getTransportFallbackReason: vi.fn(() => undefined),
  } as unknown as WorkerSerializedSource;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  messageBus.reset();
});

describe('IterablePlayer high-frequency lane', () => {
  it('routes video-only topics outside the generic message bus', async () => {
    const source = makeSource([makeImageMessage()]);
    const player = new IterablePlayer(source);
    const onLatestMessage = vi.fn();

    await player.initialize({});
    player.registerHighFrequencyConsumer('image-panel', {
      topic: TOPIC,
      lane: 'video',
      onLatestMessage,
    });
    await flushAsyncWork();

    expect(onLatestMessage).toHaveBeenCalledTimes(1);
    expect(source.resolveMessageForHighFrequencyLane).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPIC }),
      { preferSharedView: true, copyPayload: false },
    );
    expect(messageBus.getLastMessage(TOPIC)).toBeNull();
    expect(source.getBackfillMessages).toHaveBeenCalledWith({
      time: { sec: 0, nsec: 0 },
      topics: [TOPIC],
    });

    player.close();
  });

  it('keeps shared topics on the generic lane when a normal subscriber exists', async () => {
    const source = makeSource([makeImageMessage()]);
    const player = new IterablePlayer(source);
    const onLatestMessage = vi.fn();

    await player.initialize({});
    player.registerSubscriptions('raw-panel', [{ topic: TOPIC, subscriberId: 'raw-panel' }]);
    await flushAsyncWork();
    player.registerHighFrequencyConsumer('image-panel', {
      topic: TOPIC,
      lane: 'video',
      onLatestMessage,
    });
    await flushAsyncWork();

    expect(onLatestMessage).toHaveBeenCalled();
    expect(source.resolveMessageForHighFrequencyLane).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPIC }),
      { preferSharedView: false, copyPayload: true },
    );
    expect(messageBus.getLastMessage(TOPIC)).not.toBeNull();
    expect(messageBus.getSubscriberMessages('raw-panel')).toHaveLength(1);

    player.close();
  });

  it('isolates payloads when multiple video consumers share one topic', async () => {
    const source = makeSource([makeImageMessage()]);
    const player = new IterablePlayer(source);
    const firstConsumer = vi.fn();
    const secondConsumer = vi.fn();

    await player.initialize({});
    player.registerHighFrequencyConsumer('image-panel-a', {
      topic: TOPIC,
      lane: 'video',
      onLatestMessage: firstConsumer,
    });
    player.registerHighFrequencyConsumer('image-panel-b', {
      topic: TOPIC,
      lane: 'video',
      onLatestMessage: secondConsumer,
    });
    await flushAsyncWork();

    expect(firstConsumer).toHaveBeenCalled();
    expect(secondConsumer).toHaveBeenCalled();
    expect(source.resolveMessageForHighFrequencyLane).toHaveBeenLastCalledWith(
      expect.objectContaining({ topic: TOPIC }),
      { preferSharedView: false, copyPayload: true },
    );

    player.close();
  });

  it('delivers ordered high-frequency batches without marking the topic latest-only', async () => {
    const oldRequestAnimationFrame = globalThis.requestAnimationFrame;
    const oldCancelAnimationFrame = globalThis.cancelAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      setTimeout(() => cb(performance.now()), 0);
      return 1;
    };
    globalThis.cancelAnimationFrame = vi.fn() as typeof cancelAnimationFrame;
    const first = makeImageMessage();
    const second = {
      ...makeImageMessage(),
      receiveTime: { sec: 2, nsec: 0 },
    };
    const source = makeSource([first]);
    const cursor = {
      nextBatch: vi.fn(async () => [first, second]),
      end: vi.fn(),
    };
    vi.mocked(source.getMessageCursor).mockResolvedValue(cursor as never);
    const player = new IterablePlayer(source);
    const onMessageBatch = vi.fn();

    try {
      await player.initialize({});
      player.registerHighFrequencyConsumer('image-panel', {
        topic: TOPIC,
        lane: 'video',
        mode: 'all',
        onMessageBatch,
      });
      await flushAsyncWork();
      player.play();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await flushAsyncWork();

      expect(source.getMessageCursor).toHaveBeenCalledWith(
        expect.objectContaining({
          topics: [TOPIC],
          latestOnlyTopics: [],
        }),
      );
      expect(onMessageBatch).toHaveBeenCalledWith([
        expect.objectContaining({ topic: TOPIC }),
        expect.objectContaining({ receiveTime: { sec: 2, nsec: 0 } }),
      ]);
    } finally {
      player.close();
      globalThis.requestAnimationFrame = oldRequestAnimationFrame;
      globalThis.cancelAnimationFrame = oldCancelAnimationFrame;
    }
  });
});

describe('IterablePlayer playback clock', () => {
  it('emits the current time immediately when subscribing', async () => {
    const source = makeSource([]);
    const player = new IterablePlayer(source);
    const seenTimes: number[] = [];

    vi.mocked(source.initialize).mockResolvedValueOnce({
      ...makeInitialization(),
      start: { sec: 2, nsec: 500_000_000 },
    });
    await player.initialize({});
    const unsubscribe = player.subscribeCurrentTime((time) => {
      seenTimes.push(time.sec + time.nsec / 1e9);
    });

    expect(seenTimes).toEqual([2.5]);

    unsubscribe();
    player.close();
  });

  it('returns current time through the imperative getter', async () => {
    const source = makeSource([]);
    const player = new IterablePlayer(source);

    await player.initialize({});
    expect(player.getCurrentTime()).toEqual({ sec: 0, nsec: 0 });

    player.seek({ sec: 3, nsec: 250_000_000 });
    await flushAsyncWork();
    expect(player.getCurrentTime()).toEqual({ sec: 3, nsec: 250_000_000 });

    player.close();
  });

  it('does not advance pipeline-store currentTime on pure playback ticks', async () => {
    let now = 0;
    let nextRafId = 1;
    const oldPerformanceNow = performance.now;
    const oldRequestAnimationFrame = globalThis.requestAnimationFrame;
    const oldCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => now,
    });
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    globalThis.cancelAnimationFrame = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });

    const source = makeSource([]);
    const player = new IterablePlayer(source);
    const seenTimes: number[] = [];

    try {
      await player.initialize({});
      player.play();
      const pipelineTimeBefore = useMessagePipelineStore.getState().playerState.activeData?.currentTime;
      const unsubscribeTime = player.subscribeCurrentTime((time) => {
        seenTimes.push(time.sec + time.nsec / 1e9);
      });

      now = 1000;
      const firstRaf = Math.min(...rafCallbacks.keys());
      rafCallbacks.get(firstRaf)?.(now);
      await flushAsyncWork();

      expect(seenTimes.at(-1)).toBeCloseTo(1, 3);
      expect(player.getCurrentTime()).toEqual({ sec: 1, nsec: 0 });
      expect(useMessagePipelineStore.getState().playerState.activeData?.currentTime).toBe(
        pipelineTimeBefore,
      );

      unsubscribeTime();
    } finally {
      player.close();
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: oldPerformanceNow,
      });
      globalThis.requestAnimationFrame = oldRequestAnimationFrame;
      globalThis.cancelAnimationFrame = oldCancelAnimationFrame;
    }
  });

  it('does not catch up wall time elapsed while the page is hidden', async () => {
    let now = 0;
    const oldPerformanceNow = performance.now;
    const oldRequestAnimationFrame = globalThis.requestAnimationFrame;
    const oldCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const oldDocument = globalThis.document;
    const oldWindow = globalThis.window;
    const listeners = new Map<string, EventListener[]>();
    let hidden = false;
    let nextRafId = 1;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    const fakeDocument = {
      get hidden() {
        return hidden;
      },
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== listener));
      }),
    };
    const fakeWindow = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { search: '' },
    };
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => now,
    });
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    globalThis.cancelAnimationFrame = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });
    const source = makeSource([]);
    const cursor = {
      nextBatch: vi.fn(async () => []),
      end: vi.fn(),
    };
    vi.mocked(source.getMessageCursor).mockResolvedValue(cursor as never);
    const player = new IterablePlayer(source);
    const seenTimes: number[] = [];

    try {
      await player.initialize({});
      player.registerSubscriptions('panel', [{ topic: TOPIC, subscriberId: 'panel' }]);
      await flushAsyncWork();
      player.subscribeCurrentTime((time) => {
        seenTimes.push(time.sec + time.nsec / 1e9);
      });
      player.play();

      now = 1000;
      rafCallbacks.get(1)?.(now);
      await flushAsyncWork();
      expect(seenTimes.at(-1)).toBeCloseTo(1, 3);

      hidden = true;
      for (const listener of listeners.get('visibilitychange') ?? []) {
        listener(new Event('visibilitychange'));
      }
      now = 11_000;
      hidden = false;
      for (const listener of listeners.get('visibilitychange') ?? []) {
        listener(new Event('visibilitychange'));
      }

      const nextVisibleRaf = Math.max(...rafCallbacks.keys());
      now = 11_050;
      rafCallbacks.get(nextVisibleRaf)?.(now);
      await flushAsyncWork();

      expect(seenTimes.at(-1)).toBeLessThan(1.2);
    } finally {
      player.close();
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: oldPerformanceNow,
      });
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: oldDocument,
      });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: oldWindow,
      });
      globalThis.requestAnimationFrame = oldRequestAnimationFrame;
      globalThis.cancelAnimationFrame = oldCancelAnimationFrame;
    }
  });

  it('does not let an in-flight playback batch overwrite a backward seek', async () => {
    let now = 0;
    let nextRafId = 1;
    const oldPerformanceNow = performance.now;
    const oldRequestAnimationFrame = globalThis.requestAnimationFrame;
    const oldCancelAnimationFrame = globalThis.cancelAnimationFrame;
    const rafCallbacks = new Map<number, FrameRequestCallback>();
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => now,
    });
    globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, cb);
      return id;
    });
    globalThis.cancelAnimationFrame = vi.fn((id: number) => {
      rafCallbacks.delete(id);
    });

    const delayedBatch = deferred<MessageEvent[]>();
    const source = makeSource([]);
    const cursor = {
      nextBatch: vi.fn(() => delayedBatch.promise),
      end: vi.fn(async () => undefined),
    };
    vi.mocked(source.getMessageCursor).mockResolvedValue(cursor as never);
    const player = new IterablePlayer(source);
    const seenTimes: number[] = [];

    try {
      await player.initialize({});
      player.registerSubscriptions('panel', [{ topic: TOPIC, subscriberId: 'panel' }]);
      await flushAsyncWork();
      player.seek({ sec: 7, nsec: 0 });
      await flushAsyncWork();
      player.subscribeCurrentTime((time) => {
        seenTimes.push(time.sec + time.nsec / 1e9);
      });
      player.play();

      now = 100;
      rafCallbacks.get(1)?.(now);
      await Promise.resolve();
      expect(cursor.nextBatch).toHaveBeenCalled();

      player.seek({ sec: 5, nsec: 0 });
      await flushAsyncWork();
      expect(seenTimes.at(-1)).toBe(5);

      delayedBatch.resolve([makeImageMessageAt(7)]);
      await flushAsyncWork();

      expect(seenTimes.at(-1)).toBe(5);
      expect(seenTimes).not.toContain(7.1);
    } finally {
      player.close();
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: oldPerformanceNow,
      });
      globalThis.requestAnimationFrame = oldRequestAnimationFrame;
      globalThis.cancelAnimationFrame = oldCancelAnimationFrame;
    }
  });

  it('keeps the latest seek when older backfill finishes later', async () => {
    const source = makeSource([]);
    const firstBackfill = deferred<MessageEvent[]>();
    const secondBackfill = deferred<MessageEvent[]>();
    vi.mocked(source.getBackfillMessages).mockImplementation(async ({ time }) => {
      if (time.sec === 5) {
        return await firstBackfill.promise;
      }
      if (time.sec === 4) {
        return await secondBackfill.promise;
      }
      return [];
    });
    const player = new IterablePlayer(source);
    const seenTimes: number[] = [];

    try {
      await player.initialize({});
      player.registerSubscriptions('panel', [{ topic: TOPIC, subscriberId: 'panel' }]);
      await flushAsyncWork();
      player.subscribeCurrentTime((time) => {
        seenTimes.push(time.sec + time.nsec / 1e9);
      });

      player.seek({ sec: 5, nsec: 0 });
      await Promise.resolve();
      player.seek({ sec: 4, nsec: 0 });
      await Promise.resolve();

      secondBackfill.resolve([makeImageMessageAt(4)]);
      await flushAsyncWork();
      firstBackfill.resolve([makeImageMessageAt(5)]);
      await flushAsyncWork();

      expect(seenTimes.at(-1)).toBe(4);
      expect(messageBus.getLastMessage(TOPIC)?.receiveTime).toEqual({ sec: 4, nsec: 0 });
    } finally {
      player.close();
    }
  });
});

describe('IterablePlayer topic metadata', () => {
  it('merges duration and count from topic stats into active topics', async () => {
    const source = {
      initialize: vi.fn(async () => makeInitializationWithTopicStats()),
      getTransportDiagnostics: vi.fn(async () => ({
        mode: 'transfer',
        crossOriginIsolated: false,
        binaryPayloadThresholdBytes: 64 * 1024,
        droppedPayloads: 0,
        stalePayloadRefs: 0,
      })),
      getLoadProgress: vi.fn(async () => ({
        percent: 100,
        totalBytes: 0,
        downloadedByteRanges: [],
        parsedMessageRanges: [],
      })),
      getBackfillMessages: vi.fn(async () => []),
      getMessageCursor: vi.fn(),
      getAdjacentMessage: vi.fn(),
      resolveMessageBatch: vi.fn((batch: MessageEvent[]) => batch),
      resolveMessageForHighFrequencyLane: vi.fn((message: MessageEvent) => message),
      terminate: vi.fn(),
      getTransportMode: vi.fn(() => 'transfer'),
      getTransportFallbackReason: vi.fn(() => undefined),
    } as unknown as WorkerSerializedSource;

    const player = new IterablePlayer(source);
    let latestState: PlayerState | undefined;
    player.setListener((state) => {
      latestState = state;
    });

    await player.initialize({});

    expect(latestState).toBeDefined();
    expect(latestState!.activeData?.topics).toEqual([
      expect.objectContaining({
        name: TOPIC,
        messageCount: 120,
        frequency: 30,
        durationSec: 4,
      }),
    ]);

    player.close();
  });
});
