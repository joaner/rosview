import { describe, expect, it } from 'vitest';
import {
  H264_MAX_PENDING_FRAMES,
  H264_MAX_PENDING_SPAN_MS,
  initialH264PressureState,
  isH264HardLimitExceeded,
  updateDecodeDurationEwma,
  updateH264Pressure,
} from './h264Backpressure';

describe('H.264 adaptive backpressure', () => {
  it('treats frame count and queue span as strict hard bounds', () => {
    expect(isH264HardLimitExceeded(H264_MAX_PENDING_FRAMES, H264_MAX_PENDING_SPAN_MS)).toBe(false);
    expect(isH264HardLimitExceeded(H264_MAX_PENDING_FRAMES + 1, 0)).toBe(true);
    expect(isH264HardLimitExceeded(1, H264_MAX_PENDING_SPAN_MS + 1)).toBe(true);
  });

  it('enters degraded mode from queue time span even below the frame bound', () => {
    const next = updateH264Pressure(initialH264PressureState(), {
      queueFrames: 20,
      queueSpanMs: 400,
      decodeMs: 10,
    });
    expect(next.mode).toBe('degraded');
  });

  it('uses hysteresis before returning to normal', () => {
    let state = updateH264Pressure(initialH264PressureState(), {
      queueFrames: 80,
      queueSpanMs: 500,
      decodeMs: 60,
    });
    state = updateH264Pressure(state, { queueFrames: 2, queueSpanMs: 20, decodeMs: 10 });
    expect(state.mode).toBe('recovery');

    for (let i = 0; i < 10; i++) {
      state = updateH264Pressure(state, { queueFrames: 2, queueSpanMs: 20, decodeMs: 10 });
    }
    expect(state.mode).toBe('recovery');
    state = updateH264Pressure(state, { queueFrames: 2, queueSpanMs: 20, decodeMs: 10 });
    expect(state.mode).toBe('normal');
  });

  it('relapses quickly when recovery pressure rises again', () => {
    let state = { mode: 'degraded' as const, healthySamples: 0 };
    state = updateH264Pressure(state, { queueFrames: 0, queueSpanMs: 0, decodeMs: 5 });
    expect(state.mode).toBe('recovery');
    state = updateH264Pressure(state, { queueFrames: 45, queueSpanMs: 300, decodeMs: 20 });
    expect(state.mode).toBe('degraded');
  });

  it('smooths decode duration samples', () => {
    expect(updateDecodeDurationEwma(20, 40)).toBe(24);
    expect(updateDecodeDurationEwma(0, 15)).toBe(15);
  });
});
