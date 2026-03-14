import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender } from './base-recommender.js';
import { numberSetting } from './resource-optimization-helpers.js';

const SUB_TYPES = {
  underused: {
    subType: 'UnderusedSqlDatabases',
    subTypeId: 'ff68f4e5-1197-4be9-8e5f-8760d7863cb4',
    category: 'Cost',
    impact: 'High',
    impactedArea: 'Microsoft.Sql/servers/databases',
    description: 'Underused SQL Databases (performance capacity waste)',
    action: 'Right-size underused SQL Databases',
  },
  perfConstrained: {
    subType: 'PerfConstrainedSqlDatabases',
    subTypeId: '724ff2f5-8c83-4105-b00d-029c4560d774',
    category: 'Performance',
    impact: 'Medium',
    impactedArea: 'Microsoft.Sql/servers/databases',
    description: 'SQL Database performance has been constrained by lack of resources',
    action: 'Resize SQL Database to higher SKU or scale it out',
  },
} satisfies Record<string, RecommenderSubType>;

type SqlDbUnderusedRow = {
  InstanceId: string;
  DBName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  SubscriptionName: string;
  SkuName: string;
  ServiceObjectiveName: string;
  Tags: Record<string, string>;
  P99DTUPercentage: number;
  Last30DaysCost: number;
  Currency: string;
};

type SqlDbPerfRow = {
  InstanceId: string;
  DBName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  SubscriptionName: string;
  SkuName: string;
  ServiceObjectiveName: string;
  Tags: Record<string, string>;
  AvgDTUPercentage: number;
};

export class SqlDbOptimizationsRecommender extends AzureRecommender {
  readonly id = 'sqldb-optimizations';
  readonly name = 'SQL DB optimizations';
  readonly subTypes = [SUB_TYPES.underused, SUB_TYPES.perfConstrained];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const perfDays = numberSetting('OE_RECOMMEND_PERF_PERIOD_DAYS', 7);
    const dtuPercentile = numberSetting('OE_PERF_PERCENTILE_SQL_DTU', 99);
    const underusedThreshold = numberSetting('OE_PERF_THRESHOLD_DTU_PERCENTAGE', 40);
    const constrainedThreshold = numberSetting('OE_PERF_THRESHOLD_DTU_DEGRADED_PERCENTAGE', 75);

    const underusedKql = `
      let candidateDatabases = SqlDatabases
        | summarize arg_max(Timestamp, *) by InstanceId
        | where SkuName in ('Standard', 'Premium');
      let dtuMetrics = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'dtu_consumption_percent' and AggregationType == 'Maximum'
        | summarize P99DTUPercentage = percentile(Value, ${dtuPercentile}) by InstanceId;
      let cost30d = LatestCostData
        | where UsageDate >= ago(30d)
        | summarize Last30DaysCost = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId);
      candidateDatabases
      | join kind=inner dtuMetrics on InstanceId
      | where P99DTUPercentage < ${underusedThreshold}
      | join kind=leftouter cost30d on InstanceId
      | project InstanceId, DBName, ResourceGroup, SubscriptionId, TenantId, Tags, SkuName, ServiceObjectiveName,
                P99DTUPercentage, Last30DaysCost = coalesce(Last30DaysCost, 0.0), Currency = coalesce(Currency, 'USD')
    `;

    const perfKql = `
      let candidateDatabases = SqlDatabases
        | summarize arg_max(Timestamp, *) by InstanceId
        | where SkuName in ('Basic', 'Standard', 'Premium');
      let dtuMetrics = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'dtu_consumption_percent' and AggregationType == 'Average' and AggregationOfType == 'Maximum'
        | summarize AvgDTUPercentage = avg(Value) by InstanceId;
      candidateDatabases
      | join kind=inner dtuMetrics on InstanceId
      | where AvgDTUPercentage > ${constrainedThreshold}
      | project InstanceId, DBName, ResourceGroup, SubscriptionId, TenantId, Tags, SkuName, ServiceObjectiveName, AvgDTUPercentage
    `;

    const [underusedRows, perfRows] = await Promise.all([
      this.queryAdx<SqlDbUnderusedRow>(ctx, underusedKql),
      this.queryAdx<SqlDbPerfRow>(ctx, perfKql),
    ]);

    const recommendations: Recommendation[] = [];

    for (const row of underusedRows) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.underused, {
          instanceId: row.InstanceId,
          instanceName: row.DBName,
          resourceGroup: row.ResourceGroup,
          subscriptionId: row.SubscriptionId,
          subscriptionName: row.SubscriptionName,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: 5,
          additionalInfo: {
            currentSku: `${row.SkuName} ${row.ServiceObjectiveName}`.trim(),
            DTUPercentage: Math.round(row.P99DTUPercentage),
            cost30d: row.Last30DaysCost,
            savingsAmount: row.Last30DaysCost / 2,
            currency: row.Currency,
          },
        }),
      );
    }

    for (const row of perfRows) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.perfConstrained, {
          instanceId: row.InstanceId,
          instanceName: row.DBName,
          resourceGroup: row.ResourceGroup,
          subscriptionId: row.SubscriptionId,
          subscriptionName: row.SubscriptionName,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: 4,
          additionalInfo: {
            currentSku: `${row.SkuName} ${row.ServiceObjectiveName}`.trim(),
            DTUPercentage: Math.round(row.AvgDTUPercentage),
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
