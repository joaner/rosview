import type { McapTypes } from "@mcap/core";
import { decompress as zstdDecompress, init as initZstd } from "@ioai/wasm-zstd";
import zstdWasmUrl from "@ioai/wasm-zstd/wasm-zstd.wasm?url";
import * as lz4js from "lz4js";

// Load the zstd wasm module explicitly so Vite owns the wasm asset URL in both
// dev and production worker bundles.

let handlersPromise: Promise<McapTypes.DecompressHandlers> | undefined;

export async function loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  return await (handlersPromise ??= _loadDecompressHandlers());
}

async function _loadDecompressHandlers(): Promise<McapTypes.DecompressHandlers> {
  await initZstd({ wasmUrl: zstdWasmUrl });

  return {
    lz4: (buffer, decompressedSize) => {
      const output = new Uint8Array(Number(decompressedSize));
      const result = lz4js.decompressBlock(buffer, output, 0, buffer.byteLength, 0);
      if (result < 0) {
        throw new Error(`lz4 decompression failed (result=${result})`);
      }
      return output;
    },
    zstd: (buffer, decompressedSize) => {
      return zstdDecompress(buffer, Number(decompressedSize));
    },
  };
}
