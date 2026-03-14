// Recommender: VM optimization recommendations backed by Advisor cost data.

import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender, normalizeRecommendationImpact, uuidv4 } from './base-recommender.js';

type AdvisorCostResourceRow = {
  InstanceId: string;
  InstanceName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  Impact: string;
  ImpactedArea: string;
  RecommendationSubTypeId: string;
  RecommendationDescription: string;
  RecommendationAction: string;
  AdditionalInfo: Record<string, unknown>;
  DetailsUrl: string;
  Cost30d: number;
  Currency: string;
};

abstract class AdvisorResourceOptimizationBase extends AzureRecommender {
  protected abstract readonly impactedAreaFilter: string;
  protected abstract readonly fallbackSubType: RecommenderSubType;

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const lookbackDays = Number(process.env.OE_ADVISOR_LOOKBACK_DAYS ?? '7');
    const filter = this.impactedAreaFilter.replace(/'/g, "''");

    const kql = `
      let latestAdvisor = AdvisorRecommendations
        | where Timestamp > ago(${lookbackDays}d)
        | where Category =~ 'Cost'
        | where tolower(ImpactedArea) contains '${filter.toLowerCase()}'
        | summarize arg_max(Timestamp, *) by InstanceId, RecommendationSubTypeId;

      let cost30d = CostData
        | where Timestamp > ago(30d)
        | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId);

      latestAdvisor
      | join kind=leftouter cost30d on $left.InstanceId == $right.InstanceId
      | project InstanceId, InstanceName, ResourceGroup, SubscriptionId, TenantId, Impact, ImpactedArea,
                RecommendationSubTypeId, RecommendationDescription, RecommendationAction, AdditionalInfo, DetailsUrl,
                Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, 'USD')
    `;

    const rows = await this.queryAdx<AdvisorCostResourceRow>(ctx, kql);
    const recommendations = rows.map((row) => {
      const additionalInfo = { ...(row.AdditionalInfo || {}) } as Record<string, unknown>;
      const annualSavings = Number(additionalInfo.annualSavingsAmount ?? row.Cost30d * 12);
      additionalInfo.cost30d = row.Cost30d;
      additionalInfo.currency = row.Currency;
      additionalInfo.savingsAmount = annualSavings / 12;
      additionalInfo.annualSavingsAmount = annualSavings;

      return {
        recommendationId: uuidv4(),
        generatedDate: new Date().toISOString(),
        cloud: 'Azure',
        category: 'Cost',
        impactedArea: row.ImpactedArea || this.fallbackSubType.impactedArea,
        impact: normalizeRecommendationImpact(row.Impact, 'High'),
        recommendationType: 'Saving',
        recommendationSubType: this.fallbackSubType.subType,
        recommendationSubTypeId: row.RecommendationSubTypeId || this.fallbackSubType.subTypeId,
        recommendationDescription: row.RecommendationDescription || this.fallbackSubType.description,
        recommendationAction: row.RecommendationAction || this.fallbackSubType.action,
        instanceId: row.InstanceId,
        instanceName: row.InstanceName,
        resourceGroup: row.ResourceGroup,
        subscriptionId: row.SubscriptionId,
        subscriptionName: '',
        tenantId: row.TenantId,
        fitScore: 5,
        tags: {},
        detailsUrl: row.DetailsUrl || '',
        additionalInfo,
      } satisfies Recommendation;
    });

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}

const VM_SUB_TYPE: RecommenderSubType = {
  subType: 'VmOptimizations',
  subTypeId: '82f16a7c-cac4-4604-b113-407661b3c697',
  category: 'Cost',
  impact: 'High',
  impactedArea: 'Microsoft.Compute/virtualMachines',
  description: 'VM optimization opportunity from Advisor guidance',
  action: 'Apply right-size or shutdown recommendation for the VM',
};

export class VmOptimizationsRecommender extends AdvisorResourceOptimizationBase {
  readonly id = 'vm-optimizations';
  readonly name = 'VM optimizations';
  readonly subTypes = [VM_SUB_TYPE];
  protected readonly impactedAreaFilter = 'microsoft.compute/virtualmachines';
  protected readonly fallbackSubType = VM_SUB_TYPE;
}
