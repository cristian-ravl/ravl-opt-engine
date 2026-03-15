import { app, type HttpResponseInit } from '@azure/functions';
import { v4 as uuidv4 } from 'uuid';
import { buildContext } from '../config/index.js';
import { ingest, query } from '../utils/adx-client.js';
import {
  buildActiveSuppressionsKql,
  buildSuppressionByIdKql,
  createSuppressionRecord,
  disableSuppressionRecord,
  type SuppressionRow,
  toSuppression,
  updateSuppressionRecord,
} from './suppressions-helpers.js';

async function loadLatestSuppression(ctx: ReturnType<typeof buildContext>, filterId: string) {
  const rows = await query<SuppressionRow>(ctx, buildSuppressionByIdKql(filterId));
  const row = rows[0];
  return row ? toSuppression(row) : null;
}

app.http('getSuppressions', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'suppressions',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const subTypeId = req.query.get('subTypeId');
    const filterType = req.query.get('filterType');

    try {
      const results = await query<SuppressionRow>(
        ctx,
        buildActiveSuppressionsKql({
          subTypeId,
          filterType,
        }),
      );

      return {
        status: 200,
        jsonBody: results.map(toSuppression),
      };
    } catch {
      return { status: 200, jsonBody: [] };
    }
  },
});

app.http('createSuppression', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'suppressions',
  handler: async (req): Promise<HttpResponseInit> => {
    const ctx = buildContext();
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const nowIso = new Date().toISOString();
    const result = createSuppressionRecord(body, uuidv4(), nowIso);

    if ('error' in result) {
      return { status: 400, jsonBody: { error: result.error } };
    }

    await ingest(ctx, 'Suppressions', [result.suppression], 'Suppressions_mapping');
    return { status: 201, jsonBody: result.suppression };
  },
});

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

    const current = await loadLatestSuppression(ctx, filterId);
    if (!current) {
      return { status: 404, jsonBody: { error: `Suppression not found: ${filterId}` } };
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const result = updateSuppressionRecord(current, body, new Date().toISOString());

    if ('error' in result) {
      return { status: 400, jsonBody: { error: result.error } };
    }

    await ingest(ctx, 'Suppressions', [result.suppression], 'Suppressions_mapping');
    return { status: 200, jsonBody: result.suppression };
  },
});

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

    const current = await loadLatestSuppression(ctx, filterId);
    if (!current) {
      return { status: 404, jsonBody: { error: `Suppression not found: ${filterId}` } };
    }

    await ingest(ctx, 'Suppressions', [disableSuppressionRecord(current, new Date().toISOString())], 'Suppressions_mapping');
    return { status: 204 };
  },
});
