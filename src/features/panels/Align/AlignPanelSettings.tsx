import { useMemo } from 'react';
import { useIntl } from 'react-intl';
import {
  SettingsField,
  SettingsNumber,
  SettingsSection,
  SettingsSelect,
  SettingsTextArea,
} from '../framework/settings';
import type { AlignConfig } from './defaults';
import type { AlignPlotTimeMode } from './core/alignTimeUtils';

export function AlignPanelSettings({
  config,
  setConfig,
}: {
  config: AlignConfig;
  setConfig: (next: AlignConfig | ((prev: AlignConfig) => AlignConfig)) => void;
}) {
  const { formatMessage } = useIntl();

  const timeModeOptions = useMemo(
    () =>
      [
        { value: 'receiveTime' as const, label: formatMessage({ id: 'panels.align.timeMode.receiveTime' }) },
        { value: 'headerStamp' as const, label: formatMessage({ id: 'panels.align.timeMode.headerStamp' }) },
      ] satisfies { value: AlignPlotTimeMode; label: string }[],
    [formatMessage],
  );

  return (
    <div className="space-y-2">
      <SettingsSection
        title={formatMessage({ id: 'panels.align.section.main.title' })}
        description={formatMessage({ id: 'panels.align.section.main.description' })}
      >
        <SettingsField label={formatMessage({ id: 'panels.align.field.hint.label' })} orientation="row">
          <span className="text-[10px] text-muted-foreground leading-snug">
            {formatMessage({ id: 'panels.align.field.hint.body' })}
          </span>
        </SettingsField>
      </SettingsSection>
      <SettingsSection
        title={formatMessage({ id: 'panels.align.section.topics.title' })}
        description={formatMessage({ id: 'panels.align.section.topics.description' })}
      >
        <SettingsField
          label={formatMessage({ id: 'panels.align.field.topicList.label' })}
          help={formatMessage({ id: 'panels.align.field.topicList.help' })}
        >
          <SettingsTextArea
            name="align-topics"
            rows={5}
            value={config.topics.join('\n')}
            placeholder={'/camera/left/color/image_raw\n/camera/right/color/compressed'}
            onChange={(text) => {
              const topics = text
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
              setConfig({ ...config, topics });
            }}
          />
        </SettingsField>
      </SettingsSection>
      <SettingsSection title={formatMessage({ id: 'panels.align.section.timeline.title' })}>
        <SettingsField label={formatMessage({ id: 'panels.align.field.horizontalTime.label' })}>
          <SettingsSelect<AlignPlotTimeMode>
            value={config.timeMode}
            options={timeModeOptions}
            onChange={(timeMode) => setConfig({ ...config, timeMode })}
          />
        </SettingsField>
        <SettingsField
          label={formatMessage({ id: 'panels.align.field.windowHalf.label' })}
          help={formatMessage({ id: 'panels.align.field.windowHalf.help' })}
        >
          <SettingsNumber
            name="align-window-half-ms"
            value={config.windowHalfMs}
            min={50}
            max={30_000}
            step={50}
            onChange={(windowHalfMs) => setConfig({ ...config, windowHalfMs })}
          />
        </SettingsField>
      </SettingsSection>
      <SettingsSection title={formatMessage({ id: 'panels.align.section.scatter.title' })}>
        <SettingsField label={formatMessage({ id: 'panels.align.field.dotRadius.label' })}>
          <SettingsNumber
            name="align-dot-radius"
            value={config.dotRadius}
            min={0.5}
            max={8}
            step={0.5}
            onChange={(dotRadius) => setConfig({ ...config, dotRadius })}
          />
        </SettingsField>
        <SettingsField label={formatMessage({ id: 'panels.align.field.dotOpacity.label' })}>
          <SettingsNumber
            name="align-dot-opacity"
            value={config.dotOpacity}
            min={0.05}
            max={1}
            step={0.05}
            onChange={(dotOpacity) => setConfig({ ...config, dotOpacity })}
          />
        </SettingsField>
      </SettingsSection>
    </div>
  );
}
