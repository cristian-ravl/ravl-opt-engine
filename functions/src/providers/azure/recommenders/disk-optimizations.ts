import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { AzureRecommender } from './base-recommender.js';
import { findDiskMonthlyPrice, numberSetting, resolvePriceSheetRegion, type PriceSheetRow } from './resource-optimization-helpers.js';

const UNDERUSED_PREMIUM_SSD_DISKS: RecommenderSubType = {
  subType: 'UnderusedPremiumSSDDisks',
  subTypeId: '4854b5dc-4124-4ade-879e-6a7bb65350ab',
  category: 'Cost',
  impact: 'High',
  impactedArea: 'Microsoft.Compute/disks',
  description: 'Premium SSD disk has been underutilized',
  action: 'Change disk tier at least to the equivalent for Standard SSD',
};

const PREMIUM_TO_STANDARD_TIER: Record<string, string> = {
  P1: 'E1',
  P2: 'E2',
  P3: 'E3',
  P4: 'E4',
  P6: 'E6',
  P10: 'E10',
  P15: 'E15',
  P20: 'E20',
  P30: 'E30',
  P40: 'E40',
  P50: 'E50',
  P60: 'E60',
  P70: 'E70',
  P80: 'E80',
  P90: 'E90',
  P100: 'E100',
  P110: 'E110',
};

const DISK_TIER_BY_MAX_SIZE_GB = [
  { maxSizeGb: 4, premium: 'P1' },
  { maxSizeGb: 8, premium: 'P2' },
  { maxSizeGb: 16, premium: 'P3' },
  { maxSizeGb: 32, premium: 'P4' },
  { maxSizeGb: 64, premium: 'P6' },
  { maxSizeGb: 128, premium: 'P10' },
  { maxSizeGb: 256, premium: 'P15' },
  { maxSizeGb: 512, premium: 'P20' },
  { maxSizeGb: 1024, premium: 'P30' },
  { maxSizeGb: 2048, premium: 'P40' },
  { maxSizeGb: 4096, premium: 'P50' },
  { maxSizeGb: 8192, premium: 'P60' },
  { maxSizeGb: 16384, premium: 'P70' },
  { maxSizeGb: 32767, premium: 'P80' },
];

type DiskOptimizationRow = {
  InstanceId: string;
  DiskName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  Tags: Record<string, string>;
  DiskIOPS: number;
  DiskThroughput: number;
  DiskTier: string;
  DiskSizeGB: number;
  SKU: string;
  DiskType: string;
  MaxIOPSMetric: number;
  MaxMBsMetric: number;
  IOPSPercentage: number;
  MBsPercentage: number;
  Last30DaysCost: number;
  Last30DaysQuantity: number;
  Currency: string;
};

function inferCurrentTierCode(row: DiskOptimizationRow): string | null {
  if (row.DiskTier && row.DiskTier.trim().length > 0) {
    return row.DiskTier.trim();
  }

  for (const tier of DISK_TIER_BY_MAX_SIZE_GB) {
    if (row.DiskSizeGB <= tier.maxSizeGb) {
      return tier.premium;
    }
  }

  return null;
}

function skuSuffix(skuName: string): string {
  return skuName.split('_')[1] ?? 'LRS';
}

export class DiskOptimizationsRecommender extends AzureRecommender {
  readonly id = 'disk-optimizations';
  readonly name = 'Disk optimizations';
  readonly subTypes = [UNDERUSED_PREMIUM_SSD_DISKS];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const perfDays = numberSetting('OE_RECOMMEND_PERF_PERIOD_DAYS', 7);
    const iopsThreshold = numberSetting('OE_PERF_THRESHOLD_DISK_IOPS_PERCENTAGE', 5);
    const throughputThreshold = numberSetting('OE_PERF_THRESHOLD_DISK_MBS_PERCENTAGE', 5);
    const priceSheetRegion = resolvePriceSheetRegion(ctx.referenceRegion);
    const priceSheetRegionFilter = priceSheetRegion ? `and MeterRegion == '${priceSheetRegion.replace(/'/g, "''")}'` : '';

    const disksKql = `
      let billedDisks = CostData
        | where Timestamp > ago(30d)
        | where InstanceId contains '/disks/' and MeterCategory == 'Storage' and MeterSubCategory has 'Premium' and MeterName has 'Disk'
        | summarize Last30DaysCost = sum(Cost), Last30DaysQuantity = sum(Quantity), Currency = any(Currency) by InstanceId = tolower(InstanceId);
      let iopsMetrics = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Composite Disk Read Operations/sec,Composite Disk Write Operations/sec'
        | where AggregationType == 'Average' and AggregationOfType == 'Maximum'
        | summarize MaxIOPSMetric = max(Value) by InstanceId;
      let mbpsMetrics = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Composite Disk Read Bytes/sec,Composite Disk Write Bytes/sec'
        | where AggregationType == 'Average' and AggregationOfType == 'Maximum'
        | summarize MaxMBsMetric = max(Value) / 1024.0 / 1024.0 by InstanceId;
      ManagedDisks
      | summarize arg_max(Timestamp, *) by InstanceId
      | where DiskState =~ 'Attached' and SKU startswith 'Premium' and SKU !contains 'V2'
      | where DiskIOPS > 0 and DiskThroughput > 0
      | project InstanceId, DiskName, ResourceGroup, SubscriptionId, TenantId, Tags, DiskIOPS, DiskThroughput, DiskTier, DiskSizeGB, SKU, DiskType
      | join kind=inner iopsMetrics on InstanceId
      | join kind=inner mbpsMetrics on InstanceId
      | extend IOPSPercentage = MaxIOPSMetric / todouble(DiskIOPS) * 100.0, MBsPercentage = MaxMBsMetric / todouble(DiskThroughput) * 100.0
      | where IOPSPercentage < ${iopsThreshold} and MBsPercentage < ${throughputThreshold}
      | join kind=inner billedDisks on InstanceId
      | project InstanceId, DiskName, ResourceGroup, SubscriptionId, TenantId, Tags, DiskIOPS, DiskThroughput, DiskTier, DiskSizeGB, SKU, DiskType,
                MaxIOPSMetric, MaxMBsMetric, IOPSPercentage, MBsPercentage, Last30DaysCost, Last30DaysQuantity, Currency
    `;

    const priceSheetKql = `
      PriceSheetData
      | where Timestamp > ago(14d)
      | where MeterCategory == 'Storage' and MeterSubCategory contains 'Managed Disk' and (MeterName endswith 'Disk' or MeterName endswith 'Disks') and MeterName !has 'Special'
      | ${priceSheetRegionFilter.length > 0 ? `where ${priceSheetRegionFilter.slice(4)}` : 'project-away BillingAccountId'}
      | project MeterName, MeterSubCategory, MeterCategory, MeterRegion, UnitPrice, UnitOfMeasure, CurrencyCode
    `;

    const [rows, priceSheetRows] = await Promise.all([
      this.queryAdx<DiskOptimizationRow>(ctx, disksKql),
      this.queryAdx<PriceSheetRow>(ctx, priceSheetKql),
    ]);

    const recommendations: Recommendation[] = [];

    for (const row of rows) {
      const currentTierCode = inferCurrentTierCode(row);
      const targetTierCode = currentTierCode ? PREMIUM_TO_STANDARD_TIER[currentTierCode] : null;
      if (!currentTierCode || !targetTierCode) continue;

      const suffix = skuSuffix(row.SKU);
      const currentTier = `${currentTierCode} ${suffix}`;
      const targetTier = `${targetTierCode} ${suffix}`;
      const targetSku = row.SKU.replace('Premium', 'StandardSSD');
      const currentPrice = findDiskMonthlyPrice(priceSheetRows, currentTier);
      const targetPrice = findDiskMonthlyPrice(priceSheetRows, targetTier);
      if (Number.isFinite(currentPrice) && Number.isFinite(targetPrice) && targetPrice >= currentPrice) {
        continue;
      }

      let savingsAmount = row.Last30DaysCost / 2;
      if (Number.isFinite(currentPrice) && Number.isFinite(targetPrice) && row.Last30DaysQuantity > 0) {
        savingsAmount = currentPrice * row.Last30DaysQuantity - targetPrice * row.Last30DaysQuantity;
      } else if (Number.isFinite(targetPrice) && row.Last30DaysQuantity > 0) {
        savingsAmount = row.Last30DaysCost - targetPrice * row.Last30DaysQuantity;
      }

      if (!Number.isFinite(savingsAmount) || savingsAmount <= 0) {
        savingsAmount = row.Last30DaysCost / 2;
      }

      recommendations.push(
        this.createRecommendation(UNDERUSED_PREMIUM_SSD_DISKS, {
          instanceId: row.InstanceId,
          instanceName: row.DiskName,
          resourceGroup: row.ResourceGroup,
          subscriptionId: row.SubscriptionId,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: row.DiskSizeGB > 512 ? 3.5 : 4,
          additionalInfo: {
            DiskType: row.DiskType || 'Managed',
            currentSku: row.SKU,
            targetSku,
            DiskSizeGB: row.DiskSizeGB,
            currentTier,
            targetTier,
            MaxIOPSMetric: row.MaxIOPSMetric,
            MaxMBpsMetric: row.MaxMBsMetric,
            MetricIOPSPercentage: row.IOPSPercentage,
            MetricMBpsPercentage: row.MBsPercentage,
            targetMaxSizeGB: row.DiskSizeGB,
            targetMaxIOPS: row.MaxIOPSMetric,
            targetMaxMBps: row.MaxMBsMetric,
            savingsAmount,
            CostsAmount: row.Last30DaysCost,
            currency: row.Currency,
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
