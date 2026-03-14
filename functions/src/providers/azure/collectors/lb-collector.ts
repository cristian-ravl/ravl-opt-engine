// Collector: Azure Load Balancers via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const LB_QUERY = `
resources
| where type =~ 'Microsoft.Network/loadBalancers'
| extend lbType = iif(properties.frontendIPConfigurations contains 'publicIPAddress', 'Public', iif(properties.frontendIPConfigurations contains 'privateIPAddress', 'Internal', 'Unknown'))
| extend lbRulesCount = array_length(properties.loadBalancingRules)
| extend frontendIPsCount = array_length(properties.frontendIPConfigurations)
| extend inboundNatRulesCount = array_length(properties.inboundNatRules)
| extend outboundRulesCount = array_length(properties.outboundRules)
| extend inboundNatPoolsCount = array_length(properties.inboundNatPools)
| extend backendPoolsCount = array_length(properties.backendAddressPools)
| extend probesCount = array_length(properties.probes)
| project id, name, resourceGroup, subscriptionId, tenantId, location, skuName = sku.name, skuTier = sku.tier, lbType, lbRulesCount, frontendIPsCount, inboundNatRulesCount, outboundRulesCount, inboundNatPoolsCount, backendPoolsCount, probesCount, tags
| join kind=leftouter (
    resources
    | where type =~ 'Microsoft.Network/loadBalancers'
    | mvexpand backendPools = properties.backendAddressPools
    | extend backendIPCount = array_length(backendPools.properties.backendIPConfigurations)
    | extend backendAddressesCount = array_length(backendPools.properties.loadBalancerBackendAddresses)
    | summarize backendIPCount = sum(backendIPCount), backendAddressesCount = sum(backendAddressesCount) by id
) on id
| project-away id1
| order by id asc
`;

export class LoadBalancerCollector extends AzureArgCollector {
  readonly id = 'azure-lb';
  readonly name = 'Azure Load Balancers';
  readonly targetSuffix = 'arglbexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [LB_QUERY];
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
      skuTier: row.skuTier ?? '',
      location: row.location,
      lbType: row.lbType ?? '',
      lbRulesCount: row.lbRulesCount ?? 0,
      inboundNatRulesCount: row.inboundNatRulesCount ?? 0,
      outboundRulesCount: row.outboundRulesCount ?? 0,
      frontendIPsCount: row.frontendIPsCount ?? 0,
      backendIPCount: row.backendIPCount ?? 0,
      backendAddressesCount: row.backendAddressesCount ?? 0,
      inboundNatPoolsCount: row.inboundNatPoolsCount ?? 0,
      backendPoolsCount: row.backendPoolsCount ?? 0,
      probesCount: row.probesCount ?? 0,
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
