// Collector: Azure Monitor metrics for core optimization scenarios.

import type { CloudProvider, EngineContext, ICollector } from '../../types.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { armGet } from '../../../utils/arm-client.js';
import { queryResourceGraph } from '../../../utils/arg-client.js';
import { ingestCollectorRows } from './ingestion.js';

type AggregationType = 'Average' | 'Maximum' | 'Minimum' | 'Total';

interface MetricDefinition {
  id: string;
  resourceType: string;
  metricNamespace?: string;
  argFilter?: string;
  metricNames: string[];
  metricNameOut: string;
  aggregationType: AggregationType;
  aggregationOfType?: AggregationType;
  interval: string;
  timeSpan?: string;
}

interface ArgResourceRow {
  id: string;
  subscriptionId: string;
}

interface MetricDataPoint {
  average?: number;
  maximum?: number;
  minimum?: number;
  total?: number;
}

interface MetricsApiResponse {
  value?: Array<{
    name?: {
      value?: string;
    };
    unit?: string;
    timeseries?: Array<{
      data?: MetricDataPoint[];
    }>;
  }>;
}

const DEFINITIONS: MetricDefinition[] = [
  {
    id: 'appservice-cpu-average',
    resourceType: 'microsoft.web/serverfarms',
    metricNamespace: 'Microsoft.Web/serverFarms',
    argFilter: "sku.tier !in~ ('Free', 'Shared')",
    metricNames: ['CpuPercentage'],
    metricNameOut: 'CpuPercentage',
    aggregationType: 'Average',
    interval: 'PT1M',
  },
  {
    id: 'appservice-memory-average',
    resourceType: 'microsoft.web/serverfarms',
    metricNamespace: 'Microsoft.Web/serverFarms',
    argFilter: "sku.tier !in~ ('Free', 'Shared')",
    metricNames: ['MemoryPercentage'],
    metricNameOut: 'MemoryPercentage',
    aggregationType: 'Average',
    interval: 'PT1M',
  },
  {
    id: 'vmss-cpu-average',
    resourceType: 'microsoft.compute/virtualmachinescalesets',
    metricNamespace: 'Microsoft.Compute/virtualMachineScaleSets',
    metricNames: ['Percentage CPU'],
    metricNameOut: 'Percentage CPU',
    aggregationType: 'Average',
    interval: 'PT1M',
  },
  {
    id: 'vmss-cpu-maximum',
    resourceType: 'microsoft.compute/virtualmachinescalesets',
    metricNamespace: 'Microsoft.Compute/virtualMachineScaleSets',
    metricNames: ['Percentage CPU'],
    metricNameOut: 'Percentage CPU',
    aggregationType: 'Maximum',
    interval: 'PT1M',
  },
  {
    id: 'vmss-memory-minimum',
    resourceType: 'microsoft.compute/virtualmachinescalesets',
    metricNames: ['Available Memory Bytes'],
    metricNameOut: 'Available Memory Bytes',
    aggregationType: 'Minimum',
    interval: 'PT1M',
  },
  {
    id: 'sqldb-dtu-average',
    resourceType: 'microsoft.sql/servers/databases',
    metricNamespace: 'Microsoft.Sql/servers/databases',
    argFilter: "sku.tier in ('Standard','Premium')",
    metricNames: ['dtu_consumption_percent'],
    metricNameOut: 'dtu_consumption_percent',
    aggregationType: 'Average',
    aggregationOfType: 'Maximum',
    interval: 'PT1M',
  },
  {
    id: 'sqldb-dtu-maximum',
    resourceType: 'microsoft.sql/servers/databases',
    metricNamespace: 'Microsoft.Sql/servers/databases',
    argFilter: "sku.tier in ('Basic','Standard','Premium')",
    metricNames: ['dtu_consumption_percent'],
    metricNameOut: 'dtu_consumption_percent',
    aggregationType: 'Maximum',
    interval: 'PT1M',
  },
  {
    id: 'disk-iops-average',
    resourceType: 'microsoft.compute/disks',
    metricNamespace: 'Microsoft.Compute/disks',
    argFilter: "sku.name startswith 'Premium_' and properties.diskState =~ 'Attached'",
    metricNames: ['Composite Disk Read Operations/sec', 'Composite Disk Write Operations/sec'],
    metricNameOut: 'Composite Disk Read Operations/sec,Composite Disk Write Operations/sec',
    aggregationType: 'Average',
    aggregationOfType: 'Maximum',
    interval: 'PT1M',
  },
  {
    id: 'disk-mibps-average',
    resourceType: 'microsoft.compute/disks',
    metricNamespace: 'Microsoft.Compute/disks',
    argFilter: "sku.name startswith 'Premium_' and properties.diskState =~ 'Attached'",
    metricNames: ['Composite Disk Read Bytes/sec', 'Composite Disk Write Bytes/sec'],
    metricNameOut: 'Composite Disk Read Bytes/sec,Composite Disk Write Bytes/sec',
    aggregationType: 'Average',
    aggregationOfType: 'Maximum',
    interval: 'PT1M',
  },
];

function getFieldForAggregation(type: AggregationType): keyof MetricDataPoint {
  switch (type) {
    case 'Maximum':
      return 'maximum';
    case 'Minimum':
      return 'minimum';
    case 'Total':
      return 'total';
    default:
      return 'average';
  }
}

function aggregate(values: number[], type: AggregationType): number | null {
  if (values.length === 0) return null;

  switch (type) {
    case 'Maximum':
      return Math.max(...values);
    case 'Minimum':
      return Math.min(...values);
    case 'Total':
      return values.reduce((sum, value) => sum + value, 0);
    default:
      return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}

async function queryArgResources(ctx: EngineContext, definition: MetricDefinition): Promise<ArgResourceRow[]> {
  const where = definition.argFilter ? ` and ${definition.argFilter}` : '';
  const kql = `
resources
| where type =~ '${definition.resourceType}'${where}
| where isnotempty(id) and isnotempty(subscriptionId)
| project id, subscriptionId
| order by id asc
`;
  return queryResourceGraph<ArgResourceRow>(kql, ctx);
}

function coalesceUnit(units: string[]): string {
  const distinctUnits = [...new Set(units.filter((unit) => unit.length > 0))];
  return distinctUnits.length === 1 ? distinctUnits[0] : 'Count';
}

async function queryMetricValue(
  resourceId: string,
  definition: MetricDefinition,
  aggregationType: AggregationType,
  aggregationOfType: AggregationType,
  startIso: string,
  endIso: string,
): Promise<{ value: number | null; unit: string }> {
  const params = new URLSearchParams({
    'api-version': '2023-10-01',
    metricnames: definition.metricNames.join(','),
    timespan: `${startIso}/${endIso}`,
    interval: definition.interval,
    aggregation: aggregationType,
  });

  if (definition.metricNamespace) {
    params.set('metricnamespace', definition.metricNamespace);
  }

  const path = `${resourceId}/providers/microsoft.insights/metrics?${params.toString()}`;
  const response = await armGet<MetricsApiResponse>(path);
  const field = getFieldForAggregation(aggregationType);

  let totalValue = 0;
  let hasAtLeastOneValue = false;
  const units: string[] = [];

  for (const metric of response.value ?? []) {
    const points = metric.timeseries?.[0]?.data ?? [];
    const values = points.map((point) => point[field]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    const aggregated = aggregate(values, aggregationOfType);

    if (aggregated !== null) {
      totalValue += aggregated;
      hasAtLeastOneValue = true;
    }

    units.push(metric.unit ?? '');
  }

  return {
    value: hasAtLeastOneValue ? totalValue : null,
    unit: coalesceUnit(units),
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnavailableMetricError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes('could not find metric') ||
    message.includes('metric namespace') ||
    message.includes('supported metrics') ||
    message.includes('invalid sampling type') ||
    message.includes('resource type could not be found')
  );
}

function summarizeErrors(definition: MetricDefinition, failures: string[]): Error {
  const example = failures.slice(0, 3).join(' | ');
  return new Error(`Metrics collection failed for '${definition.id}' on ${failures.length} resource(s). ${example}`);
}

export class MonitorMetricsCollector implements ICollector {
  readonly id = 'azure-monitor-metrics';
  readonly name = 'Azure Monitor metrics';
  readonly cloud: CloudProvider = 'Azure';
  readonly targetSuffix = 'azmonitorexports';

  async collect(ctx: EngineContext): Promise<number> {
    const end = new Date();
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const endIso = end.toISOString();
    const startIso = start.toISOString();
    const timestamp = endIso;

    let totalRecords = 0;

    for (const definition of DEFINITIONS) {
      const resources = await queryArgResources(ctx, definition);
      if (resources.length === 0) continue;

      const rows: Record<string, unknown>[] = [];
      const failures: string[] = [];

      for (const resource of resources) {
        try {
          const metric = await queryMetricValue(
            resource.id,
            definition,
            definition.aggregationType,
            definition.aggregationOfType ?? definition.aggregationType,
            startIso,
            endIso,
          );
          if (metric.value === null) continue;

          rows.push({
            timestamp,
            cloud: 'Azure',
            subscriptionId: resource.subscriptionId,
            instanceId: resource.id.toLowerCase(),
            metricName: definition.metricNameOut,
            aggregationType: definition.aggregationType,
            aggregationOfType: definition.aggregationOfType ?? definition.aggregationType,
            value: metric.value,
            unit: metric.unit,
            timeGrain: definition.interval,
            timeSpan: definition.timeSpan ?? 'PT1H',
          });
        } catch (error: unknown) {
          if (isUnavailableMetricError(error)) {
            continue;
          }
          failures.push(`${resource.id}: ${toErrorMessage(error)}`);
        }
      }

      if (rows.length === 0 && failures.length > 0) {
        throw summarizeErrors(definition, failures);
      }

      if (rows.length === 0) continue;

      const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}-${definition.id}.ndjson`;
      await uploadJsonBlob(ctx, this.targetSuffix, blobName, rows);
      await ingestCollectorRows(ctx, this.id, this.targetSuffix, rows);
      totalRecords += rows.length;
    }

    return totalRecords;
  }
}
