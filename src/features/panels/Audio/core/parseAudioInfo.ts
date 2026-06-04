import type { ParsedAudioInfo } from './types';

function readString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Parse `audio_common_msgs/AudioInfo` payload (ROS2 deserialized object).
 */
export function parseAudioInfoMessage(message: unknown): ParsedAudioInfo | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const channels = typeof m.channels === 'number' ? m.channels : Number(m.channels);
  const sampleRate = typeof m.sample_rate === 'number' ? m.sample_rate : Number(m.sample_rate);
  if (!Number.isFinite(channels) || channels <= 0 || channels > 32) return null;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleRate > 1_000_000) return null;
  const sampleFormat = readString(m.sample_format) || 'S16LE';
  const codingFormat = readString(m.coding_format);
  const bitrate = typeof m.bitrate === 'number' ? m.bitrate : Number(m.bitrate);
  return {
    channels: Math.floor(channels),
    sampleRate: Math.floor(sampleRate),
    sampleFormat,
    codingFormat,
    bitrate: Number.isFinite(bitrate) ? Math.floor(bitrate) : undefined,
  };
}

const PCM_CODING = new Set(['', 'pcm', 'raw', 'linear']);

/** True when we treat payload as raw PCM blocks (no MP3/AAC container decode). */
export function isRawPcmCodingFormat(codingFormat: string): boolean {
  const c = codingFormat.trim().toLowerCase();
  if (c.length === 0) return true;
  if (PCM_CODING.has(c)) return true;
  if (c === 'wave' || c === 'wav') {
    // Often used with raw PCM payload in ROS pipelines; still raw bytes for us.
    return true;
  }
  return false;
}

const COMPRESSED = new Set(['mp3', 'aac', 'ogg', 'opus', 'flac', 'm4a', 'wma']);

export function isUnsupportedCompressedCodingFormat(codingFormat: string): boolean {
  const c = codingFormat.trim().toLowerCase();
  if (c.length === 0) return false;
  if (isRawPcmCodingFormat(codingFormat)) return false;
  if (COMPRESSED.has(c)) return true;
  // Unknown non-empty coding → conservative: unsupported unless clearly PCM-ish
  return !PCM_CODING.has(c);
}
