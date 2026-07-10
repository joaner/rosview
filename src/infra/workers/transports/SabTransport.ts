import type { Remote } from "comlink";
import { createSharedPayloadRingConfig } from "../sharedPayloadRing";
import type { IWorkerSerializedSourceWorker } from "../types";
import type { SharedPayloadRingConfig, TransportDiagnostics } from "../transport";
import type { WorkerTransport } from "./BaseWorkerTransport";

const DEFAULT_RING_BYTES = 384 * 1024 * 1024;
const DEFAULT_SLOT_BYTES = 16 * 1024 * 1024;

export class SabTransport implements WorkerTransport {
  private readonly _ringConfig: SharedPayloadRingConfig;
  private readonly _thresholdBytes: number;

  constructor(
    thresholdBytes = 64 * 1024,
    totalRingBytes = DEFAULT_RING_BYTES,
    slotBytes = DEFAULT_SLOT_BYTES,
  ) {
    this._thresholdBytes = thresholdBytes;
    this._ringConfig = createSharedPayloadRingConfig(totalRingBytes, slotBytes);
  }

  async configure(remote: Remote<IWorkerSerializedSourceWorker>): Promise<void> {
    await remote.configureTransport({
      mode: "sab",
      binaryPayloadThresholdBytes: this._thresholdBytes,
      payloadRing: this._ringConfig,
    });
  }

  async diagnostics(remote: Remote<IWorkerSerializedSourceWorker>): Promise<TransportDiagnostics> {
    return await remote.getTransportDiagnostics();
  }

  mode(): "sab" {
    return "sab";
  }

  fallbackReason(): string | undefined {
    return undefined;
  }

  ringConfig(): SharedPayloadRingConfig {
    return this._ringConfig;
  }
}

