/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ClienteDetail } from './pages/ClienteDetail';
import { OrderPage } from './pages/OrderPage';
import { StockCountPage } from './pages/StockCountPage';
import { MetasPage } from './pages/MetasPage';
import { ImportPage } from './pages/ImportPage';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/clientes" element={<Dashboard />} />
          <Route path="/cliente/:id" element={<ClienteDetail />} />
          <Route path="/estoque/:clienteId" element={<StockCountPage />} />
          <Route path="/pedido/novo" element={<Navigate to="/" replace />} />
          <Route path="/pedido/novo/:clienteId" element={<OrderPage />} />
          <Route path="/metas" element={<MetasPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/settings" element={<div className="p-8 text-center">Configurações (Em desenvolvimento)</div>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
