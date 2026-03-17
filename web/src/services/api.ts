// API service layer for the optimization engine dashboard

const API_BASE = '/api';
const DEFAULT_DISPLAY_CURRENCY = 'CAD';

interface PaginatedResponse<T> {
  total: number;
  offset: number;
  limit: number;
  data: T[];
}

interface RecommendationFilters {
  cloud?: string;
  category?: string;
  impact?: string;
  subType?: string;
  recommenderId?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  limit?: number;
  offset?: number;
  includeSuppressed?: boolean;
}

interface RecommendationRecord {
  RecommendationId: string;
  GeneratedDate: string;
  RecommenderId?: string;
  RecommenderName?: string;
  Cloud: string;
  Category: string;
  ImpactedArea: string;
  Impact: string;
  RecommendationType: string;
  RecommendationSubType: string;
  RecommendationSubTypeId: string;
  RecommendationDescription: string;
  RecommendationAction: string;
  InstanceId: string;
  InstanceName: string;
  AdditionalInfo?: Record<string, unknown> | string | null;
  ResourceGroup: string;
  SubscriptionId: string;
  SubscriptionName: string;
  TenantId: string;
  FitScore: number;
  Tags?: Record<string, string> | null;
  DetailsUrl: string;
}

interface RecommendationSummaryRow {
  Category: string;
  Impact: string;
  Cloud: string;
  RecommendationSubType: string;
  RecommenderId?: string;
  RecommenderName?: string;
  Count: number;
}

interface Suppression {
  filterId: string;
  recommendationSubTypeId: string;
  filterType: 'Dismiss' | 'Snooze' | 'Exclude';
  instanceId: string | null;
  filterStartDate: string;
  filterEndDate: string | null;
  author: string | null;
  notes: string | null;
  isEnabled: boolean;
}

interface CollectorRunStatus {
  id: string;
  name: string;
  cloud: string;
  targetSuffix: string;
  collectedType: string | null;
  lastSuccessfulCollection: string | null;
  lastProcessedMarker: string | null;
}

interface EngineStatus {
  status: string;
  version: string;
  adx: { connected: boolean; clusterUri: string; database: string };
  providers: Record<string, { collectors: number; recommenders: number; remediators: number }>;
  collectorRuns: CollectorRunStatus[];
  lastCollectionRun: string | null;
  lastRecommendationRun: string | null;
  tableCounts: Record<string, number>;
}

type OrchestrationRuntimeStatus = 'Running' | 'Pending' | 'ContinuedAsNew' | 'Completed' | 'Failed' | 'Terminated' | 'Suspended';

interface OrchestrationStatus {
  instanceId: string;
  name?: string;
  runtimeStatus: OrchestrationRuntimeStatus;
  createdTime?: string;
  lastUpdatedTime?: string;
  output?: unknown;
  input?: unknown;
  customStatus?: unknown;
}

interface ProviderCollectorDefinition {
  id: string;
  name: string;
  targetSuffix: string;
}

interface ProviderRecommenderDefinition {
  id: string;
  name: string;
  subTypes?: Array<Record<string, unknown>>;
}

interface ProviderRemediatorDefinition {
  id: string;
  name: string;
  handlesSubTypeIds?: string[];
}

interface ProviderDefinition {
  cloud: string;
  collectors?: ProviderCollectorDefinition[];
  recommenders?: ProviderRecommenderDefinition[];
  remediators?: ProviderRemediatorDefinition[];
}

interface ProvidersResponse {
  providers: ProviderDefinition[];
}

type DataExplorerSourceKind = 'table' | 'materializedView';

interface DataExplorerTableDefinition {
  name: string;
  kind: DataExplorerSourceKind;
  group: 'Resources' | 'Cost' | 'Identity' | 'Recommendations' | 'Operations' | 'Views';
  defaultSortColumn?: string;
}

interface DataExplorerColumnDefinition {
  name: string;
  type: string;
}

interface DataExplorerQueryOptions {
  limit?: number;
  offset?: number;
  search?: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

interface DataExplorerTableResponse {
  table: DataExplorerTableDefinition;
  total: number;
  offset: number;
  limit: number;
  search: string;
  sortBy: string | null;
  sortDirection: 'asc' | 'desc';
  columns: DataExplorerColumnDefinition[];
  data: Array<Record<string, unknown>>;
}

interface DataExplorerTablesResponse {
  tables: DataExplorerTableDefinition[];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

function parseAdditionalInfo(value: RecommendationRecord['AdditionalInfo']): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function normalizeUsageUnit(unit: string | null): string | null {
  if (!unit) {
    return null;
  }

  return unit.replace(/^1\s+/, '').trim();
}

export async function getRecommendations(filters: RecommendationFilters = {}): Promise<PaginatedResponse<RecommendationRecord>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return fetchJson(`${API_BASE}/recommendations?${params}`);
}

export async function getRecommendationsSummary(): Promise<RecommendationSummaryRow[]> {
  return fetchJson(`${API_BASE}/recommendations/summary`);
}

export async function getRecommendation(id: string): Promise<RecommendationRecord> {
  return fetchJson(`${API_BASE}/recommendations/details/${encodeURIComponent(id)}`);
}

export async function getSuppressions(subTypeId?: string, filterType?: string): Promise<Suppression[]> {
  const params = new URLSearchParams();
  if (subTypeId) params.set('subTypeId', subTypeId);
  if (filterType) params.set('filterType', filterType);
  return fetchJson(`${API_BASE}/suppressions?${params}`);
}

export async function createSuppression(data: Partial<Suppression>): Promise<Suppression> {
  return fetchJson(`${API_BASE}/suppressions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateSuppression(filterId: string, data: Partial<Suppression>): Promise<Suppression> {
  return fetchJson(`${API_BASE}/suppressions/${encodeURIComponent(filterId)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteSuppression(filterId: string): Promise<void> {
  return fetchJson(`${API_BASE}/suppressions/${encodeURIComponent(filterId)}`, {
    method: 'DELETE',
  });
}

export interface CostSummaryRow {
  Category: string;
  Currency: string;
  Count: number;
  TotalMonthlySavings: number;
  TotalAnnualSavings: number;
  TotalCost30d: number;
}

export async function getCostSummary(): Promise<CostSummaryRow[]> {
  return fetchJson(`${API_BASE}/recommendations/cost-summary`);
}

export async function getStatus(): Promise<EngineStatus> {
  return fetchJson(`${API_BASE}/status`);
}

export async function getProviders(): Promise<ProvidersResponse> {
  return fetchJson(`${API_BASE}/providers`);
}

export async function getDataExplorerTables(): Promise<DataExplorerTablesResponse> {
  return fetchJson(`${API_BASE}/data-explorer/tables`);
}

export async function getDataExplorerTableData(tableName: string, options: DataExplorerQueryOptions = {}): Promise<DataExplorerTableResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return fetchJson(`${API_BASE}/data-explorer/tables/${encodeURIComponent(tableName)}?${params}`);
}

function getAdditionalInfoNumber(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>, keys: string[]): number {
  const additionalInfo = parseAdditionalInfo(recommendation.AdditionalInfo);
  for (const key of keys) {
    const value = additionalInfo?.[key];
    const normalizedValue = typeof value === 'number' ? value : Number(value ?? NaN);
    if (Number.isFinite(normalizedValue)) {
      return normalizedValue;
    }
  }

  return 0;
}

export function getRecommendationCost30d(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>): number {
  return getAdditionalInfoNumber(recommendation, ['cost30d', 'diskCost30d', 'computeCost30d', 'monthlyCost']);
}

export function getRecommendationMonthlySavings(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>): number {
  const directMonthlySavings = getAdditionalInfoNumber(recommendation, ['savingsAmount']);
  if (directMonthlySavings > 0) {
    return directMonthlySavings;
  }

  const annualSavings = getAdditionalInfoNumber(recommendation, ['annualSavingsAmount', 'annualSavings']);
  return annualSavings > 0 ? annualSavings / 12 : 0;
}

export function getRecommendationAnnualSavings(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>): number {
  const annualSavings = getAdditionalInfoNumber(recommendation, ['annualSavingsAmount', 'annualSavings']);
  if (annualSavings > 0) {
    return annualSavings;
  }

  const monthlySavings = getRecommendationMonthlySavings(recommendation);
  return monthlySavings > 0 ? monthlySavings * 12 : 0;
}

export function getRecommendationCurrency(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>): string {
  void recommendation;
  return DEFAULT_DISPLAY_CURRENCY;
}

export function getRecommendationUsageDisplay(recommendation: Pick<RecommendationRecord, 'AdditionalInfo'>): string {
  const additionalInfo = parseAdditionalInfo(recommendation.AdditionalInfo);
  const quantity = getAdditionalInfoNumber(recommendation, ['usageQuantity30d', 'last30DaysQuantity', 'quantity30d']);

  if (quantity <= 0) {
    return '—';
  }

  const unit = typeof additionalInfo?.usageUnitOfMeasure === 'string' && additionalInfo.usageUnitOfMeasure.trim()
    ? normalizeUsageUnit(additionalInfo.usageUnitOfMeasure.trim())
    : null;
  const meterCount = getAdditionalInfoNumber(recommendation, ['usageMeterCount']);
  const unitCount = getAdditionalInfoNumber(recommendation, ['usageUnitOfMeasureCount']);
  const formattedQuantity = quantity.toLocaleString(undefined, { maximumFractionDigits: quantity >= 100 ? 0 : 2 });

  if (unit && unitCount <= 1) {
    return /^\d/.test(unit) ? `${formattedQuantity} × ${unit}` : `${formattedQuantity} ${unit}`;
  }

  if (meterCount > 1) {
    return `${formattedQuantity} across ${meterCount.toLocaleString()} meters`;
  }

  return formattedQuantity;
}

export function getRecommendationGeneratorLabel(recommendation: Pick<RecommendationRecord, 'RecommenderId' | 'RecommenderName'>): string {
  return recommendation.RecommenderName?.trim() || recommendation.RecommenderId?.trim() || 'Unknown recommender';
}

export function getRecommendationResourceUrl(recommendation: Pick<RecommendationRecord, 'Cloud' | 'DetailsUrl' | 'InstanceId' | 'TenantId'>): string {
  const detailsUrl = recommendation.DetailsUrl?.trim();
  if (detailsUrl?.startsWith('https://') || detailsUrl?.startsWith('http://')) {
    return detailsUrl;
  }

  const instanceId = recommendation.InstanceId?.trim();
  if (recommendation.Cloud === 'Azure' && instanceId?.startsWith('/')) {
    const tenantId = recommendation.TenantId?.trim();
    return tenantId ? `https://portal.azure.com/#@${tenantId}/resource${instanceId}/overview` : `https://portal.azure.com/#resource${instanceId}/overview`;
  }

  return '';
}

export async function startCollection(): Promise<Record<string, unknown>> {
  return fetchJson(`${API_BASE}/orchestrators/collection`, { method: 'POST' });
}

export async function startRecommendation(): Promise<Record<string, unknown>> {
  return fetchJson(`${API_BASE}/orchestrators/recommendation`, { method: 'POST' });
}

export async function getOrchestrationStatus(instanceId: string): Promise<OrchestrationStatus> {
  return fetchJson(`${API_BASE}/status/orchestrations/${encodeURIComponent(instanceId)}`);
}

export type {
  PaginatedResponse,
  RecommendationFilters,
  RecommendationRecord,
  RecommendationSummaryRow,
  Suppression,
  CollectorRunStatus,
  EngineStatus,
  OrchestrationStatus,
  DataExplorerTableDefinition,
  DataExplorerColumnDefinition,
  DataExplorerQueryOptions,
  DataExplorerTableResponse,
  DataExplorerTablesResponse,
  ProviderDefinition,
  ProvidersResponse,
};
