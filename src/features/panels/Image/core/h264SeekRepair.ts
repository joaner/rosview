import type { Player } from '@/core/types/player';
import type { MessageEvent as RosMessageEvent, Time } from '@/core/types/ros';
import { addMs, toNano } from '@/shared/utils/time';
import { getH264ChunkType } from './h264';
import type { ImageRenderWorkerRequest } from './imageWorkerProtocol';
import { getH264MessagePayload, isH264MessageEvent, toWorkerFrame } from './messageFrameAdapter';

/** Progressive lookback windows when searching for a keyframe before a seek target. */
export const H264_SEEK_WINDOWS_MS = [2000, 5000, 10_000, 30_000] as const;

/** Cap frames fed during seek repair so high-FPS streams stay responsive. */
export const H264_SEEK_MAX_FRAMES = 180;

export function findLatestH264KeyFrameIndex(messages: RosMessageEvent[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const event = messages[i];
    if (!event) {
      continue;
    }
    const payload = getH264MessagePayload(event);
    if (payload && getH264ChunkType(payload) === 'key') {
      return i;
    }
  }
  return -1;
}

export function selectH264SeekRepairFrames(
  messages: RosMessageEvent[],
  targetTime: Time,
): RosMessageEvent[] {
  const targetNs = toNano(targetTime);
  const h264Messages = messages
    .filter((event) => isH264MessageEvent(event) && toNano(event.receiveTime) <= targetNs)
    .sort((a, b) => {
      const diff = toNano(a.receiveTime) - toNano(b.receiveTime);
      if (diff < 0n) {
        return -1;
      }
      if (diff > 0n) {
        return 1;
      }
      return 0;
    });

  const keyIndex = findLatestH264KeyFrameIndex(h264Messages);
  if (keyIndex < 0) {
    return [];
  }

  return h264Messages.slice(keyIndex).slice(-H264_SEEK_MAX_FRAMES);
}

export async function repairH264Seek(
  player: Player,
  worker: Worker,
  topic: string,
  targetTime: Time,
): Promise<boolean> {
  if (!player.getMessagesInTimeRange) {
    return false;
  }

  for (const windowMs of H264_SEEK_WINDOWS_MS) {
    const start = addMs(targetTime, -windowMs);
    const messages = await player.getMessagesInTimeRange({
      start,
      end: targetTime,
      topics: [topic],
    });

    const repairFrames = selectH264SeekRepairFrames(
      messages.filter((event) => event.topic === topic),
      targetTime,
    );
    if (repairFrames.length === 0) {
      continue;
    }

    worker.postMessage({ type: 'reset' } satisfies ImageRenderWorkerRequest);
    for (const event of repairFrames) {
      const next = toWorkerFrame(event);
      if (!next) {
        continue;
      }
      worker.postMessage(
        { type: 'frame', frame: next.frame } satisfies ImageRenderWorkerRequest,
        next.transfer,
      );
    }
    return true;
  }

  return false;
}
