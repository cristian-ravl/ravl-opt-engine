import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Spinner, Text } from '@fluentui/react-components';
import { ArrowSyncRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import {
  getCostSummary,
  getOrchestrationStatus,
  getRecommendationCost30d,
  getRecommendationCurrency,
  getRecommendationGeneratorLabel,
  getRecommendationMonthlySavings,
  getRecommendations,
  getRecommendationsSummary,
  getStatus,
  startCollection,
  startRecommendation,
} from '../services/api';
import type { CostSummaryRow, RecommendationRecord, RecommendationSummaryRow } from '../services/api';
import './Dashboard.css';

type CurrencyAmount = {
  currency: string;
  amount: number;
};

const DISPLAY_CURRENCY = 'CAD';

const IMPACT_COLORS: Record<string, 'danger' | 'warning' | 'informative'> = {
  High: 'danger',
  Medium: 'warning',
  Low: 'informative',
};

const CATEGORY_LABELS: Record<string, string> = {
  Cost: 'Cost optimization',
  HighAvailability: 'High availability',
  Performance: 'Performance',
  Security: 'Security',
  OperationalExcellence: 'Operational excellence',
  Governance: 'Governance',
};

function formatCurrency(value: number, currency: string) {
  return value.toLocaleString(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCurrencyForRecommendation(value: number, currency: string) {
  return formatCurrency(value, currency);
}

function normalizeCurrencyCode(currency: string | null | undefined): string {
  void currency;
  return DISPLAY_CURRENCY;
}

function sortCurrencyAmounts(amounts: CurrencyAmount[]): CurrencyAmount[] {
  return [...amounts].sort((left, right) => left.currency.localeCompare(right.currency));
}

function getPrimaryCurrency(amounts: CurrencyAmount[]): string {
  const nonZeroAmounts = amounts.filter(({ amount }) => amount > 0);
  if (nonZeroAmounts.length === 0) {
    return DISPLAY_CURRENCY;
  }

  return [...nonZeroAmounts].sort((left, right) => right.amount - left.amount)[0].currency;
}

function getAmountForCurrency(amounts: CurrencyAmount[], currency: string): number {
  return amounts.find((entry) => entry.currency === currency)?.amount ?? 0;
}

function getPrimaryAmount(amounts: CurrencyAmount[]): { currency: string; amount: number } | null {
  const primaryCurrency = getPrimaryCurrency(amounts);
  const primaryAmount = getAmountForCurrency(amounts, primaryCurrency);

  if (primaryAmount <= 0) {
    return null;
  }

  return {
    currency: primaryCurrency,
    amount: primaryAmount,
  };
}

function getResourceDisplayName(recommendation: RecommendationRecord): string {
  if (recommendation.InstanceName?.trim()) return recommendation.InstanceName;
  const segments = recommendation.InstanceId?.split('/').filter(Boolean) ?? [];
  return segments.length > 0 ? segments[segments.length - 1] : recommendation.InstanceId || 'Unnamed resource';
}

export function DashboardPage() {
  const status = useAsync(() => getStatus(), []);
  const summary = useAsync(() => getRecommendationsSummary(), []);
  const costSummary = useAsync(() => getCostSummary(), []);
  const topRecommendations = useAsync(() => getRecommendations({ limit: 6, includeSuppressed: false }), []);
  const [isCollectionRunning, setIsCollectionRunning] = useState(false);
  const [isRecommendationRunning, setIsRecommendationRunning] = useState(false);
  const [collectionStatusMessage, setCollectionStatusMessage] = useState<string | null>(null);
  const [recommendationStatusMessage, setRecommendationStatusMessage] = useState<string | null>(null);
  const collectionPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recommendationPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCollectionPolling = () => {
    if (collectionPollTimerRef.current) {
      clearInterval(collectionPollTimerRef.current);
      collectionPollTimerRef.current = null;
    }
  };

  const stopRecommendationPolling = () => {
    if (recommendationPollTimerRef.current) {
      clearInterval(recommendationPollTimerRef.current);
      recommendationPollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCollectionPolling();
      stopRecommendationPolling();
    };
  }, []);

  const byCategory: Record<string, number> = {};
  const byImpact: Record<string, number> = {};
  const byRecommender: Record<string, number> = {};
  let totalRecs = 0;

  if (summary.data) {
    for (const row of summary.data as RecommendationSummaryRow[]) {
      byCategory[row.Category] = (byCategory[row.Category] ?? 0) + row.Count;
      byImpact[row.Impact] = (byImpact[row.Impact] ?? 0) + row.Count;

      const recommenderLabel = row.RecommenderName?.trim() || row.RecommenderId?.trim() || 'Unknown recommender';
      byRecommender[recommenderLabel] = (byRecommender[recommenderLabel] ?? 0) + row.Count;
      totalRecs += row.Count;
    }
  }

  const totalsByCurrency = new Map<string, { cost30d: number; monthlySavings: number; annualSavings: number }>();
  const costByCategory: Record<string, Record<string, { cost: number; savings: number }>> = {};

  if (costSummary.data) {
    for (const row of costSummary.data as CostSummaryRow[]) {
      const currency = normalizeCurrencyCode(row.Currency);
      const totalEntry = totalsByCurrency.get(currency) ?? { cost30d: 0, monthlySavings: 0, annualSavings: 0 };
      totalEntry.cost30d += row.TotalCost30d;
      totalEntry.monthlySavings += row.TotalMonthlySavings;
      totalEntry.annualSavings += row.TotalAnnualSavings;
      totalsByCurrency.set(currency, totalEntry);

      const categoryEntries = costByCategory[row.Category] ?? {};
      const entry = categoryEntries[currency] ?? { cost: 0, savings: 0 };
      entry.cost += row.TotalCost30d;
      entry.savings += row.TotalMonthlySavings;
      categoryEntries[currency] = entry;
      costByCategory[row.Category] = categoryEntries;
    }
  }

  const totalCost30dByCurrency = sortCurrencyAmounts(
    [...totalsByCurrency.entries()].map(([currency, totals]) => ({ currency, amount: totals.cost30d })),
  );
  const totalMonthlySavingsByCurrency = sortCurrencyAmounts(
    [...totalsByCurrency.entries()].map(([currency, totals]) => ({ currency, amount: totals.monthlySavings })),
  );
  const totalAnnualSavingsByCurrency = sortCurrencyAmounts(
    [...totalsByCurrency.entries()].map(([currency, totals]) => ({ currency, amount: totals.annualSavings })),
  );

  const topRecommenders = Object.entries(byRecommender)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

  const topOpportunities = (topRecommendations.data?.data ?? []).filter((recommendation) => {
    return getRecommendationCost30d(recommendation) > 0 || getRecommendationMonthlySavings(recommendation) > 0;
  });

  const renderCurrencyBreakdown = (amounts: CurrencyAmount[], options?: { emptyLabel?: string; emphasizeSavings?: boolean }) => {
    const emptyLabel = options?.emptyLabel ?? '—';

    const primaryAmount = getPrimaryAmount(amounts);

    if (!primaryAmount) {
      return <Text size={800} weight="bold">{emptyLabel}</Text>;
    }

    return (
      <Text size={800} weight="bold" className={options?.emphasizeSavings ? 'dashboard__savingsValue' : undefined}>
        {formatCurrency(primaryAmount.amount, primaryAmount.currency)}
      </Text>
    );
  };

  const refreshAll = () => {
    status.refresh();
    summary.refresh();
    costSummary.refresh();
  };

  const handleRunCollection = async () => {
    if (isCollectionRunning) return;

    setIsCollectionRunning(true);
    setCollectionStatusMessage('Collection started');

    try {
      const startResponse = await startCollection();
      const instanceId = String(startResponse.id ?? '');
      if (!instanceId) {
        throw new Error('Collection orchestration did not return an instance ID');
      }

      stopCollectionPolling();

      let pollCount = 0;
      const maxPollCount = 72;

      collectionPollTimerRef.current = setInterval(async () => {
        pollCount += 1;

        try {
          const orchestration = await getOrchestrationStatus(instanceId);

          if (orchestration.runtimeStatus === 'Completed') {
            const output = (orchestration.output ?? {}) as {
              totalCollectors?: number;
              totalRecords?: number;
              warnings?: number;
            };

            const totalCollectors = Number(output.totalCollectors ?? 0);
            const totalRecords = Number(output.totalRecords ?? 0);
            const warnings = Number(output.warnings ?? 0);

            stopCollectionPolling();
            setCollectionStatusMessage(
              warnings > 0
                ? `Collection completed with warnings: ${totalCollectors} collectors ran, ${totalRecords} records ingested, ${warnings} optional collectors failed`
                : `Collection completed: ${totalCollectors} collectors ran, ${totalRecords} records ingested`,
            );
            setIsCollectionRunning(false);
            refreshAll();
            return;
          }

          if (orchestration.runtimeStatus === 'Failed' || orchestration.runtimeStatus === 'Terminated') {
            const reason = typeof orchestration.output === 'string' ? orchestration.output : `Runtime status: ${orchestration.runtimeStatus}`;
            stopCollectionPolling();
            setCollectionStatusMessage(`Collection failed: ${reason}`);
            setIsCollectionRunning(false);
            status.refresh();
            return;
          }

          if (pollCount >= maxPollCount) {
            stopCollectionPolling();
            setCollectionStatusMessage('Collection is still running. Check orchestration status in a moment');
            setIsCollectionRunning(false);
            status.refresh();
          }
        } catch {
          stopCollectionPolling();
          setCollectionStatusMessage('Could not refresh collection status while polling');
          setIsCollectionRunning(false);
        }
      }, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCollectionStatusMessage(`Failed to start collection: ${message}`);
      setIsCollectionRunning(false);
      stopCollectionPolling();
    }
  };

  const handleRunRecommendation = async () => {
    if (isRecommendationRunning) return;

    setIsRecommendationRunning(true);
    setRecommendationStatusMessage('Recommendation run started');

    try {
      const startResponse = await startRecommendation();
      const instanceId = String(startResponse.id ?? '');
      if (!instanceId) {
        throw new Error('Recommendation orchestration did not return an instance ID');
      }

      stopRecommendationPolling();

      let pollCount = 0;
      const maxPollCount = 72;

      recommendationPollTimerRef.current = setInterval(async () => {
        pollCount += 1;

        try {
          const orchestration = await getOrchestrationStatus(instanceId);

          if (orchestration.runtimeStatus === 'Completed') {
            const output = (orchestration.output ?? {}) as {
              totalRecommenders?: number;
              totalRecommendations?: number;
            };

            const totalRecommenders = Number(output.totalRecommenders ?? 0);
            const totalRecommendations = Number(output.totalRecommendations ?? 0);

            stopRecommendationPolling();
            setRecommendationStatusMessage(
              `Recommendation run completed: ${totalRecommenders} functions ran, ${totalRecommendations} recommendations generated`,
            );
            setIsRecommendationRunning(false);
            refreshAll();
            return;
          }

          if (orchestration.runtimeStatus === 'Failed' || orchestration.runtimeStatus === 'Terminated') {
            const reason = typeof orchestration.output === 'string' ? orchestration.output : `Runtime status: ${orchestration.runtimeStatus}`;
            stopRecommendationPolling();
            setRecommendationStatusMessage(`Recommendation run failed: ${reason}`);
            setIsRecommendationRunning(false);
            status.refresh();
            return;
          }

          if (pollCount >= maxPollCount) {
            stopRecommendationPolling();
            setRecommendationStatusMessage('Recommendation run is still running. Check orchestration status in a moment');
            setIsRecommendationRunning(false);
            status.refresh();
          }
        } catch {
          stopRecommendationPolling();
          setRecommendationStatusMessage('Could not refresh recommendation status while polling');
          setIsRecommendationRunning(false);
        }
      }, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRecommendationStatusMessage(`Failed to start recommendation run: ${message}`);
      setIsRecommendationRunning(false);
      stopRecommendationPolling();
    }
  };

  if (status.loading || summary.loading || costSummary.loading || (topRecommendations.loading && !topRecommendations.data)) {
    return <Spinner label="Loading dashboard..." />;
  }

  return (
    <div className="dashboard">
      <div className="dashboard__statusRow">
        <Badge appearance="filled" color={status.data?.status === 'healthy' ? 'success' : 'warning'} size="large">
          {status.data?.status ?? 'unknown'}
        </Badge>
        <Text>v{status.data?.version}</Text>
        <Text size={200} className="dashboard__mutedText">
          Last collection: {status.data?.lastCollectionRun ?? 'never'}
        </Text>
        <Text size={200} className="dashboard__mutedText">
          Last recommendations: {status.data?.lastRecommendationRun ?? 'never'}
        </Text>
        <div className="dashboard__actions">
          <Button icon={<ArrowSyncRegular />} appearance="subtle" onClick={handleRunCollection} disabled={isCollectionRunning}>
            {isCollectionRunning ? 'Running collection…' : 'Run collection'}
          </Button>
          <Button icon={<ArrowSyncRegular />} appearance="subtle" onClick={handleRunRecommendation} disabled={isRecommendationRunning}>
            {isRecommendationRunning ? 'Running recommendations…' : 'Run recommendations'}
          </Button>
        </div>
      </div>

      {collectionStatusMessage && (
        <Text size={200} className="dashboard__infoText">
          {collectionStatusMessage}
        </Text>
      )}
      {recommendationStatusMessage && (
        <Text size={200} className="dashboard__infoText">
          {recommendationStatusMessage}
        </Text>
      )}

      <div className="dashboard__metricGrid">
        <Card>
          <CardHeader
            header={<Text weight="semibold">Current resource cost (30d)</Text>}
            description={renderCurrencyBreakdown(totalCost30dByCurrency)}
          />
        </Card>
        <Card>
          <CardHeader
            header={<Text weight="semibold">Expected monthly savings</Text>}
            description={renderCurrencyBreakdown(totalMonthlySavingsByCurrency, { emphasizeSavings: true })}
          />
        </Card>
        <Card>
          <CardHeader
            header={<Text weight="semibold">Expected annual savings</Text>}
            description={renderCurrencyBreakdown(totalAnnualSavingsByCurrency, { emphasizeSavings: true })}
          />
        </Card>
      </div>

      <div className="dashboard__metricGrid">
        <Card>
          <CardHeader
            header={<Text weight="semibold">Total recommendations</Text>}
            description={
              <Text size={800} weight="bold">
                {totalRecs}
              </Text>
            }
          />
        </Card>

        {Object.entries(byImpact)
          .sort(([left], [right]) => {
            const order = ['High', 'Medium', 'Low'];
            return order.indexOf(left) - order.indexOf(right);
          })
          .map(([impact, count]) => (
            <Card key={impact}>
              <CardHeader
                header={
                  <div className="dashboard__impactHeader">
                    <Badge color={IMPACT_COLORS[impact] ?? 'informative'}>{impact}</Badge>
                    <Text weight="semibold">impact</Text>
                  </div>
                }
                description={
                  <Text size={800} weight="bold">
                    {count}
                  </Text>
                }
              />
            </Card>
          ))}
      </div>

      {topRecommenders.length > 0 && (
        <div>
          <Text weight="semibold" size={500} className="dashboard__sectionTitle">
            Top recommendation functions
          </Text>
          <div className="dashboard__topGrid">
            {topRecommenders.map(([recommender, count]) => (
              <Card key={recommender}>
                <CardHeader
                  header={<Text weight="semibold">{recommender}</Text>}
                  description={<Text size={600}>{count} recommendations</Text>}
                />
              </Card>
            ))}
          </div>
        </div>
      )}

      {topOpportunities.length > 0 && (
        <div>
          <Text weight="semibold" size={500} className="dashboard__sectionTitle">
            Top savings opportunities
          </Text>
          <div className="dashboard__opportunityGrid">
            {topOpportunities.map((recommendation) => {
              const currentCost = getRecommendationCost30d(recommendation);
              const monthlySavings = getRecommendationMonthlySavings(recommendation);
              const currency = getRecommendationCurrency(recommendation);

              return (
                <Card key={recommendation.RecommendationId}>
                  <CardHeader
                    header={<Text weight="semibold">{getResourceDisplayName(recommendation)}</Text>}
                    description={<Text size={200}>{recommendation.RecommendationSubType}</Text>}
                  />
                  <div className="dashboard__opportunityBody">
                    <div className="dashboard__opportunityMetric">
                      <Text size={200} className="dashboard__mutedText">Current cost (30d)</Text>
                      <Text weight="semibold">{currentCost > 0 ? formatCurrencyForRecommendation(currentCost, currency) : '—'}</Text>
                    </div>
                    <div className="dashboard__opportunityMetric">
                      <Text size={200} className="dashboard__mutedText">Expected savings / month</Text>
                      <Text weight="semibold" className={monthlySavings > 0 ? 'dashboard__savingsValue' : undefined}>
                        {monthlySavings > 0 ? formatCurrencyForRecommendation(monthlySavings, currency) : '—'}
                      </Text>
                    </div>
                    <Text size={200} className="dashboard__mutedText">
                      {recommendation.SubscriptionName || recommendation.SubscriptionId || 'No subscription context'}
                    </Text>
                    <Text size={200} className="dashboard__mutedText">
                      {getRecommendationGeneratorLabel(recommendation)}
                    </Text>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Text weight="semibold" size={500} className="dashboard__sectionTitle">
          By category
        </Text>
        <div className="dashboard__categoryGrid">
          {Object.entries(byCategory).map(([category, count]) => {
            const catCost = costByCategory[category] ?? {};
            const categoryCostAmounts = sortCurrencyAmounts(
              Object.entries(catCost).map(([currency, totals]) => ({ currency, amount: totals.cost })),
            );
            const categorySavingsAmounts = sortCurrencyAmounts(
              Object.entries(catCost).map(([currency, totals]) => ({ currency, amount: totals.savings })),
            );
            const categoryCost = getPrimaryAmount(categoryCostAmounts);
            const categorySavings = getPrimaryAmount(categorySavingsAmounts);

            return (
              <Card key={category}>
                <CardHeader
                  header={<Text weight="semibold">{CATEGORY_LABELS[category] ?? category}</Text>}
                  description={
                    <div>
                      <Text size={600}>{count} recommendations</Text>
                      {categoryCost && (
                        <Text size={200} className="dashboard__mutedText dashboard__detailLine">
                          Current cost: {formatCurrency(categoryCost.amount, categoryCost.currency)}/30d
                        </Text>
                      )}
                      {categorySavings && (
                        <Text size={200} className="dashboard__detailLine dashboard__savingsValue">
                          Savings: {formatCurrency(categorySavings.amount, categorySavings.currency)}/mo
                        </Text>
                      )}
                    </div>
                  }
                />
              </Card>
            );
          })}
        </div>
      </div>

      {status.data?.tableCounts && Object.keys(status.data.tableCounts).length > 0 && (
        <div>
          <Text weight="semibold" size={500} className="dashboard__sectionTitle">
            Data inventory
          </Text>
          <div className="dashboard__inventoryGrid">
            {Object.entries(status.data.tableCounts).map(([table, count]) => (
              <Card key={table} size="small">
                <CardHeader header={<Text size={300}>{table}</Text>} description={<Text weight="semibold">{(count as number).toLocaleString()} records</Text>} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
