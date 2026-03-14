// REST API: Suppression (filter) management — CRUD operations for recommendation suppressions.
// Suppressions are stored in ADX and allow users to dismiss, snooze, or exclude recommendations.

import { app, type HttpResponseInit } from '@azure/functions';
import { buildContext } from '../config/index.js';
import { query, ingest, executeMgmt } from '../utils/adx-client.js';
import type { Suppression } from '../providers/types.js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// GET  /api/suppressions — list all active suppressions
// ============================================================================

app.http('getSuppressions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'suppressions',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const subTypeId = req.query.get('subTypeId');
    const filterType = req.query.get('filterType');

    let kql = 'Suppressions | where IsEnabled == true';
    if (subTypeId) {
      kql += ` | where RecommendationSubTypeId == "${escapeKql(subTypeId)}"`;
    }
    if (filterType) {
      kql += ` | where FilterType == "${escapeKql(filterType)}"`;
    }
    kql += ' | order by FilterStartDate desc';

    try {
      const results = await query(ctx, kql);
      return { status: 200, jsonBody: results };
    } catch {
      return { status: 200, jsonBody: [] };
    }
  },
});

// ============================================================================
// POST /api/suppressions — create a new suppression
// ============================================================================

app.http('createSuppression', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'suppressions',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const body = (await req.json()) as Partial<Suppression>;

    if (!body.recommendationSubTypeId || !body.filterType) {
      return { status: 400, jsonBody: { error: 'recommendationSubTypeId and filterType are required' } };
    }

    const validFilterTypes = ['Dismiss', 'Snooze', 'Exclude'];
    if (!validFilterTypes.includes(body.filterType)) {
      return { status: 400, jsonBody: { error: `filterType must be one of: ${validFilterTypes.join(', ')}` } };
    }

    const suppression: Suppression = {
      filterId: uuidv4(),
      recommendationSubTypeId: body.recommendationSubTypeId,
      filterType: body.filterType,
      instanceId: body.instanceId ?? null,
      filterStartDate: new Date().toISOString(),
      filterEndDate: body.filterEndDate ?? null,
      author: body.author ?? null,
      notes: body.notes ?? null,
      isEnabled: true,
    };

    await ingest(ctx, 'Suppressions', [suppression], 'Suppressions_mapping');
    return { status: 201, jsonBody: suppression };
  },
});

// ============================================================================
// PUT /api/suppressions/:id — update a suppression
// ============================================================================

app.http('updateSuppression', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'suppressions/{filterId}',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const filterId = req.params.filterId;
    if (!filterId) {
      return { status: 400, jsonBody: { error: 'filterId is required' } };
    }

    const body = (await req.json()) as Partial<Suppression>;

    // ADX doesn't support UPDATE — soft-delete old, insert new version.
    // Mark old record as disabled via soft-delete approach.
    const disableCmd = `.set-or-append Suppressions <| Suppressions | where FilterId == "${escapeKql(filterId)}" | extend IsEnabled = false | take 1`;
    await executeMgmt(ctx, disableCmd);

    const updated: Suppression = {
      filterId,
      recommendationSubTypeId: body.recommendationSubTypeId ?? '',
      filterType: body.filterType ?? 'Dismiss',
      instanceId: body.instanceId ?? null,
      filterStartDate: body.filterStartDate ?? new Date().toISOString(),
      filterEndDate: body.filterEndDate ?? null,
      author: body.author ?? null,
      notes: body.notes ?? null,
      isEnabled: body.isEnabled ?? true,
    };

    await ingest(ctx, 'Suppressions', [updated], 'Suppressions_mapping');
    return { status: 200, jsonBody: updated };
  },
});

// ============================================================================
// DELETE /api/suppressions/:id — soft-disable a suppression
// ============================================================================

app.http('deleteSuppression', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'suppressions/{filterId}',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const filterId = req.params.filterId;
    if (!filterId) {
      return { status: 400, jsonBody: { error: 'filterId is required' } };
    }

    // Soft-delete: insert new row with IsEnabled = false
    const cmd = `.set-or-append Suppressions <| Suppressions | where FilterId == "${escapeKql(filterId)}" | extend IsEnabled = false | take 1`;
    await executeMgmt(ctx, cmd);

    return { status: 204 };
  },
});

/** Escape single quotes for safe KQL string interpolation */
function escapeKql(value: string): string {
  return value
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[;\n\r|]/g, '');
}
