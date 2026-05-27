import { describe, expect, it } from 'vitest';
import { decodeRawImage } from './rawDecoders';

describe('decodeRawImage', () => {
  it('decodes rgb8 into rgba', () => {
    const output = new Uint8ClampedArray(8);
    decodeRawImage(
      {
        encoding: 'rgb8',
        width: 2,
        height: 1,
        data: new Uint8Array([255, 0, 0, 0, 255, 0]),
      },
      output,
    );

    expect(Array.from(output)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('decodes mono8 into grayscale rgba', () => {
    const output = new Uint8ClampedArray(8);
    decodeRawImage(
      {
        encoding: 'mono8',
        width: 2,
        height: 1,
        data: new Uint8Array([0, 255]),
      },
      output,
    );

    expect(Array.from(output)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('decodes 16uc1 using grayscale normalization', () => {
    const output = new Uint8ClampedArray(4);
    decodeRawImage(
      {
        encoding: '16UC1',
        width: 1,
        height: 1,
        data: new Uint8Array([0x88, 0x13]),
      },
      output,
      { minValue: 0, maxValue: 10000, colorMode: 'colormap', colorMap: 'turbo' },
    );

    // Turbo at ~50% depth is not grayscale; assert visible color + opaque alpha.
    expect(output[0] + output[1] + output[2]).toBeGreaterThan(80);
    expect(output[3]).toBe(255);
  });

  it('throws on unsupported encoding', () => {
    const output = new Uint8ClampedArray(4);
    expect(() =>
      decodeRawImage(
        {
          encoding: 'unknown',
          width: 1,
          height: 1,
          data: new Uint8Array([0]),
        },
        output,
      ),
    ).toThrow(/Unsupported image encoding/);
  });
});
