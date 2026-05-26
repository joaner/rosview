import { McapIndexedReader, McapWriter, type Channel, type Schema } from '@mcap/core';
import { MessageReader, MessageWriter } from '@foxglove/rosmsg2-serialization';
import rosmsg from '@foxglove/rosmsg';
import { JointState2TF } from './embedded/fkEngine.js';
import { applyJointMapping } from './jointStateMapping';
import type { UrdfDebugRecipe } from './recipe';
import { applyUrdfVisualCorrection } from './urdfVisualCorrection';

const { parseMessageDefinition } = rosmsg;

const ROS2_DEFINITIONS = [
  { name: 'builtin_interfaces/msg/Time', definitions: [{ name: 'sec', type: 'int32' }, { name: 'nanosec', type: 'uint32' }] },
  { name: 'std_msgs/msg/Header', definitions: [{ name: 'stamp', type: 'builtin_interfaces/msg/Time', isComplex: true }, { name: 'frame_id', type: 'string' }] },
  { name: 'geometry_msgs/msg/Vector3', definitions: [{ name: 'x', type: 'float64' }, { name: 'y', type: 'float64' }, { name: 'z', type: 'float64' }] },
  { name: 'geometry_msgs/msg/Quaternion', definitions: [{ name: 'x', type: 'float64' }, { name: 'y', type: 'float64' }, { name: 'z', type: 'float64' }, { name: 'w', type: 'float64' }] },
  { name: 'geometry_msgs/msg/Transform', definitions: [{ name: 'translation', type: 'geometry_msgs/msg/Vector3', isComplex: true }, { name: 'rotation', type: 'geometry_msgs/msg/Quaternion', isComplex: true }] },
  { name: 'geometry_msgs/msg/TransformStamped', definitions: [{ name: 'header', type: 'std_msgs/msg/Header', isComplex: true }, { name: 'child_frame_id', type: 'string' }, { name: 'transform', type: 'geometry_msgs/msg/Transform', isComplex: true }] },
  { name: 'tf2_msgs/msg/TFMessage', definitions: [{ name: 'transforms', type: 'geometry_msgs/msg/TransformStamped', isArray: true, isComplex: true }] },
  { name: 'std_msgs/msg/String', definitions: [{ name: 'data', type: 'string' }] },
  { name: 'sensor_msgs/msg/JointState', definitions: [{ name: 'header', type: 'std_msgs/msg/Header', isComplex: true }, { name: 'name', type: 'string', isArray: true }, { name: 'position', type: 'float64', isArray: true }, { name: 'velocity', type: 'float64', isArray: true }, { name: 'effort', type: 'float64', isArray: true }] },
];

class BufferReadable {
  constructor(private readonly buffer: Uint8Array) {}

  size() {
    return BigInt(this.buffer.byteLength);
  }

  async read(offset: bigint, size: bigint) {
    const start = Number(offset);
    return this.buffer.subarray(start, start + Number(size));
  }
}

class BufferWritable {
  #chunks: Buffer[] = [];
  #pos = 0n;

  position() {
    return this.#pos;
  }

  async write(buffer: Uint8Array) {
    const chunk = Buffer.from(buffer);
    this.#chunks.push(chunk);
    this.#pos += BigInt(chunk.byteLength);
  }

  toBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

function prepareUrdfFromRecipe(urdfXml: string, recipe: UrdfDebugRecipe): string {
  const urdf = recipe.urdf ?? { rotateMeshVisuals: false, visualRpyOffset: [0, 0, 0] as [number, number, number] };
  return applyUrdfVisualCorrection(urdfXml, {
    rotateMeshVisuals: !!urdf.rotateMeshVisuals,
    visualRpyOffset: Array.isArray(urdf.visualRpyOffset)
      ? (urdf.visualRpyOffset as [number, number, number])
      : [0, 0, 0],
  });
}

function normalizeJointState(raw: unknown) {
  const msg = raw as {
    name?: unknown;
    position?: unknown;
    header?: { stamp?: { sec?: number; nanosec?: number }; frame_id?: string };
  };
  const name = Array.isArray(msg?.name) ? msg.name.map(String) : [];
  const position = Array.isArray(msg?.position) ? msg.position.map((v) => Number(v) || 0) : [];
  const header =
    msg?.header && typeof msg.header === 'object'
      ? msg.header
      : { stamp: { sec: 0, nanosec: 0 }, frame_id: '' };
  return { header, name, position };
}

function buildChannelDeserializer(channel: Channel, schema: Schema | undefined) {
  if (channel.messageEncoding === 'json') {
    const decoder = new TextDecoder();
    return (data: Uint8Array) => JSON.parse(decoder.decode(data)) as unknown;
  }
  if (!schema?.data?.length) {
    throw new Error(`Missing schema for ${channel.topic}`);
  }
  const text = new TextDecoder().decode(schema.data);
  const reader = new MessageReader(parseMessageDefinition(text));
  return (data: Uint8Array) => reader.readMessage(data);
}

function buildChannelSerializer(schemaName: string, writers: Record<string, MessageWriter>) {
  const writer = writers[schemaName];
  if (!writer) throw new Error(`Missing writer for ${schemaName}`);
  return (msg: unknown) => writer.writeMessage(msg);
}

export type ProcessMcapBufferOptions = {
  input: Uint8Array;
  recipe: UrdfDebugRecipe;
  urdfXml: string;
  overwriteTopics?: boolean;
};

/** In-memory MCAP processor (same logic as exported TypeScript scripts). */
export async function processMcapBuffer({
  input,
  recipe,
  urdfXml,
  overwriteTopics = false,
}: ProcessMcapBufferOptions): Promise<{ output: Uint8Array; processedJointStates: number }> {
  const tfTopic = recipe.outputTfTopic ?? '/tf';
  const robotDescTopic = recipe.outputRobotDescriptionTopic ?? '/robot_description';
  const jointTopic = recipe.jointStateTopic;
  if (!jointTopic) throw new Error('recipe.jointStateTopic is required');

  const reader = await McapIndexedReader.Initialize({
    readable: new BufferReadable(input),
  });

  let hasTf = false;
  let hasRobotDesc = false;
  let jointChannel: Channel | undefined;
  for (const channel of reader.channelsById.values()) {
    if (channel.topic === tfTopic) hasTf = true;
    if (channel.topic === robotDescTopic) hasRobotDesc = true;
    if (channel.topic === jointTopic) jointChannel = channel;
  }
  if (!jointChannel) throw new Error(`JointState topic not found: ${jointTopic}`);
  if (!overwriteTopics && (hasTf || hasRobotDesc)) {
    throw new Error(
      'Input already contains /tf or /robot_description. Pass --overwrite-topics to replace them.',
    );
  }

  const writable = new BufferWritable();
  const writer = new McapWriter({ writable });
  await writer.start({
    profile: reader.header?.profile ?? 'ros2',
    library: 'urdf-debug-processor',
  });

  const schemaMap = new Map<number, number>();
  const channelMap = new Map<number, number>();
  for (const schema of reader.schemasById.values()) {
    schemaMap.set(schema.id, await writer.registerSchema(schema));
  }
  for (const channel of reader.channelsById.values()) {
    if (overwriteTopics && (channel.topic === tfTopic || channel.topic === robotDescTopic)) continue;
    const mapped = { ...channel, schemaId: schemaMap.get(channel.schemaId) ?? 0 };
    channelMap.set(channel.id, await writer.registerChannel(mapped));
  }

  const outEncoding = jointChannel.messageEncoding ?? 'json';
  const preparedUrdf = prepareUrdfFromRecipe(urdfXml, recipe);
  const fkEngine = JointState2TF.fromXml({ xml: preparedUrdf });
  const jointSchema = reader.schemasById.get(jointChannel.schemaId);
  const deserializeJoint = buildChannelDeserializer(jointChannel, jointSchema);

  const writers: Record<string, MessageWriter> = {
    'tf2_msgs/msg/TFMessage': new MessageWriter(ROS2_DEFINITIONS),
    'std_msgs/msg/String': new MessageWriter(ROS2_DEFINITIONS),
  };

  let tfChannelId: number;
  let robotDescChannelId: number;
  if (outEncoding === 'json') {
    const tfSchemaId = await writer.registerSchema({
      name: 'tf2_msgs/msg/TFMessage',
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{"type":"object"}'),
    });
    const robotSchemaId = await writer.registerSchema({
      name: 'std_msgs/msg/String',
      encoding: 'jsonschema',
      data: new TextEncoder().encode('{"type":"object"}'),
    });
    tfChannelId = await writer.registerChannel({
      schemaId: tfSchemaId,
      topic: tfTopic,
      messageEncoding: 'json',
      metadata: new Map(),
    });
    robotDescChannelId = await writer.registerChannel({
      schemaId: robotSchemaId,
      topic: robotDescTopic,
      messageEncoding: 'json',
      metadata: new Map(),
    });
  } else {
    const tfSchemaId = await writer.registerSchema({
      name: 'tf2_msgs/msg/TFMessage',
      encoding: 'ros2msg',
      data: new TextEncoder().encode('geometry_msgs/TransformStamped[] transforms\n'),
    });
    const robotSchemaId = await writer.registerSchema({
      name: 'std_msgs/msg/String',
      encoding: 'ros2msg',
      data: new TextEncoder().encode('string data\n'),
    });
    tfChannelId = await writer.registerChannel({
      schemaId: tfSchemaId,
      topic: tfTopic,
      messageEncoding: 'cdr',
      metadata: new Map(),
    });
    robotDescChannelId = await writer.registerChannel({
      schemaId: robotSchemaId,
      topic: robotDescTopic,
      messageEncoding: 'cdr',
      metadata: new Map(),
    });
  }

  const serializeTf =
    outEncoding === 'json'
      ? (msg: unknown) => new TextEncoder().encode(JSON.stringify(msg))
      : buildChannelSerializer('tf2_msgs/msg/TFMessage', writers);
  const serializeString =
    outEncoding === 'json'
      ? (msg: unknown) => new TextEncoder().encode(JSON.stringify(msg))
      : buildChannelSerializer('std_msgs/msg/String', writers);

  let robotDescWritten = false;
  let tfSeq = 0;
  let processedJointStates = 0;

  for await (const message of reader.readMessages()) {
    const channel = reader.channelsById.get(message.channelId);
    if (!channel) continue;
    if (overwriteTopics && (channel.topic === tfTopic || channel.topic === robotDescTopic)) continue;

    const mappedChannelId = channelMap.get(message.channelId);
    if (mappedChannelId != null) {
      await writer.addMessage({ ...message, channelId: mappedChannelId });
    }

    if (channel.id !== jointChannel.id) continue;

    const rawJoint = normalizeJointState(deserializeJoint(message.data));
    const mapped = applyJointMapping(
      { name: rawJoint.name, position: rawJoint.position },
      recipe.rules ?? [],
    );
    const tfMsg = fkEngine.computeFromJointState(
      { header: rawJoint.header, name: mapped.name, position: mapped.position },
      { publishTimeNs: message.logTime },
    );

    if (!robotDescWritten) {
      await writer.addMessage({
        channelId: robotDescChannelId,
        sequence: 0,
        logTime: message.logTime,
        publishTime: message.publishTime,
        data: serializeString({ data: preparedUrdf }),
      });
      robotDescWritten = true;
    }

    tfSeq += 1;
    await writer.addMessage({
      channelId: tfChannelId,
      sequence: tfSeq,
      logTime: message.logTime,
      publishTime: message.publishTime,
      data: serializeTf(tfMsg),
    });
    processedJointStates += 1;
  }

  await writer.end();
  return { output: writable.toBuffer(), processedJointStates };
}
