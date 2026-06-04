import { isRecord } from '../framework/types';
import { defaultAlignConfig, type AlignConfig } from './defaults';
import type { AlignPlotTimeMode } from './core/alignTimeUtils';

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function parseTopics(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.filter((t): t is string => typeof t === 'string' && t.length > 0);
}

function parseTimeMode(input: unknown): AlignPlotTimeMode {
  return input === 'headerStamp' ? 'headerStamp' : 'receiveTime';
}

export function parseAlignConfig(input: unknown): AlignConfig {
  const base = defaultAlignConfig();
  if (!isRecord(input)) {
    return base;
  }

  const legacyWindowMs = input.windowMs;
  const halfFromLegacy =
    typeof legacyWindowMs === 'number' && Number.isFinite(legacyWindowMs)
      ? legacyWindowMs / 2
      : undefined;

  return {
    topics: parseTopics(input.topics),
    timeMode: parseTimeMode(input.timeMode),
    windowHalfMs: clampNumber(
      input.windowHalfMs ?? halfFromLegacy ?? base.windowHalfMs,
      base.windowHalfMs,
      50,
      30_000,
    ),
    dotRadius: clampNumber(input.dotRadius, base.dotRadius, 0.5, 8),
    dotOpacity: clampNumber(input.dotOpacity, base.dotOpacity, 0.05, 1),
  };
}
