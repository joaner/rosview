/**
 * Resolve URL for fetch() / dynamic import() inside a Web Worker.
 * Root-relative and build-relative asset paths must use the document origin
 * (`self.location.href`), not the inline worker blob URL.
 */
export function resolveWorkerHttpUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (typeof self !== 'undefined' && 'location' in self && self.location?.href) {
    return new URL(url, self.location.href).href;
  }
  if (url.startsWith('/') && typeof self !== 'undefined' && self.origin) {
    return new URL(url, self.origin).href;
  }
  return url;
}
