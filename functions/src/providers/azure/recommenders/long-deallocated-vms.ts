// Recommender: Long-deallocated VMs — VMs deallocated for longer than threshold
// with lingering disk costs.

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPE: RecommenderSubType = {
  subType: 'LongDeallocatedVms',
  subTypeId: 'c320b790-2e58-452a-aa63-7b62c383ad8a',
  category: 'Cost',
  impact: 'Medium',
  impactedArea: 'Microsoft.Compute/virtualMachines',
  description: 'VM has been deallocated for a long time with disks still incurring costs',
  action: 'Delete the VM or downgrade disks to Standard HDD to reduce costs',
};

export class LongDeallocatedVmsRecommender extends AzureRecommender {
  readonly id = 'long-deallocated-vms';
  readonly name = 'Long Deallocated VMs';
  readonly subTypes = [SUB_TYPE];

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const thresholdDays = ctx.longDeallocatedVmDays;

    // Find VMs that have been deallocated (PowerState contains "deallocated") for longer
    // than the configured threshold by looking at the latest snapshot
    const kql = `
      let latestVMs = LatestVMs
        | where PowerState has "deallocated"
        | project InstanceId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, VMSize, StatusDate;
      let runningVMs = LatestVMs
        | where PowerState has "running"
        | distinct InstanceId;
      let deallocatedVMs = latestVMs
        | join kind=leftanti runningVMs on InstanceId
        | where StatusDate < ago(${thresholdDays}d);
      let diskCosts = CostData
        | where Timestamp > ago(30d)
        | where MeterCategory has "Storage" or MeterCategory has "Disks"
        | summarize DiskCost30d = sum(Cost), Currency = any(Currency) by InstanceId = tolower(InstanceId);
      let vmDisks = LatestDisks
        | where isnotempty(OwnerVMId)
        | project DiskInstanceId = InstanceId, OwnerVMId = tolower(OwnerVMId), DiskSizeGB, SKU;
      deallocatedVMs
        | extend InstanceIdLower = tolower(InstanceId)
        | join kind=leftouter (
            vmDisks
            | join kind=leftouter diskCosts on $left.DiskInstanceId == $right.InstanceId
            | summarize TotalDiskCost30d = sum(DiskCost30d), DiskCount = count(), TotalDiskSizeGB = sum(DiskSizeGB), Currency = any(Currency) by OwnerVMId
        ) on $left.InstanceIdLower == $right.OwnerVMId
        | project InstanceId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags, Location, VMSize, StatusDate, TotalDiskCost30d = coalesce(TotalDiskCost30d, 0.0), DiskCount = coalesce(DiskCount, 0), TotalDiskSizeGB = coalesce(TotalDiskSizeGB, 0), Currency = coalesce(Currency, "USD")
    `;

    const results = await this.queryAdx<{
      InstanceId: string;
      VMName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Location: string;
      VMSize: string;
      StatusDate: string;
      TotalDiskCost30d: number;
      DiskCount: number;
      TotalDiskSizeGB: number;
      Currency: string;
    }>(ctx, kql);

    const recommendations = results.map((vm) =>
      this.createRecommendation(SUB_TYPE, {
        instanceId: vm.InstanceId,
        instanceName: vm.VMName,
        resourceGroup: vm.ResourceGroup,
        subscriptionId: vm.SubscriptionId,
        tenantId: vm.TenantId,
        tags: vm.Tags,
        fitScore: 5,
        additionalInfo: {
          currentSku: vm.VMSize,
          location: vm.Location,
          deallocatedSince: vm.StatusDate,
          diskCost30d: vm.TotalDiskCost30d,
          diskCount: vm.DiskCount,
          totalDiskSizeGB: vm.TotalDiskSizeGB,
          currency: vm.Currency,
          savingsAmount: vm.TotalDiskCost30d * 12,
          savingsCurrency: vm.Currency,
        },
      }),
    );

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
