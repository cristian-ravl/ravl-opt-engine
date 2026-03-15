import { escapeKql } from './recommendations-query.js';

export type DataExplorerSourceKind = 'table' | 'materializedView';

export interface DataExplorerSourceDefinition {
  name: string;
  kind: DataExplorerSourceKind;
  group: 'Resources' | 'Cost' | 'Identity' | 'Recommendations' | 'Operations' | 'Views';
  defaultSortColumn?: string;
}

interface DataExplorerRowsQueryOptions {
  source: DataExplorerSourceDefinition;
  search?: string | null;
  sortBy?: string | null;
  sortDirection: 'asc' | 'desc';
  offset: number;
  limit: number;
}

const DATA_EXPLORER_SOURCES: DataExplorerSourceDefinition[] = [
  { name: 'VirtualMachines', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'ManagedDisks', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'AppServicePlans', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'LoadBalancers', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'NetworkInterfaces', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'NetworkSecurityGroups', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'PublicIPs', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'ResourceContainers', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'SqlDatabases', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'UnmanagedDisks', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'VirtualMachineScaleSets', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'VirtualNetworks', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'ApplicationGateways', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'AvailabilitySets', kind: 'table', group: 'Resources', defaultSortColumn: 'Timestamp' },
  { name: 'AdvisorRecommendations', kind: 'table', group: 'Recommendations', defaultSortColumn: 'Timestamp' },
  { name: 'Recommendations', kind: 'table', group: 'Recommendations', defaultSortColumn: 'GeneratedDate' },
  { name: 'Suppressions', kind: 'table', group: 'Operations', defaultSortColumn: 'FilterStartDate' },
  { name: 'RemediationLog', kind: 'table', group: 'Operations', defaultSortColumn: 'ExecutedAt' },
  { name: 'PerformanceMetrics', kind: 'table', group: 'Operations', defaultSortColumn: 'Timestamp' },
  { name: 'CostData', kind: 'table', group: 'Cost', defaultSortColumn: 'UsageDate' },
  { name: 'PriceSheetData', kind: 'table', group: 'Cost', defaultSortColumn: 'Timestamp' },
  { name: 'ReservationsPriceData', kind: 'table', group: 'Cost', defaultSortColumn: 'Timestamp' },
  { name: 'ReservationsUsage', kind: 'table', group: 'Cost', defaultSortColumn: 'Timestamp' },
  { name: 'SavingsPlansUsage', kind: 'table', group: 'Cost', defaultSortColumn: 'Timestamp' },
  { name: 'AADObjects', kind: 'table', group: 'Identity', defaultSortColumn: 'Timestamp' },
  { name: 'RBACAssignments', kind: 'table', group: 'Identity', defaultSortColumn: 'CreatedOn' },
  { name: 'PolicyCompliance', kind: 'table', group: 'Identity', defaultSortColumn: 'Timestamp' },
  { name: 'IngestionControl', kind: 'table', group: 'Operations', defaultSortColumn: 'LastProcessedDateTime' },
  { name: 'LatestVMs', kind: 'materializedView', group: 'Views', defaultSortColumn: 'Timestamp' },
  { name: 'LatestDisks', kind: 'materializedView', group: 'Views', defaultSortColumn: 'Timestamp' },
  { name: 'LatestRecommendations', kind: 'materializedView', group: 'Views', defaultSortColumn: 'GeneratedDate' },
  { name: 'ActiveSuppressions', kind: 'materializedView', group: 'Views', defaultSortColumn: 'FilterStartDate' },
];

const sourceByName = new Map(DATA_EXPLORER_SOURCES.map((source) => [source.name.toLowerCase(), source]));
const fallbackSortColumns = ['GeneratedDate', 'Timestamp', 'UsageDate', 'LastProcessedDateTime', 'FilterStartDate', 'ExecutedAt', 'CreatedOn'];

export function listDataExplorerSources(): DataExplorerSourceDefinition[] {
  return [...DATA_EXPLORER_SOURCES];
}

export function getDataExplorerSource(name: string | null | undefined): DataExplorerSourceDefinition | null {
  if (!name) return null;
  return sourceByName.get(name.trim().toLowerCase()) ?? null;
}

export function buildDataExplorerSchemaKql(source: DataExplorerSourceDefinition): string {
  return `
    ${source.name}
    | getschema
    | project Name = ColumnName, Type = ColumnType
  `;
}

export function buildDataExplorerCountKql(source: DataExplorerSourceDefinition, search?: string | null): string {
  return `
    ${source.name}
    ${buildSearchKql(search)}
    | count
  `;
}

export function buildDataExplorerRowsKql(options: DataExplorerRowsQueryOptions): string {
  const orderByKql = options.sortBy ? `| order by ${options.sortBy} ${options.sortDirection}` : '';

  return `
    ${options.source.name}
    ${buildSearchKql(options.search)}
    ${orderByKql}
    | serialize RowNum = row_number()
    | where RowNum > ${options.offset}
    | take ${options.limit}
  `;
}

export function resolveDataExplorerSortColumn(
  source: DataExplorerSourceDefinition,
  requestedSortBy: string | null | undefined,
  availableColumns: string[],
): string | null {
  const availableSet = new Set(availableColumns);
  const normalizedRequestedSortBy = requestedSortBy?.trim();

  if (normalizedRequestedSortBy && isSafeColumnName(normalizedRequestedSortBy) && availableSet.has(normalizedRequestedSortBy)) {
    return normalizedRequestedSortBy;
  }

  if (source.defaultSortColumn && availableSet.has(source.defaultSortColumn)) {
    return source.defaultSortColumn;
  }

  for (const fallbackColumn of fallbackSortColumns) {
    if (availableSet.has(fallbackColumn)) {
      return fallbackColumn;
    }
  }

  return null;
}

export function normalizeDataExplorerSortDirection(value: string | null | undefined): 'asc' | 'desc' {
  return value?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function buildSearchKql(search?: string | null): string {
  const normalizedSearch = search?.trim();
  if (!normalizedSearch) return '';

  return `
    | extend __SearchText = tostring(pack_all())
    | where __SearchText contains "${escapeKql(normalizedSearch)}"
    | project-away __SearchText
  `;
}

function isSafeColumnName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}
