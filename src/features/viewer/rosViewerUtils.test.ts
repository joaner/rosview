import { describe, expect, it } from 'vitest';
import { fileBatchDisplayName } from './rosViewerUtils';

function makeFile(name: string): File {
  return new File([new Uint8Array(4)], name, { lastModified: 1 });
}

describe('fileBatchDisplayName', () => {
  it('returns an empty string for an empty batch', () => {
    expect(fileBatchDisplayName([])).toBe('');
  });

  it('returns the file name for a single file', () => {
    expect(fileBatchDisplayName([makeFile('base.mcap')])).toBe('base.mcap');
  });

  it('appends a "+N" suffix for multiple files, based on the first one', () => {
    expect(fileBatchDisplayName([makeFile('base.mcap'), makeFile('incremental.mcap')])).toBe('base.mcap +1');
    expect(
      fileBatchDisplayName([makeFile('a.mcap'), makeFile('b.mcap'), makeFile('c.bag')]),
    ).toBe('a.mcap +2');
  });
});
