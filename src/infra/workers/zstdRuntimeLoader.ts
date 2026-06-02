import { init } from '@ioai/wasm-zstd';

let initPromise: Promise<void> | undefined;

/**
 * Initialize @ioai/wasm-zstd for inline (`?worker&inline`) workers.
 *
 * Inline workers run from a blob: URL, so the main thread passes preloaded wasm
 * bytes and lets @ioai/wasm-zstd initialize through its public API.
 */
export function ensureZstdRuntime(wasmBinary: ArrayBuffer): Promise<void> {
  initPromise ??= init({ wasmBinary });
  return initPromise;
}
