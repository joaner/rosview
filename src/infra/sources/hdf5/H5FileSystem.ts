/**
 * Bridges between our data source inputs (Blob / URL) and the Emscripten
 * in-memory filesystem that the `@ioai/hdf5` Emscripten module exposes.
 *
 * Runs exclusively inside the Worker, after `initHdf5()` has initialized the runtime.
 *
 * - Local file (Blob): loaded fully into a Uint8Array and written to MEMFS.
 *   Simple, self-contained, and avoids the restrictions of lazy files.
 * - Remote URL: we call Emscripten's `FS.createLazyFile` which uses
 *   synchronous XHR + Range requests. Synchronous XHR is permitted in Worker
 *   contexts, so the main thread is never blocked. The HTTP server must
 *   honor the `Range` header (standard on static hosts like Nginx / S3 / GCS).
 */

import type { EmscriptenModule } from '@ioai/hdf5';

type Hdf5CompatModule = {
  ready: Promise<unknown>;
  FS: EmscriptenModule['FS'];
};

export interface MountedFile {
  /** Absolute path within the Emscripten FS, ready to pass to `new File(path, 'r')`. */
  path: string;
  /** Total byte size when known (local blobs / resolved HEAD), else undefined for remote lazy with unknown size. */
  totalBytes: number;
  /** Whether this file was mounted lazily (remote URL). */
  lazy: boolean;
  /** Best-effort cleanup. */
  dispose(): void;
}

const WORK_DIR = '/work';

function sanitizeName(name: string): string {
  // Keep the extension; strip path separators and non-ASCII for FS safety.
  const base = name.split(/[\\/]/).pop() ?? 'file.h5';
  return base.replace(/[^\w.-]+/g, '_');
}

function ensureWorkDir(h5: Hdf5CompatModule): void {
  if (!h5.FS.analyzePath(WORK_DIR).exists) {
    h5.FS.mkdir(WORK_DIR);
  }
}

/** Load a Blob into MEMFS. Returns the FS path. */
export async function mountBlobAsFile(
  h5: Hdf5CompatModule,
  blob: Blob,
  suggestedName = 'upload.h5',
): Promise<MountedFile> {
  ensureWorkDir(h5);
  const name = sanitizeName(suggestedName);
  const path = `${WORK_DIR}/${name}`;
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (h5.FS.analyzePath(path).exists) {
    try { h5.FS.unlink(path); } catch { /* best effort */ }
  }
  h5.FS.writeFile(path, buf);
  return {
    path,
    totalBytes: buf.byteLength,
    lazy: false,
    dispose: () => {
      try { h5.FS.unlink(path); } catch { /* ignore */ }
    },
  };
}

/**
 * Attach a remote HDF5 file via lazy range requests. The HTTP server must
 * support the `Range` header (206 Partial Content); we probe once with a
 * HEAD request to capture size for progress reporting.
 */
export async function mountUrlAsLazyFile(
  h5: Hdf5CompatModule,
  url: string,
): Promise<MountedFile> {
  ensureWorkDir(h5);
  const name = sanitizeName(url.split('?')[0] || 'remote.h5');
  const path = `${WORK_DIR}/${name}`;
  if (h5.FS.analyzePath(path).exists) {
    try { h5.FS.unlink(path); } catch { /* best effort */ }
  }

  // Small same-origin files are eager-fetched into MEMFS. Emscripten lazy URLs
  // can fail in module workers, and tiny fixtures do not benefit from range IO.
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    const len = Number(headRes.headers.get('content-length') ?? 0);
    if (headRes.ok && len > 0 && len <= 32 * 1024 * 1024) {
      const res = await fetch(url);
      if (res.ok) {
        const buf = new Uint8Array(await res.arrayBuffer());
        h5.FS.writeFile(path, buf);
        return {
          path,
          totalBytes: buf.byteLength,
          lazy: false,
          dispose: () => {
            try { h5.FS.unlink(path); } catch { /* ignore */ }
          },
        };
      }
    }
  } catch {
    // Fall through to lazy mount for large or remote files.
  }

  let totalBytes = 0;
  try {
    const headRes = await fetch(url, { method: 'HEAD' });
    const len = headRes.headers.get('content-length');
    if (len) totalBytes = Number(len) || 0;
    if (!headRes.headers.get('accept-ranges')?.toLowerCase().includes('bytes')) {
      // Some servers advertise range support only on actual GETs; don't hard fail.
      // Emscripten's createLazyFile will throw on first read if the server truly
      // refuses ranges.
    }
  } catch {
    // Non-fatal: size unknown is OK, just no progress bar.
  }

  h5.FS.createLazyFile(WORK_DIR, name, url, /*canRead*/ true, /*canWrite*/ false);
  return {
    path,
    totalBytes,
    lazy: true,
    dispose: () => {
      try { h5.FS.unlink(path); } catch { /* ignore */ }
    },
  };
}
