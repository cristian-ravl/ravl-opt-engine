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
  getRecommendationUsageDisplay,
  getRecommendationResourceUrl,
  getRecommendations,
} from '../services/api';
import type { ProviderDefinition, RecommendationFilters, RecommendationRecord } from '../services/api';
import './Recommendations.css';

const DEFAULT_PAGE_SIZE = 50;
const DISPLAY_CURRENCY = 'CAD';

type CurrencyAmount = {
  currency: string;
  amount: number;
};

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

function formatCurrency(value: number, currency = DISPLAY_CURRENCY): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeCurrencyCode(currency: string | null | undefined): string {
  void currency;
  return DISPLAY_CURRENCY;
}

function sortCurrencyAmounts(amounts: CurrencyAmount[]): CurrencyAmount[] {
  return [...amounts].sort((left, right) => left.currency.localeCompare(right.currency));
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
  const visibleCostByCurrency = new Map<string, number>();
  const visibleSavingsByCurrency = new Map<string, number>();

  for (const recommendation of filteredData) {
    const currency = normalizeCurrencyCode(getRecommendationCurrency(recommendation));
    const cost30d = getRecommendationCost30d(recommendation);
    const monthlySavings = getRecommendationMonthlySavings(recommendation);

    visibleCostByCurrency.set(currency, (visibleCostByCurrency.get(currency) ?? 0) + cost30d);
    visibleSavingsByCurrency.set(currency, (visibleSavingsByCurrency.get(currency) ?? 0) + monthlySavings);
  }

  const visibleCost30d = sortCurrencyAmounts([...visibleCostByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })));
  const visibleMonthlySavings = sortCurrencyAmounts([...visibleSavingsByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })));

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

  const renderCurrencyBreakdown = (amounts: CurrencyAmount[], options?: { emptyLabel?: string; positiveClassName?: string }) => {
    const emptyLabel = options?.emptyLabel ?? '—';

    if (amounts.length === 0 || amounts.every(({ amount }) => amount <= 0)) {
      return <Text size={700}>{emptyLabel}</Text>;
    }

    if (amounts.filter(({ amount }) => amount > 0).length === 1) {
      const [{ amount, currency }] = amounts.filter(({ amount: currentAmount }) => currentAmount > 0);
      return <Text size={700} className={options?.positiveClassName}>{formatCurrency(amount, currency)}</Text>;
    }

    return (
      <div className="recommendations__currencyList">
        {amounts
          .filter(({ amount }) => amount > 0)
          .map(({ currency, amount }) => (
            <Text key={currency} size={300} className={options?.positiveClassName}>
              {formatCurrency(amount, currency)}
            </Text>
          ))}
      </div>
    );
  };

  return (
    <div className="recommendations">
      <div className="recommendations__summaryGrid">
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
            header={<Text weight="semibold">Current cost on this page</Text>}
            description={renderCurrencyBreakdown(visibleCost30d)}
          />
        </Card>
        <Card size="small">
          <CardHeader
            header={<Text weight="semibold">Savings on this page</Text>}
            description={renderCurrencyBreakdown(visibleMonthlySavings, { positiveClassName: 'recommendations__savingsValue' })}
          />
        </Card>
      </div>

      <Card>
        <CardHeader
          header={<Text weight="semibold">Filter recommendations</Text>}
          description={<Text size={200}>Narrow the list without turning the page into a tiny Tetris board.</Text>}
        />
        <div className="recommendations__filtersGrid">
          <div className="recommendations__field recommendations__field--search">
            <Text size={200} className="recommendations__fieldLabel">
            Search
          </Text>
            <Input className="recommendations__searchInput" placeholder="Search recommendations..." value={searchText} onChange={(_, data) => setSearchText(data.value)} />
          </div>

          <div className="recommendations__field">
            <Text size={200} className="recommendations__fieldLabel">
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

          <div className="recommendations__field">
            <Text size={200} className="recommendations__fieldLabel">
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

          <div className="recommendations__field">
            <Text size={200} className="recommendations__fieldLabel">
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

          <div className="recommendations__field">
            <Text size={200} className="recommendations__fieldLabel">
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

          <div className="recommendations__field">
            <Text size={200} className="recommendations__fieldLabel">
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

          <div className="recommendations__field recommendations__field--switch">
            <Text size={200} className="recommendations__fieldLabel">Suppressed recommendations</Text>
            <Switch
              checked={filters.includeSuppressed ?? false}
              label={filters.includeSuppressed ? 'Shown' : 'Hidden'}
              onChange={(_, data) => setFilters((current) => ({ ...current, includeSuppressed: data.checked, offset: 0 }))}
            />
          </div>

          <div className="recommendations__actions">
            <Button icon={<ArrowSyncRegular />} appearance="secondary" onClick={() => recs.refresh()}>
              Refresh
            </Button>
            <Button icon={<FilterRegular />} appearance="subtle" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </div>
      </Card>

      <Text size={300} className="recommendations__resultsText">
        {recs.data ? `${filteredData.length} visible on this page, ${recs.data.total} total recommendations in the current result set` : ''}
      </Text>

      {recs.loading ? (
        <Spinner label="Loading recommendations..." />
      ) : recs.error ? (
        <Text className="recommendations__errorText">Error: {recs.error.message}</Text>
      ) : filteredData.length === 0 ? (
        <Card>
          <CardHeader
            header={<Text weight="semibold">No recommendations match the current filters</Text>}
            description={<Text size={200}>Adjust the filters or refresh after running a new recommendation pass.</Text>}
          />
        </Card>
      ) : (
        <>
          <div className="recommendations__list">
            {filteredData.map((recommendation) => {
              const resourceUrl = getRecommendationResourceUrl(recommendation);
              const cost30d = getRecommendationCost30d(recommendation);
              const usage30d = getRecommendationUsageDisplay(recommendation);
              const monthlySavings = getRecommendationMonthlySavings(recommendation);
              const currency = getRecommendationCurrency(recommendation);

              return (
                <Card key={recommendation.RecommendationId} className="recommendations__itemCard">
                  <div className="recommendations__itemHeader">
                    <div className="recommendations__itemTitleBlock">
                      <div className="recommendations__badges">
                        <Badge color={IMPACT_COLORS[recommendation.Impact] ?? 'informative'} size="small">
                          {recommendation.Impact}
                        </Badge>
                        <Badge appearance="tint" size="small">{recommendation.Cloud}</Badge>
                        <Badge appearance="outline" size="small">{CATEGORY_LABELS[recommendation.Category] ?? recommendation.Category}</Badge>
                      </div>
                      <Text weight="semibold" className="recommendations__resourceTitle">
                        {resourceUrl ? (
                          <Link href={resourceUrl} target="_blank" rel="noreferrer">
                            {getResourceDisplayName(recommendation)}
                          </Link>
                        ) : (
                          getResourceDisplayName(recommendation)
                        )}
                      </Text>
                      <Text size={200} className="recommendations__mutedText">
                        {recommendation.SubscriptionName || recommendation.SubscriptionId || 'No subscription context'}
                        {recommendation.ResourceGroup ? ` • ${recommendation.ResourceGroup}` : ''}
                      </Text>
                    </div>

                    <div className="recommendations__itemActions">
                      {resourceUrl && (
                        <Link href={resourceUrl} target="_blank" rel="noreferrer">
                          Open resource
                        </Link>
                      )}
                      <Dialog>
                        <DialogTrigger disableButtonEnhancement>
                          <Button icon={<DismissRegular />} appearance="subtle" size="small" title="Suppress">
                            Suppress
                          </Button>
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
                  </div>

                  <div className="recommendations__itemBody">
                    <div className="recommendations__contentBlock">
                      <Text size={200} weight="semibold">{recommendation.RecommendationSubType}</Text>
                      <Text size={200} className="recommendations__mutedText">
                        {recommendation.RecommendationType} • {getRecommendationGeneratorLabel(recommendation)}
                      </Text>
                    </div>

                    <div className="recommendations__contentBlock">
                      <Text>{recommendation.RecommendationDescription}</Text>
                      <Text size={200} className="recommendations__mutedText">
                        Action: {recommendation.RecommendationAction}
                      </Text>
                    </div>

                    <div className="recommendations__metricsGrid">
                      <div className="recommendations__metricCard">
                        <Text size={200} className="recommendations__mutedText">Current cost (30d)</Text>
                        <Text weight="semibold">{cost30d > 0 ? formatCurrency(cost30d, currency) : '—'}</Text>
                      </div>
                      <div className="recommendations__metricCard">
                        <Text size={200} className="recommendations__mutedText">Usage (30d)</Text>
                        <Text weight="semibold">{usage30d}</Text>
                      </div>
                      <div className="recommendations__metricCard">
                        <Text size={200} className="recommendations__mutedText">Expected savings / month</Text>
                        <Text weight="semibold" className={monthlySavings > 0 ? 'recommendations__savingsValue' : undefined}>
                          {monthlySavings > 0 ? formatCurrency(monthlySavings, currency) : '—'}
                        </Text>
                      </div>
                      <div className="recommendations__metricCard">
                        <Text size={200} className="recommendations__mutedText">Fit score</Text>
                        <Text weight="semibold">{recommendation.FitScore}</Text>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="recommendations__pagination">
            <Button
              appearance="subtle"
              disabled={(filters.offset ?? 0) === 0}
              onClick={() => setFilters((current) => ({ ...current, offset: Math.max(0, (current.offset ?? 0) - currentPageSize) }))}
            >
              Previous
            </Button>
            <Text size={200} className="recommendations__paginationText">
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
