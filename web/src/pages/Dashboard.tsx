import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Spinner, Text } from '@fluentui/react-components';
import { ArrowSyncRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import { getCostSummary, getOrchestrationStatus, getRecommendationsSummary, getStatus, startCollection, startRecommendation } from '../services/api';
import type { CostSummaryRow, RecommendationSummaryRow } from '../services/api';

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

function formatCurrency(value: number) {
  return value.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DashboardPage() {
  const status = useAsync(() => getStatus(), []);
  const summary = useAsync(() => getRecommendationsSummary(), []);
  const costSummary = useAsync(() => getCostSummary(), []);
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

  let totalCost30d = 0;
  let totalMonthlySavings = 0;
  let totalAnnualSavings = 0;
  const costByCategory: Record<string, { cost: number; savings: number }> = {};

  if (costSummary.data) {
    for (const row of costSummary.data as CostSummaryRow[]) {
      totalCost30d += row.TotalCost30d;
      totalMonthlySavings += row.TotalMonthlySavings;
      totalAnnualSavings += row.TotalAnnualSavings;
      const entry = costByCategory[row.Category] ?? { cost: 0, savings: 0 };
      entry.cost += row.TotalCost30d;
      entry.savings += row.TotalMonthlySavings;
      costByCategory[row.Category] = entry;
    }
  }

  const topRecommenders = Object.entries(byRecommender)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

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

  if (status.loading || summary.loading || costSummary.loading) {
    return <Spinner label="Loading dashboard..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <Badge appearance="filled" color={status.data?.status === 'healthy' ? 'success' : 'warning'} size="large">
          {status.data?.status ?? 'unknown'}
        </Badge>
        <Text>v{status.data?.version}</Text>
        <Text size={200} style={{ color: '#666' }}>
          Last collection: {status.data?.lastCollectionRun ?? 'never'}
        </Text>
        <Text size={200} style={{ color: '#666' }}>
          Last recommendations: {status.data?.lastRecommendationRun ?? 'never'}
        </Text>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <Button icon={<ArrowSyncRegular />} appearance="subtle" onClick={handleRunCollection} disabled={isCollectionRunning}>
            {isCollectionRunning ? 'Running collection…' : 'Run collection'}
          </Button>
          <Button icon={<ArrowSyncRegular />} appearance="subtle" onClick={handleRunRecommendation} disabled={isRecommendationRunning}>
            {isRecommendationRunning ? 'Running recommendations…' : 'Run recommendations'}
          </Button>
        </div>
      </div>

      {collectionStatusMessage && (
        <Text size={200} style={{ color: '#0f6cbd' }}>
          {collectionStatusMessage}
        </Text>
      )}
      {recommendationStatusMessage && (
        <Text size={200} style={{ color: '#0f6cbd' }}>
          {recommendationStatusMessage}
        </Text>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        <Card>
          <CardHeader
            header={<Text weight="semibold">Monthly cost (30d)</Text>}
            description={
              <Text size={800} weight="bold">
                {formatCurrency(totalCost30d)}
              </Text>
            }
          />
        </Card>
        <Card>
          <CardHeader
            header={<Text weight="semibold">Potential monthly savings</Text>}
            description={
              <Text size={800} weight="bold" style={{ color: totalMonthlySavings > 0 ? '#107c10' : undefined }}>
                {formatCurrency(totalMonthlySavings)}
              </Text>
            }
          />
        </Card>
        <Card>
          <CardHeader
            header={<Text weight="semibold">Potential annual savings</Text>}
            description={
              <Text size={800} weight="bold" style={{ color: totalAnnualSavings > 0 ? '#107c10' : undefined }}>
                {formatCurrency(totalAnnualSavings)}
              </Text>
            }
          />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
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
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
          <Text weight="semibold" size={500} style={{ marginBottom: 12, display: 'block' }}>
            Top recommendation functions
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
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

      <div>
        <Text weight="semibold" size={500} style={{ marginBottom: 12, display: 'block' }}>
          By category
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {Object.entries(byCategory).map(([category, count]) => {
            const catCost = costByCategory[category];
            return (
              <Card key={category}>
                <CardHeader
                  header={<Text weight="semibold">{CATEGORY_LABELS[category] ?? category}</Text>}
                  description={
                    <div>
                      <Text size={600}>{count} recommendations</Text>
                      {catCost && catCost.savings > 0 && (
                        <Text size={200} style={{ display: 'block', color: '#107c10', marginTop: 4 }}>
                          Savings: {formatCurrency(catCost.savings)}/mo
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
          <Text weight="semibold" size={500} style={{ marginBottom: 12, display: 'block' }}>
            Data inventory
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
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
