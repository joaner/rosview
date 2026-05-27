import type { Time } from '@/core/types/ros';
import type { DecodedAudioFrame } from './types';

export function toUint8Array(input: unknown): Uint8Array | null {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) {
    const values = input.filter((v): v is number => typeof v === 'number').map((v) => v & 0xff);
    return new Uint8Array(values);
  }
  return null;
}

function readFoxgloveTimestamp(msg: Record<string, unknown>): bigint | null {
  const ts = msg.timestamp ?? msg.stamp;
  if (!ts || typeof ts !== 'object') return null;
  const r = ts as Record<string, unknown>;
  const sec = typeof r.sec === 'number' ? r.sec : Number(r.sec);
  const nsec = typeof r.nsec === 'number' ? r.nsec : typeof r.nanosec === 'number' ? r.nanosec : Number(r.nsec ?? r.nanosec);
  if (!Number.isFinite(sec) || !Number.isFinite(nsec)) return null;
  return BigInt(Math.trunc(sec)) * 1_000_000_000n + BigInt(Math.trunc(nsec));
}

export function rawAudioTimestampNs(message: unknown): bigint | null {
  if (!message || typeof message !== 'object') return null;
  return readFoxgloveTimestamp(message as Record<string, unknown>);
}

export function decodeRawAudioPcmS16(message: unknown, sourceTopic: string, receiveTime?: Time): DecodedAudioFrame | null {
  if (!message || typeof message !== 'object') return null;
  const m = message as Record<string, unknown>;
  const rawFmt = m.format ?? m.FORMAT;
  const format = typeof rawFmt === 'string' ? rawFmt.trim() : '';
  if (format !== 'pcm-s16') return null;
  const sampleRate = typeof m.sample_rate === 'number' ? m.sample_rate : Number(m.sample_rate);
  const numberOfChannels =
    typeof m.number_of_channels === 'number' ? m.number_of_channels : Number(m.number_of_channels);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return null;
  if (!Number.isFinite(numberOfChannels) || numberOfChannels <= 0 || numberOfChannels > 32) return null;
  const data = toUint8Array(m.data);
  if (!data || data.length === 0) return null;
  const bytesPerFrame = 2 * numberOfChannels;
  if (data.length % bytesPerFrame !== 0) return null;
  const frameCount = data.length / bytesPerFrame;
  const out = new Float32Array(frameCount * numberOfChannels);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let o = 0;
  for (let i = 0; i < frameCount; i++) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const sample = view.getInt16(i * bytesPerFrame + ch * 2, true);
      out[o++] = sample / 32768;
    }
  }
  let startNs = rawAudioTimestampNs(message);
  if (startNs == null && receiveTime) {
    startNs = BigInt(receiveTime.sec) * 1_000_000_000n + BigInt(receiveTime.nsec);
  }
  if (startNs == null) return null;
  const qualityFlags: string[] = [];
  if (rawAudioTimestampNs(message) == null && receiveTime) {
    qualityFlags.push('receive_time_fallback');
  }
  return {
    startNs,
    sampleRate: Math.floor(sampleRate),
    channels: numberOfChannels,
    pcmF32Interleaved: out,
    sourceTopic,
    qualityFlags,
  };
}

function parseSampleFormat(fmt: string): 's16le' | 's16be' | 'u8' | 's8' | 'f32le' | null {
  const f = fmt.trim().toUpperCase().replace(/\s+/g, '');
  if (f === 'S16LE' || f === 'S_16LE') return 's16le';
  if (f === 'S16BE' || f === 'S_16BE') return 's16be';
  if (f === 'U8' || f === 'UINT8') return 'u8';
  if (f === 'S8' || f === 'INT8') return 's8';
  if (f === 'F32LE' || f === 'FLOAT32LE') return 'f32le';
  return null;
}

export function decodeAudioCommonPcmBytes(
  bytes: Uint8Array,
  info: { channels: number; sampleFormat: string },
  startNs: bigint,
  sampleRate: number,
  sourceTopic: string,
  qualityFlags: string[],
): DecodedAudioFrame | null {
  const channels = info.channels;
  const fmt = parseSampleFormat(info.sampleFormat);
  if (!fmt) return null;
  if (channels <= 0 || channels > 32) return null;
  if (fmt === 's16le') {
    if (bytes.length % (2 * channels) !== 0) return null;
    const frameCount = bytes.length / (2 * channels);
    const out = new Float32Array(frameCount * channels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = view.getInt16(i * channels * 2 + ch * 2, true);
        out[o++] = sample / 32768;
      }
    }
    return { startNs, sampleRate, channels, pcmF32Interleaved: out, sourceTopic, qualityFlags };
  }
  if (fmt === 's16be') {
    if (bytes.length % (2 * channels) !== 0) return null;
    const frameCount = bytes.length / (2 * channels);
    const out = new Float32Array(frameCount * channels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const sample = view.getInt16(i * channels * 2 + ch * 2, false);
        out[o++] = sample / 32768;
      }
    }
    return { startNs, sampleRate, channels, pcmF32Interleaved: out, sourceTopic, qualityFlags };
  }
  if (fmt === 'u8') {
    if (bytes.length % channels !== 0) return null;
    const frameCount = bytes.length / channels;
    const out = new Float32Array(frameCount * channels);
    let o = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const u = bytes[i * channels + ch] ?? 0;
        out[o++] = (u - 128) / 128;
      }
    }
    return { startNs, sampleRate, channels, pcmF32Interleaved: out, sourceTopic, qualityFlags };
  }
  if (fmt === 's8') {
    if (bytes.length % channels !== 0) return null;
    const frameCount = bytes.length / channels;
    const out = new Float32Array(frameCount * channels);
    let o = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const s = bytes[i * channels + ch] ?? 0;
        const v = (s << 24) >> 24;
        out[o++] = v / 128;
      }
    }
    return { startNs, sampleRate, channels, pcmF32Interleaved: out, sourceTopic, qualityFlags };
  }
  if (fmt === 'f32le') {
    if (bytes.length % (4 * channels) !== 0) return null;
    const frameCount = bytes.length / (4 * channels);
    const out = new Float32Array(frameCount * channels);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let o = 0;
    for (let i = 0; i < frameCount; i++) {
      for (let ch = 0; ch < channels; ch++) {
        out[o++] = view.getFloat32(i * channels * 4 + ch * 4, true);
      }
    }
    return { startNs, sampleRate, channels, pcmF32Interleaved: out, sourceTopic, qualityFlags };
  }
  return null;
}
