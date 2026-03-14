// Recommender: Advisor cost-augmented — augments Advisor Cost recommendations
// with observed spend and optional pricesheet context.

import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender, normalizeRecommendationImpact, uuidv4 } from './base-recommender.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'AdvisorCost',
  subTypeId: 'e10b1381-5f0a-47ff-8c7b-37bd13d7c974',
  category: 'Cost',
  impact: 'High',
  impactedArea: 'Microsoft.Advisor/recommendations',
  description: 'Advisor cost recommendation with spend context',
  action: 'Review recommendation and apply the cost-saving action',
};

type AdvisorCostRow = {
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
  UnitPriceEstimate: number;
};

export class AdvisorCostAugmentedRecommender extends AzureRecommender {
  readonly id = 'advisor-cost-augmented';
  readonly name = 'Advisor cost-augmented recommendations';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const lookbackDays = Number(process.env.OE_ADVISOR_LOOKBACK_DAYS ?? '7');
    const priceRegion = process.env.OE_PRICE_SHEET_REFERENCE_REGION ?? 'EU West';

    const kql = `
      let latestAdvisor = AdvisorRecommendations
        | where Timestamp > ago(${lookbackDays}d)
        | where Category =~ 'Cost'
        | summarize arg_max(Timestamp, *) by InstanceId, RecommendationSubTypeId;

      let cost30d = CostData
        | where Timestamp > ago(30d)
        | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId);

      let vmPriceSheet = PriceSheetData
        | where Timestamp > ago(45d)
        | where MeterCategory =~ 'Virtual Machines'
        | where isempty('${priceRegion}') or MeterRegion =~ '${priceRegion}'
        | where PriceType =~ 'Consumption'
        | summarize UnitPriceEstimate = avg(UnitPrice) by MeterName;

      latestAdvisor
      | join kind=leftouter cost30d on $left.InstanceId == $right.InstanceId
      | extend vmNameGuess = extract(@'([^/]+)$', 1, InstanceId)
      | join kind=leftouter vmPriceSheet on $left.vmNameGuess == $right.MeterName
      | project InstanceId, InstanceName, ResourceGroup, SubscriptionId, TenantId, Impact, ImpactedArea,
                RecommendationSubTypeId, RecommendationDescription, RecommendationAction, AdditionalInfo, DetailsUrl,
                Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, 'USD'), UnitPriceEstimate = coalesce(UnitPriceEstimate, 0.0)
    `;

    const rows = await this.queryAdx<AdvisorCostRow>(ctx, kql);

    const recommendations: Recommendation[] = rows.map((row) => {
      const additionalInfo = { ...(row.AdditionalInfo || {}) };
      const typedAdditionalInfo = additionalInfo as Record<string, unknown>;

      const existingAnnualSavings = Number(typedAdditionalInfo.annualSavingsAmount ?? NaN);
      const annualSavings = Number.isFinite(existingAnnualSavings) ? existingAnnualSavings : row.Cost30d * 12;

      typedAdditionalInfo.cost30d = row.Cost30d;
      typedAdditionalInfo.currency = row.Currency;
      typedAdditionalInfo.savingsAmount = annualSavings / 12;
      typedAdditionalInfo.annualSavingsAmount = annualSavings;
      typedAdditionalInfo.unitPriceEstimate = row.UnitPriceEstimate;

      return {
        recommendationId: uuidv4(),
        generatedDate: new Date().toISOString(),
        cloud: 'Azure',
        category: 'Cost',
        impactedArea: row.ImpactedArea || 'Microsoft.Advisor/recommendations',
        impact: normalizeRecommendationImpact(row.Impact, 'High'),
        recommendationType: 'Saving',
        recommendationSubType: 'AdvisorCost',
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
        additionalInfo: typedAdditionalInfo,
      };
    });

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
