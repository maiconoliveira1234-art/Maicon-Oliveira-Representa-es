import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { Cliente, Produto, HistVenda, EstoqueCliente } from '../types';
import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from './mockData';

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
  loadClientDetails: (clientId: string, forceRefresh?: boolean) => Promise<ClientCache | undefined>;
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
  const inFlightRequests = useRef<Record<string, Promise<ClientCache | undefined>>>({});

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

      if (clientesRes.error) {
        throw new Error(`Supabase clientes fetch error: ${clientesRes.error.message} (code ${clientesRes.error.code})`);
      }
      if (produtosRes.error) {
        throw new Error(`Supabase produtos fetch error: ${produtosRes.error.message} (code ${produtosRes.error.code})`);
      }

      setClientes(clientesRes.data || MOCK_CLIENTES);
      setProdutos(produtosRes.data || MOCK_PRODUTOS);
      
      const endTime = performance.now();
      console.log(`[Performance] Initial data load: ${(endTime - startTime).toFixed(2)}ms`);
    } catch (error: any) {
      console.error('CRITICAL NAVIGATION / DATA RECOVERY ERROR: Failed to load initial data from Supabase. Falling back to structured mock data to prevent application hydration freeze.', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      });
      setClientes(MOCK_CLIENTES);
      setProdutos(MOCK_PRODUTOS);
    } finally {
      setLoadingGlobal(false);
    }
  }, []);

  const loadClientDetails = useCallback(async (clientId: string, forceRefresh = false): Promise<ClientCache | undefined> => {
    // If there is already an active request in flight for this client, reuse its Promise
    if (!forceRefresh && inFlightRequests.current[clientId]) {
      console.log(`[Performance] Reusing active in-flight request for client ${clientId}`);
      return inFlightRequests.current[clientId];
    }

    const cached = clientCache[clientId];
    const now = Date.now();
    
    if (!forceRefresh && cached && (now - cached.lastUpdated < CACHE_TTL)) {
      console.log(`[Performance] Serving client ${clientId} from cache`);
      return cached;
    }

    const fetchPromise = (async (): Promise<ClientCache | undefined> => {
      const startTime = performance.now();
      try {
        const [histRes, estRes] = await Promise.all([
          supabase.from('hist_vendas').select('*').eq('cliente_id', clientId).order('faturamento', { ascending: false }),
          supabase.from('estoque_cliente').select('*').eq('cliente_id', clientId)
        ]);

        if (histRes.error) {
          throw new Error(`Hist_vendas fetch error: ${histRes.error.message} (code ${histRes.error.code})`);
        }
        if (estRes.error) {
          throw new Error(`Estoque_cliente fetch error: ${estRes.error.message} (code ${estRes.error.code})`);
        }

        // Deduplicate history
        const uniqueMap = new Map();
        (histRes.data || []).forEach((h: HistVenda) => {
          const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, h);
        });
        const uniqueHist = Array.from(uniqueMap.values()) as HistVenda[];

        const newData = {
          historico: uniqueHist,
          estoque: estRes.data || [],
          lastUpdated: Date.now()
        };

        setClientCache(prev => ({
          ...prev,
          [clientId]: newData
        }));

        const endTime = performance.now();
        console.log(`[Performance] Client ${clientId} data load: ${(endTime - startTime).toFixed(2)}ms`);
        return newData;
      } catch (error: any) {
        console.error(`CRITICAL SESSION / REFRESH DETAILS ERROR: Failed to load history/stock details for client ${clientId} from Supabase. Falling back to local offline structured fallback transactions and empty stock to prevent page whiteout.`, {
          message: error?.message,
          name: error?.name,
          stack: error?.stack
        });
        
        // Return structured mock transactions for the given client as fallback
        const mockHist = MOCK_HISTORICO.filter(h => h.cliente_id === clientId);
        const newData = {
          historico: mockHist,
          estoque: [],
          lastUpdated: Date.now()
        };
        
        setClientCache(prev => ({
          ...prev,
          [clientId]: newData
        }));
        
        return newData;
      } finally {
        // Clean up the index so subsequent calls can trigger a new fetch if needed (e.g. if the cache TTL expires)
        delete inFlightRequests.current[clientId];
      }
    })();

    if (!forceRefresh) {
      inFlightRequests.current[clientId] = fetchPromise;
    }

    return fetchPromise;
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
