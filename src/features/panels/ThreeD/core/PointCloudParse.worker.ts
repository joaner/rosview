import { parsePointCloud2 } from '@/shared/utils/pointCloud';
import type {
  PointCloudParseRequest,
  PointCloudParseResponse,
  PointCloudParseSuccess,
} from './pointCloudWorkerProtocol';

/** `Float32Array.buffer` is typed as ArrayBufferLike; we only transfer plain ABs. */
function transferableBuffer(view: Float32Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = view;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

self.onmessage = (event: MessageEvent<PointCloudParseRequest>) => {
  const req = event.data;
  if (!req || req.type !== 'parse') {
    return;
  }

  try {
    const parsed = parsePointCloud2(
      {
        fields: req.fields,
        data: new Uint8Array(req.data),
        point_step: req.pointStep,
        width: req.width,
        height: req.height,
        is_bigendian: req.isBigendian,
      },
      { topic: req.topic, frameId: req.frameId },
    );

    if (!parsed) {
      const failure: PointCloudParseResponse = {
        type: 'error',
        id: req.id,
        message: 'invalid PointCloud2',
      };
      self.postMessage(failure);
      return;
    }

    const positionsBuffer = transferableBuffer(parsed.positions);
    const transfer: Transferable[] = [positionsBuffer];
    const success: PointCloudParseSuccess = {
      type: 'parsed',
      id: req.id,
      pointCount: parsed.count,
      maxPoints: parsed.maxPoints ?? req.width * req.height,
      positions: positionsBuffer,
    };
    if (parsed.colors) {
      const colorsBuffer = transferableBuffer(parsed.colors);
      transfer.push(colorsBuffer);
      success.colors = colorsBuffer;
    }
    self.postMessage(success, transfer);
  } catch (err) {
    const failure: PointCloudParseResponse = {
      type: 'error',
      id: req.id,
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(failure);
  }
};
