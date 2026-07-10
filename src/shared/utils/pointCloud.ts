export interface PointCloudData {
  positions: Float32Array;
  colors?: Float32Array;
}

interface PointField {
  name: string;
  offset: number;
  datatype?: number;
}

/** sensor_msgs/PointField datatype constants. */
const POINT_FIELD_UINT8 = 2;
const POINT_FIELD_FLOAT32 = 7;

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
  // PCL packs float32 bit-pattern as 0xAARRGGBB (rgba) or 0x00RRGGBB (rgb).
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
  // Default to float32 (datatype 7) which covers intensity and xyz.
  return view.getFloat32(offset, littleEndian);
}

/**
 * Parse a `sensor_msgs/PointCloud2` message into GPU-friendly typed arrays.
 *
 * Color priority:
 * 1. `rgb` / `rgba` (PCL packed float32)
 * 2. separate `r`/`g`/`b` (uint8)
 * 3. `intensity` (float32 or uint8), normalized per-frame to grayscale
 * 4. none → `colors` stays undefined
 */
export function parsePointCloud2(message: unknown): PointCloudData | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  const { fields, data, point_step, width, height } = m;
  if (!Array.isArray(fields) || !isUint8Array(data) || typeof point_step !== "number") return null;
  if (typeof width !== "number" || typeof height !== "number") return null;

  const count = width * height;
  if (count <= 0 || point_step <= 0) return null;
  if (data.byteLength < count * point_step) return null;

  const typedFields = fields.filter(isPointField);
  const xField = fieldByName(typedFields, "x");
  const yField = fieldByName(typedFields, "y");
  const zField = fieldByName(typedFields, "z");
  if (!xField || !yField || !zField) return null;

  const littleEndian = m.is_bigendian !== true;
  const positions = extractPositions(
    data,
    count,
    point_step,
    xField,
    yField,
    zField,
    littleEndian,
  );

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const colors = extractColors(view, typedFields, count, point_step, littleEndian);
  return colors ? { positions, colors } : { positions };
}

/**
 * Fast path: contiguous xyz float32 at offsets 0/4/8 on little-endian clouds
 * (Orbbec / most ROS drivers). Uses a Float32Array view instead of DataView.
 */
function extractPositions(
  data: Uint8Array,
  count: number,
  pointStep: number,
  xField: PointField,
  yField: PointField,
  zField: PointField,
  littleEndian: boolean,
): Float32Array {
  const positions = new Float32Array(count * 3);
  const xyzContiguous =
    littleEndian &&
    pointStep % 4 === 0 &&
    xField.offset === 0 &&
    yField.offset === 4 &&
    zField.offset === 8 &&
    (xField.datatype === undefined || xField.datatype === POINT_FIELD_FLOAT32) &&
    (yField.datatype === undefined || yField.datatype === POINT_FIELD_FLOAT32) &&
    (zField.datatype === undefined || zField.datatype === POINT_FIELD_FLOAT32);

  if (xyzContiguous) {
    const src = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
    const floatsPerPoint = pointStep / 4;
    for (let i = 0; i < count; i++) {
      const s = i * floatsPerPoint;
      const d = i * 3;
      positions[d] = src[s]!;
      positions[d + 1] = src[s + 1]!;
      positions[d + 2] = src[s + 2]!;
    }
    return positions;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    const offset = i * pointStep;
    const d = i * 3;
    positions[d] = view.getFloat32(offset + xField.offset, littleEndian);
    positions[d + 1] = view.getFloat32(offset + yField.offset, littleEndian);
    positions[d + 2] = view.getFloat32(offset + zField.offset, littleEndian);
  }
  return positions;
}

function extractColors(
  view: DataView,
  fields: PointField[],
  count: number,
  pointStep: number,
  littleEndian: boolean,
): Float32Array | undefined {
  const rgbField = fieldByName(fields, "rgb") ?? fieldByName(fields, "rgba");
  if (rgbField) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const offset = i * pointStep + rgbField.offset;
      const [r, g, b] = readPackedRgb(view, offset, littleEndian);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    return colors;
  }

  const rField = fieldByName(fields, "r");
  const gField = fieldByName(fields, "g");
  const bField = fieldByName(fields, "b");
  if (rField && gField && bField) {
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const base = i * pointStep;
      colors[i * 3] = view.getUint8(base + rField.offset) / 255;
      colors[i * 3 + 1] = view.getUint8(base + gField.offset) / 255;
      colors[i * 3 + 2] = view.getUint8(base + bField.offset) / 255;
    }
    return colors;
  }

  const intensityField = fieldByName(fields, "intensity");
  if (!intensityField) return undefined;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const raw = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const value = readNumericField(
      view,
      i * pointStep + intensityField.offset,
      intensityField.datatype,
      littleEndian,
    );
    raw[i] = value;
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const range = max - min;
  const colors = new Float32Array(count * 3);
  if (range <= 0 || !Number.isFinite(range)) {
    // Constant intensity → mid-gray so points remain visible.
    colors.fill(0.5);
    return colors;
  }

  // UINT8 intensity is already 0–255; still normalize by observed min/max so
  // sparse clouds with a narrow band stay high-contrast.
  for (let i = 0; i < count; i++) {
    const t = (raw[i]! - min) / range;
    colors[i * 3] = t;
    colors[i * 3 + 1] = t;
    colors[i * 3 + 2] = t;
  }
  return colors;
}

// Re-export datatype constants for tests.
export const PointFieldDatatype = {
  UINT8: POINT_FIELD_UINT8,
  FLOAT32: POINT_FIELD_FLOAT32,
} as const;
