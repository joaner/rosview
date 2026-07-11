import type {
  GetMessagesInTimeRangeArgs,
  HighFrequencyConsumer,
  Player,
  PlayerState,
  Subscription,
} from '@/core/types/player';
import type { MessageEvent, PlayerProblem, Time, TopicInfo, RosDatatypes } from '@/core/types/ros';
import type { LiveBridgeAdapter, LiveBridgeCapabilities } from '@/core/live/bridgeCapabilities';
import { messageBus } from '@/core/pipeline/messageBus';
import { useMessagePipelineStore } from '@/core/pipeline/store';
import { fromNano, toNano } from '@/shared/utils/time';

const PIPELINE_EMIT_INTERVAL_MS = 200;
const DEFAULT_SAMPLING_FPS = 30;

export interface LivePlayerOptions {
  adapter: LiveBridgeAdapter;
  /** Display label for connection (URL). */
  label?: string;
}

/**
 * Player for open-ended live streams (Foxglove WebSocket / future bridges).
 * Reuses messageBus + pipeline store so existing panels work unchanged.
 */
export class LivePlayer implements Player {
  private readonly _adapter: LiveBridgeAdapter;
  private readonly _label: string;
  private _state: PlayerState = { presence: 'preinit', progress: {} };
  private _listener?: (state: PlayerState) => void;
  private _subscriptionsByPanel = new Map<string, Subscription[]>();
  private _subscriberIdsByTopic = new Map<string, string[]>();
  private _highFrequencyConsumersById = new Map<string, HighFrequencyConsumer>();
  private _highFrequencyConsumersByTopic = new Map<string, HighFrequencyConsumer[]>();
  private _isPlaying = true;
  private _currentTime: Time = { sec: 0, nsec: 0 };
  private _startTime: Time = { sec: 0, nsec: 0 };
  private _topics: TopicInfo[] = [];
  private _datatypes: RosDatatypes = {};
  private _capabilities: LiveBridgeCapabilities | undefined;
  private _problems: PlayerProblem[] = [];
  private _timeSubscribers = new Set<(time: Time) => void>();
  private _samplingFps = DEFAULT_SAMPLING_FPS;
  private _lastPipelineEmitMs = 0;
  private _unsubMessage: (() => void) | undefined;
  private _closed = false;
  private _pendingMessages: MessageEvent[] = [];
  private _flushScheduled = false;

  constructor(options: LivePlayerOptions) {
    this._adapter = options.adapter;
    this._label = options.label ?? 'live';
  }

  /** Connection display label (WebSocket URL). */
  get label(): string {
    return this._label;
  }

  get isLive(): true {
    return true;
  }

  get capabilities(): LiveBridgeCapabilities | undefined {
    return this._capabilities;
  }

  async initialize(): Promise<void> {
    if (this._closed) return;
    this._state = { presence: 'initializing', progress: {} };
    this._emitState();

    try {
      const init = await this._adapter.initialize();
      if (this._closed) return;

      this._topics = init.topics;
      this._datatypes = init.datatypes;
      this._startTime = init.startTime;
      this._currentTime = init.startTime;
      this._capabilities = init.capabilities;
      this._isPlaying = true;

      this._unsubMessage = this._adapter.onMessage((event) => {
        this._onLiveMessage(event);
      });

      // Apply any subscriptions panels registered during initialize.
      this._syncBridgeSubscriptions();

      this._state = {
        presence: 'ready',
        progress: { samplingFps: this._samplingFps },
        activeData: {
          topics: this._topics,
          datatypes: this._datatypes,
          publishersByTopic: new Map(),
          startTime: this._startTime,
          endTime: this._currentTime,
          currentTime: this._currentTime,
          isPlaying: this._isPlaying,
          isLooping: false,
          speed: 1,
          problems: this._problems,
          randomAccessByTopic: false,
        },
      };
      messageBus.reset();
      this._emitState();
      // Auto-play for live sources.
      this.play();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._problems = [{ severity: 'error', message }];
      this._state = {
        presence: 'closed',
        progress: {},
        activeData: undefined,
      };
      this._emitState();
      throw err;
    }
  }

  setListener(listener: (state: PlayerState) => void): void {
    this._listener = listener;
    listener(this._state);
  }

  setSubscriptions(subscriptions: Subscription[]): void {
    this._subscriptionsByPanel.clear();
    this._subscriptionsByPanel.set('__legacy__', subscriptions);
    this._rebuildSubscriptions();
  }

  registerSubscriptions(panelId: string, subscriptions: Subscription[]): void {
    this._subscriptionsByPanel.set(panelId, subscriptions);
    this._rebuildSubscriptions();
  }

  unregisterSubscriptions(panelId: string): void {
    this._subscriptionsByPanel.delete(panelId);
    this._rebuildSubscriptions();
  }

  registerHighFrequencyConsumer(consumerId: string, consumer: HighFrequencyConsumer): void {
    this._highFrequencyConsumersById.set(consumerId, consumer);
    this._rebuildHighFrequencyConsumerIndex();
    this._syncBridgeSubscriptions();
  }

  unregisterHighFrequencyConsumer(consumerId: string): void {
    this._highFrequencyConsumersById.delete(consumerId);
    this._rebuildHighFrequencyConsumerIndex();
    this._syncBridgeSubscriptions();
  }

  subscribeCurrentTime(cb: (time: Time) => void): () => void {
    this._timeSubscribers.add(cb);
    cb(this._currentTime);
    return () => {
      this._timeSubscribers.delete(cb);
    };
  }

  getCurrentTime(): Time | undefined {
    return this._currentTime;
  }

  play(): void {
    if (this._closed) return;
    this._isPlaying = true;
    this._emitState();
  }

  pause(): void {
    this._isPlaying = false;
    this._emitState();
  }

  seek(_time: Time): void {
    // Live streams are not seekable.
  }

  stepBy(_deltaMs: number): void {}

  stepMessage(_direction: -1 | 1): void {}

  getMessagesInTimeRange(_args: GetMessagesInTimeRangeArgs): Promise<MessageEvent[]> {
    return Promise.resolve([]);
  }

  setSpeed(_speed: number): void {}

  setSamplingFps(fps: number): void {
    this._samplingFps = Math.max(1, Math.min(60, fps));
  }

  getSamplingFps(): number {
    return this._samplingFps;
  }

  setLooping(_looping: boolean): void {}

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._unsubMessage?.();
    this._unsubMessage = undefined;
    this._adapter.close();
    this._timeSubscribers.clear();
    this._pendingMessages = [];
    messageBus.reset();
    this._state = { presence: 'closed', progress: {} };
    useMessagePipelineStore.getState().setPlayerState(this._state);
    useMessagePipelineStore.getState().setSubscriptions([]);
  }

  private _rebuildSubscriptions(): void {
    const merged = Array.from(this._subscriptionsByPanel.values()).flat();
    this._subscriberIdsByTopic = this._buildSubscriberIndex(merged);
    useMessagePipelineStore.getState().setSubscriptions(merged);
    this._syncBridgeSubscriptions();
  }

  private _syncBridgeSubscriptions(): void {
    const topics = new Set<string>([
      ...this._subscriberIdsByTopic.keys(),
      ...this._highFrequencyConsumersByTopic.keys(),
    ]);
    const subs: Subscription[] = Array.from(topics).map((topic) => ({
      topic,
      subscriberId: 'live',
    }));
    this._adapter.subscribe(subs);
  }

  private _buildSubscriberIndex(subscriptions: Subscription[]): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const sub of subscriptions) {
      let ids = index.get(sub.topic);
      if (!ids) {
        ids = [];
        index.set(sub.topic, ids);
      }
      if (!ids.includes(sub.subscriberId)) {
        ids.push(sub.subscriberId);
      }
    }
    return index;
  }

  private _rebuildHighFrequencyConsumerIndex(): void {
    const index = new Map<string, HighFrequencyConsumer[]>();
    for (const consumer of this._highFrequencyConsumersById.values()) {
      const consumers = index.get(consumer.topic) ?? [];
      consumers.push(consumer);
      index.set(consumer.topic, consumers);
    }
    this._highFrequencyConsumersByTopic = index;
  }

  private _onLiveMessage(event: MessageEvent): void {
    if (this._closed) return;

    // Refresh topic list if bridge advertised new topics after init.
    const known = this._topics.some((t) => t.name === event.topic);
    if (!known) {
      this._topics = [...this._topics, { name: event.topic, type: event.schemaName }];
      this._topics.sort((a, b) => a.name.localeCompare(b.name));
    }

    this._currentTime = event.receiveTime;
    this._notifyTimeSubscribers(this._currentTime);

    if (!this._isPlaying) {
      return;
    }

    this._pendingMessages.push(event);
    this._scheduleFlush();
  }

  private _scheduleFlush(): void {
    if (this._flushScheduled) return;
    this._flushScheduled = true;
    queueMicrotask(() => {
      this._flushScheduled = false;
      this._flushPending();
    });
  }

  private _flushPending(): void {
    if (this._pendingMessages.length === 0 || this._closed) return;
    const batch = this._pendingMessages;
    this._pendingMessages = [];
    this._distributeMessages(batch);
    this._maybeEmitPipelineState();
  }

  private _distributeMessages(messages: MessageEvent[]): void {
    if (messages.length === 0) return;

    const messagesBySubscriber = new Map<string, MessageEvent[]>();
    const lastMessages = new Map<string, MessageEvent>();
    const latestForHf = new Map<string, MessageEvent>();
    const batchesForHf = new Map<string, MessageEvent[]>();

    for (const msg of messages) {
      const subscriberIds = this._subscriberIdsByTopic.get(msg.topic);
      if (subscriberIds && subscriberIds.length > 0) {
        lastMessages.set(msg.topic, msg);
        for (const subscriberId of subscriberIds) {
          let list = messagesBySubscriber.get(subscriberId);
          if (!list) {
            list = [];
            messagesBySubscriber.set(subscriberId, list);
          }
          list.push(msg);
        }
      }

      if (this._highFrequencyConsumersByTopic.has(msg.topic)) {
        latestForHf.set(msg.topic, msg);
        const consumers = this._highFrequencyConsumersByTopic.get(msg.topic);
        if (consumers?.some((c) => c.mode === 'all')) {
          const topicBatch = batchesForHf.get(msg.topic) ?? [];
          topicBatch.push(msg);
          batchesForHf.set(msg.topic, topicBatch);
        }
      }
    }

    for (const [topic, latest] of latestForHf) {
      const consumers = this._highFrequencyConsumersByTopic.get(topic);
      if (!consumers) continue;
      const topicBatch = batchesForHf.get(topic);
      for (const consumer of consumers) {
        try {
          if (consumer.mode === 'all' && consumer.onMessageBatch) {
            consumer.onMessageBatch(topicBatch ?? [latest]);
          } else {
            consumer.onLatestMessage?.(latest);
          }
        } catch (err) {
          console.warn('[LivePlayer] high-frequency consumer error', err);
        }
      }
    }

    if (messagesBySubscriber.size > 0 || lastMessages.size > 0) {
      messageBus.update(messagesBySubscriber, lastMessages);
    }
  }

  private _notifyTimeSubscribers(time: Time): void {
    for (const cb of this._timeSubscribers) {
      try {
        cb(time);
      } catch {
        // ignore
      }
    }
  }

  private _maybeEmitPipelineState(): void {
    const now = performance.now();
    if (now - this._lastPipelineEmitMs < PIPELINE_EMIT_INTERVAL_MS) return;
    this._lastPipelineEmitMs = now;
    this._syncActiveData();
    useMessagePipelineStore.getState().setPlayerState(this._state);
  }

  private _syncActiveData(): void {
    if (!this._state.activeData) return;
    this._state = {
      ...this._state,
      progress: { ...this._state.progress, samplingFps: this._samplingFps },
      activeData: {
        ...this._state.activeData,
        topics: this._topics,
        datatypes: this._datatypes,
        startTime: this._startTime,
        // Live: end tracks current so the timeline shows an open-ended stream.
        endTime: this._currentTime,
        currentTime: this._currentTime,
        isPlaying: this._isPlaying,
        isLooping: false,
        speed: 1,
        problems: this._problems,
        randomAccessByTopic: false,
      },
    };
  }

  private _emitState(): void {
    this._syncActiveData();
    if (this._listener) {
      this._listener(this._state);
    }
    useMessagePipelineStore.getState().setPlayerState(this._state);
  }
}

/** Type guard for live players. */
export function isLivePlayer(player: Player | null | undefined): player is LivePlayer {
  return player != null && (player as LivePlayer).isLive === true;
}

/** Convert wall-clock ms to Time. */
export function timeFromMillis(ms: number): Time {
  return fromNano(BigInt(ms) * 1_000_000n);
}

/** Compare times for tests. */
export function timesEqual(a: Time, b: Time): boolean {
  return toNano(a) === toNano(b);
}
