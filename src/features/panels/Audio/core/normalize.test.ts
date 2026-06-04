import { describe, expect, it } from 'vitest';
import type { MessageEvent } from '@/core/types/ros';
import { normalizeAudioMessage } from './normalize';
import type { ParsedAudioInfo } from './types';

function ev(topic: string, schemaName: string, message: unknown, receiveTime = { sec: 10, nsec: 0 }): MessageEvent {
  return {
    topic,
    receiveTime,
    publishTime: receiveTime,
    message,
    schemaName,
  };
}

describe('normalizeAudioMessage', () => {
  it('decodes RawAudio pcm-s16', () => {
    const data = new Uint8Array(4);
    const view = new DataView(data.buffer);
    view.setInt16(0, 1000, true);
    view.setInt16(2, -2000, true);
    const msg = {
      timestamp: { sec: 5, nsec: 0 },
      format: 'pcm-s16',
      sample_rate: 16000,
      number_of_channels: 2,
      data,
    };
    const r = normalizeAudioMessage(ev('/a', 'foxglove_msgs/msg/RawAudio [ros2msg]', msg), 'foxglove_msgs/msg/RawAudio [ros2msg]', new Map(), {
      defaults: { sampleRate: 48_000, channels: 1, sampleFormat: 'S16LE' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.frame.sampleRate).toBe(16000);
      expect(r.frame.channels).toBe(2);
      expect(r.frame.pcmF32Interleaved.length).toBe(2);
    }
  });

  it('rejects non pcm-s16 RawAudio', () => {
    const r = normalizeAudioMessage(
      ev(
        '/a',
        'foxglove_msgs/msg/RawAudio',
        {
          timestamp: { sec: 0, nsec: 0 },
          format: 'opus',
          sample_rate: 16000,
          number_of_channels: 1,
          data: new Uint8Array([0, 0]),
        },
      ),
      'foxglove_msgs/msg/RawAudio',
      new Map(),
      { defaults: { sampleRate: 48_000, channels: 1, sampleFormat: 'S16LE' } },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_raw_audio_format');
  });

  it('decodes AudioData with cached AudioInfo', () => {
    const cache = new Map<string, ParsedAudioInfo>();
    cache.set('/info', {
      channels: 1,
      sampleRate: 8000,
      sampleFormat: 'S16LE',
      codingFormat: '',
    });
    const data = new Uint8Array(2);
    new DataView(data.buffer).setInt16(0, 4000, true);
    const r = normalizeAudioMessage(ev('/audio', 'audio_common_msgs/msg/AudioData', { data }), 'audio_common_msgs/msg/AudioData', cache, {
      defaults: { sampleRate: 48_000, channels: 1, sampleFormat: 'S16LE' },
      audioInfoTopic: '/info',
    });
    expect(r.ok).toBe(true);
  });

  it('rejects MP3 coding_format', () => {
    const cache = new Map<string, ParsedAudioInfo>();
    cache.set('/info', {
      channels: 1,
      sampleRate: 44100,
      sampleFormat: 'S16LE',
      codingFormat: 'MP3',
    });
    const r = normalizeAudioMessage(ev('/audio', 'audio_common_msgs/msg/AudioData', { data: new Uint8Array([0]) }), 'audio_common_msgs/msg/AudioData', cache, {
      defaults: { sampleRate: 48_000, channels: 1, sampleFormat: 'S16LE' },
      audioInfoTopic: '/info',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported_coding_format');
  });
});
