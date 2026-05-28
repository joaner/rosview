import type { McapTypes } from "@mcap/core";
import { decompress as fzstdDecompress } from "fzstd";
import * as lz4js from "lz4js";

// @mcap/support currently pulls CommonJS wasm loaders that fail in Vite's
// ES module worker build, so keep these browser-safe ESM handlers local.

let handlersPromise: Promise<McapTypes.DecompressHandlers> | undefined;

export async function loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  return await (handlersPromise ??= _loadDecompressHandlers());
}

function _loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  return Promise.resolve({
    lz4: (buffer, decompressedSize) => {
      const output = new Uint8Array(Number(decompressedSize));
      const result = lz4js.decompressBlock(buffer, output, 0, buffer.byteLength, 0);
      if (result < 0) {
        throw new Error(`lz4 decompression failed (result=${result})`);
      }
      return output;
    },
    zstd: (buffer, decompressedSize) => {
      const output = new Uint8Array(Number(decompressedSize));
      return fzstdDecompress(buffer, output);
    },
  });
}
