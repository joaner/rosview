import type { DecodedAudioFrame } from './types';

/**
 * Schedules decoded PCM chunks on a Web Audio graph with optional gain.
 * Designed for bag replay: timestamps are in log timeline (ns).
 */
export class AudioPlaybackController {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private readonly sources: AudioBufferSourceNode[] = [];
  private lastCurrentLogNs: bigint | null = null;

  /** Whether AudioContext exists and is running (not suspended). */
  isRunning(): boolean {
    return this.context != null && this.context.state === 'running';
  }

  getAudioContext(): AudioContext | null {
    return this.context;
  }

  /**
   * Lazily create AudioContext + gain. Must be called from a user gesture for autoplay policy.
   */
  async ensureRunning(): Promise<boolean> {
    if (typeof AudioContext === 'undefined') {
      return false;
    }
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    return this.context.state === 'running';
  }

  setVolume(volume: number): void {
    if (!this.gain || !this.context) return;
    const v = Math.max(0, Math.min(1, volume));
    this.gain.gain.setValueAtTime(v, this.context.currentTime);
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    void this.context?.resume();
  }

  /** Stop all scheduled / playing buffers and optionally suspend. */
  flush(hard = false): void {
    for (const s of this.sources) {
      try {
        s.stop(0);
      } catch {
        /* already stopped */
      }
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.sources.length = 0;
    this.lastCurrentLogNs = null;
    if (hard && this.context) {
      void this.context.suspend();
    }
  }

  dispose(): void {
    this.flush(false);
    void this.context?.close();
    this.context = null;
    this.gain = null;
  }

  /**
   * Schedule one chunk aligned to playback `currentLogNs` (bag time).
   * Skips scheduling when `allowPlayback` is false (paused / wrong speed).
   */
  scheduleChunk(frame: DecodedAudioFrame, currentLogNs: bigint, allowPlayback: boolean): void {
    if (!allowPlayback) return;
    if (!this.context || !this.gain) return;
    if (this.context.state !== 'running') return;

    const ctx = this.context;
    const now = ctx.currentTime;
    const offsetSec = Number(frame.startNs - currentLogNs) / 1e9;
    const when = now + Math.max(0, offsetSec);

    const { sampleRate, channels, pcmF32Interleaved } = frame;
    const frameCount = pcmF32Interleaved.length / channels;
    if (frameCount <= 0 || !Number.isFinite(frameCount)) return;

    const buffer = ctx.createBuffer(channels, frameCount, sampleRate);
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < frameCount; i++) {
        data[i] = pcmF32Interleaved[i * channels + ch]!;
      }
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    try {
      src.start(when);
      this.sources.push(src);
      src.onended = () => {
        const idx = this.sources.indexOf(src);
        if (idx >= 0) this.sources.splice(idx, 1);
      };
    } catch {
      /* ignore */
    }
    this.lastCurrentLogNs = currentLogNs;
  }

  /** Detect seek backwards in log time → flush scheduled audio. */
  handlePlaybackTimeJump(prevLogNs: bigint | null, nextLogNs: bigint): void {
    if (prevLogNs != null && nextLogNs + 10_000_000n < prevLogNs) {
      this.flush(false);
    }
    this.lastCurrentLogNs = nextLogNs;
  }

  getLastCurrentLogNs(): bigint | null {
    return this.lastCurrentLogNs;
  }
}
