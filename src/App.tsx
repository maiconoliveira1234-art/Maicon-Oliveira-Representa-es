/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ClientsPage } from './pages/ClientsPage';
import { PriceInquiryPage } from './pages/PriceInquiryPage';
import { ClienteDetail } from './pages/ClienteDetail';
import { OrderPage } from './pages/OrderPage';
import { StockCountPage } from './pages/StockCountPage';
import { MetasPage } from './pages/MetasPage';
import { ImportPage } from './pages/ImportPage';
import { SettingsPage } from './pages/SettingsPage';
import { runAutomaticInactivation } from './lib/clientInactivation';

export default function App() {
  useEffect(() => {
    runAutomaticInactivation();
  }, []);

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<ClientsPage />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/clientes" element={<Navigate to="/" replace />} />
          <Route path="/consulta-preco" element={<PriceInquiryPage />} />
          <Route path="/cliente/:id" element={<ClienteDetail />} />
          <Route path="/estoque/:clienteId" element={<StockCountPage />} />
          <Route path="/pedido/novo" element={<Navigate to="/" replace />} />
          <Route path="/pedido/novo/:clienteId" element={<OrderPage />} />
          <Route path="/metas" element={<MetasPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
