import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOXGLOVE_WS_URL,
  isLiveWebsocketUrl,
  normalizeLiveWebsocketUrl,
} from './liveUrl';

describe('isLiveWebsocketUrl', () => {
  it('accepts ws/wss/foxglove schemes', () => {
    expect(isLiveWebsocketUrl('ws://localhost:8765')).toBe(true);
    expect(isLiveWebsocketUrl('wss://robot:8765')).toBe(true);
    expect(isLiveWebsocketUrl('foxglove://127.0.0.1:8765')).toBe(true);
  });

  it('rejects http and empty', () => {
    expect(isLiveWebsocketUrl('https://x/a.mcap')).toBe(false);
    expect(isLiveWebsocketUrl('')).toBe(false);
    expect(isLiveWebsocketUrl(null)).toBe(false);
  });
});

describe('normalizeLiveWebsocketUrl', () => {
  it('maps foxglove:// to ws://', () => {
    expect(normalizeLiveWebsocketUrl('foxglove://host:8765')).toBe('ws://host:8765');
  });

  it('preserves ws and wss', () => {
    expect(normalizeLiveWebsocketUrl('ws://localhost:8765')).toBe('ws://localhost:8765');
    expect(normalizeLiveWebsocketUrl('wss://secure:443')).toBe('wss://secure:443');
  });

  it('exports a sensible default', () => {
    expect(DEFAULT_FOXGLOVE_WS_URL).toBe('ws://localhost:8765');
  });
});
