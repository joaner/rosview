import { describe, expect, it } from 'vitest';
import type { MessageEvent } from '@/core/types/ros';
import {
  filterPointsInWindow,
  messageToAlignPoint,
  plotTimeNsForMessage,
  receiveTimeNs,
} from './alignTimeUtils';

function ev(overrides: Partial<MessageEvent> & Pick<MessageEvent, 'topic'>): MessageEvent {
  return {
    topic: overrides.topic,
    receiveTime: overrides.receiveTime ?? { sec: 10, nsec: 0 },
    publishTime: overrides.publishTime ?? { sec: 10, nsec: 0 },
    message: overrides.message ?? {},
    schemaName: overrides.schemaName ?? 'sensor_msgs/msg/Image',
  };
}

describe('alignTimeUtils', () => {
  it('plotTimeNs uses receiveTime in receiveTime mode', () => {
    const m = ev({
      topic: '/a',
      receiveTime: { sec: 1, nsec: 500_000_000 },
    });
    expect(plotTimeNsForMessage(m, 'receiveTime')).toBe(1_500_000_000n);
  });

  it('plotTimeNs uses header stamp in headerStamp mode when present', () => {
    const m = ev({
      topic: '/a',
      receiveTime: { sec: 5, nsec: 0 },
      message: { header: { stamp: { sec: 2, nsec: 250_000_000 } } },
    });
    expect(plotTimeNsForMessage(m, 'headerStamp')).toBe(2_250_000_000n);
  });

  it('plotTimeNs falls back to receiveTime in headerStamp mode without stamp', () => {
    const m = ev({
      topic: '/a',
      receiveTime: { sec: 3, nsec: 0 },
      message: {},
    });
    expect(plotTimeNsForMessage(m, 'headerStamp')).toBe(receiveTimeNs(m));
  });

  it('messageToAlignPoint carries stampNs for hover', () => {
    const m = ev({
      topic: '/cam',
      receiveTime: { sec: 1, nsec: 0 },
      message: { header: { stamp: { sec: 1, nsec: 100_000_000 } } },
    });
    const p = messageToAlignPoint(m, 'receiveTime');
    expect(p.topic).toBe('/cam');
    expect(p.receiveNs).toBe(1_000_000_000n);
    expect(p.stampNs).toBe(1_100_000_000n);
  });

  it('filterPointsInWindow keeps points within half window of center', () => {
    const c = 1_000_000_000n;
    const half = 500_000_000n;
    const pts = [
      messageToAlignPoint(ev({ topic: '/a', receiveTime: { sec: 0, nsec: 600_000_000 } }), 'receiveTime'),
      messageToAlignPoint(ev({ topic: '/b', receiveTime: { sec: 1, nsec: 0 } }), 'receiveTime'),
      messageToAlignPoint(ev({ topic: '/c', receiveTime: { sec: 2, nsec: 0 } }), 'receiveTime'),
    ];
    const filtered = filterPointsInWindow(pts, c, half);
    expect(filtered.map((p) => p.topic)).toEqual(['/a', '/b']);
  });
});
