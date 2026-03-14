// Collector: Azure SQL Databases via ARG

import { AzureArgCollector } from './base-arg-collector.js';
import type { EngineContext } from '../../types.js';

const SQL_DB_QUERY = `
resources
| where type =~ 'microsoft.sql/servers/databases' and name != 'master'
| extend skuName = sku.name, skuTier = sku.tier, skuCapacity = sku.capacity
| extend storageAccountType = properties.storageAccountType, licenseType = properties.licenseType, serviceObjectiveName = properties.currentServiceObjectiveName
| extend zoneRedundant = properties.zoneRedundant, maxSizeBytes = properties.maxSizeBytes, maxLogSizeBytes = properties.maxLogSizeBytes
| order by id asc
`;

export class SqlDatabaseCollector extends AzureArgCollector {
  readonly id = 'azure-sqldb';
  readonly name = 'Azure SQL Databases';
  readonly targetSuffix = 'argsqldbexports';

  protected getQueries(ctx: EngineContext): string[] {
    void ctx;
    return [SQL_DB_QUERY];
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
      dbName: row.name,
      instanceId: row.id,
      skuName: row.skuName ?? '',
      skuTier: row.skuTier ?? '',
      skuCapacity: row.skuCapacity ?? 0,
      serviceObjectiveName: row.serviceObjectiveName ?? '',
      storageAccountType: row.storageAccountType ?? '',
      licenseType: row.licenseType ?? '',
      maxSizeBytes: row.maxSizeBytes ?? 0,
      maxLogSizeBytes: row.maxLogSizeBytes ?? 0,
      tags: this.parseTags(row.tags),
      statusDate: timestamp,
    };
  }
}
