import type { Initialization, MessageEvent, TopicInfo } from "@/core/types/ros";
import type { GetBackfillMessagesArgs, MessageIteratorArgs } from "@/infra/workers/types";
import type { GetAdjacentMessageArgs, IIterableSource } from "../IIterableSource";
import { fromNano, toNano } from "@/shared/utils/time";
import { syncGeneratorToAsyncIterable } from "@/shared/utils/syncAsyncIterable";
import {
  buildBvhLayout,
  parseBvhFile,
  sampleBvhFrame,
  type BvhLayout,
  type BvhSkeletonFrameMsg,
} from "@/shared/bvh";
import { buildBvhDatatypesMap, BVH_SKELETON_SCHEMA_NAME } from "./schemas";

const BVH_SKELETON_TOPIC = "/bvh/skeleton";

export class BvhIterableSource implements IIterableSource {
  private readonly _text: string;
  private readonly _sourceLabel: string;
  private _layout?: BvhLayout;
  private _timestampsNs: bigint[] = [];

  constructor(text: string, sourceLabel = "bvh") {
    this._text = text;
    this._sourceLabel = sourceLabel;
  }

  initialize(): Promise<Initialization> {
    const parsed = parseBvhFile(this._text);
    const layout = buildBvhLayout(parsed);
    this._layout = layout;

    const dtNs = BigInt(Math.max(1, Math.round(layout.frameTimeSec * 1e9)));
    this._timestampsNs = Array.from({ length: layout.frameCount }, (_, i) => BigInt(i) * dtNs);
    const start = fromNano(0n);
    const end = fromNano(this._timestampsNs[this._timestampsNs.length - 1] ?? 0n);
    const durationSec = Number(toNano(end) - toNano(start)) / 1e9;
    const frequency = layout.frameTimeSec > 0 ? 1 / layout.frameTimeSec : 0;

    const topics: TopicInfo[] = [
      {
        name: BVH_SKELETON_TOPIC,
        type: BVH_SKELETON_SCHEMA_NAME,
        messageCount: layout.frameCount,
        durationSec,
        frequency,
      },
    ];
    const topicStats = {
      [BVH_SKELETON_TOPIC]: {
        messageCount: layout.frameCount,
        durationSec,
        frequency,
      },
    };
    return Promise.resolve({
      topics,
      datatypes: buildBvhDatatypesMap(),
      start,
      end,
      publishersByTopic: { [BVH_SKELETON_TOPIC]: [this._sourceLabel] },
      topicStats,
      problems: layout.warnings.map((message) => ({ severity: "warn" as const, message })),
      preferredSamplingFps: frequency > 0 ? frequency : undefined,
      randomAccessByTopic: false,
    });
  }

  messageIterator(args: MessageIteratorArgs): AsyncIterableIterator<MessageEvent> {
    return syncGeneratorToAsyncIterable(() => this._messageIteratorSync(args));
  }

  private *_messageIteratorSync(args: MessageIteratorArgs): Generator<MessageEvent> {
    if (!this._layout || this._timestampsNs.length === 0) return;
    if (!args.topics.includes(BVH_SKELETON_TOPIC)) return;

    const startNs = toNano(args.startTime);
    const endNs = args.endTime ? toNano(args.endTime) : (this._timestampsNs[this._timestampsNs.length - 1] ?? 0n);

    let lo = 0;
    let hi = this._timestampsNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this._timestampsNs[mid] ?? 0n) < startNs) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo; i < this._timestampsNs.length; i++) {
      const ts = this._timestampsNs[i] ?? 0n;
      if (ts > endNs) break;
      const time = fromNano(ts);
      const message = this._buildFrameMessage(i);
      yield {
        topic: BVH_SKELETON_TOPIC,
        receiveTime: time,
        publishTime: time,
        message,
        schemaName: BVH_SKELETON_SCHEMA_NAME,
      };
    }
  }

  getBackfillMessages(args: GetBackfillMessagesArgs): Promise<MessageEvent[]> {
    if (!this._layout || this._timestampsNs.length === 0) return Promise.resolve([]);
    if (!args.topics.includes(BVH_SKELETON_TOPIC)) return Promise.resolve([]);
    const target = toNano(args.time);
    const frame = this._findFrameAtOrBefore(target);
    const idx = frame < 0 ? 0 : frame;
    return Promise.resolve([this._buildMessageAt(idx)]);
  }

  getAdjacentMessage(args: GetAdjacentMessageArgs): Promise<MessageEvent | null> {
    if (!this._layout || this._timestampsNs.length === 0) return Promise.resolve(null);
    if (!args.topics.includes(BVH_SKELETON_TOPIC)) return Promise.resolve(null);

    const t = toNano(args.time);
    let idx: number;
    if (args.direction === "next") {
      let lo = 0;
      let hi = this._timestampsNs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if ((this._timestampsNs[mid] ?? 0n) <= t) lo = mid + 1;
        else hi = mid;
      }
      idx = lo;
    } else {
      idx = this._findFrameAtOrBefore(t - 1n);
    }
    if (idx < 0 || idx >= this._timestampsNs.length) return Promise.resolve(null);
    return Promise.resolve(this._buildMessageAt(idx));
  }

  private _findFrameAtOrBefore(target: bigint): number {
    let lo = 0;
    let hi = this._timestampsNs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this._timestampsNs[mid] ?? 0n) <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }

  private _buildMessageAt(frameIndex: number): MessageEvent {
    const time = fromNano(this._timestampsNs[frameIndex] ?? 0n);
    return {
      topic: BVH_SKELETON_TOPIC,
      receiveTime: time,
      publishTime: time,
      message: this._buildFrameMessage(frameIndex),
      schemaName: BVH_SKELETON_SCHEMA_NAME,
    };
  }

  private _buildFrameMessage(frameIndex: number): BvhSkeletonFrameMsg {
    const layout = this._layout!;
    const joints = sampleBvhFrame(layout, frameIndex).map((joint) => ({
      name: joint.name,
      parent_index: joint.parentIndex,
      x: joint.position[0],
      y: joint.position[1],
      z: joint.position[2],
      is_end_site: joint.isEndSite,
    }));
    return {
      frame_index: frameIndex,
      joints,
      source_warnings: layout.warnings,
    };
  }
}

export { BVH_SKELETON_TOPIC };
