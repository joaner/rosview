import type { MessageEvent, RosDatatypes, Time, TopicInfo } from '@/core/types/ros';
import type { HighFrequencyConsumer, Subscription, Unsubscribe } from '@/core/types/player';

export type LiveBridgeProfile = 'ros1' | 'ros2' | 'foxglove' | 'rosbridge' | 'custom';

export interface LiveBridgeCapabilities {
  profile: LiveBridgeProfile;
  canSubscribe: boolean;
  canPublish: boolean;
  canReadParameters: boolean;
  canWriteParameters: boolean;
  /**
   * Live sources generally cannot provide Foxglove-style full range loading.
   * A finite value means panels may query a rolling in-memory buffer.
   */
  messageRangeBufferSec?: number;
}

export interface LiveBridgeInitialization {
  topics: TopicInfo[];
  datatypes: RosDatatypes;
  startTime: Time;
  capabilities: LiveBridgeCapabilities;
}

export interface LiveBridgeAdapter {
  initialize(): Promise<LiveBridgeInitialization>;
  subscribe(subscriptions: Subscription[]): Unsubscribe;
  subscribeHighFrequency?(consumer: HighFrequencyConsumer): Unsubscribe;
  onMessage(listener: (event: MessageEvent) => void): Unsubscribe;
  /**
   * Optional: notify when the advertised topic list / datatypes change after init
   * (e.g. foxglove_bridge advertise/unadvertise).
   */
  onTopicsChanged?(
    listener: (topics: TopicInfo[], datatypes: RosDatatypes) => void,
  ): Unsubscribe;
  publish?(topic: string, schemaName: string, message: unknown): Promise<void>;
  getParameter?(name: string): Promise<unknown>;
  setParameter?(name: string, value: unknown): Promise<void>;
  close(): void;
}

export const offlineFirstBridgeCapabilities: LiveBridgeCapabilities = {
  profile: 'custom',
  canSubscribe: true,
  canPublish: false,
  canReadParameters: false,
  canWriteParameters: false,
};
