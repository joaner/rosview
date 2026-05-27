// ============================================================================
// @ioai/rosview/urdf-preview — URDF 3D preview (additive subpath export)
// ============================================================================
// Re-exports only; UrdfDebug panel internals are unchanged.

import '../index.css';

export { UrdfDebugPreview } from '../features/panels/UrdfDebug/Preview';
export type { UrdfDebugPreviewProps } from '../features/panels/UrdfDebug/Preview';

export {
  createMeshResolver,
  buildLocalMeshUrlMap,
  revokeMeshUrlMap,
} from '../features/panels/UrdfDebug/meshResolver';
export type { MeshResolverOptions } from '../features/panels/UrdfDebug/meshResolver';
export type { MeshStrategy } from '../features/panels/UrdfDebug/recipe';

export {
  prepareUrdfForPreview,
  extractUrdfJointDescriptors,
} from '../features/panels/UrdfDebug/urdfAnalysis';
export { extractPackageNameFromUrdf } from '../features/panels/UrdfDebug/meshBaseStatus';

export type { JointStateMsg } from '../features/panels/ThreeD/core/types';
