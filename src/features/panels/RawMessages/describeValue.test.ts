import { describe, expect, it } from 'vitest';
import { describeValue } from './Component';

describe('describeValue', () => {
  it('shows hex preview for small binary buffers', () => {
    const value = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const visual = describeValue(value, 256);
    expect(visual.text).toBe('Uint8Array(4) 0xdeadbeef');
    expect(visual.kind).toBe('binary');
  });

  it('hides hex preview for large binary buffers', () => {
    const value = new Uint8Array(2048);
    const visual = describeValue(value, 256);
    expect(visual.text).toBe('Uint8Array(2048) [preview hidden]');
  });

  it('hides hex preview for image topics regardless of size', () => {
    const value = new Uint8Array([1, 2, 3]);
    const visual = describeValue(value, 256, { hideBinaryHex: true });
    expect(visual.text).toBe('Uint8Array(3) [preview hidden]');
  });

  it('formats ROS time values', () => {
    const visual = describeValue({ sec: 100, nsec: 500_000_000 }, 256);
    expect(visual.text).toContain('100.500000000');
    expect(visual.kind).toBe('number');
  });
});
