// Base class for Azure recommenders that query ADX for collected data
// and generate optimization Recommendations.

import type { CloudProvider, EngineContext, IRecommender, Recommendation, RecommenderSubType } from '../../types.js';
import { query } from '../../../utils/adx-client.js';
import { ingest } from '../../../utils/adx-client.js';
import { v4 as uuidv4 } from 'uuid';

export { uuidv4 };

const VALID_RECOMMENDATION_CATEGORIES = new Set<Recommendation['category']>([
  'Cost',
  'HighAvailability',
  'Performance',
  'Security',
  'Governance',
  'OperationalExcellence',
]);

const VALID_RECOMMENDATION_IMPACTS = new Set<Recommendation['impact']>(['High', 'Medium', 'Low']);

type SubscriptionLookupRow = {
  SubscriptionId: string;
  SubscriptionName: string;
};

export abstract class AzureRecommender implements IRecommender {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly subTypes: RecommenderSubType[];
  readonly cloud: CloudProvider = 'Azure';

  abstract generateRecommendations(ctx: EngineContext): Promise<Recommendation[]>;

  /** Query ADX for collected data using KQL */
  protected async queryAdx<T = Record<string, unknown>>(ctx: EngineContext, kql: string): Promise<T[]> {
    return query<T>(ctx, kql);
  }

  /** Persist generated recommendations to ADX */
  protected async persistRecommendations(ctx: EngineContext, recommendations: Recommendation[]): Promise<void> {
    if (recommendations.length === 0) return;
    await this.enrichRecommendations(ctx, recommendations);
    await ingest(ctx, 'Recommendations', recommendations, 'Recommendations_mapping');
  }

  /** Create a recommendation from a subtype and instance data */
  protected createRecommendation(
    subType: RecommenderSubType,
    instance: {
      instanceId: string;
      instanceName: string;
      resourceGroup: string;
      subscriptionId: string;
      subscriptionName?: string;
      tenantId: string;
      tags?: Record<string, string>;
      additionalInfo?: Record<string, unknown>;
      fitScore?: number;
      detailsUrl?: string;
    },
  ): Recommendation {
    return {
      recommendationId: uuidv4(),
      generatedDate: new Date().toISOString(),
      cloud: 'Azure',
      category: subType.category,
      impactedArea: subType.impactedArea,
      impact: subType.impact,
      recommendationType: 'All',
      recommendationSubType: subType.subType,
      recommendationSubTypeId: subType.subTypeId,
      recommendationDescription: subType.description,
      recommendationAction: subType.action,
      instanceId: instance.instanceId,
      instanceName: instance.instanceName,
      resourceGroup: instance.resourceGroup,
      subscriptionId: instance.subscriptionId,
      subscriptionName: instance.subscriptionName ?? '',
      tenantId: instance.tenantId,
      fitScore: instance.fitScore ?? 5,
      tags: instance.tags ?? {},
      detailsUrl: instance.detailsUrl ?? '',
      additionalInfo: instance.additionalInfo ?? {},
    };
  }

  private async enrichRecommendations(ctx: EngineContext, recommendations: Recommendation[]): Promise<void> {
    const subscriptionNames = await this.loadSubscriptionNames(ctx);

    for (const recommendation of recommendations) {
      if (!recommendation.subscriptionName && recommendation.subscriptionId) {
        recommendation.subscriptionName = subscriptionNames.get(recommendation.subscriptionId.toLowerCase()) ?? '';
      }

      if (!recommendation.detailsUrl && typeof recommendation.instanceId === 'string' && recommendation.instanceId.startsWith('/')) {
        recommendation.detailsUrl = this.buildPortalResourceUrl(recommendation.tenantId, recommendation.instanceId);
      }
    }
  }

  private async loadSubscriptionNames(ctx: EngineContext): Promise<Map<string, string>> {
    try {
      const rows = await this.queryAdx<SubscriptionLookupRow>(
        ctx,
        `
          ResourceContainers
          | where ContainerType =~ 'Subscription'
          | summarize arg_max(Timestamp, *) by SubscriptionId
          | project SubscriptionId, SubscriptionName = ContainerName
        `,
      );

      return new Map(rows.map((row) => [row.SubscriptionId.toLowerCase(), row.SubscriptionName]));
    } catch {
      return new Map();
    }
  }

  private buildPortalResourceUrl(tenantId: string, instanceId: string): string {
    return `https://portal.azure.com/#@${tenantId}/resource${instanceId}/overview`;
  }
}

export function normalizeRecommendationCategory(
  value: string | null | undefined,
  fallback: Recommendation['category'] = 'OperationalExcellence',
): Recommendation['category'] {
  return value && VALID_RECOMMENDATION_CATEGORIES.has(value as Recommendation['category'])
    ? (value as Recommendation['category'])
    : fallback;
}

export function normalizeRecommendationImpact(
  value: string | null | undefined,
  fallback: Recommendation['impact'] = 'Medium',
): Recommendation['impact'] {
  return value && VALID_RECOMMENDATION_IMPACTS.has(value as Recommendation['impact'])
    ? (value as Recommendation['impact'])
    : fallback;
}
