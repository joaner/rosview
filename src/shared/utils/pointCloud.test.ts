import { describe, expect, it } from 'vitest';
import { parsePointCloud2, PointFieldDatatype } from './pointCloud';

function packPclRgb(r: number, g: number, b: number): number {
  const packed = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  const buf = new ArrayBuffer(4);
  new Uint32Array(buf)[0] = packed;
  return new Float32Array(buf)[0]!;
}

function buildCloud(options: {
  fields: Array<{ name: string; offset: number; datatype: number }>;
  pointStep: number;
  points: Array<(view: DataView, offset: number) => void>;
  isBigendian?: boolean;
}) {
  const width = options.points.length;
  const height = 1;
  const data = new Uint8Array(width * options.pointStep);
  const view = new DataView(data.buffer);
  for (let i = 0; i < options.points.length; i++) {
    options.points[i]!(view, i * options.pointStep);
  }
  return {
    fields: options.fields,
    data,
    point_step: options.pointStep,
    width,
    height,
    is_bigendian: options.isBigendian ?? false,
  };
}

describe('parsePointCloud2', () => {
  it('parses xyz without colors', () => {
    const message = buildCloud({
      fields: [
        { name: 'x', offset: 0, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'y', offset: 4, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'z', offset: 8, datatype: PointFieldDatatype.FLOAT32 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 1, true);
          view.setFloat32(offset + 4, 2, true);
          view.setFloat32(offset + 8, 3, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message);
    expect(parsed).not.toBeNull();
    expect(Array.from(parsed!.positions)).toEqual([1, 2, 3]);
    expect(parsed!.colors).toBeUndefined();
  });

  it('parses PCL packed rgb float32 field', () => {
    const rgbFloat = packPclRgb(255, 128, 0);
    const message = buildCloud({
      fields: [
        { name: 'x', offset: 0, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'y', offset: 4, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'z', offset: 8, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'rgb', offset: 12, datatype: PointFieldDatatype.FLOAT32 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 0, true);
          view.setFloat32(offset + 12, rgbFloat, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message);
    expect(parsed?.colors).toBeDefined();
    expect(parsed!.colors![0]).toBeCloseTo(1);
    expect(parsed!.colors![1]).toBeCloseTo(128 / 255);
    expect(parsed!.colors![2]).toBeCloseTo(0);
  });

  it('parses separate r/g/b uint8 fields', () => {
    const message = buildCloud({
      fields: [
        { name: 'x', offset: 0, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'y', offset: 4, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'z', offset: 8, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'r', offset: 12, datatype: PointFieldDatatype.UINT8 },
        { name: 'g', offset: 13, datatype: PointFieldDatatype.UINT8 },
        { name: 'b', offset: 14, datatype: PointFieldDatatype.UINT8 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 0, true);
          view.setUint8(offset + 12, 0);
          view.setUint8(offset + 13, 255);
          view.setUint8(offset + 14, 127);
        },
      ],
    });

    const parsed = parsePointCloud2(message);
    expect(parsed?.colors).toBeDefined();
    expect(parsed!.colors![0]).toBeCloseTo(0);
    expect(parsed!.colors![1]).toBeCloseTo(1);
    expect(parsed!.colors![2]).toBeCloseTo(127 / 255);
  });

  it('parses intensity as per-frame normalized grayscale', () => {
    const message = buildCloud({
      fields: [
        { name: 'x', offset: 0, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'y', offset: 4, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'z', offset: 8, datatype: PointFieldDatatype.FLOAT32 },
        { name: 'intensity', offset: 12, datatype: PointFieldDatatype.FLOAT32 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 0, true);
          view.setFloat32(offset + 12, 10, true);
        },
        (view, offset) => {
          view.setFloat32(offset, 1, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 0, true);
          view.setFloat32(offset + 12, 30, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message);
    expect(parsed?.colors).toBeDefined();
    // first point = min → 0
    expect(parsed!.colors![0]).toBeCloseTo(0);
    expect(parsed!.colors![1]).toBeCloseTo(0);
    expect(parsed!.colors![2]).toBeCloseTo(0);
    // second point = max → 1
    expect(parsed!.colors![3]).toBeCloseTo(1);
    expect(parsed!.colors![4]).toBeCloseTo(1);
    expect(parsed!.colors![5]).toBeCloseTo(1);
  });

  it('returns null for incomplete messages', () => {
    expect(parsePointCloud2(null)).toBeNull();
    expect(parsePointCloud2({})).toBeNull();
  });
});
