/**
 * Generate the "incremental analysis" half of the multi-source merge
 * fixtures: public/examples/test_multi_incremental.mcap.
 *
 * Simulates a downstream tool (e.g. hand-pose extraction drawn onto frames)
 * that re-processes a base recording and writes its *own* MCAP containing
 * only the newly-produced topic. Spans 3s-7s, which partially overlaps and
 * partially extends past gen-test-mcap-multi-base.mjs's 0s-5s range, so the
 * merged session's time range (0s-7s) exercises the union-of-ranges logic
 * rather than one file's range trivially containing the other's.
 */
import { createIndexedMcapWriter, writeExample } from './mcap-fixture-utils.mjs';

const { writer, writable } = await createIndexedMcapWriter();

const schemaId = await writer.registerSchema({
  name: 'sensor_msgs/msg/CompressedImage',
  encoding: 'jsonschema',
  data: new TextEncoder().encode('{"type":"object"}'),
});
const channelId = await writer.registerChannel({
  schemaId,
  topic: '/analysis/hand_pose_overlay/compressed',
  messageEncoding: 'json',
  metadata: new Map(),
});

const secs = [3, 4, 5, 6, 7];
for (const [idx, sec] of secs.entries()) {
  const ts = BigInt(sec) * 1_000_000_000n;
  await writer.addMessage({
    channelId,
    sequence: idx + 1,
    logTime: ts,
    publishTime: ts,
    data: new TextEncoder().encode(JSON.stringify({ format: 'jpeg', data: '' })),
  });
}

await writer.end();
writeExample('test_multi_incremental.mcap', writable.getBuffer());
