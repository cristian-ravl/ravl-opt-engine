import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '../src/providers/types.js';
import { MonitorMetricsCollector } from '../src/providers/azure/collectors/metrics-collector.js';

vi.mock('../src/utils/arg-client.js', () => ({
  queryResourceGraph: vi.fn(),
}));
vi.mock('../src/utils/arm-client.js', () => ({
  armGet: vi.fn(),
  armGetAll: vi.fn(),
  resolveSubscriptionIds: vi.fn(),
}));
vi.mock('../src/utils/adx-client.js', () => ({
  query: vi.fn(),
  ingest: vi.fn(),
}));
vi.mock('../src/utils/blob-storage.js', () => ({
  uploadJsonBlob: vi.fn(),
  uploadBlob: vi.fn(),
  listBlobs: vi.fn(),
}));

import { queryResourceGraph } from '../src/utils/arg-client.js';
import { armGet } from '../src/utils/arm-client.js';
import { uploadJsonBlob } from '../src/utils/blob-storage.js';

const mockQueryResourceGraph = vi.mocked(queryResourceGraph);
const mockArmGet = vi.mocked(armGet);
const mockUploadJsonBlob = vi.mocked(uploadJsonBlob);

const mockContext: EngineContext = {
  cloudEnvironment: 'AzureCloud',
  adxClusterUri: 'https://test.kusto.windows.net',
  adxDatabase: 'TestDB',
  storageAccountName: 'teststorage',
  referenceRegion: 'westeurope',
  consumptionOffsetDays: 7,
  longDeallocatedVmDays: 30,
  aadExpiringCredsDays: 30,
  targetSubscriptions: [],
};

describe('MonitorMetricsCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects App Service plan metrics for non-Free plans without requiring Dedicated compute mode', async () => {
    mockQueryResourceGraph.mockImplementation(async (kql: string) => {
      if (kql.includes("type =~ 'microsoft.web/serverfarms'")) {
        return [
          {
            id: '/subscriptions/sub-123/resourceGroups/rg-oev2/providers/Microsoft.Web/serverFarms/plan-oedev',
            subscriptionId: 'sub-123',
          },
        ];
      }

      return [];
    });

    mockArmGet.mockImplementation(async (path: string) => {
      if (path.includes('metricnames=CpuPercentage')) {
        return {
          value: [
            {
              unit: 'Percent',
              timeseries: [
                {
                  data: [{ average: 12 }, { average: 18 }],
                },
              ],
            },
          ],
        };
      }

      if (path.includes('metricnames=MemoryPercentage')) {
        return {
          value: [
            {
              unit: 'Percent',
              timeseries: [
                {
                  data: [{ average: 35 }, { average: 45 }],
                },
              ],
            },
          ],
        };
      }

      throw new Error(`Unexpected metric request: ${path}`);
    });

    const collector = new MonitorMetricsCollector();
    const count = await collector.collect(mockContext);

    expect(count).toBe(2);
    expect(mockQueryResourceGraph.mock.calls[0]?.[0]).toContain("sku.tier !in~ ('Free', 'Shared')");
    expect(mockQueryResourceGraph.mock.calls[0]?.[0]).not.toContain("properties.computeMode == 'Dedicated'");
    expect(mockArmGet.mock.calls[0]?.[0]).toContain('metricnamespace=Microsoft.Web%2FserverFarms');

    const uploadedRows = mockUploadJsonBlob.mock.calls.flatMap((call) => call[3] as Record<string, unknown>[]);
    expect(uploadedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metricName: 'CpuPercentage',
          value: 15,
          unit: 'Percent',
          instanceId: '/subscriptions/sub-123/resourcegroups/rg-oev2/providers/microsoft.web/serverfarms/plan-oedev',
        }),
        expect.objectContaining({
          metricName: 'MemoryPercentage',
          value: 40,
          unit: 'Percent',
          instanceId: '/subscriptions/sub-123/resourcegroups/rg-oev2/providers/microsoft.web/serverfarms/plan-oedev',
        }),
      ]),
    );
  });

  it('throws when every metric query for a definition fails', async () => {
    mockQueryResourceGraph.mockImplementation(async (kql: string) => {
      if (kql.includes("type =~ 'microsoft.compute/virtualmachinescalesets'")) {
        return [
          {
            id: '/subscriptions/sub-123/resourceGroups/rg-oev2/providers/Microsoft.Compute/virtualMachineScaleSets/app-vmss',
            subscriptionId: 'sub-123',
          },
        ];
      }

      return [];
    });

    mockArmGet.mockRejectedValue(new Error('Forbidden'));

    const collector = new MonitorMetricsCollector();

    await expect(collector.collect(mockContext)).rejects.toThrow("Metrics collection failed for 'vmss-cpu-average'");
  });
});
