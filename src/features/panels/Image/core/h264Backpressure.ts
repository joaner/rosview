export type H264PressureMode = 'normal' | 'degraded' | 'recovery';

export interface H264PressureState {
  mode: H264PressureMode;
  healthySamples: number;
}

export interface H264PressureObservation {
  queueFrames: number;
  queueSpanMs: number;
  decodeMs: number;
}

/**
 * Hard pending-queue bounds. If the newest complete GOP still exceeds either
 * bound, the worker drops that backlog and waits for the next real IDR.
 */
export const H264_MAX_PENDING_FRAMES = 120;
export const H264_MAX_PENDING_SPAN_MS = 1_000;
export const H264_DEGRADED_RENDER_INTERVAL_MS = 80;

const ENTER_DEGRADED = { frames: 72, spanMs: 350, decodeMs: 55 };
const ENTER_RECOVERY = { frames: 18, spanMs: 120, decodeMs: 32 };
const RELAPSE = { frames: 40, spanMs: 250, decodeMs: 45 };
const RECOVERY_SAMPLES = 12;

export function initialH264PressureState(): H264PressureState {
  return { mode: 'normal', healthySamples: 0 };
}

export function isH264HardLimitExceeded(queueFrames: number, queueSpanMs: number): boolean {
  return queueFrames > H264_MAX_PENDING_FRAMES || queueSpanMs > H264_MAX_PENDING_SPAN_MS;
}

/**
 * Hysteretic pressure controller. Queue age is the primary signal while the
 * decode EWMA catches expensive streams before the bounded queue overflows.
 */
export function updateH264Pressure(
  state: H264PressureState,
  observation: H264PressureObservation,
): H264PressureState {
  const overloaded =
    observation.queueFrames >= ENTER_DEGRADED.frames ||
    observation.queueSpanMs >= ENTER_DEGRADED.spanMs ||
    observation.decodeMs >= ENTER_DEGRADED.decodeMs;
  const healthy =
    observation.queueFrames <= ENTER_RECOVERY.frames &&
    observation.queueSpanMs <= ENTER_RECOVERY.spanMs &&
    observation.decodeMs <= ENTER_RECOVERY.decodeMs;
  const relapsed =
    observation.queueFrames >= RELAPSE.frames ||
    observation.queueSpanMs >= RELAPSE.spanMs ||
    observation.decodeMs >= RELAPSE.decodeMs;

  if (state.mode === 'normal') {
    return overloaded ? { mode: 'degraded', healthySamples: 0 } : state;
  }
  if (state.mode === 'degraded') {
    return healthy ? { mode: 'recovery', healthySamples: 1 } : state;
  }
  if (relapsed) {
    return { mode: 'degraded', healthySamples: 0 };
  }
  if (!healthy) {
    return { mode: 'recovery', healthySamples: 0 };
  }
  const healthySamples = state.healthySamples + 1;
  return healthySamples >= RECOVERY_SAMPLES
    ? { mode: 'normal', healthySamples: 0 }
    : { mode: 'recovery', healthySamples };
}

export function updateDecodeDurationEwma(previousMs: number, sampleMs: number): number {
  if (!Number.isFinite(sampleMs) || sampleMs < 0) {
    return previousMs;
  }
  return previousMs === 0 ? sampleMs : previousMs * 0.8 + sampleMs * 0.2;
}
