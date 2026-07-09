import { describe, expect, it } from 'vitest';
import type { Initialization } from '@/core/types/ros';
import { mergeInitializations } from './mergeInitialization';

function makeInit(overrides: Partial<Initialization>): Initialization {
  return {
    topics: [],
    datatypes: {},
    start: { sec: 0, nsec: 0 },
    end: { sec: 1, nsec: 0 },
    publishersByTopic: {},
    topicStats: {},
    problems: [],
    ...overrides,
  };
}

describe('mergeInitializations', () => {
  it('passes a single source through unchanged', () => {
    const init = makeInit({
      topics: [{ name: '/a', type: 'std_msgs/String', messageCount: 5, frequency: 1, durationSec: 4 }],
      topicStats: { '/a': { messageCount: 5, frequency: 1, durationSec: 4 } },
    });
    const result = mergeInitializations([{ label: 'base.mcap', initialization: init }]);
    expect(result.initialization).toBe(init);
    expect(result.memberIndicesByTopic.get('/a')).toEqual([0]);
  });

  it('concatenates disjoint topics in file order (default "sort by file")', () => {
    const base = makeInit({
      topics: [
        { name: '/camera', type: 'sensor_msgs/CompressedImage' },
        { name: '/joint_states', type: 'sensor_msgs/JointState' },
      ],
      start: { sec: 10, nsec: 0 },
      end: { sec: 20, nsec: 0 },
      topicStats: {
        '/camera': { messageCount: 100, frequency: 10, durationSec: 10 },
        '/joint_states': { messageCount: 200, frequency: 20, durationSec: 10 },
      },
    });
    const incremental = makeInit({
      topics: [{ name: '/analysis/hand_pose_overlay', type: 'sensor_msgs/Image' }],
      start: { sec: 12, nsec: 0 },
      end: { sec: 18, nsec: 0 },
      topicStats: {
        '/analysis/hand_pose_overlay': { messageCount: 50, frequency: 5, durationSec: 6 },
      },
    });

    const { initialization, memberIndicesByTopic } = mergeInitializations([
      { label: 'base.mcap', initialization: base },
      { label: 'incremental.mcap', initialization: incremental },
    ]);

    expect(initialization.topics.map((t) => t.name)).toEqual([
      '/camera',
      '/joint_states',
      '/analysis/hand_pose_overlay',
    ]);
    expect(initialization.topics.find((t) => t.name === '/analysis/hand_pose_overlay')?.sourceLabels).toEqual([
      'incremental.mcap',
    ]);
    expect(memberIndicesByTopic.get('/camera')).toEqual([0]);
    expect(memberIndicesByTopic.get('/analysis/hand_pose_overlay')).toEqual([1]);
  });

  it('uses the union (min start, max end) of all sources as the merged time range', () => {
    const a = makeInit({ start: { sec: 10, nsec: 0 }, end: { sec: 20, nsec: 0 } });
    const b = makeInit({ start: { sec: 5, nsec: 0 }, end: { sec: 15, nsec: 0 } });
    const c = makeInit({ start: { sec: 18, nsec: 0 }, end: { sec: 30, nsec: 0 } });
    const { initialization } = mergeInitializations([
      { label: 'a', initialization: a },
      { label: 'b', initialization: b },
      { label: 'c', initialization: c },
    ]);
    expect(initialization.start).toEqual({ sec: 5, nsec: 0 });
    expect(initialization.end).toEqual({ sec: 30, nsec: 0 });
  });

  it('folds same-name topics into one entry, accumulating sourceLabels and merging topicStats', () => {
    const a = makeInit({
      topics: [{ name: '/tf', type: 'tf2_msgs/TFMessage', messageCount: 100, frequency: 10, durationSec: 10 }],
      topicStats: { '/tf': { messageCount: 100, frequency: 10, durationSec: 10 } },
    });
    const b = makeInit({
      topics: [{ name: '/tf', type: 'tf2_msgs/TFMessage', messageCount: 50, frequency: 5, durationSec: 10 }],
      topicStats: { '/tf': { messageCount: 50, frequency: 5, durationSec: 10 } },
    });
    const { initialization, memberIndicesByTopic } = mergeInitializations([
      { label: 'a.mcap', initialization: a },
      { label: 'b.mcap', initialization: b },
    ]);
    expect(initialization.topics).toHaveLength(1);
    const tf = initialization.topics[0];
    expect(tf.sourceLabels).toEqual(['a.mcap', 'b.mcap']);
    // Per-member stats on the merged TopicInfo are cleared; the authoritative
    // numbers live in topicStats (IterablePlayer backfills from there).
    expect(tf.messageCount).toBeUndefined();
    expect(initialization.topicStats['/tf']).toEqual({ messageCount: 150, frequency: 7.5, durationSec: 20 });
    expect(memberIndicesByTopic.get('/tf')).toEqual([0, 1]);
  });

  it('records a problem when the same topic name has mismatched schemas', () => {
    const a = makeInit({ topics: [{ name: '/x', type: 'a/A' }] });
    const b = makeInit({ topics: [{ name: '/x', type: 'b/B' }] });
    const { initialization } = mergeInitializations([
      { label: 'a', initialization: a },
      { label: 'b', initialization: b },
    ]);
    expect(initialization.topics[0].type).toBe('a/A');
    expect(initialization.problems.some((p) => p.message.includes('mismatched schema'))).toBe(true);
  });

  it('merges publishersByTopic and datatypes across sources', () => {
    const a = makeInit({
      publishersByTopic: { '/x': ['nodeA'] },
      datatypes: { 'a/A': { fields: [] } },
    });
    const b = makeInit({
      publishersByTopic: { '/x': ['nodeB'], '/y': ['nodeC'] },
      datatypes: { 'b/B': { fields: [] } },
    });
    const { initialization } = mergeInitializations([
      { label: 'a', initialization: a },
      { label: 'b', initialization: b },
    ]);
    expect(initialization.publishersByTopic['/x']).toEqual(['nodeA', 'nodeB']);
    expect(initialization.publishersByTopic['/y']).toEqual(['nodeC']);
    expect(Object.keys(initialization.datatypes).sort()).toEqual(['a/A', 'b/B']);
  });

  it('randomAccessByTopic is true only when every source supports it', () => {
    const a = makeInit({ randomAccessByTopic: true });
    const b = makeInit({ randomAccessByTopic: true });
    const c = makeInit({ randomAccessByTopic: false });
    expect(
      mergeInitializations([
        { label: 'a', initialization: a },
        { label: 'b', initialization: b },
      ]).initialization.randomAccessByTopic,
    ).toBe(true);
    expect(
      mergeInitializations([
        { label: 'a', initialization: a },
        { label: 'c', initialization: c },
      ]).initialization.randomAccessByTopic,
    ).toBe(false);
  });

  it('preferredSamplingFps takes the max of defined hints', () => {
    const a = makeInit({ preferredSamplingFps: 10 });
    const b = makeInit({ preferredSamplingFps: 30 });
    const { initialization } = mergeInitializations([
      { label: 'a', initialization: a },
      { label: 'b', initialization: b },
    ]);
    expect(initialization.preferredSamplingFps).toBe(30);
  });

  it('concatenates problems from all sources', () => {
    const a = makeInit({ problems: [{ severity: 'warn', message: 'a warned' }] });
    const b = makeInit({ problems: [{ severity: 'error', message: 'b errored' }] });
    const { initialization } = mergeInitializations([
      { label: 'a', initialization: a },
      { label: 'b', initialization: b },
    ]);
    expect(initialization.problems).toEqual([
      { severity: 'warn', message: 'a warned' },
      { severity: 'error', message: 'b errored' },
    ]);
  });

  it('throws when given zero sources', () => {
    expect(() => mergeInitializations([])).toThrow();
  });
});
