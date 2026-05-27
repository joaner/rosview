import type { ReactNode } from 'react';
import type { DatasetItem } from '@/shared/utils/datasetSources';
import type { GetMessagesInTimeRangeArgs, PlayerPresence, Unsubscribe } from '@/core/types/player';
import type {
  MessageEvent as RosMessageEvent,
  PlayerProblem,
  Time,
  TopicInfo,
} from '@/core/types/ros';
import type { RosViewLanguageCode, RosViewUiTheme } from '@/core/preferences/types';

export interface PlaybackSnapshot {
  presence: PlayerPresence;
  startTime?: Time;
  endTime?: Time;
  currentTime?: Time;
  isPlaying: boolean;
  isLooping: boolean;
  speed: number;
  /** High-level transport / parse progress when available. */
  progressPercent?: number;
  buffering?: boolean;
  problems?: PlayerProblem[];
}

export interface PlaybackControlsApi {
  seek(time: Time): void;
  play(): void;
  pause(): void;
  setSpeed(speed: number): void;
  setLooping(looping: boolean): void;
  /** Step playback time by milliseconds (player implementation). */
  stepBy(deltaMs: number): void;
  /** Step one message backward/forward in log time. */
  stepMessage(direction: -1 | 1): void;
  /**
   * Play until `time` is reached (inclusive by log-time compare), then pause.
   * Resolves when paused or if current time is already at/after target.
   */
  playUntil(time: Time): Promise<void>;
  subscribeCurrentTime(cb: (time: Time) => void): Unsubscribe;
  /** Latest playback time without subscribing React to high-frequency pipeline state. */
  getCurrentTime(): Time | undefined;
  getSnapshot(): PlaybackSnapshot;
}

/**
 * Helpers aligned with the main playback scrubber time basis (log start/end).
 * Hosts use this for marker lanes, overlays, and seek math without importing Foxglove internals.
 */
export interface TimelineApi {
  getTimeBounds(): { start: Time; end: Time } | null;
  timeToPercent(time: Time): number;
  percentToTime(percent: number): Time | null;
}

/** Read-only message access for host extensions (optional player capability). */
export interface MessageAccessApi {
  getMessagesInTimeRange(args: GetMessagesInTimeRangeArgs): Promise<RosMessageEvent[]>;
}

export interface RosViewExtensionContext {
  playback: PlaybackControlsApi;
  timeline: TimelineApi;
  messages: MessageAccessApi;
  /**
   * Opaque value from {@link RosViewerProps.hostContext}.
   * RosView does not interpret it; hosts pass dataset ids, feature flags, etc.
   */
  hostContext?: unknown;
  dataset?: DatasetItem;
  topics: TopicInfo[];
  locale: RosViewLanguageCode;
  theme: RosViewUiTheme;
}

export interface SidebarTabContribution {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  order?: number;
  render: (context: RosViewExtensionContext) => ReactNode;
}

export interface PlaybackOverlayContribution {
  id: string;
  order?: number;
  height?: number | 'auto';
  render: (context: RosViewExtensionContext) => ReactNode;
}

/** Semantic alias for {@link PlaybackOverlayContribution} (timeline lanes above the scrubber). */
export type TimelineOverlayContribution = PlaybackOverlayContribution;

export interface RosViewExtension {
  id: string;
  sidebarTabs?: SidebarTabContribution[];
  playbackOverlays?: PlaybackOverlayContribution[];
  /**
   * Same rendering slot as `playbackOverlays` (merged after those), for hosts that name overlays by timeline semantics.
   */
  timelineOverlays?: TimelineOverlayContribution[];
}
