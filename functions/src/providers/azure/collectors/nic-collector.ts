// Collector: Azure Network Interfaces via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const NIC_QUERY = `
resources
| where type =~ 'microsoft.network/networkinterfaces'
| extend isPrimary = properties.primary
| extend enableAcceleratedNetworking = properties.enableAcceleratedNetworking
| extend enableIPForwarding = properties.enableIPForwarding
| extend tapConfigurationsCount = array_length(properties.tapConfigurations)
| extend hostedWorkloadsCount = array_length(properties.hostedWorkloads)
| extend internalDomainNameSuffix = properties.dnsSettings.internalDomainNameSuffix
| extend ownerVMId = tolower(properties.virtualMachine.id)
| extend ownerPEId = tolower(properties.privateEndpoint.id)
| extend macAddress = properties.macAddress
| extend nicType = properties.nicType
| extend nicNsgId = tolower(properties.networkSecurityGroup.id)
| mv-expand ipconfigs = properties.ipConfigurations
| project-away properties
| extend privateIPAddressVersion = tostring(ipconfigs.properties.privateIPAddressVersion)
| extend privateIPAllocationMethod = tostring(ipconfigs.properties.privateIPAllocationMethod)
| extend isIPConfigPrimary = tostring(ipconfigs.properties.primary)
| extend privateIPAddress = tostring(ipconfigs.properties.privateIPAddress)
| extend publicIPId = tolower(ipconfigs.properties.publicIPAddress.id)
| extend IPConfigName = tostring(ipconfigs.name)
| extend subnetId = tolower(ipconfigs.properties.subnet.id)
| project-away ipconfigs
| order by id asc
`;

export class NicCollector extends AzureArgCollector {
  readonly id = 'azure-nic';
  readonly name = 'Azure Network Interfaces';
  readonly targetSuffix = 'argnicexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [NIC_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      location: row.location,
      name: row.name,
      instanceId: row.id,
      isPrimary: row.isPrimary ?? false,
      enableAcceleratedNetworking: row.enableAcceleratedNetworking ?? false,
      enableIPForwarding: row.enableIPForwarding ?? false,
      tapConfigurationsCount: row.tapConfigurationsCount ?? 0,
      hostedWorkloadsCount: row.hostedWorkloadsCount ?? 0,
      internalDomainNameSuffix: row.internalDomainNameSuffix ?? '',
      ownerVMId: row.ownerVMId ?? '',
      ownerPEId: row.ownerPEId ?? '',
      macAddress: row.macAddress ?? '',
      nicType: row.nicType ?? '',
      nicNSGId: row.nicNsgId ?? '',
      privateIPAddressVersion: row.privateIPAddressVersion ?? '',
      privateIPAllocationMethod: row.privateIPAllocationMethod ?? '',
      isIPConfigPrimary: row.isIPConfigPrimary === 'true',
      privateIPAddress: row.privateIPAddress ?? '',
      publicIPId: row.publicIPId ?? '',
      ipConfigName: row.IPConfigName ?? '',
      subnetId: row.subnetId ?? '',
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
