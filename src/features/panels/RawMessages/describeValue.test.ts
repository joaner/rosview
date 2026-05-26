import { describe, expect, it } from 'vitest';
import { describeValue } from './Component';

describe('describeValue', () => {
  it('shows hex preview for small binary buffers', () => {
    const value = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const visual = describeValue(value, 256);
    expect(visual.text).toBe('Uint8Array(4) 0xdeadbeef');
    expect(visual.kind).toBe('binary');
  });

  it('shows compact hex preview for large binary buffers', () => {
    const value = new Uint8Array(2048);
    value[0] = 0xff;
    value[7] = 0x00;
    const visual = describeValue(value, 256);
    expect(visual.text).toBe('Uint8Array(2048) 0xff00000000000000...');
  });

  it('shows compact hex preview for image topics regardless of size', () => {
    const value = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    const visual = describeValue(value, 256, { hideBinaryHex: true });
    expect(visual.text).toBe('Uint8Array(9) 0x0102030405060708...');
  });

  it('formats ROS time values', () => {
    const visual = describeValue({ sec: 100, nsec: 500_000_000 }, 256);
    expect(visual.text).toContain('100.500000000');
    expect(visual.kind).toBe('number');
  });
});
