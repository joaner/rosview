import type { MessageEvent } from '@/core/types/ros';

/** One-pass index: O(events) instead of O(series × events) per lookup. */
export function indexEventsByTopic(events: ReadonlyArray<MessageEvent>): Map<string, MessageEvent[]> {
  const byTopic = new Map<string, MessageEvent[]>();
  for (const event of events) {
    const list = byTopic.get(event.topic);
    if (list) {
      list.push(event);
    } else {
      byTopic.set(event.topic, [event]);
    }
  }
  return byTopic;
}

export function getLatestEventForTopic(
  byTopic: ReadonlyMap<string, MessageEvent[]>,
  topic: string,
): MessageEvent | undefined {
  const events = byTopic.get(topic);
  if (!events || events.length === 0) return undefined;
  return events[events.length - 1];
}
