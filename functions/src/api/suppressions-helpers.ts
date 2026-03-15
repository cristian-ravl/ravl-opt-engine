import type { FilterType, Suppression } from '../providers/types.js';

export const VALID_SUPPRESSION_FILTER_TYPES: FilterType[] = ['Dismiss', 'Snooze', 'Exclude'];

export type SuppressionRow = {
  FilterId: string;
  RecommendationSubTypeId: string;
  FilterType: FilterType;
  InstanceId: string | null;
  FilterStartDate: string;
  FilterEndDate: string | null;
  Author: string | null;
  Notes: string | null;
  IsEnabled: boolean;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SuppressionMutationResult =
  | { suppression: Suppression }
  | { error: string };

export function buildCurrentSuppressionsBaseKql(): string {
  return `
    ActiveSuppressions
  `;
}

export function buildActiveSuppressionsSourceKql(): string {
  return `
    ${buildCurrentSuppressionsBaseKql()}
    | where IsEnabled == true
    | where FilterStartDate <= now()
    | where isnull(FilterEndDate) or FilterEndDate > now()
  `;
}

export function buildActiveSuppressionsKql(filters: { subTypeId?: string | null; filterType?: string | null } = {}): string {
  const clauses: string[] = [];

  if (filters.subTypeId) {
    clauses.push(`tostring(RecommendationSubTypeId) == "${escapeKql(filters.subTypeId)}"`);
  }

  if (filters.filterType) {
    clauses.push(`FilterType == "${escapeKql(filters.filterType)}"`);
  }

  const whereClause = clauses.length > 0 ? `| where ${clauses.join(' and ')}` : '';

  return `
    ${buildActiveSuppressionsSourceKql()}
    ${whereClause}
    | order by FilterStartDate desc
  `;
}

export function buildSuppressionByIdKql(filterId: string): string {
  return `
    ${buildCurrentSuppressionsBaseKql()}
    | where tostring(FilterId) == "${escapeKql(filterId)}"
    | take 1
  `;
}

export function toSuppression(row: SuppressionRow): Suppression {
  return {
    filterId: String(row.FilterId),
    recommendationSubTypeId: String(row.RecommendationSubTypeId),
    filterType: row.FilterType,
    instanceId: row.InstanceId ? String(row.InstanceId) : null,
    filterStartDate: String(row.FilterStartDate),
    filterEndDate: row.FilterEndDate ? String(row.FilterEndDate) : null,
    author: row.Author ? String(row.Author) : null,
    notes: row.Notes ? String(row.Notes) : null,
    isEnabled: Boolean(row.IsEnabled),
  };
}

export function createSuppressionRecord(input: Partial<Suppression>, filterId: string, nowIso: string): SuppressionMutationResult {
  const recommendationSubTypeId = normalizeUuid(input.recommendationSubTypeId);
  if (!recommendationSubTypeId) {
    return { error: 'recommendationSubTypeId is required and must be a valid GUID' };
  }

  const filterType = normalizeFilterType(input.filterType);
  if (!filterType) {
    return { error: `filterType must be one of: ${VALID_SUPPRESSION_FILTER_TYPES.join(', ')}` };
  }

  const filterEndDate = normalizeOptionalDate(input.filterEndDate);
  if (filterEndDate === 'invalid') {
    return { error: 'filterEndDate must be a valid ISO date' };
  }

  const validationError = validateFilterWindow(filterType, filterEndDate, nowIso);
  if (validationError) {
    return { error: validationError };
  }

  return {
    suppression: {
      filterId,
      recommendationSubTypeId,
      filterType,
      instanceId: normalizeInstanceId(input.instanceId),
      filterStartDate: nowIso,
      filterEndDate,
      author: normalizeOptionalText(input.author),
      notes: normalizeOptionalText(input.notes),
      isEnabled: input.isEnabled ?? true,
    },
  };
}

export function updateSuppressionRecord(current: Suppression, patch: Partial<Suppression>, nowIso: string): SuppressionMutationResult {
  const nextRecommendationSubTypeId =
    hasOwn(patch, 'recommendationSubTypeId') ? normalizeUuid(patch.recommendationSubTypeId) : current.recommendationSubTypeId;
  if (!nextRecommendationSubTypeId) {
    return { error: 'recommendationSubTypeId must be a valid GUID' };
  }

  const nextFilterType = hasOwn(patch, 'filterType') ? normalizeFilterType(patch.filterType) : current.filterType;
  if (!nextFilterType) {
    return { error: `filterType must be one of: ${VALID_SUPPRESSION_FILTER_TYPES.join(', ')}` };
  }

  const nextFilterEndDate = resolveUpdatedFilterEndDate(current, patch, nextFilterType);
  if (nextFilterEndDate === 'invalid') {
    return { error: 'filterEndDate must be a valid ISO date' };
  }

  const validationError = validateFilterWindow(nextFilterType, nextFilterEndDate, nowIso);
  if (validationError) {
    return { error: validationError };
  }

  return {
    suppression: {
      filterId: current.filterId,
      recommendationSubTypeId: nextRecommendationSubTypeId,
      filterType: nextFilterType,
      instanceId: hasOwn(patch, 'instanceId') ? normalizeInstanceId(patch.instanceId) : current.instanceId,
      filterStartDate: nowIso,
      filterEndDate: nextFilterEndDate,
      author: hasOwn(patch, 'author') ? normalizeOptionalText(patch.author) : current.author,
      notes: hasOwn(patch, 'notes') ? normalizeOptionalText(patch.notes) : current.notes,
      isEnabled: hasOwn(patch, 'isEnabled') ? Boolean(patch.isEnabled) : current.isEnabled,
    },
  };
}

export function disableSuppressionRecord(current: Suppression, nowIso: string): Suppression {
  return {
    ...current,
    filterStartDate: nowIso,
    isEnabled: false,
  };
}

function resolveUpdatedFilterEndDate(current: Suppression, patch: Partial<Suppression>, filterType: FilterType): string | null | 'invalid' {
  if (hasOwn(patch, 'filterEndDate')) {
    return normalizeOptionalDate(patch.filterEndDate);
  }

  if (filterType === 'Snooze') {
    return current.filterType === 'Snooze' ? current.filterEndDate : null;
  }

  return filterType === current.filterType ? current.filterEndDate : null;
}

function validateFilterWindow(filterType: FilterType, filterEndDate: string | null, nowIso: string): string | null {
  const now = Date.parse(nowIso);
  const end = filterEndDate ? Date.parse(filterEndDate) : NaN;

  if (filterEndDate && !Number.isFinite(end)) {
    return 'filterEndDate must be a valid ISO date';
  }

  if (filterEndDate && end <= now) {
    return 'filterEndDate must be in the future';
  }

  if (filterType === 'Snooze' && !filterEndDate) {
    return 'filterEndDate is required for Snooze suppressions';
  }

  return null;
}

function normalizeFilterType(value: unknown): FilterType | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'dismiss':
      return 'Dismiss';
    case 'snooze':
      return 'Snooze';
    case 'exclude':
      return 'Exclude';
    default:
      return null;
  }
}

function normalizeUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return UUID_REGEX.test(normalized) ? normalized.toLowerCase() : null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeOptionalDate(value: unknown): string | null | 'invalid' {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return 'invalid';

  const normalized = value.trim();
  if (!normalized) return null;

  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return 'invalid';
  return new Date(timestamp).toISOString();
}

function normalizeInstanceId(value: unknown): string | null {
  const normalized = normalizeOptionalText(value);
  if (!normalized) return null;
  return normalized.startsWith('/') ? normalized.toLowerCase() : normalized;
}

function hasOwn<T extends object, K extends PropertyKey>(value: T, key: K): value is T & Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function escapeKql(value: string): string {
  return value
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[;\n\r|]/g, '');
}
