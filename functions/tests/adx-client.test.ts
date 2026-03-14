import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '../src/providers/types.js';

const mockWithTokenCredential = vi.fn((clusterUri: string, credential: unknown) => ({
  clusterUri,
  credential,
}));

const mockKustoClient = vi.fn(
  class MockKustoClient {
    builder: unknown;
    execute = vi.fn();
    executeMgmt = vi.fn();

    constructor(builder: unknown) {
      this.builder = builder;
    }
  },
);

const mockIngestClient = vi.fn(
  class MockIngestClient {
    builder: unknown;
    ingestFromStream = vi.fn();

    constructor(builder: unknown) {
      this.builder = builder;
    }
  },
);

const mockDefaultAzureCredential = vi.fn(
  class MockDefaultAzureCredential {
    readonly kind = 'DefaultAzureCredential';
  },
);

vi.mock('azure-kusto-data', () => ({
  Client: mockKustoClient,
  KustoConnectionStringBuilder: {
    withTokenCredential: mockWithTokenCredential,
  },
}));

vi.mock('azure-kusto-ingest', () => ({
  IngestClient: mockIngestClient,
  IngestionProperties: class {},
  DataFormat: { JSON: 'json' },
  ReportLevel: { FailuresOnly: 0 },
  IngestionMappingKind: { JSON: 'json' },
}));

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: mockDefaultAzureCredential,
}));

const baseContext: EngineContext = {
  cloudEnvironment: 'AzureCloud',
  adxClusterUri: 'https://testcluster.westeurope.kusto.windows.net',
  adxDatabase: 'OptimizationEngine',
  storageAccountName: 'teststorage',
  referenceRegion: 'westeurope',
  consumptionOffsetDays: 2,
  longDeallocatedVmDays: 30,
  aadExpiringCredsDays: 30,
  targetSubscriptions: [],
};

describe('adx-client', () => {
  beforeEach(() => {
    vi.resetModules();
    mockWithTokenCredential.mockClear();
    mockKustoClient.mockClear();
    mockIngestClient.mockClear();
    mockDefaultAzureCredential.mockClear();
  });

  it('builds the ingest URI by prefixing the cluster host once', async () => {
    const { toIngestClusterUri } = await import('../src/utils/adx-client.js');

    expect(toIngestClusterUri('https://testcluster.westeurope.kusto.windows.net')).toBe(
      'https://ingest-testcluster.westeurope.kusto.windows.net',
    );
    expect(toIngestClusterUri('https://ingest-testcluster.westeurope.kusto.windows.net/')).toBe(
      'https://ingest-testcluster.westeurope.kusto.windows.net',
    );
  });

  it('uses TokenCredential auth for query clients and reuses the client per cluster URI', async () => {
    const { getQueryClient } = await import('../src/utils/adx-client.js');

    const clientA = getQueryClient(baseContext);
    const clientB = getQueryClient(baseContext);

    expect(clientA).toBe(clientB);
    expect(mockDefaultAzureCredential).toHaveBeenCalledTimes(1);
    expect(mockWithTokenCredential).toHaveBeenCalledTimes(1);
    expect(mockWithTokenCredential).toHaveBeenCalledWith(baseContext.adxClusterUri, expect.any(Object));
    expect(mockKustoClient).toHaveBeenCalledTimes(1);
  });

  it('recreates Kusto clients when the target cluster changes', async () => {
    const { getQueryClient, getIngestClient } = await import('../src/utils/adx-client.js');
    const otherContext: EngineContext = {
      ...baseContext,
      adxClusterUri: 'https://othercluster.westeurope.kusto.windows.net',
    };

    getQueryClient(baseContext);
    getQueryClient(otherContext);
    getIngestClient(baseContext);
    getIngestClient(otherContext);

    expect(mockKustoClient).toHaveBeenCalledTimes(2);
    expect(mockIngestClient).toHaveBeenCalledTimes(2);
    expect(mockWithTokenCredential).toHaveBeenNthCalledWith(
      3,
      'https://ingest-testcluster.westeurope.kusto.windows.net',
      expect.any(Object),
    );
    expect(mockWithTokenCredential).toHaveBeenNthCalledWith(
      4,
      'https://ingest-othercluster.westeurope.kusto.windows.net',
      expect.any(Object),
    );
  });
});
