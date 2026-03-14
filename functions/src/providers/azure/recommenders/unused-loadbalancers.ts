// Recommender: Unused Load Balancers — Standard LBs without backend targets (cost),
// and all LBs without backend pool that are operationally useless.

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const COST_SUB_TYPE: RecommenderSubType = {
  subType: 'UnusedStandardLoadBalancers',
  subTypeId: 'f1ed3bb2-3cb5-41e6-ba38-7001d5ff87f5',
  category: 'Cost',
  impact: 'Medium',
  impactedArea: 'Microsoft.Network/loadBalancers',
  description: 'Standard Load Balancer has rules but no backend pool targets',
  action: 'Delete the Load Balancer to stop incurring charges',
};

const OPEX_SUB_TYPE: RecommenderSubType = {
  subType: 'UnusedLoadBalancers',
  subTypeId: '48619512-f4e6-4241-9c85-16f7c987950c',
  category: 'OperationalExcellence',
  impact: 'Medium',
  impactedArea: 'Microsoft.Network/loadBalancers',
  description: 'Load Balancer has no backend pool and is operationally useless',
  action: 'Delete the Load Balancer',
};

export class UnusedLoadBalancersRecommender extends AzureRecommender {
  readonly id = 'unused-loadbalancers';
  readonly name = 'Unused Load Balancers';
  readonly subTypes = [COST_SUB_TYPE, OPEX_SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const kql = `
      LoadBalancers
      | summarize arg_max(Timestamp, *) by InstanceId
      | where (BackendPoolsCount == 0 or (BackendIPCount == 0 and BackendAddressesCount == 0))
            and InboundNatPoolsCount == 0
      | join kind=leftouter (
          CostData
          | where Timestamp > ago(30d)
          | where MeterCategory has "Load Balancer"
          | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, InstanceName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, SkuName, SkuTier, LbType, LbRulesCount, BackendPoolsCount, BackendIPCount, InboundNatPoolsCount, Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, "USD")
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
      LbType: string;
      LbRulesCount: number;
      BackendPoolsCount: number;
      BackendIPCount: number;
      InboundNatPoolsCount: number;
      Cost30d: number;
      Currency: string;
    }>(ctx, kql);

    const recommendations: Recommendation[] = [];

    for (const lb of results) {
      // Standard LBs with rules = Cost recommendation
      if (lb.SkuName?.toLowerCase() === 'standard' && lb.LbRulesCount > 0) {
        recommendations.push(
          this.createRecommendation(COST_SUB_TYPE, {
            instanceId: lb.InstanceId,
            instanceName: lb.InstanceName,
            resourceGroup: lb.ResourceGroup,
            subscriptionId: lb.SubscriptionId,
            tenantId: lb.TenantId,
            tags: lb.Tags,
            fitScore: 5,
            additionalInfo: {
              skuName: lb.SkuName,
              lbType: lb.LbType,
              rulesCount: lb.LbRulesCount,
              monthlyCost: lb.Cost30d,
              annualSavings: lb.Cost30d * 12,
              currency: lb.Currency,
            },
          }),
        );
      }

      // All unused LBs = OpEx recommendation
      recommendations.push(
        this.createRecommendation(OPEX_SUB_TYPE, {
          instanceId: lb.InstanceId,
          instanceName: lb.InstanceName,
          resourceGroup: lb.ResourceGroup,
          subscriptionId: lb.SubscriptionId,
          tenantId: lb.TenantId,
          tags: lb.Tags,
          fitScore: 5,
          additionalInfo: {
            skuName: lb.SkuName,
            lbType: lb.LbType,
            backendPoolsCount: lb.BackendPoolsCount,
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
