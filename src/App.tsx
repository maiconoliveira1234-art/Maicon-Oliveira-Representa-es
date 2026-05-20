/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { AgendaPage } from './pages/AgendaPage';
import { ClientsPage } from './pages/ClientsPage';
import { PriceInquiryPage } from './pages/PriceInquiryPage';
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

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';
const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

function AppContent() {
  const { loadInitialData } = useDataManager();

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<AgendaPage />} />
          <Route path="/clientes" element={<ClientsPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/consulta-preco" element={<PriceInquiryPage />} />
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
  );
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
