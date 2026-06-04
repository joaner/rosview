export function getH264ChunkType(data: Uint8Array): 'key' | 'delta' {
  return containsH264KeyNal(data) ? 'key' : 'delta';
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

export function scanH264NalTypes(data: Uint8Array): number[] {
  const types: number[] = [];
  let offset = 0;
  while (offset < data.byteLength - 3) {
    const start = findAnnexBStartCode(data, offset);
    if (start < 0) {
      break;
    }
    const prefixLength = data[start + 2] === 1 ? 3 : 4;
    const nalOffset = start + prefixLength;
    if (nalOffset < data.byteLength) {
      types.push(data[nalOffset] & 0x1f);
    }
    offset = nalOffset + 1;
  }
  if (types.length > 0) {
    return types;
  }
  return data.byteLength > 0 ? [data[0] & 0x1f] : [];
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
