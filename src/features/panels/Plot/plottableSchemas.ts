import type { TopicInfo } from '@/core/types/ros';
import {
  isAudioCommonDataSchema,
  isAudioCommonDataStampedSchema,
  isRawAudioSchema,
  isRosImageSchema,
} from '@/shared/ros/rosMessageTypes';
import { isPlottableSchema } from './schemaRegistry/plotSchemaRegistry';

export { isPlottableSchema };

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
  return isPlottableSchema(topic.type);
}

export function filterPlottableTopics(topics: ReadonlyArray<TopicInfo>): TopicInfo[] {
  return topics.filter(isPlottableTopic);
}
