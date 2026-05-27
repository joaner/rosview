import type { MessageEvent } from '@/core/types/ros';
import { readHeaderStamp } from '@/core/analysis/timeSeries';
import {
  isAudioCommonDataSchema,
  isAudioCommonDataStampedSchema,
  isAudioCommonInfoSchema,
  isRawAudioSchema,
} from '@/shared/ros/rosMessageTypes';
import type {
  DecodedAudioFrame,
  NormalizeAudioFailure,
  NormalizeAudioResult,
  NormalizeAudioSuccess,
  ParsedAudioInfo,
} from './types';
import {
  isRawPcmCodingFormat,
  isUnsupportedCompressedCodingFormat,
} from './parseAudioInfo';
import { decodeRawAudioPcmS16, decodeAudioCommonPcmBytes, toUint8Array } from './pcmConvert';
import { pickAudioInfoForMainTopic } from './resolveAudioInfo';

export interface AudioNormalizeDefaults {
  sampleRate: number;
  channels: number;
  sampleFormat: string;
}

function fail(error: string): NormalizeAudioFailure {
  return { ok: false, error };
}

function ok(frame: DecodedAudioFrame): NormalizeAudioSuccess {
  return { ok: true, frame };
}

function timeToNs(time: { sec: number; nsec: number }): bigint {
  return BigInt(time.sec) * 1_000_000_000n + BigInt(time.nsec);
}

/**
 * Normalize one message into PCM float32 or return a reason string.
 * @param topicType schema string from TopicInfo.type for `event.topic`
 */
export function normalizeAudioMessage(
  event: MessageEvent,
  topicType: string,
  infoByTopic: Map<string, ParsedAudioInfo>,
  options: {
    defaults: AudioNormalizeDefaults;
    /** Explicit AudioInfo topic (ROS); when empty, heuristics + defaults apply for AudioData. */
    audioInfoTopic?: string;
  },
): NormalizeAudioResult {
  const { defaults, audioInfoTopic } = options;

  if (isAudioCommonInfoSchema(topicType)) {
    return fail('audio_info_metadata_only');
  }

  if (isRawAudioSchema(topicType)) {
    const frame = decodeRawAudioPcmS16(event.message, event.topic, event.receiveTime);
    if (!frame) {
      const m = event.message as Record<string, unknown> | null;
      const rawFmt = m?.format ?? m?.FORMAT;
      const fmt = typeof rawFmt === 'string' ? rawFmt.trim() : '';
      if (fmt && fmt !== 'pcm-s16') return fail('unsupported_raw_audio_format');
      return fail('invalid_raw_audio');
    }
    return ok(frame);
  }

  if (isAudioCommonDataStampedSchema(topicType)) {
    const picked = pickAudioInfoForMainTopic(event.topic, audioInfoTopic, infoByTopic, defaults);
    const { info, degraded } = picked;
    if (isUnsupportedCompressedCodingFormat(info.codingFormat)) {
      return fail('unsupported_coding_format');
    }
    if (!isRawPcmCodingFormat(info.codingFormat)) {
      return fail('unsupported_coding_format');
    }
    const msg = event.message as Record<string, unknown>;
    const audio = msg.audio as Record<string, unknown> | undefined;
    const bytes = audio ? toUint8Array(audio.data) : null;
    if (!bytes || bytes.length === 0) return fail('empty_audio_payload');
    const stamp = readHeaderStamp(event.message);
    const startNs = stamp ? timeToNs(stamp) : timeToNs(event.receiveTime);
    const qualityFlags = [...degraded];
    if (!stamp) qualityFlags.push('receive_time_fallback');
    const frame = decodeAudioCommonPcmBytes(bytes, info, startNs, info.sampleRate, event.topic, qualityFlags);
    if (!frame) return fail('unsupported_sample_format');
    return ok(frame);
  }

  if (isAudioCommonDataSchema(topicType)) {
    const picked = pickAudioInfoForMainTopic(event.topic, audioInfoTopic, infoByTopic, defaults);
    const { info, degraded } = picked;
    if (isUnsupportedCompressedCodingFormat(info.codingFormat)) {
      return fail('unsupported_coding_format');
    }
    if (!isRawPcmCodingFormat(info.codingFormat)) {
      return fail('unsupported_coding_format');
    }
    const bytes = toUint8Array((event.message as Record<string, unknown>).data);
    if (!bytes || bytes.length === 0) return fail('empty_audio_payload');
    const startNs = timeToNs(event.receiveTime);
    const qualityFlags = [...degraded, 'receive_time_fallback'];
    const frame = decodeAudioCommonPcmBytes(bytes, info, startNs, info.sampleRate, event.topic, qualityFlags);
    if (!frame) return fail('unsupported_sample_format');
    return ok(frame);
  }

  return fail('unsupported_schema');
}

export type { DecodedAudioFrame } from './types';
