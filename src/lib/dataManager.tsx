import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { Cliente, Produto, HistVenda, EstoqueCliente } from '../types';
import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from './mockData';
import { deduplicateSales } from './utils';
import { ensureQuarterlyFlexReset } from '../services/flexService';
import { getCacheValue, setCacheValue, setCacheValues } from './offline';
import {
  buildStockCountPayload,
  isStockCountFullyConfirmed,
  mergeStockCountRecords
} from './stockCountPersistence';

export interface OfflineQueueItem {
  id: string;
  action: 'save_stock_count' | 'update_visita_status' | 'update_visita_observacoes' | 'add_loan' | 'update_loan_status' | 'delete_loan' | 'save_open_order' | 'delete_open_order';
  payload: any;
  timestamp: number;
}

export type UpdateOrderItemPayload = {
  id: string;
  produto_id: string;
  produtos: string;
  qtd: number;
  "r$_total": number;
  vendas?: string;
  tabela?: string;
  xdt?: number;
  "acresc."?: number;
};

export type NewOrderItemPayload = {
  produto_id: string;
  produtos: string;
  qtd: number;
  "r$_total": number;
  vendas?: string;
  tabela?: string;
  xdt?: number;
  "acresc."?: number;
  numero_pedido_erp?: string;
};

export type UpdateOrderSalesParams = {
  pedidoId: string;
  clienteOriginalId: string;
  novoClienteId: string;
  novoClienteNome: string;
  novaData: string;
  itensAtualizados: UpdateOrderItemPayload[];
  itensNovos: NewOrderItemPayload[];
  itensRemovidosIds: string[];
};

export type StockCountSaveResult = {
  status: 'synced' | 'queued';
  error?: string;
};

interface ClientCache {
  historico: HistVenda[];
  estoque: EstoqueCliente[];
  lastUpdated: number;
}

interface DataManagerContextType {
  clientes: Cliente[];
  produtos: Produto[];
  metas: Record<string, number>;
  agenda_visitas: any[];
  hist_vendas: HistVenda[];
  estoque_cliente: EstoqueCliente[];
  emprestimos: any[];
  verba_flex_extrato: any[];
  latestSalesMap: Record<string, { date: string; weight: number }>;
  clientCache: Record<string, ClientCache>;
  
  loadingGlobal: boolean;
  isSyncing: boolean;
  lastSyncedTime: number;
  pendingQueueCount: number;
  
  loadInitialData: () => Promise<void>;
  syncAllData: (force?: boolean) => Promise<boolean>;
  
  // Offline-safe write operations
  saveStockCount: (clienteId: string, items: any[]) => Promise<StockCountSaveResult>;
  updateOrderSales: (params: UpdateOrderSalesParams) => Promise<{ success: boolean; error?: string }>;
  updateVisitaStatus: (visitaId: string, status: string) => Promise<boolean>;
  updateVisitaObservacoes: (visitaId: string, observacoes: string) => Promise<boolean>;
  addLoan: (loanData: any) => Promise<boolean>;
  updateLoanStatus: (loanId: string, status: string, devDate: string | null) => Promise<boolean>;
  deleteLoan: (loanId: string) => Promise<boolean>;
  saveOpenOrder: (payload: {
    cliente_id: string;
    items: any[];
    prazo?: string | null;
    obs?: string | null;
    manual_faixa?: string | null;
    desconto_extra?: number;
    started_at?: string | null;
    updated_at?: string | null;
  }) => Promise<{ status: 'synced' | 'queued'; error?: string }>;
  deleteOpenOrder: (clienteId: string) => Promise<{ status: 'synced' | 'queued'; error?: string }>;
  
  // Compatibility methods
  loadClientDetails: (clientId: string, forceRefresh?: boolean) => Promise<ClientCache | undefined>;
  prefetchClientData: (clientId: string) => void;
  loadLatestSalesMap: (forceRefresh?: boolean) => Promise<Record<string, { date: string; weight: number }>>;
  
  refreshClientes: () => Promise<void>;
  refreshProdutos: () => Promise<void>;
}

const DataManagerContext = createContext<DataManagerContextType | undefined>(undefined);
const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const IDLE_SYNC_INTERVAL_MS = 5 * 60 * 1000;

const mergeByKey = <T,>(current: T[], incoming: T[], getKey: (item: T) => string) => {
  const merged = new Map(current.map(item => [getKey(item), item]));
  incoming.forEach(item => merged.set(getKey(item), item));
  return Array.from(merged.values());
};

const getLocalStorageSafeData = (key: string, data: any) => {
  if (key === 'offline_db_hist_vendas' && Array.isArray(data)) {
    return data.slice(0, 500);
  }

  if (key === 'offline_db_verba_flex_extrato' && Array.isArray(data)) {
    return data.slice(0, 100);
  }

  return data;
};

const loadLocal = <T,>(key: string, fallback: T): T => {
  try {
    const val = localStorage.getItem(key);
    return val ? JSON.parse(val) : fallback;
  } catch (e) {
    console.error(`Error loading local key ${key}`, e);
    return fallback;
  }
};

const saveLocal = (key: string, data: any) => {
  try {
    localStorage.setItem(key, JSON.stringify(getLocalStorageSafeData(key, data)));
  } catch (e: any) {
    console.error(`Error saving local key ${key}`, e);
    // Graceful recovery for localStorage QuotaExceededError
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.message?.includes('quota') || e.message?.includes('Quota')) {
      if (key === 'offline_db_hist_vendas' && Array.isArray(data)) {
        try {
          console.warn('Quota exceeded on hist_vendas. Retrying with sliced 500 items...');
          localStorage.setItem(key, JSON.stringify(data.slice(0, 500)));
        } catch (innerErr) {
          console.error('Failed to save sliced hist_vendas', innerErr);
        }
      } else if (key === 'offline_db_verba_flex_extrato' && Array.isArray(data)) {
        try {
          console.warn('Quota exceeded on verba_flex_extrato. Retrying with sliced 100 items...');
          localStorage.setItem(key, JSON.stringify(data.slice(0, 100)));
        } catch (innerErr) {
          console.error('Failed to save sliced verba_flex_extrato', innerErr);
        }
      }
    }
  }
};

const loadPersisted = async <T,>(key: string, fallback: T): Promise<T> => {
  const localFallback = loadLocal<T>(key, fallback);
  try {
    return await getCacheValue<T>(key, localFallback);
  } catch (e) {
    console.warn(`[OfflineManager] IndexedDB unavailable for ${key}, using localStorage fallback.`, e);
    return localFallback;
  }
};

const savePersisted = (key: string, data: any) => {
  saveLocal(key, data);
  setCacheValue(key, data).catch((e) => {
    console.warn(`[OfflineManager] Could not persist ${key} to IndexedDB.`, e);
  });
};

const savePersistedBatch = (values: Record<string, any>) => {
  Object.entries(values).forEach(([key, value]) => saveLocal(key, value));
  setCacheValues(values).catch((e) => {
    console.warn('[OfflineManager] Could not persist batch to IndexedDB.', e);
  });
};

// Helper to safely execute a query with retry on 57014 (statement timeout) or transient network failures
async function executeWithRetry<T = any>(
  queryFn: () => PromiseLike<{ data: T | null; error: any }>,
  retries = 2,
  delayMs = 500
): Promise<{ data: T | null; error: any }> {
  let lastResult: { data: T | null; error: any } = { data: null, error: null };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await queryFn();
      if (!res.error) return res as { data: T | null; error: any };
      lastResult = res as { data: T | null; error: any };
      const isTimeout = res.error.code === '57014' || res.error.message?.includes('timeout') || res.error.message?.includes('canceling statement');
      if (isTimeout && attempt < retries) {
        console.warn(`[OfflineSync] Query timed out (attempt ${attempt + 1}/${retries + 1}), retrying in ${(attempt + 1) * delayMs}ms...`);
        await new Promise(r => setTimeout(r, (attempt + 1) * delayMs));
        continue;
      }
      return res as { data: T | null; error: any };
    } catch (e: any) {
      lastResult = { data: null, error: e };
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, (attempt + 1) * delayMs));
      }
    }
  }
  return lastResult;
}

// Safely fetch hist_vendas in chunks to prevent PostgreSQL statement_timeout (code 57014)
async function fetchHistVendasChunked(startDate = '2024-01-01'): Promise<{ data: HistVenda[]; error: any }> {
  const CHUNK_SIZE = 1000;
  let allRows: HistVenda[] = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const to = from + CHUNK_SIZE - 1;
    const res = await executeWithRetry<HistVenda[]>(() =>
      supabase
        .from('hist_vendas')
        .select('*')
        .gte('faturamento', startDate)
        .range(from, to)
    );

    if (res.error) {
      console.warn(`[OfflineSync] Error fetching hist_vendas range [${from}..${to}]:`, res.error);
      const isTimeout = res.error.code === '57014' || res.error.message?.includes('timeout') || res.error.message?.includes('canceling statement');
      if (isTimeout) {
        // Fallback with smaller chunk size
        const smallChunkSize = 300;
        let subFrom = from;
        let subFailed = false;
        while (subFrom <= to && !subFailed) {
          const subTo = subFrom + smallChunkSize - 1;
          const subRes = await executeWithRetry<HistVenda[]>(() =>
            supabase
              .from('hist_vendas')
              .select('*')
              .gte('faturamento', startDate)
              .range(subFrom, subTo)
          );
          if (subRes.error) {
            subFailed = true;
            break;
          }
          if (subRes.data && subRes.data.length > 0) {
            allRows = allRows.concat(subRes.data);
            if (subRes.data.length < smallChunkSize) {
              hasMore = false;
              break;
            }
            subFrom += smallChunkSize;
          } else {
            hasMore = false;
            break;
          }
        }
        if (subFailed) {
          return { data: allRows, error: res.error };
        }
        from = subFrom;
        continue;
      }
      return { data: allRows, error: res.error };
    }

    const rows = res.data || [];
    allRows = allRows.concat(rows);
    if (rows.length < CHUNK_SIZE) {
      hasMore = false;
    } else {
      from += CHUNK_SIZE;
    }
  }

  return { data: allRows, error: null };
}

export function DataManagerProvider({ children }: { children: React.ReactNode }) {
  // Global table states (Single Source of Truth)
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [agendaVisitas, setAgendaVisitas] = useState<any[]>([]);
  const [histVendas, setHistVendas] = useState<HistVenda[]>([]);
  const [estoqueCliente, setEstoqueCliente] = useState<EstoqueCliente[]>([]);
  const [emprestimos, setEmprestimos] = useState<any[]>([]);
  const [verbaFlexExtrato, setVerbaFlexExtrato] = useState<any[]>([]);
  const [latestSalesMap, setLatestSalesMap] = useState<Record<string, { date: string; weight: number }>>({});
  
  // Syncing metadata states
  const [loadingGlobal, setLoadingGlobal] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedTime, setLastSyncedTime] = useState<number>(0);
  const [pendingQueue, setPendingQueue] = useState<OfflineQueueItem[]>([]);
  
  const initialLoadStarted = useRef(false);
  const isSyncingRef = useRef(false);

  // Sync queue count to render badges
  const pendingQueueCount = pendingQueue.length;

  // Flush any pending write operations to Supabase
  const flushOfflineQueue = useCallback(async (queueToFlush: OfflineQueueItem[]): Promise<boolean> => {
    if (queueToFlush.length === 0) return true;
    console.log(`[OfflineManager] Flushing ${queueToFlush.length} pending operations...`);
    
    try {
      for (const item of queueToFlush) {
        if (item.action === 'save_stock_count') {
          const { items } = item.payload;
          const sanitizedItems = buildStockCountPayload(
            item.payload.clienteId || items[0]?.cliente_id,
            items
          );
          const { error } = await supabase
            .from('estoque_cliente')
            .upsert(sanitizedItems, { onConflict: 'cliente_id,produto_id' });
          if (error) throw error;
        } else if (item.action === 'update_visita_status') {
          const { id, status } = item.payload;
          await supabase.from('agenda_visitas').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
        } else if (item.action === 'update_visita_observacoes') {
          const { id, observacoes } = item.payload;
          await supabase.from('agenda_visitas').update({ observacoes, updated_at: new Date().toISOString() }).eq('id', id);
        } else if (item.action === 'add_loan') {
          await supabase.from('emprestimos').insert([item.payload]);
        } else if (item.action === 'update_loan_status') {
          const { id, status, data_devolucao } = item.payload;
          await supabase.from('emprestimos').update({ status, data_devolucao }).eq('id', id);
        } else if (item.action === 'delete_loan') {
          const { id } = item.payload;
          await supabase.from('emprestimos').delete().eq('id', id);
        } else if (item.action === 'save_open_order') {
          const payload = item.payload;
          const { error } = await supabase
            .from('pedidos_em_aberto')
            .upsert({
              cliente_id: payload.cliente_id,
              items: payload.items,
              prazo: payload.prazo || null,
              obs: payload.obs || null,
              manual_faixa: payload.manual_faixa || null,
              desconto_extra: payload.desconto_extra || 0,
              started_at: payload.started_at || new Date().toISOString(),
              updated_at: payload.updated_at || new Date().toISOString()
            }, { onConflict: 'cliente_id' });
          if (error) throw error;
        } else if (item.action === 'delete_open_order') {
          const { cliente_id } = item.payload;
          const { error } = await supabase
            .from('pedidos_em_aberto')
            .delete()
            .eq('cliente_id', cliente_id);
          if (error) throw error;
        }
      }
      
      // Successfully flushed everything, clear queue
      setPendingQueue([]);
      savePersisted('offline_db_pending_queue', []);
      console.log('[OfflineManager] All pending actions successfully synced to cloud.');
      return true;
    } catch (error) {
      console.warn('[OfflineManager] Queue flush halted (no connection or db locked):', error);
      return false;
    }
  }, []);

  // Queue a background operation
  const queueAction = useCallback(async (action: OfflineQueueItem['action'], payload: any) => {
    const newItem: OfflineQueueItem = {
      id: `${action}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      action,
      payload,
      timestamp: Date.now()
    };
    
    setPendingQueue(prev => {
      const updated = [...prev, newItem];
      savePersisted('offline_db_pending_queue', updated);
      // Try to flush immediately in background
      flushOfflineQueue(updated);
      return updated;
    });
  }, [flushOfflineQueue]);

  // Core Sync Pull Logic
  const syncAllDataInternal = useCallback(async (forceReflushQueue = true): Promise<boolean> => {
    if (isSyncingRef.current) return false;
    const syncStartedAt = Date.now();
    isSyncingRef.current = true;
    setIsSyncing(true);
    
    try {
      // 1. Flush local queue first
      const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      if (currentQueue.length > 0) {
        const flushSuccess = await flushOfflineQueue(currentQueue);
        if (!flushSuccess && !forceReflushQueue) {
          console.warn('[OfflineSync] Local queue failed to sync, continuing with download of current state.');
        }
      }

      await ensureQuarterlyFlexReset(false);
      
      // Keep the analytical history used by dashboard, commissions and goals available offline.
      const historyStart = '2024-01-01';

      // Load existing caches for graceful fallback
      const [
        cachedClientes,
        cachedProdutos,
        cachedMetas,
        cachedVisitas,
        cachedHist,
        cachedEstoque,
        cachedLoans,
        cachedFlex
      ] = await Promise.all([
        loadPersisted<Cliente[]>('offline_db_clientes', []),
        loadPersisted<Produto[]>('offline_db_produtos', []),
        loadPersisted<Record<string, number>>('offline_db_metas', {}),
        loadPersisted<any[]>('offline_db_agenda_visitas', []),
        loadPersisted<HistVenda[]>('offline_db_hist_vendas', []),
        loadPersisted<EstoqueCliente[]>('offline_db_estoque_cliente', []),
        loadPersisted<any[]>('offline_db_emprestimos', []),
        loadPersisted<any[]>('offline_db_verba_flex_extrato', [])
      ]);

      // 2. Fetch all tables from Supabase safely with retries and chunking
      const [
        clientesRes,
        produtosRes,
        metasRes,
        visitasRes,
        estoqueRes,
        emprestimosRes,
        flexRes,
        histRes
      ] = await Promise.all([
        executeWithRetry<Cliente[]>(() => supabase.from('clientes').select('*').order('cliente')),
        executeWithRetry<Produto[]>(() => supabase.from('produtos').select('*').order('produto')),
        executeWithRetry<any[]>(() => supabase.from('metas').select('*')),
        executeWithRetry<any[]>(() => supabase.from('agenda_visitas').select('*').order('semana', { ascending: true }).order('dia_semana', { ascending: true })),
        executeWithRetry<EstoqueCliente[]>(() => supabase.from('estoque_cliente').select('*')),
        executeWithRetry<any[]>(() => supabase.from('emprestimos').select('*')),
        executeWithRetry<any[]>(() => supabase.from('verba_flex_extrato').select('*').order('created_at', { ascending: false })),
        fetchHistVendasChunked(historyStart)
      ]);
      
      if (clientesRes.error) console.warn('[OfflineSync] Clientes query warning:', clientesRes.error);
      if (produtosRes.error) console.warn('[OfflineSync] Produtos query warning:', produtosRes.error);
      if (metasRes.error) console.warn('[OfflineSync] Metas query warning:', metasRes.error);
      if (visitasRes.error) console.warn('[OfflineSync] Visitas query warning:', visitasRes.error);
      if (histRes.error) console.warn('[OfflineSync] HistVendas query warning (falling back to cache):', histRes.error);
      if (estoqueRes.error) console.warn('[OfflineSync] Estoque query warning:', estoqueRes.error);
      if (emprestimosRes.error) console.warn('[OfflineSync] Emprestimos query warning:', emprestimosRes.error);
      if (flexRes.error) console.warn('[OfflineSync] Flex query warning:', flexRes.error);
      
      const dbClientes: Cliente[] = (clientesRes.data && clientesRes.data.length > 0) ? clientesRes.data : cachedClientes;
      const dbProdutos: Produto[] = (produtosRes.data && produtosRes.data.length > 0) ? produtosRes.data : cachedProdutos;
      
      const dbMetas: Record<string, number> = { ...cachedMetas };
      if (metasRes.data) {
        metasRes.data.forEach((m: any) => {
          dbMetas[m.cliente_id] = m.meta || 0;
        });
      }
      
      const dbVisitas = visitasRes.data || cachedVisitas;
      // Normalize legacy duplicate rows once, before any screen calculates totals.
      const rawHist = (histRes.data && histRes.data.length > 0) ? histRes.data : cachedHist;
      const dbHist = deduplicateSales(rawHist);
      const dbEstoque = estoqueRes.data || cachedEstoque;
      const dbLoans = emprestimosRes.data || cachedLoans;
      const dbFlex = flexRes.data || cachedFlex;
      
      const syncTime = syncStartedAt;
      
      // 3. Save to local cache. IndexedDB receives the full offline dataset.
      savePersistedBatch({
        offline_db_clientes: dbClientes,
        offline_db_produtos: dbProdutos,
        offline_db_metas: dbMetas,
        offline_db_agenda_visitas: dbVisitas,
        offline_db_hist_vendas: dbHist,
        offline_db_estoque_cliente: dbEstoque,
        offline_db_emprestimos: dbLoans,
        offline_db_verba_flex_extrato: dbFlex,
        offline_db_last_synced: syncTime,
        offline_db_last_full_synced: syncTime
      });
      
      // 4. Update memory states
      setClientes(dbClientes);
      setProdutos(dbProdutos);
      setMetas(dbMetas);
      setAgendaVisitas(dbVisitas);
      setHistVendas(dbHist);
      setEstoqueCliente(dbEstoque);
      setEmprestimos(dbLoans);
      setVerbaFlexExtrato(dbFlex);
      setLastSyncedTime(syncTime);
      
      // Calculate latest sales map
      const productWeights: Record<string, number> = {};
      dbProdutos.forEach(p => {
        productWeights[p.id] = p.peso_embalagem || 0;
      });
      
      const map: Record<string, { date: string; weight: number }> = {};
      if (dbHist.length > 0) {
        const uniqueSales = deduplicateSales(dbHist);
        uniqueSales.forEach(h => {
          const weight = (h.qtd || 0) * (productWeights[h.produto_id] || 0);
          if (!map[h.cliente_id] || map[h.cliente_id].date < h.faturamento) {
            map[h.cliente_id] = { date: h.faturamento, weight: weight };
          } else if (map[h.cliente_id].date === h.faturamento) {
            map[h.cliente_id].weight += weight;
          }
        });
      }
      setLatestSalesMap(map);
      
      return true;
    } catch (error: any) {
      const isNetworkError = error?.message?.includes('Failed to fetch') ||
        error?.name === 'TypeError' ||
        (typeof navigator !== 'undefined' && !navigator.onLine);
      if (isNetworkError) {
        console.warn('[OfflineSync] Sincronização completa adiada (dispositivo offline ou instabilidade de rede).');
      } else {
        console.error('[OfflineSync] Erro crítico ao sincronizar com o servidor:', error);
      }
      return false;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [flushOfflineQueue]);

  const syncChangedDataInternal = useCallback(async (): Promise<boolean> => {
    if (isSyncingRef.current || navigator.onLine === false) return false;
    const syncStartedAt = Date.now();
    isSyncingRef.current = true;
    setIsSyncing(true);

    try {
      const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      if (currentQueue.length > 0) await flushOfflineQueue(currentQueue);
      await ensureQuarterlyFlexReset(false);

      const lastSync = await loadPersisted<number>('offline_db_last_synced', 0);
      const lastFullSync = await loadPersisted<number>('offline_db_last_full_synced', 0);
      if (!lastSync || !lastFullSync || Date.now() - lastFullSync >= DAILY_SYNC_INTERVAL_MS) {
        isSyncingRef.current = false;
        setIsSyncing(false);
        return await syncAllDataInternal(false);
      }

      const since = new Date(lastSync).toISOString();
      const historyStart = '2024-01-01';

      const fetchChanges = async (table: string): Promise<{ rows: any[]; full: boolean }> => {
        if (table === 'hist_vendas') {
          // Check if importado_em exists
          const histIncremental = await executeWithRetry<any[]>(() =>
            supabase.from('hist_vendas').select('*').gt('importado_em', since)
          );
          if (!histIncremental.error && histIncremental.data) {
            return { rows: histIncremental.data, full: false };
          }
          // If importado_em failed or not supported, do chunked fetch with date filter
          const chunked = await fetchHistVendasChunked(historyStart);
          if (chunked.data && chunked.data.length > 0) {
            return { rows: chunked.data, full: true };
          }
          return { rows: [], full: false };
        }

        if (table === 'verba_flex_extrato' || table === 'emprestimos') {
          const createdIncremental = await executeWithRetry<any[]>(() =>
            supabase.from(table).select('*').gt('created_at', since)
          );
          if (!createdIncremental.error && createdIncremental.data) {
            return { rows: createdIncremental.data, full: false };
          }
        }

        const incremental = await executeWithRetry<any[]>(() =>
          supabase.from(table).select('*').gt('updated_at', since)
        );
        if (!incremental.error && incremental.data) {
          return { rows: incremental.data, full: false };
        }

        const missingUpdatedAt = incremental.error?.code === '42703'
          || incremental.error?.code === 'PGRST204'
          || incremental.error?.message?.includes('updated_at');

        if (missingUpdatedAt || incremental.error?.code === '57014') {
          // Fallback to full select for small tables
          const full = await executeWithRetry<any[]>(() => supabase.from(table).select('*'));
          if (!full.error && full.data) {
            return { rows: full.data, full: true };
          }
        }

        return { rows: [], full: false };
      };

      const [clientesRes, produtosRes, metasRes, visitasRes, histRes, estoqueRes, loansRes, flexRes] = await Promise.all([
        fetchChanges('clientes'),
        fetchChanges('produtos'),
        fetchChanges('metas'),
        fetchChanges('agenda_visitas'),
        fetchChanges('hist_vendas'),
        fetchChanges('estoque_cliente'),
        fetchChanges('emprestimos'),
        fetchChanges('verba_flex_extrato')
      ]);

      const [cachedClientes, cachedProdutos, cachedMetas, cachedVisitas, cachedHist, cachedEstoque, cachedLoans, cachedFlex] = await Promise.all([
        loadPersisted<Cliente[]>('offline_db_clientes', []),
        loadPersisted<Produto[]>('offline_db_produtos', []),
        loadPersisted<Record<string, number>>('offline_db_metas', {}),
        loadPersisted<any[]>('offline_db_agenda_visitas', []),
        loadPersisted<HistVenda[]>('offline_db_hist_vendas', []),
        loadPersisted<EstoqueCliente[]>('offline_db_estoque_cliente', []),
        loadPersisted<any[]>('offline_db_emprestimos', []),
        loadPersisted<any[]>('offline_db_verba_flex_extrato', [])
      ]);

      const mergeResult = <T,>(cached: T[], result: { rows: any[]; full: boolean }, key: (item: T) => string) =>
        result.full ? (result.rows.length > 0 ? result.rows as T[] : cached) : mergeByKey(cached, result.rows as T[], key);

      const dbClientes = mergeResult(cachedClientes, clientesRes, item => item.id);
      const dbProdutos = mergeResult(cachedProdutos, produtosRes, item => item.id);
      const dbVisitas = mergeResult(cachedVisitas, visitasRes, item => item.id);
      const dbHist = deduplicateSales(mergeResult(cachedHist, histRes, item => item.id || `${item.cliente_id}:${item.produto_id}:${item.faturamento}:${item.qtd}`));
      const dbEstoque = mergeResult(cachedEstoque, estoqueRes, item => `${item.cliente_id}:${item.produto_id}`);
      const dbLoans = mergeResult(cachedLoans, loansRes, item => item.id);
      const dbFlex = mergeResult(cachedFlex, flexRes, item => item.id);
      const dbMetas = metasRes.full ? (metasRes.rows.length > 0 ? {} as Record<string, number> : { ...cachedMetas }) : { ...cachedMetas };
      metasRes.rows.forEach((meta: any) => { dbMetas[meta.cliente_id] = meta.meta || 0; });

      const syncTime = syncStartedAt;
      savePersistedBatch({
        offline_db_clientes: dbClientes,
        offline_db_produtos: dbProdutos,
        offline_db_metas: dbMetas,
        offline_db_agenda_visitas: dbVisitas,
        offline_db_hist_vendas: dbHist,
        offline_db_estoque_cliente: dbEstoque,
        offline_db_emprestimos: dbLoans,
        offline_db_verba_flex_extrato: dbFlex,
        offline_db_last_synced: syncTime
      });

      setClientes(dbClientes);
      setProdutos(dbProdutos);
      setMetas(dbMetas);
      setAgendaVisitas(dbVisitas);
      setHistVendas(dbHist);
      setEstoqueCliente(dbEstoque);
      setEmprestimos(dbLoans);
      setVerbaFlexExtrato(dbFlex);
      setLastSyncedTime(syncTime);

      const productWeights = new Map(dbProdutos.map(product => [product.id, product.peso_embalagem || 0]));
      const latestMap: Record<string, { date: string; weight: number }> = {};
      dbHist.forEach(sale => {
        const weight = (sale.qtd || 0) * (productWeights.get(sale.produto_id) || 0);
        if (!latestMap[sale.cliente_id] || latestMap[sale.cliente_id].date < sale.faturamento) {
          latestMap[sale.cliente_id] = { date: sale.faturamento, weight };
        } else if (latestMap[sale.cliente_id].date === sale.faturamento) {
          latestMap[sale.cliente_id].weight += weight;
        }
      });
      setLatestSalesMap(latestMap);
      return true;
    } catch (error: any) {
      const isNetworkError = error?.message?.includes('Failed to fetch') ||
        error?.name === 'TypeError' ||
        (typeof navigator !== 'undefined' && !navigator.onLine);
      if (isNetworkError) {
        console.warn('[OfflineSync] Sincronização incremental adiada (dispositivo offline ou instabilidade de rede).');
      } else {
        console.error('[OfflineSync] Erro na sincronização incremental:', error);
      }
      return false;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [flushOfflineQueue, syncAllDataInternal]);

  // Public wrapper for full sync
  const syncAllData = useCallback(async (force = true) => {
    return syncAllDataInternal(force);
  }, [syncAllDataInternal]);

  // Load from localStorage immediately on App mount (Instant startup!)
  const loadInitialData = useCallback(async () => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    
    setLoadingGlobal(true);
    try {
      const cachedClientes = await loadPersisted<Cliente[]>('offline_db_clientes', []);
      const cachedProdutos = await loadPersisted<Produto[]>('offline_db_produtos', []);
      const cachedMetas = await loadPersisted<Record<string, number>>('offline_db_metas', {});
      const cachedVisitas = await loadPersisted<any[]>('offline_db_agenda_visitas', []);
      const cachedHist = await loadPersisted<HistVenda[]>('offline_db_hist_vendas', []);
      const cachedEstoque = await loadPersisted<EstoqueCliente[]>('offline_db_estoque_cliente', []);
      const cachedLoans = await loadPersisted<any[]>('offline_db_emprestimos', []);
      const cachedFlex = await loadPersisted<any[]>('offline_db_verba_flex_extrato', []);
      const cachedTime = await loadPersisted<number>('offline_db_last_synced', 0);
      const cachedFullSyncTime = await loadPersisted<number>('offline_db_last_full_synced', 0);
      const cachedQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      
      setClientes(cachedClientes);
      setProdutos(cachedProdutos);
      setMetas(cachedMetas);
      setAgendaVisitas(cachedVisitas);
      const uniqueCachedHist = deduplicateSales(cachedHist);
      setHistVendas(uniqueCachedHist);
      setEstoqueCliente(cachedEstoque);
      setEmprestimos(cachedLoans);
      setVerbaFlexExtrato(cachedFlex);
      setLastSyncedTime(cachedTime);
      setPendingQueue(cachedQueue);
      
      // Build sales map
      const productWeights: Record<string, number> = {};
      const actualProds = cachedProdutos.length > 0 ? cachedProdutos : MOCK_PRODUTOS;
      actualProds.forEach(p => {
        productWeights[p.id] = p.peso_embalagem || 0;
      });
      
      const map: Record<string, { date: string; weight: number }> = {};
      const actualHist = uniqueCachedHist.length > 0 ? uniqueCachedHist : deduplicateSales(MOCK_HISTORICO);
      const uniqueSales = actualHist;
      uniqueSales.forEach(h => {
        const weight = (h.qtd || 0) * (productWeights[h.produto_id] || 0);
        if (!map[h.cliente_id] || map[h.cliente_id].date < h.faturamento) {
          map[h.cliente_id] = { date: h.faturamento, weight: weight };
        } else if (map[h.cliente_id].date === h.faturamento) {
          map[h.cliente_id].weight += weight;
        }
      });
      setLatestSalesMap(map);
      
      // If we have some cache, we let the app render immediately!
      if (cachedClientes.length > 0) {
        setLoadingGlobal(false);
        // Flush queue in background if any pending items exist
        if (cachedQueue.length > 0) {
          flushOfflineQueue(cachedQueue);
        }
        const syncIsStale = !cachedFullSyncTime || Date.now() - cachedFullSyncTime >= DAILY_SYNC_INTERVAL_MS;
        if (syncIsStale && navigator.onLine !== false) {
          window.setTimeout(() => {
            syncAllDataInternal(false);
          }, 0);
        }
        return;
      }
      
      // If no cache, perform initial download sync
      console.log('[OfflineManager] No cached data found. Starting initial sync...');
      await syncAllDataInternal(false);
    } catch (e) {
      console.error('[OfflineManager] Error during initial hydration:', e);
      // fallback to mock data
      setClientes(MOCK_CLIENTES);
      setProdutos(MOCK_PRODUTOS);
      setHistVendas(deduplicateSales(MOCK_HISTORICO));
    } finally {
      setLoadingGlobal(false);
    }
  }, [syncAllDataInternal, flushOfflineQueue]);

  useEffect(() => {
    let idleTimer: number | undefined;
    let idleInterval: number | undefined;

    const stopIdleInterval = () => {
      if (idleInterval !== undefined) window.clearInterval(idleInterval);
      idleInterval = undefined;
    };

    const beginIdleSync = () => {
      syncChangedDataInternal();
      stopIdleInterval();
      idleInterval = window.setInterval(syncChangedDataInternal, IDLE_SYNC_INTERVAL_MS);
    };

    const registerActivity = () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      stopIdleInterval();
      idleTimer = window.setTimeout(beginIdleSync, IDLE_SYNC_INTERVAL_MS);
    };

    const syncWhenReturning = () => {
      if (document.visibilityState !== 'visible') return;
      const lastSync = loadLocal<number>('offline_db_last_synced', 0);
      if (!lastSync || Date.now() - lastSync >= IDLE_SYNC_INTERVAL_MS) syncChangedDataInternal();
      registerActivity();
    };

    const activityEvents: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    activityEvents.forEach(event => window.addEventListener(event, registerActivity, { passive: true }));
    window.addEventListener('online', syncWhenReturning);
    document.addEventListener('visibilitychange', syncWhenReturning);
    registerActivity();

    return () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      stopIdleInterval();
      activityEvents.forEach(event => window.removeEventListener(event, registerActivity));
      window.removeEventListener('online', syncWhenReturning);
      document.removeEventListener('visibilitychange', syncWhenReturning);
    };
  }, [syncChangedDataInternal]);

  const queueStockCountForRetry = useCallback(async (clienteId: string, items: any[]) => {
    const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
    const withoutOlderCount = currentQueue.filter(item =>
      item.action !== 'save_stock_count' || item.payload?.clienteId !== clienteId
    );
    const queuedItem: OfflineQueueItem = {
      id: `save_stock_count_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      action: 'save_stock_count',
      payload: { clienteId, items },
      timestamp: Date.now()
    };
    const updatedQueue = [...withoutOlderCount, queuedItem];
    setPendingQueue(updatedQueue);
    savePersisted('offline_db_pending_queue', updatedQueue);
  }, []);

  const mergeStockCountIntoCache = useCallback((clienteId: string, items: EstoqueCliente[]) => {
    setEstoqueCliente(prev => {
      const updated = mergeStockCountRecords(prev, clienteId, items);
      savePersisted('offline_db_estoque_cliente', updated);
      return updated;
    });
  }, []);

  // Offline-safe stock count write with server confirmation.
  const saveStockCount = useCallback(async (clienteId: string, items: any[]) => {
    const updatedStockItems = buildStockCountPayload(clienteId, items);

    const optimisticItems = updatedStockItems.map(item => ({
      ...item,
      id: `${item.cliente_id}:${item.produto_id}`
    })) as EstoqueCliente[];
    mergeStockCountIntoCache(clienteId, optimisticItems);

    if (navigator.onLine === false) {
      await queueStockCountForRetry(clienteId, updatedStockItems);
      return { status: 'queued' as const };
    }

    const { data, error } = await supabase
      .from('estoque_cliente')
      .upsert(updatedStockItems, { onConflict: 'cliente_id,produto_id' })
      .select('id,cliente_id,produto_id,quantidade_atual,ultima_contagem');

    if (error) {
      await queueStockCountForRetry(clienteId, updatedStockItems);
      return { status: 'queued' as const, error: error.message };
    }

    const allConfirmed = isStockCountFullyConfirmed(
      updatedStockItems,
      (data || []) as EstoqueCliente[]
    );

    if (!allConfirmed) {
      await queueStockCountForRetry(clienteId, updatedStockItems);
      return {
        status: 'queued' as const,
        error: 'O Supabase não confirmou todos os produtos enviados.'
      };
    }

    const confirmedItems = (data || []) as EstoqueCliente[];
    mergeStockCountIntoCache(clienteId, confirmedItems);

    const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
    const updatedQueue = currentQueue.filter(item =>
      item.action !== 'save_stock_count' || item.payload?.clienteId !== clienteId
    );
    setPendingQueue(updatedQueue);
    savePersisted('offline_db_pending_queue', updatedQueue);

    return { status: 'synced' as const };
  }, [mergeStockCountIntoCache, queueStockCountForRetry]);

  // Offline-Safe Write Wrapper: updateVisitaStatus
  const updateVisitaStatus = useCallback(async (visitaId: string, status: string) => {
    setAgendaVisitas(prev => {
      const updated = prev.map(v => v.id === visitaId ? { ...v, status, updated_at: new Date().toISOString() } : v);
      savePersisted('offline_db_agenda_visitas', updated);
      return updated;
    });
    
    await queueAction('update_visita_status', { id: visitaId, status });
    return true;
  }, [queueAction]);

  // Offline-Safe Write Wrapper: updateVisitaObservacoes
  const updateVisitaObservacoes = useCallback(async (visitaId: string, observacoes: string) => {
    setAgendaVisitas(prev => {
      const updated = prev.map(v => v.id === visitaId ? { ...v, observacoes, updated_at: new Date().toISOString() } : v);
      savePersisted('offline_db_agenda_visitas', updated);
      return updated;
    });
    
    await queueAction('update_visita_observacoes', { id: visitaId, observacoes });
    return true;
  }, [queueAction]);

  // Offline-Safe Write Wrapper: addLoan
  const addLoan = useCallback(async (loanData: any) => {
    const completeLoan = {
      id: loanData.id || `loan_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      cliente_origem_id: loanData.cliente_origem_id,
      cliente_destino_id: loanData.cliente_destino_id,
      produto_id: loanData.produto_id,
      quantidade: parseFloat(loanData.quantidade),
      data_emprestimo: loanData.data_emprestimo,
      status: 'pendente',
      cliente_origem_nome: loanData.cliente_origem_nome || 'N/A',
      cliente_destino_nome: loanData.cliente_destino_nome || 'N/A',
      produto_nome: loanData.produto_nome || 'N/A'
    };
    
    setEmprestimos(prev => {
      const updated = [...prev, completeLoan];
      savePersisted('offline_db_emprestimos', updated);
      return updated;
    });
    
    await queueAction('add_loan', {
      cliente_origem_id: loanData.cliente_origem_id,
      cliente_destino_id: loanData.cliente_destino_id,
      produto_id: loanData.produto_id,
      quantidade: parseFloat(loanData.quantidade),
      data_emprestimo: loanData.data_emprestimo,
      status: 'pendente'
    });
    return true;
  }, [queueAction]);

  // Offline-Safe Write Wrapper: updateLoanStatus
  const updateLoanStatus = useCallback(async (loanId: string, status: string, devDate: string | null) => {
    setEmprestimos(prev => {
      const updated = prev.map(l => l.id === loanId ? { ...l, status, data_devolucao: devDate } : l);
      savePersisted('offline_db_emprestimos', updated);
      return updated;
    });
    
    await queueAction('update_loan_status', { id: loanId, status, data_devolucao: devDate });
    return true;
  }, [queueAction]);

  // Offline-Safe Write Wrapper: deleteLoan
  const deleteLoan = useCallback(async (loanId: string) => {
    setEmprestimos(prev => {
      const updated = prev.filter(l => l.id !== loanId);
      savePersisted('offline_db_emprestimos', updated);
      return updated;
    });
    
    await queueAction('delete_loan', { id: loanId });
    return true;
  }, [queueAction]);

  const queueOpenOrderForRetry = useCallback(async (action: 'save_open_order' | 'delete_open_order', payload: any) => {
    const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
    const targetClienteId = payload.cliente_id || payload.clienteId;
    const filteredQueue = currentQueue.filter(item =>
      !( (item.action === 'save_open_order' || item.action === 'delete_open_order') &&
         (item.payload?.cliente_id === targetClienteId || item.payload?.clienteId === targetClienteId) )
    );
    const queuedItem: OfflineQueueItem = {
      id: `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      action,
      payload,
      timestamp: Date.now()
    };
    const updatedQueue = [...filteredQueue, queuedItem];
    setPendingQueue(updatedQueue);
    savePersisted('offline_db_pending_queue', updatedQueue);
  }, []);

  // Offline-Safe Write Wrapper: saveOpenOrder
  const saveOpenOrder = useCallback(async (payload: {
    cliente_id: string;
    items: any[];
    prazo?: string | null;
    obs?: string | null;
    manual_faixa?: string | null;
    desconto_extra?: number;
    started_at?: string | null;
    updated_at?: string | null;
  }) => {
    const rawData = {
      items: payload.items,
      prazo: payload.prazo,
      obs: payload.obs,
      manualFaixa: payload.manual_faixa,
      startedAt: payload.started_at || new Date().toISOString(),
      updatedAt: payload.updated_at || new Date().toISOString()
    };
    localStorage.setItem(`pedido_${payload.cliente_id}`, JSON.stringify(rawData));

    if (navigator.onLine === false) {
      await queueOpenOrderForRetry('save_open_order', payload);
      return { status: 'queued' as const };
    }

    try {
      const { error } = await supabase
        .from('pedidos_em_aberto')
        .upsert({
          cliente_id: payload.cliente_id,
          items: payload.items,
          prazo: payload.prazo || null,
          obs: payload.obs || null,
          manual_faixa: payload.manual_faixa || null,
          desconto_extra: payload.desconto_extra || 0,
          started_at: payload.started_at || new Date().toISOString(),
          updated_at: payload.updated_at || new Date().toISOString()
        }, { onConflict: 'cliente_id' });

      if (error) {
        console.warn('[DataManager] saveOpenOrder error, queuing for retry:', error);
        await queueOpenOrderForRetry('save_open_order', payload);
        return { status: 'queued' as const, error: error.message };
      }

      const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      const updatedQueue = currentQueue.filter(item =>
        !( (item.action === 'save_open_order' || item.action === 'delete_open_order') &&
           (item.payload?.cliente_id === payload.cliente_id || item.payload?.clienteId === payload.cliente_id) )
      );
      setPendingQueue(updatedQueue);
      savePersisted('offline_db_pending_queue', updatedQueue);

      return { status: 'synced' as const };
    } catch (e: any) {
      console.warn('[DataManager] saveOpenOrder exception, queuing for retry:', e);
      await queueOpenOrderForRetry('save_open_order', payload);
      return { status: 'queued' as const, error: e?.message };
    }
  }, [queueOpenOrderForRetry]);

  // Offline-Safe Write Wrapper: deleteOpenOrder
  const deleteOpenOrder = useCallback(async (clienteId: string) => {
    localStorage.removeItem(`pedido_${clienteId}`);

    if (navigator.onLine === false) {
      await queueOpenOrderForRetry('delete_open_order', { cliente_id: clienteId });
      return { status: 'queued' as const };
    }

    try {
      const { error } = await supabase
        .from('pedidos_em_aberto')
        .delete()
        .eq('cliente_id', clienteId);

      if (error) {
        console.warn('[DataManager] deleteOpenOrder error, queuing for retry:', error);
        await queueOpenOrderForRetry('delete_open_order', { cliente_id: clienteId });
        return { status: 'queued' as const, error: error.message };
      }

      const currentQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      const updatedQueue = currentQueue.filter(item =>
        !( (item.action === 'save_open_order' || item.action === 'delete_open_order') &&
           (item.payload?.cliente_id === clienteId || item.payload?.clienteId === clienteId) )
      );
      setPendingQueue(updatedQueue);
      savePersisted('offline_db_pending_queue', updatedQueue);

      return { status: 'synced' as const };
    } catch (e: any) {
      console.warn('[DataManager] deleteOpenOrder exception, queuing for retry:', e);
      await queueOpenOrderForRetry('delete_open_order', { cliente_id: clienteId });
      return { status: 'queued' as const, error: e?.message };
    }
  }, [queueOpenOrderForRetry]);

  // Transactional Order Editor (ATOMIC)
  const updateOrderSales = useCallback(async (params: UpdateOrderSalesParams): Promise<{ success: boolean; error?: string }> => {
    try {
      let rpcSuccess = false;

      // 1. TENTATIVA 1: RPC PostgreSQL Transacional (Tudo ou Nada)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc('editar_pedido_venda_transacional', {
          p_pedido_id: params.pedidoId,
          p_cliente_id_origem: String(params.clienteOriginalId),
          p_cliente_id_destino: String(params.novoClienteId),
          p_cliente_nome_destino: params.novoClienteNome,
          p_nova_data: params.novaData,
          p_itens_atualizados: params.itensAtualizados.map(i => ({
            id: String(i.id),
            produto_id: String(i.produto_id),
            produtos: i.produtos,
            qtd: Number(i.qtd),
            r_total: Number(i["r$_total"]),
            vendas: i.vendas || 'VENDA',
            tabela: i.tabela || 'TABELA PADRAO',
            xdt: Number(i.xdt || 0),
            acresc_val: Number(i["acresc."] || 0)
          })),
          p_itens_novos: params.itensNovos.map(n => ({
            produto_id: String(n.produto_id),
            produtos: n.produtos,
            qtd: Number(n.qtd),
            r_total: Number(n["r$_total"]),
            vendas: n.vendas || 'VENDA',
            tabela: n.tabela || 'TABELA PADRAO',
            xdt: Number(n.xdt || 0),
            acresc_val: Number(n["acresc."] || 0),
            numero_pedido_erp: n.numero_pedido_erp || null
          })),
          p_itens_removidos_ids: params.itensRemovidosIds.map(id => String(id))
        });

        if (rpcError) {
          console.warn('[DataManager] RPC editar_pedido_venda_transacional retornou erro, acionando fallback seguro:', rpcError.message);
          rpcSuccess = false;
        } else {
          rpcSuccess = true;
          console.log('[DataManager] Pedido editado com sucesso via RPC PostgreSQL transacional:', rpcData);
        }
      } catch (rpcErr: any) {
        console.warn('[DataManager] Exceção ao chamar RPC editar_pedido_venda_transacional, acionando fallback:', rpcErr);
        rpcSuccess = false;
      }

      // 2. TENTATIVA 2: FALLBACK ATÔMICO COM ROLLBACK POR APLICAÇÃO
      if (!rpcSuccess) {
        // Snapshot dos registros originais antes da mutação para garantir rollback completo em caso de falha
        const originalRows = histVendas.filter(h => 
          (h.pedido_id && h.pedido_id === params.pedidoId) || 
          params.itensAtualizados.some(i => String(i.id) === String(h.id)) ||
          params.itensRemovidosIds.some(remId => String(remId) === String(h.id))
        );

        const createdNewIds: string[] = [];
        let canUsePedidoId = true;

        try {
          // A. Excluir itens removidos
          if (params.itensRemovidosIds.length > 0) {
            const { error: delError } = await supabase
              .from('hist_vendas')
              .delete()
              .in('id', params.itensRemovidosIds);
            if (delError) throw delError;
          }

          // B. Atualizar itens existentes modificados
          for (const item of params.itensAtualizados) {
            const buildPayload = (includePedidoId: boolean) => {
              const payload: Record<string, any> = {
                cliente_id: params.novoClienteId,
                cliente: params.novoClienteNome,
                faturamento: params.novaData,
                produto_id: item.produto_id,
                produtos: item.produtos,
                qtd: Number(item.qtd),
                "r$_total": Number(item["r$_total"])
              };
              if (includePedidoId && canUsePedidoId && params.pedidoId) {
                payload.pedido_id = params.pedidoId;
              }
              if (item.vendas) payload.vendas = item.vendas;
              if (item.tabela) payload.tabela = item.tabela;
              if (item.xdt !== undefined) payload.xdt = Number(item.xdt);
              if (item["acresc."] !== undefined) payload["acresc."] = Number(item["acresc."]);
              return payload;
            };

            let { error: updError } = await supabase
              .from('hist_vendas')
              .update(buildPayload(true))
              .eq('id', item.id);

            // Caso o PostgREST schema cache ainda não tenha registrado pedido_id (PGRST204)
            if (updError && (updError.code === 'PGRST204' || updError.message?.includes('pedido_id'))) {
              canUsePedidoId = false;
              const retryResult = await supabase
                .from('hist_vendas')
                .update(buildPayload(false))
                .eq('id', item.id);
              updError = retryResult.error;
            }

            if (updError) throw updError;
          }

          // C. Atualizar cliente e data para outras linhas remanescentes do mesmo pedido_id
          if (canUsePedidoId && params.pedidoId) {
            const { error: syncRemainingError } = await supabase
              .from('hist_vendas')
              .update({
                pedido_id: params.pedidoId,
                cliente_id: params.novoClienteId,
                cliente: params.novoClienteNome,
                faturamento: params.novaData
              })
              .eq('pedido_id', params.pedidoId);
            
            if (syncRemainingError && syncRemainingError.code !== 'PGRST204') {
              console.warn('[DataManager] Erro ao sincronizar linhas remanescentes por pedido_id:', syncRemainingError.message);
            }
          }

          // D. Inserir novos itens
          if (params.itensNovos.length > 0) {
            const buildInsertList = (includePedidoId: boolean) => params.itensNovos.map(n => {
              const itemObj: Record<string, any> = {
                cliente_id: params.novoClienteId,
                cliente: params.novoClienteNome,
                faturamento: params.novaData,
                produto_id: n.produto_id,
                produtos: n.produtos,
                qtd: Number(n.qtd),
                "r$_total": Number(n["r$_total"]),
                vendas: n.vendas || 'VENDA',
                tabela: n.tabela || 'TABELA PADRAO',
                xdt: Number(n.xdt || 0),
                "acresc.": Number(n["acresc."] || 0),
                numero_pedido_erp: n.numero_pedido_erp || null,
                importado_em: new Date().toISOString()
              };
              if (includePedidoId && canUsePedidoId && params.pedidoId) {
                itemObj.pedido_id = params.pedidoId;
              }
              return itemObj;
            });

            let { data: insData, error: insError } = await supabase
              .from('hist_vendas')
              .insert(buildInsertList(true))
              .select('id');

            if (insError && (insError.code === 'PGRST204' || insError.message?.includes('pedido_id'))) {
              canUsePedidoId = false;
              const retryIns = await supabase
                .from('hist_vendas')
                .insert(buildInsertList(false))
                .select('id');
              insData = retryIns.data;
              insError = retryIns.error;
            }

            if (insError) throw insError;
            if (insData) {
              insData.forEach(d => createdNewIds.push(d.id));
            }
          }
        } catch (fallbackError: any) {
          console.error('[DataManager] Falha no fallback de edição de pedido. Executando Rollback Transacional:', fallbackError);
          // Rollback: deleta os novos criados e restaura o snapshot original
          if (createdNewIds.length > 0) {
            try {
              await supabase.from('hist_vendas').delete().in('id', createdNewIds);
            } catch (e) {
              console.error('Rollback delete error:', e);
            }
          }
          if (originalRows.length > 0) {
            try {
              await supabase.from('hist_vendas').upsert(originalRows);
            } catch (e) {
              console.error('Rollback upsert error:', e);
            }
          }
          throw fallbackError;
        }
      }

      // 3. SINCRONIZAÇÃO ATÔMICA DO ESTADO LOCAL E CACHE
      let freshOrderRows: HistVenda[] = [];
      try {
        if (params.pedidoId) {
          const { data: refreshed, error: fetchErr } = await supabase
            .from('hist_vendas')
            .select('*')
            .eq('pedido_id', params.pedidoId);

          if (!fetchErr && refreshed && refreshed.length > 0) {
            freshOrderRows = refreshed as HistVenda[];
          }
        }
      } catch {
        // Ignora erro de consulta por pedido_id e utiliza síntese local
      }

      if (freshOrderRows.length === 0) {
        // Síntese local para manter reatividade imediata mesmo se houver latência de rede
        const updatedMap = new Map(params.itensAtualizados.map(i => [String(i.id), i]));
        const removedSet = new Set(params.itensRemovidosIds.map(String));

        const retained = histVendas
          .filter(h => !removedSet.has(String(h.id)))
          .map(h => {
            const upd = updatedMap.get(String(h.id));
            if (upd) {
              return {
                ...h,
                pedido_id: params.pedidoId,
                cliente_id: params.novoClienteId,
                cliente: params.novoClienteNome,
                faturamento: params.novaData,
                produto_id: upd.produto_id,
                produtos: upd.produtos,
                qtd: Number(upd.qtd),
                "r$_total": Number(upd["r$_total"]),
                ...(upd.vendas ? { vendas: upd.vendas } : {}),
                ...(upd.tabela ? { tabela: upd.tabela } : {}),
                ...(upd.xdt !== undefined ? { xdt: Number(upd.xdt) } : {}),
                ...(upd["acresc."] !== undefined ? { "acresc.": Number(upd["acresc."]) } : {})
              };
            }
            if (h.pedido_id && h.pedido_id === params.pedidoId) {
              return {
                ...h,
                cliente_id: params.novoClienteId,
                cliente: params.novoClienteNome,
                faturamento: params.novaData
              };
            }
            return h;
          });

        const syntheticNew: HistVenda[] = params.itensNovos.map((n, idx) => ({
          id: `new-${Date.now()}-${idx}`,
          pedido_id: params.pedidoId,
          cliente_id: params.novoClienteId,
          cliente: params.novoClienteNome,
          faturamento: params.novaData,
          produto_id: n.produto_id,
          produtos: n.produtos,
          qtd: Number(n.qtd),
          "r$_total": Number(n["r$_total"]),
          vendas: n.vendas || 'VENDA',
          tabela: n.tabela || 'TABELA PADRAO',
          xdt: Number(n.xdt || 0),
          "acresc.": Number(n["acresc."] || 0),
          numero_pedido_erp: n.numero_pedido_erp,
          importado_em: new Date().toISOString()
        }));

        freshOrderRows = [
          ...retained.filter(h => 
            (h.pedido_id && h.pedido_id === params.pedidoId) ||
            params.itensAtualizados.some(i => String(i.id) === String(h.id))
          ), 
          ...syntheticNew
        ];
      }

      // Atualizar o array de histVendas no estado da aplicação
      setHistVendas(prev => {
        const removedSet = new Set(params.itensRemovidosIds.map(String));
        const updatedIdsSet = new Set(params.itensAtualizados.map(i => String(i.id)));
        const freshIdsSet = new Set(freshOrderRows.map(f => String(f.id)));
        
        // Remove as linhas antigas deste pedido, os removidos, os modificados e os recém inseridos
        const cleanList = prev.filter(h => 
          (!params.pedidoId || h.pedido_id !== params.pedidoId) && 
          !removedSet.has(String(h.id)) &&
          !updatedIdsSet.has(String(h.id)) &&
          !freshIdsSet.has(String(h.id))
        );

        const nextHist = [...cleanList, ...freshOrderRows];
        savePersisted('offline_db_hist_vendas', nextHist);
        return nextHist;
      });

      return { success: true };
    } catch (err: any) {
      console.error('[DataManager] Erro ao editar pedido de venda:', err);
      return { success: false, error: err.message || 'Falha ao atualizar pedido' };
    }
  }, [histVendas]);

  // Client Details compatibility lookup
  const clientCache = useMemo(() => {
    const historicoByClient: Record<string, HistVenda[]> = {};
    const estoqueByClient: Record<string, EstoqueCliente[]> = {};

    histVendas.forEach(h => {
      if (!h.cliente_id) return;
      if (!historicoByClient[h.cliente_id]) historicoByClient[h.cliente_id] = [];
      historicoByClient[h.cliente_id].push(h);
    });

    estoqueCliente.forEach(e => {
      if (!e.cliente_id) return;
      if (!estoqueByClient[e.cliente_id]) estoqueByClient[e.cliente_id] = [];
      estoqueByClient[e.cliente_id].push(e);
    });

    const cache: Record<string, ClientCache> = {};
    clientes.forEach(c => {
      cache[c.id] = {
        historico: historicoByClient[c.id] || [],
        estoque: estoqueByClient[c.id] || [],
        lastUpdated: Date.now()
      };
    });
    return cache;
  }, [clientes, histVendas, estoqueCliente]);

  const loadClientDetails = useCallback(async (clientId: string, forceRefresh = false) => {
    const filteredHist = histVendas.filter(h => h.cliente_id === clientId);
    const filteredEstoque = estoqueCliente.filter(e => e.cliente_id === clientId);
    
    return {
      historico: filteredHist,
      estoque: filteredEstoque,
      lastUpdated: Date.now()
    };
  }, [histVendas, estoqueCliente]);

  const prefetchClientData = useCallback((clientId: string) => {
    // Already loaded in memory, nothing to do
  }, []);

  const loadLatestSalesMap = useCallback(async (forceRefresh = false) => {
    if (forceRefresh && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
      try {
        const cutoff = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10);
        const today = new Date().toISOString().slice(0, 10);
        const { data, error } = await supabase
          .from('hist_vendas')
          .select('cliente_id, faturamento, qtd, produto_id')
          .gte('faturamento', cutoff)
          .lte('faturamento', today)
          .order('faturamento', { ascending: false });

        if (!error && data) {
          const productWeights = new Map(produtos.map(product => [
            product.id,
            product.peso_embalagem || 0
          ]));
          const recentMap: Record<string, { date: string; weight: number }> = {};

          data.forEach(sale => {
            if (!sale.cliente_id) return;
            const weight = (sale.qtd || 0) * (productWeights.get(sale.produto_id) || 0);
            if (!recentMap[sale.cliente_id] || recentMap[sale.cliente_id].date < sale.faturamento) {
              recentMap[sale.cliente_id] = { date: sale.faturamento, weight };
            } else if (recentMap[sale.cliente_id].date === sale.faturamento) {
              recentMap[sale.cliente_id].weight += weight;
            }
          });

          const olderSalesMap = Object.fromEntries(
            Object.entries(latestSalesMap).filter(([, sale]) => sale.date < cutoff)
          );
          const refreshedMap = { ...olderSalesMap, ...recentMap };
          const currentKeys = Object.keys(latestSalesMap);
          const refreshedKeys = Object.keys(refreshedMap);
          const mapChanged = currentKeys.length !== refreshedKeys.length
            || refreshedKeys.some(clientId => {
              const current = latestSalesMap[clientId];
              const refreshed = refreshedMap[clientId];
              return !current
                || current.date !== refreshed.date
                || current.weight !== refreshed.weight;
            });

          if (mapChanged) setLatestSalesMap(refreshedMap);
          return mapChanged ? refreshedMap : latestSalesMap;
        }

        if (error) {
          const isNetworkError = error?.message?.includes('Failed to fetch') ||
            error?.name === 'TypeError' ||
            (typeof navigator !== 'undefined' && !navigator.onLine);
          if (isNetworkError) {
            console.warn('[OfflineManager] Atualização de últimas compras adiada (offline/instabilidade de rede).');
          } else {
            console.error('[OfflineManager] Erro ao atualizar últimas compras:', error);
          }
        }
      } catch (error: any) {
        const isNetworkError = error?.message?.includes('Failed to fetch') ||
          error?.name === 'TypeError' ||
          (typeof navigator !== 'undefined' && !navigator.onLine);
        if (isNetworkError) {
          console.warn('[OfflineManager] Atualização de últimas compras adiada (offline/instabilidade de rede).');
        } else {
          console.error('[OfflineManager] Erro ao atualizar últimas compras:', error);
        }
      }
    }

    return latestSalesMap;
  }, [latestSalesMap, produtos]);

  const refreshClientes = useCallback(async () => {
    await syncAllDataInternal(true);
  }, [syncAllDataInternal]);

  const refreshProdutos = useCallback(async () => {
    await syncAllDataInternal(true);
  }, [syncAllDataInternal]);

  return (
    <DataManagerContext.Provider value={{
      clientes,
      produtos,
      metas,
      agenda_visitas: agendaVisitas,
      hist_vendas: histVendas,
      estoque_cliente: estoqueCliente,
      emprestimos,
      verba_flex_extrato: verbaFlexExtrato,
      latestSalesMap,
      clientCache,
      
      loadingGlobal,
      isSyncing,
      lastSyncedTime,
      pendingQueueCount,
      
      loadInitialData,
      syncAllData,
      
      saveStockCount,
      updateOrderSales,
      updateVisitaStatus,
      updateVisitaObservacoes,
      addLoan,
      updateLoanStatus,
      deleteLoan,
      saveOpenOrder,
      deleteOpenOrder,
      
      loadClientDetails,
      prefetchClientData,
      loadLatestSalesMap,
      refreshClientes,
      refreshProdutos
    }}>
      {children}
    </DataManagerContext.Provider>
  );
}

export function useDataManager() {
  const context = useContext(DataManagerContext);
  if (context === undefined) {
    throw new Error('useDataManager must be used within a DataManagerProvider');
  }
  return context;
}
