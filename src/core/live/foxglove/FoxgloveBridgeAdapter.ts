import type { MessageEvent, RosDatatypes, Time, TopicInfo } from '@/core/types/ros';
import type { Subscription, Unsubscribe } from '@/core/types/player';
import { parseChannel, type ParsedChannel } from '@/infra/sources/parseChannel';
import { fromNano } from '@/shared/utils/time';
import type {
  LiveBridgeAdapter,
  LiveBridgeCapabilities,
  LiveBridgeInitialization,
} from '../bridgeCapabilities';
import { FoxgloveWsClient } from './FoxgloveWsClient';
import { schemaStringToBytes, type FoxgloveChannel } from './protocol';

export interface FoxgloveBridgeAdapterOptions {
  url: string;
  /** Optional injected client (tests). */
  client?: FoxgloveWsClient;
  /** Max ms to wait for serverInfo + first advertise during initialize. */
  connectTimeoutMs?: number;
}

interface ChannelRuntime {
  channel: FoxgloveChannel;
  parsed?: ParsedChannel;
  parseError?: string;
}

/**
 * LiveBridgeAdapter over the official Foxglove WebSocket protocol
 * (foxglove_bridge / foxglove.websocket.v1).
 */
export class FoxgloveBridgeAdapter implements LiveBridgeAdapter {
  private readonly _client: FoxgloveWsClient;
  private readonly _connectTimeoutMs: number;
  private _channels = new Map<number, ChannelRuntime>();
  private _topicToChannelId = new Map<string, number>();
  private _subscriptionIdByChannelId = new Map<number, number>();
  private _nextSubscriptionId = 1;
  private _messageListeners = new Set<(event: MessageEvent) => void>();
  private _capabilities: LiveBridgeCapabilities = {
    profile: 'foxglove',
    canSubscribe: true,
    canPublish: false,
    canReadParameters: false,
    canWriteParameters: false,
    messageRangeBufferSec: 15,
  };
  private _startTime: Time = { sec: 0, nsec: 0 };
  private _serverTimeNs: bigint | undefined;
  private _closed = false;
  private _readyResolve: (() => void) | null = null;
  private _readyReject: ((err: Error) => void) | null = null;
  private _gotServerInfo = false;
  private _gotAdvertise = false;
  private _initProblems: string[] = [];

  constructor(options: FoxgloveBridgeAdapterOptions) {
    this._client = options.client ?? new FoxgloveWsClient({ url: options.url });
    this._connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
    this._wireClient();
  }

  get client(): FoxgloveWsClient {
    return this._client;
  }

  async initialize(): Promise<LiveBridgeInitialization> {
    if (this._closed) {
      throw new Error('FoxgloveBridgeAdapter is closed');
    }

    const ready = new Promise<void>((resolve, reject) => {
      this._readyResolve = resolve;
      this._readyReject = reject;
    });

    const timer = setTimeout(() => {
      this._readyReject?.(
        new Error(
          `Timed out connecting to Foxglove WebSocket at ${this._client.url} (no serverInfo/advertise within ${this._connectTimeoutMs}ms)`,
        ),
      );
      this._readyResolve = null;
      this._readyReject = null;
    }, this._connectTimeoutMs);

    try {
      this._client.connect();
      await ready;
    } finally {
      clearTimeout(timer);
      this._readyResolve = null;
      this._readyReject = null;
    }

    const topics = this._buildTopics();
    const datatypes = this._buildDatatypes();
    if (this._startTime.sec === 0 && this._startTime.nsec === 0) {
      this._startTime = wallClockTime();
    }

    return {
      topics,
      datatypes,
      startTime: this._startTime,
      capabilities: this._capabilities,
    };
  }

  subscribe(subscriptions: Subscription[]): Unsubscribe {
    const wantedTopics = new Set(subscriptions.map((s) => s.topic));
    const wantedChannelIds = new Set<number>();
    for (const topic of wantedTopics) {
      const channelId = this._topicToChannelId.get(topic);
      if (channelId != null) wantedChannelIds.add(channelId);
    }

    const toSubscribe: Array<{ id: number; channelId: number }> = [];
    const toUnsubscribe: number[] = [];

    for (const channelId of wantedChannelIds) {
      if (!this._subscriptionIdByChannelId.has(channelId)) {
        const subId = this._nextSubscriptionId++;
        this._subscriptionIdByChannelId.set(channelId, subId);
        toSubscribe.push({ id: subId, channelId });
      }
    }

    for (const [channelId, subId] of [...this._subscriptionIdByChannelId.entries()]) {
      if (!wantedChannelIds.has(channelId)) {
        toUnsubscribe.push(subId);
        this._subscriptionIdByChannelId.delete(channelId);
      }
    }

    if (toUnsubscribe.length > 0) {
      this._client.unsubscribe(toUnsubscribe);
    }
    if (toSubscribe.length > 0) {
      this._client.subscribe(toSubscribe);
    }

    return () => {
      // Caller drives full resubscribe via subscribe([]) or close().
    };
  }

  onMessage(listener: (event: MessageEvent) => void): Unsubscribe {
    this._messageListeners.add(listener);
    return () => {
      this._messageListeners.delete(listener);
    };
  }

  /** Latest server time if the bridge publishes time messages. */
  getServerTime(): Time | undefined {
    if (this._serverTimeNs == null) return undefined;
    return fromNano(this._serverTimeNs);
  }

  getTopics(): TopicInfo[] {
    return this._buildTopics();
  }

  getDatatypes(): RosDatatypes {
    return this._buildDatatypes();
  }

  getCapabilities(): LiveBridgeCapabilities {
    return this._capabilities;
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this._messageListeners.clear();
    this._readyReject?.(new Error('Adapter closed'));
    this._readyResolve = null;
    this._readyReject = null;
    this._client.close();
  }

  private _wireClient(): void {
    this._client.on('serverInfo', (info) => {
      this._gotServerInfo = true;
      this._capabilities = {
        profile: 'foxglove',
        canSubscribe: true,
        canPublish: info.capabilities.includes('clientPublish'),
        canReadParameters: info.capabilities.includes('parameters'),
        canWriteParameters: info.capabilities.includes('parameters'),
        messageRangeBufferSec: 15,
      };
      this._maybeReady();
    });

    this._client.on('advertise', (channels) => {
      for (const ch of channels) {
        this._ingestChannel(ch);
      }
      this._gotAdvertise = true;
      this._maybeReady();
    });

    this._client.on('unadvertise', (channelIds) => {
      for (const id of channelIds) {
        const runtime = this._channels.get(id);
        if (runtime) {
          this._topicToChannelId.delete(runtime.channel.topic);
          this._channels.delete(id);
        }
        const subId = this._subscriptionIdByChannelId.get(id);
        if (subId != null) {
          this._subscriptionIdByChannelId.delete(id);
        }
      }
    });

    this._client.on('message', (data) => {
      this._handleMessageData(data.subscriptionId, data.timestampNs, data.payload);
    });

    this._client.on('time', (timestampNs) => {
      this._serverTimeNs = timestampNs;
      if (this._startTime.sec === 0 && this._startTime.nsec === 0) {
        this._startTime = fromNano(timestampNs);
      }
    });

    this._client.on('serverStatus', (level, message) => {
      if (level >= 2) {
        this._initProblems.push(message);
      }
    });

    this._client.on('status', (status, detail) => {
      if (status === 'error' || (status === 'closed' && !this._closed)) {
        this._readyReject?.(new Error(detail || `Foxglove WebSocket ${status}`));
        this._readyResolve = null;
        this._readyReject = null;
      }
    });
  }

  private _maybeReady(): void {
    // Ready once we have serverInfo. Advertise may be empty if no topics yet.
    if (!this._gotServerInfo) return;
    // Prefer waiting for at least one advertise batch so topics populate;
    // if serverInfo already arrived, also accept after a short microtask when
    // advertise already came or is empty (bridge still valid).
    if (!this._gotAdvertise) {
      // Many bridges send advertise immediately after serverInfo; if not, still
      // resolve after serverInfo so the UI can show an empty topic list.
      // Require both flags: if advertise never comes, initialize timeout handles it
      // unless we resolve on serverInfo alone. Resolve on serverInfo alone for robustness.
    }
    this._readyResolve?.();
    this._readyResolve = null;
    this._readyReject = null;
  }

  private _ingestChannel(ch: FoxgloveChannel): void {
    const runtime: ChannelRuntime = { channel: ch };
    try {
      const schemaEncoding = ch.schemaEncoding ?? defaultSchemaEncoding(ch.encoding);
      const schemaData = schemaStringToBytes(ch.schema, schemaEncoding);
      runtime.parsed = parseChannel(
        {
          messageEncoding: ch.encoding,
          schema: {
            name: ch.schemaName,
            encoding: schemaEncoding,
            data: schemaData,
          },
        },
        { allowEmptySchema: ch.encoding === 'json' || !ch.schema },
      );
    } catch (err) {
      runtime.parseError = err instanceof Error ? err.message : String(err);
    }
    this._channels.set(ch.id, runtime);
    this._topicToChannelId.set(ch.topic, ch.id);
  }

  private _handleMessageData(subscriptionId: number, timestampNs: bigint, payload: Uint8Array): void {
    let channelId: number | undefined;
    for (const [cid, sid] of this._subscriptionIdByChannelId) {
      if (sid === subscriptionId) {
        channelId = cid;
        break;
      }
    }
    if (channelId == null) return;
    const runtime = this._channels.get(channelId);
    if (!runtime) return;

    const receiveTime = fromNano(timestampNs);
    if (this._startTime.sec === 0 && this._startTime.nsec === 0) {
      this._startTime = receiveTime;
    }

    let message: unknown;
    if (runtime.parsed) {
      try {
        message = runtime.parsed.deserialize(payload);
      } catch (err) {
        message = {
          _rosviewDeserializeError: true,
          error: err instanceof Error ? err.message : String(err),
          byteLength: payload.byteLength,
        };
      }
    } else {
      message = {
        _rosviewDeserializeError: true,
        error: runtime.parseError ?? 'No deserializer',
        byteLength: payload.byteLength,
      };
    }

    const event: MessageEvent = {
      topic: runtime.channel.topic,
      receiveTime,
      publishTime: receiveTime,
      message,
      schemaName: runtime.channel.schemaName,
      sizeInBytes: payload.byteLength,
      payloadKind: 'object',
    };

    for (const listener of this._messageListeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn('[FoxgloveBridgeAdapter] onMessage listener error', err);
      }
    }
  }

  private _buildTopics(): TopicInfo[] {
    const topics: TopicInfo[] = [];
    for (const runtime of this._channels.values()) {
      topics.push({
        name: runtime.channel.topic,
        type: runtime.channel.schemaName,
      });
    }
    topics.sort((a, b) => a.name.localeCompare(b.name));
    return topics;
  }

  private _buildDatatypes(): RosDatatypes {
    const datatypes: RosDatatypes = {};
    for (const runtime of this._channels.values()) {
      if (!runtime.parsed) continue;
      for (const [name, definition] of runtime.parsed.datatypes) {
        datatypes[name] = definition;
      }
    }
    return datatypes;
  }
}

function defaultSchemaEncoding(messageEncoding: string): string {
  switch (messageEncoding) {
    case 'cdr':
      return 'ros2msg';
    case 'ros1':
      return 'ros1msg';
    case 'protobuf':
    case 'proto':
      return 'protobuf';
    case 'json':
      return 'jsonschema';
    default:
      return messageEncoding;
  }
}

function wallClockTime(): Time {
  const ms = Date.now();
  return { sec: Math.floor(ms / 1000), nsec: (ms % 1000) * 1_000_000 };
}
