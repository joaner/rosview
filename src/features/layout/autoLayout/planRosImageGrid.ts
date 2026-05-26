import type { TopicInfo } from '@/core/types/ros';
import { isRosImageSchema } from '@/shared/ros/rosMessageTypes';
import { imageDedupeBucket, imageTopicPriorityScore } from '@/features/layout/autoLayout/imageTopicSelection';

export type CameraColumn = 'left' | 'top' | 'right';

/** Depth stream: topic path contains `/depth/` or ends with `/depth` (separate row from color). */
export function isDepthImageTopicName(name: string): boolean {
  return /\/depth(\/|$)/i.test(name);
}

/** Infer camera column (left/top/right) from topic path for auto-layout. */
export function classifyCameraSide(topicName: string): CameraColumn | 'other' {
  const m = topicName.match(/\/camera\/(left|right|top|head)\b/i);
  if (m) {
    const side = m[1].toLowerCase();
    if (side === 'head') {
      return 'top';
    }
    return side as CameraColumn;
  }
  const lower = topicName.toLowerCase();
  const tokenized = `/${lower.replace(/[_-]+/g, '/')}/`;
  if (tokenized.includes('/head/')) return 'top';
  if (tokenized.includes('/top/')) return 'top';
  if (tokenized.includes('/left/') && !tokenized.includes('/right/')) return 'left';
  if (tokenized.includes('/right/')) return 'right';
  return 'other';
}

interface Candidate {
  name: string;
  score: number;
  side: CameraColumn | 'other';
}

interface PickState {
  candidates: Candidate[];
  usedNames: Set<string>;
  usedBuckets: Set<string>;
}

function takeNextMatching(state: PickState, side: CameraColumn | 'other'): string | null {
  const next = state.candidates.find(
    (c) =>
      c.side === side &&
      !state.usedNames.has(c.name) &&
      !state.usedBuckets.has(imageDedupeBucket(c.name)),
  );
  if (!next) return null;
  state.usedNames.add(next.name);
  state.usedBuckets.add(imageDedupeBucket(next.name));
  return next.name;
}

function takeNextAny(state: PickState): string | null {
  const next = state.candidates.find(
    (c) => !state.usedNames.has(c.name) && !state.usedBuckets.has(imageDedupeBucket(c.name)),
  );
  if (!next) return null;
  state.usedNames.add(next.name);
  state.usedBuckets.add(imageDedupeBucket(next.name));
  return next.name;
}

function buildCandidates(
  topics: ReadonlyArray<TopicInfo>,
  topicNameFilter: (name: string) => boolean,
  options?: { minScore?: number },
): Candidate[] {
  const minScore = options?.minScore ?? 0;
  return topics
    .filter((t) => isRosImageSchema(t.type) && topicNameFilter(t.name))
    .map((t) => ({
      name: t.name,
      score: imageTopicPriorityScore(t.name),
      side: classifyCameraSide(t.name),
    }))
    .filter((c) => c.score >= minScore)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function pickOneRow(state: PickState): (string | null)[] {
  const columns: CameraColumn[] = ['left', 'top', 'right'];
  const row: (string | null)[] = [];
  for (const col of columns) {
    row.push(takeNextMatching(state, col));
  }
  for (let c = 0; c < row.length; c++) {
    if (row[c] === null) {
      row[c] = takeNextAny(state);
    }
  }
  return row;
}

/**
 * Plan color and depth rows separately: each row fills left / top(head) / right columns.
 * Depth streams are not dropped by the color-vs-depth priority score used elsewhere.
 */
export function planColorDepthCameraRows(topics: ReadonlyArray<TopicInfo>): {
  colorRow: (string | null)[];
  depthRow: (string | null)[];
} {
  const colorState: PickState = {
    candidates: buildCandidates(topics, (name) => !isDepthImageTopicName(name)),
    usedNames: new Set(),
    usedBuckets: new Set(),
  };
  const depthState: PickState = {
    candidates: buildCandidates(topics, (name) => isDepthImageTopicName(name), { minScore: -100 }),
    usedNames: new Set(),
    usedBuckets: new Set(),
  };
  return {
    colorRow: pickOneRow(colorState),
    depthRow: pickOneRow(depthState),
  };
}

/**
 * Plan 2×3 image grid: columns map to left / top (or fill-in) / right from camera path hints.
 * Each row prefers one left, one top, one right (by score and dedupe buckets); gaps filled from remainder.
 * `rows[0]` is upper row; `rows[1]` sits just above the 3D panel.
 */
export function planTwoByThreeImageRows(topics: ReadonlyArray<TopicInfo>): (string | null)[][] {
  const state: PickState = {
    candidates: buildCandidates(topics, () => true),
    usedNames: new Set(),
    usedBuckets: new Set(),
  };
  return [pickOneRow(state), pickOneRow(state)];
}
