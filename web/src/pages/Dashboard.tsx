// Dashboard page — overview with summary cards, charts, and recent activity

import { Card, CardHeader, Text, Badge, Spinner, Button } from '@fluentui/react-components';
import { useEffect, useRef, useState } from 'react';
import { ArrowSyncRegular } from '@fluentui/react-icons';
import { useAsync } from '../hooks/useAsync';
import { getOrchestrationStatus, getRecommendationsSummary, getStatus, startCollection, startRecommendation } from '../services/api';

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

export function DashboardPage() {
  const status = useAsync(() => getStatus(), []);
  const summary = useAsync(() => getRecommendationsSummary(), []);
  const [isCollectionRunning, setIsCollectionRunning] = useState(false);
  const [collectionStatusMessage, setCollectionStatusMessage] = useState<string | null>(null);
  const collectionPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopCollectionPolling = () => {
    if (collectionPollTimerRef.current) {
      clearInterval(collectionPollTimerRef.current);
      collectionPollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopCollectionPolling();
    };
  }, []);

  // Aggregate by category
  const byCategory: Record<string, number> = {};
  const byImpact: Record<string, number> = {};
  let totalRecs = 0;

  if (summary.data) {
    for (const row of summary.data as any[]) {
      const cat = row.Category as string;
      const impact = row.Impact as string;
      const count = row.Count as number;
      byCategory[cat] = (byCategory[cat] ?? 0) + count;
      byImpact[impact] = (byImpact[impact] ?? 0) + count;
      totalRecs += count;
    }
  }

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
              failures?: number;
              warnings?: number;
              warningSummary?: string[];
            };

            const totalCollectors = Number(output.totalCollectors ?? 0);
            const totalRecords = Number(output.totalRecords ?? 0);
            const warnings = Number(output.warnings ?? 0);

            stopCollectionPolling();
            if (warnings > 0) {
              setCollectionStatusMessage(`Collection completed with warnings: ${totalCollectors} collectors ran, ${totalRecords} records ingested, ${warnings} optional collectors failed`);
            } else {
              setCollectionStatusMessage(`Collection completed: ${totalCollectors} collectors ran, ${totalRecords} records ingested`);
            }
            setIsCollectionRunning(false);
            status.refresh();
            summary.refresh();
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
          setCollectionStatusMessage('Could not refresh status while polling');
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
    await startRecommendation();
    status.refresh();
  };

  if (status.loading || summary.loading) {
    return <Spinner label="Loading dashboard..." />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Status banner */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
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
          <Button icon={<ArrowSyncRegular />} appearance="subtle" onClick={handleRunRecommendation}>
            Run recommendations
          </Button>
        </div>
      </div>

      {collectionStatusMessage && (
        <Text size={200} style={{ color: '#0f6cbd' }}>
          {collectionStatusMessage}
        </Text>
      )}

      {/* Summary cards */}
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
          .sort(([a], [b]) => {
            const order = ['High', 'Medium', 'Low'];
            return order.indexOf(a) - order.indexOf(b);
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

      {/* By category */}
      <div>
        <Text weight="semibold" size={500} style={{ marginBottom: 12, display: 'block' }}>
          By category
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {Object.entries(byCategory).map(([cat, count]) => (
            <Card key={cat}>
              <CardHeader header={<Text weight="semibold">{CATEGORY_LABELS[cat] ?? cat}</Text>} description={<Text size={600}>{count} recommendations</Text>} />
            </Card>
          ))}
        </div>
      </div>

      {/* Table counts */}
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
