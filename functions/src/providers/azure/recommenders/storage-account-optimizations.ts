import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender } from './base-recommender.js';
import { numberSetting } from './resource-optimization-helpers.js';

const STORAGE_ACCOUNT_GROWING: RecommenderSubType = {
  subType: 'StorageAccountsGrowing',
  subTypeId: '08e049ca-18b0-4d22-b174-131a91d0381c',
  category: 'Cost',
  impact: 'Medium',
  impactedArea: 'Microsoft.Storage/storageAccounts',
  description: 'Storage Account without retention policy in place',
  action: 'Review whether the Storage Account has a retention policy for example via Lifecycle Management',
};

type StorageAccountGrowthRow = {
  ResourceId: string;
  ResourceGroup: string;
  SubscriptionId: string;
  SubscriptionName: string;
  TenantId: string;
  Tags: Record<string, string>;
  InitialDailyCost: number;
  CurrentDailyCost: number;
  GrowthPercentage: number;
};

export class StorageAccountOptimizationsRecommender extends AzureRecommender {
  readonly id = 'storage-account-optimizations';
  readonly name = 'Storage account optimizations';
  readonly subTypes = [STORAGE_ACCOUNT_GROWING];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const growthThreshold = numberSetting('OE_RECOMMEND_STORAGE_ACCOUNT_GROWTH_THRESHOLD_PERCENTAGE', 5);
    const monthlyCostThreshold = numberSetting('OE_RECOMMEND_STORAGE_ACCOUNT_GROWTH_MONTHLY_COST_THRESHOLD', 50);
    const growthLookbackDays = numberSetting('OE_RECOMMEND_STORAGE_ACCOUNT_GROWTH_LOOKBACK_DAYS', 30);
    const dailyCostThreshold = Math.round(monthlyCostThreshold / 30);

    const kql = `
      let interval = ${growthLookbackDays}d;
      let etime = endofday(todatetime(toscalar(CostData | where Timestamp > ago(interval) and Timestamp < now() | summarize max(Timestamp))));
      let stime = endofday(etime - interval);
      let lastday_stime = endofday(etime - 1d);
      let storageAccountsWithLastTags = CostData
        | where Timestamp between (lastday_stime .. etime)
        | where MeterCategory == 'Storage' and InstanceId has '/providers/microsoft.storage/storageaccounts/' and MeterName endswith 'Data Stored'
        | summarize arg_max(Timestamp, Tags) by ResourceId = tolower(InstanceId);
      let subscriptionContainers = ResourceContainers
        | where ContainerType =~ 'Subscription'
        | summarize arg_max(Timestamp, *) by SubscriptionId
        | project SubscriptionId, SubscriptionName = ContainerName, TenantId;
      CostData
      | where Timestamp between (stime .. etime)
      | where MeterCategory == 'Storage' and InstanceId has '/providers/microsoft.storage/storageaccounts/' and MeterName endswith 'Data Stored'
      | make-series CostSum = sum(Cost) default = 0.0 on Timestamp from stime to etime step 1d by ResourceId = tolower(InstanceId), ResourceGroup, SubscriptionId
      | extend InitialDailyCost = todouble(CostSum[0]), CurrentDailyCost = todouble(CostSum[array_length(CostSum) - 1])
      | extend GrowthPercentage = round((CurrentDailyCost - InitialDailyCost) / InitialDailyCost * 100.0, 2)
      | where InitialDailyCost > 0 and CurrentDailyCost > ${dailyCostThreshold} and GrowthPercentage > ${growthThreshold}
      | join kind=leftouter storageAccountsWithLastTags on ResourceId
      | join kind=leftouter subscriptionContainers on SubscriptionId
      | project ResourceId, ResourceGroup, SubscriptionId, SubscriptionName, TenantId, Tags, InitialDailyCost, CurrentDailyCost, GrowthPercentage
    `;

    const rows = await this.queryAdx<StorageAccountGrowthRow>(ctx, kql);
    const recommendations: Recommendation[] = rows.map((row) => {
      const costsAmount = ((row.InitialDailyCost + row.CurrentDailyCost) / 2) * 30;

      return this.createRecommendation(STORAGE_ACCOUNT_GROWING, {
        instanceId: row.ResourceId,
        instanceName: row.ResourceId.split('/').at(-1) ?? row.ResourceId,
        resourceGroup: row.ResourceGroup,
        subscriptionId: row.SubscriptionId,
        subscriptionName: row.SubscriptionName,
        tenantId: row.TenantId,
        tags: row.Tags,
        fitScore: 4,
        additionalInfo: {
          InitialDailyCost: row.InitialDailyCost,
          CurrentDailyCost: row.CurrentDailyCost,
          GrowthPercentage: row.GrowthPercentage,
          CostsAmount: costsAmount,
          savingsAmount: costsAmount * 0.25,
        },
      });
    });

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
