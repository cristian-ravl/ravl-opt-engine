import { app, type HttpResponseInit } from '@azure/functions';
import { buildContext } from '../config/index.js';
import { query } from '../utils/adx-client.js';
import {
  buildDataExplorerCountKql,
  buildDataExplorerRowsKql,
  buildDataExplorerSchemaKql,
  getDataExplorerSource,
  listDataExplorerSources,
  normalizeDataExplorerSortDirection,
  resolveDataExplorerSortColumn,
} from './data-explorer-query.js';

type SchemaRow = {
  Name: string;
  Type: string;
};

type CountRow = {
  Count: number;
};

app.http('getDataExplorerTables', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'data-explorer/tables',
  handler: async (): Promise<HttpResponseInit> => ({
    status: 200,
    jsonBody: {
      tables: listDataExplorerSources(),
    },
  }),
});

app.http('getDataExplorerTableData', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'data-explorer/tables/{tableName}',
  handler: async (req): Promise<HttpResponseInit> => {
    const source = getDataExplorerSource(req.params.tableName);
    if (!source) {
      return { status: 404, jsonBody: { error: `Unsupported table or view: ${req.params.tableName}` } };
    }

    const limit = Math.min(Math.max(parseInt(req.query.get('limit') ?? '25', 10) || 25, 1), 100);
    const offset = Math.max(parseInt(req.query.get('offset') ?? '0', 10) || 0, 0);
    const search = req.query.get('search')?.trim() ?? '';
    const requestedSortBy = req.query.get('sortBy');
    const sortDirection = normalizeDataExplorerSortDirection(req.query.get('sortDirection'));
    const ctx = buildContext();

    try {
      const schema = await query<SchemaRow>(ctx, buildDataExplorerSchemaKql(source));
      const columns = schema.map((column) => ({
        name: column.Name,
        type: column.Type,
      }));
      const sortBy = resolveDataExplorerSortColumn(
        source,
        requestedSortBy,
        columns.map((column) => column.name),
      );

      const [countRows, data] = await Promise.all([
        query<CountRow>(ctx, buildDataExplorerCountKql(source, search)),
        query<Record<string, unknown>>(
          ctx,
          buildDataExplorerRowsKql({
            source,
            search,
            sortBy,
            sortDirection,
            offset,
            limit,
          }),
        ),
      ]);

      return {
        status: 200,
        jsonBody: {
          table: source,
          total: countRows[0]?.Count ?? 0,
          offset,
          limit,
          search,
          sortBy,
          sortDirection,
          columns,
          data,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 500,
        jsonBody: {
          error: `Failed to load ADX data for ${source.name}: ${message}`,
        },
      };
    }
  },
});
