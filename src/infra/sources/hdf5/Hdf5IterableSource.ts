/**
 * Virtual ROS IIterableSource backed by an HDF5 file.
 *
 * Expects to run inside a Web Worker after `@ioai/hdf5` worker runtime `ready`
 * and the file has been mounted into the Emscripten filesystem.
 */

import type { Initialization, MessageEvent, PlayerProblem, Time, TopicInfo } from '@/core/types/ros';
import type {
  GetAdjacentMessageArgs,
  IIterableSource,
} from '../IIterableSource';
import type {
  GetBackfillMessagesArgs,
  MessageIteratorArgs,
} from '@/infra/workers/types';
import { fromNano, toNano } from '@/shared/utils/time';
import { syncGeneratorToAsyncIterable } from '@/shared/utils/syncAsyncIterable';
import { buildHdf5DatatypesMap } from './schemas';
import {
  planTopics,
  type HdfDatasetDescriptor,
  type PlanResult,
  type TopicRecipe,
} from './heuristics';

interface H5File {
  close(): unknown;
  keys(): string[];
  get(name: string): H5Entity | null;
  paths?(): string[];
}

interface H5Metadata {
  signed?: boolean;
  /** H5T class value: 0 = integer, 1 = float, 3 = string, 6 = compound, ... */
  type?: number;
  /** Bytes per element. */
  size?: number;
  shape?: number[] | null;
}

interface H5Entity {
  type: string;
  path: string;
  // Dataset-specific
  shape?: number[] | null;
  dtype?: unknown;
  metadata?: H5Metadata;
  slice?(ranges: Array<Array<number | null>>): unknown;
  // Group-specific
  keys?(): string[];
  get?(name: string): H5Entity | null;
  value?: unknown;
}

interface EpisodeLocation {
  episodeIndex: number;
  localFrame: number;
}

export interface Hdf5SourceOptions {
  /** Display name for diagnostics. */
  fileName?: string;
  /**
   * Per-frame duration, in seconds, used to build the synthetic timeline.
   * Defaults to {@link DEFAULT_DT_SEC}. We ignore `/tm`-like datasets even
   * when present, because the values recorded on the robot side are often
   * polluted by warm-up offsets and mid-recording stalls that stretch the
   * playback into long "frozen" segments (looking like the animation loops).
   * Using a uniform dt gives predictable, natural playback.
   */
  frameDtSec?: number;
}

/** Default frame duration when none is specified: 10 Hz is the ALOHA standard. */
const DEFAULT_DT_SEC = 0.1;

// ---------------------------------------------------------------------------
// HDF5 tree walk
// ---------------------------------------------------------------------------

function* walkDatasets(group: H5Entity | H5File): Generator<H5Entity> {
  const keys = typeof (group as H5Entity).keys === 'function'
    ? (group as H5Entity).keys!()
    : (group as H5File).keys();
  for (const key of keys) {
    const child = typeof (group as H5Entity).get === 'function'
      ? (group as H5Entity).get!(key)
      : (group as H5File).get(key);
    if (!child) continue;
    if (child.type === 'Dataset') {
      yield child;
    } else if (child.type === 'Group') {
      yield* walkDatasets(child);
    }
  }
}

/**
 * Derive our canonical dtype strings from the HDF5 dataset `metadata` object.
 *
 * We prefer metadata over the `dtype` string because the binding returns NumPy
 * single-character codes (e.g. `'<f'`, `'<B'`) which lack the size digit and
 * are ambiguous in isolation. The HDF5 metadata always carries a concrete
 * (`type`, `size`, `signed`) tuple we can map deterministically.
 *
 * H5T class codes (from H5T_class_t):
 *   0 = integer  → int{8|16|32|64} or uint{8|16|32|64}
 *   1 = float    → float{32|64}
 *   anything else → 'unknown' (strings, compound, enum, ...)
 */
export function dtypeFromMetadata(md: H5Metadata | undefined): string {
  if (!md) return 'unknown';
  const bits = (md.size ?? 0) * 8;
  if (md.type === 1) {
    return bits === 32 || bits === 64 ? `float${bits}` : 'unknown';
  }
  if (md.type === 0) {
    if (bits !== 8 && bits !== 16 && bits !== 32 && bits !== 64) return 'unknown';
    return md.signed ? `int${bits}` : `uint${bits}`;
  }
  return 'unknown';
}

/**
 * Fallback dtype inference from the string returned by `dataset.dtype`. Used
 * only by the unit tests where we can't easily provide a full metadata blob.
 */
export function normalizeDtype(dtype: unknown): string {
  if (typeof dtype !== 'string') return 'unknown';
  const raw = dtype.toLowerCase();
  if (/^(float|int|uint)(8|16|32|64)$/.test(raw)) return raw;
  const m = raw.match(/^[<>=|]?([a-z])(\d+)$/);
  if (!m) return 'unknown';
  const [, kind, sizeStr] = m;
  const bits = Number(sizeStr) * 8;
  switch (kind) {
    case 'f':
      return bits === 32 || bits === 64 ? `float${bits}` : 'unknown';
    case 'i':
      return bits === 8 || bits === 16 || bits === 32 || bits === 64 ? `int${bits}` : 'unknown';
    case 'u':
      return bits === 8 || bits === 16 || bits === 32 || bits === 64 ? `uint${bits}` : 'unknown';
    default:
      return 'unknown';
  }
}

function enumerateDatasets(h5file: H5File): HdfDatasetDescriptor[] {
  const out: HdfDatasetDescriptor[] = [];
  for (const ds of walkDatasets(h5file)) {
    if (!ds.shape) continue;
    // Prefer structured metadata over the ambiguous NumPy dtype string.
    const fromMeta = dtypeFromMetadata(ds.metadata);
    const dtype = fromMeta !== 'unknown' ? fromMeta : normalizeDtype(ds.dtype);
    out.push({
      path: ds.path,
      shape: ds.shape,
      dtype,
    });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

// ---------------------------------------------------------------------------
// Timeline construction
// ---------------------------------------------------------------------------

/**
 * Build a uniform synthetic timeline: frame i happens at t = i × dt.
 *
 * We deliberately do NOT consume `/tm` (or any similar dataset) for the
 * timeline, even when present. In ALOHA/ACT-style recordings the stored per-
 * frame dt values frequently contain warm-up offsets (e.g. a 6.75 s value at
 * the first frame while the arm moves into the start pose) and mid-episode
 * stalls (the operator pausing to grasp an object), both of which cause the
 * playback to "freeze" on a single frame for seconds at a time — visually
 * indistinguishable from the animation looping.
 *
 * Using a uniform dt instead gives natural, predictable playback and makes
 * the total episode length reflect motion content rather than recording
 * artifacts. The source rate is configurable through `Hdf5SourceOptions.frameDtSec`.
 */
function buildUniformTimeline(
  frameCount: number,
  frameDtSec: number,
): { timestampsNs: bigint[]; start: Time; end: Time } {
  const dtNs = BigInt(Math.max(1, Math.round(frameDtSec * 1e9)));
  const timestampsNs = Array.from({ length: frameCount }, (_, i) => BigInt(i) * dtNs);
  const start = fromNano(0n);
  const end = fromNano(timestampsNs[frameCount - 1] ?? 0n);
  return { timestampsNs, start, end };
}

// ---------------------------------------------------------------------------
// Per-frame message builders
// ---------------------------------------------------------------------------

function toOwnedTypedData(raw: unknown): ArrayLike<number> | Uint8Array | null {
  if (raw == null) return null;
  if (ArrayBuffer.isView(raw)) {
    if (raw instanceof Uint8Array) return new Uint8Array(raw);
    if (raw instanceof Float64Array) return new Float64Array(raw);
    if (raw instanceof Float32Array) return new Float32Array(raw);
    if (raw instanceof Int32Array) return new Int32Array(raw);
    if (raw instanceof Uint32Array) return new Uint32Array(raw);
    if (raw instanceof Int16Array) return new Int16Array(raw);
    if (raw instanceof Uint16Array) return new Uint16Array(raw);
    if (raw instanceof Int8Array) return new Int8Array(raw);
    if (raw instanceof BigInt64Array) {
      const out = new Float64Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = Number(raw[i]);
      return out;
    }
    if (raw instanceof BigUint64Array) {
      const out = new Float64Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = Number(raw[i]);
      return out;
    }
    return new Uint8Array(new Uint8Array((raw).buffer, (raw).byteOffset, (raw).byteLength));
  }
  if (typeof raw === 'object' && raw && 'length' in (raw as Record<string, unknown>)) {
    return raw as ArrayLike<number>;
  }
  return null;
}

function readFrameTyped(ds: H5Entity, frameIdx: number): ArrayLike<number> | Uint8Array | null {
  if (!ds || !ds.shape || !ds.slice) return null;
  const ranges: Array<Array<number | null>> = [[frameIdx, frameIdx + 1]];
  for (let d = 1; d < ds.shape.length; d++) ranges.push([]);
  const raw = ds.slice(ranges);
  // Convert to owned arrays so downstream workers never reference WASM-backed views directly.
  return toOwnedTypedData(raw);
}

function toNumberArray(src: ArrayLike<number> | null | undefined): number[] {
  if (!src) return [];
  const n = src.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = Number(src[i]);
  return out;
}

function ensureUint8Array(src: ArrayLike<number> | Uint8Array | null): Uint8Array {
  if (!src) return new Uint8Array();
  if (src instanceof Uint8Array) return src;
  const n = src.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = src[i] & 0xff;
  return out;
}

function headerFor(time: Time, frameId: string): { stamp: { sec: number; nanosec: number }; frame_id: string } {
  return { stamp: { sec: time.sec, nanosec: time.nsec }, frame_id: frameId };
}

// ---------------------------------------------------------------------------
// Source
// ---------------------------------------------------------------------------

type FrameReader = (frameIdx: number, time: Time) => unknown;

interface CompiledTopic {
  topic: string;
  schemaName: string;
  recipe: TopicRecipe;
  read: FrameReader;
}

export class Hdf5IterableSource implements IIterableSource {
  private _h5file: H5File;
  private _frameDtSec: number;
  private _plan?: PlanResult;
  private _topics: CompiledTopic[] = [];
  private _topicByName = new Map<string, CompiledTopic>();
  private _timestampsNs: bigint[] = [];
  private _end: Time = { sec: 0, nsec: 0 };
  private _episodeOffsets: number[] = [];
  private _pathExpansions: Record<string, string[]> = {};
  private _topicToPathSequence = new Map<string, string[]>();

  constructor(h5file: H5File, options: Hdf5SourceOptions = {}) {
    this._h5file = h5file;
    this._frameDtSec = options.frameDtSec && options.frameDtSec > 0 ? options.frameDtSec : DEFAULT_DT_SEC;
  }

  initialize(): Promise<Initialization> {
    const datasets = enumerateDatasets(this._h5file);
    this._plan = planTopics(datasets);
    const problems: PlayerProblem[] = [];
    for (const unmapped of this._plan.unmapped) {
      problems.push({
        severity: 'warn',
        message: `Skipped dataset ${unmapped} (unsupported shape or dtype)`,
      });
    }

    const { timestampsNs, start, end } = buildUniformTimeline(
      this._plan.frameCount,
      this._frameDtSec,
    );
    this._timestampsNs = timestampsNs;
    this._end = end;

    // Report when a `/tm`-like dataset was present but intentionally skipped,
    // so users know why the timeline is uniform rather than data-driven.
    if (this._plan.timelinePath) {
      problems.push({
        severity: 'warn',
        message:
          `Ignored timeline dataset ${this._plan.timelinePath}; using uniform ` +
          `${(this._frameDtSec * 1000).toFixed(0)} ms/frame (${(1 / this._frameDtSec).toFixed(1)} Hz).`,
      });
    }

    this._topics = this._plan.recipes.map((recipe) => this._compileRecipe(recipe));
    this._pathExpansions = this._plan.pathExpansions ?? {};
    this._topicToPathSequence = new Map();
    for (const [k, v] of Object.entries(this._pathExpansions)) {
      this._topicToPathSequence.set(k, v);
    }
    this._episodeOffsets = [];
    if (this._plan.episodeFrameCounts && this._plan.episodeFrameCounts.length > 0) {
      let acc = 0;
      for (const count of this._plan.episodeFrameCounts) {
        this._episodeOffsets.push(acc);
        acc += count;
      }
    }

    this._topicByName = new Map(this._topics.map((t) => [t.topic, t]));

    const topicInfos: TopicInfo[] = this._topics.map((t) => ({
      name: t.topic,
      type: t.schemaName,
      messageCount: this._plan!.frameCount,
      durationSec: Number(toNano(end) - toNano(start)) / 1e9,
      frequency:
        this._plan!.frameCount > 1
          ? Number(
              ((BigInt(this._plan!.frameCount - 1) * 1_000_000_000n) /
                (toNano(end) - toNano(start) || 1n))
                .toString(),
            ) || undefined
          : undefined,
    }));

    const publishersByTopic: Record<string, string[]> = {};
    const topicStats: Record<string, { messageCount: number; frequency: number; durationSec?: number }> = {};
    for (const t of this._topics) {
      publishersByTopic[t.topic] = ['hdf5'];
      topicStats[t.topic] = {
        messageCount: this._plan.frameCount,
        durationSec: Number(toNano(end) - toNano(start)) / 1e9,
        frequency:
          this._plan.frameCount > 1 && toNano(end) > 0n
            ? Number(this._plan.frameCount - 1) / (Number(toNano(end)) / 1e9)
            : 0,
      };
    }

    return Promise.resolve({
      topics: topicInfos,
      datatypes: buildHdf5DatatypesMap(),
      start,
      end,
      publishersByTopic,
      topicStats,
      problems,
      // Suggest the playback tick rate to match our synthetic data cadence
      // (e.g. 10 Hz for the default 100 ms/frame). Playback advances at the
      // same rhythm the data was produced, so each frame renders exactly
      // once per tick and the PlaybackBar's FPS control reflects the source.
      preferredSamplingFps: 1 / this._frameDtSec,
      randomAccessByTopic: true,
    });
  }

  private _compileRecipe(recipe: TopicRecipe): CompiledTopic {
    const h5file = this._h5file;
    const resolve = (path: string | undefined, frameIdx?: number): H5Entity | null => {
      if (!path) return null;
      if (frameIdx == undefined) return h5file.get(path) ?? null;
      const loc = this._locateEpisodeFrame(frameIdx);
      if (!loc) return h5file.get(path) ?? null;
      const seq = this._topicToPathSequence.get(path);
      const actualPath = seq?.[loc.episodeIndex] ?? path;
      return h5file.get(actualPath) ?? null;
    };
    const frameFor = (globalFrameIdx: number): EpisodeLocation => this._locateEpisodeFrame(globalFrameIdx) ?? { episodeIndex: 0, localFrame: globalFrameIdx };

    let read: FrameReader;
    switch (recipe.kind) {
      case 'jointState': {
        const r = recipe;
        const jointNames = r.jointNames;
        read = (frameIdx, time) => {
          const loc = frameFor(frameIdx);
          const posDs = resolve(r.positionPath, frameIdx);
          const velDs = resolve(r.velocityPath, frameIdx);
          const effDs = resolve(r.effortPath, frameIdx);
          return {
            header: headerFor(time, 'base'),
            name: jointNames,
            position: posDs ? toNumberArray(readFrameTyped(posDs, loc.localFrame)) : [],
            velocity: velDs ? toNumberArray(readFrameTyped(velDs, loc.localFrame)) : [],
            effort: effDs ? toNumberArray(readFrameTyped(effDs, loc.localFrame)) : [],
          };
        };
        break;
      }
      case 'image': {
        const r = recipe;
        const step = r.width * r.sourceChannels;
        const encoding = r.encoding;
        read = (frameIdx, time) => {
          const loc = frameFor(frameIdx);
          const ds = resolve(r.path, frameIdx);
          const raw = ds ? readFrameTyped(ds, loc.localFrame) : null;
          const data = ensureUint8Array(raw);
          return {
            header: headerFor(time, 'camera'),
            height: r.height,
            width: r.width,
            encoding,
            is_bigendian: 0,
            step,
            data,
          };
        };
        break;
      }
      case 'poseStamped': {
        const r = recipe;
        read = (frameIdx, time) => {
          const loc = frameFor(frameIdx);
          const posDs = resolve(r.positionPath, frameIdx);
          const quatDs = resolve(r.quaternionPath, frameIdx);
          const p = posDs ? readFrameTyped(posDs, loc.localFrame) : null;
          const q = quatDs ? readFrameTyped(quatDs, loc.localFrame) : null;
          const px = p ? Number(p[0] ?? 0) : 0;
          const py = p ? Number(p[1] ?? 0) : 0;
          const pz = p ? Number(p[2] ?? 0) : 0;
          // Interpret as xyzw per heuristic default.
          const qx = q ? Number(q[0] ?? 0) : 0;
          const qy = q ? Number(q[1] ?? 0) : 0;
          const qz = q ? Number(q[2] ?? 0) : 0;
          const qw = q ? Number(q[3] ?? 1) : 1;
          return {
            header: headerFor(time, r.frameId),
            pose: {
              position: { x: px, y: py, z: pz },
              orientation: { x: qx, y: qy, z: qz, w: qw },
            },
          };
        };
        break;
      }
      case 'twistStamped': {
        const r = recipe;
        read = (frameIdx, time) => {
          const loc = frameFor(frameIdx);
          const linDs = resolve(r.linearPath, frameIdx);
          const angDs = resolve(r.angularPath, frameIdx);
          const l = linDs ? readFrameTyped(linDs, loc.localFrame) : null;
          const a = angDs ? readFrameTyped(angDs, loc.localFrame) : null;
          return {
            header: headerFor(time, r.frameId),
            twist: {
              linear: { x: Number(l?.[0] ?? 0), y: Number(l?.[1] ?? 0), z: Number(l?.[2] ?? 0) },
              angular: { x: Number(a?.[0] ?? 0), y: Number(a?.[1] ?? 0), z: Number(a?.[2] ?? 0) },
            },
          };
        };
        break;
      }
      case 'wrenchStamped': {
        const r = recipe;
        read = (frameIdx, time) => {
          const loc = frameFor(frameIdx);
          const ds = resolve(r.path, frameIdx);
          const v = ds ? readFrameTyped(ds, loc.localFrame) : null;
          return {
            header: headerFor(time, r.frameId),
            wrench: {
              force: { x: Number(v?.[0] ?? 0), y: Number(v?.[1] ?? 0), z: Number(v?.[2] ?? 0) },
              torque: { x: Number(v?.[3] ?? 0), y: Number(v?.[4] ?? 0), z: Number(v?.[5] ?? 0) },
            },
          };
        };
        break;
      }
      case 'float32Array': {
        const r = recipe;
        const layout = {
          dim: r.innerShape.map((s, i) => ({ label: `d${i}`, size: s, stride: r.innerShape.slice(i).reduce((a, b) => a * b, 1) })),
          data_offset: 0,
        };
        read = (frameIdx) => {
          if (r.path === '/episode_index') {
            const loc = frameFor(frameIdx);
            return { layout, data: [loc.episodeIndex] };
          }
          const loc = frameFor(frameIdx);
          const ds = resolve(r.path, frameIdx);
          const raw = ds ? readFrameTyped(ds, loc.localFrame) : null;
          return {
            layout,
            data: toNumberArray(raw),
          };
        };
        break;
      }
      case 'float32Scalar': {
        const r = recipe;
        read = (frameIdx) => {
          if (r.path === '/episode_index') {
            const loc = frameFor(frameIdx);
            return { data: loc.episodeIndex };
          }
          const loc = frameFor(frameIdx);
          const ds = resolve(r.path, frameIdx);
          const raw = ds ? readFrameTyped(ds, loc.localFrame) : null;
          return { data: Number(raw?.[0] ?? 0) };
        };
        break;
      }
    }

    return { topic: recipe.topic, schemaName: recipe.schemaName, recipe, read };
  }

  // -------------------------------------------------------------------------
  // IIterableSource methods
  // -------------------------------------------------------------------------

  messageIterator(args: MessageIteratorArgs): AsyncIterableIterator<MessageEvent<Uint8Array>> {
    return syncGeneratorToAsyncIterable(() => this._messageIteratorSync(args));
  }

  private *_messageIteratorSync(args: MessageIteratorArgs): Generator<MessageEvent<Uint8Array>> {
    const startNs = toNano(args.startTime);
    const endNs = args.endTime ? toNano(args.endTime) : toNano(this._end);
    const requested = new Set(args.topics);
    const subscribedTopics = this._topics.filter((t) => requested.has(t.topic));
    if (subscribedTopics.length === 0) return;

    // Binary search for first frame with timestamp >= startNs.
    let lo = 0,
      hi = this._timestampsNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._timestampsNs[mid] < startNs) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < this._timestampsNs.length; i++) {
      const ns = this._timestampsNs[i];
      if (ns > endNs) return;
      const time = fromNano(ns);
      for (const t of subscribedTopics) {
        const msg = t.read(i, time);
        const sizeInBytes = this._estimateSize(msg);
        yield {
          topic: t.topic,
          receiveTime: time,
          publishTime: time,
          message: msg,
          schemaName: t.schemaName,
          sizeInBytes,
        } as MessageEvent<Uint8Array>;
      }
    }
  }

  getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent<Uint8Array>[]> {
    const t = toNano(args.time);
    const messages: MessageEvent<Uint8Array>[] = [];
    const frameIdx = this._findFrameAtOrBefore(t);
    if (frameIdx < 0) {
      // Before the first frame: fall forward to frame 0.
      if (this._timestampsNs.length === 0) return Promise.resolve(messages);
      return Promise.resolve(this._buildMessagesAt(0, args.topics));
    }
    for (const msg of this._buildMessagesAt(frameIdx, args.topics)) {
      messages.push(msg);
    }
    return Promise.resolve(messages);
  }

  getAdjacentMessage(args: GetAdjacentMessageArgs): Promise<MessageEvent<Uint8Array> | null> {
    const { time, topics, direction } = args;
    if (topics.length === 0 || this._timestampsNs.length === 0) return Promise.resolve(null);
    const t = toNano(time);
    let targetFrame: number;
    if (direction === 'next') {
      // Smallest frame with timestamp > t.
      let lo = 0,
        hi = this._timestampsNs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (this._timestampsNs[mid] <= t) lo = mid + 1;
        else hi = mid;
      }
      targetFrame = lo;
    } else {
      const idx = this._findFrameAtOrBefore(t - 1n);
      targetFrame = idx;
    }
    if (targetFrame < 0 || targetFrame >= this._timestampsNs.length) return Promise.resolve(null);

    const requested = new Set(topics);
    const subscribedTopics = this._topics.filter((t) => requested.has(t.topic));
    if (subscribedTopics.length === 0) return Promise.resolve(null);

    const frameTime = fromNano(this._timestampsNs[targetFrame]);
    const topic = subscribedTopics[0];
    const msg = topic.read(targetFrame, frameTime);
    return Promise.resolve({
      topic: topic.topic,
      receiveTime: frameTime,
      publishTime: frameTime,
      message: msg,
      schemaName: topic.schemaName,
      sizeInBytes: this._estimateSize(msg),
    } as MessageEvent<Uint8Array>);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private _findFrameAtOrBefore(t: bigint): number {
    // Largest i such that timestampsNs[i] <= t. -1 if none.
    let lo = 0, hi = this._timestampsNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this._timestampsNs[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  private _buildMessagesAt(frameIdx: number, topics: string[]): MessageEvent<Uint8Array>[] {
    const frameTime = fromNano(this._timestampsNs[frameIdx]);
    const out: MessageEvent<Uint8Array>[] = [];
    for (const name of topics) {
      const t = this._topicByName.get(name);
      if (!t) continue;
      const msg = t.read(frameIdx, frameTime);
      out.push({
        topic: t.topic,
        receiveTime: frameTime,
        publishTime: frameTime,
        message: msg,
        schemaName: t.schemaName,
        sizeInBytes: this._estimateSize(msg),
      } as MessageEvent<Uint8Array>);
    }
    return out;
  }

  private _locateEpisodeFrame(frameIdx: number): EpisodeLocation | null {
    if (this._episodeOffsets.length === 0 || !this._plan?.episodeFrameCounts) return null;
    for (let i = this._episodeOffsets.length - 1; i >= 0; i--) {
      const start = this._episodeOffsets[i];
      if (frameIdx >= start) {
        const len = this._plan.episodeFrameCounts[i];
        const local = frameIdx - start;
        if (local >= 0 && local < len) return { episodeIndex: i, localFrame: local };
      }
    }
    return null;
  }

  private _estimateSize(msg: unknown): number {
    if (!msg || typeof msg !== 'object') return 0;
    const rec = msg as Record<string, unknown>;
    const data = rec.data;
    if (data instanceof Uint8Array) return data.byteLength + 128;
    if (Array.isArray(data)) return data.length * 8 + 128;
    return 256;
  }
}
