// Collector: Azure Availability Sets via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const AVAIL_SET_QUERY = `
resources
| where type =~ 'Microsoft.Compute/availabilitySets'
| project id, name, location, resourceGroup, subscriptionId, tenantId, skuName = tostring(sku.name), faultDomains = tostring(properties.platformFaultDomainCount), updateDomains = tostring(properties.platformUpdateDomainCount), vmCount = array_length(properties.virtualMachines), tags, zones
| order by id asc
`;

export class AvailabilitySetCollector extends AzureArgCollector {
  readonly id = 'azure-availset';
  readonly name = 'Azure Availability Sets';
  readonly targetSuffix = 'argavailsetexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [AVAIL_SET_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      instanceName: row.name,
      instanceId: row.id,
      skuName: row.skuName ?? '',
      location: row.location,
      faultDomains: parseInt(row.faultDomains as string, 10) || 0,
      updateDomains: parseInt(row.updateDomains as string, 10) || 0,
      vmCount: row.vmCount ?? 0,
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
      zones: row.zones ?? [],
    };
  }
}
