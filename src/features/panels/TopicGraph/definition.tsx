import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import { defaultTopicGraphConfig, type TopicGraphConfig } from './defaults';
import { parseTopicGraphConfig } from './schema';
import { TopicGraphPanelSettings } from './TopicGraphPanelSettings';

const TopicGraphPanel = lazy(async () => {
  const m = await import('./TopicGraphPanel');
  return { default: m.TopicGraphPanel };
});

export const topicGraphPanelDefinition: PanelDefinition<TopicGraphConfig> = {
  type: 'TopicGraph',
  defaultTitle: 'Topic Graph',
  createDefaultConfig: defaultTopicGraphConfig,
  configSchema: { version: 1, parse: parseTopicGraphConfig },
  render: ({ player, panelId, config }) => (
    <PanelSuspense>
      <TopicGraphPanel
        player={player}
        panelId={panelId}
        rankDir={config.rankDir}
        showControls={config.showControls}
      />
    </PanelSuspense>
  ),
  renderSettings: (ctx) => <TopicGraphPanelSettings {...ctx} />,
};
