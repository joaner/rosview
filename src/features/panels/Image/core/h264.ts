export function getH264ChunkType(data: Uint8Array): 'key' | 'delta' {
  return containsH264KeyNal(data) ? 'key' : 'delta';
}

/** IDR slices are the only NAL units that are safe random-access points. */
export function containsH264IdrNal(data: Uint8Array): boolean {
  return scanH264NalTypes(data).includes(5);
}

export function containsH264KeyNal(data: Uint8Array): boolean {
  for (const nalType of scanH264NalTypes(data)) {
    // IDR slices are random access points. Treat SPS/PPS as key chunks too so
    // codec configuration packets are never trimmed away as disposable deltas.
    if (nalType === 5 || nalType === 7 || nalType === 8) {
      return true;
    }
  }
  return false;
}

/**
 * Derive an RFC 6381 AVC codec string from the first Annex-B SPS.
 * The three bytes after the SPS NAL header are profile_idc,
 * constraint_set flags/profile compatibility, and level_idc.
 */
export function parseH264SpsCodec(data: Uint8Array): string | null {
  for (const nalOffset of scanH264NalOffsets(data)) {
    if ((data[nalOffset] & 0x1f) !== 7 || nalOffset + 3 >= data.byteLength) {
      continue;
    }
    const profile = data[nalOffset + 1];
    const compatibility = data[nalOffset + 2];
    const level = data[nalOffset + 3];
    return `avc1.${hexByte(profile)}${hexByte(compatibility)}${hexByte(level)}`;
  }
  return null;
}

/**
 * Decoder candidates ordered from stream-specific to broadly compatible.
 * Chromium accepts Annex-B chunks when no AVCDecoderConfigurationRecord is
 * supplied, so a codec string is sufficient for in-band SPS/PPS streams.
 */
export function getH264CodecCandidates(data: Uint8Array): string[] {
  const parsed = parseH264SpsCodec(data);
  const candidates = [
    parsed,
    parsed ? `avc1.${parsed.slice(5, 7)}00${parsed.slice(-2)}` : null,
    'avc1.42E01E',
    'avc1.4D4020',
    'avc1.640028',
  ];
  return [...new Set(candidates.filter((candidate): candidate is string => candidate != null))];
}

export function monotonicH264TimestampUs(timeNs: bigint, previousUs: number): number {
  const sourceUs = Number(timeNs / 1_000n);
  return Math.max(sourceUs, previousUs + 1);
}

export function scanH264NalTypes(data: Uint8Array): number[] {
  const offsets = scanH264NalOffsets(data);
  return offsets.map((offset) => data[offset] & 0x1f);
}

function scanH264NalOffsets(data: Uint8Array): number[] {
  const offsets: number[] = [];
  let offset = 0;
  while (offset < data.byteLength - 3) {
    const start = findAnnexBStartCode(data, offset);
    if (start < 0) {
      break;
    }
    const prefixLength = data[start + 2] === 1 ? 3 : 4;
    const nalOffset = start + prefixLength;
    if (nalOffset < data.byteLength) {
      offsets.push(nalOffset);
    }
    offset = nalOffset + 1;
  }
  if (offsets.length > 0) {
    return offsets;
  }
  return data.byteLength > 0 ? [0] : [];
}

function findAnnexBStartCode(data: Uint8Array, offset: number): number {
  for (let i = offset; i < data.byteLength - 3; i += 1) {
    if (data[i] !== 0 || data[i + 1] !== 0) {
      continue;
    }
    if (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1)) {
      return i;
    }
  }
  return -1;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase();
}
