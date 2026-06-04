import type { ParsedAudioInfo } from './types';
import { parseAudioInfoMessage } from './parseAudioInfo';

export function heuristicAudioInfoTopics(mainTopic: string): string[] {
  const base = mainTopic.replace(/\/+$/, '');
  const out: string[] = [];
  out.push(`${base}_info`);
  out.push(`${base}/info`);
  if (/\/audio$/i.test(base)) {
    out.push(base.replace(/\/audio$/i, '/audio_info'));
    out.push(base.replace(/\/audio$/i, '/info'));
  }
  if (/\/audio\//i.test(base)) {
    out.push(base.replace(/\/audio\//i, '/audio_info/'));
  }
  return [...new Set(out)];
}

export function pickAudioInfoForMainTopic(
  mainTopic: string,
  configuredInfoTopic: string | undefined,
  infoByTopic: Map<string, ParsedAudioInfo>,
  defaults: { sampleRate: number; channels: number; sampleFormat: string },
): { info: ParsedAudioInfo; degraded: string[]; matchedTopic?: string } {
  const degraded: string[] = [];
  if (configuredInfoTopic && configuredInfoTopic.length > 0) {
    const hit = infoByTopic.get(configuredInfoTopic);
    if (hit) return { info: hit, degraded, matchedTopic: configuredInfoTopic };
    degraded.push('configured_info_topic_missing');
  }
  for (const candidate of heuristicAudioInfoTopics(mainTopic)) {
    const hit = infoByTopic.get(candidate);
    if (hit) return { info: hit, degraded, matchedTopic: candidate };
  }
  const synthetic: ParsedAudioInfo = {
    channels: defaults.channels,
    sampleRate: defaults.sampleRate,
    sampleFormat: defaults.sampleFormat,
    codingFormat: '',
  };
  degraded.push('using_panel_defaults');
  return { info: synthetic, degraded, matchedTopic: undefined };
}

export function ingestAudioInfoFromEvent(topic: string, message: unknown, cache: Map<string, ParsedAudioInfo>): void {
  const parsed = parseAudioInfoMessage(message);
  if (parsed) {
    cache.set(topic, parsed);
  }
}
