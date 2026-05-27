import { create } from 'zustand';
import type { PlayerState, Subscription } from '@/core/types/player';
import type { TopicInfo, RosDatatypes } from '@/core/types/ros';

export interface MessagePipelineState {
  playerState: PlayerState;
  sortedTopics: TopicInfo[];
  datatypes: RosDatatypes;
  subscriptions: Subscription[];
  publishersByTopic: Map<string, Set<string>>;

  setPlayerState: (state: PlayerState) => void;
  setSubscriptions: (subscriptions: Subscription[]) => void;
}

const EMPTY_PUBLISHERS: Map<string, Set<string>> = new Map();
const EMPTY_DATATYPES = {} as RosDatatypes;

/**
 * Message state (lastMessageByTopic, per-subscriber batches, seq counters) is
 * kept out of this store and lives in `messageBus` with per-key subscriptions.
 * This store only holds slowly-changing metadata so that per-tick fan-out does
 * not wake every useMessagePipeline subscriber. Real-time playback time is
 * exposed through Player.subscribeCurrentTime/getCurrentTime instead.
 */
export const useMessagePipelineStore = create<MessagePipelineState>((set) => ({
  playerState: { presence: 'preinit', progress: {} },
  sortedTopics: [],
  datatypes: EMPTY_DATATYPES,
  subscriptions: [],
  publishersByTopic: EMPTY_PUBLISHERS,

  setPlayerState: (playerState: PlayerState) =>
    set((state) => {
      const ad = playerState.activeData;
      if (!ad) {
        return {
          playerState,
          sortedTopics: state.sortedTopics.length === 0 ? state.sortedTopics : [],
          datatypes: EMPTY_DATATYPES,
          publishersByTopic: EMPTY_PUBLISHERS,
        };
      }
      // Re-use existing references when the underlying identity has not changed
      // so that selectors returning these fields are Object.is-equal and React
      // skips the re-render for selectors that do not depend on playerState
      // identity itself.
      return {
        playerState,
        sortedTopics: ad.topics === state.sortedTopics ? state.sortedTopics : ad.topics,
        datatypes: ad.datatypes === state.datatypes ? state.datatypes : ad.datatypes,
        publishersByTopic:
          ad.publishersByTopic === state.publishersByTopic
            ? state.publishersByTopic
            : ad.publishersByTopic,
      };
    }),

  setSubscriptions: (subscriptions: Subscription[]) => set({ subscriptions }),
}));
