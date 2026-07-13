import { describe, expect, it } from 'vitest';
import {
  containsH264IdrNal,
  getH264ChunkType,
  getH264CodecCandidates,
  monotonicH264TimestampUs,
  parseH264SpsCodec,
  scanH264NalTypes,
} from './h264';

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

  it('derives profile, compatibility flags, and level from an Annex-B SPS', () => {
    const chunk = new Uint8Array([
      0, 0, 0, 1, 0x67, 0x64, 0x00, 0x29, 0xac,
      0, 0, 1, 0x68, 0xee, 0x3c, 0x80,
    ]);

    expect(parseH264SpsCodec(chunk)).toBe('avc1.640029');
    expect(getH264CodecCandidates(chunk)).toEqual([
      'avc1.640029',
      'avc1.42E01E',
      'avc1.4D4020',
      'avc1.640028',
    ]);
  });

  it('keeps compatibility-normalized and fixed fallbacks for constrained SPS profiles', () => {
    const chunk = new Uint8Array([0, 0, 1, 0x67, 0x42, 0xe0, 0x1f]);
    expect(getH264CodecCandidates(chunk).slice(0, 2)).toEqual([
      'avc1.42E01F',
      'avc1.42001F',
    ]);
  });

  it('distinguishes SPS/PPS configuration from a true IDR resync point', () => {
    expect(containsH264IdrNal(new Uint8Array([0, 0, 1, 0x67, 0x42, 0, 0x1e]))).toBe(false);
    expect(containsH264IdrNal(new Uint8Array([0, 0, 1, 0x65, 1]))).toBe(true);
  });

  it('uses source microseconds while forcing repeats and rewinds to stay monotonic', () => {
    const first = monotonicH264TimestampUs(1_234_567_890n, -1);
    const repeated = monotonicH264TimestampUs(1_234_567_890n, first);
    const rewound = monotonicH264TimestampUs(1_000_000_000n, repeated);

    expect(first).toBe(1_234_567);
    expect(repeated).toBe(1_234_568);
    expect(rewound).toBe(1_234_569);
  });
});
