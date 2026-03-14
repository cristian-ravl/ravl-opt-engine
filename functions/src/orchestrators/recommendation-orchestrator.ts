// Durable Functions recommendation orchestrator — fans out to all recommenders in parallel,
// applying suppression filters to the final output.

import * as df from 'durable-functions';
import { app, type InvocationContext, type TimerHandler } from '@azure/functions';
import { buildContext, isAwsEnabled, isGcpEnabled } from '../config/index.js';
import { AzureProvider } from '../providers/azure/index.js';
import type { EngineContext, IRecommender } from '../providers/types.js';

// ============================================================================
// Activity: run a single recommender
// ============================================================================

interface RecommenderInput {
  recommenderId: string;
  cloud: string;
  context: EngineContext;
}

interface RecommenderResult {
  recommenderId: string;
  count: number;
  durationMs?: number;
  error?: string;
}

df.app.activity('runRecommender', {
  handler: async (input: RecommenderInput): Promise<RecommenderResult> => {
    const startedAt = Date.now();
    const recommender = findRecommender(input.recommenderId, input.cloud);
    if (!recommender) {
      return {
        recommenderId: input.recommenderId,
        count: 0,
        durationMs: Date.now() - startedAt,
        error: 'Recommender not found',
      };
    }

    try {
      const recommendations = await recommender.generateRecommendations(input.context);
      return {
        recommenderId: input.recommenderId,
        count: recommendations.length,
        durationMs: Date.now() - startedAt,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        recommenderId: input.recommenderId,
        count: 0,
        durationMs: Date.now() - startedAt,
        error: message,
      };
    }
  },
});

// ============================================================================
// Sub-orchestrator per cloud provider
// ============================================================================

df.app.orchestration('recommendCloud', function* (context) {
  const input = context.df.getInput() as { cloud: string; context: EngineContext };
  const provider = getProvider(input.cloud);
  if (!provider) return [];

  const retryOptions = new df.RetryOptions(5000, 3);
  retryOptions.backoffCoefficient = 2;

  // Fan out: run all recommenders in parallel
  const tasks = provider.recommenders.map((r: IRecommender) =>
    context.df.callActivityWithRetry(
      'runRecommender',
      retryOptions,
      {
        recommenderId: r.id,
        cloud: input.cloud,
        context: input.context,
      } satisfies RecommenderInput,
    ),
  );

  const results: RecommenderResult[] = yield context.df.Task.all(tasks);
  return results;
});

// ============================================================================
// Main recommendation orchestrator
// ============================================================================

df.app.orchestration('recommendationOrchestrator', function* (context) {
  const ctx = context.df.getInput() as EngineContext;
  const allResults: RecommenderResult[] = [];

  // Azure recommendations
  const azureResults: RecommenderResult[] = yield context.df.callSubOrchestrator('recommendCloud', { cloud: 'Azure', context: ctx });
  allResults.push(...azureResults);

  // AWS recommendations
  if (isAwsEnabled()) {
    const awsResults: RecommenderResult[] = yield context.df.callSubOrchestrator('recommendCloud', { cloud: 'AWS', context: ctx });
    allResults.push(...awsResults);
  }

  // GCP recommendations
  if (isGcpEnabled()) {
    const gcpResults: RecommenderResult[] = yield context.df.callSubOrchestrator('recommendCloud', { cloud: 'GCP', context: ctx });
    allResults.push(...gcpResults);
  }

  const totalRecommendations = allResults.reduce((sum: number, r: RecommenderResult) => sum + r.count, 0);
  const failures = allResults.filter((r: RecommenderResult) => r.error);

  if (failures.length > 0) {
    const failureSummary = failures
      .map((f) => `${f.recommenderId}: ${f.error ?? 'unknown error'}`)
      .join(' | ');
    throw new Error(`Recommendation run failed for ${failures.length}/${allResults.length} recommenders. ${failureSummary}`);
  }

  return {
    totalRecommenders: allResults.length,
    totalRecommendations,
    failures: failures.length,
    details: allResults,
  };
});

// ============================================================================
// Timer trigger: weekly recommendation run
// ============================================================================

const recommendationTimerTrigger: TimerHandler = async (_timer: unknown, context: InvocationContext) => {
  const client = df.getClient(context);
  const ctx = buildContext();
  const instanceId = await client.startNew('recommendationOrchestrator', { input: ctx });
  context.log(`Started recommendation orchestrator: ${instanceId}`);
};

app.timer('recommendationTimer', {
  schedule: process.env.OE_RECOMMENDATION_SCHEDULE ?? '0 0 4 * * 1',
  handler: recommendationTimerTrigger,
  extraInputs: [df.input.durableClient()],
});

// ============================================================================
// HTTP trigger: manual recommendation start
// ============================================================================

app.http('startRecommendation', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'orchestrators/recommendation',
  extraInputs: [df.input.durableClient()],
  handler: async (req, context) => {
    const client = df.getClient(context);
    const ctx = buildContext();
    const instanceId = await client.startNew('recommendationOrchestrator', { input: ctx });
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

function findRecommender(id: string, cloud: string): IRecommender | undefined {
  const provider = getProvider(cloud);
  return provider?.recommenders.find((r: IRecommender) => r.id === id);
}
