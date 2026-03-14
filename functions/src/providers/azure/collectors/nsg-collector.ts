// Collector: Azure Network Security Groups via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const NSG_QUERY = `
resources
| where type =~ 'Microsoft.Network/networkSecurityGroups'
| extend nicCount = iif(isnotempty(properties.networkInterfaces),array_length(properties.networkInterfaces),0)
| extend subnetCount = iif(isnotempty(properties.subnets),array_length(properties.subnets),0)
| mvexpand securityRules = properties.securityRules
| extend ruleName = tolower(securityRules.name)
| extend ruleProtocol = tolower(securityRules.properties.protocol)
| extend ruleDirection = tolower(securityRules.properties.direction)
| extend rulePriority = toint(securityRules.properties.priority)
| extend ruleAccess = tolower(securityRules.properties.access)
| extend ruleDestinationAddresses = tolower(iif(array_length(securityRules.properties.destinationAddressPrefixes) > 0,strcat_array(securityRules.properties.destinationAddressPrefixes, ','),securityRules.properties.destinationAddressPrefix))
| extend ruleSourceAddresses = tolower(iif(array_length(securityRules.properties.sourceAddressPrefixes) > 0,strcat_array(securityRules.properties.sourceAddressPrefixes, ','),securityRules.properties.sourceAddressPrefix))
| extend ruleDestinationPorts = iif(array_length(securityRules.properties.destinationPortRanges) > 0,strcat_array(securityRules.properties.destinationPortRanges, ','),securityRules.properties.destinationPortRange)
| extend ruleSourcePorts = iif(array_length(securityRules.properties.sourcePortRanges) > 0,strcat_array(securityRules.properties.sourcePortRanges, ','),securityRules.properties.sourcePortRange)
| extend ruleId = tolower(securityRules.id)
| project-away securityRules, properties
| order by ruleId asc
`;

export class NsgCollector extends AzureArgCollector {
  readonly id = 'azure-nsg';
  readonly name = 'Azure Network Security Groups';
  readonly targetSuffix = 'argnsgexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [NSG_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      location: row.location,
      nsgName: row.name,
      instanceId: row.id,
      nicCount: row.nicCount ?? 0,
      subnetCount: row.subnetCount ?? 0,
      ruleName: row.ruleName ?? '',
      ruleProtocol: row.ruleProtocol ?? '',
      ruleDirection: row.ruleDirection ?? '',
      rulePriority: row.rulePriority ?? 0,
      ruleAccess: row.ruleAccess ?? '',
      ruleDestinationAddresses: row.ruleDestinationAddresses ?? '',
      ruleSourceAddresses: row.ruleSourceAddresses ?? '',
      ruleDestinationPorts: row.ruleDestinationPorts ?? '',
      ruleSourcePorts: row.ruleSourcePorts ?? '',
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
