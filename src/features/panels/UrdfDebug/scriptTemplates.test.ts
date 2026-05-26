import { describe, expect, it } from 'vitest';
import { McapStreamReader, McapWriter } from '@mcap/core';
import { processMcapBuffer } from './mcapProcessor';
import { generatePythonScript, generateTypeScriptScript } from './scriptTemplates';
import type { UrdfDebugRecipe } from './recipe';

const FIXTURE_URDF = `<?xml version="1.0"?>
<robot name="test_robot">
  <link name="base"/>
  <link name="link1"/>
  <joint name="joint1" type="revolute">
    <parent link="base"/><child link="link1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

/** Visual without <origin> (DA_TRON2A-style) but still has a joint for FK. */
const NO_ORIGIN_MESH_URDF = `<?xml version="1.0"?>
<robot name="test_robot">
  <link name="base">
    <visual>
      <geometry><mesh filename="meshes/base.STL"/></geometry>
    </visual>
  </link>
  <link name="link1"/>
  <joint name="joint1" type="revolute">
    <parent link="base"/><child link="link1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
  </joint>
</robot>`;

class BufferWritable {
  #chunks: Buffer[] = [];
  #pos = 0n;

  position() {
    return this.#pos;
  }

  async write(buffer: Uint8Array) {
    const b = Buffer.from(buffer);
    this.#chunks.push(b);
    this.#pos += BigInt(b.byteLength);
    return Promise.resolve();
  }

  getBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

async function buildFixtureMcap(): Promise<Uint8Array> {
  const writable = new BufferWritable();
  const writer = new McapWriter({
    writable,
    useStatistics: true,
    useChunks: true,
    useChunkIndex: true,
  });

  await writer.start({ profile: 'ros2', library: 'rosview-test-fixture' });

  const jointSchemaId = await writer.registerSchema({
    name: 'sensor_msgs/msg/JointState',
    encoding: 'jsonschema',
    data: new TextEncoder().encode('{"type":"object"}'),
  });

  const jointChannelId = await writer.registerChannel({
    schemaId: jointSchemaId,
    topic: '/joint_states',
    messageEncoding: 'json',
    metadata: new Map(),
  });

  const logTime = 1_000_000_000n;
  await writer.addMessage({
    channelId: jointChannelId,
    sequence: 1,
    logTime,
    publishTime: logTime,
    data: new TextEncoder().encode(
      JSON.stringify({
        header: { stamp: { sec: 1, nanosec: 0 }, frame_id: '' },
        name: ['joint1'],
        position: [0.5],
        velocity: [],
        effort: [],
      }),
    ),
  });

  await writer.end();
  return writable.getBuffer();
}

function listTopics(mcap: Uint8Array): string[] {
  const reader = new McapStreamReader();
  reader.append(mcap);
  const topics = new Set<string>();
  for (let record = reader.nextRecord(); record; record = reader.nextRecord()) {
    if (record.type === 'Channel') {
      topics.add(record.topic);
    }
  }
  return [...topics].sort();
}

function readRobotDescription(mcap: Uint8Array): string {
  const reader = new McapStreamReader();
  reader.append(mcap);
  const topicsByChannel = new Map<number, string>();
  let robotDescription = '';
  for (let record = reader.nextRecord(); record; record = reader.nextRecord()) {
    if (record.type === 'Channel') {
      topicsByChannel.set(record.id, record.topic);
    } else if (record.type === 'Message' && topicsByChannel.get(record.channelId) === '/robot_description') {
      const payload = JSON.parse(new TextDecoder().decode(record.data)) as { data?: string };
      robotDescription = payload.data ?? '';
    }
  }
  return robotDescription;
}

const sampleRecipe: UrdfDebugRecipe = {
  version: 1,
  jointStateTopic: '/joint_states',
  outputTfTopic: '/tf',
  outputRobotDescriptionTopic: '/robot_description',
  urdf: { rotateMeshVisuals: false, visualRpyOffset: [0, 0, 0] },
  meshes: { strategy: 'localUpload' },
  rules: [],
};

describe('scriptTemplates', () => {
  it('generates TypeScript MCAP processor with FK and mapping', () => {
    const script = generateTypeScriptScript(sampleRecipe);
    expect(script).toContain('processMcap');
    expect(script).toContain('applyJointMapping');
    expect(script).toContain('JointState2TF');
    expect(script).toContain('/robot_description');
    expect(script).not.toContain('.pending');
  });

  it('generates Python MCAP processor with FK and mapping', () => {
    const script = generatePythonScript(sampleRecipe);
    expect(script).toContain('process_mcap');
    expect(script).toContain('apply_joint_mapping');
    expect(script).toContain('JointState2TF');
    expect(script).not.toContain('.pending');
  });

  it('Python export includes missing-origin visual correction', () => {
    const recipe: UrdfDebugRecipe = {
      ...sampleRecipe,
      urdf: { rotateMeshVisuals: true, visualRpyOffset: [0, 0, 0] },
    };
    const script = generatePythonScript(recipe);
    expect(script).toContain('repl_missing_origin');
    expect(script).toContain('repl_missing_rpy');
    expect(script).toContain("re.search(r'<origin\\b', inner, re.I)");
  });

  it('TypeScript processor rewrites test MCAP with /tf and /robot_description', async () => {
    const input = await buildFixtureMcap();
    const { output } = await processMcapBuffer({
      input,
      recipe: sampleRecipe,
      urdfXml: FIXTURE_URDF,
      overwriteTopics: true,
    });

    const topics = listTopics(output);
    expect(topics).toContain('/tf');
    expect(topics).toContain('/robot_description');
    expect(topics).toContain('/joint_states');
  });

  it('TypeScript export injects visual origin for mesh-only URDF when rotateMeshVisuals is on', async () => {
    const recipe: UrdfDebugRecipe = {
      ...sampleRecipe,
      urdf: { rotateMeshVisuals: true, visualRpyOffset: [0, 0, 0] },
    };
    const input = await buildFixtureMcap();
    const { output } = await processMcapBuffer({
      input,
      recipe,
      urdfXml: NO_ORIGIN_MESH_URDF,
      overwriteTopics: true,
    });

    const robotDescription = readRobotDescription(output);
    expect(robotDescription).toContain('rpy="-1.5707963267948966 0 0"');
  });
});
