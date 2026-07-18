/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { HomePage } from './pages/HomePage';
import { AgendaPage } from './pages/AgendaPage';
import { ClientsPage } from './pages/ClientsPage';
import { PriceReportsPage } from './pages/PriceReportsPage';
import { ClienteDetail } from './pages/ClienteDetail';
import { OrderPage } from './pages/OrderPage';
import { StockCountPage } from './pages/StockCountPage';
import { MetasPage } from './pages/MetasPage';
import { ImportPage } from './pages/ImportPage';
import { CommissionPage } from './pages/CommissionPage';
import { LoansPage } from './pages/LoansPage';
import { SettingsPage } from './pages/SettingsPage';
import { runAutomaticInactivation } from './lib/clientInactivation';
import { DataManagerProvider, useDataManager } from './lib/dataManager';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ErrorBoundary } from './components/ErrorBoundary';

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
