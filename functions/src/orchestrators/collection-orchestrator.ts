// Durable Functions collection orchestrator — fans out to all collectors in parallel,
// then triggers ADX ingestion for the staged data.

import * as df from 'durable-functions';
import { app, type InvocationContext, type TimerHandler } from '@azure/functions';
import { buildContext, isAwsEnabled, isGcpEnabled } from '../config/index.js';
import { AzureProvider } from '../providers/azure/index.js';
import type { EngineContext, ICollector } from '../providers/types.js';

// ============================================================================
// Activity: run a single collector
// ============================================================================

interface CollectorInput {
  collectorId: string;
  cloud: string;
  context: EngineContext;
}

interface CollectorResult {
  collectorId: string;
  recordCount: number;
  durationMs?: number;
  error?: string;
}

// Collectors that require extra permissions/configuration and should not block
// core data collection (resource inventory, cost, and metrics).
const NON_CRITICAL_COLLECTOR_IDS = new Set<string>([
  'azure-pricesheet',
  'azure-reservations-price',
  'azure-reservations-usage',
  'azure-savings-plans-usage',
  'azure-aad-objects',
  'azure-rbac-assignments',
  'azure-policy-compliance',
]);

df.app.activity('runCollector', {
  handler: async (input: CollectorInput, context: InvocationContext): Promise<CollectorResult> => {
    const startedAt = Date.now();
    const collector = findCollector(input.collectorId, input.cloud);
    if (!collector) {
      context.error(`Collector '${input.collectorId}' for cloud '${input.cloud}' was not found`);
      return {
        collectorId: input.collectorId,
        recordCount: 0,
        durationMs: Date.now() - startedAt,
        error: 'Collector not found',
      };
    }

    try {
      context.log(`Starting collector '${input.collectorId}' for cloud '${input.cloud}'`);
      const count = await collector.collect(input.context);
      context.log(`Collector '${input.collectorId}' completed with ${count} rows in ${Date.now() - startedAt}ms`);
      return {
        collectorId: input.collectorId,
        recordCount: count,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      context.error(`Collector '${input.collectorId}' failed after ${Date.now() - startedAt}ms: ${message}`);
      return {
        collectorId: input.collectorId,
        recordCount: 0,
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }
  },
});

// ============================================================================
// Sub-orchestrator per cloud provider
// ============================================================================

df.app.orchestration('collectCloud', function* (context) {
  const input = context.df.getInput() as { cloud: string; context: EngineContext };
  const provider = getProvider(input.cloud);
  if (!provider) return [];

  const retryOptions = new df.RetryOptions(5000, 3);
  retryOptions.backoffCoefficient = 2;

  // Fan out: run all collectors in parallel
  const tasks = provider.collectors.map((c: ICollector) =>
    context.df.callActivityWithRetry('runCollector', retryOptions, {
      collectorId: c.id,
      cloud: input.cloud,
      context: input.context,
    } satisfies CollectorInput),
  );

  const results: CollectorResult[] = yield context.df.Task.all(tasks);
  return results;
});

// ============================================================================
// Main orchestrator — dispatches to each enabled cloud
// ============================================================================

df.app.orchestration('collectionOrchestrator', function* (context) {
  const ctx = context.df.getInput() as EngineContext;
  const allResults: CollectorResult[] = [];

  // Always run Azure
  const azureResults: CollectorResult[] = yield context.df.callSubOrchestrator('collectCloud', { cloud: 'Azure', context: ctx });
  allResults.push(...azureResults);

  // Optionally run AWS
  if (isAwsEnabled()) {
    const awsResults: CollectorResult[] = yield context.df.callSubOrchestrator('collectCloud', { cloud: 'AWS', context: ctx });
    allResults.push(...awsResults);
  }

  // Optionally run GCP
  if (isGcpEnabled()) {
    const gcpResults: CollectorResult[] = yield context.df.callSubOrchestrator('collectCloud', { cloud: 'GCP', context: ctx });
    allResults.push(...gcpResults);
  }

  // Summary
  const totalRecords = allResults.reduce((sum: number, r: CollectorResult) => sum + r.recordCount, 0);
  const failures = allResults.filter((r: CollectorResult) => r.error);
  const criticalFailures = failures.filter((f) => !NON_CRITICAL_COLLECTOR_IDS.has(f.collectorId));
  const nonCriticalFailures = failures.filter((f) => NON_CRITICAL_COLLECTOR_IDS.has(f.collectorId));

  if (criticalFailures.length > 0) {
    const failureSummary = criticalFailures.map((f) => `${f.collectorId}: ${f.error ?? 'unknown error'}`).join(' | ');
    throw new Error(`Collection failed for ${criticalFailures.length}/${allResults.length} critical collectors. ${failureSummary}`);
  }

  const warningSummary = nonCriticalFailures.map((f) => `${f.collectorId}: ${f.error ?? 'unknown error'}`);

  return {
    totalCollectors: allResults.length,
    totalRecords,
    failures: criticalFailures.length,
    warnings: nonCriticalFailures.length,
    warningSummary,
    details: allResults,
  };
});

// ============================================================================
// Timer trigger: scheduled collection
// ============================================================================

const collectionTimerTrigger: TimerHandler = async (_timer: unknown, context: InvocationContext) => {
  const client = df.getClient(context);
  const ctx = buildContext();
  const instanceId = await client.startNew('collectionOrchestrator', { input: ctx });
  context.log(`Started collection orchestrator: ${instanceId}`);
};

app.timer('collectionTimer', {
  schedule: process.env.OE_COLLECTION_SCHEDULE ?? '0 0 2 * * *',
  handler: collectionTimerTrigger,
  extraInputs: [df.input.durableClient()],
});

// ============================================================================
// HTTP trigger: manual collection start
// ============================================================================

app.http('startCollection', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orchestrators/collection',
  extraInputs: [df.input.durableClient()],
  handler: async (req, context) => {
    const client = df.getClient(context);
    const ctx = buildContext();
    const instanceId = await client.startNew('collectionOrchestrator', { input: ctx });
    context.log(`Started collection orchestrator via HTTP: ${instanceId}`);
    return client.createCheckStatusResponse(req, instanceId);
  },
});

// ============================================================================
// Provider registry helpers
// ============================================================================

const azureProvider = new AzureProvider();

function getProvider(cloud: string) {
  switch (cloud) {
    case 'Azure':
      return azureProvider;
    default:
      return null;
  }
}

function findCollector(id: string, cloud: string): ICollector | undefined {
  const provider = getProvider(cloud);
  return provider?.collectors.find((c: ICollector) => c.id === id);
}
