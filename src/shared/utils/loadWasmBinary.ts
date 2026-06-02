const cache = new Map<string, Promise<ArrayBuffer>>();

/**
 * Fetch and cache a `.wasm` asset referenced by Vite's `?url` import.
 * Main thread preloads bytes for inline (`?worker&inline`) workers.
 */
export function loadWasmBinary(wasmUrl: string, label: string): Promise<ArrayBuffer> {
  let promise = cache.get(wasmUrl);
  if (!promise) {
    promise = fetch(wasmUrl).then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to load ${label} wasm: HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    });
    cache.set(wasmUrl, promise);
  }
  return promise;
}
