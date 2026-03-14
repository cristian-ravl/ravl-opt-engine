import type { EngineContext } from '../../types.js';
import { ingest } from '../../../utils/adx-client.js';

const TARGET_TABLE_BY_SUFFIX: Record<string, string> = {
  argvmexports: 'VirtualMachines',
  argdiskexports: 'ManagedDisks',
  argappserviceplanexports: 'AppServicePlans',
  arglbexports: 'LoadBalancers',
  argnicexports: 'NetworkInterfaces',
  argnsgexports: 'NetworkSecurityGroups',
  argpublicipexports: 'PublicIPs',
  argrescontainersexports: 'ResourceContainers',
  argsqldbexports: 'SqlDatabases',
  argunmanageddiskexports: 'UnmanagedDisks',
  argvmssexports: 'VirtualMachineScaleSets',
  argvnetexports: 'VirtualNetworks',
  argappgwexports: 'ApplicationGateways',
  argavailsetexports: 'AvailabilitySets',
  advisorexports: 'AdvisorRecommendations',
  pricesheetexports: 'PriceSheetData',
  reservationspriceexports: 'ReservationsPriceData',
  reservationsexports: 'ReservationsUsage',
  savingsplansexports: 'SavingsPlansUsage',
  consumptionexports: 'CostData',
  azmonitorexports: 'PerformanceMetrics',
  aadobjectsexports: 'AADObjects',
  rbacassignmentsexports: 'RBACAssignments',
  policycomplianceexports: 'PolicyCompliance',
};

const INGESTION_MAPPING_BY_TABLE: Record<string, string> = {
  VirtualMachines: 'VirtualMachines_mapping',
  ManagedDisks: 'ManagedDisks_mapping',
  AppServicePlans: 'AppServicePlans_mapping',
  LoadBalancers: 'LoadBalancers_mapping',
  NetworkInterfaces: 'NetworkInterfaces_mapping',
  NetworkSecurityGroups: 'NetworkSecurityGroups_mapping',
  PublicIPs: 'PublicIPs_mapping',
  ResourceContainers: 'ResourceContainers_mapping',
  SqlDatabases: 'SqlDatabases_mapping',
  UnmanagedDisks: 'UnmanagedDisks_mapping',
  VirtualMachineScaleSets: 'VirtualMachineScaleSets_mapping',
  VirtualNetworks: 'VirtualNetworks_mapping',
  ApplicationGateways: 'ApplicationGateways_mapping',
  AvailabilitySets: 'AvailabilitySets_mapping',
  AdvisorRecommendations: 'AdvisorRecommendations_mapping',
  PriceSheetData: 'PriceSheetData_mapping',
  ReservationsPriceData: 'ReservationsPriceData_mapping',
  ReservationsUsage: 'ReservationsUsage_mapping',
  SavingsPlansUsage: 'SavingsPlansUsage_mapping',
  CostData: 'CostData_mapping',
  PerformanceMetrics: 'PerformanceMetrics_mapping',
  AADObjects: 'AADObjects_mapping',
  RBACAssignments: 'RBACAssignments_mapping',
  PolicyCompliance: 'PolicyCompliance_mapping',
  IngestionControl: 'IngestionControl_mapping',
};

export function resolveTargetTable(targetSuffix: string): string {
  const table = TARGET_TABLE_BY_SUFFIX[targetSuffix];
  if (!table) {
    throw new Error(`No ADX target table mapping found for collector target suffix '${targetSuffix}'`);
  }
  return table;
}

export async function ingestCollectorRows(ctx: EngineContext, sourceId: string, targetSuffix: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;

  const table = resolveTargetTable(targetSuffix);
  const mappingName = INGESTION_MAPPING_BY_TABLE[table];
  await ingest(ctx, table, rows, mappingName);

  await ingest(
    ctx,
    'IngestionControl',
    [
      {
        SourceId: sourceId,
        LastProcessedDateTime: new Date().toISOString(),
        LastProcessedMarker: `rows=${rows.length}`,
        TargetTableSuffix: targetSuffix,
        CollectedType: table,
      },
    ],
    INGESTION_MAPPING_BY_TABLE.IngestionControl,
  );
}
