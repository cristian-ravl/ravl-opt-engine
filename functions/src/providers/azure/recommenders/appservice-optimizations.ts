// Recommender: App Service Plan optimizations — underused plans, empty plans,
// performance-constrained plans (using metrics from ADX).

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPES: Record<string, RecommenderSubType> = {
  underused: {
    subType: 'UnderusedAppServicePlans',
    subTypeId: '042adaca-ebdf-49b4-bc1b-2800b6e40fea',
    category: 'Cost',
    impact: 'High',
    impactedArea: 'Microsoft.Web/serverFarms',
    description: 'App Service Plan is underutilized and capacity is being wasted',
    action: 'Right-size the App Service Plan or scale in workers',
  },
  perfConstrained: {
    subType: 'PerfConstrainedAppServicePlans',
    subTypeId: '351574cb-c105-4538-a778-11dfbe4857bf',
    category: 'Performance',
    impact: 'Medium',
    impactedArea: 'Microsoft.Web/serverFarms',
    description: 'App Service Plan is constrained by lack of resources',
    action: 'Resize to a higher SKU or scale out workers',
  },
  empty: {
    subType: 'EmptyAppServicePlans',
    subTypeId: 'ef525225-8b91-47a3-81f3-e674e94564b6',
    category: 'Cost',
    impact: 'High',
    impactedArea: 'Microsoft.Web/serverFarms',
    description: 'App Service Plan has no apps deployed and incurs unnecessary costs',
    action: 'Delete the App Service Plan',
  },
};

const CPU_LOW_THRESHOLD = 30;
const CPU_HIGH_THRESHOLD = 80;
const MEMORY_LOW_THRESHOLD = 50;
const MEMORY_HIGH_THRESHOLD = 90;

export class AppServiceOptimizationsRecommender extends AzureRecommender {
  readonly id = 'appservice-optimizations';
  readonly name = 'App Service Plan Optimizations';
  readonly subTypes = Object.values(SUB_TYPES);

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // 1. Empty App Service Plans
    const emptyKql = `
      AppServicePlans
      | summarize arg_max(Timestamp, *) by InstanceId
      | where NumberOfSites == 0
      | where SkuTier !in ("Free", "Shared")
      | join kind=leftouter (
          LatestCostData
          | where UsageDate >= ago(30d) and MeterCategory has "Azure App Service"
          | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on $left.InstanceId == $right.InstanceId
      | project InstanceId, AppServicePlanName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, SkuName, SkuTier, NumberOfSites, Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;
    const emptyPlans = await this.queryAdx<{
      InstanceId: string;
      AppServicePlanName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      SkuName: string;
      SkuTier: string;
      NumberOfSites: number;
      Cost30d: number;
      Currency: string;
    }>(ctx, emptyKql);

    for (const plan of emptyPlans) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.empty, {
          instanceId: plan.InstanceId,
          instanceName: plan.AppServicePlanName,
          resourceGroup: plan.ResourceGroup,
          subscriptionId: plan.SubscriptionId,
          tenantId: plan.TenantId,
          tags: plan.Tags,
          fitScore: 5,
          additionalInfo: {
            skuName: plan.SkuName,
            skuTier: plan.SkuTier,
            location: plan.Location,
            monthlyCost: plan.Cost30d,
            annualSavings: plan.Cost30d * 12,
            currency: plan.Currency,
          },
        }),
      );
    }

    // 2. Underused / performance-constrained (using metrics)
    const metricsKql = `
      let plans = AppServicePlans
        | summarize arg_max(Timestamp, *) by InstanceId
        | where NumberOfSites > 0
        | where SkuTier !in ("Free", "Shared");
      let cpuMetrics = PerformanceMetrics
        | where Timestamp > ago(7d) and MetricName == "CpuPercentage"
        | summarize AvgCPU = avg(Value), MaxCPU = max(Value) by InstanceId;
      let memMetrics = PerformanceMetrics
        | where Timestamp > ago(7d) and MetricName == "MemoryPercentage"
        | summarize AvgMemory = avg(Value), MaxMemory = max(Value) by InstanceId;
      plans
      | join kind=leftouter cpuMetrics on InstanceId
      | join kind=leftouter memMetrics on InstanceId
      | join kind=leftouter (
          LatestCostData
          | where UsageDate >= ago(30d) and MeterCategory has "Azure App Service"
          | summarize Cost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId)
      ) on InstanceId
      | project InstanceId, AppServicePlanName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, SkuName, SkuTier, SkuCapacity, NumberOfSites, AvgCPU = coalesce(AvgCPU, -1.0), MaxCPU = coalesce(MaxCPU, -1.0), AvgMemory = coalesce(AvgMemory, -1.0), MaxMemory = coalesce(MaxMemory, -1.0), Cost30d = coalesce(Cost30d, 0.0), Currency = coalesce(Currency, "USD")
    `;
    const plansWithMetrics = await this.queryAdx<{
      InstanceId: string;
      AppServicePlanName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      SkuName: string;
      SkuTier: string;
      SkuCapacity: number;
      NumberOfSites: number;
      AvgCPU: number;
      MaxCPU: number;
      AvgMemory: number;
      MaxMemory: number;
      Cost30d: number;
      Currency: string;
    }>(ctx, metricsKql);

    for (const plan of plansWithMetrics) {
      // Skip if no metrics available
      if (plan.AvgCPU < 0 && plan.AvgMemory < 0) continue;

      const isUnderused = plan.AvgCPU >= 0 && plan.AvgCPU < CPU_LOW_THRESHOLD && plan.AvgMemory >= 0 && plan.AvgMemory < MEMORY_LOW_THRESHOLD;

      const isConstrained = (plan.AvgCPU >= 0 && plan.AvgCPU > CPU_HIGH_THRESHOLD) || (plan.AvgMemory >= 0 && plan.AvgMemory > MEMORY_HIGH_THRESHOLD);

      if (isUnderused) {
        const fitScore = Math.max(1, Math.round(5 - (plan.AvgCPU / CPU_LOW_THRESHOLD) * 2.5 - (plan.AvgMemory / MEMORY_LOW_THRESHOLD) * 2.5));
        recommendations.push(
          this.createRecommendation(SUB_TYPES.underused, {
            instanceId: plan.InstanceId,
            instanceName: plan.AppServicePlanName,
            resourceGroup: plan.ResourceGroup,
            subscriptionId: plan.SubscriptionId,
            tenantId: plan.TenantId,
            tags: plan.Tags,
            fitScore,
            additionalInfo: {
              skuName: plan.SkuName,
              skuTier: plan.SkuTier,
              capacity: plan.SkuCapacity,
              avgCPU: Math.round(plan.AvgCPU),
              maxCPU: Math.round(plan.MaxCPU),
              avgMemory: Math.round(plan.AvgMemory),
              maxMemory: Math.round(plan.MaxMemory),
              monthlyCost: plan.Cost30d,
              currency: plan.Currency,
            },
          }),
        );
      }

      if (isConstrained) {
        const fitScore = Math.min(5, Math.max(1, Math.round((Math.max(plan.AvgCPU, plan.AvgMemory) - 80) / 4)));
        recommendations.push(
          this.createRecommendation(SUB_TYPES.perfConstrained, {
            instanceId: plan.InstanceId,
            instanceName: plan.AppServicePlanName,
            resourceGroup: plan.ResourceGroup,
            subscriptionId: plan.SubscriptionId,
            tenantId: plan.TenantId,
            tags: plan.Tags,
            fitScore,
            additionalInfo: {
              skuName: plan.SkuName,
              skuTier: plan.SkuTier,
              capacity: plan.SkuCapacity,
              avgCPU: Math.round(plan.AvgCPU),
              maxCPU: Math.round(plan.MaxCPU),
              avgMemory: Math.round(plan.AvgMemory),
              maxMemory: Math.round(plan.MaxMemory),
              monthlyCost: plan.Cost30d,
              currency: plan.Currency,
            },
          }),
        );
      }
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
