import { FluentProvider, webLightTheme, Tab, TabList, type SelectTabData } from '@fluentui/react-components';
import { HomeRegular, ShieldTaskRegular, FilterRegular, InfoRegular, TableRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { DashboardPage } from './pages/Dashboard';
import { DataExplorerPage } from './pages/DataExplorer';
import { RecommendationsPage } from './pages/Recommendations';
import { SuppressionsPage } from './pages/Suppressions';
import { StatusPage } from './pages/Status';

type PageId = 'dashboard' | 'recommendations' | 'data-explorer' | 'suppressions' | 'status';

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');

  const onTabSelect = (_: unknown, data: SelectTabData) => {
    setActivePage(data.value as PageId);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        <header
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid #e0e0e0',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>FinOps Optimization Engine</h1>
          <TabList selectedValue={activePage} onTabSelect={onTabSelect}>
            <Tab icon={<HomeRegular />} value="dashboard">
              Dashboard
            </Tab>
            <Tab icon={<ShieldTaskRegular />} value="recommendations">
              Recommendations
            </Tab>
            <Tab icon={<TableRegular />} value="data-explorer">
              Data Explorer
            </Tab>
            <Tab icon={<FilterRegular />} value="suppressions">
              Suppressions
            </Tab>
            <Tab icon={<InfoRegular />} value="status">
              Status
            </Tab>
          </TabList>
        </header>

        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {activePage === 'dashboard' && <DashboardPage />}
          {activePage === 'recommendations' && <RecommendationsPage />}
          {activePage === 'data-explorer' && <DataExplorerPage />}
          {activePage === 'suppressions' && <SuppressionsPage />}
          {activePage === 'status' && <StatusPage />}
        </main>
      </div>
    </FluentProvider>
  );
}
