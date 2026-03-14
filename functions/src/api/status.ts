// REST API: Status & health endpoints for monitoring the optimization engine.

import * as df from 'durable-functions';
import { app, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { buildContext } from '../config/index.js';
import { query } from '../utils/adx-client.js';
import { AzureProvider } from '../providers/azure/index.js';
import type { ICollector, IRecommender, IRemediator } from '../providers/types.js';

type CollectorIngestionStatus = {
  SourceId: string;
  LastProcessedDateTime: string;
  LastProcessedMarker: string;
  TargetTableSuffix: string;
  CollectedType: string;
};

// ============================================================================
// GET /api/status — engine health overview
// ============================================================================

app.http('getStatus', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status',
  handler: async (): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const azureProvider = new AzureProvider();

    // Check ADX connectivity
    const adxHealthy = await (async () => {
      try {
        await query(ctx, 'print HealthCheck = "ok"');
        return true;
      } catch {
        return false;
      }
    })();

    // Get latest collection and recommendation run timestamps
    let lastCollectionRun: string | null = null;
    let lastRecommendationRun: string | null = null;
    const collectorStatusById = new Map<string, CollectorIngestionStatus>();
    try {
      const collResult = await query<{ LastRun: string }>(ctx, 'IngestionControl | summarize LastRun = max(LastProcessedDateTime)');
      lastCollectionRun = collResult[0]?.LastRun ?? null;

      const recResult = await query<{ LastRun: string }>(ctx, 'Recommendations | summarize LastRun = max(GeneratedDate)');
      lastRecommendationRun = recResult[0]?.LastRun ?? null;

      const collectorResults = await query<CollectorIngestionStatus>(
        ctx,
        `
        IngestionControl
        | summarize arg_max(LastProcessedDateTime, *) by SourceId
        | project SourceId, LastProcessedDateTime, LastProcessedMarker, TargetTableSuffix, CollectedType
      `,
      );

      for (const collector of collectorResults) {
        collectorStatusById.set(collector.SourceId.toLowerCase(), collector);
      }
    } catch {
      // Swallow — tables may not exist yet on first run
    }

    // Get record counts
    const counts: Record<string, number> = {};
    try {
      const tableCountsKql = `
        union withsource=TableName
          (VirtualMachines | count | extend TableName = "VirtualMachines"),
          (ManagedDisks | count | extend TableName = "ManagedDisks"),
          (Recommendations | count | extend TableName = "Recommendations"),
          (Suppressions | count | extend TableName = "Suppressions"),
          (CostData | count | extend TableName = "CostData"),
          (PriceSheetData | count | extend TableName = "PriceSheetData"),
          (IngestionControl | count | extend TableName = "IngestionControl")
        | project TableName, Count
      `;
      const tableResults = await query<{ TableName: string; Count: number }>(ctx, tableCountsKql);
      for (const t of tableResults) {
        counts[t.TableName] = t.Count;
      }
    } catch {
      // Tables may not exist yet
    }

    return {
      status: 200,
      jsonBody: {
        status: adxHealthy ? 'healthy' : 'degraded',
        version: '2.0.0',
        adx: { connected: adxHealthy, clusterUri: ctx.adxClusterUri, database: ctx.adxDatabase },
        providers: {
          Azure: {
            collectors: azureProvider.collectors.length,
            recommenders: azureProvider.recommenders.length,
            remediators: azureProvider.remediators.length,
          },
        },
        collectorRuns: azureProvider.collectors.map((collector: ICollector) => {
          const ingestionStatus = collectorStatusById.get(collector.id.toLowerCase());
          return {
            id: collector.id,
            name: collector.name,
            cloud: collector.cloud,
            targetSuffix: collector.targetSuffix,
            collectedType: ingestionStatus?.CollectedType ?? null,
            lastSuccessfulCollection: ingestionStatus?.LastProcessedDateTime ?? null,
            lastProcessedMarker: ingestionStatus?.LastProcessedMarker ?? null,
          };
        }),
        lastCollectionRun,
        lastRecommendationRun,
        tableCounts: counts,
      },
    };
  },
});

// ============================================================================
// GET /api/status/orchestrations — list recent orchestration instances
// ============================================================================

app.http('getOrchestrations', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status/orchestrations',
  extraInputs: [df.input.durableClient()],
  handler: async (req, context: InvocationContext): Promise<HttpResponseInit> => {
    const client = df.getClient(context);

    const instances = await client.getStatusAll();

    return { status: 200, jsonBody: instances };
  },
});

// ============================================================================
// GET /api/status/orchestrations/{instanceId} — get specific orchestration instance
// ============================================================================

app.http('getOrchestrationById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'status/orchestrations/{instanceId}',
  extraInputs: [df.input.durableClient()],
  handler: async (req, context: InvocationContext): Promise<HttpResponseInit> => {
    const client = df.getClient(context);
    const instanceId = req.params.instanceId;

    if (!instanceId) {
      return { status: 400, jsonBody: { error: 'Missing orchestration instanceId' } };
    }

    const instance = await client.getStatus(instanceId);
    if (!instance) {
      return { status: 404, jsonBody: { error: `Orchestration instance not found: ${instanceId}` } };
    }

    return { status: 200, jsonBody: instance };
  },
});

// ============================================================================
// GET /api/providers — list registered cloud providers and their plugins
// ============================================================================

app.http('getProviders', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'providers',
  handler: async (): Promise<HttpResponseInit> => {
    const azureProvider = new AzureProvider();

    return {
      status: 200,
      jsonBody: {
        providers: [
          {
            cloud: azureProvider.cloud,
            collectors: azureProvider.collectors.map((c: ICollector) => ({
              id: c.id,
              name: c.name,
              targetSuffix: c.targetSuffix,
            })),
            recommenders: azureProvider.recommenders.map((r: IRecommender) => ({
              id: r.id,
              name: r.name,
              subTypes: r.subTypes,
            })),
            remediators: azureProvider.remediators.map((r: IRemediator) => ({
              id: r.id,
              name: r.name,
              handlesSubTypeIds: r.handlesSubTypeIds,
            })),
          },
        ],
      },
    };
  },
});
