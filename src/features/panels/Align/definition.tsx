import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import { defaultAlignConfig, type AlignConfig } from './defaults';
import { parseAlignConfig } from './schema';
import { AlignPanelSettings } from './AlignPanelSettings';

const AlignPanel = lazy(async () => {
  const m = await import('./AlignPanel');
  return { default: m.AlignPanel };
});

export const alignPanelDefinition: PanelDefinition<AlignConfig> = {
  type: 'Align',
  defaultTitle: 'Align',
  createDefaultConfig: defaultAlignConfig,
  configSchema: { version: 1, parse: parseAlignConfig },
  render: ({ player, panelId, config, setConfig }) => (
    <PanelSuspense>
      <AlignPanel player={player} panelId={panelId} setConfig={setConfig} {...config} />
    </PanelSuspense>
  ),
  renderSettings: ({ config, setConfig }) => <AlignPanelSettings config={config} setConfig={setConfig} />,
};
