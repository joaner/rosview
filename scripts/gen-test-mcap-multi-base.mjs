/**
 * Generate the "base recording" half of the multi-source merge fixtures:
 * public/examples/test_multi_base.mcap, spanning 0s-5s with two topics.
 *
 * Paired with gen-test-mcap-multi-incremental.mjs, which simulates a
 * separately-produced MCAP (e.g. output of an external hand-pose analysis
 * pipeline) that adds one new topic over a partially-overlapping time range.
 * Loading both together should merge into one session whose topic list has
 * all three topics and whose time range is the union of both files.
 */
import { createIndexedMcapWriter, writeExample } from './mcap-fixture-utils.mjs';

const { writer, writable } = await createIndexedMcapWriter();

const cameraSchemaId = await writer.registerSchema({
  name: 'sensor_msgs/msg/CompressedImage',
  encoding: 'jsonschema',
  data: new TextEncoder().encode('{"type":"object"}'),
});
const cameraChannelId = await writer.registerChannel({
  schemaId: cameraSchemaId,
  topic: '/camera/front/image_raw/compressed',
  messageEncoding: 'json',
  metadata: new Map(),
});

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

const secs = [0, 1, 2, 3, 4, 5];
for (const [idx, sec] of secs.entries()) {
  const ts = BigInt(sec) * 1_000_000_000n;
  await writer.addMessage({
    channelId: cameraChannelId,
    sequence: idx + 1,
    logTime: ts,
    publishTime: ts,
    data: new TextEncoder().encode(JSON.stringify({ format: 'jpeg', data: '' })),
  });
  await writer.addMessage({
    channelId: jointChannelId,
    sequence: idx + 1,
    logTime: ts,
    publishTime: ts,
    data: new TextEncoder().encode(
      JSON.stringify({
        header: { stamp: { sec, nanosec: 0 }, frame_id: '' },
        name: ['joint1', 'joint2'],
        position: [sec * 0.1, -sec * 0.1],
        velocity: [],
        effort: [],
      }),
    ),
  });
}

await writer.end();
writeExample('test_multi_base.mcap', writable.getBuffer());
