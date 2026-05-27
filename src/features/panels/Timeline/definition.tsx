import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import { defaultTimelineConfig, type TimelineConfig } from './defaults';
import { parseTimelineConfig } from './schema';
import { TimelinePanelSettings } from './TimelinePanelSettings';

const TimelinePanel = lazy(async () => {
  const m = await import('./TimelinePanel');
  return { default: m.TimelinePanel };
});

export const timelinePanelDefinition: PanelDefinition<TimelineConfig> = {
  type: 'Timeline',
  defaultTitle: 'Timeline',
  createDefaultConfig: defaultTimelineConfig,
  configSchema: { version: 1, parse: parseTimelineConfig },
  render: ({ player, config }) => (
    <PanelSuspense>
      <TimelinePanel player={player} config={config} />
    </PanelSuspense>
  ),
  renderSettings: (ctx) => <TimelinePanelSettings {...ctx} />,
};
