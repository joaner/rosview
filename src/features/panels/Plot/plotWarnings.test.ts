import { describe, expect, it } from 'vitest';
import type { IntlShape } from 'react-intl';
import { plotWarningKey, formatPlotDatasetWarning } from './plotWarnings';

const formatMessage: IntlShape['formatMessage'] = (descriptor, values) => {
  const id = typeof descriptor === 'string' ? descriptor : descriptor.id;
  if (id === 'panels.plot.warning.noNumericValues') {
    const params = values as { topic?: string; path?: string } | undefined;
    return `No numeric values for ${params?.topic ?? ''}.${params?.path ?? ''}`;
  }
  if (id === 'panels.plot.warning.nonIndexedSource') {
    return 'Non-indexed source';
  }
  return id ?? '';
};

describe('plotWarnings', () => {
  it('builds stable dedupe keys', () => {
    expect(
      plotWarningKey({ kind: 'noNumericValues', topic: '/a', path: 'data' }),
    ).toBe('noNumeric:/a:data');
    expect(
      plotWarningKey({ kind: 'mismatchedXY', topic: '/a', xPath: 'x[:]', yPath: 'y[:]' }),
    ).toBe('mismatch:/a:x[:]:y[:]');
    expect(plotWarningKey({ kind: 'nonIndexedSource' })).toBe('nonIndexedSource');
  });

  it('formats warnings with interpolation', () => {
    expect(
      formatPlotDatasetWarning(
        { kind: 'noNumericValues', topic: '/joint_states', path: 'position[:]' },
        formatMessage,
      ),
    ).toContain('/joint_states');
    expect(
      formatPlotDatasetWarning({ kind: 'nonIndexedSource' }, formatMessage),
    ).toBeTruthy();
  });
});
