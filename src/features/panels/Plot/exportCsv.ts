import type { Player } from '@/core/types/player';
import type { Time } from '@/core/types/ros';
import { buildPlotDataset, type PlotDataset } from './datasets';
import type { PlotConfig } from './defaults';
import { readPlotRange } from './rangeReader';

function csvEscape(value: unknown): string {
  const text =
    value == null
      ? ''
      : typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function downloadPlotCsv(dataset: PlotDataset): void {
  const xValues = dataset.data[0] as number[];
  const rows: string[] = [
    ['x', ...dataset.series.map((series) => series.label)].map(csvEscape).join(','),
  ];
  for (let i = 0; i < xValues.length; i++) {
    rows.push(
      [
        xValues[i],
        ...dataset.series.map((_, seriesIndex) => {
          const values = dataset.data[seriesIndex + 1] as Array<number | null>;
          return values[i] ?? '';
        }),
      ].map(csvEscape).join(','),
    );
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'plot.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function exportPlotCsvFromConfig(args: {
  player: Player;
  config: PlotConfig;
  startTime: Time;
  endTime: Time;
  forceDownsample?: boolean;
}): Promise<void> {
  const { player, config, startTime, endTime, forceDownsample } = args;
  if (!player.getMessagesInTimeRange) return;

  const topics = Array.from(
    new Set(config.series.filter((s) => s.enabled && s.topic).map((s) => s.topic)),
  );
  const messages = await readPlotRange({
    player,
    start: startTime,
    end: endTime,
    topics,
    maxMessages: forceDownsample ? config.nonIndexedMaxMessages : undefined,
  });
  const dataset = buildPlotDataset(messages, config, {
    forceDownsample: forceDownsample === true,
    logStart: startTime,
    logEnd: endTime,
  });
  downloadPlotCsv(dataset);
}
