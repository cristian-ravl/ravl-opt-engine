import { Suspense, lazy, useEffect, useState, type ReactElement } from 'react';
import { FluentProvider, Spinner, Tab, TabList, webLightTheme, type SelectTabData } from '@fluentui/react-components';
import { HomeRegular, ShieldTaskRegular, FilterRegular, InfoRegular, TableRegular } from '@fluentui/react-icons';
import './App.css';

const DashboardPage = lazy(async () => import('./pages/Dashboard').then((module) => ({ default: module.DashboardPage })));
const RecommendationsPage = lazy(async () => import('./pages/Recommendations').then((module) => ({ default: module.RecommendationsPage })));
const DataExplorerPage = lazy(async () => import('./pages/DataExplorer').then((module) => ({ default: module.DataExplorerPage })));
const SuppressionsPage = lazy(async () => import('./pages/Suppressions').then((module) => ({ default: module.SuppressionsPage })));
const StatusPage = lazy(async () => import('./pages/Status').then((module) => ({ default: module.StatusPage })));

type PageId = 'dashboard' | 'recommendations' | 'data-explorer' | 'suppressions' | 'status';

const PAGE_ORDER: PageId[] = ['dashboard', 'recommendations', 'data-explorer', 'suppressions', 'status'];

const PAGE_CONFIG: Record<PageId, { label: string; description: string; icon: ReactElement }> = {
  dashboard: {
    label: 'Dashboard',
    description: 'Track engine health, recent runs, and where the biggest optimization wins are waiting.',
    icon: <HomeRegular />,
  },
  recommendations: {
    label: 'Recommendations',
    description: 'Review the optimization backlog, filter it quickly, and decide what to act on next.',
    icon: <ShieldTaskRegular />,
  },
  'data-explorer': {
    label: 'Data Explorer',
    description: 'Inspect the underlying ADX data without getting buried in raw records or mystery columns.',
    icon: <TableRegular />,
  },
  suppressions: {
    label: 'Suppressions',
    description: 'Manage dismissals, snoozes, and exclusions with enough context to keep governance sane.',
    icon: <FilterRegular />,
  },
  status: {
    label: 'Status',
    description: 'Check provider coverage, collector freshness, and whether the engine is ready for action.',
    icon: <InfoRegular />,
  },
};

function isPageId(value: string): value is PageId {
  return PAGE_ORDER.includes(value as PageId);
}

function getPageFromHash(): PageId {
  if (typeof window === 'undefined') {
    return 'dashboard';
  }

  const hashValue = window.location.hash.replace(/^#/, '');
  return isPageId(hashValue) ? hashValue : 'dashboard';
}

export default function App() {
  const [activePage, setActivePage] = useState<PageId>(() => getPageFromHash());

  useEffect(() => {
    const handleHashChange = () => {
      const hashPage = getPageFromHash();
      setActivePage((currentPage) => (currentPage === hashPage ? currentPage : hashPage));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    document.title = `${PAGE_CONFIG[activePage].label} · FinOps Optimization Engine`;
  }, [activePage]);

  const onTabSelect = (_: unknown, data: SelectTabData) => {
    const nextPage = data.value as PageId;
    if (window.location.hash !== `#${nextPage}`) {
      window.location.hash = nextPage;
    }

    setActivePage(nextPage);
  };

  const activePageConfig = PAGE_CONFIG[activePage];

  const renderActivePage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'recommendations':
        return <RecommendationsPage />;
      case 'data-explorer':
        return <DataExplorerPage />;
      case 'suppressions':
        return <SuppressionsPage />;
      case 'status':
        return <StatusPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <FluentProvider theme={webLightTheme}>
      <div className="appShell">
        <header className="appShell__header">
          <div className="appShell__headerInner">
            <div className="appShell__brand">
              <span className="appShell__eyebrow">Optimization workspace</span>
              <div className="appShell__brandText">
                <h1 className="appShell__title">FinOps Optimization Engine</h1>
                <p className="appShell__subtitle">{activePageConfig.description}</p>
              </div>
            </div>
            <TabList className="appShell__tabs" selectedValue={activePage} onTabSelect={onTabSelect}>
              {PAGE_ORDER.map((pageId) => (
                <Tab key={pageId} icon={PAGE_CONFIG[pageId].icon} value={pageId}>
                  {PAGE_CONFIG[pageId].label}
                </Tab>
              ))}
            </TabList>
          </div>
        </header>

        <main className="appShell__main">
          <div className="appShell__content">
            <Suspense fallback={<Spinner label={`Loading ${activePageConfig.label.toLowerCase()}...`} />}>
              {renderActivePage()}
            </Suspense>
          </div>
        </main>
      </div>
    </FluentProvider>
  );
}
