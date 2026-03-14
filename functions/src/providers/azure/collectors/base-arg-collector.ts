// Base class for ARG-based Azure collectors.
// Subclasses provide the KQL query, container name, and row mapping.

import type { EngineContext, ICollector, CloudProvider } from '../../types.js';
import { queryResourceGraph } from '../../../utils/arg-client.js';
import { uploadJsonBlob } from '../../../utils/blob-storage.js';
import { ingestCollectorRows } from './ingestion.js';

/**
 * Abstract base for collectors that query Azure Resource Graph and upload
 * the normalized results to blob storage as NDJSON.
 */
export abstract class AzureArgCollector implements ICollector {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly targetSuffix: string;
  readonly cloud: CloudProvider = 'Azure';

  /** KQL queries to execute. Override in subclass. */
  protected abstract getQueries(ctx: EngineContext): string[];

  /** Map a raw ARG row to the normalized output record. */
  protected abstract mapRow(row: Record<string, unknown>, timestamp: string): Record<string, unknown>;

  /**
   * Batch mapping hook for collectors that need to enrich rows using shared
   * lookup data before upload/ingestion.
   */
  protected async mapRows(rows: Record<string, unknown>[], ctx: EngineContext, timestamp: string): Promise<Record<string, unknown>[]> {
    void ctx;
    return rows.map((row) => this.mapRow(row, timestamp));
  }

  async collect(ctx: EngineContext): Promise<number> {
    const timestamp = new Date().toISOString();
    const queries = this.getQueries(ctx);
    let totalRecords = 0;

    for (let qi = 0; qi < queries.length; qi++) {
      const rows = await queryResourceGraph(queries[qi], ctx);
      if (rows.length === 0) continue;

      const mapped = await this.mapRows(rows as Record<string, unknown>[], ctx, timestamp);
      const blobName = `${this.id}/${timestamp.replace(/[:.]/g, '-')}-${qi}.ndjson`;
      await uploadJsonBlob(ctx, this.targetSuffix, blobName, mapped);
      await ingestCollectorRows(ctx, this.id, this.targetSuffix, mapped);
      totalRecords += mapped.length;
    }

    return totalRecords;
  }

  /** Helper: safely extract tags as a record */
  protected parseTags(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, string>;
  }
}
