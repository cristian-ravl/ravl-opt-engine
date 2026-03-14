import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineContext } from '../src/providers/types.js';
import { AdvisorRecommendationsCollector } from '../src/providers/azure/collectors/advisor-collector.js';
import { VirtualMachinesCollector } from '../src/providers/azure/collectors/vm-collector.js';
import { VmssCollector } from '../src/providers/azure/collectors/vmss-collector.js';
import { decodePriceSheetDownload, extractFirstCsvFromZip } from '../src/providers/azure/collectors/pricesheet-collector.js';

vi.mock('../src/utils/arg-client.js', () => ({
  queryResourceGraph: vi.fn(),
}));
vi.mock('../src/utils/arm-client.js', () => ({
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
vi.mock('../src/providers/azure/collectors/compute-sku.js', () => ({
  loadComputeSkuCatalog: vi.fn(),
  findComputeSkuDetails: vi.fn(),
}));

import { queryResourceGraph } from '../src/utils/arg-client.js';
import { armGetAll, resolveSubscriptionIds } from '../src/utils/arm-client.js';
import { uploadJsonBlob } from '../src/utils/blob-storage.js';
import { findComputeSkuDetails, loadComputeSkuCatalog } from '../src/providers/azure/collectors/compute-sku.js';

const mockQueryResourceGraph = vi.mocked(queryResourceGraph);
const mockArmGetAll = vi.mocked(armGetAll);
const mockResolveSubscriptionIds = vi.mocked(resolveSubscriptionIds);
const mockUploadJsonBlob = vi.mocked(uploadJsonBlob);
const mockLoadComputeSkuCatalog = vi.mocked(loadComputeSkuCatalog);
const mockFindComputeSkuDetails = vi.mocked(findComputeSkuDetails);

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

function createZipWithSingleFile(fileName: string, content: string): Buffer {
  const contentBuffer = Buffer.from(content, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt32LE(0, 10);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(contentBuffer.length, 18);
  localHeader.writeUInt32LE(contentBuffer.length, 22);
  localHeader.writeUInt16LE(Buffer.byteLength(fileName), 26);
  localHeader.writeUInt16LE(0, 28);

  const fileNameBuffer = Buffer.from(fileName, 'utf8');
  const localRecord = Buffer.concat([localHeader, fileNameBuffer, contentBuffer]);

  const centralDirectory = Buffer.alloc(46);
  centralDirectory.writeUInt32LE(0x02014b50, 0);
  centralDirectory.writeUInt16LE(20, 4);
  centralDirectory.writeUInt16LE(20, 6);
  centralDirectory.writeUInt16LE(0, 8);
  centralDirectory.writeUInt16LE(0, 10);
  centralDirectory.writeUInt32LE(0, 12);
  centralDirectory.writeUInt32LE(0, 16);
  centralDirectory.writeUInt32LE(contentBuffer.length, 20);
  centralDirectory.writeUInt32LE(contentBuffer.length, 24);
  centralDirectory.writeUInt16LE(fileNameBuffer.length, 28);
  centralDirectory.writeUInt16LE(0, 30);
  centralDirectory.writeUInt16LE(0, 32);
  centralDirectory.writeUInt16LE(0, 34);
  centralDirectory.writeUInt16LE(0, 36);
  centralDirectory.writeUInt32LE(0, 38);
  centralDirectory.writeUInt32LE(0, 42);

  const centralRecord = Buffer.concat([centralDirectory, fileNameBuffer]);

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(centralRecord.length, 12);
  endOfCentralDirectory.writeUInt32LE(localRecord.length, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([localRecord, centralRecord, endOfCentralDirectory]);
}

describe('AdvisorRecommendationsCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OE_TENANT_ID;
  });

  it('derives normalized resource identity fields when metadata is sparse', async () => {
    process.env.OE_TENANT_ID = 'tenant-123';
    mockResolveSubscriptionIds.mockResolvedValue(['sub-123']);
    mockArmGetAll.mockResolvedValue([
      {
        id: '/providers/Microsoft.Advisor/recommendations/abc',
        properties: {
          category: 'HighAvailability',
          impact: 'High',
          impactedValue: '/subscriptions/sub-123/resourceGroups/Prod-RG/providers/Microsoft.Compute/virtualMachines/App-01',
          shortDescription: {
            problem: 'Problem',
            solution: 'Solution',
          },
          lastUpdated: '2026-03-13T00:00:00Z',
          resourceMetadata: {},
        },
      },
    ]);

    const collector = new AdvisorRecommendationsCollector();
    const count = await collector.collect(mockContext);

    expect(count).toBe(1);
    const rows = mockUploadJsonBlob.mock.calls[0]?.[3] as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 'tenant-123',
      subscriptionId: 'sub-123',
      resourceGroup: 'prod-rg',
      instanceId: '/subscriptions/sub-123/resourcegroups/prod-rg/providers/microsoft.compute/virtualmachines/app-01',
      instanceName: 'app-01',
      impactedArea: 'microsoft.compute/virtualmachines',
    });
  });
});

describe('Virtual machine SKU enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadComputeSkuCatalog.mockResolvedValue(new Map());
  });

  it('fills VM cores and memory from the shared compute SKU catalog', async () => {
    mockQueryResourceGraph.mockResolvedValue([
      {
        id: '/subscriptions/sub-123/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachines/app-01',
        name: 'app-01',
        tenantId: 'tenant-123',
        subscriptionId: 'sub-123',
        resourceGroup: 'prod-rg',
        location: 'eastus',
        tags: {},
        properties: {
          hardwareProfile: { vmSize: 'Standard_D2s_v3' },
          storageProfile: { osDisk: { osType: 'Linux' } },
        },
      },
    ]);
    mockFindComputeSkuDetails.mockReturnValue({ coresCount: 2, memoryMB: 8192 });

    const collector = new VirtualMachinesCollector();
    const count = await collector.collect(mockContext);

    expect(count).toBe(1);
    const rows = mockUploadJsonBlob.mock.calls[0]?.[3] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      vmSize: 'Standard_D2s_v3',
      coresCount: 2,
      memoryMB: 8192,
    });
  });

  it('fills VMSS cores and memory from the shared compute SKU catalog', async () => {
    mockQueryResourceGraph.mockResolvedValue([
      {
        id: '/subscriptions/sub-123/resourceGroups/prod-rg/providers/Microsoft.Compute/virtualMachineScaleSets/app-vmss',
        name: 'app-vmss',
        tenantId: 'tenant-123',
        subscriptionId: 'sub-123',
        resourceGroup: 'prod-rg',
        location: 'eastus',
        skuName: 'Standard_D4s_v5',
        tags: {},
      },
    ]);
    mockFindComputeSkuDetails.mockReturnValue({ coresCount: 4, memoryMB: 16384 });

    const collector = new VmssCollector();
    const count = await collector.collect(mockContext);

    expect(count).toBe(1);
    const rows = mockUploadJsonBlob.mock.calls[0]?.[3] as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({
      vmssSize: 'Standard_D4s_v5',
      coresCount: 4,
      memoryMB: 16384,
    });
  });
});

describe('Price sheet ZIP decoding', () => {
  it('extracts the first CSV file from a ZIP payload', () => {
    const zip = createZipWithSingleFile('pricesheet.csv', 'Meter ID,Meter Name\n1,VM');
    expect(extractFirstCsvFromZip(zip)).toBe('Meter ID,Meter Name\n1,VM');
  });

  it('decodes ZIP downloads transparently', () => {
    const zip = createZipWithSingleFile('pricesheet.csv', 'Meter ID,Meter Name\n1,VM');
    const decoded = decodePriceSheetDownload(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength), 'application/zip', 'https://example.com/pricesheet.zip');
    expect(decoded).toBe('Meter ID,Meter Name\n1,VM');
  });
});
