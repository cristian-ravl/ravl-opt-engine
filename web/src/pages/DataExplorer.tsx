import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dropdown,
  Input,
  Option,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@fluentui/react-components';
import { ArrowSyncRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import { getDataExplorerTableData, getDataExplorerTables } from '../services/api';
import type { DataExplorerColumnDefinition, DataExplorerQueryOptions, DataExplorerTableResponse } from '../services/api';
import './DataExplorer.css';

const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_VISIBLE_COLUMN_COUNT = 8;
const PRIORITY_COLUMNS = [
  'Timestamp',
  'GeneratedDate',
  'Cloud',
  'Category',
  'Impact',
  'SubscriptionName',
  'SubscriptionId',
  'ResourceGroup',
  'Location',
  'VMName',
  'InstanceName',
  'InstanceId',
  'RecommendationSubType',
  'RecommendationDescription',
  'StatusDate',
];

function isComplexValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function getDefaultVisibleColumns(columns: DataExplorerColumnDefinition[]): string[] {
  const availableColumns = columns.map((column) => column.name);
  if (availableColumns.length <= DEFAULT_VISIBLE_COLUMN_COUNT) {
    return availableColumns;
  }

  const selected = new Set<string>();

  for (const candidate of PRIORITY_COLUMNS) {
    if (availableColumns.includes(candidate)) {
      selected.add(candidate);
    }

    if (selected.size >= DEFAULT_VISIBLE_COLUMN_COUNT) {
      break;
    }
  }

  for (const columnName of availableColumns) {
    if (selected.size >= DEFAULT_VISIBLE_COLUMN_COUNT) {
      break;
    }

    selected.add(columnName);
  }

  return availableColumns.filter((columnName) => selected.has(columnName));
}

export function DataExplorerPage() {
  const tables = useAsync(() => getDataExplorerTables(), []);
  const [selectedTableName, setSelectedTableName] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [visibleColumnNames, setVisibleColumnNames] = useState<string[]>([]);
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  const [query, setQuery] = useState<DataExplorerQueryOptions>({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    sortDirection: 'desc',
  });

  useEffect(() => {
    if (!selectedTableName && tables.data?.tables.length) {
      setSelectedTableName(tables.data.tables[0].name);
    }
  }, [selectedTableName, tables.data]);

  const tableData = useAsync<DataExplorerTableResponse | null>(
    () => (selectedTableName ? getDataExplorerTableData(selectedTableName, query) : Promise.resolve(null)),
    [selectedTableName, JSON.stringify(query)],
  );

  const columns = tableData.data?.columns ?? [];

  useEffect(() => {
    if (!columns.length) {
      setVisibleColumnNames([]);
      return;
    }

    setVisibleColumnNames((current) => {
      const validColumns = current.filter((columnName) => columns.some((column) => column.name === columnName));
      return validColumns.length > 0 ? validColumns : getDefaultVisibleColumns(columns);
    });
  }, [columns]);

  useEffect(() => {
    const rowCount = tableData.data?.data.length ?? 0;

    setSelectedRowIndex((current) => {
      if (rowCount === 0) {
        return null;
      }

      if (current !== null && current < rowCount) {
        return current;
      }

      return 0;
    });
  }, [tableData.data]);

  const visibleColumns = useMemo(() => {
    const selectedNames = new Set(visibleColumnNames);
    return columns.filter((column) => selectedNames.has(column.name));
  }, [columns, visibleColumnNames]);

  const selectedRow = selectedRowIndex !== null ? (tableData.data?.data?.[selectedRowIndex] ?? null) : null;

  const handleTableChange = (tableName: string | undefined) => {
    if (!tableName) return;

    setSelectedTableName(tableName);
    setSearchInput('');
    setVisibleColumnNames([]);
    setSelectedRowIndex(null);
    setQuery((current) => ({
      ...current,
      offset: 0,
      search: '',
      sortBy: undefined,
    }));
  };

  const handleVisibleColumnsChange = (selectedOptions: string[]) => {
    if (selectedOptions.length === 0) {
      return;
    }

    setVisibleColumnNames(selectedOptions);
  };

  const resetVisibleColumns = () => {
    setVisibleColumnNames(getDefaultVisibleColumns(columns));
  };

  const applySearch = () => {
    setQuery((current) => ({
      ...current,
      search: searchInput.trim(),
      offset: 0,
    }));
  };

  const clearSearch = () => {
    setSearchInput('');
    setQuery((current) => ({
      ...current,
      search: '',
      offset: 0,
    }));
  };

  const currentPageSize = query.limit ?? DEFAULT_PAGE_SIZE;
  const pageStart = (query.offset ?? 0) + 1;
  const pageEnd = Math.min((query.offset ?? 0) + currentPageSize, tableData.data?.total ?? 0);
  const visibleColumnCount = visibleColumns.length;

  if (tables.loading && !tables.data) {
    return <Spinner label="Loading data explorer..." />;
  }

  if (tables.error) {
    return <Text className="dataExplorer__errorText">Error loading tables: {tables.error.message}</Text>;
  }

  return (
    <div className="dataExplorer">
      <div className="dataExplorer__summaryGrid">
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Source</Text>}
            description={<Text size={600}>{selectedTableName || 'Select a table'}</Text>}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Rows</Text>}
            description={<Text size={600}>{tableData.data?.total?.toLocaleString() ?? '—'}</Text>}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Fields available</Text>}
            description={<Text size={600}>{columns.length.toLocaleString()}</Text>}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Fields shown</Text>}
            description={<Text size={600}>{visibleColumnCount.toLocaleString()}</Text>}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          header={<Text weight="semibold">Explore data</Text>}
          description={<Text size={200}>Choose a source, reduce the visible fields, then click a row to inspect the full record.</Text>}
        />
        <div className="dataExplorer__controlsGrid">
          <label className="dataExplorer__field">
            <Text size={200} className="dataExplorer__fieldLabel">
              Table or view
            </Text>
            <Dropdown
              placeholder="Select a source"
              selectedOptions={selectedTableName ? [selectedTableName] : []}
              onOptionSelect={(_, data) => handleTableChange(data.optionValue)}
              className="dataExplorer__control"
            >
              {(tables.data?.tables ?? []).map((table) => (
                <Option key={table.name} value={table.name} text={table.name}>
                  {table.name} [{table.kind}]
                </Option>
              ))}
            </Dropdown>
          </label>

          <label className="dataExplorer__field dataExplorer__field--wide">
            <Text size={200} className="dataExplorer__fieldLabel">
              Search rows
            </Text>
            <Input
              placeholder="Search across all columns..."
              value={searchInput}
              onChange={(_, data) => setSearchInput(data.value)}
              className="dataExplorer__control"
            />
          </label>

          <label className="dataExplorer__field">
            <Text size={200} className="dataExplorer__fieldLabel">
              Page size
            </Text>
            <Dropdown
              selectedOptions={[String(currentPageSize)]}
              onOptionSelect={(_, data) =>
                setQuery((current) => ({
                  ...current,
                  limit: Number(data.optionValue ?? DEFAULT_PAGE_SIZE),
                  offset: 0,
                }))
              }
              className="dataExplorer__control"
            >
              {[25, 50, 100].map((size) => (
                <Option key={size} value={String(size)} text={String(size)}>
                  {size}
                </Option>
              ))}
            </Dropdown>
          </label>

          <label className="dataExplorer__field">
            <Text size={200} className="dataExplorer__fieldLabel">
              Sort column
            </Text>
            <Dropdown
              placeholder="Automatic"
              selectedOptions={tableData.data?.sortBy ? [tableData.data.sortBy] : []}
              onOptionSelect={(_, data) =>
                setQuery((current) => ({
                  ...current,
                  sortBy: data.optionValue === '__default' ? undefined : data.optionValue,
                  offset: 0,
                }))
              }
              className="dataExplorer__control"
            >
              <Option value="__default" text="Automatic">
                Automatic
              </Option>
              {columns.map((column) => (
                <Option key={column.name} value={column.name} text={column.name}>
                  {column.name}
                </Option>
              ))}
            </Dropdown>
          </label>

          <label className="dataExplorer__field">
            <Text size={200} className="dataExplorer__fieldLabel">
              Sort direction
            </Text>
            <Dropdown
              selectedOptions={[query.sortDirection ?? 'desc']}
              onOptionSelect={(_, data) =>
                setQuery((current) => ({
                  ...current,
                  sortDirection: (data.optionValue as 'asc' | 'desc') ?? 'desc',
                  offset: 0,
                }))
              }
              className="dataExplorer__control"
            >
              <Option value="desc" text="Descending">
                Descending
              </Option>
              <Option value="asc" text="Ascending">
                Ascending
              </Option>
            </Dropdown>
          </label>

          <label className="dataExplorer__field dataExplorer__field--wide">
            <Text size={200} className="dataExplorer__fieldLabel">
              Visible fields
            </Text>
            <Dropdown
              multiselect
              placeholder="Choose which fields stay in the table"
              selectedOptions={visibleColumnNames}
              onOptionSelect={(_, data) => handleVisibleColumnsChange(data.selectedOptions ?? [])}
              className="dataExplorer__control"
            >
              {columns.map((column) => (
                <Option key={column.name} value={column.name} text={column.name}>
                  {column.name}
                </Option>
              ))}
            </Dropdown>
          </label>

          <div className="dataExplorer__actions">
            <Button appearance="secondary" onClick={applySearch}>
              Apply search
            </Button>
            <Button appearance="subtle" onClick={clearSearch}>
              Clear search
            </Button>
            <Button appearance="subtle" onClick={resetVisibleColumns} disabled={!columns.length}>
              Reset fields
            </Button>
            <Button icon={<ArrowSyncRegular />} appearance="secondary" onClick={() => tableData.refresh()} disabled={!selectedTableName}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {tableData.data && (
        <div className="dataExplorer__metaRow">
          <Badge color="informative">{tableData.data.table.kind}</Badge>
          <Badge appearance="tint">{tableData.data.table.group}</Badge>
          <Badge appearance="filled">Showing {visibleColumnCount} of {columns.length} fields</Badge>
          {tableData.data.sortBy && <Text size={200}>Sorted by {tableData.data.sortBy}</Text>}
          {tableData.data.search && <Text size={200}>Search: "{tableData.data.search}"</Text>}
        </div>
      )}

      {columns.length > 0 && (
        <Card>
          <CardHeader
            header={<Text weight="semibold">Schema</Text>}
            description={<Text size={200}>Visible fields stay highlighted in the table; the row inspector always shows the full record.</Text>}
          />
          <div className="dataExplorer__schemaList">
            {columns.map((column) => (
              <Badge key={column.name} appearance={visibleColumnNames.includes(column.name) ? 'filled' : 'tint'}>
                {column.name}: {column.type}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {tableData.loading ? (
        <Spinner label="Loading rows..." />
      ) : tableData.error ? (
        <Text className="dataExplorer__errorText">Error loading table data: {tableData.error.message}</Text>
      ) : !selectedTableName ? (
        <Text className="dataExplorer__mutedText">Select a table or materialized view to explore ADX data.</Text>
      ) : (
        <div className="dataExplorer__workspaceGrid">
          <Card className="dataExplorer__tableCard">
            <CardHeader
              header={<Text weight="semibold">Rows</Text>}
              description={
                <Text size={200}>
                  {tableData.data ? `${pageStart} – ${pageEnd} of ${tableData.data.total.toLocaleString()} rows` : 'No rows loaded'}
                </Text>
              }
            />

            <div className="dataExplorer__tableScroll">
              <Table size="small" className="dataExplorer__table">
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className="dataExplorer__headerCell dataExplorer__headerCell--index">#</TableHeaderCell>
                    {visibleColumns.map((column) => (
                      <TableHeaderCell key={column.name} className="dataExplorer__headerCell">
                        {column.name}
                      </TableHeaderCell>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tableData.data?.data ?? []).map((row, index) => {
                    const rowNumber = (query.offset ?? 0) + index + 1;
                    const isSelected = selectedRowIndex === index;

                    return (
                      <TableRow
                        key={`${query.offset ?? 0}-${index}`}
                        className={isSelected ? 'dataExplorer__row dataExplorer__row--selected' : 'dataExplorer__row'}
                        onClick={() => setSelectedRowIndex(index)}
                      >
                        <TableCell className="dataExplorer__indexCell">{rowNumber}</TableCell>
                        {visibleColumns.map((column) => {
                          const value = row[column.name];
                          const textValue = formatCellValue(value);

                          return (
                            <TableCell key={column.name}>
                              <div
                                className={isComplexValue(value) ? 'dataExplorer__cellContent dataExplorer__cellContent--mono' : 'dataExplorer__cellContent'}
                                title={textValue}
                              >
                                {textValue}
                              </div>
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                  {(tableData.data?.data ?? []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 1}>
                        <Text className="dataExplorer__mutedText dataExplorer__mutedText--italic">No rows matched the current filters.</Text>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div className="dataExplorer__pagination">
              <Button
                appearance="subtle"
                disabled={(query.offset ?? 0) === 0}
                onClick={() =>
                  setQuery((current) => ({
                    ...current,
                    offset: Math.max(0, (current.offset ?? 0) - currentPageSize),
                  }))
                }
              >
                Previous
              </Button>
              <Text size={200} className="dataExplorer__paginationLabel">
                {tableData.data?.total ? `${pageStart} – ${pageEnd} of ${tableData.data.total}` : '0'}
              </Text>
              <Button
                appearance="subtle"
                disabled={(query.offset ?? 0) + currentPageSize >= (tableData.data?.total ?? 0)}
                onClick={() =>
                  setQuery((current) => ({
                    ...current,
                    offset: (current.offset ?? 0) + currentPageSize,
                  }))
                }
              >
                Next
              </Button>
            </div>
          </Card>

          <Card className="dataExplorer__detailsCard">
            <CardHeader
              header={<Text weight="semibold">Row details</Text>}
              description={
                <Text size={200}>
                  {selectedRow && selectedRowIndex !== null
                    ? `Inspecting row ${(query.offset ?? 0) + selectedRowIndex + 1}. Every field stays available here, even when hidden from the grid.`
                    : 'Select a row to inspect its full payload.'}
                </Text>
              }
            />

            {selectedRow ? (
              <div className="dataExplorer__detailsGrid">
                {columns.map((column) => {
                  const value = selectedRow[column.name];
                  const detailValue = formatDetailValue(value);
                  const detailClassName = isComplexValue(value)
                    ? 'dataExplorer__detailValue dataExplorer__detailValue--mono'
                    : 'dataExplorer__detailValue';

                  return (
                    <div key={column.name} className="dataExplorer__detailItem">
                      <Text size={200} weight="semibold" className="dataExplorer__detailName">
                        {column.name}
                      </Text>
                      <pre className={detailClassName}>{detailValue}</pre>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="dataExplorer__emptyState">
                <Text className="dataExplorer__mutedText">Pick a row from the table to see the full record rendered field-by-field.</Text>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
