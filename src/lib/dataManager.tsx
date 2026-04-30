import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { Cliente, Produto, HistVenda, EstoqueCliente } from '../types';

interface ClientCache {
  historico: HistVenda[];
  estoque: EstoqueCliente[];
  lastUpdated: number;
}

interface DataManagerContextType {
  clientes: Cliente[];
  produtos: Produto[];
  clientCache: Record<string, ClientCache>;
  loadingGlobal: boolean;
  
  loadInitialData: () => Promise<void>;
  loadClientDetails: (clientId: string, forceRefresh?: boolean) => Promise<void>;
  prefetchClientData: (clientId: string) => void;
  
  refreshClientes: () => Promise<void>;
  refreshProdutos: () => Promise<void>;
}

const DataManagerContext = createContext<DataManagerContextType | undefined>(undefined);

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export function DataManagerProvider({ children }: { children: React.ReactNode }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientCache, setClientCache] = useState<Record<string, ClientCache>>({});
  const [loadingGlobal, setLoadingGlobal] = useState(false);
  
  const initialLoadStarted = useRef(false);

  const loadInitialData = useCallback(async () => {
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    
    const startTime = performance.now();
    setLoadingGlobal(true);
    try {
      const [clientesRes, produtosRes] = await Promise.all([
        supabase.from('clientes').select('*').order('cliente'),
        supabase.from('produtos').select('*').order('produto')
      ]);

      if (clientesRes.data) setClientes(clientesRes.data);
      if (produtosRes.data) setProdutos(produtosRes.data);
      
      const endTime = performance.now();
      console.log(`[Performance] Initial data load: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error('Error loading initial data:', error);
    } finally {
      setLoadingGlobal(false);
    }
  }, []);

  const loadClientDetails = useCallback(async (clientId: string, forceRefresh = false) => {
    const cached = clientCache[clientId];
    const now = Date.now();
    
    if (!forceRefresh && cached && (now - cached.lastUpdated < CACHE_TTL)) {
      console.log(`[Performance] Serving client ${clientId} from cache`);
      return;
    }

    const startTime = performance.now();
    try {
      const [histRes, estRes] = await Promise.all([
        supabase.from('hist_vendas').select('*').eq('cliente_id', clientId).order('faturamento', { ascending: false }),
        supabase.from('estoque_cliente').select('*').eq('cliente_id', clientId)
      ]);

      // Deduplicate history
      const uniqueMap = new Map();
      (histRes.data || []).forEach((h: HistVenda) => {
        const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
        if (!uniqueMap.has(key)) uniqueMap.set(key, h);
      });
      const uniqueHist = Array.from(uniqueMap.values()) as HistVenda[];

      setClientCache(prev => ({
        ...prev,
        [clientId]: {
          historico: uniqueHist,
          estoque: estRes.data || [],
          lastUpdated: now
        }
      }));

      const endTime = performance.now();
      console.log(`[Performance] Client ${clientId} data load: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error) {
      console.error(`Error loading details for client ${clientId}:`, error);
    }
  }, [clientCache]);

  const prefetchTimeout = useRef<Record<string, any>>({});

  const prefetchClientData = useCallback((clientId: string) => {
    if (clientCache[clientId]) return;
    
    // Debounce prefetch
    if (prefetchTimeout.current[clientId]) return;
    
    prefetchTimeout.current[clientId] = setTimeout(() => {
      loadClientDetails(clientId);
      delete prefetchTimeout.current[clientId];
    }, 200);
  }, [clientCache, loadClientDetails]);

  const refreshClientes = useCallback(async () => {
    const { data } = await supabase.from('clientes').select('*').order('cliente');
    if (data) setClientes(data);
  }, []);

  const refreshProdutos = useCallback(async () => {
    const { data } = await supabase.from('produtos').select('*').order('produto');
    if (data) setProdutos(data);
  }, []);

  return (
    <DataManagerContext.Provider value={{
      clientes,
      produtos,
      clientCache,
      loadingGlobal,
      loadInitialData,
      loadClientDetails,
      prefetchClientData,
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
