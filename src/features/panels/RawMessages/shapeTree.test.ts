import { describe, expect, it } from 'vitest';
import type { MessageEvent } from '@/core/types/ros';
import { buildRowsForMessageEvent } from './shapeTree';

describe('buildRowsForMessageEvent', () => {
  it('includes log_time and publish_time rows before message', () => {
    const event: MessageEvent = {
      topic: '/camera/image',
      receiveTime: { sec: 10, nsec: 1 },
      publishTime: { sec: 9, nsec: 2 },
      message: { width: 640, height: 480 },
      schemaName: 'sensor_msgs/msg/Image',
    };

    const shape = buildRowsForMessageEvent(event, 4, 2000);
    expect(shape.rows.slice(0, 3).map((row) => row.key)).toEqual(['log_time', 'publish_time', 'message']);
    expect(shape.signature.startsWith('log_time:time|publish_time:time|')).toBe(true);
  });
});
