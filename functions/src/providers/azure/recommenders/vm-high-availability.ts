// Recommender: VM High Availability — checks availability set configuration,
// managed disk usage, and availability zone distribution.

import { AzureRecommender } from './base-recommender.js';
import type { EngineContext, Recommendation, RecommenderSubType } from '../../types.js';

const SUB_TYPES: Record<string, RecommenderSubType> = {
  lowFaultDomains: {
    subType: 'AvailSetLowFaultDomainCount',
    subTypeId: '255de20b-d5e4-4be5-9695-620b4a905774',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Availability Set fault domains should be 3 or at least half the VM count',
    action: 'Increase fault domain count to improve availability',
  },
  lowUpdateDomains: {
    subType: 'AvailSetLowUpdateDomainCount',
    subTypeId: '9764e285-2eca-46c5-b49e-649c039cf0cf',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Availability Set update domains should be at least half the VM count',
    action: 'Increase update domain count to improve rolling update safety',
  },
  unmanagedDisks: {
    subType: 'UnmanagedDisks',
    subTypeId: 'b576a069-b1f2-43a6-9134-5ee75376402a',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'VMs should use Managed Disks for higher availability and reliability',
    action: 'Migrate to Managed Disks',
  },
  singleInAvailSet: {
    subType: 'VMsSingleInAvailSet',
    subTypeId: 'fe577af5-dfa2-413a-82a9-f183196c1f49',
    category: 'HighAvailability',
    impact: 'Medium',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'VMs should not be the only instance in an Availability Set',
    action: 'Add more same-role VMs to the Availability Set',
  },
  vmsMultipleAZs: {
    subType: 'VMsMultipleAZs',
    subTypeId: '1a77887c-7375-434e-af19-c2543171e0b8',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'VMs should be placed in multiple Availability Zones',
    action: 'Distribute VMs across multiple Availability Zones',
  },
  vmssMultipleAZs: {
    subType: 'VMSSMultipleAZs',
    subTypeId: '47e5457c-b345-4372-b536-8887fa8f0298',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachineScaleSets',
    description: 'VMSS should be placed in multiple Availability Zones',
    action: 'Reprovision VMSS with enough Availability Zones',
  },
  unmanagedDisksVmss: {
    subType: 'UnmanagedDisksVMSS',
    subTypeId: '1bf03c4a-c402-4e6c-bf20-051b18af30e2',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachineScaleSets',
    description: 'VMSS should use Managed Disks for higher availability and manageability',
    action: 'Migrate VMSS disks to Managed Disks',
  },
  availSetSharedStorageAccount: {
    subType: 'AvailSetSharedStorageAccount',
    subTypeId: 'e530029f-9b6a-413a-99ed-81af54502bb9',
    category: 'HighAvailability',
    impact: 'High',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Virtual Machines in unmanaged Availability Sets should not share the same Storage Account',
    action: 'Migrate Virtual Machines disks to Managed Disks or keep the disks in a dedicated Storage Account per VM',
  },
  storageAccountsMultipleVMs: {
    subType: 'StorageAccountsMultipleVMs',
    subTypeId: 'b70f44fa-5ef9-4180-b2f9-9cc6be07ab3e',
    category: 'HighAvailability',
    impact: 'Medium',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Virtual Machines with unmanaged disks should not share the same Storage Account',
    action: 'Migrate Virtual Machines disks to Managed Disks or keep the disks in a dedicated Storage Account per VM',
  },
  vmsNoAvailSet: {
    subType: 'VMsNoAvailSet',
    subTypeId: '998b50d8-e654-417b-ab20-a31cb11629c0',
    category: 'HighAvailability',
    impact: 'Medium',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Virtual Machines should be placed in an Availability Set together with other instances with the same role',
    action: 'Add VM to an Availability Set together with other VMs of the same role',
  },
  disksMultipleStorageAccounts: {
    subType: 'DisksMultipleStorageAccounts',
    subTypeId: '024049e7-f63a-4e1c-b620-f011aafbc576',
    category: 'HighAvailability',
    impact: 'Medium',
    impactedArea: 'Microsoft.Compute/virtualMachines',
    description: 'Each Virtual Machine should have its unmanaged disks stored in a single Storage Account for higher availability and manageability',
    action: 'Migrate Virtual Machines disks to Managed Disks or move VHDs to the same Storage Account',
  },
};

export class VmHighAvailabilityRecommender extends AzureRecommender {
  readonly id = 'vm-high-availability';
  readonly name = 'VM High Availability';
  readonly subTypes = Object.values(SUB_TYPES);

  async generateRecommendations(ctx: EngineContext): Promise<Recommendation[]> {
    const recommendations: Recommendation[] = [];

    // 1. Availability Set checks
    const availSetKql = `
      AvailabilitySets
      | summarize arg_max(Timestamp, *) by InstanceId
    `;
    const availSets = await this.queryAdx<{
      InstanceId: string;
      InstanceName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      FaultDomains: number;
      UpdateDomains: number;
      VmCount: number;
      SkuName: string;
    }>(ctx, availSetKql);

    for (const as of availSets) {
      if (as.VmCount === 0) continue;

      // Low fault domains
      if (as.FaultDomains < 3 && as.FaultDomains < Math.ceil(as.VmCount / 2)) {
        const fitScore = Math.max(1, 5 - (as.FaultDomains / Math.max(1, Math.ceil(as.VmCount / 2))) * 4);
        recommendations.push(
          this.createRecommendation(SUB_TYPES.lowFaultDomains, {
            instanceId: as.InstanceId,
            instanceName: as.InstanceName,
            resourceGroup: as.ResourceGroup,
            subscriptionId: as.SubscriptionId,
            tenantId: as.TenantId,
            tags: as.Tags,
            fitScore,
            additionalInfo: { faultDomains: as.FaultDomains, updateDomains: as.UpdateDomains, vmCount: as.VmCount },
          }),
        );
      }

      // Low update domains
      if (as.UpdateDomains < Math.ceil(as.VmCount / 2)) {
        const fitScore = Math.max(1, 5 - (as.UpdateDomains / Math.max(1, Math.ceil(as.VmCount / 2))) * 4);
        recommendations.push(
          this.createRecommendation(SUB_TYPES.lowUpdateDomains, {
            instanceId: as.InstanceId,
            instanceName: as.InstanceName,
            resourceGroup: as.ResourceGroup,
            subscriptionId: as.SubscriptionId,
            tenantId: as.TenantId,
            tags: as.Tags,
            fitScore,
            additionalInfo: { faultDomains: as.FaultDomains, updateDomains: as.UpdateDomains, vmCount: as.VmCount },
          }),
        );
      }

      // Single VM in availability set
      if (as.VmCount === 1) {
        recommendations.push(
          this.createRecommendation(SUB_TYPES.singleInAvailSet, {
            instanceId: as.InstanceId,
            instanceName: as.InstanceName,
            resourceGroup: as.ResourceGroup,
            subscriptionId: as.SubscriptionId,
            tenantId: as.TenantId,
            tags: as.Tags,
            fitScore: 3,
            additionalInfo: { vmCount: as.VmCount },
          }),
        );
      }
    }

    // 2. VMs using unmanaged disks
    const unmanagedKql = `
      LatestVMs
      | where UsesManagedDisks == false
    `;
    const unmanagedVMs = await this.queryAdx<{
      InstanceId: string;
      VMName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
    }>(ctx, unmanagedKql);

    for (const vm of unmanagedVMs) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.unmanagedDisks, {
          instanceId: vm.InstanceId,
          instanceName: vm.VMName,
          resourceGroup: vm.ResourceGroup,
          subscriptionId: vm.SubscriptionId,
          tenantId: vm.TenantId,
          tags: vm.Tags,
          fitScore: 5,
        }),
      );
    }

    // 2b. Availability Sets sharing the same unmanaged storage account across VMs
    const availSetSharedStorageKql = `
      let availabilitySets = AvailabilitySets
        | summarize arg_max(Timestamp, *) by InstanceId
        | project AvailabilitySetId = InstanceId, AvailabilitySetName = InstanceName;
      UnmanagedDisks
      | extend StorageAccountName = tostring(split(InstanceId, '/')[0])
      | join kind=inner (
          LatestVMs
          | where isnotempty(AvailabilitySetId)
          | project VMId = InstanceId, AvailabilitySetId, ResourceGroup, SubscriptionId, TenantId, Tags
      ) on $left.OwnerVMId == $right.VMId
      | summarize VMCount = dcount(OwnerVMId), Tags = any(Tags) by AvailabilitySetId, StorageAccountName, ResourceGroup, SubscriptionId, TenantId
      | where VMCount > 1
      | summarize SharedStorageAccountName = any(StorageAccountName), Tags = any(Tags) by AvailabilitySetId, ResourceGroup, SubscriptionId, TenantId
      | join kind=leftouter availabilitySets on AvailabilitySetId
      | project AvailabilitySetId, AvailabilitySetName, SharedStorageAccountName, ResourceGroup, SubscriptionId, TenantId, Tags
    `;
    const sharedStorageAvailabilitySets = await this.queryAdx<{
      AvailabilitySetId: string;
      AvailabilitySetName: string;
      SharedStorageAccountName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
    }>(ctx, availSetSharedStorageKql);

    for (const availabilitySet of sharedStorageAvailabilitySets) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.availSetSharedStorageAccount, {
          instanceId: availabilitySet.AvailabilitySetId,
          instanceName: availabilitySet.AvailabilitySetName,
          resourceGroup: availabilitySet.ResourceGroup,
          subscriptionId: availabilitySet.SubscriptionId,
          tenantId: availabilitySet.TenantId,
          tags: availabilitySet.Tags,
          fitScore: 5,
          additionalInfo: {
            SharedStorageAccountName: availabilitySet.SharedStorageAccountName,
          },
        }),
      );
    }

    // 2c. Unmanaged storage accounts hosting disks for multiple VMs
    const storageAccountsMultipleVmKql = `
      UnmanagedDisks
      | extend StorageAccountName = tostring(split(InstanceId, '/')[0])
      | join kind=leftouter (
          LatestVMs
          | project VMId = InstanceId, Tags
      ) on $left.OwnerVMId == $right.VMId
      | summarize VMCount = dcount(OwnerVMId), Tags = any(Tags) by StorageAccountName, SubscriptionId, TenantId, ResourceGroup
      | where VMCount > 1
      | extend StorageAccountId = strcat('/subscriptions/', SubscriptionId, '/resourceGroups/', ResourceGroup, '/providers/microsoft.storage/storageaccounts/', StorageAccountName)
      | project StorageAccountId, StorageAccountName, VMCount, ResourceGroup, SubscriptionId, TenantId, Tags
    `;
    const sharedStorageAccounts = await this.queryAdx<{
      StorageAccountId: string;
      StorageAccountName: string;
      VMCount: number;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
    }>(ctx, storageAccountsMultipleVmKql);

    for (const storageAccount of sharedStorageAccounts) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.storageAccountsMultipleVMs, {
          instanceId: storageAccount.StorageAccountId,
          instanceName: storageAccount.StorageAccountName,
          resourceGroup: storageAccount.ResourceGroup,
          subscriptionId: storageAccount.SubscriptionId,
          tenantId: storageAccount.TenantId,
          tags: storageAccount.Tags,
          fitScore: 5,
          additionalInfo: {
            VirtualMachineCount: storageAccount.VMCount,
          },
        }),
      );
    }

    // 2d. VMs not protected by Availability Sets or Availability Zones
    const vmsNoAvailSetKql = `
      LatestVMs
      | where isempty(AvailabilitySetId) and array_length(Zones) == 0
      | where not(Tags has 'databricks-instance-name')
      | project InstanceId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags
    `;
    const vmsWithoutAvailabilitySets = await this.queryAdx<{
      InstanceId: string;
      VMName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
    }>(ctx, vmsNoAvailSetKql);

    for (const vm of vmsWithoutAvailabilitySets) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.vmsNoAvailSet, {
          instanceId: vm.InstanceId,
          instanceName: vm.VMName,
          resourceGroup: vm.ResourceGroup,
          subscriptionId: vm.SubscriptionId,
          tenantId: vm.TenantId,
          tags: vm.Tags,
          fitScore: 5,
        }),
      );
    }

    // 2e. VMs whose unmanaged disks span multiple storage accounts
    const multipleStorageAccountDisksKql = `
      UnmanagedDisks
      | extend StorageAccountName = tostring(split(InstanceId, '/')[0])
      | summarize StorageAccountCount = dcount(StorageAccountName) by OwnerVMId
      | where StorageAccountCount > 1
      | join kind=inner (
          LatestVMs
          | project VMId = InstanceId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags
      ) on $left.OwnerVMId == $right.VMId
      | project InstanceId = VMId, VMName, ResourceGroup, SubscriptionId, TenantId, Tags, StorageAccountCount
    `;
    const disksAcrossMultipleStorageAccounts = await this.queryAdx<{
      InstanceId: string;
      VMName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      StorageAccountCount: number;
    }>(ctx, multipleStorageAccountDisksKql);

    for (const vm of disksAcrossMultipleStorageAccounts) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.disksMultipleStorageAccounts, {
          instanceId: vm.InstanceId,
          instanceName: vm.VMName,
          resourceGroup: vm.ResourceGroup,
          subscriptionId: vm.SubscriptionId,
          tenantId: vm.TenantId,
          tags: vm.Tags,
          fitScore: 5,
          additionalInfo: {
            StorageAccountsUsed: vm.StorageAccountCount,
          },
        }),
      );
    }

    // 3. Resource groups with zonal VMs that are not spread across enough AZs
    const zonalVmKql = `
      let subscriptions = ResourceContainers
        | where ContainerType =~ 'Subscription'
        | summarize arg_max(Timestamp, *) by SubscriptionId
        | project SubscriptionId, SubscriptionName = ContainerName;
      let zonalVms = LatestVMs
        | where isempty(AvailabilitySetId)
        | where array_length(Zones) > 0;
      let zoneSummary = zonalVms
        | mv-expand Zone = Zones to typeof(string)
        | summarize ZonesCount = dcount(Zone) by ResourceGroup, SubscriptionId, TenantId;
      let runningVmCounts = zonalVms
        | where tostring(PowerState) has 'running'
        | summarize VMCount = dcount(InstanceId) by ResourceGroup, SubscriptionId;
      zoneSummary
      | where ZonesCount < 3
      | join kind=inner runningVmCounts on ResourceGroup, SubscriptionId
      | where VMCount == 1 or VMCount > ZonesCount
      | join kind=leftouter subscriptions on SubscriptionId
      | extend InstanceId = strcat('/subscriptions/', SubscriptionId, '/resourceGroups/', ResourceGroup)
      | project InstanceId, InstanceName = ResourceGroup, ResourceGroup, SubscriptionId, SubscriptionName, TenantId, ZonesCount, VMCount
    `;
    const zonalVmGroups = await this.queryAdx<{
      InstanceId: string;
      InstanceName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      SubscriptionName: string;
      TenantId: string;
      ZonesCount: number;
      VMCount: number;
    }>(ctx, zonalVmKql);

    for (const resourceGroup of zonalVmGroups) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.vmsMultipleAZs, {
          instanceId: resourceGroup.InstanceId,
          instanceName: resourceGroup.InstanceName,
          resourceGroup: resourceGroup.ResourceGroup,
          subscriptionId: resourceGroup.SubscriptionId,
          subscriptionName: resourceGroup.SubscriptionName,
          tenantId: resourceGroup.TenantId,
          fitScore: 4,
          detailsUrl: `https://portal.azure.com/#@${resourceGroup.TenantId}/resource${resourceGroup.InstanceId}/overview`,
          additionalInfo: {
            zonesCount: resourceGroup.ZonesCount,
            vmsCount: resourceGroup.VMCount,
          },
        }),
      );
    }

    // 4. VMSS not in multiple AZs
    const vmssKql = `
      VirtualMachineScaleSets
      | summarize arg_max(Timestamp, *) by InstanceId
      | where (array_length(Zones) < 2 and Capacity > 1) or (array_length(Zones) != 3 and Capacity > 2)
    `;
    const vmssResults = await this.queryAdx<{
      InstanceId: string;
      VMSSName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
      Zones: string[];
    }>(ctx, vmssKql);

    for (const vmss of vmssResults) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.vmssMultipleAZs, {
          instanceId: vmss.InstanceId,
          instanceName: vmss.VMSSName,
          resourceGroup: vmss.ResourceGroup,
          subscriptionId: vmss.SubscriptionId,
          tenantId: vmss.TenantId,
          tags: vmss.Tags,
          fitScore: 4,
          additionalInfo: { currentZones: vmss.Zones },
        }),
      );
    }

    // 5. VMSS using unmanaged disks
    const unmanagedVmssKql = `
      VirtualMachineScaleSets
      | summarize arg_max(Timestamp, *) by InstanceId
      | where UsesManagedDisks == false
      | project InstanceId, VMSSName, ResourceGroup, SubscriptionId, TenantId, Tags
    `;
    const unmanagedVmss = await this.queryAdx<{
      InstanceId: string;
      VMSSName: string;
      ResourceGroup: string;
      SubscriptionId: string;
      TenantId: string;
      Tags: Record<string, string>;
    }>(ctx, unmanagedVmssKql);

    for (const vmss of unmanagedVmss) {
      recommendations.push(
        this.createRecommendation(SUB_TYPES.unmanagedDisksVmss, {
          instanceId: vmss.InstanceId,
          instanceName: vmss.VMSSName,
          resourceGroup: vmss.ResourceGroup,
          subscriptionId: vmss.SubscriptionId,
          tenantId: vmss.TenantId,
          tags: vmss.Tags,
          fitScore: 5,
        }),
      );
    }

    await this.persistRecommendations(ctx, recommendations);
    return recommendations;
  }
}
