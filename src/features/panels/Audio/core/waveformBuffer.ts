import type { DecodedAudioFrame } from './types';

interface WaveSample {
  tNs: bigint;
  min: number;
  max: number;
}

/** Rolling min/max envelope for visualization. */
export class WaveformEnvelopeBuffer {
  private readonly windowNs: bigint;
  private samples: WaveSample[] = [];

  constructor(windowSec: number) {
    const sec = Math.max(0.5, Math.min(30, windowSec));
    this.windowNs = BigInt(Math.round(sec * 1e9));
  }

  pushFrame(frame: DecodedAudioFrame): void {
    const { pcmF32Interleaved, channels, startNs, sampleRate } = frame;
    if (channels <= 0 || sampleRate <= 0) return;
    const frameCount = pcmF32Interleaved.length / channels;
    if (frameCount <= 0) return;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < pcmF32Interleaved.length; i++) {
      const v = pcmF32Interleaved[i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    this.samples.push({ tNs: startNs, min, max });
    const cutoff = startNs - this.windowNs;
    this.samples = this.samples.filter((s) => s.tNs >= cutoff);
  }

  clear(): void {
    this.samples = [];
  }

  getSamples(): readonly WaveSample[] {
    return this.samples;
  }
}
