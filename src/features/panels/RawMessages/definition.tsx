import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import { defaultRawMessagesConfig, type RawMessagesConfig } from './defaults';
import { parseRawMessagesConfig } from './schema';
import { RawMessagesPanelSettings } from './RawMessagesPanelSettings';

const RawMessagesPanel = lazy(async () => {
  const m = await import('./RawMessagesPanel');
  return { default: m.RawMessagesPanel };
});

export const rawMessagesPanelDefinition: PanelDefinition<RawMessagesConfig> = {
  type: 'RawMessages',
  defaultTitle: 'Raw',
  createDefaultConfig: defaultRawMessagesConfig,
  configSchema: { version: 2, parse: parseRawMessagesConfig },
  render: ({ player, panelId, config, setConfig }) => (
    <PanelSuspense>
      <RawMessagesPanel
        player={player}
        panelId={panelId}
        topic={config.topic}
        uiRefreshHz={config.uiRefreshHz}
        pauseUpdates={config.pauseUpdates}
        latestOnly={config.latestOnly}
        maxExpandedDepth={config.maxExpandedDepth}
        maxRows={config.maxRows}
        maxBinaryPreviewBytes={config.maxBinaryPreviewBytes}
        binaryCopyFormat={config.binaryCopyFormat}
        setConfig={setConfig}
      />
    </PanelSuspense>
  ),
  renderSettings: (ctx) => <RawMessagesPanelSettings {...ctx} />,
};
