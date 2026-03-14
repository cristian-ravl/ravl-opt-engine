import { app, type HttpResponseInit } from '@azure/functions';
import { buildContext } from '../config/index.js';
import { query } from '../utils/adx-client.js';
import { buildRecommenderCompatibilityKql } from '../utils/recommender-metadata.js';
import { buildCostSummaryKql, buildRecommendationsCountKql, buildRecommendationsListKql, buildRecommendationsSummaryKql, escapeKql } from './recommendations-query.js';

// ============================================================================
// GET /api/recommendations — list recommendations with optional filters
// ============================================================================

app.http('getRecommendations', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recommendations',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();

    // Optional query params
    const cloud = req.query.get('cloud');
    const category = req.query.get('category');
    const impact = req.query.get('impact');
    const subType = req.query.get('subType');
    const recommenderId = req.query.get('recommenderId');
    const subscriptionId = req.query.get('subscriptionId');
    const resourceGroup = req.query.get('resourceGroup');
    const limit = Math.min(parseInt(req.query.get('limit') ?? '500', 10), 5000);
    const offset = parseInt(req.query.get('offset') ?? '0', 10);
    const includeSuppressed = req.query.get('includeSuppressed') === 'true';

    const filters = {
      cloud,
      category,
      impact,
      subType,
      recommenderId,
      subscriptionId,
      resourceGroup,
    };

    const kql = buildRecommendationsListKql({
      filters,
      includeSuppressed,
      offset,
      limit,
    });

    let results: unknown[];
    try {
      results = await query(ctx, kql);
    } catch {
      return {
        status: 200,
        jsonBody: {
          total: 0,
          offset,
          limit,
          data: [],
        },
      };
    }

    // Also return total count for pagination
    const countKql = buildRecommendationsCountKql({
      filters,
      includeSuppressed,
    });
    let total: number;
    try {
      const countResult = await query<{ Count: number }>(ctx, countKql);
      total = countResult[0]?.Count ?? 0;
    } catch {
      total = Array.isArray(results) ? results.length : 0;
    }

    return {
      status: 200,
      jsonBody: {
        total,
        offset,
        limit,
        data: results,
      },
    };
  },
});

// ============================================================================
// GET /api/recommendations/summary — aggregate counts by category and impact
// ============================================================================

app.http('getRecommendationsSummary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recommendations/summary',
  handler: async (): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const kql = buildRecommendationsSummaryKql();
    try {
      const results = await query(ctx, kql);
      return { status: 200, jsonBody: results };
    } catch {
      return { status: 200, jsonBody: [] };
    }
  },
});

// ============================================================================
// GET /api/recommendations/cost-summary — cost and savings aggregation
// ============================================================================

app.http('getCostSummary', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recommendations/cost-summary',
  handler: async (): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const kql = buildCostSummaryKql();
    try {
      const results = await query(ctx, kql);
      return { status: 200, jsonBody: results };
    } catch {
      return { status: 200, jsonBody: [] };
    }
  },
});

// ============================================================================
// GET /api/recommendations/:id — single recommendation detail
// ============================================================================

app.http('getRecommendationById', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'recommendations/details/{recommendationId}',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const id = req.params.recommendationId;
    if (!id) return { status: 400, jsonBody: { error: 'recommendationId is required' } };

    const kql = `
      Recommendations
      ${buildRecommenderCompatibilityKql()}
      | where RecommendationId == "${escapeKql(id)}"
      | take 1
    `;
    const results = await query(ctx, kql);
    if (results.length === 0) return { status: 404, jsonBody: { error: 'Not found' } };
    return { status: 200, jsonBody: results[0] };
  },
});
