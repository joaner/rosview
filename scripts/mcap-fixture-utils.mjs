import { McapWriter } from '@mcap/core';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const __mcapUtilsDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.join(__mcapUtilsDir, '..');
export const FIXTURES_DIR = path.join(REPO_ROOT, 'test-fixtures');
export const EXAMPLES_DIR = path.join(REPO_ROOT, 'public/examples');

export class BufferWritable {
  /** @type {Buffer[]} */
  #chunks = [];
  /** @type {bigint} */
  #pos = 0n;

  position() {
    return this.#pos;
  }

  /** @param {Uint8Array} buffer */
  write(buffer) {
    const b = Buffer.from(buffer);
    this.#chunks.push(b);
    this.#pos += BigInt(b.byteLength);
    return Promise.resolve();
  }

  getBuffer() {
    return Buffer.concat(this.#chunks);
  }
}

/** @returns {Promise<{ writer: McapWriter, writable: BufferWritable }>} */
export async function createIndexedMcapWriter() {
  const writable = new BufferWritable();
  const writer = new McapWriter({
    writable,
    useStatistics: true,
    useChunks: true,
    useChunkIndex: true,
  });
  await writer.start({ profile: 'ros2', library: 'rosview-gen' });
  return { writer, writable };
}

/**
 * @param {string} filename
 * @param {Buffer} buffer
 */
export function writeExample(filename, buffer) {
  fs.mkdirSync(EXAMPLES_DIR, { recursive: true });
  const outPath = path.join(EXAMPLES_DIR, filename);
  fs.writeFileSync(outPath, buffer);
  console.log('Wrote', outPath, `(${buffer.length} bytes)`);
}

/**
 * @param {string} relPath under test-fixtures/
 * @returns {Buffer}
 */
export function readFixture(relPath) {
  return fs.readFileSync(path.join(FIXTURES_DIR, relPath));
}

const COMPRESSED_IMAGE_SCHEMA = `# sensor_msgs/msg/CompressedImage
std_msgs/Header header
string format
uint8[] data

================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id

================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec
`;

/** @type {ReturnType<typeof parseMessageDefinition> | undefined} */
let compressedImageDefs;
/** @type {MessageWriter | undefined} */
let compressedImageWriter;

function getCompressedImageWriter() {
  if (!compressedImageWriter) {
    compressedImageDefs = parseMessageDefinition(COMPRESSED_IMAGE_SCHEMA, { ros2: true });
    compressedImageWriter = new MessageWriter(compressedImageDefs);
  }
  return compressedImageWriter;
}

export function getCompressedImageSchemaBytes() {
  return new TextEncoder().encode(COMPRESSED_IMAGE_SCHEMA);
}

/**
 * @param {{ sec: number, nsec: number }} stamp
 * @param {string} format
 * @param {Buffer | Uint8Array} data
 */
export function encodeCompressedImageCdr(stamp, format, data) {
  const writer = getCompressedImageWriter();
  return writer.writeMessage({
    header: { stamp, frame_id: 'camera' },
    format,
    data,
  });
}

/**
 * @param {string} topic
 * @param {Awaited<ReturnType<typeof createIndexedMcapWriter>>['writer']} writer
 */
export async function registerCompressedImageChannel(topic, writer) {
  const schemaId = await writer.registerSchema({
    name: 'sensor_msgs/msg/CompressedImage',
    encoding: 'ros2msg',
    data: getCompressedImageSchemaBytes(),
  });
  const channelId = await writer.registerChannel({
    schemaId,
    topic,
    messageEncoding: 'cdr',
    metadata: new Map(),
  });
  return channelId;
}
