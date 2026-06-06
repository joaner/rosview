import { useCallback, useRef, useState } from 'react';
import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import type { TopicInfo } from '@/core/types/ros';
import { isJointStateSchema } from '@/shared/ros/rosMessageTypes';
import type { PlotConfig } from './defaults';
import {
  applyDetectedTopicToConfig,
  clearSeriesTopic,
} from './plotConfigActions';
import { buildSeriesForTopic } from './plotTopicService';

export interface UsePlotTopicDetectionArgs {
  player: Player;
  config: PlotConfig;
  setConfig: (next: PlotConfig | ((prev: PlotConfig) => PlotConfig)) => void;
  topicByName: ReadonlyMap<string, TopicInfo>;
  startTime?: Time;
  endTime?: Time;
}

export function usePlotTopicDetection({
  player,
  config,
  setConfig,
  topicByName,
  startTime,
  endTime,
}: UsePlotTopicDetectionArgs): {
  detectingTopic: boolean;
  applyTopicDetection: (seriesId: string, topic: string) => Promise<void>;
} {
  const [detectingTopic, setDetectingTopic] = useState(false);
  const requestIdRef = useRef(0);

  const applyTopicDetection = useCallback(
    async (seriesId: string, topic: string) => {
      const requestId = ++requestIdRef.current;

      if (!topic) {
        setConfig((prev) => clearSeriesTopic(prev, seriesId));
        return;
      }

      setDetectingTopic(true);
      try {
        const isPrimary = seriesId === config.series[0]?.id;
        const schemaName = topicByName.get(topic)?.type;
        const jointStateFields = schemaName && isJointStateSchema(schemaName)
          ? config.jointStateFields
          : undefined;
        const result = await buildSeriesForTopic({
          topic,
          schemaName,
          player,
          startTime,
          endTime,
          existingSeriesId: seriesId,
          jointStateFields,
        });

        if (requestId !== requestIdRef.current) return;

        setConfig((prev) => applyDetectedTopicToConfig(prev, seriesId, result, isPrimary));
      } finally {
        if (requestId === requestIdRef.current) {
          setDetectingTopic(false);
        }
      }
    },
    [config.jointStateFields, config.series, endTime, player, setConfig, startTime, topicByName],
  );

  return { detectingTopic, applyTopicDetection };
}
