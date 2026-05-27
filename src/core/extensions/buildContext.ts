import type { DatasetItem } from '@/shared/utils/datasetSources';
import type { MessagePipelineState } from '@/core/pipeline/store';
import type { Player } from '@/core/types/player';
import type { MessageEvent, Time } from '@/core/types/ros';
import { toNano } from '@/shared/utils/time';
import type {
  MessageAccessApi,
  PlaybackControlsApi,
  PlaybackSnapshot,
  RosViewExtensionContext,
  TimelineApi,
} from './types';

interface BuildExtensionContextParams {
  player: Player;
  dataset?: DatasetItem;
  topics: MessagePipelineState['sortedTopics'];
  locale: RosViewExtensionContext['locale'];
  theme: RosViewExtensionContext['theme'];
  hostContext?: unknown;
  getPlayerState: () => MessagePipelineState['playerState'];
}

function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function percentToTimeInternal(percent: number, start: Time, end: Time): Time {
  const p = clampPercent(percent) / 100;
  const total = toNano(end) - toNano(start);
  const delta = BigInt(Math.round(Number(total) * p));
  const seekNano = toNano(start) + delta;
  const sec = Number(seekNano / 1000000000n);
  const nsec = Number(seekNano % 1000000000n);
  return { sec, nsec };
}

function timeToPercentInternal(current: Time, start: Time, end: Time): number {
  const total = toNano(end) - toNano(start);
  if (total <= 0n) return 0;
  const currentNano = toNano(current) - toNano(start);
  return clampPercent(Number((currentNano * 10000n) / total) / 100);
}

function buildPlaybackSnapshot(
  state: MessagePipelineState['playerState'],
  currentTime: Time | undefined,
): PlaybackSnapshot {
  const activeData = state.activeData;
  const pr = state.progress;
  return {
    presence: state.presence,
    startTime: activeData?.startTime,
    endTime: activeData?.endTime,
    currentTime,
    isPlaying: activeData?.isPlaying ?? false,
    isLooping: activeData?.isLooping ?? true,
    speed: activeData?.speed ?? 1,
    progressPercent: pr.percent,
    buffering: pr.buffering,
    problems: activeData?.problems,
  };
}

function createTimelineApi(getPlayerState: () => MessagePipelineState['playerState']): TimelineApi {
  return {
    getTimeBounds: () => {
      const ad = getPlayerState().activeData;
      if (!ad?.startTime || !ad?.endTime) return null;
      return { start: ad.startTime, end: ad.endTime };
    },
    timeToPercent: (time) => {
      const ad = getPlayerState().activeData;
      if (!ad?.startTime || !ad?.endTime) return 0;
      return timeToPercentInternal(time, ad.startTime, ad.endTime);
    },
    percentToTime: (percent) => {
      const ad = getPlayerState().activeData;
      if (!ad?.startTime || !ad?.endTime) return null;
      return percentToTimeInternal(percent, ad.startTime, ad.endTime);
    },
  };
}

function createMessageAccessApi(player: Player): MessageAccessApi {
  return {
    getMessagesInTimeRange: async (args): Promise<MessageEvent[]> => {
      if (!player.getMessagesInTimeRange) return [];
      return player.getMessagesInTimeRange(args);
    },
  };
}

export function createPlaybackControlsApi(
  player: Player,
  getPlayerState: () => MessagePipelineState['playerState'],
): PlaybackControlsApi {
  return {
    seek: (time) => player.seek(time),
    play: () => player.play(),
    pause: () => player.pause(),
    setSpeed: (speed) => player.setSpeed(speed),
    setLooping: (looping) => player.setLooping(looping),
    stepBy: (deltaMs) => player.stepBy(deltaMs),
    stepMessage: (direction) => player.stepMessage(direction),
    playUntil: (time) =>
      new Promise<void>((resolve) => {
        const targetNs = toNano(time);
        const snap = buildPlaybackSnapshot(getPlayerState(), player.getCurrentTime());
        const cur = snap.currentTime;
        if (cur && toNano(cur) >= targetNs) {
          resolve();
          return;
        }
        const unsub = player.subscribeCurrentTime((t) => {
          if (toNano(t) >= targetNs) {
            unsub();
            player.pause();
            resolve();
          }
        });
        player.play();
      }),
    subscribeCurrentTime: (cb) => player.subscribeCurrentTime(cb),
    getCurrentTime: () => player.getCurrentTime(),
    getSnapshot: () => buildPlaybackSnapshot(getPlayerState(), player.getCurrentTime()),
  };
}

export function buildExtensionContext(params: BuildExtensionContextParams): RosViewExtensionContext {
  return {
    playback: createPlaybackControlsApi(params.player, params.getPlayerState),
    timeline: createTimelineApi(params.getPlayerState),
    messages: createMessageAccessApi(params.player),
    hostContext: params.hostContext,
    dataset: params.dataset,
    topics: params.topics,
    locale: params.locale,
    theme: params.theme,
  };
}
