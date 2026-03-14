// Collector: Azure Virtual Machine Scale Sets via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import { findComputeSkuDetails, loadComputeSkuCatalog } from './compute-sku.js';
import type { EngineContext } from '../../types.js';

const VMSS_QUERY = `
resources
| where type =~ 'microsoft.compute/virtualmachinescalesets'
| project id, tenantId, name, location, resourceGroup, subscriptionId, skuName = tostring(sku.name),
    computerNamePrefix = tostring(properties.virtualMachineProfile.osProfile.computerNamePrefix),
    usesManagedDisks = iif(isnull(properties.virtualMachineProfile.storageProfile.osDisk.managedDisk), 'false', 'true'),
    capacity = tostring(sku.capacity), priority = tostring(properties.virtualMachineProfile.priority), tags, zones,
    osType = iif(isnotnull(properties.virtualMachineProfile.osProfile.linuxConfiguration), "Linux", "Windows"),
    osDiskSize = tostring(properties.virtualMachineProfile.storageProfile.osDisk.diskSizeGB),
    osDiskCaching = tostring(properties.virtualMachineProfile.storageProfile.osDisk.caching),
    osDiskSKU = tostring(properties.virtualMachineProfile.storageProfile.osDisk.managedDisk.storageAccountType),
    dataDiskCount = iif(isnotnull(properties.virtualMachineProfile.storageProfile.dataDisks), array_length(properties.virtualMachineProfile.storageProfile.dataDisks), 0),
    nicCount = array_length(properties.virtualMachineProfile.networkProfile.networkInterfaceConfigurations),
    imagePublisher = iif(isnotempty(properties.virtualMachineProfile.storageProfile.imageReference.publisher),tostring(properties.virtualMachineProfile.storageProfile.imageReference.publisher),'Custom'),
    imageOffer = iif(isnotempty(properties.virtualMachineProfile.storageProfile.imageReference.offer),tostring(properties.virtualMachineProfile.storageProfile.imageReference.offer),tostring(properties.virtualMachineProfile.storageProfile.imageReference.id)),
    imageSku = tostring(properties.virtualMachineProfile.storageProfile.imageReference.sku),
    imageVersion = tostring(properties.virtualMachineProfile.storageProfile.imageReference.version),
    imageExactVersion = tostring(properties.virtualMachineProfile.storageProfile.imageReference.exactVersion),
    singlePlacementGroup = tostring(properties.singlePlacementGroup),
    upgradePolicy = tostring(properties.upgradePolicy.mode),
    overProvision = tostring(properties.overprovision),
    platformFaultDomainCount = tostring(properties.platformFaultDomainCount),
    zoneBalance = tostring(properties.zoneBalance)
| order by id asc
`;

export class VmssCollector extends AzureArgCollector {
  readonly id = 'azure-vmss';
  readonly name = 'Azure Virtual Machine Scale Sets';
  readonly targetSuffix = 'argvmssexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [VMSS_QUERY];
  }

  protected async mapRows(rows: Record<string, unknown>[], ctx: EngineContext, timestamp: string): Promise<Record<string, unknown>[]> {
    let skuCatalog = new Map();
    try {
      skuCatalog = await loadComputeSkuCatalog(ctx);
    } catch {
      skuCatalog = new Map();
    }

    return rows.map((row) => {
      const mapped = this.mapRow(row, timestamp);
      const details = findComputeSkuDetails(skuCatalog, 'virtualMachineScaleSets', String(row.location ?? ''), String(row.skuName ?? ''));

      return {
        ...mapped,
        coresCount: details?.coresCount ?? 0,
        memoryMB: details?.memoryMB ?? 0,
      };
    });
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      zones: row.zones ?? [],
      location: row.location,
      vmssName: row.name,
      computerNamePrefix: row.computerNamePrefix ?? '',
      instanceId: row.id,
      vmssSize: row.skuName ?? '',
      coresCount: 0,
      memoryMB: 0,
      osType: row.osType ?? '',
      dataDiskCount: row.dataDiskCount ?? 0,
      nicCount: row.nicCount ?? 0,
      capacity: parseInt(row.capacity as string, 10) || 0,
      priority: row.priority ?? '',
      osDiskSize: parseInt(row.osDiskSize as string, 10) || 0,
      osDiskCaching: row.osDiskCaching ?? '',
      osDiskSKU: row.osDiskSKU ?? '',
      singlePlacementGroup: row.singlePlacementGroup === 'true',
      upgradePolicy: row.upgradePolicy ?? '',
      overProvision: row.overProvision === 'true',
      platformFaultDomainCount: parseInt(row.platformFaultDomainCount as string, 10) || 0,
      zoneBalance: row.zoneBalance === 'true',
      usesManagedDisks: row.usesManagedDisks === 'true',
      imagePublisher: row.imagePublisher ?? '',
      imageOffer: row.imageOffer ?? '',
      imageSku: row.imageSku ?? '',
      imageVersion: row.imageVersion ?? '',
      imageExactVersion: row.imageExactVersion ?? '',
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
