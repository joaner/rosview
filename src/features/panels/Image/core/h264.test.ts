import { describe, expect, it } from 'vitest';
import { getH264ChunkType, scanH264NalTypes } from './h264';

describe('H.264 NAL parsing', () => {
  it('detects IDR frames in Annex-B chunks', () => {
    const chunk = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x65, 3, 4]);

    expect(scanH264NalTypes(chunk)).toEqual([7, 5]);
    expect(getH264ChunkType(chunk)).toBe('key');
  });

  it('detects non-IDR slices as delta frames', () => {
    const chunk = new Uint8Array([0, 0, 1, 0x41, 9, 9]);

    expect(scanH264NalTypes(chunk)).toEqual([1]);
    expect(getH264ChunkType(chunk)).toBe('delta');
  });

  it('handles a single NAL payload without Annex-B start codes', () => {
    expect(scanH264NalTypes(new Uint8Array([0x65, 1, 2]))).toEqual([5]);
    expect(getH264ChunkType(new Uint8Array([0x41, 1, 2]))).toBe('delta');
  });

  it('treats Foxglove keyframe chunks with SPS + IDR as key frames', () => {
    // Per foxglove_msgs/CompressedVideo: keyframes must include SPS and IDR NAL units.
    const chunk = new Uint8Array([
      0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1e,
      0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80,
      0, 0, 0, 1, 0x65, 0x88, 0x84,
    ]);

    expect(scanH264NalTypes(chunk)).toEqual([7, 8, 5]);
    expect(getH264ChunkType(chunk)).toBe('key');
  });
});
