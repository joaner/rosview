import { describe, expect, it } from 'vitest';
import {
  copyToTransferableArrayBuffer,
  opticalToRos,
  parsePointCloud2,
  PointFieldDatatype,
  sampleTurbo,
  shouldTreatAsOpticalFrame,
} from './pointCloud';

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
  frameId?: string;
}) {
  const width = options.points.length;
  const height = 1;
  const data = new Uint8Array(width * options.pointStep);
  const view = new DataView(data.buffer);
  for (let i = 0; i < options.points.length; i++) {
    options.points[i]!(view, i * options.pointStep);
  }
  return {
    header: options.frameId ? { frame_id: options.frameId } : undefined,
    fields: options.fields,
    data,
    point_step: options.pointStep,
    width,
    height,
    is_bigendian: options.isBigendian ?? false,
  };
}

const XYZ_FIELDS = [
  { name: 'x', offset: 0, datatype: PointFieldDatatype.FLOAT32 },
  { name: 'y', offset: 4, datatype: PointFieldDatatype.FLOAT32 },
  { name: 'z', offset: 8, datatype: PointFieldDatatype.FLOAT32 },
];

describe('shouldTreatAsOpticalFrame', () => {
  it('detects optical frame_id and depth/points topics', () => {
    expect(shouldTreatAsOpticalFrame('camera_depth_optical_frame')).toBe(true);
    expect(shouldTreatAsOpticalFrame(undefined, '/orbbec_free/depth/points')).toBe(true);
    expect(shouldTreatAsOpticalFrame('map', '/lidar/points')).toBe(false);
  });
});

describe('opticalToRos', () => {
  it('maps optical Z-forward Y-down to ROS X-forward Z-up', () => {
    expect(opticalToRos(1, 2, 3)).toEqual([3, -1, -2]);
  });
});

describe('copyToTransferableArrayBuffer', () => {
  it('returns a plain ArrayBuffer even when source is SharedArrayBuffer-backed', () => {
    const sab = new SharedArrayBuffer(8);
    const view = new Uint8Array(sab);
    view.set([1, 2, 3, 4, 5, 6, 7, 8]);
    const copied = copyToTransferableArrayBuffer(view);
    expect(copied).toBeInstanceOf(ArrayBuffer);
    expect(copied).not.toBeInstanceOf(SharedArrayBuffer);
    expect([...new Uint8Array(copied)]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('parsePointCloud2', () => {
  it('converts optical xyz to ROS and colorizes by depth turbo for depth topics', () => {
    const message = buildCloud({
      fields: XYZ_FIELDS,
      pointStep: 16,
      frameId: 'orbbec_depth_optical_frame',
      points: [
        (view, offset) => {
          view.setFloat32(offset, 1, true);
          view.setFloat32(offset + 4, 2, true);
          view.setFloat32(offset + 8, 3, true);
        },
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 10, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { topic: '/orbbec_free/depth/points' });
    expect(parsed).not.toBeNull();
    expect(parsed!.count).toBe(2);
    expect(parsed!.maxPoints).toBe(2);
    expect(Array.from(parsed!.positions.subarray(0, 3))).toEqual([3, -1, -2]);
    expect(parsed!.positions[3]).toBeCloseTo(10);
    expect(parsed!.colors).toBeDefined();
    expect(parsed!.colors![0]).not.toBeCloseTo(parsed!.colors![3]!, 2);
  });

  it('does not optical-transform map-frame clouds', () => {
    const message = buildCloud({
      fields: XYZ_FIELDS,
      pointStep: 16,
      frameId: 'map',
      points: [
        (view, offset) => {
          view.setFloat32(offset, 1, true);
          view.setFloat32(offset + 4, 2, true);
          view.setFloat32(offset + 8, 3, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { topic: '/map/points', frameId: 'map' });
    expect(Array.from(parsed!.positions)).toEqual([1, 2, 3]);
  });

  it('drops non-finite and non-positive optical depth', () => {
    const message = buildCloud({
      fields: XYZ_FIELDS,
      pointStep: 16,
      frameId: 'camera_optical_frame',
      points: [
        (view, offset) => {
          view.setFloat32(offset, Number.NaN, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 1, true);
        },
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 0, true); // invalid depth
        },
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 2, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { frameId: 'camera_optical_frame' });
    expect(parsed!.count).toBe(1);
    expect(parsed!.positions[0]).toBeCloseTo(2);
  });

  it('parses PCL packed rgb float32 field', () => {
    const rgbFloat = packPclRgb(255, 128, 0);
    const message = buildCloud({
      fields: [
        ...XYZ_FIELDS,
        { name: 'rgb', offset: 12, datatype: PointFieldDatatype.FLOAT32 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 1, true);
          view.setFloat32(offset + 12, rgbFloat, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { frameId: 'map' });
    expect(parsed?.colors).toBeDefined();
    expect(parsed!.colors![0]).toBeCloseTo(1);
    expect(parsed!.colors![1]).toBeCloseTo(128 / 255);
    expect(parsed!.colors![2]).toBeCloseTo(0);
  });

  it('parses separate r/g/b uint8 fields', () => {
    const message = buildCloud({
      fields: [
        ...XYZ_FIELDS,
        { name: 'r', offset: 12, datatype: PointFieldDatatype.UINT8 },
        { name: 'g', offset: 13, datatype: PointFieldDatatype.UINT8 },
        { name: 'b', offset: 14, datatype: PointFieldDatatype.UINT8 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 1, true);
          view.setUint8(offset + 12, 0);
          view.setUint8(offset + 13, 255);
          view.setUint8(offset + 14, 127);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { frameId: 'map' });
    expect(parsed?.colors).toBeDefined();
    expect(parsed!.colors![0]).toBeCloseTo(0);
    expect(parsed!.colors![1]).toBeCloseTo(1);
    expect(parsed!.colors![2]).toBeCloseTo(127 / 255);
  });

  it('parses intensity as per-frame normalized grayscale', () => {
    const message = buildCloud({
      fields: [
        ...XYZ_FIELDS,
        { name: 'intensity', offset: 12, datatype: PointFieldDatatype.FLOAT32 },
      ],
      pointStep: 16,
      points: [
        (view, offset) => {
          view.setFloat32(offset, 0, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 1, true);
          view.setFloat32(offset + 12, 10, true);
        },
        (view, offset) => {
          view.setFloat32(offset, 1, true);
          view.setFloat32(offset + 4, 0, true);
          view.setFloat32(offset + 8, 1, true);
          view.setFloat32(offset + 12, 30, true);
        },
      ],
    });

    const parsed = parsePointCloud2(message, { frameId: 'map' });
    expect(parsed?.colors).toBeDefined();
    expect(parsed!.colors![0]).toBeCloseTo(0);
    expect(parsed!.colors![3]).toBeCloseTo(1);
  });

  it('returns null for incomplete messages', () => {
    expect(parsePointCloud2(null)).toBeNull();
    expect(parsePointCloud2({})).toBeNull();
  });
});

describe('sampleTurbo', () => {
  it('writes distinct colors at 0 and 1', () => {
    const a = new Float32Array(3);
    const b = new Float32Array(3);
    sampleTurbo(0, a, 0);
    sampleTurbo(1, b, 0);
    expect(a[0]).not.toBeCloseTo(b[0]!, 2);
  });
});
