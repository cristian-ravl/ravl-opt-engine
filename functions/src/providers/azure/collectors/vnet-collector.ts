// Collector: Azure Virtual Networks via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const VNET_QUERY = `
resources
| where type =~ 'microsoft.network/virtualnetworks'
| mv-expand subnets = properties.subnets limit 400
| extend peeringsCount = array_length(properties.virtualNetworkPeerings)
| extend vnetPrefixes = properties.addressSpace.addressPrefixes
| extend dnsServers = properties.dhcpOptions.dnsServers
| extend enableDdosProtection = properties.enableDdosProtection
| project-away properties
| extend subnetPrefix = tostring(subnets.properties.addressPrefix)
| extend subnetDelegationsCount = array_length(subnets.properties.delegations)
| extend subnetUsedIPs = iif(isnotempty(subnets.properties.ipConfigurations), array_length(subnets.properties.ipConfigurations), 0)
| extend subnetTotalPrefixIPs = pow(2, 32 - toint(split(subnetPrefix,'/')[1])) - 5
| extend subnetNsgId = tolower(subnets.properties.networkSecurityGroup.id)
| project id, vnetName = name, resourceGroup, subscriptionId, tenantId, location, vnetPrefixes, dnsServers, subnetName = tolower(tostring(subnets.name)), subnetPrefix, subnetDelegationsCount, subnetTotalPrefixIPs, subnetUsedIPs, subnetNsgId, peeringsCount, enableDdosProtection, tags
| order by id asc
`;

export class VnetCollector extends AzureArgCollector {
  readonly id = 'azure-vnet';
  readonly name = 'Azure Virtual Networks';
  readonly targetSuffix = 'argvnetexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [VNET_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      location: row.location,
      vnetName: row.vnetName ?? row.name,
      instanceId: row.id,
      model: 'ARM',
      vnetPrefixes: row.vnetPrefixes ?? [],
      dnsServers: row.dnsServers ?? [],
      peeringsCount: row.peeringsCount ?? 0,
      enableDdosProtection: row.enableDdosProtection ?? false,
      subnetName: row.subnetName ?? '',
      subnetPrefix: row.subnetPrefix ?? '',
      subnetDelegationsCount: row.subnetDelegationsCount ?? 0,
      subnetTotalPrefixIPs: row.subnetTotalPrefixIPs ?? 0,
      subnetUsedIPs: row.subnetUsedIPs ?? 0,
      subnetNSGId: row.subnetNsgId ?? '',
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
