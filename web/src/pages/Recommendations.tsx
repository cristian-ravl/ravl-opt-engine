// Recommendations page — filterable table of optimization recommendations

import { useState } from 'react';
import {
  Table,
  TableHeader,
  TableHeaderCell,
  TableBody,
  TableRow,
  TableCell,
  Badge,
  Input,
  Dropdown,
  Option,
  Spinner,
  Button,
  Text,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
} from '@fluentui/react-components';
import { FilterRegular, DismissRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import { getRecommendations, createSuppression } from '../services/api';
import type { RecommendationFilters } from '../services/api';

const IMPACT_COLORS: Record<string, 'danger' | 'warning' | 'informative'> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'informative',
};

export function RecommendationsPage() {
  const [filters, setFilters] = useState<RecommendationFilters>({ limit: 50, offset: 0 });
  const [searchText, setSearchText] = useState('');
  const recs = useAsync(() => getRecommendations(filters), [JSON.stringify(filters)]);

  const filteredData =
    recs.data?.data?.filter((r: any) => {
      if (!searchText) return true;
      const lower = searchText.toLowerCase();
      return r.InstanceName?.toLowerCase().includes(lower) || r.RecommendationSubType?.toLowerCase().includes(lower) || r.RecommendationDescription?.toLowerCase().includes(lower);
    }) ?? [];

  const handleSuppress = async (rec: any) => {
    await createSuppression({
      recommendationSubTypeId: rec.RecommendationSubTypeId,
      filterType: 'Dismiss',
      instanceId: rec.InstanceId,
      notes: 'Dismissed from dashboard',
    });
    recs.refresh();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters bar */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Search
          </Text>
          <Input placeholder="Search recommendations..." value={searchText} onChange={(_, data) => setSearchText(data.value)} style={{ width: 260 }} />
        </div>
        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Cloud
          </Text>
          <Dropdown placeholder="All clouds" value={filters.cloud ?? ''} onOptionSelect={(_, data) => setFilters((f) => ({ ...f, cloud: data.optionValue || undefined, offset: 0 }))}>
            <Option value="">All</Option>
            <Option value="Azure">Azure</Option>
            <Option value="AWS">AWS</Option>
            <Option value="GCP">GCP</Option>
          </Dropdown>
        </div>
        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Category
          </Text>
          <Dropdown placeholder="All categories" value={filters.category ?? ''} onOptionSelect={(_, data) => setFilters((f) => ({ ...f, category: data.optionValue || undefined, offset: 0 }))}>
            <Option value="">All</Option>
            <Option value="Cost">Cost</Option>
            <Option value="HighAvailability">High availability</Option>
            <Option value="Performance">Performance</Option>
            <Option value="Security">Security</Option>
            <Option value="OperationalExcellence">Operational excellence</Option>
          </Dropdown>
        </div>
        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Impact
          </Text>
          <Dropdown placeholder="All impacts" value={filters.impact ?? ''} onOptionSelect={(_, data) => setFilters((f) => ({ ...f, impact: data.optionValue || undefined, offset: 0 }))}>
            <Option value="">All</Option>
            <Option value="High">High</Option>
            <Option value="Medium">Medium</Option>
            <Option value="Low">Low</Option>
          </Dropdown>
        </div>
        <Button
          icon={<FilterRegular />}
          appearance="subtle"
          onClick={() => {
            setFilters({ limit: 50, offset: 0 });
            setSearchText('');
          }}
        >
          Clear filters
        </Button>
      </div>

      {/* Results count */}
      <Text size={300} style={{ color: '#666' }}>
        {recs.data ? `${recs.data.total} recommendations total` : ''}
      </Text>

      {/* Table */}
      {recs.loading ? (
        <Spinner label="Loading recommendations..." />
      ) : recs.error ? (
        <Text style={{ color: 'red' }}>Error: {recs.error.message}</Text>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: 80 }}>Impact</TableHeaderCell>
                <TableHeaderCell style={{ width: 80 }}>Cloud</TableHeaderCell>
                <TableHeaderCell style={{ width: 140 }}>Category</TableHeaderCell>
                <TableHeaderCell style={{ width: 200 }}>Type</TableHeaderCell>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell style={{ width: 100, textAlign: 'right' }}>Cost (30d)</TableHeaderCell>
                <TableHeaderCell style={{ width: 100, textAlign: 'right' }}>Savings/mo</TableHeaderCell>
                <TableHeaderCell style={{ width: 60 }}>Score</TableHeaderCell>
                <TableHeaderCell style={{ width: 100 }}>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((rec: any, i: number) => (
                <TableRow key={rec.RecommendationId ?? i}>
                  <TableCell>
                    <Badge color={IMPACT_COLORS[rec.Impact] ?? 'informative'} size="small">
                      {rec.Impact}
                    </Badge>
                  </TableCell>
                  <TableCell>{rec.Cloud}</TableCell>
                  <TableCell>{rec.Category}</TableCell>
                  <TableCell>
                    <Text size={200}>{rec.RecommendationSubType}</Text>
                  </TableCell>
                  <TableCell>
                    <Text weight="semibold" size={200}>
                      {rec.InstanceName}
                    </Text>
                  </TableCell>
                  <TableCell>
                    <Text size={200}>{rec.RecommendationDescription}</Text>
                  </TableCell>
                  <TableCell style={{ textAlign: 'right' }}>
                    <Text size={200}>
                      {(() => {
                        const cost = Number(rec.AdditionalInfo?.cost30d ?? rec.AdditionalInfo?.diskCost30d ?? 0);
                        if (!cost) return '—';
                        const currency = String(rec.AdditionalInfo?.currency ?? 'USD');
                        return cost.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      })()}
                    </Text>
                  </TableCell>
                  <TableCell style={{ textAlign: 'right' }}>
                    <Text size={200}>
                      {(() => {
                        const savings = Number(rec.AdditionalInfo?.savingsAmount ?? 0);
                        if (!savings) return '—';
                        const currency = String(rec.AdditionalInfo?.currency ?? rec.AdditionalInfo?.savingsCurrency ?? 'USD');
                        return savings.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      })()}
                    </Text>
                  </TableCell>
                  <TableCell>{rec.FitScore}</TableCell>
                  <TableCell>
                    <Dialog>
                      <DialogTrigger disableButtonEnhancement>
                        <Button icon={<DismissRegular />} appearance="subtle" size="small" title="Suppress" />
                      </DialogTrigger>
                      <DialogSurface>
                        <DialogTitle>Suppress recommendation</DialogTitle>
                        <DialogBody>
                          <Text>
                            Dismiss "{rec.RecommendationSubType}" for {rec.InstanceName}?
                          </Text>
                        </DialogBody>
                        <DialogActions>
                          <DialogTrigger disableButtonEnhancement>
                            <Button appearance="secondary">Cancel</Button>
                          </DialogTrigger>
                          <Button appearance="primary" onClick={() => handleSuppress(rec)}>
                            Dismiss
                          </Button>
                        </DialogActions>
                      </DialogSurface>
                    </Dialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Pagination */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button appearance="subtle" disabled={(filters.offset ?? 0) === 0} onClick={() => setFilters((f) => ({ ...f, offset: Math.max(0, (f.offset ?? 0) - (f.limit ?? 50)) }))}>
              Previous
            </Button>
            <Text size={200} style={{ alignSelf: 'center' }}>
              {(filters.offset ?? 0) + 1} – {Math.min((filters.offset ?? 0) + (filters.limit ?? 50), recs.data?.total ?? 0)} of {recs.data?.total ?? 0}
            </Text>
            <Button
              appearance="subtle"
              disabled={(filters.offset ?? 0) + (filters.limit ?? 50) >= (recs.data?.total ?? 0)}
              onClick={() => setFilters((f) => ({ ...f, offset: (f.offset ?? 0) + (f.limit ?? 50) }))}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
