import {
  FOXGLOVE_WS_SUBPROTOCOLS,
  BinaryOpcode,
  getBinaryOpcode,
  parseMessageDataFrame,
  parseTimeFrame,
  type FoxgloveChannel,
  type FoxgloveClientJsonMessage,
  type FoxgloveServerCapability,
  type FoxgloveServerInfo,
  type FoxgloveServerJsonMessage,
  type ParsedMessageData,
} from './protocol';

export type FoxgloveWsClientStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface FoxgloveWsClientEvents {
  status: (status: FoxgloveWsClientStatus, detail?: string) => void;
  serverInfo: (info: FoxgloveServerInfo) => void;
  advertise: (channels: FoxgloveChannel[]) => void;
  unadvertise: (channelIds: number[]) => void;
  message: (data: ParsedMessageData) => void;
  time: (timestampNs: bigint) => void;
  serverStatus: (level: 0 | 1 | 2, message: string, id?: string) => void;
}

export interface FoxgloveWsClientOptions {
  url: string;
  /** Injected WebSocket constructor (tests). Defaults to global WebSocket. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * Thin browser client for Foxglove WebSocket protocol v1.
 * Speaks the same protocol as Foxglove Studio / foxglove_bridge.
 */
type ListenerMap = {
  status: Set<FoxgloveWsClientEvents['status']>;
  serverInfo: Set<FoxgloveWsClientEvents['serverInfo']>;
  advertise: Set<FoxgloveWsClientEvents['advertise']>;
  unadvertise: Set<FoxgloveWsClientEvents['unadvertise']>;
  message: Set<FoxgloveWsClientEvents['message']>;
  time: Set<FoxgloveWsClientEvents['time']>;
  serverStatus: Set<FoxgloveWsClientEvents['serverStatus']>;
};

function emptyListeners(): ListenerMap {
  return {
    status: new Set(),
    serverInfo: new Set(),
    advertise: new Set(),
    unadvertise: new Set(),
    message: new Set(),
    time: new Set(),
    serverStatus: new Set(),
  };
}

export class FoxgloveWsClient {
  private readonly _url: string;
  private readonly _WebSocket: typeof WebSocket;
  private _ws: WebSocket | null = null;
  private _status: FoxgloveWsClientStatus = 'closed';
  private _listeners: ListenerMap = emptyListeners();
  private _serverInfo: FoxgloveServerInfo | null = null;
  private _channels = new Map<number, FoxgloveChannel>();
  private _closedByUser = false;

  constructor(options: FoxgloveWsClientOptions) {
    this._url = options.url;
    this._WebSocket = options.WebSocketImpl ?? WebSocket;
  }

  get url(): string {
    return this._url;
  }

  get status(): FoxgloveWsClientStatus {
    return this._status;
  }

  get serverInfo(): FoxgloveServerInfo | null {
    return this._serverInfo;
  }

  get channels(): ReadonlyMap<number, FoxgloveChannel> {
    return this._channels;
  }

  hasCapability(cap: FoxgloveServerCapability): boolean {
    return this._serverInfo?.capabilities.includes(cap) ?? false;
  }

  on<K extends keyof FoxgloveWsClientEvents>(event: K, listener: FoxgloveWsClientEvents[K]): () => void {
    const set = this._listeners[event] as Set<FoxgloveWsClientEvents[K]>;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  connect(): void {
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._closedByUser = false;
    this._setStatus('connecting');
    // Negotiate SDK protocol first (foxglove_bridge ≥3), fall back to legacy v1.
    const ws = new this._WebSocket(this._url, [...FOXGLOVE_WS_SUBPROTOCOLS]);
    this._ws = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      if (this._ws !== ws) return;
      this._setStatus('open');
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (this._ws !== ws) return;
      this._handleMessage(ev.data);
    };

    ws.onerror = () => {
      if (this._ws !== ws) return;
      this._setStatus('error', 'WebSocket error');
    };

    ws.onclose = (ev: CloseEvent) => {
      if (this._ws !== ws) return;
      this._ws = null;
      const reason = ev.reason || `code ${ev.code}`;
      if (!this._closedByUser) {
        this._setStatus('closed', reason);
      } else {
        this._status = 'closed';
        this._emit('status', 'closed', reason);
      }
    };
  }

  close(): void {
    this._closedByUser = true;
    const ws = this._ws;
    this._ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this._status = 'closed';
    this._emit('status', 'closed');
  }

  subscribe(subscriptions: Array<{ id: number; channelId: number }>): void {
    if (subscriptions.length === 0) return;
    this._sendJson({ op: 'subscribe', subscriptions });
  }

  unsubscribe(subscriptionIds: number[]): void {
    if (subscriptionIds.length === 0) return;
    this._sendJson({ op: 'unsubscribe', subscriptionIds });
  }

  private _sendJson(msg: FoxgloveClientJsonMessage): void {
    const ws = this._ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(JSON.stringify(msg));
  }

  private _handleMessage(data: unknown): void {
    if (typeof data === 'string') {
      this._handleJson(data);
      return;
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      this._handleBinary(data);
    }
  }

  private _handleJson(text: string): void {
    let msg: FoxgloveServerJsonMessage;
    try {
      msg = JSON.parse(text) as FoxgloveServerJsonMessage;
    } catch {
      return;
    }
    switch (msg.op) {
      case 'serverInfo': {
        const info = msg as FoxgloveServerInfo;
        this._serverInfo = info;
        this._emit('serverInfo', info);
        break;
      }
      case 'advertise': {
        const channels = (msg as { channels?: FoxgloveChannel[] }).channels ?? [];
        for (const ch of channels) {
          this._channels.set(ch.id, ch);
        }
        this._emit('advertise', channels);
        break;
      }
      case 'unadvertise': {
        const ids = (msg as { channelIds?: number[] }).channelIds ?? [];
        for (const id of ids) {
          this._channels.delete(id);
        }
        this._emit('unadvertise', ids);
        break;
      }
      case 'status': {
        const st = msg as { level?: number; message?: string; id?: string };
        let level: 0 | 1 | 2 = 0;
        if (st.level === 1) level = 1;
        else if (st.level === 2) level = 2;
        this._emit('serverStatus', level, st.message ?? '', st.id);
        break;
      }
      default:
        break;
    }
  }

  private _handleBinary(data: ArrayBuffer | ArrayBufferView): void {
    const opcode = getBinaryOpcode(data);
    if (opcode === BinaryOpcode.MESSAGE_DATA) {
      const parsed = parseMessageDataFrame(data);
      if (parsed) this._emit('message', parsed);
      return;
    }
    if (opcode === BinaryOpcode.TIME) {
      const parsed = parseTimeFrame(data);
      if (parsed) this._emit('time', parsed.timestampNs);
    }
  }

  private _setStatus(status: FoxgloveWsClientStatus, detail?: string): void {
    this._status = status;
    this._emit('status', status, detail);
  }

  private _emit<K extends keyof FoxgloveWsClientEvents>(
    event: K,
    ...args: Parameters<FoxgloveWsClientEvents[K]>
  ): void {
    const set = this._listeners[event] as Set<(...a: Parameters<FoxgloveWsClientEvents[K]>) => void>;
    for (const listener of set) {
      try {
        listener(...args);
      } catch (err) {
        console.warn('[FoxgloveWsClient] listener error', err);
      }
    }
  }
}
