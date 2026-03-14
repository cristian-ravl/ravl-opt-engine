// Collector: Azure Advisor recommendations exported to ADX for downstream recommendation logic.

import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGetAll, resolveSubscriptionIds } from '../../../utils/arm-client.js';
import { ingestCollectorRows } from './ingestion.js';

interface AdvisorApiRecord {
  id?: string;
  properties?: {
    category?: string;
    impact?: string;
    impactedValue?: string;
    impactedField?: string;
    recommendationTypeId?: string;
    shortDescription?: {
      problem?: string;
      solution?: string;
    };
    extendedProperties?: Record<string, unknown>;
    lastUpdated?: string;
    resourceMetadata?: {
      resourceId?: string;
      resourceName?: string;
      resourceType?: string;
      resourceGroupName?: string;
      subscriptionId?: string;
    };
  };
}

function normalizeLower(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function looksLikeResourceId(value: string): boolean {
  return value.startsWith('/subscriptions/');
}

function toNormalizedResourceId(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    const normalized = normalizeLower(candidate);
    if (looksLikeResourceId(normalized)) {
      return normalized;
    }
  }

  return '';
}

function deriveResourceName(instanceId: string, fallbackName: unknown, impactedValue: unknown): string {
  const normalizedFallback = normalizeLower(fallbackName);
  if (normalizedFallback) return normalizedFallback;

  const normalizedImpactedValue = normalizeLower(impactedValue);
  if (normalizedImpactedValue && !looksLikeResourceId(normalizedImpactedValue)) {
    return normalizedImpactedValue;
  }

  const segments = instanceId.split('/').filter(Boolean);
  return segments.at(-1) ?? '';
}

function deriveResourceGroup(instanceId: string, fallbackGroup: unknown): string {
  const normalizedFallback = normalizeLower(fallbackGroup);
  if (normalizedFallback) return normalizedFallback;

  const segments = instanceId.split('/').filter(Boolean);
  const resourceGroupsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'resourcegroups');
  return resourceGroupsIndex >= 0 ? normalizeLower(segments[resourceGroupsIndex + 1]) : '';
}

function deriveSubscriptionId(instanceId: string, fallbackSubscriptionId: unknown): string {
  const normalizedFallback = normalizeLower(fallbackSubscriptionId);
  if (normalizedFallback) return normalizedFallback;

  const segments = instanceId.split('/').filter(Boolean);
  const subscriptionsIndex = segments.findIndex((segment) => segment.toLowerCase() === 'subscriptions');
  return subscriptionsIndex >= 0 ? normalizeLower(segments[subscriptionsIndex + 1]) : '';
}

function deriveImpactedArea(instanceId: string, fallbackType: unknown, impactedField: unknown): string {
  const fallback = String(fallbackType ?? '').trim();
  if (fallback) return fallback;

  const fallbackImpactedField = String(impactedField ?? '').trim();
  if (fallbackImpactedField) return fallbackImpactedField;

  const segments = instanceId.split('/').filter(Boolean);
  const providersIndex = segments.findIndex((segment) => segment.toLowerCase() === 'providers');
  if (providersIndex < 0 || providersIndex + 2 >= segments.length) {
    return '';
  }

  const resourceTypes: string[] = [segments[providersIndex + 1]];
  for (let i = providersIndex + 2; i < segments.length; i += 2) {
    resourceTypes.push(segments[i]);
  }

  return resourceTypes.join('/');
}

function toPortalUrl(instanceId: string): string {
  if (!instanceId) return '';
  return `https://portal.azure.com/#resource${instanceId}/overview`;
}

export class AdvisorRecommendationsCollector implements ICollector {
  readonly id = 'azure-advisor';
  readonly name = 'Azure Advisor recommendations';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'advisorexports';

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const tenantId = process.env.OE_TENANT_ID ?? '';
    const subscriptions = await resolveSubscriptionIds(ctx);
    const rows: Record<string, unknown>[] = [];

    for (const subscriptionId of subscriptions) {
      const path = `/subscriptions/${subscriptionId}/providers/Microsoft.Advisor/recommendations?api-version=2023-01-01`;
      const recs = await armGetAll<AdvisorApiRecord>(path);

      for (const rec of recs) {
        const props = rec.properties ?? {};
        const metadata = props.resourceMetadata ?? {};
        const instanceId = toNormalizedResourceId(metadata.resourceId, props.impactedValue);
        const instanceName = deriveResourceName(instanceId, metadata.resourceName, props.impactedValue);
        const category = String(props.category ?? 'OperationalExcellence');
        const impact = String(props.impact ?? 'Medium');
        const recommendationSubTypeId = String(props.recommendationTypeId ?? rec.id ?? '');
        const resolvedSubscriptionId = deriveSubscriptionId(instanceId, metadata.subscriptionId ?? subscriptionId);
        const resourceGroup = deriveResourceGroup(instanceId, metadata.resourceGroupName);

        rows.push({
          timestamp,
          cloud: 'Azure',
          tenantId,
          subscriptionId: resolvedSubscriptionId,
          resourceGroup,
          instanceId,
          instanceName,
          category,
          impact,
          impactedArea: deriveImpactedArea(instanceId, metadata.resourceType, props.impactedField),
          recommendationSubTypeId,
          recommendationDescription: String(props.shortDescription?.problem ?? ''),
          recommendationAction: String(props.shortDescription?.solution ?? ''),
          additionalInfo: props.extendedProperties ?? {},
          detailsUrl: toPortalUrl(instanceId),
          statusDate: String(props.lastUpdated ?? timestamp),
        });
      }
    }

    if (rows.length === 0) return 0;

    const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}.ndjson`;
    await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
    await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
    return rows.length;
  }
}
