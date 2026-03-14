// Collector: Azure Resource Containers (Subscriptions + Resource Groups) via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const RG_QUERY = `
resourcecontainers
| where type == "microsoft.resources/subscriptions/resourcegroups"
| join kind=leftouter (
    resources
    | summarize ResourceCount= count() by subscriptionId, resourceGroup
) on subscriptionId, resourceGroup
| extend ResourceCount = iif(isempty(ResourceCount), 0, ResourceCount)
| project id, name, type, tenantId, location, subscriptionId, managedBy, tags, properties, ResourceCount
| order by id asc
`;

const SUB_QUERY = `
resourcecontainers
| where type == "microsoft.resources/subscriptions"
| join kind=leftouter (
    resources
    | summarize ResourceCount= count() by subscriptionId
) on subscriptionId
| extend ResourceCount = iif(isempty(ResourceCount), 0, ResourceCount)
| project id, name, type, tenantId, subscriptionId, managedBy, tags, properties, ResourceCount
| order by id asc
`;

export class ResourceContainerCollector extends AzureArgCollector {
  readonly id = 'azure-rescontainers';
  readonly name = 'Azure Resource Containers';
  readonly targetSuffix = 'argrescontainersexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [RG_QUERY, SUB_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    const isSubscription = (row.type as string)?.includes('subscriptions') && !(row.type as string)?.includes('resourcegroups');
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      location: row.location ?? '',
      containerType: isSubscription ? 'Subscription' : 'ResourceGroup',
      containerName: row.name,
      instanceId: row.id,
      resourceCount: row.ResourceCount ?? 0,
      managedBy: row.managedBy ?? '',
      containerProperties: row.properties ?? {},
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
