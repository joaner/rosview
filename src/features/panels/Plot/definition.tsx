import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import {
  collectExtras,
  FOXGLOVE_PANEL_TITLE_KEY,
  mergeWithExtras,
  type FoxgloveAdapterDecoded,
  type FoxgloveAdapterState,
  type FoxgloveConfig,
  type PanelFoxgloveAdapter,
} from '../framework/foxgloveAdapter';
import { defaultPlotConfig, type PlotConfig, type PlotSeriesConfig } from './defaults';
import { parsePlotConfig } from './schema';
import { PlotPanelSettings } from './PlotPanelSettings';
import { listPlotSchemaEntries } from './schemaRegistry/plotSchemaRegistry';

const PlotPanel = lazy(async () => {
  const m = await import('./PlotPanel');
  return { default: m.PlotPanel };
});

function splitFoxglovePath(value: string): { topic: string; path: string } {
  if (!value.startsWith('/')) return { topic: '', path: value };
  const dot = value.indexOf('.');
  if (dot < 0) return { topic: value, path: 'data' };
  return { topic: value.slice(0, dot), path: value.slice(dot + 1) };
}

function parseFoxgloveSeries(config: FoxgloveConfig): Partial<PlotSeriesConfig>[] {
  if (!Array.isArray(config.paths)) return [];
  return config.paths.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const value = typeof record.value === 'string' ? record.value : '';
    if (!value) return [];
    const split = splitFoxglovePath(value);
    return [{
      id: typeof record.id === 'string' ? record.id : `series-${index + 1}`,
      topic: split.topic,
      path: split.path,
      label: typeof record.label === 'string' ? record.label : '',
      color: typeof record.color === 'string' ? record.color : undefined,
      enabled: typeof record.enabled === 'boolean' ? record.enabled : true,
      timestampMode: record.timestampMethod === 'receiveTime' ? 'receiveTime' : 'headerStamp',
      lineStyle: record.lineStyle === 'dashed' ? 'dashed' : 'solid',
      lineSize: typeof record.lineSize === 'number' ? record.lineSize : 1.5,
    }];
  });
}

const KNOWN_KEYS = [
  'series',
  'paths',
  'xAxisMode',
  'xAxisVal',
  'maxPoints',
  'followingViewWidthSec',
  'syncX',
  'downsampleMode',
] as const;

function fromConfig(config: FoxgloveConfig): FoxgloveAdapterDecoded<PlotConfig> {
  const series = parseFoxgloveSeries(config);
  const xAxisMode = config.xAxisMode ?? config.xAxisVal;
  const title = typeof config[FOXGLOVE_PANEL_TITLE_KEY] === 'string'
    ? config[FOXGLOVE_PANEL_TITLE_KEY]
    : undefined;
  return {
    config: parsePlotConfig({ ...config, ...(series.length > 0 ? { series } : {}), xAxisMode }),
    extras: collectExtras(config, KNOWN_KEYS),
    title,
  };
}

function toConfig(state: FoxgloveAdapterState<PlotConfig>): FoxgloveConfig {
  const known: FoxgloveConfig = {
    ...state.config,
    paths: state.config.series.map((series) => ({
      value: series.topic ? `${series.topic}.${series.path}` : series.path,
      enabled: series.enabled,
      color: series.color,
      label: series.label,
      timestampMethod: series.timestampMode,
      lineStyle: series.lineStyle,
      lineSize: series.lineSize,
    })),
  };
  if (state.title && state.title.length > 0) {
    known[FOXGLOVE_PANEL_TITLE_KEY] = state.title;
  }
  return mergeWithExtras(state.extras, known);
}

export const plotPanelDefinition: PanelDefinition<PlotConfig> = {
  type: 'Plot',
  defaultTitle: 'Plot',
  createDefaultConfig: defaultPlotConfig,
  configSchema: { version: 1, parse: parsePlotConfig },
  render: ({ player, panelId, config, setConfig }) => (
    <PanelSuspense>
      <PlotPanel player={player} panelId={panelId} config={config} setConfig={setConfig} />
    </PanelSuspense>
  ),
  schemaSupport: {
    supportedSchemas: listPlotSchemaEntries().map((entry) => {
      const [pkg, type] = entry.schemaSuffix.split('/');
      return `${pkg}/msg/${type.charAt(0).toUpperCase()}${type.slice(1)}`;
    }),
  },
  renderSettings: (ctx) => <PlotPanelSettings {...ctx} />,
};

export const plotFoxgloveAdapter: PanelFoxgloveAdapter<PlotConfig> = {
  internalType: 'Plot',
  foxgloveTypes: ['Plot'],
  defaultFoxgloveType: 'Plot',
  fromConfig,
  toConfig,
};
