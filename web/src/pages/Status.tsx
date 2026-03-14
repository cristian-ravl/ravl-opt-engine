// Status page — engine health, provider info, and orchestration history

import { Card, CardHeader, Badge, Spinner, Text, Table, TableHeader, TableHeaderCell, TableBody, TableRow, TableCell } from '@fluentui/react-components';
import { useAsync } from '../hooks/useAsync';
import { getStatus, getProviders } from '../services/api';

export function StatusPage() {
  const status = useAsync(() => getStatus(), []);
  const providers = useAsync(() => getProviders(), []);

  if (status.loading || providers.loading) {
    return <Spinner label="Loading status..." />;
  }

  if (status.error) {
    return <Text style={{ color: 'red' }}>Error loading status: {status.error.message}</Text>;
  }

  const s = status.data!;
  const collectorRuns = [...(s.collectorRuns ?? [])].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Health */}
      <Card>
        <CardHeader
          header={
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Text weight="semibold" size={500}>
                Engine health
              </Text>
              <Badge appearance="filled" color={s.status === 'healthy' ? 'success' : 'warning'} size="large">
                {s.status}
              </Badge>
            </div>
          }
        />
        <div style={{ padding: '0 16px 16px' }}>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">Version</Text>
                </TableCell>
                <TableCell>{s.version}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">ADX cluster</Text>
                </TableCell>
                <TableCell>{s.adx.clusterUri}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">ADX database</Text>
                </TableCell>
                <TableCell>{s.adx.database}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">ADX connected</Text>
                </TableCell>
                <TableCell>
                  <Badge color={s.adx.connected ? 'success' : 'danger'}>{s.adx.connected ? 'Yes' : 'No'}</Badge>
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">Last collection</Text>
                </TableCell>
                <TableCell>{s.lastCollectionRun ?? 'Never'}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">Last recommendations</Text>
                </TableCell>
                <TableCell>{s.lastRecommendationRun ?? 'Never'}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Collector freshness */}
      {collectorRuns.length > 0 && (
        <div>
          <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: 12 }}>
            Collector freshness
          </Text>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Collector</TableHeaderCell>
                <TableHeaderCell>Cloud</TableHeaderCell>
                <TableHeaderCell>Collected type</TableHeaderCell>
                <TableHeaderCell>Last successful collection</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {collectorRuns.map((collector) => (
                <TableRow key={collector.id}>
                  <TableCell>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Text weight="semibold">{collector.name}</Text>
                      <Text size={200} style={{ color: '#666' }}>
                        {collector.id}
                      </Text>
                    </div>
                  </TableCell>
                  <TableCell>{collector.cloud}</TableCell>
                  <TableCell>{collector.collectedType ?? 'Not ingested yet'}</TableCell>
                  <TableCell>{collector.lastSuccessfulCollection ?? 'Never'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Providers */}
      <div>
        <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: 12 }}>
          Registered providers
        </Text>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {(providers.data?.providers ?? []).map((p: any) => (
            <Card key={p.cloud}>
              <CardHeader
                header={
                  <Text weight="semibold" size={400}>
                    {p.cloud}
                  </Text>
                }
                description={
                  <Text size={200}>
                    {p.collectors?.length ?? 0} collectors, {p.recommenders?.length ?? 0} recommenders, {p.remediators?.length ?? 0} remediators
                  </Text>
                }
              />
              <div style={{ padding: '0 16px 16px' }}>
                {p.collectors?.length > 0 && (
                  <>
                    <Text size={200} weight="semibold" style={{ display: 'block', marginBottom: 4 }}>
                      Collectors
                    </Text>
                    <ul style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: 13 }}>
                      {p.collectors.map((c: any) => (
                        <li key={c.id}>{c.name}</li>
                      ))}
                    </ul>
                  </>
                )}
                {p.recommenders?.length > 0 && (
                  <>
                    <Text size={200} weight="semibold" style={{ display: 'block', marginBottom: 4 }}>
                      Recommenders
                    </Text>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                      {p.recommenders.map((r: any) => (
                        <li key={r.id}>
                          {r.name} ({r.subTypes?.length ?? 0} sub-types)
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Table counts */}
      {s.tableCounts && Object.keys(s.tableCounts).length > 0 && (
        <div>
          <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: 12 }}>
            ADX table record counts
          </Text>
          <Table size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Table</TableHeaderCell>
                <TableHeaderCell>Records</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(s.tableCounts).map(([table, count]) => (
                <TableRow key={table}>
                  <TableCell>{table}</TableCell>
                  <TableCell>{(count as number).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
