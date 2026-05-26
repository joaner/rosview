import { describe, expect, it } from 'vitest';
import type { TopicInfo } from '@/core/types/ros';
import {
  dedupeOverlappingImageTopics,
  imageDedupeBucket,
  imageTopicPriorityScore,
  selectImageTopicsForAutoLayout,
} from '@/features/layout/autoLayout/imageTopicSelection';

describe('imageDedupeBucket', () => {
  it('uses strict topic path key', () => {
    expect(imageDedupeBucket('/camera/left/color/image_raw')).toBe('/camera/left/color/image_raw');
    expect(imageDedupeBucket('/camera/left/depth/image_rect_raw')).toBe('/camera/left/depth/image_rect_raw');
  });
});

describe('dedupeOverlappingImageTopics', () => {
  it('keeps longer topic when names overlap by containment', () => {
    const deduped = dedupeOverlappingImageTopics([
      '/io/depth/EgoCentric_Camera',
      '/io/depth/EgoCentric_Camera/color/compressed',
    ]);
    expect(deduped).toEqual(['/io/depth/egocentric_camera/color/compressed']);
  });
});

describe('imageTopicPriorityScore', () => {
  it('prefers compressed over raw', () => {
    const raw = imageTopicPriorityScore('/camera/top/color/image_raw');
    const comp = imageTopicPriorityScore('/camera/top/color/image_raw/compressed');
    expect(comp).toBeGreaterThan(raw);
  });
});

describe('selectImageTopicsForAutoLayout', () => {
  it('dedupes only by strict path overlap and keeps longer topic', () => {
    const topics: TopicInfo[] = [
      { name: '/camera/left/color/image_raw', type: 'sensor_msgs/msg/Image' },
      { name: '/camera/left/color/image_raw/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ];
    const picked = selectImageTopicsForAutoLayout(topics);
    expect(picked).toEqual(['/camera/left/color/image_raw/compressed']);
  });

  it('includes foxglove CompressedVideo topics', () => {
    const topics: TopicInfo[] = [
      { name: '/camera/left/color/video', type: 'foxglove_msgs/msg/CompressedVideo' },
      { name: '/camera/right/color/video', type: 'foxglove_msgs/msg/CompressedVideo' },
    ];
    const picked = selectImageTopicsForAutoLayout(topics);
    expect(picked).toEqual([
      '/camera/left/color/video',
      '/camera/right/color/video',
    ]);
  });

  it('keeps distinct non-overlapping streams', () => {
    const topics: TopicInfo[] = [
      { name: '/camera/left/color/image_resized/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/camera/right/color/image_resized/compressed', type: 'sensor_msgs/msg/CompressedImage' },
      { name: '/sensor/EgoCentric_Camera_0/image/compressed', type: 'sensor_msgs/msg/CompressedImage' },
    ];
    const picked = selectImageTopicsForAutoLayout(topics);
    expect(picked).toHaveLength(3);
    expect(picked).toContain('/camera/left/color/image_resized/compressed');
    expect(picked).toContain('/camera/right/color/image_resized/compressed');
    expect(picked).toContain('/sensor/EgoCentric_Camera_0/image/compressed');
  });
});
