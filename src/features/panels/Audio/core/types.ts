/** Unified PCM float32 interleaved [-1, 1] for Web Audio + waveform. */
export interface DecodedAudioFrame {
  /** Start time of this chunk in log timeline (nanoseconds). */
  startNs: bigint;
  sampleRate: number;
  channels: number;
  /** Interleaved samples per channel, length = frameCount * channels. */
  pcmF32Interleaved: Float32Array;
  sourceTopic: string;
  /** Human-readable flags for UI (e.g. degraded timestamp). */
  qualityFlags: string[];
}

export type NormalizeAudioSuccess = { ok: true; frame: DecodedAudioFrame };
export type NormalizeAudioFailure = { ok: false; error: string };

export type NormalizeAudioResult = NormalizeAudioSuccess | NormalizeAudioFailure;

export interface ParsedAudioInfo {
  channels: number;
  sampleRate: number;
  sampleFormat: string;
  codingFormat: string;
  bitrate?: number;
}
