/**
 * Depth / mono16 colorization (Foxglove-style), without THREE.js dependency.
 * Ported from studio/packages/studio-base/src/panels/ThreeDeeRender/renderables/colorMode.ts
 */

export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type ImageColorMode = 'flat' | 'gradient' | 'colormap' | 'rgb' | 'rgba' | 'rgba-fields';

export interface RawImageDecodeOptions {
  colorMode: ImageColorMode;
  flatColor: string;
  gradient: [string, string];
  colorMap: 'turbo' | 'rainbow';
  explicitAlpha: number;
  minValue?: number;
  maxValue?: number;
  colorField?: string;
}

export const DEFAULT_RAW_IMAGE_DECODE_OPTIONS: RawImageDecodeOptions = {
  colorMode: 'colormap',
  flatColor: '#ffffff',
  gradient: ['#000000', '#ffffff'],
  colorMap: 'turbo',
  explicitAlpha: 1,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const tempColor1: ColorRGBA = { r: 0, g: 0, b: 0, a: 0 };
const tempColor2: ColorRGBA = { r: 0, g: 0, b: 0, a: 0 };

export function stringToRgba(output: ColorRGBA, colorStr: string): ColorRGBA {
  const s = colorStr.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    output.r = parseInt(h.slice(0, 2), 16) / 255;
    output.g = parseInt(h.slice(2, 4), 16) / 255;
    output.b = parseInt(h.slice(4, 6), 16) / 255;
    output.a = 1;
    return output;
  }
  const rgba = s.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgba) {
    output.r = Number(rgba[1]) / 255;
    output.g = Number(rgba[2]) / 255;
    output.b = Number(rgba[3]) / 255;
    output.a = rgba[4] != null ? Number(rgba[4]) : 1;
    return output;
  }
  output.r = output.g = output.b = output.a = 1;
  return output;
}

export function rgbaGradient(out: ColorRGBA, a: ColorRGBA, b: ColorRGBA, t: number): void {
  const f = clamp(t, 0, 1);
  out.r = a.r + (b.r - a.r) * f;
  out.g = a.g + (b.g - a.g) * f;
  out.b = a.b + (b.b - a.b) * f;
  out.a = a.a + (b.a - a.a) * f;
}

function rainbowLinear(output: ColorRGBA, pct: number): void {
  const h = (1.0 - clamp(pct, 0, 1)) * 5.0 + 1.0;
  const i = Math.floor(h);
  let f = h % 1;
  if (i % 2 < 1) {
    f = 1.0 - f;
  }
  const n = 1.0 - f;
  if (i <= 1) {
    output.r = n;
    output.g = 0;
    output.b = 1;
  } else if (i === 2) {
    output.r = 0;
    output.g = n;
    output.b = 1;
  } else if (i === 3) {
    output.r = 0;
    output.g = 1;
    output.b = n;
  } else if (i === 4) {
    output.r = n;
    output.g = 1;
    output.b = 0;
  } else {
    output.r = 1;
    output.g = n;
    output.b = 0;
  }
  output.a = 1;
}

const kRedVec4 = [0.13572138, 4.6153926, -42.66032258, 132.13108234] as const;
const kGreenVec4 = [0.09140261, 2.19418839, 4.84296658, -14.18503333] as const;
const kBlueVec4 = [0.1066733, 12.64194608, -60.58204836, 110.36276771] as const;
const kRedVec2 = [-152.94239396, 59.28637943] as const;
const kGreenVec2 = [4.27729857, 2.82956604] as const;
const kBlueVec2 = [-89.90310912, 27.34824973] as const;

/** Turbo colormap in displayable 0–1 (sRGB-ish) for 8-bit ImageData. */
function turboLinear(output: ColorRGBA, pct: number): void {
  const x = clamp(pct, 0.0, 1.0) * 0.99 + 0.01;
  const x2 = x * x;
  const x3 = x2 * x;
  const v4r = 1 * kRedVec4[0] + x * kRedVec4[1] + x2 * kRedVec4[2] + x3 * kRedVec4[3];
  const v4g = 1 * kGreenVec4[0] + x * kGreenVec4[1] + x2 * kGreenVec4[2] + x3 * kGreenVec4[3];
  const v4b = 1 * kBlueVec4[0] + x * kBlueVec4[1] + x2 * kBlueVec4[2] + x3 * kBlueVec4[3];
  const v2x = x2;
  const v2y = x3;
  const dot2r = v2x * kRedVec2[0] + v2y * kRedVec2[1];
  const dot2g = v2x * kGreenVec2[0] + v2y * kGreenVec2[1];
  const dot2b = v2x * kBlueVec2[0] + v2y * kBlueVec2[1];
  output.r = clamp(v4r + dot2r, 0, 1);
  output.g = clamp(v4g + dot2g, 0, 1);
  output.b = clamp(v4b + dot2b, 0, 1);
  output.a = 1;
}

const TURBO_LOOKUP_SIZE = 65535;
let TurboLookup: Float32Array | undefined;

function turboLinearCached(output: ColorRGBA, pct: number): void {
  if (!TurboLookup) {
    TurboLookup = new Float32Array(TURBO_LOOKUP_SIZE * 3);
    const tempColor: ColorRGBA = { r: 0, g: 0, b: 0, a: 0 };
    for (let i = 0; i < TURBO_LOOKUP_SIZE; i++) {
      turboLinear(tempColor, i / (TURBO_LOOKUP_SIZE - 1));
      const offset = i * 3;
      TurboLookup[offset + 0] = tempColor.r;
      TurboLookup[offset + 1] = tempColor.g;
      TurboLookup[offset + 2] = tempColor.b;
    }
  }
  const offset = Math.trunc(pct * (TURBO_LOOKUP_SIZE - 1)) * 3;
  output.r = TurboLookup[offset + 0]!;
  output.g = TurboLookup[offset + 1]!;
  output.b = TurboLookup[offset + 2]!;
  output.a = 1;
}

function getColorBgra(output: ColorRGBA, colorValue: number): void {
  const num = colorValue >>> 0;
  output.a = ((num & 0xff000000) >>> 24) / 255;
  output.r = ((num & 0x00ff0000) >>> 16) / 255;
  output.g = ((num & 0x0000ff00) >>> 8) / 255;
  output.b = ((num & 0x000000ff) >>> 0) / 255;
}

export type ColorConverter = (output: ColorRGBA, colorValue: number) => void;

export function getColorConverter(
  settings: RawImageDecodeOptions,
  minValue: number,
  maxValue: number,
): ColorConverter {
  const mode = settings.colorMode;
  if (mode === 'rgba-fields') {
    throw new Error('rgba-fields color mode is not supported for scalar depth images');
  }

  switch (mode) {
    case 'flat': {
      const flatColor = stringToRgba(tempColor1, settings.flatColor);
      return (output: ColorRGBA) => {
        output.r = flatColor.r;
        output.g = flatColor.g;
        output.b = flatColor.b;
        output.a = flatColor.a;
      };
    }
    case 'gradient': {
      const valueDelta = Math.max(maxValue - minValue, Number.EPSILON);
      const minColor = stringToRgba(tempColor1, settings.gradient[0]);
      const maxColor = stringToRgba(tempColor2, settings.gradient[1]);
      return (output: ColorRGBA, colorValue: number) => {
        const frac = Math.max(0, Math.min((colorValue - minValue) / valueDelta, 1));
        rgbaGradient(output, minColor, maxColor, frac);
      };
    }
    case 'colormap': {
      const valueDelta = Math.max(maxValue - minValue, Number.EPSILON);
      if (settings.colorMap === 'turbo') {
        return (output: ColorRGBA, colorValue: number) => {
          const frac = Math.max(0, Math.min((colorValue - minValue) / valueDelta, 1));
          turboLinearCached(output, frac);
          output.a = settings.explicitAlpha;
        };
      }
      return (output: ColorRGBA, colorValue: number) => {
        const frac = Math.max(0, Math.min((colorValue - minValue) / valueDelta, 1));
        rainbowLinear(output, frac);
        output.a = settings.explicitAlpha;
      };
    }
    case 'rgb':
      return (output: ColorRGBA, colorValue: number) => {
        getColorBgra(output, colorValue);
        output.a = settings.explicitAlpha;
      };
    case 'rgba':
      return (output: ColorRGBA, colorValue: number) => {
        getColorBgra(output, colorValue);
      };
    default:
      throw new Error(`Unsupported color mode: ${String(mode)}`);
  }
}
