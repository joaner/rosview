import { describe, expect, it } from 'vitest';
import {
  BinaryOpcode,
  base64ToBytes,
  parseMessageDataFrame,
  parseTimeFrame,
  schemaStringToBytes,
} from './protocol';

describe('parseMessageDataFrame', () => {
  it('parses subscription id, timestamp, and payload (little-endian)', () => {
    const payload = new TextEncoder().encode('hello');
    const buf = new ArrayBuffer(1 + 4 + 8 + payload.length);
    const view = new DataView(buf);
    view.setUint8(0, BinaryOpcode.MESSAGE_DATA);
    view.setUint32(1, 42, true);
    view.setBigUint64(5, 1_700_000_000_123_456_789n, true);
    new Uint8Array(buf, 13).set(payload);

    const parsed = parseMessageDataFrame(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.subscriptionId).toBe(42);
    expect(parsed!.timestampNs).toBe(1_700_000_000_123_456_789n);
    expect(new TextDecoder().decode(parsed!.payload)).toBe('hello');
  });

  it('returns null for short buffers', () => {
    expect(parseMessageDataFrame(new Uint8Array([0x01, 0, 0]))).toBeNull();
  });

  it('returns null for wrong opcode', () => {
    const buf = new ArrayBuffer(13);
    new DataView(buf).setUint8(0, 0xff);
    expect(parseMessageDataFrame(buf)).toBeNull();
  });
});

describe('parseTimeFrame', () => {
  it('parses server time', () => {
    const buf = new ArrayBuffer(9);
    const view = new DataView(buf);
    view.setUint8(0, BinaryOpcode.TIME);
    view.setBigUint64(1, 99n, true);
    expect(parseTimeFrame(buf)?.timestampNs).toBe(99n);
  });
});

describe('schemaStringToBytes', () => {
  it('UTF-8 encodes ros2msg schemas', () => {
    const text = 'string data\n';
    const bytes = schemaStringToBytes(text, 'ros2msg');
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it('base64-decodes protobuf schemas', () => {
    // "ABCD" base64
    const bytes = schemaStringToBytes('QUJDRA==', 'protobuf');
    expect(Array.from(bytes)).toEqual([65, 66, 67, 68]);
  });
});

describe('base64ToBytes', () => {
  it('decodes standard base64', () => {
    expect(Array.from(base64ToBytes('YQ=='))).toEqual([97]);
  });
});
