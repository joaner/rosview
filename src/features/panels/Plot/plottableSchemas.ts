import type { TopicInfo } from '@/core/types/ros';
import {
  isAudioCommonDataSchema,
  isAudioCommonDataStampedSchema,
  isRawAudioSchema,
  isRosImageSchema,
} from '@/shared/ros/rosMessageTypes';

export function isBlockedPlotSchema(type: string): boolean {
  if (isRosImageSchema(type)) return true;
  if (isRawAudioSchema(type) || isAudioCommonDataSchema(type) || isAudioCommonDataStampedSchema(type)) {
    return true;
  }
  const normalized = type.toLowerCase().replace(/\/msg\//, '/');
  return (
    normalized.includes('/pointcloud') ||
    normalized.includes('/camera_info') ||
    normalized.includes('/compressedimage') ||
    normalized.endsWith('/image') ||
    normalized.includes('/string') ||
    normalized.endsWith('/empty')
  );
}

export function isPlottableTopic(topic: TopicInfo): boolean {
  if (isBlockedPlotSchema(topic.type)) return false;
  return true;
}

export function isPlottableSchema(type: string): boolean {
  if (isBlockedPlotSchema(type)) return false;
  return true;
}

export function filterPlottableTopics(topics: ReadonlyArray<TopicInfo>): TopicInfo[] {
  return topics.filter(isPlottableTopic);
}
