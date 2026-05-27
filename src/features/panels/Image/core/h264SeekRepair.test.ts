import { describe, expect, it } from 'vitest';
import type { MessageEvent as RosMessageEvent } from '@/core/types/ros';
import { findLatestH264KeyFrameIndex, selectH264SeekRepairFrames } from './h264SeekRepair';

const keyChunk = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x65, 3, 4]);
const deltaChunk = new Uint8Array([0, 0, 1, 0x41, 9, 9]);

function makeEvent(sec: number, data: Uint8Array, format = 'h264'): RosMessageEvent {
  const receiveTime = { sec, nsec: 0 };
  return {
    topic: '/camera/video',
    receiveTime,
    publishTime: receiveTime,
    message: { format, data },
    schemaName: 'foxglove_msgs/msg/CompressedVideo',
  };
}

describe('h264SeekRepair', () => {
  it('findLatestH264KeyFrameIndex returns the last keyframe index', () => {
    const messages = [makeEvent(1, keyChunk), makeEvent(2, deltaChunk), makeEvent(3, deltaChunk)];
    expect(findLatestH264KeyFrameIndex(messages)).toBe(0);
  });

  it('selectH264SeekRepairFrames returns frames from keyframe through target time', () => {
    const messages = [
      makeEvent(1, keyChunk),
      makeEvent(2, deltaChunk),
      makeEvent(3, deltaChunk),
      makeEvent(4, deltaChunk),
    ];
    const repair = selectH264SeekRepairFrames(messages, { sec: 3, nsec: 0 });

    expect(repair).toHaveLength(3);
    expect(repair.map((event) => event.receiveTime.sec)).toEqual([1, 2, 3]);
  });

  it('selectH264SeekRepairFrames ignores messages after the target time', () => {
    const messages = [
      makeEvent(1, keyChunk),
      makeEvent(2, deltaChunk),
      makeEvent(4, deltaChunk),
    ];
    const repair = selectH264SeekRepairFrames(messages, { sec: 2, nsec: 0 });

    expect(repair).toHaveLength(2);
    expect(repair.map((event) => event.receiveTime.sec)).toEqual([1, 2]);
  });

  it('returns empty when no keyframe exists in the window', () => {
    const messages = [makeEvent(1, deltaChunk), makeEvent(2, deltaChunk)];
    expect(selectH264SeekRepairFrames(messages, { sec: 2, nsec: 0 })).toEqual([]);
  });
});
