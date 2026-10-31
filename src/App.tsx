/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { Layout } from './components/Layout';
import { DataManagerProvider, useDataManager } from './lib/dataManager';
import { APIProvider } from '@vis.gl/react-google-maps';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isModuleLoadError, recoverModuleLoad } from './lib/moduleRecovery';

const lazyPage = <T extends Record<string, unknown>, K extends keyof T>(
  importer: () => Promise<T>,
  exportName: K
) => lazy(async () => {
  try {
    const module = await importer();
    return { default: module[exportName] as React.ComponentType };
  } catch (error) {
    if (isModuleLoadError(error) && await recoverModuleLoad()) {
      // Keep the loading state until the fresh document replaces this runtime.
      return await new Promise<{ default: React.ComponentType }>(() => {});
    }
    throw error;
  }
});

const HomePage = lazyPage(() => import('./pages/HomeWithWhatsAppPage'), 'HomeWithWhatsAppPage');
const AgendaPage = lazyPage(() => import('./pages/AgendaPage'), 'AgendaPage');
const ClientsPage = lazyPage(() => import('./pages/ClientsPage'), 'ClientsPage');
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'Dashboard');
const PriceReportsPage = lazyPage(() => import('./pages/PriceReportsPage'), 'PriceReportsPage');
const ClienteDetail = lazyPage(() => import('./pages/ClienteDetail'), 'ClienteDetail');
const StockCountPage = lazyPage(() => import('./pages/StockCountPage'), 'StockCountPage');
const OrderPage = lazyPage(() => import('./pages/OrderPage'), 'OrderPage');
const MetasPage = lazyPage(() => import('./pages/MetasPage'), 'MetasPage');
const LoansPage = lazyPage(() => import('./pages/LoansPage'), 'LoansPage');
const ImportPage = lazyPage(() => import('./pages/ImportPage'), 'ImportPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const CampaignPage = lazyPage(() => import('./pages/CampaignPage'), 'CampaignPage');
const WhatsAppInboxPage = lazyPage(() => import('./pages/WhatsAppInboxPage'), 'WhatsAppInboxPage');
const WhatsAppRulesPage = lazyPage(() => import('./pages/WhatsAppRulesPage'), 'WhatsAppRulesPage');
const WhatsAppConversationPage = lazyPage(() => import('./pages/WhatsAppConversationPage'), 'WhatsAppConversationPage');
const WhatsAppHiddenPage = lazyPage(() => import('./pages/WhatsAppHiddenPage'), 'WhatsAppHiddenPage');

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

// Ativação controlada: nunca ligar sem validar permissões e credenciais.
const authRequired = (import.meta as any).env?.VITE_REQUIRE_AUTH === 'true';

function ProtectedApp({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(authRequired);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authRequired) return;
    let live = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!live) return;
      if (error) setError('Não foi possível verificar a sessão.');
      setSession(data.session);
      setLoading(false);
    }).catch(() => { if (live) { setError('Não foi possível verificar a sessão.'); setLoading(false); } });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (live) setSession(nextSession);
    });
    return () => { live = false; subscription.unsubscribe(); };
  }, []);

  if (!authRequired) return <>{children}</>;
  if (loading) return <div role="status" className="flex min-h-screen items-center justify-center text-sm text-neutral-600">Verificando acesso ao CRM...</div>;
  if (session) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setError('');
          setBusy(true);
          try {
            const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
            if (signInError) throw signInError;
          } catch {
            setError('Não foi possível entrar. Confira as credenciais ou a conexão.');
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Pro Max</h1>
          <p className="mt-1 text-sm text-neutral-500">Acesso restrito ao CRM</p>
        </div>
        <label className="block space-y-1 text-sm font-semibold text-neutral-700">
          <span>E-mail</span>
          <input required type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className="h-11 w-full rounded-lg border border-neutral-300 px-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20" />
        </label>
        <label className="block space-y-1 text-sm font-semibold text-neutral-700">
          <span>Senha</span>
          <input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="h-11 w-full rounded-lg border border-neutral-300 px-3 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20" />
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-lg bg-orange-600 text-sm font-bold text-white hover:bg-orange-700 disabled:opacity-50">
          {busy ? 'Entrando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}

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
              <Route path="/comissoes" element={<Navigate to="/dashboard?aba=comissoes" replace />} />
              <Route path="/emprestimos" element={<LoansPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/campanhas" element={<CampaignPage />} />
              <Route path="/whatsapp" element={<WhatsAppInboxPage />} />
              <Route path="/whatsapp/regras" element={<WhatsAppRulesPage />} />
              <Route path="/whatsapp/ocultos" element={<WhatsAppHiddenPage />} />
              <Route path="/whatsapp/conversa/:contatoId" element={<WhatsAppConversationPage />} />
              <Route path="/settings/whatsapp" element={<Navigate to="/whatsapp" replace />} />
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
    <ProtectedApp>
      <DataManagerProvider>
        <AppContent />
      </DataManagerProvider>
    </ProtectedApp>
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
