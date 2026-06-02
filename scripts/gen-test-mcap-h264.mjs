/**
 * Minimal MCAP with H.264 CompressedImage messages for image-h264 E2E.
 */
import {
  createIndexedMcapWriter,
  encodeCompressedImageCdr,
  readFixture,
  registerCompressedImageChannel,
  writeExample,
} from './mcap-fixture-utils.mjs';

const keyBytes = readFixture('media/h264-key.bin');
const deltaBytes = readFixture('media/h264-delta.bin');

const { writer, writable } = await createIndexedMcapWriter();

const channelId = await registerCompressedImageChannel(
  '/camera/head/color/image_raw/compressed',
  writer,
);

const frames = [
  { ts: 1_000_000_000n, data: keyBytes },
  { ts: 1_100_000_000n, data: deltaBytes },
  { ts: 1_200_000_000n, data: deltaBytes },
  { ts: 3_000_000_000n, data: keyBytes },
  { ts: 3_100_000_000n, data: deltaBytes },
  { ts: 5_000_000_000n, data: keyBytes },
];

for (const [idx, { ts, data }] of frames.entries()) {
  const stamp = { sec: Number(ts / 1_000_000_000n), nsec: Number(ts % 1_000_000_000n) };
  await writer.addMessage({
    channelId,
    sequence: idx + 1,
    logTime: ts,
    publishTime: ts,
    data: encodeCompressedImageCdr(stamp, 'h264', data),
  });
}

await writer.end();
writeExample('test_h264.mcap', writable.getBuffer());
