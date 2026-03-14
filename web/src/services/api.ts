// API service layer for the optimization engine dashboard

const API_BASE = '/api';

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
  AdditionalInfo?: Record<string, unknown> | null;
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
  ProviderDefinition,
  ProvidersResponse,
};
