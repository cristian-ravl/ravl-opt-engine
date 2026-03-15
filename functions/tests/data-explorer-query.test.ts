import { describe, expect, it } from 'vitest';
import {
  buildDataExplorerCountKql,
  buildDataExplorerRowsKql,
  buildDataExplorerSchemaKql,
  getDataExplorerSource,
  listDataExplorerSources,
  normalizeDataExplorerSortDirection,
  resolveDataExplorerSortColumn,
} from '../src/api/data-explorer-query.js';

describe('data explorer query helpers', () => {
  it('returns allowlisted sources and resolves them case-insensitively', () => {
    expect(listDataExplorerSources().some((source) => source.name === 'Recommendations')).toBe(true);
    expect(getDataExplorerSource('recommendations')?.name).toBe('Recommendations');
    expect(getDataExplorerSource('unknown-table')).toBeNull();
  });

  it('builds schema, count, and row queries with search, sort, and pagination', () => {
    const source = getDataExplorerSource('Recommendations');
    expect(source).not.toBeNull();

    const schemaKql = buildDataExplorerSchemaKql(source!);
    const countKql = buildDataExplorerCountKql(source!, 'vm-prod');
    const rowsKql = buildDataExplorerRowsKql({
      source: source!,
      search: 'vm-prod',
      sortBy: 'GeneratedDate',
      sortDirection: 'desc',
      offset: 25,
      limit: 50,
    });

    expect(schemaKql).toContain('Recommendations');
    expect(schemaKql).toContain('| getschema');

    expect(countKql).toContain('__SearchText contains "vm-prod"');
    expect(countKql).toContain('| count');

    expect(rowsKql).toContain('| order by GeneratedDate desc');
    expect(rowsKql).toContain('| where RowNum > 25');
    expect(rowsKql).toContain('| take 50');
  });

  it('picks a valid sort column and normalizes sort direction', () => {
    const source = getDataExplorerSource('Suppressions');
    expect(source).not.toBeNull();

    expect(resolveDataExplorerSortColumn(source!, 'FilterStartDate', ['FilterStartDate', 'FilterType'])).toBe('FilterStartDate');
    expect(resolveDataExplorerSortColumn(source!, 'not valid', ['FilterStartDate', 'FilterType'])).toBe('FilterStartDate');
    expect(resolveDataExplorerSortColumn(source!, undefined, ['FilterType'])).toBeNull();

    expect(normalizeDataExplorerSortDirection('asc')).toBe('asc');
    expect(normalizeDataExplorerSortDirection('DESC')).toBe('desc');
    expect(normalizeDataExplorerSortDirection('unexpected')).toBe('desc');
  });
});
