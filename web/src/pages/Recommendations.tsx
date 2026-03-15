import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  DialogActions,
  DialogBody,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Dropdown,
  Input,
  Link,
  Option,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from '@fluentui/react-components';
import { ArrowSyncRegular, DismissRegular, FilterRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import {
  createSuppression,
  getRecommendationCost30d,
  getRecommendationCurrency,
  getProviders,
  getRecommendationGeneratorLabel,
  getRecommendationMonthlySavings,
  getRecommendationResourceUrl,
  getRecommendations,
} from '../services/api';
import type { ProviderDefinition, RecommendationFilters, RecommendationRecord } from '../services/api';

const DEFAULT_PAGE_SIZE = 50;

const IMPACT_COLORS: Record<string, 'danger' | 'warning' | 'informative'> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'informative',
};

const CATEGORY_LABELS: Record<string, string> = {
  Cost: 'Cost',
  HighAvailability: 'High availability',
  Performance: 'Performance',
  Security: 'Security',
  OperationalExcellence: 'Operational excellence',
  Governance: 'Governance',
};

function formatCurrency(value: number, currency = 'USD'): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getResourceDisplayName(recommendation: RecommendationRecord): string {
  if (recommendation.InstanceName?.trim()) return recommendation.InstanceName;
  const segments = recommendation.InstanceId?.split('/').filter(Boolean) ?? [];
  return segments.length > 0 ? segments[segments.length - 1] : recommendation.InstanceId || 'Unnamed resource';
}

function getRecommenders(providers: ProviderDefinition[] | undefined) {
  const uniqueRecommenders = new Map<string, { id: string; name: string }>();

  for (const provider of providers ?? []) {
    for (const recommender of provider.recommenders ?? []) {
      uniqueRecommenders.set(recommender.id, {
        id: recommender.id,
        name: recommender.name,
      });
    }
  }

  return [...uniqueRecommenders.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function RecommendationsPage() {
  const [filters, setFilters] = useState<RecommendationFilters>({ limit: DEFAULT_PAGE_SIZE, offset: 0, includeSuppressed: false });
  const [searchText, setSearchText] = useState('');
  const recs = useAsync(() => getRecommendations(filters), [JSON.stringify(filters)]);
  const providers = useAsync(() => getProviders(), []);

  const recommenderOptions = getRecommenders(providers.data?.providers);
  const filteredData =
    recs.data?.data?.filter((recommendation) => {
      if (!searchText.trim()) return true;

      const lower = searchText.trim().toLowerCase();
      const searchTargets = [
        recommendation.InstanceName,
        recommendation.InstanceId,
        recommendation.ResourceGroup,
        recommendation.SubscriptionName,
        recommendation.RecommendationSubType,
        recommendation.RecommendationDescription,
        recommendation.RecommendationAction,
        getRecommendationGeneratorLabel(recommendation),
      ];

      return searchTargets.some((value) => value?.toLowerCase().includes(lower));
    }) ?? [];

  const visibleHighImpact = filteredData.filter((recommendation) => recommendation.Impact === 'High').length;
  const visibleMonthlySavings = filteredData.reduce((sum, recommendation) => sum + getRecommendationMonthlySavings(recommendation), 0);

  const handleSuppress = async (recommendation: RecommendationRecord) => {
    await createSuppression({
      recommendationSubTypeId: recommendation.RecommendationSubTypeId,
      filterType: 'Dismiss',
      instanceId: recommendation.InstanceId,
      notes: 'Dismissed from dashboard',
    });
    recs.refresh();
  };

  const clearFilters = () => {
    setFilters({ limit: DEFAULT_PAGE_SIZE, offset: 0, includeSuppressed: false });
    setSearchText('');
  };

  const currentPageSize = filters.limit ?? DEFAULT_PAGE_SIZE;
  const pageStart = (filters.offset ?? 0) + 1;
  const pageEnd = Math.min((filters.offset ?? 0) + currentPageSize, recs.data?.total ?? 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Visible on this page</Text>}
            description={<Text size={700}>{filteredData.length}</Text>}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">High impact visible</Text>}
            description={<Text size={700}>{visibleHighImpact}</Text>}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Savings on this page</Text>}
            description={<Text size={700}>{formatCurrency(visibleMonthlySavings)}</Text>}
          />
        </Card>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Search
          </Text>
          <Input placeholder="Search recommendations..." value={searchText} onChange={(_, data) => setSearchText(data.value)} style={{ width: 280 }} />
        </div>

        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Cloud
          </Text>
          <Dropdown
            placeholder="All clouds"
            selectedOptions={filters.cloud ? [filters.cloud] : []}
            onOptionSelect={(_, data) => setFilters((current) => ({ ...current, cloud: data.optionValue || undefined, offset: 0 }))}
          >
            <Option value="Azure" text="Azure">
              Azure
            </Option>
            <Option value="AWS" text="AWS">
              AWS
            </Option>
            <Option value="GCP" text="GCP">
              GCP
            </Option>
          </Dropdown>
        </div>

        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Category
          </Text>
          <Dropdown
            placeholder="All categories"
            selectedOptions={filters.category ? [filters.category] : []}
            onOptionSelect={(_, data) => setFilters((current) => ({ ...current, category: data.optionValue || undefined, offset: 0 }))}
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <Option key={value} value={value} text={label}>
                {label}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Impact
          </Text>
          <Dropdown
            placeholder="All impacts"
            selectedOptions={filters.impact ? [filters.impact] : []}
            onOptionSelect={(_, data) => setFilters((current) => ({ ...current, impact: data.optionValue || undefined, offset: 0 }))}
          >
            <Option value="High" text="High">
              High
            </Option>
            <Option value="Medium" text="Medium">
              Medium
            </Option>
            <Option value="Low" text="Low">
              Low
            </Option>
          </Dropdown>
        </div>

        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Recommendation function
          </Text>
          <Dropdown
            placeholder={providers.loading ? 'Loading functions...' : 'All functions'}
            selectedOptions={filters.recommenderId ? [filters.recommenderId] : []}
            onOptionSelect={(_, data) => setFilters((current) => ({ ...current, recommenderId: data.optionValue || undefined, offset: 0 }))}
          >
            {recommenderOptions.map((recommender) => (
              <Option key={recommender.id} value={recommender.id} text={recommender.name}>
                {recommender.name}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div>
          <Text size={200} style={{ display: 'block', marginBottom: 4 }}>
            Page size
          </Text>
          <Dropdown
            selectedOptions={[String(currentPageSize)]}
            onOptionSelect={(_, data) => setFilters((current) => ({ ...current, limit: Number(data.optionValue ?? DEFAULT_PAGE_SIZE), offset: 0 }))}
          >
            {[25, 50, 100].map((size) => (
              <Option key={size} value={String(size)} text={String(size)}>
                {size}
              </Option>
            ))}
          </Dropdown>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 170 }}>
          <Text size={200}>Suppressed recommendations</Text>
          <Switch
            checked={filters.includeSuppressed ?? false}
            label={filters.includeSuppressed ? 'Shown' : 'Hidden'}
            onChange={(_, data) => setFilters((current) => ({ ...current, includeSuppressed: data.checked, offset: 0 }))}
          />
        </div>

        <Button icon={<ArrowSyncRegular />} appearance="secondary" onClick={() => recs.refresh()}>
          Refresh
        </Button>
        <Button icon={<FilterRegular />} appearance="subtle" onClick={clearFilters}>
          Clear filters
        </Button>
      </div>

      <Text size={300} style={{ color: '#666' }}>
        {recs.data ? `${filteredData.length} visible on this page, ${recs.data.total} total recommendations in the current result set` : ''}
      </Text>

      {recs.loading ? (
        <Spinner label="Loading recommendations..." />
      ) : recs.error ? (
        <Text style={{ color: 'red' }}>Error: {recs.error.message}</Text>
      ) : filteredData.length === 0 ? (
        <Card>
          <CardHeader
            header={<Text weight="semibold">No recommendations match the current filters</Text>}
            description={<Text size={200}>Adjust the filters or refresh after running a new recommendation pass.</Text>}
          />
        </Card>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell style={{ width: 84 }}>Impact</TableHeaderCell>
                  <TableHeaderCell style={{ width: 84 }}>Cloud</TableHeaderCell>
                  <TableHeaderCell style={{ width: 140 }}>Category</TableHeaderCell>
                  <TableHeaderCell style={{ width: 190 }}>Type</TableHeaderCell>
                  <TableHeaderCell style={{ width: 210 }}>Function</TableHeaderCell>
                  <TableHeaderCell style={{ minWidth: 260 }}>Resource</TableHeaderCell>
                  <TableHeaderCell style={{ minWidth: 320 }}>Description</TableHeaderCell>
                  <TableHeaderCell style={{ width: 110, textAlign: 'right' }}>Cost (30d)</TableHeaderCell>
                  <TableHeaderCell style={{ width: 120, textAlign: 'right' }}>Savings/mo</TableHeaderCell>
                  <TableHeaderCell style={{ width: 70 }}>Score</TableHeaderCell>
                  <TableHeaderCell style={{ width: 110 }}>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.map((recommendation) => {
                  const resourceUrl = getRecommendationResourceUrl(recommendation);
                  const cost30d = getRecommendationCost30d(recommendation);
                  const monthlySavings = getRecommendationMonthlySavings(recommendation);
                  const currency = getRecommendationCurrency(recommendation);

                  return (
                    <TableRow key={recommendation.RecommendationId}>
                      <TableCell>
                        <Badge color={IMPACT_COLORS[recommendation.Impact] ?? 'informative'} size="small">
                          {recommendation.Impact}
                        </Badge>
                      </TableCell>
                      <TableCell>{recommendation.Cloud}</TableCell>
                      <TableCell>{CATEGORY_LABELS[recommendation.Category] ?? recommendation.Category}</TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <Text size={200} weight="semibold">
                            {recommendation.RecommendationSubType}
                          </Text>
                          <Text size={200} style={{ color: '#666' }}>
                            {recommendation.RecommendationType}
                          </Text>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <Text size={200} weight="semibold">
                            {getRecommendationGeneratorLabel(recommendation)}
                          </Text>
                          {recommendation.RecommenderId && (
                            <Text size={200} style={{ color: '#666' }}>
                              {recommendation.RecommenderId}
                            </Text>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <Text size={200} weight="semibold">
                            {resourceUrl ? (
                              <Link href={resourceUrl} target="_blank" rel="noreferrer">
                                {getResourceDisplayName(recommendation)}
                              </Link>
                            ) : (
                              getResourceDisplayName(recommendation)
                            )}
                          </Text>
                          <Text size={200} style={{ color: '#666' }}>
                            {recommendation.SubscriptionName || recommendation.SubscriptionId || 'No subscription context'}
                          </Text>
                          {recommendation.ResourceGroup && (
                            <Text size={200} style={{ color: '#666' }}>
                              {recommendation.ResourceGroup}
                            </Text>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <Text size={200}>{recommendation.RecommendationDescription}</Text>
                          <Text size={200} style={{ color: '#666' }}>
                            Action: {recommendation.RecommendationAction}
                          </Text>
                        </div>
                      </TableCell>
                      <TableCell style={{ textAlign: 'right' }}>
                        <Text size={200}>{cost30d > 0 ? formatCurrency(cost30d, currency) : '—'}</Text>
                      </TableCell>
                      <TableCell style={{ textAlign: 'right' }}>
                        <Text size={200}>{monthlySavings > 0 ? formatCurrency(monthlySavings, currency) : '—'}</Text>
                      </TableCell>
                      <TableCell>{recommendation.FitScore}</TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {resourceUrl && (
                            <Link href={resourceUrl} target="_blank" rel="noreferrer">
                              Open
                            </Link>
                          )}
                          <Dialog>
                            <DialogTrigger disableButtonEnhancement>
                              <Button icon={<DismissRegular />} appearance="subtle" size="small" title="Suppress" />
                            </DialogTrigger>
                            <DialogSurface>
                              <DialogTitle>Suppress recommendation</DialogTitle>
                              <DialogBody>
                                <Text>
                                  Dismiss "{recommendation.RecommendationSubType}" for {getResourceDisplayName(recommendation)}?
                                </Text>
                              </DialogBody>
                              <DialogActions>
                                <DialogTrigger disableButtonEnhancement>
                                  <Button appearance="secondary">Cancel</Button>
                                </DialogTrigger>
                                <Button appearance="primary" onClick={() => handleSuppress(recommendation)}>
                                  Dismiss
                                </Button>
                              </DialogActions>
                            </DialogSurface>
                          </Dialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <Button
              appearance="subtle"
              disabled={(filters.offset ?? 0) === 0}
              onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - currentPageSize) }))}
            >
              Previous
            </Button>
            <Text size={200} style={{ alignSelf: 'center' }}>
              {recs.data?.total ? `${pageStart} – ${pageEnd} of ${recs.data.total}` : '0'}
            </Text>
            <Button
              appearance="subtle"
              disabled={(filters.offset ?? 0) + currentPageSize >= (recs.data?.total ?? 0)}
              onClick={() => setFilters((current) => ({ ...current, offset: (current.offset ?? 0) + currentPageSize }))}
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
