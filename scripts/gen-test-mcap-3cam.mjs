/**
 * Minimal MCAP with three compressed JPEG camera topics for ros-image-grid E2E.
 */
import {
  createIndexedMcapWriter,
  encodeCompressedImageCdr,
  readFixture,
  registerCompressedImageChannel,
  writeExample,
} from './mcap-fixture-utils.mjs';

const jpegBytes = readFixture('media/jpeg-1x1.bin');

const { writer, writable } = await createIndexedMcapWriter();

const topics = [
  '/camera/left/color/image_raw/compressed',
  '/camera/top/color/image_raw/compressed',
  '/camera/right/color/image_raw/compressed',
];

const channelIds = [];
for (const topic of topics) {
  channelIds.push(await registerCompressedImageChannel(topic, writer));
}

const messageTimes = [1_000_000_000n, 3_000_000_000n, 5_000_000_000n];
for (const [idx, ts] of messageTimes.entries()) {
  const stamp = { sec: Number(ts / 1_000_000_000n), nsec: Number(ts % 1_000_000_000n) };
  for (const channelId of channelIds) {
    await writer.addMessage({
      channelId,
      sequence: idx + 1,
      logTime: ts,
      publishTime: ts,
      data: encodeCompressedImageCdr(stamp, 'jpeg', jpegBytes),
    });
  }
}

await writer.end();
writeExample('test_3cam.mcap', writable.getBuffer());
