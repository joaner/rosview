import React from 'react';
import type { PanelSettingsContext } from '../framework/types';
import {
  SettingsField,
  SettingsNumber,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
  SettingsText,
  TopicAutocomplete,
} from '../framework/settings';
import {
  createPlotSeries,
  DEFAULT_PLOT_COLORS,
  MAX_PLOT_POINTS,
  MIN_PLOT_POINTS,
  type PlotConfig,
  type PlotSeriesConfig,
  type PlotXAxisMode,
} from './defaults';

function updateSeries(
  config: PlotConfig,
  setConfig: PanelSettingsContext<PlotConfig>['setConfig'],
  id: string,
  patch: Partial<PlotSeriesConfig>,
): void {
  setConfig({
    ...config,
    series: config.series.map((series) => (series.id === id ? { ...series, ...patch } : series)),
  });
}

export function PlotPanelSettings({
  config,
  setConfig,
  topics,
}: PanelSettingsContext<PlotConfig>): React.ReactNode {
  const xAxisOptions = [
    { value: 'timestamp' as const, label: 'Timestamp' },
    { value: 'index' as const, label: 'Index' },
    { value: 'custom' as const, label: 'Custom X/Y' },
    { value: 'currentCustom' as const, label: 'Current custom X/Y' },
  ];
  const timestampOptions = [
    { value: 'headerStamp' as const, label: 'Header stamp' },
    { value: 'receiveTime' as const, label: 'Receive time' },
    { value: 'publishTime' as const, label: 'Publish time' },
  ];

  return (
    <div className="space-y-2">
      <SettingsSection title="Plot">
        <SettingsField label="X axis">
          <SettingsSelect<PlotXAxisMode>
            value={config.xAxisMode}
            options={xAxisOptions}
            onChange={(xAxisMode) => setConfig({ ...config, xAxisMode })}
          />
        </SettingsField>
        <SettingsField label={`Max points (${config.maxPoints.toLocaleString()})`}>
          <SettingsNumber
            value={config.maxPoints}
            min={MIN_PLOT_POINTS}
            max={MAX_PLOT_POINTS}
            step={1000}
            onChange={(maxPoints) => setConfig({ ...config, maxPoints })}
          />
        </SettingsField>
        <SettingsField label="Following window (seconds)" help="0 disables follow mode.">
          <SettingsNumber
            value={config.followingViewWidthSec}
            min={0}
            max={86_400}
            step={1}
            onChange={(followingViewWidthSec) => setConfig({ ...config, followingViewWidthSec })}
          />
        </SettingsField>
        <SettingsField label="Sync X range" orientation="row">
          <SettingsSwitch
            checked={config.syncX}
            onChange={(syncX) => setConfig({ ...config, syncX })}
          />
        </SettingsField>
      </SettingsSection>

      <SettingsSection title="Series">
        {config.series.map((series, index) => (
          <div key={series.id} className="rounded border border-border p-2 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold">Series {index + 1}</span>
              <div className="flex items-center gap-2">
                <SettingsSwitch
                  checked={series.enabled}
                  onChange={(enabled) => updateSeries(config, setConfig, series.id, { enabled })}
                />
                <button
                  type="button"
                  disabled={config.series.length <= 1}
                  onClick={() => setConfig({ ...config, series: config.series.filter((item) => item.id !== series.id) })}
                  className="text-[10px] text-muted-foreground hover:text-destructive disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
            <SettingsField label="Topic">
              <TopicAutocomplete
                value={series.topic}
                topics={topics}
                onChange={(topic) => updateSeries(config, setConfig, series.id, { topic })}
                placeholder="/topic"
              />
            </SettingsField>
            <SettingsField label="Y path" help="Examples: data, data[:], position[:], pose.position.x">
              <SettingsText
                value={series.path}
                onChange={(path) => updateSeries(config, setConfig, series.id, { path })}
                placeholder="data[:]"
              />
            </SettingsField>
            {(config.xAxisMode === 'custom' || config.xAxisMode === 'currentCustom') && (
              <SettingsField label="X path">
                <SettingsText
                  value={series.xAxisPath ?? ''}
                  onChange={(xAxisPath) => updateSeries(config, setConfig, series.id, { xAxisPath })}
                  placeholder="time[:] or x[:]"
                />
              </SettingsField>
            )}
            <SettingsField label="Label">
              <SettingsText
                value={series.label}
                onChange={(label) => updateSeries(config, setConfig, series.id, { label })}
                placeholder="optional"
              />
            </SettingsField>
            <SettingsField label="Timestamp source">
              <SettingsSelect
                value={series.timestampMode}
                options={timestampOptions}
                onChange={(timestampMode) => updateSeries(config, setConfig, series.id, { timestampMode })}
              />
            </SettingsField>
            <SettingsField label="Color">
              <SettingsText
                value={series.color}
                onChange={(color) => updateSeries(config, setConfig, series.id, { color })}
              />
            </SettingsField>
            <SettingsField label="Line" orientation="row">
              <SettingsSwitch
                checked={series.showLine}
                onChange={(showLine) => updateSeries(config, setConfig, series.id, { showLine })}
              />
            </SettingsField>
            <SettingsField label="Line size">
              <SettingsNumber
                value={series.lineSize}
                min={0.5}
                max={8}
                step={0.5}
                onChange={(lineSize) => updateSeries(config, setConfig, series.id, { lineSize })}
              />
            </SettingsField>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setConfig({
              ...config,
              series: [
                ...config.series,
                createPlotSeries({
                  id: `series-${Date.now().toString(36)}`,
                  color: DEFAULT_PLOT_COLORS[config.series.length % DEFAULT_PLOT_COLORS.length],
                }),
              ],
            })
          }
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs hover:bg-accent"
        >
          Add series
        </button>
      </SettingsSection>
    </div>
  );
}
