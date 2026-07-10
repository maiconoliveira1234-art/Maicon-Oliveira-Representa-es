import React, { createContext, useContext, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { supabase } from './supabase';
import { Cliente, Produto, HistVenda, EstoqueCliente } from '../types';
import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from './mockData';
import { deduplicateSales } from './utils';
import { getCacheValue, setCacheValue, setCacheValues } from './offline';

export interface OfflineQueueItem {
  id: string;
  action: 'save_stock_count' | 'update_visita_status' | 'update_visita_observacoes' | 'add_loan' | 'update_loan_status' | 'delete_loan';
  payload: any;
  timestamp: number;
}

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
  saveStockCount: (clienteId: string, items: any[]) => Promise<boolean>;
  updateVisitaStatus: (visitaId: string, status: string) => Promise<boolean>;
  updateVisitaObservacoes: (visitaId: string, observacoes: string) => Promise<boolean>;
  addLoan: (loanData: any) => Promise<boolean>;
  updateLoanStatus: (loanId: string, status: string, devDate: string | null) => Promise<boolean>;
  deleteLoan: (loanId: string) => Promise<boolean>;
  
  // Compatibility methods
  loadClientDetails: (clientId: string, forceRefresh?: boolean) => Promise<ClientCache | undefined>;
  prefetchClientData: (clientId: string) => void;
  loadLatestSalesMap: (forceRefresh?: boolean) => Promise<Record<string, { date: string; weight: number }>>;
  
  refreshClientes: () => Promise<void>;
  refreshProdutos: () => Promise<void>;
}

const DataManagerContext = createContext<DataManagerContextType | undefined>(undefined);
const DAILY_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
          const { error } = await supabase
            .from('estoque_cliente')
            .upsert(items, { onConflict: 'cliente_id,produto_id' });
            
          if (error) {
            for (const stockItem of items) {
              await supabase.from('estoque_cliente').delete().eq('cliente_id', stockItem.cliente_id).eq('produto_id', stockItem.produto_id);
              await supabase.from('estoque_cliente').insert(stockItem);
            }
          }
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
      
      // Keep the analytical history used by dashboard, commissions and goals available offline.
      const historyStart = '2024-01-01';

      // 2. Fetch all tables from Supabase in parallel
      const [
        clientesRes,
        produtosRes,
        metasRes,
        visitasRes,
        histRes,
        estoqueRes,
        emprestimosRes,
        flexRes
      ] = await Promise.all([
        supabase.from('clientes').select('*').order('cliente'),
        supabase.from('produtos').select('*').order('produto'),
        supabase.from('metas').select('*'),
        supabase.from('agenda_visitas').select('*').order('semana', { ascending: true }).order('dia_semana', { ascending: true }),
        supabase.from('hist_vendas').select('*').gte('faturamento', historyStart).order('faturamento', { ascending: false }),
        supabase.from('estoque_cliente').select('*'),
        supabase.from('emprestimos').select('*'),
        supabase.from('verba_flex_extrato').select('*').order('created_at', { ascending: false })
      ]);
      
      if (clientesRes.error) throw clientesRes.error;
      if (produtosRes.error) throw produtosRes.error;
      if (metasRes.error) throw metasRes.error;
      if (visitasRes.error) throw visitasRes.error;
      if (histRes.error) throw histRes.error;
      if (estoqueRes.error) throw estoqueRes.error;
      if (emprestimosRes.error) throw emprestimosRes.error;
      if (flexRes.error) throw flexRes.error;
      
      const dbClientes = clientesRes.data || [];
      const dbProdutos = produtosRes.data || [];
      
      const dbMetas: Record<string, number> = {};
      (metasRes.data || []).forEach(m => {
        dbMetas[m.cliente_id] = m.meta || 0;
      });
      
      const dbVisitas = visitasRes.data || [];
      const dbHist = histRes.data || [];
      const dbEstoque = estoqueRes.data || [];
      const dbLoans = emprestimosRes.data || [];
      const dbFlex = flexRes.data || [];
      
      const syncTime = Date.now();
      
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
        offline_db_last_synced: syncTime
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
          if (!map[h.cliente_id]) {
            map[h.cliente_id] = { date: h.faturamento, weight: weight };
          } else if (map[h.cliente_id].date === h.faturamento) {
            map[h.cliente_id].weight += weight;
          }
        });
      }
      setLatestSalesMap(map);
      
      return true;
    } catch (error) {
      console.error('[OfflineSync] Erro crítico ao sincronizar com o servidor:', error);
      return false;
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [flushOfflineQueue]);

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
      const cachedQueue = await loadPersisted<OfflineQueueItem[]>('offline_db_pending_queue', []);
      
      setClientes(cachedClientes);
      setProdutos(cachedProdutos);
      setMetas(cachedMetas);
      setAgendaVisitas(cachedVisitas);
      setHistVendas(cachedHist);
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
      const actualHist = cachedHist.length > 0 ? cachedHist : MOCK_HISTORICO;
      const uniqueSales = deduplicateSales(actualHist);
      uniqueSales.forEach(h => {
        const weight = (h.qtd || 0) * (productWeights[h.produto_id] || 0);
        if (!map[h.cliente_id]) {
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
        const syncIsStale = !cachedTime || Date.now() - cachedTime >= DAILY_SYNC_INTERVAL_MS;
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
      setHistVendas(MOCK_HISTORICO);
    } finally {
      setLoadingGlobal(false);
    }
  }, [syncAllDataInternal, flushOfflineQueue]);

  // Offline-Safe Write Wrapper: saveStockCount
  const saveStockCount = useCallback(async (clienteId: string, items: any[]) => {
    const updatedStockItems = items.map(item => ({
      id: item.id || `${clienteId}_${item.produto_id}`,
      cliente_id: clienteId,
      produto_id: item.produto_id,
      quantidade_atual: item.quantidade_atual,
      ultima_contagem: item.ultima_contagem || new Date().toISOString().split('T')[0]
    }));

    // Update in-memory state instantly
    setEstoqueCliente(prev => {
      const otherClients = prev.filter(e => e.cliente_id !== clienteId);
      const updated = [...otherClients, ...updatedStockItems];
      savePersisted('offline_db_estoque_cliente', updated);
      return updated;
    });
    
    // Add to offline queue
    await queueAction('save_stock_count', { clienteId, items: updatedStockItems });
    return true;
  }, [queueAction]);

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

  // Client Details compatibility lookup
  const clientCache = useMemo(() => {
    const cache: Record<string, ClientCache> = {};
    clientes.forEach(c => {
      cache[c.id] = {
        historico: histVendas.filter(h => h.cliente_id === c.id),
        estoque: estoqueCliente.filter(e => e.cliente_id === c.id),
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
    return latestSalesMap;
  }, [latestSalesMap]);

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
      updateVisitaStatus,
      updateVisitaObservacoes,
      addLoan,
      updateLoanStatus,
      deleteLoan,
      
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
