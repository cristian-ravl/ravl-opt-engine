// Collector: Azure Application Gateways via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const APPGW_QUERY = `
resources
| where type =~ 'Microsoft.Network/applicationGateways'
| extend gatewayIPsCount = array_length(properties.gatewayIPConfigurations)
| extend frontendIPsCount = array_length(properties.frontendIPConfigurations)
| extend frontendPortsCount = array_length(properties.frontendPorts)
| extend backendPoolsCount = array_length(properties.backendAddressPools)
| extend httpSettingsCount = array_length(properties.backendHttpSettingsCollection)
| extend httpListenersCount = array_length(properties.httpListeners)
| extend urlPathMapsCount = array_length(properties.urlPathMaps)
| extend requestRoutingRulesCount = array_length(properties.requestRoutingRules)
| extend probesCount = array_length(properties.probes)
| extend rewriteRulesCount = array_length(properties.rewriteRuleSets)
| extend redirectConfsCount = array_length(properties.redirectConfigurations)
| project id, name, resourceGroup, subscriptionId, tenantId, location, zones, skuName = properties.sku.name, skuTier = properties.sku.tier, skuCapacity = properties.sku.capacity, enableHttp2 = properties.enableHttp2, gatewayIPsCount, frontendIPsCount, frontendPortsCount, httpSettingsCount, httpListenersCount, backendPoolsCount, urlPathMapsCount, requestRoutingRulesCount, probesCount, rewriteRulesCount, redirectConfsCount, tags
| join kind=leftouter (
    resources
    | where type =~ 'Microsoft.Network/applicationGateways'
    | mvexpand backendPools = properties.backendAddressPools
    | extend backendIPCount = array_length(backendPools.properties.backendIPConfigurations)
    | extend backendAddressesCount = array_length(backendPools.properties.backendAddresses)
    | summarize backendIPCount = sum(backendIPCount), backendAddressesCount = sum(backendAddressesCount) by id
) on id
| project-away id1
| order by id asc
`;

export class AppGatewayCollector extends AzureArgCollector {
  readonly id = 'azure-appgw';
  readonly name = 'Azure Application Gateways';
  readonly targetSuffix = 'argappgwexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [APPGW_QUERY];
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
      skuCapacity: row.skuCapacity ?? 0,
      location: row.location,
      zones: row.zones ?? [],
      enableHttp2: row.enableHttp2 ?? false,
      gatewayIPsCount: row.gatewayIPsCount ?? 0,
      frontendIPsCount: row.frontendIPsCount ?? 0,
      frontendPortsCount: row.frontendPortsCount ?? 0,
      backendIPCount: row.backendIPCount ?? 0,
      backendAddressesCount: row.backendAddressesCount ?? 0,
      httpSettingsCount: row.httpSettingsCount ?? 0,
      httpListenersCount: row.httpListenersCount ?? 0,
      backendPoolsCount: row.backendPoolsCount ?? 0,
      probesCount: row.probesCount ?? 0,
      urlPathMapsCount: row.urlPathMapsCount ?? 0,
      requestRoutingRulesCount: row.requestRoutingRulesCount ?? 0,
      rewriteRulesCount: row.rewriteRulesCount ?? 0,
      redirectConfsCount: row.redirectConfsCount ?? 0,
      statusDate: timestamp,
      tags: this.parseTags(row.tags),
    };
  }
}
