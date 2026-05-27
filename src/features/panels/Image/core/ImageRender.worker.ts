/// <reference lib="webworker" />

import type { Time } from '@/core/types/ros';
import { decodeRawImage } from './rawDecoders';
import { getH264ChunkType } from './h264';
import { withTimeout } from './asyncTimeout';
import {
  getCompressedKind,
  normalizeCompressedMime,
  type ImageSurfaceStatus,
} from './imageTypes';
import type {
  ImageRenderOptions,
  ImageRenderWorkerEvent,
  ImageRenderWorkerRequest,
  ImageViewport,
  ImageWorkerFrameEnvelope,
} from './imageWorkerProtocol';
import type { RawImageDecodeOptions } from './imageColorMode';

const DEFAULT_RENDER_OPTIONS: ImageRenderOptions = {
  backgroundColor: '#000000',
  flipHorizontal: false,
  flipVertical: false,
  rotationDeg: 0,
  smoothing: true,
  fitMode: 'contain',
};

function normalizeRotationDeg(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return d;
}

/** Axis-aligned bounding size of a `sourceW × sourceH` rectangle rotated by `rotationDeg` (degrees). */
function rotatedAabbSize(sourceWidth: number, sourceHeight: number, rotationDeg: number): { w: number; h: number } {
  const rad = (normalizeRotationDeg(rotationDeg) * Math.PI) / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  return {
    w: sourceWidth * absCos + sourceHeight * absSin,
    h: sourceWidth * absSin + sourceHeight * absCos,
  };
}

const DEFAULT_VIEWPORT: ImageViewport = {
  cssWidth: 0,
  cssHeight: 0,
  devicePixelRatio: 1,
};

const H264_CODEC = 'avc1.4D4020';
const MAX_KEY_CHUNKS = 10;
const MAX_H264_PENDING_FRAMES = 180;
const OUTPUT_TIMEOUT_MS = 5000;

// ---------- H.264 decoder ----------

class WorkerH264Decoder {
  #decoder: VideoDecoder | null = null;
  #lastKeyChunks: { timeKey: bigint; data: Uint8Array<ArrayBuffer> }[] = [];
  #lastDeltaTimeKey = 0n;
  #mutex = Promise.resolve<void>(undefined);
  #resolveFrame: ((frame: VideoFrame) => void) | null = null;
  #rejectFrame: ((err: Error) => void) | null = null;
  #outputTimeout: ReturnType<typeof setTimeout> | null = null;

  public dispose(): void {
    this.#clearOutputWait();
    if (this.#decoder && this.#decoder.state !== 'closed') {
      this.#decoder.close();
    }
    this.#decoder = null;
    this.#lastKeyChunks = [];
    this.#lastDeltaTimeKey = 0n;
    this.#mutex = Promise.resolve();
  }

  public decodeFrame(data: Uint8Array<ArrayBuffer>, sortTimeKey: bigint): Promise<VideoFrame> {
    if (typeof VideoDecoder === 'undefined') {
      return Promise.reject(new Error('WebCodecs VideoDecoder is not supported'));
    }

    const run = async (): Promise<VideoFrame> => {
      await this.#ensureDecoder();
      const decoder = this.#decoder!;
      const type = getH264ChunkType(data);

      if (type === 'key') {
        this.#lastKeyChunks.push({ timeKey: sortTimeKey, data: cloneBytes(data) });
        if (this.#lastKeyChunks.length > MAX_KEY_CHUNKS) {
          this.#lastKeyChunks.shift();
        }
      }

      let lastFrame: VideoFrame | null = null;
      if (type === 'delta' && sortTimeKey < this.#lastDeltaTimeKey) {
        for (const { timeKey, data: keyData } of this.#lastKeyChunks) {
          if (timeKey < sortTimeKey) {
            try {
              const recovered = await this.#decodeOneChunk(decoder, keyData, 'key');
              lastFrame?.close();
              lastFrame = recovered;
            } catch {
              // Ignore GOP repair failures.
            }
          }
        }
      }
      this.#lastDeltaTimeKey = sortTimeKey;
      const frame = await this.#decodeOneChunk(decoder, data, type);
      lastFrame?.close();
      return frame;
    };

    const promise = this.#mutex.then(() => run());
    this.#mutex = promise.then(
      () => undefined,
      () => undefined,
    );
    return promise;
  }

  async #ensureDecoder(): Promise<void> {
    if (this.#decoder && this.#decoder.state !== 'closed') {
      return;
    }
    const support = await VideoDecoder.isConfigSupported({ codec: H264_CODEC });
    if (!support.supported) {
      throw new Error(`H.264 codec ${H264_CODEC} is not supported`);
    }
    this.#decoder = new VideoDecoder({
      output: (frame) => {
        this.#finishOk(frame);
      },
      error: (error) => {
        this.#finishErr(new Error(String(error)));
      },
    });
    this.#decoder.configure({ codec: H264_CODEC });
  }

  async #decodeOneChunk(
    decoder: VideoDecoder,
    data: Uint8Array<ArrayBuffer>,
    type: 'key' | 'delta',
  ): Promise<VideoFrame> {
    const wait = this.#beginWait();
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type,
          timestamp: 0,
          data,
        }),
      );
    } catch (error) {
      this.#clearOutputWait();
      throw error instanceof Error ? error : new Error(String(error));
    }
    return await wait;
  }

  #beginWait(): Promise<VideoFrame> {
    return new Promise<VideoFrame>((resolve, reject) => {
      this.#resolveFrame = resolve;
      this.#rejectFrame = reject;
      this.#outputTimeout = setTimeout(() => {
        if (this.#rejectFrame) {
          const rejectFrame = this.#rejectFrame;
          this.#clearOutputWait();
          rejectFrame(new Error('H.264 decode timed out'));
        }
      }, OUTPUT_TIMEOUT_MS);
    });
  }

  #clearOutputWait(): void {
    if (this.#outputTimeout != null) {
      clearTimeout(this.#outputTimeout);
      this.#outputTimeout = null;
    }
    this.#resolveFrame = null;
    this.#rejectFrame = null;
  }

  #finishOk(frame: VideoFrame): void {
    if (this.#outputTimeout != null) {
      clearTimeout(this.#outputTimeout);
      this.#outputTimeout = null;
    }
    if (!this.#resolveFrame) {
      frame.close();
      return;
    }
    const resolveFrame = this.#resolveFrame;
    this.#resolveFrame = null;
    this.#rejectFrame = null;
    resolveFrame(frame);
  }

  #finishErr(error: Error): void {
    if (this.#outputTimeout != null) {
      clearTimeout(this.#outputTimeout);
      this.#outputTimeout = null;
    }
    if (!this.#rejectFrame) {
      return;
    }
    const rejectFrame = this.#rejectFrame;
    this.#resolveFrame = null;
    this.#rejectFrame = null;
    rejectFrame(error);
  }
}

// ---------- Cached frame state ----------

/**
 * Cached state for the last successfully decoded frame.
 * - Raw frames retain the source pixel bytes so rawDecodeOptions changes
 *   can re-decode without a new incoming frame.
 * - Compressed / h264 frames retain an ImageBitmap so renderOptions /
 *   viewport changes can redraw without re-decoding.
 */
type CachedFrame =
  | {
      kind: 'raw';
      width: number;
      height: number;
      encoding: string;
      step: number;
      isBigEndian: boolean;
      data: Uint8Array<ArrayBuffer>;
      receiveTime: Time;
    }
  | {
      kind: 'bitmap';
      width: number;
      height: number;
      encoding: string;
      bitmap: ImageBitmap;
      receiveTime: Time;
    };

// ---------- Main runtime ----------

class ImageRenderWorkerRuntime {
  #canvas: OffscreenCanvas | null = null;
  #ctx: OffscreenCanvasRenderingContext2D | null = null;
  #bufferCanvas = new OffscreenCanvas(1, 1);
  #bufferCtx = this.#bufferCanvas.getContext('2d', { alpha: false });
  #renderOptions: ImageRenderOptions = { ...DEFAULT_RENDER_OPTIONS };
  #viewport: ImageViewport = { ...DEFAULT_VIEWPORT };
  #rawDecodeOptions: Partial<RawImageDecodeOptions> = {};
  #pendingFrame: ImageWorkerFrameEnvelope | null = null;
  #pendingH264Frames: ImageWorkerFrameEnvelope[] = [];
  #isProcessing = false;
  #decoder = new WorkerH264Decoder();
  #lastPostedUiPhase: ImageSurfaceStatus['phase'] = 'idle';
  #haltUntilReset = false;
  /** Reused RGBA buffer for raw frames; resized as needed. */
  #rawRgba: Uint8ClampedArray<ArrayBuffer> | null = null;
  #rawImageData: ImageData | null = null;
  /** MIME keys already probed with ImageDecoder.isTypeSupported. */
  #imageDecoderMimeSupported = new Map<string, boolean>();
  /** The last decoded frame retained for instant-redraw on option changes. */
  #cachedFrame: CachedFrame | null = null;

  public constructor() {
    if (!this.#bufferCtx) {
      throw new Error('Buffer canvas context is unavailable in worker');
    }
  }

  public handle(message: ImageRenderWorkerRequest): void {
    switch (message.type) {
      case 'init':
        this.#canvas = message.canvas;
        this.#ctx = message.canvas.getContext('2d', {
          alpha: false,
          desynchronized: true,
        });
        if (!this.#ctx) {
          throw new Error('Canvas 2D context is unavailable in worker');
        }
        this.#applyViewport();
        this.#clearCanvas();
        this.#emitStatus({ phase: 'idle' });
        return;

      case 'viewport':
        this.#viewport = message.viewport;
        this.#applyViewport();
        this.#redrawCachedFrame();
        return;

      case 'renderOptions':
        this.#renderOptions = message.options;
        this.#redrawCachedFrame();
        return;

      case 'rawDecodeOptions':
        this.#rawDecodeOptions = message.options;
        // Re-decode and redraw immediately if we have a cached raw frame.
        this.#redrawRawCached();
        return;

      case 'frame':
        if (this.#haltUntilReset) {
          return;
        }
        this.#enqueueFrame(message.frame);
        if (!this.#isProcessing) {
          void this.#drainLatestFrame();
        }
        return;

      case 'reset':
        this.#pendingFrame = null;
        this.#pendingH264Frames = [];
        this.#haltUntilReset = false;
        this.#disposeAuxiliaryDecodeState();
        this.#disposeCachedBitmap();
        this.#cachedFrame = null;
        this.#clearCanvas();
        this.#emitStatus({ phase: 'idle' });
        return;

      case 'dispose':
        this.#pendingFrame = null;
        this.#pendingH264Frames = [];
        this.#haltUntilReset = false;
        this.#decoder.dispose();
        this.#disposeAuxiliaryDecodeState();
        this.#disposeCachedBitmap();
        this.#cachedFrame = null;
        self.close();
        return;
    }
  }

  #enqueueFrame(frame: ImageWorkerFrameEnvelope): void {
    if (!isH264Frame(frame)) {
      this.#pendingFrame = frame;
      return;
    }
    this.#pendingH264Frames.push(frame);
    this.#trimPendingH264Frames();
  }

  #trimPendingH264Frames(): void {
    if (this.#pendingH264Frames.length <= MAX_H264_PENDING_FRAMES) {
      return;
    }
    const latestKeyIndex = findLatestH264KeyFrameIndex(this.#pendingH264Frames);
    if (latestKeyIndex > 0) {
      this.#pendingH264Frames = this.#pendingH264Frames.slice(latestKeyIndex);
    }
    if (this.#pendingH264Frames.length > MAX_H264_PENDING_FRAMES) {
      this.#pendingH264Frames = this.#pendingH264Frames.slice(-MAX_H264_PENDING_FRAMES);
    }
  }

  #takeNextFrame(): ImageWorkerFrameEnvelope | null {
    const h264Frame = this.#pendingH264Frames.shift();
    if (h264Frame) {
      return h264Frame;
    }
    const frame = this.#pendingFrame;
    this.#pendingFrame = null;
    return frame;
  }

  async #drainLatestFrame(): Promise<void> {
    if (this.#isProcessing) {
      return;
    }
    this.#isProcessing = true;
    try {
      let frame: ImageWorkerFrameEnvelope | null;
      while ((frame = this.#takeNextFrame())) {
        await this.#decodeAndRender(frame);
        if (this.#haltUntilReset) {
          this.#pendingFrame = null;
          this.#pendingH264Frames = [];
          break;
        }
      }
    } finally {
      this.#isProcessing = false;
    }
  }

  async #decodeAndRender(frame: ImageWorkerFrameEnvelope): Promise<void> {
    this.#emitStatus({ phase: 'decoding', receiveTime: frame.receiveTime });
    try {
      if (frame.kind === 'compressed') {
        const kind = getCompressedKind(frame.format);
        const bytes = ensureOwnedBytes(frame.data);
        if (bytes.byteLength === 0) {
          throw new Error(`Compressed image payload is empty: ${frame.format}`);
        }
        const sortKey = timeToKey(frame.receiveTime);

        if (kind === 'h264') {
          const videoFrame = await this.#decoder.decodeFrame(bytes, sortKey);
          try {
            const width = videoFrame.displayWidth || videoFrame.codedWidth;
            const height = videoFrame.displayHeight || videoFrame.codedHeight;
            this.#drawCanvasImageSource(videoFrame, width, height);
            this.#emitStatus({
              phase: 'ready',
              width,
              height,
              encoding: frame.format,
              receiveTime: frame.receiveTime,
            });
            this.#disposeCachedBitmap();
            this.#cachedFrame = null;
            try {
              const bitmap = await createImageBitmap(videoFrame);
              this.#storeBitmap(bitmap, width, height, frame.format, frame.receiveTime);
            } catch {
              // The frame is already on screen; cache creation is only for cheap redraws.
            }
          } finally {
            videoFrame.close();
          }
          return;
        }

        const imageSource = await withTimeout(
          this.#decodeCompressed(bytes, frame.format),
          OUTPUT_TIMEOUT_MS,
          `Compressed image decode timed out: ${frame.format}`,
          closeCanvasImageSource,
        );
        let sourceToClose: ImageBitmap | VideoFrame | null = imageSource;
        try {
          const width = 'displayWidth' in imageSource ? imageSource.displayWidth : imageSource.width;
          const height = 'displayHeight' in imageSource ? imageSource.displayHeight : imageSource.height;
          const bitmap = isImageBitmap(imageSource)
            ? imageSource
            : await withTimeout(
                createImageBitmap(imageSource as ImageBitmapSource),
                OUTPUT_TIMEOUT_MS,
                `Compressed image bitmap creation timed out: ${frame.format}`,
                closeImageBitmap,
              );
          if (isImageBitmap(imageSource)) {
            sourceToClose = null;
          }
          closeCanvasImageSourceIfNeeded(sourceToClose);
          sourceToClose = null;
          this.#storeBitmap(bitmap, width, height, frame.format, frame.receiveTime);
          this.#drawBitmap(bitmap, width, height);
          this.#emitStatus({
            phase: 'ready',
            width,
            height,
            encoding: frame.format,
            receiveTime: frame.receiveTime,
          });
        } catch (err) {
          closeCanvasImageSourceIfNeeded(sourceToClose);
          throw err;
        }
        return;
      }

      // Raw frame
      const bytes = ensureOwnedBytes(frame.data);
      const pixelBytes = frame.width * frame.height * 4;
      let rgba = this.#rawRgba;
      if (!rgba || rgba.length !== pixelBytes) {
        rgba = new Uint8ClampedArray(pixelBytes);
        this.#rawRgba = rgba;
      }
      if (!this.#rawImageData || this.#rawImageData.width !== frame.width || this.#rawImageData.height !== frame.height) {
        this.#rawImageData = new ImageData(rgba, frame.width, frame.height);
      }

      const step = frame.step ?? (frame.width * bytesPerPixel(frame.encoding));
      const isBigEndian = frame.isBigEndian ?? false;

      decodeRawImage(
        {
          encoding: frame.encoding,
          width: frame.width,
          height: frame.height,
          step,
          is_bigendian: isBigEndian,
          data: bytes,
        },
        rgba,
        this.#rawDecodeOptions,
      );

      // Store source bytes so rawDecodeOptions changes can re-decode immediately.
      this.#disposeCachedBitmap();
      this.#cachedFrame = {
        kind: 'raw',
        width: frame.width,
        height: frame.height,
        encoding: frame.encoding,
        step,
        isBigEndian,
        data: bytes,
        receiveTime: frame.receiveTime,
      };

      this.#drawRawImageData(frame.width, frame.height);
      this.#emitStatus({
        phase: 'ready',
        width: frame.width,
        height: frame.height,
        encoding: frame.encoding,
        receiveTime: frame.receiveTime,
      });
    } catch (error) {
      this.#haltUntilReset = true;
      this.#emitStatus({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** Re-decode the last raw frame with current rawDecodeOptions and redraw. */
  #redrawRawCached(): void {
    const cached = this.#cachedFrame;
    if (!cached || cached.kind !== 'raw') {
      return;
    }
    const pixelBytes = cached.width * cached.height * 4;
    let rgba = this.#rawRgba;
    if (!rgba || rgba.length !== pixelBytes) {
      rgba = new Uint8ClampedArray(pixelBytes);
      this.#rawRgba = rgba;
    }
    if (!this.#rawImageData || this.#rawImageData.width !== cached.width || this.#rawImageData.height !== cached.height) {
      this.#rawImageData = new ImageData(rgba, cached.width, cached.height);
    }
    try {
      decodeRawImage(
        {
          encoding: cached.encoding,
          width: cached.width,
          height: cached.height,
          step: cached.step,
          is_bigendian: cached.isBigEndian,
          data: cached.data,
        },
        rgba,
        this.#rawDecodeOptions,
      );
      this.#drawRawImageData(cached.width, cached.height);
      this.#emitStatus({
        phase: 'ready',
        width: cached.width,
        height: cached.height,
        encoding: cached.encoding,
        receiveTime: cached.receiveTime,
      });
    } catch {
      // Ignore re-decode errors; the last successful frame is still visible.
    }
  }

  /** Redraw the cached frame with current renderOptions / viewport. */
  #redrawCachedFrame(): void {
    const cached = this.#cachedFrame;
    if (!cached) {
      this.#clearCanvas();
      return;
    }
    if (cached.kind === 'raw') {
      this.#drawRawImageData(cached.width, cached.height);
      this.#emitStatus({
        phase: 'ready',
        width: cached.width,
        height: cached.height,
        encoding: cached.encoding,
        receiveTime: cached.receiveTime,
      });
    } else {
      this.#drawBitmap(cached.bitmap, cached.width, cached.height);
      this.#emitStatus({
        phase: 'ready',
        width: cached.width,
        height: cached.height,
        encoding: cached.encoding,
        receiveTime: cached.receiveTime,
      });
    }
  }

  #storeBitmap(bitmap: ImageBitmap, width: number, height: number, encoding: string, receiveTime: Time): void {
    this.#disposeCachedBitmap();
    this.#cachedFrame = { kind: 'bitmap', width, height, encoding, bitmap, receiveTime };
  }

  #disposeCachedBitmap(): void {
    if (this.#cachedFrame?.kind === 'bitmap') {
      this.#cachedFrame.bitmap.close();
    }
  }

  async #decodeCompressed(
    data: Uint8Array<ArrayBuffer>,
    format: string,
  ): Promise<ImageBitmap | VideoFrame> {
    const mime = normalizeCompressedMime(format);
    if (typeof ImageDecoder !== 'undefined') {
      let supported = this.#imageDecoderMimeSupported.get(mime);
      if (supported === undefined) {
        supported = await ImageDecoder.isTypeSupported(mime);
        this.#imageDecoderMimeSupported.set(mime, supported);
      }
      if (supported) {
        const decoder = new ImageDecoder({ type: mime, data });
        try {
          const { image } = await decoder.decode({ frameIndex: 0 });
          return image;
        } finally {
          decoder.close();
        }
      }
    }
    return createImageBitmap(new Blob([data], { type: mime }));
  }

  #disposeAuxiliaryDecodeState(): void {
    this.#imageDecoderMimeSupported.clear();
    this.#rawRgba = null;
    this.#rawImageData = null;
  }

  #emitStatus(status: ImageSurfaceStatus): void {
    if (status.phase === 'decoding') {
      if (this.#lastPostedUiPhase !== 'idle' && this.#lastPostedUiPhase !== 'error') {
        return;
      }
    }
    this.#lastPostedUiPhase = status.phase;
    const event: ImageRenderWorkerEvent = { type: 'status', status };
    workerScope.postMessage(event);
  }

  #drawRawImageData(width: number, height: number): void {
    ensureBufferCanvas(this.#bufferCanvas, width, height);
    this.#bufferCtx!.putImageData(this.#rawImageData!, 0, 0);
    this.#drawCanvasImageSource(this.#bufferCanvas, width, height);
  }

  #drawBitmap(bitmap: ImageBitmap, width: number, height: number): void {
    this.#drawCanvasImageSource(bitmap, width, height);
  }

  #drawCanvasImageSource(source: CanvasImageSource, sourceWidth: number, sourceHeight: number): void {
    this.#applyViewport();
    const ctx = this.#ctx;
    const canvas = this.#canvas;
    if (!ctx || !canvas) {
      return;
    }
    const viewportWidth = this.#viewport.cssWidth || canvas.width / Math.max(1, this.#viewport.devicePixelRatio) || 1;
    const viewportHeight = this.#viewport.cssHeight || canvas.height / Math.max(1, this.#viewport.devicePixelRatio) || 1;
    const rotDeg = normalizeRotationDeg(this.#renderOptions.rotationDeg);
    const { w: logicalWidth, h: logicalHeight } = rotatedAabbSize(sourceWidth, sourceHeight, rotDeg);
    const scale =
      this.#renderOptions.fitMode === 'contain'
        ? Math.min(viewportWidth / logicalWidth, viewportHeight / logicalHeight)
        : Math.max(viewportWidth / logicalWidth, viewportHeight / logicalHeight);
    const drawWidth = Math.max(1, sourceWidth * scale);
    const drawHeight = Math.max(1, sourceHeight * scale);

    ctx.save();
    ctx.setTransform(this.#viewport.devicePixelRatio, 0, 0, this.#viewport.devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    ctx.fillStyle = this.#renderOptions.backgroundColor;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
    ctx.imageSmoothingEnabled = this.#renderOptions.smoothing;
    ctx.imageSmoothingQuality = this.#renderOptions.smoothing ? 'high' : 'low';
    ctx.translate(viewportWidth / 2, viewportHeight / 2);
    ctx.rotate((rotDeg * Math.PI) / 180);
    ctx.scale(this.#renderOptions.flipHorizontal ? -1 : 1, this.#renderOptions.flipVertical ? -1 : 1);
    ctx.drawImage(source, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();
  }

  #applyViewport(): void {
    if (!this.#canvas) {
      return;
    }
    const pixelWidth = Math.max(1, Math.round(Math.max(0, this.#viewport.cssWidth) * Math.max(1, this.#viewport.devicePixelRatio)));
    const pixelHeight = Math.max(1, Math.round(Math.max(0, this.#viewport.cssHeight) * Math.max(1, this.#viewport.devicePixelRatio)));
    if (this.#canvas.width !== pixelWidth) {
      this.#canvas.width = pixelWidth;
    }
    if (this.#canvas.height !== pixelHeight) {
      this.#canvas.height = pixelHeight;
    }
  }

  #clearCanvas(): void {
    if (!this.#ctx || !this.#canvas) {
      return;
    }
    this.#ctx.save();
    this.#ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.#ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#ctx.fillStyle = this.#renderOptions.backgroundColor;
    this.#ctx.fillRect(0, 0, this.#canvas.width, this.#canvas.height);
    this.#ctx.restore();
  }
}

// ---------- Helpers ----------

function bytesPerPixel(encoding: string): number {
  const lower = encoding.trim().toLowerCase();
  switch (lower) {
    case 'rgb8':
    case 'bgr8':
    case '8uc3':
      return 3;
    case 'rgba8':
    case 'bgra8':
    case '32fc1':
      return 4;
    case 'mono16':
    case '16uc1':
    case 'uyvy':
    case 'yuyv':
    case 'yuv422':
    case 'yuv422_yuy2':
      return 2;
    default:
      return 1;
  }
}

function ensureBufferCanvas(canvas: OffscreenCanvas, width: number, height: number): void {
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function cloneBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(data.byteLength));
  copy.set(data);
  return copy;
}

function ensureOwnedBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (
    data.buffer instanceof ArrayBuffer &&
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength
  ) {
    return data as Uint8Array<ArrayBuffer>;
  }
  return cloneBytes(data);
}

function isH264Frame(frame: ImageWorkerFrameEnvelope): boolean {
  return frame.kind === 'compressed' && getCompressedKind(frame.format) === 'h264';
}

function findLatestH264KeyFrameIndex(frames: ImageWorkerFrameEnvelope[]): number {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const frame = frames[i];
    if (!frame || !isH264Frame(frame)) {
      continue;
    }
    if (getH264ChunkType(frame.data) === 'key') {
      return i;
    }
  }
  return -1;
}

function timeToKey(time: Time): bigint {
  return BigInt(time.sec) * 1_000_000_000n + BigInt(time.nsec);
}

function closeCanvasImageSource(source: ImageBitmap | VideoFrame): void {
  source.close();
}

function closeCanvasImageSourceIfNeeded(source: ImageBitmap | VideoFrame | null): void {
  if (source) {
    closeCanvasImageSource(source);
  }
}

function closeImageBitmap(bitmap: ImageBitmap): void {
  bitmap.close();
}

function isImageBitmap(source: ImageBitmap | VideoFrame): source is ImageBitmap {
  return typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap;
}

// ---------- Bootstrap ----------

const runtime = new ImageRenderWorkerRuntime();
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ImageRenderWorkerRequest>) => {
  runtime.handle(event.data);
};
