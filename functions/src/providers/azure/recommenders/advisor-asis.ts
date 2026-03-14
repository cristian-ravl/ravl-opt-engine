// Recommender: Advisor as-is — imports non-cost Advisor guidance as direct recommendations.

import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender, normalizeRecommendationCategory, normalizeRecommendationImpact, uuidv4 } from './base-recommender.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'AdvisorAsIs',
  subTypeId: 'f3a46ab9-95d4-4759-90b2-7f4f1e0c5b39',
  category: 'OperationalExcellence',
  impact: 'Medium',
  impactedArea: 'Microsoft.Advisor/recommendations',
  description: 'Advisor recommendation imported as-is',
  action: 'Review Advisor recommendation details and apply the suggested action',
};

type AdvisorRow = {
  InstanceId: string;
  InstanceName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  Category: string;
  Impact: string;
  ImpactedArea: string;
  RecommendationSubTypeId: string;
  RecommendationDescription: string;
  RecommendationAction: string;
  AdditionalInfo: Record<string, unknown>;
  DetailsUrl: string;
};

export class AdvisorAsIsRecommender extends AzureRecommender {
  readonly id = 'advisor-asis';
  readonly name = 'Advisor as-is recommendations';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const lookbackDays = Number(process.env.OE_ADVISOR_LOOKBACK_DAYS ?? '7');

    const kql = `
      AdvisorRecommendations
      | where Timestamp > ago(${lookbackDays}d)
      | where Category !~ 'Cost'
      | summarize arg_max(Timestamp, *) by InstanceId, RecommendationSubTypeId
      | project InstanceId, InstanceName, ResourceGroup, SubscriptionId, TenantId, Category, Impact, ImpactedArea,
                RecommendationSubTypeId, RecommendationDescription, RecommendationAction, AdditionalInfo, DetailsUrl
    `;

    const rows = await this.queryAdx<AdvisorRow>(ctx, kql);

    const recommendations: Recommendation[] = rows.map((row) => ({
      recommendationId: uuidv4(),
      generatedDate: new Date().toISOString(),
      cloud: 'Azure',
      category: normalizeRecommendationCategory(row.Category, 'OperationalExcellence'),
      impactedArea: row.ImpactedArea || 'Microsoft.Advisor/recommendations',
      impact: normalizeRecommendationImpact(row.Impact, 'Medium'),
      recommendationType: 'BestPractices',
      recommendationSubType: `Advisor${row.Category || 'AsIs'}`,
      recommendationSubTypeId: row.RecommendationSubTypeId || SUB_TYPE.subTypeId,
      recommendationDescription: row.RecommendationDescription || SUB_TYPE.description,
      recommendationAction: row.RecommendationAction || SUB_TYPE.action,
      instanceId: row.InstanceId,
      instanceName: row.InstanceName,
      resourceGroup: row.ResourceGroup,
      subscriptionId: row.SubscriptionId,
      subscriptionName: '',
      tenantId: row.TenantId,
      fitScore: 5,
      tags: {},
      detailsUrl: row.DetailsUrl || '',
      additionalInfo: row.AdditionalInfo || {},
    }));

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
