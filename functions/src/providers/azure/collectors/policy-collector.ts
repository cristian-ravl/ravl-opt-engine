// Collector: Azure Policy compliance states from Azure Resource Graph policyresources.

import type { EngineContext } from '../../types.js';
import { AzureArgCollector } from './base-arg-collector.js';

export class PolicyComplianceCollector extends AzureArgCollector {
  readonly id = 'azure-policy-compliance';
  readonly name = 'Azure Policy compliance states';
  readonly targetSuffix = 'policycomplianceexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [
      `
policyresources
| where type =~ 'microsoft.policyinsights/policystates'
| where isnotempty(properties.complianceState)
| project
    tenantId,
    subscriptionId,
    resourceGroup,
    resourceId = tostring(properties.resourceId),
    resourceType = tostring(properties.resourceType),
    resourceLocation = tostring(properties.resourceLocation),
    policyAssignmentId = tostring(properties.policyAssignmentId),
    policyDefinitionId = tostring(properties.policyDefinitionId),
    policySetDefinitionId = tostring(properties.policySetDefinitionId),
    complianceState = tostring(properties.complianceState),
    details = properties,
    statusDate = tostring(properties.timestamp)
`,
    ];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: String(row.tenantId ?? ''),
      subscriptionId: String(row.subscriptionId ?? ''),
      resourceGroup: String(row.resourceGroup ?? '').toLowerCase(),
      resourceId: String(row.resourceId ?? '').toLowerCase(),
      resourceType: String(row.resourceType ?? ''),
      resourceLocation: String(row.resourceLocation ?? ''),
      policyAssignmentId: String(row.policyAssignmentId ?? ''),
      policyDefinitionId: String(row.policyDefinitionId ?? ''),
      policySetDefinitionId: String(row.policySetDefinitionId ?? ''),
      complianceState: String(row.complianceState ?? ''),
      details: row.details ?? {},
      statusDate: String(row.statusDate ?? timestamp),
    };
  }
}
