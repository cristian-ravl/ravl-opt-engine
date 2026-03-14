// ADX (Azure Data Explorer / Kusto) client wrapper.
// Provides query, management command, and ingestion methods using DefaultAzureCredential.

import { Client as KustoClient, KustoConnectionStringBuilder } from 'azure-kusto-data';
import { IngestClient, IngestionProperties, DataFormat, ReportLevel, IngestionMappingKind } from 'azure-kusto-ingest';
import { DefaultAzureCredential } from '@azure/identity';
import { Readable } from 'stream';
import type { EngineContext } from '../providers/types.js';

let _queryClient: KustoClient | null = null;
let _queryClientUri: string | null = null;
let _ingestClient: IngestClient | null = null;
let _ingestClientUri: string | null = null;
let _credential: DefaultAzureCredential | null = null;

function getCredential(): DefaultAzureCredential {
  _credential ??= new DefaultAzureCredential();
  return _credential;
}

export function buildKustoConnectionStringBuilder(clusterUri: string): KustoConnectionStringBuilder {
  return KustoConnectionStringBuilder.withTokenCredential(clusterUri, getCredential());
}

export function toIngestClusterUri(clusterUri: string): string {
  const url = new URL(clusterUri);
  if (!url.hostname.startsWith('ingest-')) {
    url.hostname = `ingest-${url.hostname}`;
  }
  return url.toString().replace(/\/$/, '');
}

/**
 * Get (or create) a shared Kusto query client for the given context.
 * Uses DefaultAzureCredential (managed identity in Azure, CLI locally).
 */
export function getQueryClient(ctx: EngineContext): KustoClient {
  if (!_queryClient || _queryClientUri !== ctx.adxClusterUri) {
    const kcsb = buildKustoConnectionStringBuilder(ctx.adxClusterUri);
    _queryClient = new KustoClient(kcsb);
    _queryClientUri = ctx.adxClusterUri;
  }
  return _queryClient;
}

/**
 * Get (or create) a shared Kusto ingest client for the given context.
 * The ingest URI is derived from the cluster URI by prefixing "ingest-".
 */
export function getIngestClient(ctx: EngineContext): IngestClient {
  const ingestUri = toIngestClusterUri(ctx.adxClusterUri);
  if (!_ingestClient || _ingestClientUri !== ingestUri) {
    const kcsb = buildKustoConnectionStringBuilder(ingestUri);
    _ingestClient = new IngestClient(kcsb);
    _ingestClientUri = ingestUri;
  }
  return _ingestClient;
}

/**
 * Execute a KQL query and return results as an array of typed rows.
 */
export async function query<T = Record<string, unknown>>(ctx: EngineContext, kql: string): Promise<T[]> {
  const client = getQueryClient(ctx);
  const response = await client.execute(ctx.adxDatabase, kql);
  const table = response.primaryResults[0];
  if (!table) return [];

  const results: T[] = [];
  for (const row of table.rows()) {
    const obj = row.toJSON() as Record<string, unknown>;
    results.push(obj as T);
  }
  return results;
}

/**
 * Ingest a JSON array into the specified ADX table using queued ingestion.
 */
export async function ingest<T extends object>(
  ctx: EngineContext,
  table: string,
  data: T[],
  jsonMappingName?: string,
): Promise<void> {
  if (data.length === 0) return;

  const client = getIngestClient(ctx);
  console.info(`Submitting ${data.length} rows to ADX table '${table}'`);
  const props = new IngestionProperties({
    database: ctx.adxDatabase,
    table,
    format: DataFormat.JSON,
    reportLevel: ReportLevel.FailuresOnly,
    ...(jsonMappingName && {
      ingestionMappingKind: IngestionMappingKind.JSON,
      ingestionMappingReference: jsonMappingName,
    }),
  });

  const jsonContent = data.map((r) => JSON.stringify(r)).join('\n');
  const buffer = Buffer.from(jsonContent, 'utf-8');
  const stream = Readable.from(buffer);
  await client.ingestFromStream(stream, props);
}

/**
 * Execute a KQL management command (e.g., .set-or-append, .alter, .drop).
 * Management commands must use executeMgmt, not execute.
 */
export async function executeMgmt(ctx: EngineContext, command: string): Promise<void> {
  const client = getQueryClient(ctx);
  await client.executeMgmt(ctx.adxDatabase, command);
}
