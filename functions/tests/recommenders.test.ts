// Unit tests for Azure recommenders

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LongDeallocatedVmsRecommender } from '../src/providers/azure/recommenders/long-deallocated-vms.js';
import { StoppedVmsRecommender } from '../src/providers/azure/recommenders/stopped-vms.js';
import { UnattachedDisksRecommender } from '../src/providers/azure/recommenders/unattached-disks.js';
import { VmHighAvailabilityRecommender } from '../src/providers/azure/recommenders/vm-high-availability.js';
import { AadExpiringCredentialsRecommender } from '../src/providers/azure/recommenders/aad-expiring-credentials.js';
import { SqlDbOptimizationsRecommender } from '../src/providers/azure/recommenders/sqldb-optimizations.js';
import { ArmOptimizationsRecommender } from '../src/providers/azure/recommenders/arm-optimizations.js';
import type { EngineContext } from '../src/providers/types.js';

// Mock ADX client
vi.mock('../src/utils/adx-client.js', () => ({
  query: vi.fn(),
  ingest: vi.fn(),
}));

const mockContext: EngineContext = {
  cloudEnvironment: 'AzureCloud',
  adxClusterUri: 'https://test.kusto.windows.net',
  adxDatabase: 'TestDB',
  storageAccountName: 'teststorage',
  referenceRegion: 'westeurope',
  consumptionOffsetDays: 7,
  consumptionCollectionDays: 30,
  longDeallocatedVmDays: 30,
  aadExpiringCredsDays: 30,
  aadMaxCredValidityDays: 730,
  targetSubscriptions: [],
};

describe('LongDeallocatedVmsRecommender', () => {
  let recommender: LongDeallocatedVmsRecommender;

  beforeEach(() => {
    recommender = new LongDeallocatedVmsRecommender();
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(recommender.id).toBe('long-deallocated-vms');
    expect(recommender.cloud).toBe('Azure');
    expect(recommender.subTypes).toHaveLength(1);
    expect(recommender.subTypes[0].category).toBe('Cost');
  });

  it('generates recommendations for deallocated VMs', async () => {
    const { query, ingest } = await import('../src/utils/adx-client.js');
    (query as any).mockResolvedValue([
      {
        InstanceId: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm1',
        VMName: 'vm1',
        ResourceGroup: 'rg1',
        SubscriptionId: 'sub1',
        TenantId: 'tenant1',
        Tags: { env: 'dev' },
        Location: 'westeurope',
        VMSize: 'Standard_D2s_v3',
        StatusDate: '2024-01-01T00:00:00Z',
        TotalDiskCost30d: 50,
        DiskCount: 2,
        TotalDiskSizeGB: 256,
        Currency: 'USD',
      },
    ]);

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].recommendationSubType).toBe('LongDeallocatedVms');
    expect(recommendations[0].instanceName).toBe('vm1');
    expect(recommendations[0].category).toBe('Cost');
    expect(recommendations[0].recommenderId).toBe('long-deallocated-vms');
    expect(recommendations[0].recommenderName).toBe('Long Deallocated VMs');
    expect(recommendations[0].additionalInfo.diskCost30d).toBe(50);
    expect(ingest).toHaveBeenCalled();
  });

  it('returns empty array when no deallocated VMs found', async () => {
    const { query, ingest } = await import('../src/utils/adx-client.js');
    (query as any).mockResolvedValue([]);

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations).toHaveLength(0);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('StoppedVmsRecommender', () => {
  let recommender: StoppedVmsRecommender;

  beforeEach(() => {
    recommender = new StoppedVmsRecommender();
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(recommender.id).toBe('stopped-vms');
    expect(recommender.subTypes[0].impact).toBe('High');
  });

  it('generates recommendations for stopped VMs', async () => {
    const { query } = await import('../src/utils/adx-client.js');
    (query as any).mockResolvedValue([
      {
        InstanceId: '/subscriptions/sub1/resourceGroups/rg1/providers/Microsoft.Compute/virtualMachines/vm2',
        VMName: 'vm2',
        ResourceGroup: 'rg1',
        SubscriptionId: 'sub1',
        TenantId: 'tenant1',
        Tags: {},
        Location: 'eastus',
        VMSize: 'Standard_E4s_v3',
        ComputeCost30d: 200,
        Currency: 'EUR',
      },
    ]);

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].impact).toBe('High');
    expect(recommendations[0].additionalInfo.annualSavings).toBe(2400);
  });
});

describe('UnattachedDisksRecommender', () => {
  let recommender: UnattachedDisksRecommender;

  beforeEach(() => {
    recommender = new UnattachedDisksRecommender();
    vi.clearAllMocks();
  });

  it('has correct metadata', () => {
    expect(recommender.id).toBe('unattached-disks');
    expect(recommender.subTypes[0].impactedArea).toBe('Microsoft.Compute/disks');
  });
});

describe('VmHighAvailabilityRecommender', () => {
  let recommender: VmHighAvailabilityRecommender;

  beforeEach(() => {
    recommender = new VmHighAvailabilityRecommender();
    vi.clearAllMocks();
  });

  it('emits legacy VMsMultipleAZs and UnmanagedDisksVMSS recommendations', async () => {
    const { query, ingest } = await import('../src/utils/adx-client.js');
    (query as any).mockImplementation(async (_ctx: EngineContext, kql: string) => {
      if (kql.includes('AvailabilitySets')) return [];
      if (kql.includes('LatestVMs\n      | where UsesManagedDisks == false')) return [];
      if (kql.includes('SharedStorageAccountName')) return [];
      if (kql.includes('StorageAccountId = strcat')) return [];
      if (kql.includes('where isempty(AvailabilitySetId) and array_length(Zones) == 0')) return [];
      if (kql.includes('StorageAccountCount = dcount(StorageAccountName)')) return [];
      if (kql.includes('ZonesCount = dcount(Zone)')) {
        return [
          {
            InstanceId: '/subscriptions/sub1/resourceGroups/rg-ha',
            InstanceName: 'rg-ha',
            ResourceGroup: 'rg-ha',
            SubscriptionId: 'sub1',
            SubscriptionName: 'Production',
            TenantId: 'tenant1',
            ZonesCount: 2,
            VMCount: 3,
          },
        ];
      }

      if (kql.includes('where (array_length(Zones) < 2 and Capacity > 1)')) return [];
      if (kql.includes('where UsesManagedDisks == false') && kql.includes('VMSSName')) {
        return [
          {
            InstanceId: '/subscriptions/sub1/resourceGroups/rg-ha/providers/Microsoft.Compute/virtualMachineScaleSets/vmss-legacy',
            VMSSName: 'vmss-legacy',
            ResourceGroup: 'rg-ha',
            SubscriptionId: 'sub1',
            TenantId: 'tenant1',
            Tags: { env: 'prod' },
          },
        ];
      }

      if (kql.includes("where ContainerType =~ 'Subscription'")) {
        return [{ SubscriptionId: 'sub1', SubscriptionName: 'Production' }];
      }

      return [];
    });

    const recommendations = await recommender.generateRecommendations(mockContext);

    expect(recommendations.map((recommendation) => recommendation.recommendationSubType)).toEqual([
      'VMsMultipleAZs',
      'UnmanagedDisksVMSS',
    ]);

    expect(recommendations[0]).toMatchObject({
      instanceName: 'rg-ha',
      recommenderId: 'vm-high-availability',
      recommenderName: 'VM High Availability',
      subscriptionName: 'Production',
      detailsUrl: 'https://portal.azure.com/#@tenant1/resource/subscriptions/sub1/resourceGroups/rg-ha/overview',
      additionalInfo: {
        zonesCount: 2,
        vmsCount: 3,
      },
    });

    expect(recommendations[1]).toMatchObject({
      instanceName: 'vmss-legacy',
      recommendationSubTypeId: '1bf03c4a-c402-4e6c-bf20-051b18af30e2',
      tags: { env: 'prod' },
    });

    expect(ingest).toHaveBeenCalledOnce();
  });
});

describe('AadExpiringCredentialsRecommender', () => {
  it('restores both legacy AAD credential recommendation subtypes', async () => {
    const recommender = new AadExpiringCredentialsRecommender();
    const { query } = await import('../src/utils/adx-client.js');
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const long = new Date(Date.now() + 900 * 24 * 60 * 60 * 1000).toISOString();

    (query as any).mockImplementation(async (_ctx: EngineContext, kql: string) => {
      if (kql.includes('AADObjects')) {
        return [
          {
            AppId: 'app-expiring',
            DisplayName: 'Expiring App',
            CredentialType: 'Password',
            CredentialId: 'cred-1',
            EndDate: soon,
            TenantId: 'tenant1',
          },
          {
            AppId: 'app-long',
            DisplayName: 'Long-lived App',
            CredentialType: 'Key',
            CredentialId: 'cred-2',
            EndDate: long,
            TenantId: 'tenant1',
          },
        ];
      }

      return [];
    });

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations.map((recommendation) => recommendation.recommendationSubType)).toEqual([
      'AADExpiringCredentials',
      'AADNotExpiringCredentials',
    ]);
  });
});

describe('SqlDbOptimizationsRecommender', () => {
  it('emits legacy underused and performance-constrained SQL DB recommendations', async () => {
    const recommender = new SqlDbOptimizationsRecommender();
    const { query } = await import('../src/utils/adx-client.js');

    (query as any).mockImplementation(async (_ctx: EngineContext, kql: string) => {
      if (kql.includes('P99DTUPercentage')) {
        return [
          {
            InstanceId: '/subscriptions/sub1/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sql1/databases/db-underused',
            DBName: 'db-underused',
            ResourceGroup: 'rg-sql',
            SubscriptionId: 'sub1',
            TenantId: 'tenant1',
            Tags: { env: 'prod' },
            SkuName: 'Standard',
            ServiceObjectiveName: 'S3',
            P99DTUPercentage: 12,
            Last30DaysCost: 300,
            Currency: 'USD',
          },
        ];
      }

      if (kql.includes('AvgDTUPercentage')) {
        return [
          {
            InstanceId: '/subscriptions/sub1/resourceGroups/rg-sql/providers/Microsoft.Sql/servers/sql1/databases/db-hot',
            DBName: 'db-hot',
            ResourceGroup: 'rg-sql',
            SubscriptionId: 'sub1',
            TenantId: 'tenant1',
            Tags: { env: 'prod' },
            SkuName: 'Premium',
            ServiceObjectiveName: 'P2',
            AvgDTUPercentage: 88,
          },
        ];
      }

      return [];
    });

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations.map((recommendation) => recommendation.recommendationSubType)).toEqual([
      'UnderusedSqlDatabases',
      'PerfConstrainedSqlDatabases',
    ]);
    expect(recommendations[0].additionalInfo.savingsAmount).toBe(150);
  });
});

describe('ArmOptimizationsRecommender', () => {
  it('emits legacy ARM limit recommendations', async () => {
    const recommender = new ArmOptimizationsRecommender();
    const { query } = await import('../src/utils/adx-client.js');

    (query as any).mockImplementation(async (_ctx: EngineContext, kql: string) => {
      if (kql.includes('AssignmentsCount = count() by SubscriptionId')) {
        return [
          {
            SubscriptionId: 'sub1',
            SubscriptionName: 'Production',
            InstanceId: '/subscriptions/sub1',
            TenantId: 'tenant1',
            Tags: { env: 'prod' },
            AssignmentsCount: 3900,
          },
        ];
      }

      if (kql.includes('ManagementGroupId')) {
        return [
          {
            Scope: '/providers/Microsoft.Management/managementGroups/contoso-platform',
            ManagementGroupId: 'contoso-platform',
            TenantId: 'tenant1',
            AssignmentsCount: 480,
          },
        ];
      }

      if (kql.includes('RGCount = count() by SubscriptionId')) {
        return [
          {
            SubscriptionId: 'sub1',
            SubscriptionName: 'Production',
            InstanceId: '/subscriptions/sub1',
            TenantId: 'tenant1',
            Tags: { env: 'prod' },
            RGCount: 950,
          },
        ];
      }

      return [];
    });

    const recommendations = await recommender.generateRecommendations(mockContext);
    expect(recommendations.map((recommendation) => recommendation.recommendationSubType)).toEqual([
      'HighRBACAssignmentsSubscriptions',
      'HighRBACAssignmentsManagementGroups',
      'HighResourceGroupCountSubscriptions',
    ]);
  });
});
