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
  subscriptionId?: string;
  resourceGroup?: string;
  limit?: number;
  offset?: number;
  includeSuppressed?: boolean;
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

interface EngineStatus {
  status: string;
  version: string;
  adx: { connected: boolean; clusterUri: string; database: string };
  providers: Record<string, { collectors: number; recommenders: number; remediators: number }>;
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

export async function getRecommendations(filters: RecommendationFilters = {}): Promise<PaginatedResponse<Record<string, unknown>>> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return fetchJson(`${API_BASE}/recommendations?${params}`);
}

export async function getRecommendationsSummary(): Promise<Record<string, unknown>[]> {
  return fetchJson(`${API_BASE}/recommendations/summary`);
}

export async function getRecommendation(id: string): Promise<Record<string, unknown>> {
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

export async function getStatus(): Promise<EngineStatus> {
  return fetchJson(`${API_BASE}/status`);
}

export async function getProviders(): Promise<{ providers: Record<string, unknown>[] }> {
  return fetchJson(`${API_BASE}/providers`);
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

export type { PaginatedResponse, RecommendationFilters, Suppression, EngineStatus, OrchestrationStatus };
