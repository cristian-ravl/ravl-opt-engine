// Collector: Azure Public IP Addresses via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const PUBLIC_IP_QUERY = `
resources
| where type =~ 'microsoft.network/publicipaddresses'
| extend skuName = tolower(sku.name)
| extend skuTier = tolower(sku.tier)
| extend allocationMethod = tolower(properties.publicIPAllocationMethod)
| extend addressVersion = tolower(properties.publicIPAddressVersion)
| extend associatedResourceId = iif(isnotempty(properties.ipConfiguration.id),tolower(properties.ipConfiguration.id),tolower(properties.natGateway.id))
| extend ipAddress = tostring(properties.ipAddress)
| extend fqdn = tolower(properties.dnsSettings.fqdn)
| extend publicIpPrefixId = tostring(properties.publicIPPrefix.id)
| order by id asc
`;

export class PublicIpCollector extends AzureArgCollector {
  readonly id = 'azure-publicip';
  readonly name = 'Azure Public IP Addresses';
  readonly targetSuffix = 'argpublicipexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [PUBLIC_IP_QUERY];
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
      model: 'ARM',
      skuName: row.skuName ?? '',
      skuTier: row.skuTier ?? '',
      allocationMethod: row.allocationMethod ?? '',
      addressVersion: row.addressVersion ?? '',
      associatedResourceId: row.associatedResourceId ?? '',
      publicIpPrefixId: row.publicIpPrefixId ?? '',
      ipAddress: row.ipAddress ?? '',
      fqdn: row.fqdn ?? '',
      zones: row.zones ?? [],
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
