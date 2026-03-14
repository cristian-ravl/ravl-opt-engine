// Azure Blob Storage helper — stages Parquet/JSON files for ADX ingestion.

import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { EngineContext } from '../providers/types.js';

let _blobService: BlobServiceClient | null = null;

/**
 * Get a shared BlobServiceClient using managed identity.
 */
function getBlobService(ctx: EngineContext): BlobServiceClient {
  if (!_blobService) {
    const url = `https://${ctx.storageAccountName}.blob.core.windows.net`;
    _blobService = new BlobServiceClient(url, new DefaultAzureCredential());
  }
  return _blobService;
}

/**
 * Ensure a blob container exists (idempotent).
 */
async function ensureContainer(ctx: EngineContext, containerName: string): Promise<ContainerClient> {
  const service = getBlobService(ctx);
  const container = service.getContainerClient(containerName);
  await container.createIfNotExists();
  return container;
}

/**
 * Upload a JSON blob to the staging container.
 * Returns the blob URL for ADX ingestion.
 */
export async function uploadJsonBlob(ctx: EngineContext, containerName: string, blobName: string, data: Record<string, unknown>[]): Promise<string> {
  const container = await ensureContainer(ctx, containerName);
  const blockBlob = container.getBlockBlobClient(blobName);
  const content = data.map((r) => JSON.stringify(r)).join('\n');
  await blockBlob.upload(content, Buffer.byteLength(content, 'utf-8'), {
    blobHTTPHeaders: { blobContentType: 'application/x-ndjson' },
  });
  return blockBlob.url;
}

/**
 * Upload raw buffer (e.g. Parquet) to blob storage.
 */
export async function uploadBlob(ctx: EngineContext, containerName: string, blobName: string, buffer: Buffer, contentType: string): Promise<string> {
  const container = await ensureContainer(ctx, containerName);
  const blockBlob = container.getBlockBlobClient(blobName);
  await blockBlob.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
  return blockBlob.url;
}

/**
 * List all blobs in a container with an optional prefix filter.
 */
export async function listBlobs(ctx: EngineContext, containerName: string, prefix?: string): Promise<string[]> {
  const container = await ensureContainer(ctx, containerName);
  const names: string[] = [];
  for await (const blob of container.listBlobsFlat({ prefix })) {
    names.push(blob.name);
  }
  return names;
}
