import type { Time } from '@/core/types/ros';

export interface RawImageMessage {
  encoding: string;
  width: number;
  height: number;
  step?: number;
  is_bigendian?: boolean;
  data: Uint8Array;
}

export interface CompressedImageMessage {
  format: string;
  data: Uint8Array;
}

/** foxglove_msgs/msg/CompressedVideo — Annex B H264/H265/VP9/AV1 bitstream chunks. */
export interface CompressedVideoMessage {
  timestamp?: Time;
  frame_id?: string;
  format: string;
  data: Uint8Array;
}

export interface ImageSurfaceStatus {
  phase: 'idle' | 'decoding' | 'ready' | 'error';
  width?: number;
  height?: number;
  encoding?: string;
  receiveTime?: Time;
  message?: string;
}

function isSharedArrayBufferBacked(data: Uint8Array): boolean {
  return typeof globalThis.SharedArrayBuffer !== 'undefined' && data.buffer instanceof globalThis.SharedArrayBuffer;
}

export function snapshotBytes(data: unknown): Uint8Array<ArrayBuffer> | null {
  if (!(data instanceof Uint8Array)) {
    return null;
  }
  if (
    !isSharedArrayBufferBacked(data) &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

export function prepareImageWorkerBytes(data: unknown): { data: Uint8Array; transfer: Transferable[] } | null {
  if (!(data instanceof Uint8Array)) {
    return null;
  }
  // Always hand the render worker an owned ArrayBuffer. SAB-backed views may
  // point into the playback ring, whose slot can be reused before the worker's
  // postMessage is processed.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return { data: copy, transfer: [copy.buffer] };
}

export function isCompressedImageMessage(message: unknown): message is CompressedImageMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'format' in message &&
      'data' in message &&
      (message as { data?: unknown }).data instanceof Uint8Array,
  );
}

export function isCompressedVideoMessage(message: unknown): message is CompressedVideoMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'format' in message &&
      'data' in message &&
      (message as { data?: unknown }).data instanceof Uint8Array,
  );
}

export type CompressedFrameMessage = CompressedImageMessage | CompressedVideoMessage;

export function isCompressedFrameMessage(message: unknown): message is CompressedFrameMessage {
  return isCompressedImageMessage(message) || isCompressedVideoMessage(message);
}

export function getCompressedFrameFormat(message: CompressedFrameMessage): string {
  return message.format;
}

export function isH264CompressedFrameMessage(message: unknown): boolean {
  if (!isCompressedFrameMessage(message)) {
    return false;
  }
  return getCompressedKind(getCompressedFrameFormat(message)) === 'h264';
}

export function isRawImageMessage(message: unknown): message is RawImageMessage {
  return Boolean(
    message &&
      typeof message === 'object' &&
      'encoding' in message &&
      'width' in message &&
      'height' in message &&
      'data' in message &&
      (message as { data?: unknown }).data instanceof Uint8Array,
  );
}

/** ROS image_transport / CompressedImage.format tokens we can feed to Blob + createImageBitmap */
export type CompressedImageKind =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'avif'
  | 'bmp'
  | 'h264'
  | null;

const COMPRESSED_KIND_RE = /\b(jpeg|jpg|png|webp|gif|avif|bmp|h264)\b/i;

/**
 * Classify `sensor_msgs/CompressedImage.format` for decode routing.
 * Handles `rgb8; jpeg compressed bgr8`, `jpeg`, `image/png`, `h264`, etc.
 */
export function getCompressedKind(format: string): CompressedImageKind {
  const lower = format.trim().toLowerCase();
  if (lower === 'h264' || lower.includes('h264')) {
    return 'h264';
  }
  const m = format.match(COMPRESSED_KIND_RE);
  if (!m || !m[1]) {
    return null;
  }
  const token = m[1].toLowerCase();
  if (token === 'jpg' || token === 'jpeg') {
    return 'jpeg';
  }
  if (token === 'png' || token === 'webp' || token === 'gif' || token === 'avif' || token === 'bmp') {
    return token;
  }
  if (token === 'h264') {
    return 'h264';
  }
  return null;
}

export function normalizeCompressedMime(format: string): string {
  const kind = getCompressedKind(format);
  if (kind === 'jpeg') {
    return 'image/jpeg';
  }
  if (kind === 'png' || kind === 'webp' || kind === 'gif' || kind === 'avif' || kind === 'bmp') {
    return `image/${kind}`;
  }

  const firstToken = format
    .split(';')[0]
    ?.trim()
    .split(/\s+/)[0]
    ?.toLowerCase();

  if (!firstToken) {
    return 'image/jpeg';
  }
  if (firstToken.startsWith('image/')) {
    return firstToken;
  }
  if (firstToken === 'jpg') {
    return 'image/jpeg';
  }
  // Unknown tokens (e.g. `bgr8` mislabeled on CompressedImage): many bags still carry JPEG bytes.
  return 'image/jpeg';
}

/**
 * Whether a topic schema is ROS `sensor_msgs/Image` (raw), not `CompressedImage`.
 * Used by settings UI so raw/depth controls appear from topic metadata, not only after a frame arrives.
 */
export function isRawImageTopicSchema(schemaName: string): boolean {
  const trimmed = schemaName.trim();
  if (!trimmed) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes('compressedimage')) {
    return false;
  }
  if (lower.includes('compressedvideo')) {
    return false;
  }
  return /(^|\/)sensor_msgs\/(msg\/)?image$/i.test(trimmed);
}

/** Topic type tokens accepted by the Image panel topic picker. */
export const IMAGE_PANEL_TOPIC_INCLUDES = ['image', 'CompressedImage', 'CompressedVideo'] as const;

export function isImagePanelTopicSchema(schemaName: string): boolean {
  const lower = schemaName.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  if (isRawImageTopicSchema(schemaName)) {
    return true;
  }
  if (lower.includes('compressedimage')) {
    return true;
  }
  if (lower.includes('compressedvideo')) {
    return true;
  }
  return false;
}
