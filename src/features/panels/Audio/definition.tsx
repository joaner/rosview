import { lazy } from 'react';
import type { PanelDefinition } from '../framework/types';
import { PanelSuspense } from '../framework/panelSuspense';
import {
  ROS_MSG_AUDIO_COMMON_AUDIO_DATA,
  ROS_MSG_AUDIO_COMMON_AUDIO_DATA_STAMPED,
  ROS_MSG_FOXGLOVE_RAW_AUDIO,
} from '@/shared/ros/rosMessageTypes';
import { defaultAudioConfig, type AudioConfig } from './defaults';
import { parseAudioConfig } from './schema';
import { AudioPanelSettings } from './AudioPanelSettings';

const AudioPanel = lazy(async () => {
  const m = await import('./AudioPanel');
  return { default: m.AudioPanel };
});

export const audioPanelDefinition: PanelDefinition<AudioConfig> = {
  type: 'Audio',
  defaultTitle: 'Audio',
  schemaSupport: {
    supportedSchemas: [
      ROS_MSG_FOXGLOVE_RAW_AUDIO,
      ROS_MSG_AUDIO_COMMON_AUDIO_DATA,
      ROS_MSG_AUDIO_COMMON_AUDIO_DATA_STAMPED,
    ],
  },
  createDefaultConfig: defaultAudioConfig,
  configSchema: { version: 1, parse: parseAudioConfig },
  render: ({ player, panelId, config, setConfig }) => (
    <PanelSuspense>
      <AudioPanel player={player} panelId={panelId} {...config} setConfig={setConfig} />
    </PanelSuspense>
  ),
  renderSettings: (ctx) => <AudioPanelSettings {...ctx} />,
};
