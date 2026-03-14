// Collector: Azure Virtual Machines via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import { findComputeSkuDetails, loadComputeSkuCatalog } from './compute-sku.js';
import type { EngineContext } from '../../types.js';

type VmImageReference = {
  publisher?: string;
  offer?: string;
  sku?: string;
  version?: string;
  exactVersion?: string;
  id?: string;
};

type VmStorageProfile = {
  osDisk?: {
    osType?: string;
  };
  imageReference?: VmImageReference;
};

type VmHardwareProfile = {
  vmSize?: string;
};

type VmProperties = {
  hardwareProfile?: VmHardwareProfile;
  storageProfile?: VmStorageProfile;
  licenseType?: string;
};

const ARM_VM_QUERY = `
resources
| where type =~ 'Microsoft.Compute/virtualMachines'
| extend dataDiskCount = array_length(properties.storageProfile.dataDisks), nicCount = array_length(properties.networkProfile.networkInterfaces)
| extend usesManagedDisks = iif(isnull(properties.storageProfile.osDisk.managedDisk), 'false', 'true')
| extend availabilitySetId = tostring(properties.availabilitySet.id)
| extend bootDiagnosticsEnabled = tostring(properties.diagnosticsProfile.bootDiagnostics.enabled)
| extend bootDiagnosticsStorageAccount = split(split(properties.diagnosticsProfile.bootDiagnostics.storageUri, '/')[2],'.')[0]
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| extend imagePublisher = iif(isnotempty(properties.storageProfile.imageReference.publisher),tostring(properties.storageProfile.imageReference.publisher),'Custom')
| extend imageOffer = iif(isnotempty(properties.storageProfile.imageReference.offer),tostring(properties.storageProfile.imageReference.offer),tostring(properties.storageProfile.imageReference.id))
| extend imageSku = tostring(properties.storageProfile.imageReference.sku)
| extend imageVersion = tostring(properties.storageProfile.imageReference.version)
| extend imageExactVersion = tostring(properties.storageProfile.imageReference.exactVersion)
| extend osName = tostring(properties.extended.instanceView.osName)
| extend osVersion = tostring(properties.extended.instanceView.osVersion)
| order by id asc
`;

export class VirtualMachinesCollector extends AzureArgCollector {
  readonly id = 'azure-vm';
  readonly name = 'Azure Virtual Machines';
  readonly targetSuffix = 'argvmexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [ARM_VM_QUERY];
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
      const properties = (row.properties as VmProperties | undefined) ?? {};
      const vmSize = String(properties.hardwareProfile?.vmSize ?? '');
      const details = findComputeSkuDetails(skuCatalog, 'virtualMachines', String(row.location ?? ''), vmSize);

      return {
        ...mapped,
        coresCount: details?.coresCount ?? 0,
        memoryMB: details?.memoryMB ?? 0,
      };
    });
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    const properties = (row.properties as VmProperties | undefined) ?? {};
    const storageProfile = properties.storageProfile ?? {};
    const imageReference = storageProfile.imageReference ?? {};

    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      zones: row.zones ?? [],
      location: row.location,
      vmName: row.name,
      deploymentModel: 'ARM',
      instanceId: row.id,
      vmSize: properties.hardwareProfile?.vmSize ?? '',
      coresCount: 0,
      memoryMB: 0,
      osType: storageProfile.osDisk?.osType ?? '',
      licenseType: properties.licenseType ?? '',
      dataDiskCount: row.dataDiskCount ?? 0,
      nicCount: row.nicCount ?? 0,
      usesManagedDisks: row.usesManagedDisks === 'true',
      availabilitySetId: row.availabilitySetId ?? '',
      bootDiagnosticsEnabled: row.bootDiagnosticsEnabled === 'true',
      bootDiagnosticsStorageAccount: row.bootDiagnosticsStorageAccount ?? '',
      powerState: row.powerState ?? '',
      imagePublisher: row.imagePublisher ?? imageReference.publisher ?? '',
      imageOffer: row.imageOffer ?? imageReference.offer ?? imageReference.id ?? '',
      imageSku: row.imageSku ?? imageReference.sku ?? '',
      imageVersion: row.imageVersion ?? imageReference.version ?? '',
      imageExactVersion: row.imageExactVersion ?? imageReference.exactVersion ?? '',
      osName: row.osName ?? '',
      osVersion: row.osVersion ?? '',
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
