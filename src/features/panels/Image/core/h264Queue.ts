import { containsH264IdrNal, scanH264NalTypes } from './h264';

export interface H264QueueEntry {
  data: Uint8Array;
}

export interface H264GopSelection<T> {
  frames: T[];
  droppedFrames: number;
  resync: boolean;
}

export interface H264HardLimitPlan<T> {
  frames: T[];
  droppedFrames: number;
  waitForIdr: boolean;
}

/** Hard overflow never returns a truncated dependency chain for decoding. */
export function applyH264HardLimit<T>(
  frames: readonly T[],
  hardLimitExceeded: boolean,
): H264HardLimitPlan<T> {
  return hardLimitExceeded
    ? { frames: [], droppedFrames: frames.length, waitForIdr: true }
    : { frames: [...frames], droppedFrames: 0, waitForIdr: false };
}

export function isH264ConfigOnly(data: Uint8Array): boolean {
  const nalTypes = scanH264NalTypes(data);
  const hasConfig = nalTypes.some((type) => type === 7 || type === 8);
  const hasVcl = nalTypes.some((type) => type === 1 || type === 5);
  return hasConfig && !hasVcl;
}

/** Track the latest ordered SPS/PPS generation without collapsing split packets. */
export function updateH264ConfigPackets<T extends H264QueueEntry>(
  packets: readonly T[],
  frame: T,
): T[] {
  if (!isH264ConfigOnly(frame.data)) {
    return [...packets];
  }
  return scanH264NalTypes(frame.data).includes(7) ? [frame] : [...packets, frame];
}

/**
 * Select the newest complete random-access suffix.
 *
 * Delta frames are never removed from within the selected GOP. With no newer
 * IDR (including when the only IDR is index 0), the queue is returned intact.
 */
export function selectLatestCompleteH264Gop<T extends H264QueueEntry>(
  frames: readonly T[],
  fallbackConfig: readonly T[] = [],
  forceResync = false,
): H264GopSelection<T> {
  const latestIdrIndex = findLatestH264IdrIndex(frames);
  if (latestIdrIndex < 0) {
    return { frames: [...frames], droppedFrames: 0, resync: false };
  }
  if (latestIdrIndex === 0) {
    if (!forceResync) {
      return { frames: [...frames], droppedFrames: 0, resync: false };
    }
    const idrContainsSps = scanH264NalTypes(frames[0].data).includes(7);
    return {
      frames: idrContainsSps ? [...frames] : [...fallbackConfig, ...frames],
      droppedFrames: 0,
      resync: true,
    };
  }

  const idrNalTypes = scanH264NalTypes(frames[latestIdrIndex].data);
  const inQueueConfig = idrNalTypes.includes(7)
    ? []
    : findLatestCompleteConfig(frames, latestIdrIndex);
  const configFrames =
    idrNalTypes.includes(7) || inQueueConfig.length > 0
      ? inQueueConfig
      : [...fallbackConfig];
  const selected = [...configFrames, ...frames.slice(latestIdrIndex)];
  const droppedFrames = latestIdrIndex - inQueueConfig.length;
  if (droppedFrames === 0) {
    return { frames: [...frames], droppedFrames: 0, resync: false };
  }
  return {
    frames: selected,
    droppedFrames,
    resync: true,
  };
}

function findLatestH264IdrIndex<T extends H264QueueEntry>(frames: readonly T[]): number {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (containsH264IdrNal(frames[index].data)) {
      return index;
    }
  }
  return -1;
}

function findLatestCompleteConfig<T extends H264QueueEntry>(
  frames: readonly T[],
  endIndex: number,
): T[] {
  let latestSpsIndex = -1;
  for (let index = endIndex - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (isH264ConfigOnly(frame.data) && scanH264NalTypes(frame.data).includes(7)) {
      latestSpsIndex = index;
      break;
    }
  }
  if (latestSpsIndex < 0) {
    return [];
  }
  return frames
    .slice(latestSpsIndex, endIndex)
    .filter((frame) => isH264ConfigOnly(frame.data));
}
