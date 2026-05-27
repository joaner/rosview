import { Hdf5File, initHdf5, type Hdf5Runtime } from '@ioai/hdf5';

let runtimePromise: Promise<Hdf5Runtime> | undefined;

/**
 * Load @ioai/hdf5 for inline (`?worker&inline`) workers.
 *
 * Inline workers run from a blob: URL, so the main thread passes preloaded wasm
 * bytes and lets @ioai/hdf5 initialize through its public API.
 */
export function loadHdf5Runtime(wasmBinary: ArrayBuffer): Promise<Hdf5Runtime> {
  if (!runtimePromise) {
    runtimePromise = initHdf5({ wasmBinary });
  }
  return runtimePromise;
}

export function openHdf5File(runtime: Hdf5Runtime, memfsPath: string, mode: 'r' | 'a' | 'w' = 'r') {
  return new Hdf5File(runtime, memfsPath, mode);
}
