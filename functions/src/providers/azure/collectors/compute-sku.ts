import { armGetAll, resolveSubscriptionIds } from '../../../utils/arm-client.js';
import type { EngineContext } from '../../types.js';

type ComputeSkuCapability = {
  name?: string;
  value?: string;
};

type ComputeSkuLocationInfo = {
  location?: string;
};

type ComputeSkuRecord = {
  name?: string;
  resourceType?: string;
  locations?: string[];
  locationInfo?: ComputeSkuLocationInfo[];
  capabilities?: ComputeSkuCapability[];
};

export interface ComputeSkuDetails {
  name: string;
  resourceType: string;
  location: string;
  coresCount: number;
  memoryMB: number;
  maxDataDiskCount: number;
  maxNetworkInterfaces: number;
  premiumIO: boolean;
  cpuArchitectureType: string;
}

export type ComputeSkuCatalog = Map<string, ComputeSkuDetails>;

const COMPUTE_SKU_API_VERSION = '2021-07-01';
const COMPUTE_RESOURCE_TYPES = new Set(['virtualmachines', 'virtualmachinescalesets']);
const VCPU_CAPABILITY_NAMES = ['vcpusavailable', 'vcpus'];
const MEMORY_MB_CAPABILITY_NAMES = ['memorymb'];
const MEMORY_GB_CAPABILITY_NAMES = ['memorygb'];
const MAX_DATA_DISK_COUNT_NAMES = ['maxdatadiskcount'];
const MAX_NETWORK_INTERFACE_NAMES = ['maxnetworkinterfaces'];
const PREMIUM_IO_NAMES = ['premiumio'];
const CPU_ARCHITECTURE_TYPE_NAMES = ['cpuarchitecturetype'];

const catalogCache = new Map<string, Promise<ComputeSkuCatalog>>();

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function buildCatalogKey(resourceType: string, location: string, skuName: string): string {
  return `${normalizeKeyPart(resourceType)}|${normalizeKeyPart(location)}|${normalizeKeyPart(skuName)}`;
}

function parseCapabilityNumber(capabilities: ComputeSkuCapability[] | undefined, candidateNames: string[]): number | null {
  if (!capabilities?.length) return null;

  for (const capability of capabilities) {
    const capabilityName = normalizeKeyPart(capability.name ?? '');
    if (!candidateNames.includes(capabilityName)) continue;

    const parsed = Number(capability.value ?? '');
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function extractComputeSkuDetails(record: ComputeSkuRecord): ComputeSkuDetails | null {
  const capabilities = record.capabilities ?? [];
  const coresCount = parseCapabilityNumber(capabilities, VCPU_CAPABILITY_NAMES);
  const memoryMBDirect = parseCapabilityNumber(capabilities, MEMORY_MB_CAPABILITY_NAMES);
  const memoryGB = parseCapabilityNumber(capabilities, MEMORY_GB_CAPABILITY_NAMES);
  const memoryMB = memoryMBDirect ?? (memoryGB !== null ? Math.round(memoryGB * 1024) : null);
  const maxDataDiskCount = parseCapabilityNumber(capabilities, MAX_DATA_DISK_COUNT_NAMES) ?? 0;
  const maxNetworkInterfaces = parseCapabilityNumber(capabilities, MAX_NETWORK_INTERFACE_NAMES) ?? 0;
  const premiumIORaw = capabilities.find((capability) => PREMIUM_IO_NAMES.includes(normalizeKeyPart(capability.name ?? ''))) ?? null;
  const cpuArchitectureType =
    capabilities.find((capability) => CPU_ARCHITECTURE_TYPE_NAMES.includes(normalizeKeyPart(capability.name ?? '')))?.value ?? '';

  if (coresCount === null || memoryMB === null) {
    return null;
  }

  return {
    name: String(record.name ?? ''),
    resourceType: normalizeKeyPart(record.resourceType ?? ''),
    location: '',
    coresCount: Math.round(coresCount),
    memoryMB: Math.round(memoryMB),
    maxDataDiskCount: Math.round(maxDataDiskCount),
    maxNetworkInterfaces: Math.round(maxNetworkInterfaces),
    premiumIO: String(premiumIORaw?.value ?? '').toLowerCase() === 'true',
    cpuArchitectureType: String(cpuArchitectureType),
  };
}

function buildCatalog(records: ComputeSkuRecord[]): ComputeSkuCatalog {
  const catalog: ComputeSkuCatalog = new Map();

  for (const record of records) {
    const resourceType = normalizeKeyPart(record.resourceType ?? '');
    const skuName = String(record.name ?? '');
    if (!COMPUTE_RESOURCE_TYPES.has(resourceType) || !skuName) continue;

    const details = extractComputeSkuDetails(record);
    if (!details) continue;

    const locations = new Set<string>([
      ...(record.locations ?? []),
      ...(record.locationInfo ?? []).map((info) => String(info.location ?? '')),
    ]);

    for (const location of locations) {
      if (!location) continue;
      catalog.set(buildCatalogKey(resourceType, location, skuName), {
        ...details,
        location: normalizeKeyPart(location),
      });
    }
  }

  return catalog;
}

async function loadSkuRecords(subscriptionId: string): Promise<ComputeSkuRecord[]> {
  return armGetAll<ComputeSkuRecord>(`/subscriptions/${subscriptionId}/providers/Microsoft.Compute/skus?api-version=${COMPUTE_SKU_API_VERSION}`);
}

function buildCacheKey(ctx: EngineContext): string {
  return ctx.targetSubscriptions.length > 0 ? [...ctx.targetSubscriptions].sort().join(',') : '__all_subscriptions__';
}

export async function loadComputeSkuCatalog(ctx: EngineContext): Promise<ComputeSkuCatalog> {
  const cacheKey = buildCacheKey(ctx);
  let cached = catalogCache.get(cacheKey);

  if (!cached) {
    cached = (async () => {
      const subscriptionIds = await resolveSubscriptionIds(ctx);
      let lastError: unknown;

      for (const subscriptionId of subscriptionIds) {
        try {
          const records = await loadSkuRecords(subscriptionId);
          const catalog = buildCatalog(records);
          if (catalog.size > 0) {
            return catalog;
          }
        } catch (error: unknown) {
          lastError = error;
        }
      }

      if (lastError) {
        throw lastError;
      }

      return new Map();
    })();

    catalogCache.set(cacheKey, cached);
  }

  return cached;
}

export function findComputeSkuDetails(catalog: ComputeSkuCatalog, resourceType: string, location: string, skuName: string): ComputeSkuDetails | undefined {
  return catalog.get(buildCatalogKey(resourceType, location, skuName));
}

export function listComputeSkuDetails(catalog: ComputeSkuCatalog, resourceType: string, location: string): ComputeSkuDetails[] {
  const normalizedResourceType = normalizeKeyPart(resourceType);
  const normalizedLocation = normalizeKeyPart(location);

  return [...catalog.values()].filter(
    (details) => details.resourceType === normalizedResourceType && details.location === normalizedLocation,
  );
}
