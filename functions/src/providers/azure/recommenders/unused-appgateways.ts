// Recommender: Unused Application Gateways — no backend pool targets

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'UnusedAppGateways',
  subTypeId: 'dc3d2baa-26c8-435e-aa9d-edb2bfd6fff6',
  category: 'Cost',
  impact: 'High',
  impactedArea: 'Microsoft.Network/applicationGateways',
  description: 'Application Gateway has no backend pool targets and incurs unnecessary costs',
  action: 'Delete the Application Gateway',
};

export class UnusedAppGatewaysRecommender extends AzureRecommender {
  readonly id = 'unused-appgateways';
  readonly name = 'Unused Application Gateways';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const kql = `
      ApplicationGateways
      | summarize arg_max(Timestamp, *) by InstanceId
      | where BackendPoolsCount == 0 or (BackendIPCount == 0 and BackendAddressesCount == 0)
      | join kind=leftouter (
          CostData
          | where Timestamp > ago(30d)
          | where MeterCategory has "Application Gateway"
          | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, InstanceName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, SkuName, SkuTier, BackendPoolsCount, BackendIPCount, BackendAddressesCount, Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;

    const results = await this.queryAdx<{
      InstanceId: string;
      InstanceName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      SkuName: string;
      SkuTier: string;
      BackendPoolsCount: number;
      BackendIPCount: number;
      BackendAddressesCount: number;
      Cost30d: number;
      Currency: string;
    }>(ctx, kql);

    const recommendations = results.map((gw) =>
      this.createRecommendation(SUB_TYPE, {
        instanceId: gw.InstanceId,
        instanceName: gw.InstanceName,
        resourceGroup: gw.ResourceGroup,
        subscriptionId: gw.SubscriptionId,
        tenantId: gw.TenantId,
        tags: gw.Tags,
        fitScore: 5,
        additionalInfo: {
          skuName: gw.SkuName,
          skuTier: gw.SkuTier,
          location: gw.Location,
          backendPoolsCount: gw.BackendPoolsCount,
          monthlyCost: gw.Cost30d,
          annualSavings: gw.Cost30d * 12,
          currency: gw.Currency,
        },
      }),
    );

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
