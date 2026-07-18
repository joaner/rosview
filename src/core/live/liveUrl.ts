/**
 * Helpers for Foxglove / live WebSocket connection URLs.
 */

const WS_PREFIX = /^wss?:\/\//i;
const FOXGLOVE_PREFIX = /^foxglove:\/\//i;

/** True if the string is a live bridge URL (ws / wss / foxglove scheme). */
export function isLiveWebsocketUrl(raw: string | undefined | null): boolean {
  if (!raw?.trim()) return false;
  const t = raw.trim();
  return WS_PREFIX.test(t) || FOXGLOVE_PREFIX.test(t);
}

/**
 * Normalize user input to a WebSocket URL for Foxglove bridge.
 * - `foxglove://host:8765` → `ws://host:8765`
 * - `foxglove://host:8765?tls=1` or `foxgloves://` not used; use wss:// explicitly
 * - trims whitespace; leaves `ws://` / `wss://` unchanged
 */
export function normalizeLiveWebsocketUrl(raw: string): string {
  const trimmed = raw.trim();
  if (FOXGLOVE_PREFIX.test(trimmed)) {
    const rest = trimmed.replace(FOXGLOVE_PREFIX, '');
    // Default path empty; host:port only.
    return `ws://${rest.replace(/^\/+/, '')}`;
  }
  return trimmed;
}

/** Default local foxglove_bridge endpoint. */
export const DEFAULT_FOXGLOVE_WS_URL = 'ws://localhost:8765';
