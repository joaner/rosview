import { loadWasmBinary } from '@/shared/utils/loadWasmBinary';
import { hdf5WasmUrl, sqlWasmUrl, zstdWasmUrl } from './wasmAssetUrls';

export function loadSqlWasmBinary(): Promise<ArrayBuffer> {
  return loadWasmBinary(sqlWasmUrl, 'SQL');
}

export function loadHdf5WasmBinary(): Promise<ArrayBuffer> {
  return loadWasmBinary(hdf5WasmUrl, 'HDF5');
}

/** Preload @ioai/wasm-zstd bytes on the main thread for inline workers. */
export function loadZstdWasmBinary(): Promise<ArrayBuffer> {
  return loadWasmBinary(zstdWasmUrl, 'zstd');
}

/** Inline workers that call `loadDecompressHandlers` (MCAP + bag). */
export function needsZstdWasmForWorker(ext: string | undefined): boolean {
  if (ext === 'bag') {
    return true;
  }
  if (ext === 'bvh' || ext === 'db3' || ext === 'hdf5' || ext === 'h5') {
    return false;
  }
  return true;
}
