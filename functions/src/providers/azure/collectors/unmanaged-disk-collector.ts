// Collector: Azure unmanaged VHD disks discovered from VM storage profiles.

import type { EngineContext } from '../../types.js';
import { AzureArgCollector } from './base-arg-collector.js';

export class UnmanagedDisksCollector extends AzureArgCollector {
  readonly id = 'azure-unmanaged-disks';
  readonly name = 'Azure unmanaged VHD disks';
  readonly targetSuffix = 'argunmanageddiskexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [
      `
resources
| where type =~ 'Microsoft.Compute/virtualMachines' and isnull(properties.storageProfile.osDisk.managedDisk)
| extend diskType = 'OS', diskCaching = tostring(properties.storageProfile.osDisk.caching), diskSize = toint(properties.storageProfile.osDisk.diskSizeGB)
| extend vhdUriParts = split(tostring(properties.storageProfile.osDisk.vhd.uri),'/')
| extend diskStorageAccountName = tostring(split(vhdUriParts[2],'.')[0]), diskContainerName = tostring(vhdUriParts[3]), diskVhdName = tostring(vhdUriParts[4])
| project tenantId, subscriptionId, resourceGroup, vmId=id, location, tags, diskType, diskCaching, diskSize, diskStorageAccountName, diskContainerName, diskVhdName
`,
      `
resources
| where type =~ 'Microsoft.Compute/virtualMachines' and isnull(properties.storageProfile.osDisk.managedDisk)
| mvexpand dataDisks = properties.storageProfile.dataDisks
| extend diskType = 'Data', diskCaching = tostring(dataDisks.caching), diskSize = toint(dataDisks.diskSizeGB)
| extend vhdUriParts = split(tostring(dataDisks.vhd.uri),'/')
| extend diskStorageAccountName = tostring(split(vhdUriParts[2],'.')[0]), diskContainerName = tostring(vhdUriParts[3]), diskVhdName = tostring(vhdUriParts[4])
| project tenantId, subscriptionId, resourceGroup, vmId=id, location, tags, diskType, diskCaching, diskSize, diskStorageAccountName, diskContainerName, diskVhdName
`,
    ];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    const diskStorageAccountName = String(row.diskStorageAccountName ?? '').toLowerCase();
    const diskContainerName = String(row.diskContainerName ?? '').toLowerCase();
    const diskVhdName = String(row.diskVhdName ?? '').toLowerCase();

    return {
      timestamp,
      cloud: 'Azure',
      tenantId: String(row.tenantId ?? ''),
      subscriptionId: String(row.subscriptionId ?? ''),
      resourceGroup: String(row.resourceGroup ?? '').toLowerCase(),
      diskName: diskVhdName,
      instanceId: `${diskStorageAccountName}/${diskContainerName}/${diskVhdName}`,
      ownerVMId: String(row.vmId ?? '').toLowerCase(),
      location: String(row.location ?? ''),
      deploymentModel: 'Unmanaged',
      diskType: String(row.diskType ?? ''),
      caching: String(row.diskCaching ?? ''),
      diskSizeGB: Number(row.diskSize ?? 0),
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
