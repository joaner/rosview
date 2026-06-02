#!/usr/bin/env node
/**
 * Inspect MCAP topics for Plot panel fixture generation.
 * Usage: node scripts/inspect-mcap-topics.mjs path/to/file.mcap
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const mcapPath = process.argv[2];
  if (!mcapPath) {
    console.error('Usage: node scripts/inspect-mcap-topics.mjs <file.mcap>');
    process.exit(1);
  }
  const resolved = path.resolve(mcapPath);
  if (!fs.existsSync(resolved)) {
    console.error('File not found:', resolved);
    process.exit(1);
  }

  const { McapIndexedReader } = await import('@mcap/core');
  const buffer = fs.readFileSync(resolved);
  const reader = await McapIndexedReader.Initialize({
    readable: {
      size: () => BigInt(buffer.byteLength),
      read: async (offset, length) => buffer.subarray(offset, offset + length),
    },
  });

  const topics = new Map();
  for (const channel of reader.channelsById.values()) {
    const schema = channel.schemaId !== 0 ? reader.schemasById.get(channel.schemaId) : undefined;
    topics.set(channel.topic, {
      topic: channel.topic,
      schema: schema?.name ?? 'unknown',
      messageEncoding: channel.messageEncoding,
    });
  }

  console.log(JSON.stringify({
    file: resolved,
    topicCount: topics.size,
    topics: [...topics.values()].sort((a, b) => a.topic.localeCompare(b.topic)),
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
