import * as THREE from 'three';

import type { Quaternion, Vector3 } from './types';

type TransformSample = {
  time: bigint;
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
};

type FrameNode = {
  id: string;
  parentId?: string;
  samples: TransformSample[];
};

// Cap per-frame sample history. We only need a short window for interpolation;
// TF arrives at 30–200 Hz, so letting `samples` grow unbounded produced a
// quadratic (splice + findIndex per insert) CPU trend and retained millions of
// bigint/Vector3/Quaternion objects during long playback.
const MAX_SAMPLES_PER_FRAME = 32;

function cloneVector3(value: Vector3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function cloneQuaternion(value: Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(value.x, value.y, value.z, value.w);
}

export class TransformTree {
  private frames = new Map<string, FrameNode>();
  // Reusable scratch objects for zero-allocation lookups. These are only used
  // inside synchronous pose queries, so sharing them across calls is safe.
  private scratchRootMatrix = new THREE.Matrix4();
  private scratchChildMatrix = new THREE.Matrix4();
  private scratchLocalMatrix = new THREE.Matrix4();
  private scratchRelativeMatrix = new THREE.Matrix4();
  private scratchInvRootMatrix = new THREE.Matrix4();
  private scratchComposePos = new THREE.Vector3();
  private scratchComposeQuat = new THREE.Quaternion();
  private scratchUnitScale = new THREE.Vector3(1, 1, 1);
  private scratchDecomposeScale = new THREE.Vector3();
  private scratchAncestors: string[] = [];
  private scratchVisiting = new Set<string>();

  addFrame(frameId: string): void {
    const normalized = normalizeFrameId(frameId);
    if (!normalized || this.frames.has(normalized)) {
      return;
    }
    this.frames.set(normalized, { id: normalized, samples: [] });
  }

  addTransform(
    parentFrameId: string,
    childFrameId: string,
    time: bigint,
    translation: Vector3,
    rotation: Quaternion,
  ): void {
    const parentId = normalizeFrameId(parentFrameId);
    const childId = normalizeFrameId(childFrameId);
    if (!parentId || !childId || parentId === childId) {
      return;
    }

    this.addFrame(parentId);
    this.addFrame(childId);

    if (this.wouldCreateCycle(childId, parentId)) {
      return;
    }

    const frame = this.frames.get(childId)!;
    frame.parentId = parentId;
    const samples = frame.samples;
    const nextSample: TransformSample = {
      time,
      position: cloneVector3(translation),
      rotation: cloneQuaternion(rotation),
    };

    // Fast path: TF stamps almost always arrive monotonically during playback.
    // Append in O(1) and only fall back to the linear search when we detect
    // an out-of-order or duplicate timestamp.
    const lastSample = samples.length > 0 ? samples[samples.length - 1] : undefined;
    if (!lastSample || time > lastSample.time) {
      samples.push(nextSample);
    } else if (time === lastSample.time) {
      samples[samples.length - 1] = nextSample;
    } else {
      const existingIndex = samples.findIndex((sample) => sample.time === time);
      if (existingIndex >= 0) {
        samples[existingIndex] = nextSample;
      } else {
        const insertIndex = samples.findIndex((sample) => sample.time > time);
        if (insertIndex === -1) {
          samples.push(nextSample);
        } else {
          samples.splice(insertIndex, 0, nextSample);
        }
      }
    }

    // Trim to a fixed-size ring. We want to keep the most-recent samples so
    // interpolation queries at (or near) current time still have two
    // neighbouring samples available.
    if (samples.length > MAX_SAMPLES_PER_FRAME) {
      samples.splice(0, samples.length - MAX_SAMPLES_PER_FRAME);
    }
  }

  hasFrame(frameId: string): boolean {
    return this.frames.has(normalizeFrameId(frameId));
  }

  getRootFrameId(preferredFrameId?: string): string | undefined {
    const preferred = preferredFrameId ? normalizeFrameId(preferredFrameId) : undefined;
    if (preferred && this.frames.has(preferred)) {
      let current = this.frames.get(preferred)!;
      while (current.parentId) {
        const parent = this.frames.get(current.parentId);
        if (!parent) {
          break;
        }
        current = parent;
      }
      return current.id;
    }

    if (this.frames.has('world')) {
      return 'world';
    }

    for (const frame of this.frames.values()) {
      if (!frame.parentId) {
        return frame.id;
      }
    }
    return this.frames.keys().next().value;
  }

  getRelativeTransform(
    rootFrameId: string,
    childFrameId: string,
    time: bigint,
  ): { position: THREE.Vector3; rotation: THREE.Quaternion } | undefined {
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    if (!this.getRelativeTransformInto(rootFrameId, childFrameId, time, position, rotation)) {
      return undefined;
    }
    return { position, rotation };
  }

  /**
   * Zero-allocation variant of {@link getRelativeTransform}. Writes the
   * relative pose into the supplied vectors and returns `true` on success.
   * The scratch matrices on `this` are shared, so this method is not
   * re-entrant safe.
   */
  getRelativeTransformInto(
    rootFrameId: string,
    childFrameId: string,
    time: bigint,
    outPosition: THREE.Vector3,
    outRotation: THREE.Quaternion,
  ): boolean {
    this.scratchVisiting.clear();
    if (!this.buildWorldMatrixInto(normalizeFrameId(rootFrameId), time, this.scratchRootMatrix)) {
      return false;
    }
    this.scratchVisiting.clear();
    if (!this.buildWorldMatrixInto(normalizeFrameId(childFrameId), time, this.scratchChildMatrix)) {
      return false;
    }
    this.scratchInvRootMatrix.copy(this.scratchRootMatrix).invert();
    this.scratchRelativeMatrix.multiplyMatrices(this.scratchInvRootMatrix, this.scratchChildMatrix);
    this.scratchRelativeMatrix.decompose(outPosition, outRotation, this.scratchDecomposeScale);
    return true;
  }

  getWorldMatrix(frameId: string, time: bigint): THREE.Matrix4 | undefined {
    const out = new THREE.Matrix4();
    this.scratchVisiting.clear();
    return this.buildWorldMatrixInto(normalizeFrameId(frameId), time, out) ? out : undefined;
  }

  private buildWorldMatrixInto(
    frameId: string,
    time: bigint,
    out: THREE.Matrix4,
  ): boolean {
    // Iteratively walk from frameId up to the root, then compose top-down.
    // Avoids allocating a Matrix4 per recursion level.
    const ancestors = this.scratchAncestors;
    ancestors.length = 0;
    let current: string | undefined = frameId;
    while (current) {
      if (this.scratchVisiting.has(current)) {
        return false;
      }
      const frame = this.frames.get(current);
      if (!frame) {
        return false;
      }
      this.scratchVisiting.add(current);
      ancestors.push(current);
      current = frame.parentId;
    }

    out.identity();
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const frame = this.frames.get(ancestors[i])!;
      if (!frame.parentId) {
        continue;
      }
      if (!interpolateSampleInto(
        frame.samples,
        time,
        this.scratchComposePos,
        this.scratchComposeQuat,
      )) {
        return false;
      }
      this.scratchLocalMatrix.compose(
        this.scratchComposePos,
        this.scratchComposeQuat,
        this.scratchUnitScale,
      );
      out.multiply(this.scratchLocalMatrix);
    }
    return true;
  }

  private wouldCreateCycle(frameId: string, parentFrameId: string): boolean {
    let current = this.frames.get(parentFrameId);
    while (current?.parentId) {
      if (current.parentId === frameId) {
        return true;
      }
      current = this.frames.get(current.parentId);
    }
    return false;
  }
}

function interpolateSampleInto(
  samples: TransformSample[],
  time: bigint,
  outPosition: THREE.Vector3,
  outRotation: THREE.Quaternion,
): boolean {
  if (samples.length === 0) {
    return false;
  }
  if (samples.length === 1) {
    outPosition.copy(samples[0].position);
    outRotation.copy(samples[0].rotation);
    return true;
  }

  if (time <= samples[0].time) {
    outPosition.copy(samples[0].position);
    outRotation.copy(samples[0].rotation);
    return true;
  }
  if (time >= samples[samples.length - 1].time) {
    const last = samples[samples.length - 1];
    outPosition.copy(last.position);
    outRotation.copy(last.rotation);
    return true;
  }

  let lowerIndex = 0;
  let upperIndex = samples.length - 1;
  while (upperIndex - lowerIndex > 1) {
    const middle = (lowerIndex + upperIndex) >> 1;
    if (samples[middle].time <= time) {
      lowerIndex = middle;
    } else {
      upperIndex = middle;
    }
  }

  const lower = samples[lowerIndex];
  const upper = samples[upperIndex];
  if (lower.time === upper.time) {
    outPosition.copy(upper.position);
    outRotation.copy(upper.rotation);
    return true;
  }

  const fraction = Number(time - lower.time) / Number(upper.time - lower.time);
  outPosition.lerpVectors(lower.position, upper.position, fraction);
  outRotation.slerpQuaternions(lower.rotation, upper.rotation, fraction);
  return true;
}

export function normalizeFrameId(frameId: string): string {
  return frameId.startsWith('/') ? frameId.slice(1) : frameId;
}
