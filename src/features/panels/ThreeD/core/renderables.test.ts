/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  applyFramePoses,
  applyJointStates,
  buildRobotRenderable,
  disposeRobotRenderable,
} from './renderables';

const BOX_URDF = `<?xml version="1.0"?>
<robot name="box_bot">
  <link name="base">
    <visual>
      <geometry><box size="0.2 0.2 0.2"/></geometry>
    </visual>
  </link>
</robot>`;

const MESH_URDF = (filename: string) => `<?xml version="1.0"?>
<robot name="mesh_bot">
  <link name="base">
    <visual>
      <geometry><mesh filename="${filename}"/></geometry>
    </visual>
  </link>
</robot>`;

const TWO_LINK_URDF = `<?xml version="1.0"?>
<robot name="two_link">
  <link name="base">
    <visual>
      <geometry><box size="0.1 0.1 0.1"/></geometry>
    </visual>
  </link>
  <link name="arm">
    <visual>
      <geometry><box size="0.2 0.05 0.05"/></geometry>
    </visual>
  </link>
  <joint name="j1" type="revolute">
    <parent link="base"/><child link="arm"/>
    <origin xyz="0.5 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

describe('applyJointStates', () => {
  it('updates child link pose when joint position changes', async () => {
    const model = await buildRobotRenderable(TWO_LINK_URDF, {
      resolveMeshUrl: (path) => path,
      warn: () => {},
    });

    expect(model.parsed.robot.joints.has('j1')).toBe(true);
    expect(model.rootFrameId).toBe('base');

    expect(applyJointStates(model, { name: ['j1'], position: [0] })).toBe(1);
    applyFramePoses(model, 0n);
    const armEntry = model.frameObjects.find((entry) => entry.frameId === 'arm');
    expect(armEntry).toBeDefined();
    const armQuatAtZero = armEntry!.object.quaternion.clone();
    armEntry!.object.updateMatrixWorld(true);
    const armMatrixAtZero = armEntry!.object.matrixWorld.clone();

    expect(applyJointStates(model, { name: ['j1'], position: [Math.PI / 2] })).toBe(1);
    applyFramePoses(model, 0n);
    armEntry!.object.updateMatrixWorld(true);
    const relAtHalf = model.transformTree.getRelativeTransform('base', 'arm', 0n);

    expect(relAtHalf?.position.x).toBeCloseTo(0.5, 3);
    expect(armEntry!.object.quaternion.angleTo(armQuatAtZero)).toBeGreaterThan(0.1);
    expect(armEntry!.object.matrixWorld.equals(armMatrixAtZero)).toBe(false);

    expect(applyJointStates(model, { name: ['missing'], position: [1] })).toBe(0);

    disposeRobotRenderable(model);
  });

  it('keeps all links visible with a virtual world parent joint', async () => {
    const urdf = `<?xml version="1.0"?>
<robot name="world_parent">
  <link name="base_Link">
    <visual><geometry><box size="0.5 0.5 0.2"/></geometry></visual>
  </link>
  <link name="arm_Link">
    <visual><geometry><box size="0.2 0.2 0.5"/></geometry></visual>
  </link>
  <joint name="base_joint" type="fixed">
    <parent link="world"/><child link="base_Link"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/>
  </joint>
  <joint name="arm_joint" type="revolute">
    <parent link="base_Link"/><child link="arm_Link"/>
    <origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/>
  </joint>
</robot>`;

    const model = await buildRobotRenderable(urdf, {
      resolveMeshUrl: (path) => path,
      warn: () => {},
    });

    applyJointStates(model, { name: ['arm_joint'], position: [0] });
    applyFramePoses(model, 0n);

    expect(model.frameObjects.every((entry) => entry.object.visible)).toBe(true);

    const armEntry = model.frameObjects.find((entry) => entry.frameId === 'arm_Link');
    expect(armEntry?.object.position.z).toBeGreaterThan(0.4);

    disposeRobotRenderable(model);
  });

  it('keeps links visible when frame ids use a leading slash', async () => {
    const urdf = `<?xml version="1.0"?>
<robot name="slash_frames">
  <link name="/base">
    <visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual>
  </link>
  <link name="/arm">
    <visual><geometry><box size="0.2 0.05 0.05"/></geometry></visual>
  </link>
  <joint name="j1" type="fixed">
    <parent link="/base"/><child link="/arm"/>
    <origin xyz="0.5 0 0" rpy="0 0 0"/>
  </joint>
</robot>`;

    const model = await buildRobotRenderable(urdf, {
      resolveMeshUrl: (path) => path,
      warn: () => {},
    });
    applyFramePoses(model, 0n);

    expect(model.frameObjects.every((entry) => entry.object.visible)).toBe(true);
    const armEntry = model.frameObjects.find((entry) => entry.frameId === '/arm');
    expect(armEntry?.object.position.x).toBeCloseTo(0.5, 3);

    disposeRobotRenderable(model);
  });
});

describe('buildRobotRenderable mesh formats', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads primitive box geometry without mesh fetch', async () => {
    const model = await buildRobotRenderable(BOX_URDF, {
      resolveMeshUrl: (path) => path,
      warn: () => {},
    });
    expect(model.frameObjects).toHaveLength(1);
    disposeRobotRenderable(model);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads OBJ mesh assets', async () => {
    const objText = [
      'o cube',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
    ].join('\n');
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      text: async () => objText,
    });

    const model = await buildRobotRenderable(MESH_URDF('package://robot/meshes/link.obj'), {
      resolveMeshUrl: () => 'blob:https://local/link.obj',
      warn: () => {},
    });

    expect(model.frameObjects).toHaveLength(1);
    disposeRobotRenderable(model);
    expect(fetchMock).toHaveBeenCalledWith('blob:https://local/link.obj');
  });

  it('loads STL mesh assets from blob URLs without file suffix', async () => {
    const stlText = [
      'solid test',
      '  facet normal 0 0 0',
      '    outer loop',
      '      vertex 0 0 0',
      '      vertex 1 0 0',
      '      vertex 0 1 0',
      '    endloop',
      '  endfacet',
      'endsolid test',
    ].join('\n');
    const stlBuffer = new TextEncoder().encode(stlText).buffer;
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => stlBuffer,
      text: async () => stlText,
    });

    const blobUrl = 'blob:http://localhost:3000/362418a8-a44f-4926-b6dc-bc29d6a527c6';
    const warnings: string[] = [];
    const model = await buildRobotRenderable(MESH_URDF('package://robot/meshes/link.STL'), {
      resolveMeshUrl: () => blobUrl,
      warn: (_url, reason) => warnings.push(reason),
    });

    expect(warnings.some((reason) => reason.includes('unsupported mesh format'))).toBe(false);
    expect(model.frameObjects).toHaveLength(1);
    disposeRobotRenderable(model);
    expect(fetchMock).toHaveBeenCalledWith(blobUrl);
  });

  it('reports unsupported mesh extensions via warn callback', async () => {
    const warnings: string[] = [];
    const model = await buildRobotRenderable(MESH_URDF('package://robot/meshes/link.glb'), {
      resolveMeshUrl: () => 'blob:https://local/link.glb',
      warn: (_url, reason) => warnings.push(reason),
    });
    expect(model.frameObjects).toHaveLength(0);
    expect(warnings.some((reason) => reason.includes('unsupported mesh format'))).toBe(true);
    disposeRobotRenderable(model);
  });
});

function getFirstMeshRootRotation(model: Awaited<ReturnType<typeof buildRobotRenderable>>): number {
  const frameEntry = model.frameObjects[0];
  expect(frameEntry).toBeDefined();
  const visualGroup = frameEntry.object.children[0];
  const meshRoot = visualGroup?.children[0];
  expect(meshRoot).toBeDefined();
  return meshRoot.rotation.x;
}

describe('buildRobotRenderable meshUpAxis', () => {
  const fetchMock = vi.fn();
  const stlText = [
    'solid test',
    '  facet normal 0 0 0',
    '    outer loop',
    '      vertex 0 0 0',
    '      vertex 1 0 0',
    '      vertex 0 1 0',
    '    endloop',
    '  endfacet',
    'endsolid test',
  ].join('\n');

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    const stlBuffer = new TextEncoder().encode(stlText).buffer;
    fetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => stlBuffer,
      text: async () => stlText,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const meshUrdf = `<?xml version="1.0"?>
<robot name="mesh_bot">
  <link name="base">
    <visual>
      <geometry><mesh filename="package://robot/meshes/link.stl"/></geometry>
    </visual>
  </link>
</robot>`;

  it('applies rotateX(+π/2) for y_up (Foxglove default)', async () => {
    const model = await buildRobotRenderable(meshUrdf, {
      resolveMeshUrl: () => 'blob:https://local/link.stl',
      warn: () => {},
      meshUpAxis: 'y_up',
    });
    expect(getFirstMeshRootRotation(model)).toBeCloseTo(Math.PI / 2, 5);
    disposeRobotRenderable(model);
  });

  it('skips loader rotation for z_up (teleop / Z-up mesh)', async () => {
    const model = await buildRobotRenderable(meshUrdf, {
      resolveMeshUrl: () => 'blob:https://local/link.stl',
      warn: () => {},
      meshUpAxis: 'z_up',
    });
    expect(getFirstMeshRootRotation(model)).toBeCloseTo(0, 5);
    disposeRobotRenderable(model);
  });

  it('loads DA_TRON2A-style URDF without visual origin', async () => {
    const urdf = `<?xml version="1.0"?>
<robot name="bipedal_robot">
  <link name="base_Link">
    <visual>
      <geometry><mesh filename="package://bipedal_robot/meshes/base_Link.STL"/></geometry>
    </visual>
  </link>
</robot>`;
    const model = await buildRobotRenderable(urdf, {
      resolveMeshUrl: () => 'blob:https://local/base_Link.STL',
      warn: () => {},
      meshUpAxis: 'z_up',
    });
    expect(model.frameObjects).toHaveLength(1);
    expect(getFirstMeshRootRotation(model)).toBeCloseTo(0, 5);
    disposeRobotRenderable(model);
  });
});
