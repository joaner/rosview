/**
 * Minimal MCAP with PoseStamped topics for pose-panel E2E.
 */
import {
  createIndexedMcapWriter,
  writeExample,
} from './mcap-fixture-utils.mjs';

const { writer, writable } = await createIndexedMcapWriter();

const schemaId = await writer.registerSchema({
  name: 'geometry_msgs/msg/PoseStamped',
  encoding: 'jsonschema',
  data: new TextEncoder().encode('{"type":"object"}'),
});

const topics = ['/io/pose/Left_Gripper', '/io/pose/Right_Gripper'];
const channelIds = [];
for (const topic of topics) {
  channelIds.push(
    await writer.registerChannel({
      schemaId,
      topic,
      messageEncoding: 'json',
      metadata: new Map(),
    }),
  );
}

const messageTimes = [1_000_000_000n, 3_000_000_000n, 5_000_000_000n];
for (const [idx, ts] of messageTimes.entries()) {
  for (const [topicIdx, channelId] of channelIds.entries()) {
    await writer.addMessage({
      channelId,
      sequence: idx + 1,
      logTime: ts,
      publishTime: ts,
      data: new TextEncoder().encode(
        JSON.stringify({
          header: {
            stamp: { sec: Number(ts / 1_000_000_000n), nanosec: Number(ts % 1_000_000_000n) },
            frame_id: 'world',
          },
          pose: {
            position: { x: topicIdx + idx * 0.1, y: 0, z: 0 },
            orientation: { x: 0, y: 0, z: 0, w: 1 },
          },
        }),
      ),
    });
  }
}

await writer.end();
writeExample('test_pose.mcap', writable.getBuffer());
