import { FluentProvider, webLightTheme, Tab, TabList, type SelectTabData } from '@fluentui/react-components';
import { HomeRegular, ShieldTaskRegular, FilterRegular, InfoRegular, TableRegular } from '@fluentui/react-icons';
import { useState } from 'react';
import { DashboardPage } from './pages/Dashboard';
import { DataExplorerPage } from './pages/DataExplorer';
import { RecommendationsPage } from './pages/Recommendations';
import { SuppressionsPage } from './pages/Suppressions';
import { StatusPage } from './pages/Status';
import './App.css';

type PageId = 'dashboard' | 'recommendations' | 'data-explorer' | 'suppressions' | 'status';

export default function App() {
  const [activePage, setActivePage] = useState<PageId>('dashboard');

  const onTabSelect = (_: unknown, data: SelectTabData) => {
    setActivePage(data.value as PageId);
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className="appShell">
        <header className="appShell__header">
          <div className="appShell__headerInner">
            <h1 className="appShell__title">FinOps Optimization Engine</h1>
            <TabList className="appShell__tabs" selectedValue={activePage} onTabSelect={onTabSelect}>
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
          </div>
        </header>

        <main className="appShell__main">
          <div className="appShell__content">
            {activePage === 'dashboard' && <DashboardPage />}
            {activePage === 'recommendations' && <RecommendationsPage />}
            {activePage === 'data-explorer' && <DataExplorerPage />}
            {activePage === 'suppressions' && <SuppressionsPage />}
            {activePage === 'status' && <StatusPage />}
          </div>
        </main>
      </div>
    </FluentProvider>
  );
}
