// Collector: Azure Managed Disks via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const DISK_QUERY = `
resources
| where type =~ 'Microsoft.Compute/disks'
| extend DiskId = tolower(id), OwnerVmId = tolower(managedBy)
| join kind=leftouter (
    resources
    | where type =~ 'Microsoft.Compute/virtualMachines' and array_length(properties.storageProfile.dataDisks) > 0
    | extend OwnerVmId = tolower(id)
    | mv-expand DataDisks = properties.storageProfile.dataDisks
    | extend DiskId = tolower(DataDisks.managedDisk.id), diskCaching = tostring(DataDisks.caching), diskType = 'Data'
    | project DiskId, OwnerVmId, diskCaching, diskType
    | union (
        resources
        | where type =~ 'Microsoft.Compute/virtualMachines'
        | extend OwnerVmId = tolower(id)
        | extend DiskId = tolower(properties.storageProfile.osDisk.managedDisk.id), diskCaching = tostring(properties.storageProfile.osDisk.caching), diskType = 'OS'
        | project DiskId, OwnerVmId, diskCaching, diskType
    )
) on OwnerVmId, DiskId
| project-away OwnerVmId, DiskId, OwnerVmId1, DiskId1
| order by id asc
`;

export class ManagedDisksCollector extends AzureArgCollector {
  readonly id = 'azure-disk';
  readonly name = 'Azure Managed Disks';
  readonly targetSuffix = 'argdiskexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [DISK_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    const props = (row.properties as
      | {
          timeCreated?: string;
          diskIOPSReadWrite?: number;
          diskMBpsReadWrite?: number;
          tier?: string;
          diskState?: string;
          encryption?: { type?: string };
          diskSizeGB?: number;
        }
      | undefined) ?? {};
    const sku = (row.sku as { name?: string } | undefined) ?? {};
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      diskName: row.name,
      instanceId: row.id,
      location: row.location,
      ownerVMId: row.managedBy ?? '',
      deploymentModel: 'Managed',
      diskType: row.diskType ?? '',
      timeCreated: props.timeCreated ?? '',
      diskIOPS: props.diskIOPSReadWrite ?? 0,
      diskThroughput: props.diskMBpsReadWrite ?? 0,
      diskTier: props.tier ?? '',
      diskState: props.diskState ?? '',
      encryptionType: props.encryption?.type ?? '',
      zones: row.zones ?? [],
      caching: row.diskCaching ?? '',
      diskSizeGB: props.diskSizeGB ?? 0,
      sku: sku.name ?? '',
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
