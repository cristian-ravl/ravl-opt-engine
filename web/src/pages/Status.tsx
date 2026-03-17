import { Badge, Card, CardHeader, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text } from '@fluentui/react-components';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../hooks/useAsync';
import { getStatus, getProviders } from '../services/api';
import { formatDateTimeWithRelative } from '../utils/format';
import './Status.css';

export function StatusPage() {
  const status = useAsync(() => getStatus(), []);
  const providers = useAsync(() => getProviders(), []);

  if (status.loading || providers.loading) {
    return <Spinner label="Loading status..." />;
  }

  if (status.error) {
    return <Text className="statusPage__errorText">Error loading status: {status.error.message}</Text>;
  }

  const s = status.data!;
  const collectorRuns = [...(s.collectorRuns ?? [])].sort((left, right) => left.name.localeCompare(right.name));
  const providerList = providers.data?.providers ?? [];
  const totalCollectors = providerList.reduce((total, provider) => total + (provider.collectors?.length ?? 0), 0);
  const totalRecommenders = providerList.reduce((total, provider) => total + (provider.recommenders?.length ?? 0), 0);
  const totalTables = Object.keys(s.tableCounts ?? {}).length;

  return (
    <div className="statusPage">
      <PageHeader
        eyebrow="Operations"
        title="Status"
        description="Check platform health, confirm provider coverage, and spot stale collectors before users notice missing or outdated data."
        meta={
          <>
            <Badge appearance="filled" color={s.status === 'healthy' ? 'success' : 'warning'} size="large">
              {s.status}
            </Badge>
            <Text size={200} className="statusPage__metaText">ADX {s.adx.connected ? 'connected' : 'not connected'}</Text>
            <Text size={200} className="statusPage__metaText">Last collection {formatDateTimeWithRelative(s.lastCollectionRun)}</Text>
            <Text size={200} className="statusPage__metaText">Last recommendations {formatDateTimeWithRelative(s.lastRecommendationRun)}</Text>
          </>
        }
      />

      <div className="statusPage__summaryGrid">
        <Card>
          <CardHeader header={<Text weight="semibold">Version</Text>} description={<Text size={700}>v{s.version}</Text>} />
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">Providers</Text>} description={<Text size={700}>{providerList.length}</Text>} />
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">Collectors</Text>} description={<Text size={700}>{totalCollectors}</Text>} />
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">Recommenders</Text>} description={<Text size={700}>{totalRecommenders}</Text>} />
        </Card>
        <Card>
          <CardHeader header={<Text weight="semibold">ADX sources</Text>} description={<Text size={700}>{totalTables}</Text>} />
        </Card>
      </div>

      <Card>
        <CardHeader
          header={
            <div className="statusPage__cardHeader">
              <Text weight="semibold" size={500}>
                Engine health
              </Text>
              <Badge appearance="filled" color={s.status === 'healthy' ? 'success' : 'warning'} size="large">
                {s.status}
              </Badge>
            </div>
          }
        />
        <div className="statusPage__cardBody">
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
                <TableCell>{formatDateTimeWithRelative(s.lastCollectionRun)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>
                  <Text weight="semibold">Last recommendations</Text>
                </TableCell>
                <TableCell>{formatDateTimeWithRelative(s.lastRecommendationRun)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>

      {collectorRuns.length > 0 && (
        <Card>
          <CardHeader
            header={<Text weight="semibold">Collector freshness</Text>}
            description={<Text size={200}>The latest successful run for each collector.</Text>}
          />
          <div className="statusPage__tableWrap">
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
                      <div className="statusPage__stackedCell">
                        <Text weight="semibold">{collector.name}</Text>
                        <Text size={200} className="statusPage__mutedText">
                          {collector.id}
                        </Text>
                      </div>
                    </TableCell>
                    <TableCell>{collector.cloud}</TableCell>
                    <TableCell>{collector.collectedType ?? 'Not ingested yet'}</TableCell>
                    <TableCell>{formatDateTimeWithRelative(collector.lastSuccessfulCollection)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <div>
        <Text weight="semibold" size={500} className="statusPage__sectionTitle">
          Registered providers
        </Text>
        <div className="statusPage__providerGrid">
          {providerList.map((provider) => (
            <Card key={provider.cloud}>
              <CardHeader
                header={
                  <Text weight="semibold" size={400}>
                    {provider.cloud}
                  </Text>
                }
                description={
                  <Text size={200}>
                    {provider.collectors?.length ?? 0} collectors, {provider.recommenders?.length ?? 0} recommenders, {provider.remediators?.length ?? 0} remediators
                  </Text>
                }
              />
              <div className="statusPage__cardBody">
                {(provider.collectors?.length ?? 0) > 0 && (
                  <>
                    <Text size={200} weight="semibold" className="statusPage__listTitle">
                      Collectors
                    </Text>
                    <ul className="statusPage__list">
                      {(provider.collectors ?? []).map((collector) => (
                        <li key={collector.id}>{collector.name}</li>
                      ))}
                    </ul>
                  </>
                )}
                {(provider.recommenders?.length ?? 0) > 0 && (
                  <>
                    <Text size={200} weight="semibold" className="statusPage__listTitle">
                      Recommenders
                    </Text>
                    <ul className="statusPage__list statusPage__list--tight">
                      {(provider.recommenders ?? []).map((recommender) => (
                        <li key={recommender.id}>
                          {recommender.name} ({recommender.subTypes?.length ?? 0} sub-types)
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

      {s.tableCounts && Object.keys(s.tableCounts).length > 0 && (
        <Card>
          <CardHeader
            header={<Text weight="semibold">ADX table record counts</Text>}
            description={<Text size={200}>A quick inventory of the loaded data sources.</Text>}
          />
          <div className="statusPage__tableWrap">
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
        </Card>
      )}
    </div>
  );
}
