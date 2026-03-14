// Azure ARM REST helper utilities.
// Used by collectors that call management-plane APIs not covered by existing SDK clients.

import { DefaultAzureCredential } from '@azure/identity';
import type { EngineContext } from '../providers/types.js';

const ARM_SCOPE = 'https://management.azure.com/.default';
const ARM_BASE_URL = 'https://management.azure.com';

const credential = new DefaultAzureCredential();

async function getAccessToken(): Promise<string> {
  const token = await credential.getToken(ARM_SCOPE);
  if (!token?.token) {
    throw new Error('Failed to acquire ARM access token');
  }
  return token.token;
}

function toAbsoluteArmUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('https://')) return pathOrUrl;
  if (!pathOrUrl.startsWith('/')) {
    throw new Error(`ARM path must start with '/': ${pathOrUrl}`);
  }
  return `${ARM_BASE_URL}${pathOrUrl}`;
}

export async function armRequest<T = Record<string, unknown>>(pathOrUrl: string, method: 'GET' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const token = await getAccessToken();
  const url = toAbsoluteArmUrl(pathOrUrl);

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ARM request failed (${response.status} ${response.statusText}) for ${url}: ${body}`);
  }

  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function armGet<T = Record<string, unknown>>(pathOrUrl: string): Promise<T> {
  return armRequest<T>(pathOrUrl, 'GET');
}

/**
 * ARM list helper that follows nextLink across paged responses.
 */
export async function armGetAll<T = Record<string, unknown>>(pathOrUrl: string): Promise<T[]> {
  const all: T[] = [];
  let next: string | undefined = pathOrUrl;

  while (next) {
    const page: { value?: T[]; nextLink?: string; nextlink?: string } = await armGet<{ value?: T[]; nextLink?: string; nextlink?: string }>(next);
    if (Array.isArray(page.value)) {
      all.push(...page.value);
    }
    next = page.nextLink ?? page.nextlink;
  }

  return all;
}

/**
 * Resolve target subscription IDs from context. If explicit targets are set,
 * they are returned as-is. Otherwise all enabled subscriptions are discovered.
 */
export async function resolveSubscriptionIds(ctx: EngineContext): Promise<string[]> {
  if (ctx.targetSubscriptions.length > 0) {
    return ctx.targetSubscriptions;
  }

  const subscriptions = await armGetAll<{
    subscriptionId?: string;
    state?: string;
  }>('/subscriptions?api-version=2022-12-01');

  return subscriptions
    .filter((s) => (s.state ?? '').toLowerCase() === 'enabled')
    .map((s) => s.subscriptionId ?? '')
    .filter((id) => id.length > 0);
}

export async function resolveTenantId(): Promise<string> {
  const tenants = await armGetAll<{
    tenantId?: string;
  }>('/tenants?api-version=2022-12-01');

  return tenants[0]?.tenantId ?? '';
}
