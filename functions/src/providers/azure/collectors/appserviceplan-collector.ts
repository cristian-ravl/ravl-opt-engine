// Collector: Azure App Service Plans via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const APP_SERVICE_PLAN_QUERY = `
resources
| where type =~ 'microsoft.web/serverfarms'
| extend skuName = sku.name, skuTier = sku.tier, skuCapacity = sku.capacity, skuFamily = sku.family, skuSize = sku.size
| extend computeMode = properties.computeMode, zoneRedundant = properties.zoneRedundant
| extend numberOfWorkers = properties.numberOfWorkers, currentNumberOfWorkers = properties.currentNumberOfWorkers, maximumNumberOfWorkers = properties.maximumNumberOfWorkers
| extend numberOfSites = properties.numberOfSites, planName = properties.planName
| order by id asc
`;

export class AppServicePlanCollector extends AzureArgCollector {
  readonly id = 'azure-appserviceplan';
  readonly name = 'Azure App Service Plans';
  readonly targetSuffix = 'argappserviceplanexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [APP_SERVICE_PLAN_QUERY];
  }

  protected mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown> {
    return {
      timestamp,
      cloud: 'Azure',
      tenantId: row.tenantId,
      subscriptionId: row.subscriptionId,
      resourceGroup: row.resourceGroup,
      zoneRedundant: row.zoneRedundant ?? false,
      location: row.location,
      appServicePlanName: row.name,
      instanceId: row.id,
      kind: row.kind ?? '',
      skuName: row.skuName ?? '',
      skuTier: row.skuTier ?? '',
      skuCapacity: row.skuCapacity ?? 0,
      skuFamily: row.skuFamily ?? '',
      skuSize: row.skuSize ?? '',
      computeMode: row.computeMode ?? '',
      numberOfWorkers: row.numberOfWorkers ?? 0,
      currentNumberOfWorkers: row.currentNumberOfWorkers ?? 0,
      maximumNumberOfWorkers: row.maximumNumberOfWorkers ?? 0,
      numberOfSites: row.numberOfSites ?? 0,
      planName: row.planName ?? '',
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
