// Unit tests for Azure collectors

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VirtualMachinesCollector } from '../src/providers/azure/collectors/vm-collector.js';
import { ManagedDisksCollector } from '../src/providers/azure/collectors/disk-collector.js';
import { AzureProvider } from '../src/providers/azure/index.js';

const EXPECTED_COLLECTOR_IDS = [
  'azure-vm',
  'azure-disk',
  'azure-appserviceplan',
  'azure-lb',
  'azure-nic',
  'azure-nsg',
  'azure-publicip',
  'azure-rescontainers',
  'azure-sqldb',
  'azure-vmss',
  'azure-vnet',
  'azure-appgw',
  'azure-availset',
  'azure-unmanaged-disks',
  'azure-consumption',
  'azure-monitor-metrics',
  'azure-advisor',
  'azure-pricesheet',
  'azure-reservations-price',
  'azure-reservations-usage',
  'azure-savings-plans-usage',
  'azure-aad-objects',
  'azure-rbac-assignments',
  'azure-policy-compliance',
] as const;

const EXPECTED_LEGACY_SUB_TYPES = [
  'AADExpiringCredentials',
  'AADNotExpiringCredentials',
  'AdvisorCost',
  'AvailSetLowFaultDomainCount',
  'AvailSetLowUpdateDomainCount',
  'AvailSetSharedStorageAccount',
  'DisksMultipleStorageAccounts',
  'EmptyAppServicePlans',
  'HighRBACAssignmentsManagementGroups',
  'HighRBACAssignmentsSubscriptions',
  'HighResourceGroupCountSubscriptions',
  'HighSubnetIPSpaceUsage',
  'LongDeallocatedVms',
  'LowSubnetIPSpaceUsage',
  'NSGRuleForEmptyOrUnexistingSubnet',
  'NSGRuleForOrphanOrUnexistingNIC',
  'NSGRuleForOrphanOrUnexistingPublicIP',
  'NoSubnetIPSpaceUsage',
  'OrphanedNIC',
  'OrphanedPublicIP',
  'PerfConstrainedAppServicePlans',
  'PerfConstrainedSqlDatabases',
  'PerfConstrainedVMSS',
  'StoppedVms',
  'StorageAccountsGrowing',
  'StorageAccountsMultipleVMs',
  'UnattachedDisks',
  'UnderusedAppServicePlans',
  'UnderusedPremiumSSDDisks',
  'UnderusedSqlDatabases',
  'UnderusedVMSS',
  'UnmanagedDisks',
  'UnmanagedDisksVMSS',
  'UnusedAppGateways',
  'UnusedLoadBalancers',
  'UnusedStandardLoadBalancers',
  'VMSSMultipleAZs',
  'VMsMultipleAZs',
  'VMsNoAvailSet',
  'VMsSingleInAvailSet',
] as const;

const EXPECTED_REMEDIATION_SUB_TYPE_IDS = [
  'e10b1381-5f0a-47ff-8c7b-37bd13d7c974',
  'c320b790-2e58-452a-aa63-7b62c383ad8a',
  'c84d5e86-e2d6-4d62-be7c-cecfbd73b0db',
] as const;

describe('VirtualMachinesCollector', () => {
  let collector: VirtualMachinesCollector;

  beforeEach(() => {
    collector = new VirtualMachinesCollector();
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(collector.id).toBe('azure-vm');
    expect(collector.name).toBe('Azure Virtual Machines');
    expect(collector.cloud).toBe('Azure');
    expect(collector.targetSuffix).toBe('argvmexports');
  });
});

describe('ManagedDisksCollector', () => {
  let collector: ManagedDisksCollector;

  beforeEach(() => {
    collector = new ManagedDisksCollector();
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(collector.id).toBe('azure-disk');
    expect(collector.name).toBe('Azure Managed Disks');
    expect(collector.targetSuffix).toBe('argdiskexports');
  });
});

describe('AzureProvider', () => {
  it('registers all collectors', () => {
    const provider = new AzureProvider();
    expect(provider.cloud).toBe('Azure');
    expect(provider.collectors.length).toBe(24);
    expect(provider.collectors.map((collector) => collector.id)).toEqual(expect.arrayContaining(EXPECTED_COLLECTOR_IDS));
  });

  it('registers all recommenders', () => {
    const provider = new AzureProvider();
    expect(provider.recommenders.length).toBeGreaterThanOrEqual(8);
    expect(provider.recommenders.flatMap((recommender) => recommender.subTypes.map((subType) => subType.subType))).toEqual(
      expect.arrayContaining(EXPECTED_LEGACY_SUB_TYPES),
    );
  });

  it('all collectors have unique IDs', () => {
    const provider = new AzureProvider();
    const ids = provider.collectors.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all recommenders have unique IDs', () => {
    const provider = new AzureProvider();
    const ids = provider.recommenders.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('registers remediators for legacy automation flows', () => {
    const provider = new AzureProvider();
    expect(provider.remediators.length).toBe(3);
    expect(provider.remediators.flatMap((remediator) => remediator.handlesSubTypeIds)).toEqual(
      expect.arrayContaining(EXPECTED_REMEDIATION_SUB_TYPE_IDS),
    );
  });
});
