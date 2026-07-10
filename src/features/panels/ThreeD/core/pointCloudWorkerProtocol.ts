/** Protocol for the PointCloud2 parse worker (main ↔ worker). */

export type PointCloudFieldWire = {
  name: string;
  offset: number;
  datatype?: number;
};

export type PointCloudParseRequest = {
  type: 'parse';
  /** Monotonic id; main thread ignores stale responses. */
  id: number;
  fields: PointCloudFieldWire[];
  pointStep: number;
  width: number;
  height: number;
  isBigendian: boolean;
  /** Topic name for optical-frame heuristic. */
  topic?: string;
  /** `header.frame_id` when present. */
  frameId?: string;
  /** Raw PointCloud2 `data` bytes (transferred). */
  data: ArrayBuffer;
};

export type PointCloudParseSuccess = {
  type: 'parsed';
  id: number;
  pointCount: number;
  /** width*height — GPU buffer capacity hint. */
  maxPoints: number;
  positions: ArrayBuffer;
  colors?: ArrayBuffer;
};

export type PointCloudParseFailure = {
  type: 'error';
  id: number;
  message: string;
};

export type PointCloudParseResponse = PointCloudParseSuccess | PointCloudParseFailure;
