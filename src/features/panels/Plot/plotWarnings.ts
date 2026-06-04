import type { IntlShape } from 'react-intl';

export type PlotDatasetWarning =
  | { kind: 'noNumericValues'; topic: string; path: string }
  | { kind: 'missingXPath'; topic: string; path: string }
  | { kind: 'mismatchedXY'; topic: string; xPath: string; yPath: string }
  | { kind: 'nonIndexedSource' }
  | { kind: 'downsampleLimited' };

export function plotWarningKey(warning: PlotDatasetWarning): string {
  switch (warning.kind) {
    case 'noNumericValues':
      return `noNumeric:${warning.topic}:${warning.path}`;
    case 'missingXPath':
      return `missingX:${warning.topic}:${warning.path}`;
    case 'mismatchedXY':
      return `mismatch:${warning.topic}:${warning.xPath}:${warning.yPath}`;
    default:
      return warning.kind;
  }
}

export function formatPlotDatasetWarning(
  warning: PlotDatasetWarning,
  formatMessage: IntlShape['formatMessage'],
): string {
  switch (warning.kind) {
    case 'noNumericValues':
      return formatMessage(
        { id: 'panels.plot.warning.noNumericValues' },
        { topic: warning.topic, path: warning.path },
      );
    case 'missingXPath':
      return formatMessage(
        { id: 'panels.plot.warning.missingXPath' },
        { topic: warning.topic, path: warning.path },
      );
    case 'mismatchedXY':
      return formatMessage(
        { id: 'panels.plot.warning.mismatchedXY' },
        { topic: warning.topic, xPath: warning.xPath, yPath: warning.yPath },
      );
    case 'nonIndexedSource':
      return formatMessage({ id: 'panels.plot.warning.nonIndexedSource' });
    case 'downsampleLimited':
      return formatMessage({ id: 'panels.plot.warning.downsampleLimited' });
  }
}
