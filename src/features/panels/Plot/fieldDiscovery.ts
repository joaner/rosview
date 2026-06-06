export type PlotDiscoveredFieldKind = 'scalar' | 'array';

export interface PlotDiscoveredField {
  path: string;
  label: string;
  kind: PlotDiscoveredFieldKind;
  depth: number;
  recommended: boolean;
}

export interface DiscoverNumericPlotFieldsOptions {
  maxDepth?: number;
  maxFields?: number;
  maxArrayLength?: number;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_FIELDS = 120;
const DEFAULT_MAX_ARRAY_LENGTH = 512;

const SKIPPED_PATHS = new Set([
  'header.stamp',
  'header.frame_id',
]);

const SKIPPED_FIELD_NAMES = new Set([
  'frame_id',
  'encoding',
  'format',
  'data_offset',
]);

const RECOMMENDED_FIELD_NAMES = new Set([
  'x',
  'y',
  'z',
  'w',
  'position',
  'orientation',
  'linear',
  'angular',
  'velocity',
  'effort',
  'temperature',
  'voltage',
  'percentage',
  'range',
  'force',
  'torque',
]);

function isArrayLike(value: unknown): value is ArrayLike<unknown> {
  if (Array.isArray(value)) return true;
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function isNumericScalar(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'bigint' || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 && Number.isFinite(Number(trimmed));
  }
  return false;
}

function pathDepth(path: string): number {
  return path ? path.split('.').length : 0;
}

function isSkippedPath(path: string): boolean {
  if (SKIPPED_PATHS.has(path)) return true;
  const leaf = path.split('.').at(-1) ?? '';
  return SKIPPED_FIELD_NAMES.has(leaf);
}

function recommendationScore(path: string): number {
  const parts = path.toLowerCase().split('.');
  let score = 0;
  for (const part of parts) {
    if (RECOMMENDED_FIELD_NAMES.has(part)) score += 4;
  }
  if (parts.some((part) => part === 'position')) score += 8;
  if (parts.some((part) => part === 'linear' || part === 'angular')) score += 5;
  if (parts.at(-1) === 'x') score += 3;
  if (parts.at(-1) === 'y') score += 2;
  if (parts.at(-1) === 'z') score += 1;
  return score;
}

function isRecommended(path: string): boolean {
  return recommendationScore(path) > 0;
}

function pushField(fields: PlotDiscoveredField[], field: PlotDiscoveredField, maxFields: number) {
  if (fields.length >= maxFields) return;
  fields.push(field);
}

function walkValue(
  value: unknown,
  path: string,
  fields: PlotDiscoveredField[],
  options: Required<DiscoverNumericPlotFieldsOptions>,
): void {
  if (!path || fields.length >= options.maxFields || isSkippedPath(path)) return;

  if (isNumericScalar(value)) {
    pushField(fields, {
      path,
      label: path,
      kind: 'scalar',
      depth: pathDepth(path),
      recommended: isRecommended(path),
    }, options.maxFields);
    return;
  }

  if (isArrayLike(value)) {
    const length = Math.min(value.length, options.maxArrayLength);
    if (length === 0) return;
    let numericCount = 0;
    for (let i = 0; i < length; i++) {
      if (isNumericScalar(value[i])) numericCount++;
    }
    if (numericCount === length) {
      pushField(fields, {
        path: `${path}[:]`,
        label: path,
        kind: 'array',
        depth: pathDepth(path),
        recommended: isRecommended(path),
      }, options.maxFields);
    }
    return;
  }

  if (!value || typeof value !== 'object' || pathDepth(path) >= options.maxDepth) return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (fields.length >= options.maxFields) return;
    const childPath = `${path}.${key}`;
    walkValue(child, childPath, fields, options);
  }
}

export function discoverNumericPlotFields(
  sample: unknown,
  opts: DiscoverNumericPlotFieldsOptions = {},
): PlotDiscoveredField[] {
  if (!sample || typeof sample !== 'object') return [];
  const options: Required<DiscoverNumericPlotFieldsOptions> = {
    maxDepth: opts.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxFields: opts.maxFields ?? DEFAULT_MAX_FIELDS,
    maxArrayLength: opts.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH,
  };

  const fields: PlotDiscoveredField[] = [];
  for (const [key, value] of Object.entries(sample as Record<string, unknown>)) {
    walkValue(value, key, fields, options);
    if (fields.length >= options.maxFields) break;
  }

  return fields.sort((a, b) => {
    const scoreDiff = Number(b.recommended) - Number(a.recommended);
    if (scoreDiff !== 0) return scoreDiff;
    const priorityDiff = recommendationScore(b.path) - recommendationScore(a.path);
    if (priorityDiff !== 0) return priorityDiff;
    return a.path.localeCompare(b.path);
  });
}
