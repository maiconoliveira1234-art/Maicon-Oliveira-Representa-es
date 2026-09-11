/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { DataManagerProvider, useDataManager } from './lib/dataManager';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ErrorBoundary } from './components/ErrorBoundary';

const lazyPage = <T extends Record<string, unknown>, K extends keyof T>(
  importer: () => Promise<T>,
  exportName: K
) => lazy(async () => {
  const module = await importer();
  return { default: module[exportName] as React.ComponentType };
});

const HomePage = lazyPage(() => import('./pages/HomePage'), 'HomePage');
const AgendaPage = lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage');
const ClientsPage = lazyPage(() => import('./pages/ClientsPage'), 'ClientsPage');
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'Dashboard');
const PriceReportsPage = lazyPage(() => import('./pages/PriceReportsPage'), 'PriceReportsPage');
const ClienteDetail = lazyPage(() => import('./pages/ClienteDetail'), 'ClienteDetail');
const StockCountPage = lazyPage(() => import('./pages/StockCountPage'), 'StockCountPage');
const OrderPage = lazyPage(() => import('./pages/OrderPage'), 'OrderPage');
const MetasPage = lazyPage(() => import('./pages/MetasPage'), 'MetasPage');
const CommissionPage = lazyPage(() => import('./pages/CommissionPage'), 'CommissionPage');
const LoansPage = lazyPage(() => import('./pages/LoansPage'), 'LoansPage');
const ImportPage = lazyPage(() => import('./pages/ImportPage'), 'ImportPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-3 text-sm font-semibold text-neutral-500">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-200 border-t-orange-600" />
        Carregando tela...
      </div>
    </div>
  );
}

const API_KEY = (
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  ''
).trim();

const hasValidKey =
  Boolean(API_KEY) &&
  API_KEY !== 'YOUR_API_KEY' &&
  API_KEY !== 'undefined' &&
  API_KEY !== 'null' &&
  API_KEY.startsWith('AIzaSy') &&
  API_KEY.length >= 20;

function AppContent() {
  const { loadInitialData } = useDataManager();

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <InitialRouteGuard />
        <Layout>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/agenda" element={<AgendaPage />} />
              <Route path="/clientes" element={<ClientsPage />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/consulta-preco" element={<PriceReportsPage />} />
              <Route path="/relatorios-precos" element={<Navigate to="/consulta-preco" replace />} />
              <Route path="/cliente/:id" element={<ClienteDetail />} />
              <Route path="/estoque/:clienteId" element={<StockCountPage />} />
              <Route path="/pedido/novo/:clienteId" element={<OrderPage />} />
              <Route path="/metas" element={<MetasPage />} />
              <Route path="/comissoes" element={<CommissionPage />} />
              <Route path="/emprestimos" element={<LoansPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </Layout>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

function InitialRouteGuard() {
  const [redirectFromSettings, setRedirectFromSettings] = useState(() => window.location.pathname === '/settings');

  useEffect(() => {
    if (redirectFromSettings) setRedirectFromSettings(false);
  }, [redirectFromSettings]);

  if (redirectFromSettings && window.location.pathname === '/settings') {
    return <Navigate to="/" replace />;
  }

  return null;
}

export default function App() {
  const appContent = (
    <DataManagerProvider>
      <AppContent />
    </DataManagerProvider>
  );

  if (hasValidKey) {
    return (
      <APIProvider apiKey={API_KEY} version="weekly" libraries={['places', 'geocoding']}>
        {appContent}
      </APIProvider>
    );
  }

  return appContent;
}
