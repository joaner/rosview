export interface PointCloudData {
  /** Densely packed valid points (length === count * 3). */
  positions: Float32Array;
  colors?: Float32Array;
  /** Number of valid points in `positions` / `colors`. */
  count: number;
  /**
   * Preferred GPU buffer capacity (usually width*height). Lets draw-range
   * reuse survive per-frame valid-count jitter on sparse depth clouds.
   */
  maxPoints?: number;
}

export type ParsePointCloud2Options = {
  /** Topic name — used with frame_id to decide optical-frame treatment. */
  topic?: string;
  /** `header.frame_id` when available. */
  frameId?: string;
};

interface PointField {
  name: string;
  offset: number;
  datatype?: number;
}

/** sensor_msgs/PointField datatype constants. */
const POINT_FIELD_UINT8 = 2;
const POINT_FIELD_FLOAT32 = 7;

/** Depth <= this (meters) is treated as invalid in optical clouds. */
const OPTICAL_MIN_DEPTH_M = 1e-4;

function isPointField(value: unknown): value is PointField {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.offset === "number";
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function fieldByName(fields: PointField[], name: string): PointField | undefined {
  return fields.find((f) => f.name === name);
}

function readPackedRgb(
  view: DataView,
  offset: number,
  littleEndian: boolean,
): [number, number, number] {
  const packed = view.getUint32(offset, littleEndian);
  const r = ((packed >> 16) & 0xff) / 255;
  const g = ((packed >> 8) & 0xff) / 255;
  const b = (packed & 0xff) / 255;
  return [r, g, b];
}

function readNumericField(
  view: DataView,
  offset: number,
  datatype: number | undefined,
  littleEndian: boolean,
): number {
  if (datatype === POINT_FIELD_UINT8) {
    return view.getUint8(offset);
  }
  return view.getFloat32(offset, littleEndian);
}

/** REP-103: optical (Z forward, Y down) → ROS (X forward, Z up). */
export function opticalToRos(ox: number, oy: number, oz: number): [number, number, number] {
  return [oz, -ox, -oy];
}

/**
 * Treat as camera optical frame when frame_id says so (REP-103), or when the
 * topic looks like a depth PointCloud2 (`…/depth/…/points`). Map/base_link
 * clouds are left unchanged.
 */
export function shouldTreatAsOpticalFrame(frameId?: string, topic?: string): boolean {
  if (frameId && /optical/i.test(frameId)) {
    return true;
  }
  if (topic && /(?:^|\/)depth(?:\/|$)/i.test(topic) && /points/i.test(topic)) {
    return true;
  }
  return false;
}

export function readPointCloudFrameId(message: Record<string, unknown>): string | undefined {
  const header = message.header;
  if (!header || typeof header !== "object") return undefined;
  const frameId = (header as Record<string, unknown>).frame_id;
  return typeof frameId === "string" ? frameId : undefined;
}

// ── Turbo (same polynomial as Image panel) ───────────────────────────────────

const kRedVec4 = [0.13572138, 4.6153926, -42.66032258, 132.13108234] as const;
const kGreenVec4 = [0.09140261, 2.19418839, 4.84296658, -14.18503333] as const;
const kBlueVec4 = [0.1066733, 12.64194608, -60.58204836, 110.36276771] as const;
const kRedVec2 = [-152.94239396, 59.28637943] as const;
const kGreenVec2 = [4.27729857, 2.82956604] as const;
const kBlueVec2 = [-89.90310912, 27.34824973] as const;

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function sampleTurbo(pct: number, out: Float32Array, outOffset: number): void {
  const x = clamp01(pct) * 0.99 + 0.01;
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x2 * x2;
  const x5 = x3 * x2;
  const r =
    kRedVec4[0] +
    x * kRedVec4[1] +
    x2 * kRedVec4[2] +
    x3 * kRedVec4[3] +
    x4 * kRedVec2[0] +
    x5 * kRedVec2[1];
  const g =
    kGreenVec4[0] +
    x * kGreenVec4[1] +
    x2 * kGreenVec4[2] +
    x3 * kGreenVec4[3] +
    x4 * kGreenVec2[0] +
    x5 * kGreenVec2[1];
  const b =
    kBlueVec4[0] +
    x * kBlueVec4[1] +
    x2 * kBlueVec4[2] +
    x3 * kBlueVec4[3] +
    x4 * kBlueVec2[0] +
    x5 * kBlueVec2[1];
  out[outOffset] = clamp01(r);
  out[outOffset + 1] = clamp01(g);
  out[outOffset + 2] = clamp01(b);
}

/**
 * Parse a `sensor_msgs/PointCloud2` message into GPU-friendly typed arrays.
 *
 * - Drops non-finite xyz; in optical mode also drops depth <= 0.
 * - Optical frames (heuristic) are converted to ROS Z-up.
 * - Color priority: rgb/rgba → r/g/b → intensity → depth/range turbo.
 */
export function parsePointCloud2(
  message: unknown,
  options: ParsePointCloud2Options = {},
): PointCloudData | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const { fields, data, point_step, width, height } = m;
  if (!Array.isArray(fields) || !isUint8Array(data) || typeof point_step !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;

  const count = width * height;
  if (count <= 0 || point_step <= 0) return null;
  if (data.byteLength < count * point_step) return null;

  const frameId = options.frameId ?? readPointCloudFrameId(m);
  const asOptical = shouldTreatAsOpticalFrame(frameId, options.topic);

  const typedFields = fields.filter(isPointField);
  const xField = fieldByName(typedFields, "x");
  const yField = fieldByName(typedFields, "y");
  const zField = fieldByName(typedFields, "z");
  if (!xField || !yField || !zField) return null;

  const littleEndian = m.is_bigendian !== true;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  const rgbField = fieldByName(typedFields, "rgb") ?? fieldByName(typedFields, "rgba");
  const rField = fieldByName(typedFields, "r");
  const gField = fieldByName(typedFields, "g");
  const bField = fieldByName(typedFields, "b");
  const hasRgbChannels = !!(rField && gField && bField);
  const intensityField = fieldByName(typedFields, "intensity");

  const colorMode: "rgb" | "rgba_fields" | "intensity" | "depth" = rgbField
    ? "rgb"
    : hasRgbChannels
      ? "rgba_fields"
      : intensityField
        ? "intensity"
        : "depth";

  const tmpPositions = new Float32Array(count * 3);
  const tmpColors = new Float32Array(count * 3);
  const tmpScalar = colorMode === "rgb" || colorMode === "rgba_fields" ? null : new Float32Array(count);

  const xyzContiguous =
    littleEndian &&
    point_step % 4 === 0 &&
    xField.offset === 0 &&
    yField.offset === 4 &&
    zField.offset === 8 &&
    (xField.datatype === undefined || xField.datatype === POINT_FIELD_FLOAT32) &&
    (yField.datatype === undefined || yField.datatype === POINT_FIELD_FLOAT32) &&
    (zField.datatype === undefined || zField.datatype === POINT_FIELD_FLOAT32);

  const srcFloats = xyzContiguous
    ? new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4))
    : null;
  const floatsPerPoint = point_step / 4;

  let written = 0;
  let scalarMin = Number.POSITIVE_INFINITY;
  let scalarMax = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < count; i++) {
    let ox: number;
    let oy: number;
    let oz: number;
    if (srcFloats) {
      const s = i * floatsPerPoint;
      ox = srcFloats[s]!;
      oy = srcFloats[s + 1]!;
      oz = srcFloats[s + 2]!;
    } else {
      const offset = i * point_step;
      ox = view.getFloat32(offset + xField.offset, littleEndian);
      oy = view.getFloat32(offset + yField.offset, littleEndian);
      oz = view.getFloat32(offset + zField.offset, littleEndian);
    }

    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) {
      continue;
    }
    // Optical depth clouds commonly encode invalid pixels as z<=0.
    if (asOptical && oz <= OPTICAL_MIN_DEPTH_M) {
      continue;
    }

    let px: number;
    let py: number;
    let pz: number;
    if (asOptical) {
      [px, py, pz] = opticalToRos(ox, oy, oz);
    } else {
      px = ox;
      py = oy;
      pz = oz;
    }

    const d = written * 3;
    tmpPositions[d] = px;
    tmpPositions[d + 1] = py;
    tmpPositions[d + 2] = pz;

    if (colorMode === "rgb" && rgbField) {
      const [cr, cg, cb] = readPackedRgb(view, i * point_step + rgbField.offset, littleEndian);
      tmpColors[d] = cr;
      tmpColors[d + 1] = cg;
      tmpColors[d + 2] = cb;
    } else if (colorMode === "rgba_fields" && rField && gField && bField) {
      const base = i * point_step;
      tmpColors[d] = view.getUint8(base + rField.offset) / 255;
      tmpColors[d + 1] = view.getUint8(base + gField.offset) / 255;
      tmpColors[d + 2] = view.getUint8(base + bField.offset) / 255;
    } else if (tmpScalar) {
      const value =
        colorMode === "intensity" && intensityField
          ? readNumericField(
              view,
              i * point_step + intensityField.offset,
              intensityField.datatype,
              littleEndian,
            )
          : asOptical
            ? oz
            : Math.hypot(ox, oy, oz);
      tmpScalar[written] = value;
      if (Number.isFinite(value)) {
        if (value < scalarMin) scalarMin = value;
        if (value > scalarMax) scalarMax = value;
      }
    }

    written++;
  }

  if (written === 0) {
    return { positions: new Float32Array(0), count: 0, maxPoints: count };
  }

  const positions = tmpPositions.slice(0, written * 3);
  let colors: Float32Array | undefined;

  if (colorMode === "rgb" || colorMode === "rgba_fields") {
    colors = tmpColors.slice(0, written * 3);
  } else if (tmpScalar) {
    colors = new Float32Array(written * 3);
    const range = scalarMax - scalarMin;
    if (colorMode === "intensity") {
      if (range <= 0 || !Number.isFinite(range)) {
        colors.fill(0.5);
      } else {
        for (let i = 0; i < written; i++) {
          const t = (tmpScalar[i]! - scalarMin) / range;
          const o = i * 3;
          colors[o] = t;
          colors[o + 1] = t;
          colors[o + 2] = t;
        }
      }
    } else if (range <= 0 || !Number.isFinite(range)) {
      for (let i = 0; i < written; i++) {
        sampleTurbo(0.5, colors, i * 3);
      }
    } else {
      for (let i = 0; i < written; i++) {
        sampleTurbo((tmpScalar[i]! - scalarMin) / range, colors, i * 3);
      }
    }
  }

  return colors
    ? { positions, colors, count: written, maxPoints: count }
    : { positions, count: written, maxPoints: count };
}

/** Copy bytes into a plain ArrayBuffer safe to put on a Worker transfer list. */
export function copyToTransferableArrayBuffer(data: Uint8Array): ArrayBuffer {
  const payload = new ArrayBuffer(data.byteLength);
  new Uint8Array(payload).set(data);
  return payload;
}

export const PointFieldDatatype = {
  UINT8: POINT_FIELD_UINT8,
  FLOAT32: POINT_FIELD_FLOAT32,
} as const;
