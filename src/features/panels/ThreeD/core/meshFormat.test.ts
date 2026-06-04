import { describe, expect, it } from 'vitest';
import {
  getMeshExtensionFromPath,
  getMeshExtensionFromUrl,
  isSupportedMeshExtension,
  resolveMeshFormat,
} from './meshFormat';

describe('meshFormat', () => {
  it('detects extensions from path basename case-insensitively', () => {
    expect(getMeshExtensionFromPath('package://robot/meshes/base_Link.STL')).toBe('stl');
    expect(getMeshExtensionFromPath('https://x/mesh.OBJ?cache=1')).toBe('obj');
    expect(getMeshExtensionFromPath('blob:https://x/base_Link.STL')).toBe('stl');
    expect(isSupportedMeshExtension('dae')).toBe(true);
    expect(isSupportedMeshExtension('glb')).toBe(false);
  });

  it('returns undefined for blob URLs without a file suffix', () => {
    expect(getMeshExtensionFromPath('blob:http://localhost:3000/362418a8-a44f-4926-b6dc-bc29d6a527c6')).toBeUndefined();
    expect(getMeshExtensionFromUrl('blob:http://localhost:3000/362418a8-a44f-4926-b6dc-bc29d6a527c6')).toBeUndefined();
  });

  it('prefers URDF source path when blob URL has no extension', () => {
    const blobUrl = 'blob:http://localhost:3000/362418a8-a44f-4926-b6dc-bc29d6a527c6';
    expect(
      resolveMeshFormat('package://bipedal_robot/meshes/wrist_yaw_R_Link.STL', blobUrl),
    ).toBe('stl');
  });

  it('falls back to resolved URL extension for remote assets', () => {
    expect(resolveMeshFormat('package://robot/meshes/link', 'https://cdn.example.com/link.dae')).toBe(
      'dae',
    );
  });

  it('returns undefined for unsupported formats', () => {
    expect(resolveMeshFormat('package://robot/meshes/link.glb', 'blob:http://localhost/uuid')).toBeUndefined();
  });
});
