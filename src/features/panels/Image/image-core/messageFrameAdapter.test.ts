import { describe, expect, it } from 'vitest';
import type { MessageEvent as RosMessageEvent } from '@/core/types/ros';
import { isH264MessageEvent, toWorkerFrame } from './messageFrameAdapter';

const receiveTime = { sec: 10, nsec: 0 };

function makeCompressedImageEvent(data: Uint8Array, format = 'h264'): RosMessageEvent {
  return {
    topic: '/camera/compressed',
    receiveTime,
    publishTime: receiveTime,
    message: { format, data },
    schemaName: 'sensor_msgs/msg/CompressedImage',
  };
}

function makeCompressedVideoEvent(data: Uint8Array, format = 'h264'): RosMessageEvent {
  return {
    topic: '/camera/video',
    receiveTime,
    publishTime: receiveTime,
    message: {
      timestamp: receiveTime,
      frame_id: 'camera_optical',
      format,
      data,
    },
    schemaName: 'foxglove_msgs/msg/CompressedVideo',
  };
}

describe('messageFrameAdapter', () => {
  it('maps CompressedImage and CompressedVideo h264 payloads to the same worker envelope shape', () => {
    const payload = new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3]);
    const fromImage = toWorkerFrame(makeCompressedImageEvent(payload));
    const fromVideo = toWorkerFrame(makeCompressedVideoEvent(payload));

    expect(fromImage).not.toBeNull();
    expect(fromVideo).not.toBeNull();
    expect(fromImage!.frame).toMatchObject({
      kind: 'compressed',
      receiveTime,
      format: 'h264',
    });
    expect(fromVideo!.frame).toMatchObject({
      kind: 'compressed',
      receiveTime,
      format: 'h264',
    });
    expect(Array.from(fromImage!.frame.data)).toEqual(Array.from(fromVideo!.frame.data));
  });

  it('detects h264 for both CompressedImage and CompressedVideo', () => {
    const payload = new Uint8Array([1]);
    expect(isH264MessageEvent(makeCompressedImageEvent(payload))).toBe(true);
    expect(isH264MessageEvent(makeCompressedVideoEvent(payload))).toBe(true);
    expect(isH264MessageEvent(makeCompressedVideoEvent(payload, 'vp9'))).toBe(false);
  });
});
