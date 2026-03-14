import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';
import { loadComputeSkuCatalog, findComputeSkuDetails, listComputeSkuDetails, type ComputeSkuDetails } from '../collectors/compute-sku.js';
import { AzureRecommender } from './base-recommender.js';
import { findVmHourlyPrice, numberSetting, resolvePriceSheetRegion, type PriceSheetRow } from './resource-optimization-helpers.js';

const SUB_TYPES = {
  underused: {
    subType: 'UnderusedVMSS',
    subTypeId: 'a4955cc9-533d-46a2-8625-5c4ebd1c30d5',
    category: 'Cost',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachineScaleSets',
    description: 'VM Scale Set has been underutilized',
    action: 'Resize VM Scale Set to lower SKU or scale it in',
  },
  perfConstrained: {
    subType: 'PerfConstrainedVMSS',
    subTypeId: '20a40c62-e5c8-4cc3-9fc2-f4ac75013182',
    category: 'Performance',
    impact: 'Medium',
    impactedArea: 'Microsoft.Compute/virtualMachineScaleSets',
    description: 'VM Scale Set performance has been constrained by lack of resources',
    action: 'Resize VM Scale Set to higher SKU or scale it out',
  },
} satisfies Record<string, RecommenderSubType>;

type UnderusedVmssRow = {
  InstanceId: string;
  VMSSName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  VMSSSize: string;
  NicCount: number;
  DataDiskCount: number;
  Capacity: number;
  Location: string;
  Tags: Record<string, string>;
  PMemoryPercentage: number;
  PCPUPercentage: number;
  Last30DaysCost: number;
  Last30DaysQuantity: number;
  Currency: string;
};

type PerfConstrainedVmssRow = {
  InstanceId: string;
  VMSSName: string;
  ResourceGroup: string;
  SubscriptionId: string;
  TenantId: string;
  VMSSSize: string;
  Capacity: number;
  Tags: Record<string, string>;
  PMemoryPercentage: number;
  PCPUMaxPercentage: number;
  PCPUAvgPercentage: number;
};

function chooseVmssTargetSku(
  currentSku: ComputeSkuDetails,
  candidates: ComputeSkuDetails[],
  row: UnderusedVmssRow,
  priceSheetRows: PriceSheetRow[],
): ComputeSkuDetails | null {
  const memoryNeededMb = currentSku.memoryMB * (row.PMemoryPercentage / 100);
  const cpuNeeded = currentSku.coresCount * (row.PCPUPercentage / 100);
  const currentPrice = findVmHourlyPrice(priceSheetRows, currentSku.name);

  const targetCandidates = candidates
    .filter((candidate) => {
      if (candidate.name === currentSku.name || candidate.name.includes('Promo')) return false;
      if (candidate.coresCount < cpuNeeded || candidate.memoryMB < memoryNeededMb) return false;
      if (candidate.maxDataDiskCount < row.DataDiskCount || candidate.maxNetworkInterfaces < row.NicCount) return false;
      if (currentSku.premiumIO && !candidate.premiumIO) return false;
      if (currentSku.cpuArchitectureType && candidate.cpuArchitectureType && currentSku.cpuArchitectureType !== candidate.cpuArchitectureType) return false;
      return true;
    })
    .map((candidate) => ({
      candidate,
      hourlyPrice: findVmHourlyPrice(priceSheetRows, candidate.name),
    }))
    .filter(({ hourlyPrice }) => !Number.isFinite(currentPrice) || hourlyPrice < currentPrice)
    .sort((left, right) => {
      if (left.hourlyPrice !== right.hourlyPrice) {
        return left.hourlyPrice - right.hourlyPrice;
      }

      if (left.candidate.memoryMB !== right.candidate.memoryMB) {
        return left.candidate.memoryMB - right.candidate.memoryMB;
      }

      return left.candidate.coresCount - right.candidate.coresCount;
    });

  return targetCandidates[0]?.candidate ?? null;
}

export class VmssOptimizationsRecommender extends AzureRecommender {
  readonly id = 'vmss-optimizations';
  readonly name = 'VMSS optimizations';
  readonly subTypes = [SUB_TYPES.underused, SUB_TYPES.perfConstrained];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const perfDays = numberSetting('OE_RECOMMEND_PERF_PERIOD_DAYS', 7);
    const cpuPercentile = numberSetting('OE_PERF_PERCENTILE_CPU', 99);
    const memoryPercentile = numberSetting('OE_PERF_PERCENTILE_MEMORY', 99);
    const cpuLowThreshold = numberSetting('OE_PERF_THRESHOLD_CPU_PERCENTAGE', 30);
    const memoryLowThreshold = numberSetting('OE_PERF_THRESHOLD_MEMORY_PERCENTAGE', 50);
    const cpuMaxThreshold = numberSetting('OE_PERF_THRESHOLD_CPU_DEGRADED_MAX_PERCENTAGE', 95);
    const cpuAvgThreshold = numberSetting('OE_PERF_THRESHOLD_CPU_DEGRADED_AVG_PERCENTAGE', 75);
    const memoryDegradedThreshold = numberSetting('OE_PERF_THRESHOLD_MEMORY_DEGRADED_PERCENTAGE', 90);
    const priceSheetRegion = resolvePriceSheetRegion(ctx.referenceRegion);
    const priceSheetRegionFilter = priceSheetRegion ? `| where MeterRegion == '${priceSheetRegion.replace(/'/g, "''")}'` : '';

    const underusedKql = `
      let vmss = VirtualMachineScaleSets
        | summarize arg_max(Timestamp, *) by InstanceId;
      let billedVmss = LatestCostData
        | where UsageDate >= ago(30d) and InstanceId contains 'virtualmachinescalesets' and MeterCategory == 'Virtual Machines'
        | summarize Last30DaysCost = sum(Cost), Last30DaysQuantity = sum(Quantity), Currency = any(Currency) by InstanceId = tolower(InstanceId);
      let memoryPerf = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Available Memory Bytes' and AggregationType == 'Minimum'
        | join kind=inner (vmss | project InstanceId, MemoryMB) on InstanceId
        | extend MemoryPercentage = (todouble(MemoryMB) - (Value / 1024.0 / 1024.0)) / todouble(MemoryMB) * 100.0
        | summarize PMemoryPercentage = percentile(MemoryPercentage, ${memoryPercentile}) by InstanceId;
      let cpuPerf = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Percentage CPU' and AggregationType == 'Maximum'
        | summarize PCPUPercentage = percentile(Value, ${cpuPercentile}) by InstanceId;
      vmss
      | project InstanceId, VMSSName, ResourceGroup, SubscriptionId, TenantId, VMSSSize, NicCount, DataDiskCount, Capacity, Location, Tags
      | join kind=inner billedVmss on InstanceId
      | join kind=inner memoryPerf on InstanceId
      | join kind=inner cpuPerf on InstanceId
      | where PMemoryPercentage < ${memoryLowThreshold} and PCPUPercentage < ${cpuLowThreshold}
      | project InstanceId, VMSSName, ResourceGroup, SubscriptionId, TenantId, VMSSSize, NicCount, DataDiskCount, Capacity, Location, Tags,
                PMemoryPercentage, PCPUPercentage, Last30DaysCost, Last30DaysQuantity, Currency
    `;

    const perfKql = `
      let vmss = VirtualMachineScaleSets
        | summarize arg_max(Timestamp, *) by InstanceId;
      let memoryPerf = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Available Memory Bytes' and AggregationType == 'Minimum'
        | join kind=inner (vmss | project InstanceId, MemoryMB) on InstanceId
        | extend MemoryPercentage = (todouble(MemoryMB) - (Value / 1024.0 / 1024.0)) / todouble(MemoryMB) * 100.0
        | summarize PMemoryPercentage = avg(MemoryPercentage) by InstanceId;
      let cpuMaxPerf = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Percentage CPU' and AggregationType == 'Maximum'
        | summarize PCPUMaxPercentage = avg(Value) by InstanceId;
      let cpuAvgPerf = PerformanceMetrics
        | where Timestamp > ago(${perfDays}d)
        | where MetricName == 'Percentage CPU' and AggregationType == 'Average'
        | summarize PCPUAvgPercentage = avg(Value) by InstanceId;
      vmss
      | project InstanceId, VMSSName, ResourceGroup, SubscriptionId, TenantId, VMSSSize, Capacity, Tags
      | join kind=inner memoryPerf on InstanceId
      | join kind=inner cpuMaxPerf on InstanceId
      | join kind=inner cpuAvgPerf on InstanceId
      | where PMemoryPercentage > ${memoryDegradedThreshold} or (PCPUMaxPercentage > ${cpuMaxThreshold} and PCPUAvgPercentage > ${cpuAvgThreshold})
      | project InstanceId, VMSSName, ResourceGroup, SubscriptionId, TenantId, VMSSSize, Capacity, Tags, PMemoryPercentage, PCPUMaxPercentage, PCPUAvgPercentage
    `;

    const priceSheetKql = `
      PriceSheetData
      | where Timestamp > ago(14d)
      | where MeterCategory == 'Virtual Machines' and PriceType == 'Consumption'
      ${priceSheetRegionFilter}
      | project MeterName, MeterSubCategory, MeterCategory, MeterRegion, UnitPrice, UnitOfMeasure, CurrencyCode
    `;

    const [catalog, underusedRows, perfRows, priceSheetRows] = await Promise.all([
      loadComputeSkuCatalog(ctx),
      this.queryAdx<UnderusedVmssRow>(ctx, underusedKql),
      this.queryAdx<PerfConstrainedVmssRow>(ctx, perfKql),
      this.queryAdx<PriceSheetRow>(ctx, priceSheetKql),
    ]);

    const recommendations: Recommendation[] = [];

    for (const row of underusedRows) {
      const currentSku = findComputeSkuDetails(catalog, 'virtualMachineScaleSets', row.Location, row.VMSSSize);
      if (!currentSku) continue;

      const candidates = listComputeSkuDetails(catalog, 'virtualMachineScaleSets', row.Location);
      const targetSku = chooseVmssTargetSku(currentSku, candidates, row, priceSheetRows);
      if (!targetSku) continue;

      const currentPrice = findVmHourlyPrice(priceSheetRows, currentSku.name);
      const targetPrice = findVmHourlyPrice(priceSheetRows, targetSku.name);
      const savingCoefficient = currentSku.coresCount / Math.max(targetSku.coresCount, 1);

      let savingsAmount = row.Last30DaysCost - row.Last30DaysCost / savingCoefficient;
      if (Number.isFinite(currentPrice) && Number.isFinite(targetPrice) && row.Last30DaysQuantity > 0) {
        savingsAmount = currentPrice * row.Last30DaysQuantity - targetPrice * row.Last30DaysQuantity;
      } else if (Number.isFinite(targetPrice) && row.Last30DaysQuantity > 0) {
        savingsAmount = row.Last30DaysCost - targetPrice * row.Last30DaysQuantity;
      }

      if (!Number.isFinite(savingsAmount) || savingsAmount <= 0) {
        savingsAmount = row.Last30DaysCost / 2;
      }

      recommendations.push(
        this.createRecommendation(SUB_TYPES.underused, {
          instanceId: row.InstanceId,
          instanceName: row.VMSSName,
          resourceGroup: row.ResourceGroup,
          subscriptionId: row.SubscriptionId,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: 4,
          additionalInfo: {
            SupportsDataDisksCount: 'true',
            SupportsNICCount: 'true',
            BelowCPUThreshold: 'true',
            BelowMemoryThreshold: 'true',
            currentSku: row.VMSSSize,
            InstanceCount: row.Capacity,
            targetSku: targetSku.name,
            DataDiskCount: row.DataDiskCount,
            NicCount: row.NicCount,
            MetricCPUPercentage: row.PCPUPercentage,
            MetricMemoryPercentage: row.PMemoryPercentage,
            savingsAmount,
            CostsAmount: row.Last30DaysCost,
            currency: row.Currency,
          },
        }),
      );
    }

    for (const row of perfRows) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.perfConstrained, {
          instanceId: row.InstanceId,
          instanceName: row.VMSSName,
          resourceGroup: row.ResourceGroup,
          subscriptionId: row.SubscriptionId,
          tenantId: row.TenantId,
          tags: row.Tags,
          fitScore: row.PCPUMaxPercentage > cpuMaxThreshold && row.PCPUAvgPercentage > cpuAvgThreshold ? 4 : 3,
          additionalInfo: {
            currentSku: row.VMSSSize,
            InstanceCount: row.Capacity,
            MetricCPUAvgPercentage: row.PCPUAvgPercentage,
            MetricCPUMaxPercentage: row.PCPUMaxPercentage,
            MetricMemoryPercentage: row.PMemoryPercentage,
          },
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
