type WorkerPerfBucket = {
  count: number;
  totalMs: number;
  maxMs: number;
  bytes: number;
};

type WorkerPerfTopicBucket = WorkerPerfBucket & {
  topic: string;
};

type WorkerPerfConfig = {
  enabled: boolean;
  label?: string;
  flushIntervalMs?: number;
};

const DEFAULT_FLUSH_INTERVAL_MS = 2000;

class WorkerPerfCollector {
  private _enabled = false;
  private _label = "worker";
  private _flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS;
  private _lastFlushMs = 0;
  private _startedAtMs = 0;
  private _buckets = new Map<string, WorkerPerfBucket>();
  private _topicBuckets = new Map<string, WorkerPerfTopicBucket>();
  private _gauges = new Map<string, number>();

  configure(config: WorkerPerfConfig): void {
    this._enabled = config.enabled;
    this._label = config.label ?? "worker";
    this._flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this._lastFlushMs = performance.now();
    this._startedAtMs = this._lastFlushMs;
    this._buckets.clear();
    this._topicBuckets.clear();
    this._gauges.clear();
    if (this._enabled) {
      console.info(`[WorkerPerf:${this._label}] enabled`);
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  time<T>(name: string, fn: () => T, bytes = 0): T {
    if (!this._enabled) {
      return fn();
    }
    const start = performance.now();
    try {
      return fn();
    } finally {
      this.record(name, performance.now() - start, bytes);
    }
  }

  async timeAsync<T>(name: string, fn: () => Promise<T>, bytes = 0): Promise<T> {
    if (!this._enabled) {
      return await fn();
    }
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.record(name, performance.now() - start, bytes);
    }
  }

  record(name: string, durationMs: number, bytes = 0): void {
    if (!this._enabled) {
      return;
    }
    this._recordBucket(this._buckets, name, durationMs, bytes);
    this.flushMaybe();
  }

  recordTopic(name: string, topic: string, durationMs: number, bytes = 0): void {
    if (!this._enabled) {
      return;
    }
    const key = `${name}\0${topic}`;
    let bucket = this._topicBuckets.get(key);
    if (!bucket) {
      bucket = { topic, count: 0, totalMs: 0, maxMs: 0, bytes: 0 };
      this._topicBuckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.totalMs += durationMs;
    bucket.maxMs = Math.max(bucket.maxMs, durationMs);
    bucket.bytes += bytes;
    this.flushMaybe();
  }

  recordGauge(name: string, value: number): void {
    if (!this._enabled || !Number.isFinite(value)) {
      return;
    }
    this._gauges.set(name, Number(value.toFixed(3)));
    this.flushMaybe();
  }

  flushMaybe(force = false): void {
    if (!this._enabled) {
      return;
    }
    const now = performance.now();
    if (!force && now - this._lastFlushMs < this._flushIntervalMs) {
      return;
    }
    this._lastFlushMs = now;
    const buckets = Array.from(this._buckets.entries())
      .map(([name, bucket]) => this._formatBucket(name, bucket))
      .sort((a, b) => b.totalMs - a.totalMs);
    const topics = Array.from(this._topicBuckets.entries())
      .map(([key, bucket]) => this._formatBucket(key.split("\0")[0] ?? key, bucket, bucket.topic))
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 20);
    console.info(`[WorkerPerf:${this._label}] ${JSON.stringify({
      elapsedMs: Math.round(now - this._startedAtMs),
      buckets,
      topTopics: topics,
      gauges: Object.fromEntries(this._gauges),
    })}`);
  }

  private _recordBucket(
    buckets: Map<string, WorkerPerfBucket>,
    name: string,
    durationMs: number,
    bytes: number,
  ): void {
    let bucket = buckets.get(name);
    if (!bucket) {
      bucket = { count: 0, totalMs: 0, maxMs: 0, bytes: 0 };
      buckets.set(name, bucket);
    }
    bucket.count += 1;
    bucket.totalMs += durationMs;
    bucket.maxMs = Math.max(bucket.maxMs, durationMs);
    bucket.bytes += bytes;
  }

  private _formatBucket(name: string, bucket: WorkerPerfBucket, topic?: string) {
    return {
      name,
      topic,
      count: bucket.count,
      totalMs: Number(bucket.totalMs.toFixed(2)),
      avgMs: Number((bucket.totalMs / Math.max(1, bucket.count)).toFixed(4)),
      maxMs: Number(bucket.maxMs.toFixed(2)),
      mb: Number((bucket.bytes / (1024 * 1024)).toFixed(2)),
    };
  }
}

export const workerPerf = new WorkerPerfCollector();
