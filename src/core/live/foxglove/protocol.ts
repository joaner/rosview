/**
 * Foxglove WebSocket protocol v1 types and binary frame helpers.
 * Spec: https://github.com/foxglove/ws-protocol/blob/main/docs/spec.md
 */

/**
 * Preferred subprotocol for current `foxglove_bridge` (SDK-backed, ≥3.x).
 * Message framing matches the historical Foxglove WebSocket protocol v1.
 */
export const FOXGLOVE_WS_SUBPROTOCOL = 'foxglove.sdk.v1';

/** Legacy subprotocol (pre-SDK bridge / older servers). */
export const FOXGLOVE_WS_SUBPROTOCOL_LEGACY = 'foxglove.websocket.v1';

/** Offer SDK first, then legacy, so one client works with both bridge generations. */
export const FOXGLOVE_WS_SUBPROTOCOLS = [
  FOXGLOVE_WS_SUBPROTOCOL,
  FOXGLOVE_WS_SUBPROTOCOL_LEGACY,
] as const;

/** Binary opcodes (server → client unless noted). */
export const BinaryOpcode = {
  MESSAGE_DATA: 0x01,
  TIME: 0x02,
  SERVICE_CALL_RESPONSE: 0x03,
  FETCH_ASSET_RESPONSE: 0x04,
} as const;

/** Client → server binary opcodes. */
export const ClientBinaryOpcode = {
  MESSAGE_DATA: 0x01,
  SERVICE_CALL_REQUEST: 0x02,
} as const;

/** Known capability strings; servers may send others. */
export type FoxgloveServerCapability = string;

export interface FoxgloveServerInfo {
  op: 'serverInfo';
  name: string;
  capabilities: FoxgloveServerCapability[];
  supportedEncodings?: string[];
  metadata?: Record<string, string>;
  sessionId?: string;
}

export interface FoxgloveChannel {
  id: number;
  topic: string;
  encoding: string;
  schemaName: string;
  schema: string;
  schemaEncoding?: string;
}

export interface FoxgloveAdvertise {
  op: 'advertise';
  channels: FoxgloveChannel[];
}

export interface FoxgloveUnadvertise {
  op: 'unadvertise';
  channelIds: number[];
}

export interface FoxgloveStatus {
  op: 'status';
  level: 0 | 1 | 2;
  message: string;
  id?: string;
}

export interface FoxgloveRemoveStatus {
  op: 'removeStatus';
  statusIds: string[];
}

export type FoxgloveServerJsonMessage =
  | FoxgloveServerInfo
  | FoxgloveAdvertise
  | FoxgloveUnadvertise
  | FoxgloveStatus
  | FoxgloveRemoveStatus
  | { op: string; [key: string]: unknown };

export interface FoxgloveSubscribeRequest {
  op: 'subscribe';
  subscriptions: Array<{ id: number; channelId: number }>;
}

export interface FoxgloveUnsubscribeRequest {
  op: 'unsubscribe';
  subscriptionIds: number[];
}

export type FoxgloveClientJsonMessage = FoxgloveSubscribeRequest | FoxgloveUnsubscribeRequest | { op: string };

export interface ParsedMessageData {
  subscriptionId: number;
  /** Receive/log timestamp in nanoseconds. */
  timestampNs: bigint;
  payload: Uint8Array;
}

export interface ParsedTimeMessage {
  timestampNs: bigint;
}

/**
 * Parse server binary Message Data frame.
 * Layout: opcode(1) | subscriptionId(u32 LE) | timestamp(u64 LE) | payload
 */
export function parseMessageDataFrame(data: ArrayBuffer | ArrayBufferView): ParsedMessageData | null {
  const view = toDataView(data);
  if (view.byteLength < 1 + 4 + 8) {
    return null;
  }
  const opcode = view.getUint8(0);
  if (opcode !== BinaryOpcode.MESSAGE_DATA) {
    return null;
  }
  const subscriptionId = view.getUint32(1, true);
  const timestampNs = view.getBigUint64(5, true);
  const payloadOffset = 1 + 4 + 8;
  const payload = new Uint8Array(view.buffer, view.byteOffset + payloadOffset, view.byteLength - payloadOffset);
  return { subscriptionId, timestampNs, payload };
}

/**
 * Parse server binary Time frame.
 * Layout: opcode(1) | timestamp(u64 LE)
 */
export function parseTimeFrame(data: ArrayBuffer | ArrayBufferView): ParsedTimeMessage | null {
  const view = toDataView(data);
  if (view.byteLength < 1 + 8) {
    return null;
  }
  const opcode = view.getUint8(0);
  if (opcode !== BinaryOpcode.TIME) {
    return null;
  }
  const timestampNs = view.getBigUint64(1, true);
  return { timestampNs };
}

export function getBinaryOpcode(data: ArrayBuffer | ArrayBufferView): number | null {
  const view = toDataView(data);
  if (view.byteLength < 1) return null;
  return view.getUint8(0);
}

function toDataView(data: ArrayBuffer | ArrayBufferView): DataView {
  if (ArrayBuffer.isView(data)) {
    return new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  return new DataView(data);
}

/** Decode Advertise schema string into bytes for parseChannel. */
export function schemaStringToBytes(schema: string, schemaEncoding: string | undefined): Uint8Array {
  if (!schema) {
    return new Uint8Array();
  }
  const enc = (schemaEncoding ?? '').toLowerCase();
  // Protobuf FileDescriptorSet is base64 in the protocol.
  if (enc === 'protobuf' || enc === 'proto') {
    try {
      return base64ToBytes(schema);
    } catch {
      // Fall through to UTF-8 if not valid base64.
    }
  }
  return new TextEncoder().encode(schema);
}

export function base64ToBytes(b64: string): Uint8Array {
  // Prefer browser `atob`; Vitest/happy-dom usually provide it.
  if (typeof globalThis.atob === 'function') {
    const bin = globalThis.atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  throw new Error('base64 decode unavailable in this runtime');
}
