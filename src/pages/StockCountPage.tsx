import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, 
  Save, 
  Search, 
  Plus, 
  Minus,
  Package,
  Calendar,
  TrendingDown,
  ShoppingCart,
  Download,
  X,
  FileText,
  Trash2,
  Home
} from 'lucide-react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Cliente, Produto, EstoqueCliente, HistVenda } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight, formatCurrency } from '../lib/utils';
import { classifySaleRecord } from '../lib/salesClassifier';
import { differenceInDays, parseISO, format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { FAMILY_PRIORITY_ORDER } from '../constants';
import { DIAGNOSTICS } from '../lib/diagnostics';

const DEBUG_STOCK = DIAGNOSTICS.DEBUG_STOCK; // Centralized flag for stock counting screen

interface ItemEstoqueData {
  produto_id: string;
  produto_nome: string;
  dias_ult_compra: number;
  qtd_ult_compra: number;
  quantidade_atual: number;
  ultima_contagem_valor: number;
  media_qtd: number;
  media_ciclo: number;
  tendencia: number;
  peso: number;
  peso_unitario: number;
  estoque_ideal: number;
  raw_estoque_ideal: number;
  ativo: boolean;
  quant_embalagem: number;
  familia: string;
}

import { useDataManager } from '../lib/dataManager';
import { StockCountSkeleton } from '../components/ui/Skeleton';

export function StockCountPage() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { produtos, clientCache, loadClientDetails, saveStockCount } = useDataManager();
  
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [estoqueMap, setEstoqueMap] = useState<Record<string, number>>({});
  const [pedidoMap, setPedidoMap] = useState<Record<string, number>>({});
  const [nonVendaItems, setNonVendaItems] = useState<Array<{ produto_id: string, quantidade: number, tipo_operacao: 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('Todas');
  const [selectedWeight, setSelectedWeight] = useState('Todos');
  const [showInactive, setShowInactive] = useState(false);
  const [viewMode, setViewMode] = useState<'contagem' | 'pedido'>('contagem');
  const [selectedProductHistory, setSelectedProductHistory] = useState<ItemEstoqueData | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [touchedItems, setTouchedItems] = useState<Set<string>>(new Set());
  const [countedGraceItems, setCountedGraceItems] = useState<Set<string>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const countedGraceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  
  // Derived state to avoid duplication, race conditions, or state-overwriting
  const cacheData = useMemo(() => {
    return clienteId ? clientCache[clienteId] : undefined;
  }, [clientCache, clienteId]);

  const historico = useMemo(() => {
    return cacheData?.historico || [];
  }, [cacheData]);

  const ultimaContagemMap = useMemo(() => {
    const uMap: Record<string, number> = {};
    if (cacheData?.estoque) {
      cacheData.estoque.forEach(e => {
        uMap[e.produto_id] = e.quantidade_atual;
      });
    }
    return uMap;
  }, [cacheData]);

  const produtosMap = useMemo(() => {
    const pMap: Record<string, Produto> = {};
    produtos.forEach(p => {
      pMap[p.id] = p;
    });
    return pMap;
  }, [produtos]);

  const familyPriorityMap = useMemo(() => {
    const map: Record<string, number> = {};
    FAMILY_PRIORITY_ORDER.forEach((family, index) => {
      map[family] = index;
    });
    return map;
  }, []);

  const [errorCount, setErrorCount] = useState(0);

  // Load essential client data and load clientCache from Supabase backend
  useEffect(() => {
    let active = true;
    
    async function loadData() {
      if (!clienteId) return;
      
      const loadStartTime = performance.now();
      if (DEBUG_STOCK) {
        console.log(`[DEBUG_STOCK] Início do carregamento da tela de contagem para o cliente ID: ${clienteId}`);
      }
      
      try {
        setLoading(true);
        if (DEBUG_STOCK) {
          console.log(`[DEBUG_STOCK] Etapa 1 - Solicitando dados de cache para o cliente ${clienteId} (Tentativa: ${errorCount + 1})`);
        }
        
        // This will retrieve the client details. If it's a retry (errorCount > 0), we force refresh.
        const cacheStartTime = performance.now();
        const cache = await loadClientDetails(clienteId, errorCount > 0);
        if (!active) return;

        if (DEBUG_STOCK) {
          console.log(`[DEBUG_STOCK] Etapa 1 concluída em ${(performance.now() - cacheStartTime).toFixed(2)}ms. Registros no cache -> Histórico: ${cache?.historico?.length || 0} itens, Estoque Anterior: ${cache?.estoque?.length || 0} itens.`);
        }
        
        // Validate if the cache object is completely missing
        if (!cache) {
          throw new Error("Os dados de cache de histórico e estoque estão indefinidos.");
        }

        if (DEBUG_STOCK) {
          console.log(`[DEBUG_STOCK] Etapa 2 - Buscando detalhes do cliente no banco de dados`);
        }

        // Fetch Cliente Details from table
        const clientQueryStartTime = performance.now();
        const { data: clienteData, error: clientErr } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', clienteId)
          .single();
        
        if (clientErr) {
          throw new Error(`Erro ao buscar detalhes do cliente: ${clientErr.message}`);
        }
        
        if (!active) return;
        
        if (clienteData) {
          setCliente(clienteData);
          if (DEBUG_STOCK) {
            console.log(`[DEBUG_STOCK] Etapa 2 concluída em ${(performance.now() - clientQueryStartTime).toFixed(2)}ms. Cliente carregado: ${clienteData.cliente}`);
          }
        }

        if (DEBUG_STOCK) {
          console.log(`[DEBUG_STOCK] Carregamento de dados concluído com sucesso em ${(performance.now() - loadStartTime).toFixed(2)}ms.`);
        }

        setLoading(false);
      } catch (err: any) {
        console.error(`[CONTAGEM] Erro detectado ao carregar dados do cliente:`, err.message || err);
        if (active) {
          if (errorCount < 3) {
            console.log(`[CONTAGEM] Tentando recarregar e forçar atualização em 2 segundos... (Tentativa ${errorCount + 1}/3)`);
            setTimeout(() => {
              if (active) {
                setErrorCount(prev => prev + 1);
              }
            }, 2000);
          } else {
            setLoading(false);
          }
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [clienteId, errorCount, loadClientDetails]);

  // Safe lazy state map initialization from cacheData + localStorage once cache becomes available
  const lastInitializedClientId = useRef<string | null>(null);

  useEffect(() => {
    if (!clienteId || !cacheData) return;
    
    // Only initialize once per client ID to prevent overwriting user edits on hot reloads/render cycles
    if (lastInitializedClientId.current === clienteId) return;
    
    console.log(`[CONTAGEM] Inicializando mapas de estado para o cliente: ${clienteId}`);

    let initialEstoque: Record<string, number> = {};

    // A local draft is authoritative. This keeps a cleared count empty when the
    // user leaves and returns, instead of reloading the previous stock count.
    const savedEstoque = localStorage.getItem(`estoque_${clienteId}`);
    if (savedEstoque !== null) {
      try {
        const parsed = JSON.parse(savedEstoque);
        initialEstoque = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        console.log(`[CONTAGEM] Estoque restaurado do rascunho local para cliente: ${clienteId}`);
      } catch (e) {
        console.error('Erro ao fazer parse do estoque salvo no localStorage:', e);
        cacheData.estoque.forEach(e => {
          initialEstoque[e.produto_id] = e.quantidade_atual;
        });
      }
    } else {
      cacheData.estoque.forEach(e => {
        initialEstoque[e.produto_id] = e.quantidade_atual;
      });
    }
    setEstoqueMap(initialEstoque);

    // Initializing pedidoMap
    const pMap: Record<string, number> = {};
    const nonVenda: Array<{ produto_id: string, quantidade: number, tipo_operacao: 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' }> = [];
    
    const savedPedido = localStorage.getItem(`pedido_${clienteId}`);
    if (savedPedido) {
      try {
        const parsed = JSON.parse(savedPedido);
        if (parsed && typeof parsed === 'object' && 'items' in parsed) {
          if (Array.isArray(parsed.items)) {
            parsed.items.forEach((item: any) => {
              if (item && item.produto_id) {
                const type = item.tipo_operacao || 'VENDA';
                if (type === 'VENDA') {
                  pMap[item.produto_id] = item.quantidade || 0;
                } else {
                  nonVenda.push({
                    produto_id: item.produto_id,
                    quantidade: item.quantidade || 0,
                    tipo_operacao: type as 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING'
                  });
                }
              }
            });
          }
        }
      } catch (e) {
        console.error('Erro ao fazer parse do pedido do localStorage:', e);
      }
    }
    setPedidoMap(pMap);
    setNonVendaItems(nonVenda);

    supabase
      .from('pedidos_em_aberto')
      .select('items, prazo, obs, manual_faixa, started_at')
      .eq('cliente_id', clienteId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data || !Array.isArray(data.items)) return;

        const dbPedidoMap: Record<string, number> = {};
        const dbNonVenda = new Map<string, { produto_id: string, quantidade: number, tipo_operacao: 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' }>();

        data.items.forEach((item: any) => {
          if (!item?.produto_id) return;

          const type = item.tipo_operacao || 'VENDA';
          if (type === 'VENDA') {
            dbPedidoMap[item.produto_id] = item.quantidade || 0;
          } else {
            dbNonVenda.set(item.produto_id + '_' + type, {
              produto_id: item.produto_id,
              quantidade: item.quantidade || 0,
              tipo_operacao: type as 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING'
            });
          }
        });

        setPedidoMap(prev => ({ ...dbPedidoMap, ...prev }));
        setNonVendaItems(prev => {
          const merged = new Map(dbNonVenda);
          prev.forEach(item => merged.set(item.produto_id + '_' + item.tipo_operacao, item));
          return Array.from(merged.values());
        });

        const saved = localStorage.getItem(`pedido_${clienteId}`);
        let localDraft: any = {};
        if (saved) {
          try {
            localDraft = JSON.parse(saved);
          } catch (e) {}
        }

        const mergedItems = [
          ...data.items.filter((item: any) => item?.tipo_operacao !== 'VENDA' && item?.tipo_operacao),
          ...Object.entries({ ...dbPedidoMap, ...pMap })
            .filter(([, quantidade]) => Number(quantidade) > 0)
            .map(([produto_id, quantidade]) => ({
              produto_id,
              quantidade,
              tipo_operacao: 'VENDA'
            }))
        ];

        localStorage.setItem(`pedido_${clienteId}`, JSON.stringify({
          ...localDraft,
          prazo: localDraft.prazo ?? data.prazo ?? '',
          obs: localDraft.obs ?? data.obs ?? '',
          manualFaixa: localDraft.manualFaixa ?? data.manual_faixa ?? null,
          startedAt: localDraft.startedAt ?? data.started_at ?? null,
          items: mergedItems
        }));
      });

    lastInitializedClientId.current = clienteId;
    setIsReady(true);
  }, [clienteId, cacheData]);

  const mediaCicloGlobal = useMemo(() => {
    if (historico.length === 0) return 40;
    const dates = Array.from(new Set(historico.map(h => parseISO(h.faturamento).getTime()))).sort((a, b) => (a as number) - (b as number));
    if (dates.length === 0) return 40;
    
    const oldestDate = dates[0] as number;
    const spanDias = Math.max(1, differenceInDays(new Date(), oldestDate));
    const numPurchases = dates.length;
    
    // Logic: (Today - First Purchase) / Number of Purchases
    return Math.round(spanDias / numPurchases);
  }, [historico]);

  const gridCols = useMemo(() => {
    if (viewMode === 'contagem') {
      return "grid-cols-[minmax(0,1fr)_38px_38px_42px_96px_38px]";
    }

    return "grid-cols-[minmax(0,1fr)_38px_38px_42px_38px_96px]";
  }, [viewMode]);

  const orderWeightByDay = useMemo(() => {
    const map: Record<string, number> = {};
    historico.forEach(h => {
      const date = h.faturamento;
      const prod = produtosMap[h.produto_id];
      if (prod) {
        const weight = h.qtd * (prod.peso_embalagem || 0);
        map[date] = (map[date] || 0) + weight;
      }
    });
    return map;
  }, [historico, produtosMap]);

  const lastOrderDate = useMemo(() => {
    if (historico.length === 0) return null;
    const sortedDates = [...new Set(historico.map(h => h.faturamento))].sort((a: string, b: string) => 
      parseISO(b).getTime() - parseISO(a).getTime()
    );
    return sortedDates[0];
  }, [historico]);

  const processedItems = useMemo(() => {
    const startTime = performance.now();
    const items: Record<string, HistVenda[]> = {};
    
    if (DEBUG_STOCK) {
      console.log(`[DEBUG_STOCK] Processando itens: Histórico de entrada = ${historico.length} registros`);
    }

    historico.forEach(h => {
      if (!classifySaleRecord(h).influenciaConsumo) return;
      if (!items[h.produto_id]) items[h.produto_id] = [];
      items[h.produto_id].push(h);
    });

    if (DEBUG_STOCK) {
      console.log(`[DEBUG_STOCK] Itens agrupados por produto_id = ${Object.keys(items).length}`);
    }

    const result: ItemEstoqueData[] = Object.entries(items)
      .map(([produtoId, vendas]) => {
        const sortedVendas = [...vendas].sort((a, b) => 
          parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime()
        );
        
        const ultVenda = sortedVendas[0];
        const oldestVenda = sortedVendas[sortedVendas.length - 1];
        const diasUltCompra = differenceInDays(new Date(), parseISO(ultVenda.faturamento));
        
        // Calculate average qty
        const totalQtd = vendas.reduce((acc, v) => acc + v.qtd, 0);
        const mediaQtd = totalQtd / vendas.length;
        
        // Calculate average cycle: (Today - First Purchase) / Number of Purchases
        const spanDias = Math.max(1, differenceInDays(new Date(), parseISO(oldestVenda.faturamento)));
        const uniqueDates = [...new Set(vendas.map(v => parseISO(v.faturamento).getTime()))];
        const numPurchases = uniqueDates.length;
        
        let mediaCiclo = Math.round(spanDias / numPurchases);
        
        // Ensure no 0 cycle
        if (mediaCiclo === 0) mediaCiclo = Math.max(30, diasUltCompra);

        const produto = produtosMap[produtoId];
        const quantEmbalagem = produto?.quant_embalagem || 1;
        const consumoDiario = totalQtd / spanDias;
        
        // Ideal Stock Calculation: (Total Qty / Days since first purchase) * mediaCiclo
        // We use the full mediaCiclo for ideal stock to ensure we have enough for one full cycle
        const rawEstoqueIdeal = Math.ceil(consumoDiario * mediaCiclo * quantEmbalagem);
        const currentStock = estoqueMap[produtoId] || 0;
        const estoqueIdeal = Math.max(0, rawEstoqueIdeal - currentStock);

        // Tendencia (Column T in image) - Simplified logic: how many cycles passed
        const tendencia = mediaCiclo > 0 ? Math.floor(diasUltCompra / mediaCiclo) * -1 : 0;

        // Get quantity in units of that item's own last purchase by the client
        const lastPurchaseItems = sortedVendas.filter(v => v.faturamento === ultVenda.faturamento);
        const qtdUltCompraInfo = lastPurchaseItems.reduce((acc, v) => acc + v.qtd, 0) * quantEmbalagem;
        const ultimaContagemValor = ultimaContagemMap[produtoId] || 0;
        const isProdutoAtivo = produto?.ativo !== false;
        const ativoParaContagem = isProdutoAtivo
          ? (diasUltCompra <= 365 || ultimaContagemValor > 0)
          : (ultimaContagemValor !== 0);

        return {
          produto_id: produtoId,
          produto_nome: ultVenda.produtos,
          dias_ult_compra: diasUltCompra,
          qtd_ult_compra: qtdUltCompraInfo,
          quantidade_atual: currentStock,
          ultima_contagem_valor: ultimaContagemValor,
          media_qtd: Math.round(mediaQtd * quantEmbalagem),
          media_ciclo: mediaCiclo,
          tendencia,
          peso: produto?.peso_embalagem || 0,
          peso_unitario: (produto?.peso_embalagem || 0) / (produto?.quant_embalagem || 1),
          estoque_ideal: estoqueIdeal,
          raw_estoque_ideal: rawEstoqueIdeal,
          ativo: ativoParaContagem,
          quant_embalagem: quantEmbalagem,
          familia: produto?.familia || 'Sem Família'
        };
      })
      .filter((item): item is ItemEstoqueData => item !== null);

    const filteredResult = result.filter(item => showInactive || item.ativo);

    if (DEBUG_STOCK) {
      console.log(`[DEBUG_STOCK] Processamento concluído em ${(performance.now() - startTime).toFixed(2)}ms. Total mapeado: ${result.length}, Total ativos/filtrados por showInactive: ${filteredResult.length}`);
      if (filteredResult.length === 0 && result.length > 0) {
        console.warn(`[DEBUG_STOCK] ALERTA: Todos os ${result.length} produtos mapeados foram filtrados porque estão marcados como inativos (dias_ult_compra > 365)! Habilite o filtro de "Inativos" ou verifique os limites de datas.`);
      }
    }

    // Sort: Family Priority and then Alphabetical
    return filteredResult
      .sort((a, b) => {
        const priorityA = familyPriorityMap[a.familia] ?? 999;
        const priorityB = familyPriorityMap[b.familia] ?? 999;
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        
        return a.produto_nome.localeCompare(b.produto_nome);
      });
  }, [historico, estoqueMap, ultimaContagemMap, produtosMap, showInactive, lastOrderDate, familyPriorityMap]);

  const diasDesdeUltimoPedidoGlobal = useMemo(() => {
    if (historico.length === 0) return 0;
    return differenceInDays(new Date(), parseISO(historico[0].faturamento));
  }, [historico]);

  const families = useMemo(() => {
    let list = processedItems;
    if (selectedWeight !== 'Todos') {
      const targetWeight = Number(selectedWeight);
      list = list.filter(item => Math.abs(item.peso_unitario - targetWeight) < 0.001);
    }
    const unique = Array.from(new Set(list.map(item => item.familia)));
    const sortedUnique = (unique as string[]).sort((a, b) => a.localeCompare(b));
    return ['Todas', 'Não Contados', ...sortedUnique];
  }, [processedItems, selectedWeight]);

  const weights = useMemo(() => {
    let list = processedItems;
    if (selectedFamily !== 'Todas' && selectedFamily !== 'Não Contados') {
      list = list.filter(item => item.familia === selectedFamily);
    }
    const unique = Array.from(new Set(list.map(item => Number(item.peso_unitario.toFixed(3))))) as number[];
    return ['Todos', ...unique.filter(w => w > 0).sort((a, b) => a - b)];
  }, [processedItems, selectedFamily]);

  // Handle cross-filter validation
  useEffect(() => {
    if (selectedFamily !== 'Todas' && selectedFamily !== 'Não Contados' && !families.includes(selectedFamily)) {
      setSelectedFamily('Todas');
    }
  }, [families, selectedFamily]);

  useEffect(() => {
    if (selectedWeight !== 'Todos' && !weights.includes(Number(Number(selectedWeight).toFixed(3)) as any)) {
      setSelectedWeight('Todos');
    }
  }, [weights, selectedWeight]);

  useEffect(() => {
    return () => {
      Object.values(countedGraceTimers.current).forEach(clearTimeout);
    };
  }, []);

  const updateQuantity = (produtoId: string, val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val) : val;
    setEstoqueMap(prev => ({
      ...prev,
      [produtoId]: isNaN(num) ? 0 : Math.max(0, num)
    }));
    setTouchedItems(prev => new Set(prev).add(produtoId));

    if (selectedFamily === 'Não Contados') {
      if (countedGraceTimers.current[produtoId]) {
        clearTimeout(countedGraceTimers.current[produtoId]);
      }

      setCountedGraceItems(prev => new Set(prev).add(produtoId));
      countedGraceTimers.current[produtoId] = setTimeout(() => {
        setCountedGraceItems(prev => {
          const next = new Set(prev);
          next.delete(produtoId);
          return next;
        });
        delete countedGraceTimers.current[produtoId];
      }, 5000);
    }
  };

  const updatePedido = (produtoId: string, val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val) : val;
    setPedidoMap(prev => ({
      ...prev,
      [produtoId]: isNaN(num) ? 0 : Math.max(0, num)
    }));
  };

  const totalPesoPedido = useMemo(() => {
    return processedItems.reduce((acc, item) => {
      const extra = pedidoMap[item.produto_id] || 0;
      return acc + (extra * item.peso);
    }, 0);
  }, [processedItems, pedidoMap]);

  const buildPedidoItemsList = () => {
    const itemsList: Array<{ produto_id: string, quantidade: number, tipo_operacao: string }> = [];

    Object.entries(pedidoMap).forEach(([prodId, qty]) => {
      const q = qty as number;
      if (q > 0) {
        itemsList.push({
          produto_id: prodId,
          quantidade: q,
          tipo_operacao: 'VENDA'
        });
      }
    });

    nonVendaItems.forEach(item => {
      if (item.quantidade > 0) {
        itemsList.push({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          tipo_operacao: item.tipo_operacao
        });
      }
    });

    return itemsList;
  };

  const savePedidoDraft = async (itemsList: Array<{ produto_id: string, quantidade: number, tipo_operacao: string }>) => {
    if (!clienteId) return;

    const saved = localStorage.getItem(`pedido_${clienteId}`);
    let dataToSave = { items: itemsList, prazo: '', obs: '', manualFaixa: null as string | null, startedAt: null as string | null };

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          dataToSave = { ...dataToSave, ...parsed, items: itemsList };
        }
      } catch (e) {
        console.error('Error parsing saved storage:', e);
      }
    }

    localStorage.setItem(`pedido_${clienteId}`, JSON.stringify(dataToSave));

    if (itemsList.length === 0) {
      await supabase.from('pedidos_em_aberto').delete().eq('cliente_id', clienteId);
      return;
    }

    const { error } = await supabase
      .from('pedidos_em_aberto')
      .upsert({
        cliente_id: clienteId,
        items: itemsList,
        prazo: dataToSave.prazo || null,
        obs: dataToSave.obs || null,
        manual_faixa: dataToSave.manualFaixa || null,
        desconto_extra: 0,
        started_at: dataToSave.startedAt || new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'cliente_id' });

    if (error) {
      console.error('Erro ao salvar pedido aberto pela contagem:', error);
    }
  };

  // Persist state to localStorage to survive navigation
  useEffect(() => {
    if (isReady && clienteId) {
      localStorage.setItem(`estoque_${clienteId}`, JSON.stringify(estoqueMap));
    }
  }, [estoqueMap, clienteId, isReady]);

  useEffect(() => {
    if (isReady && clienteId) {
      const itemsList = buildPedidoItemsList();
      const hasSavedDraft = Boolean(localStorage.getItem(`pedido_${clienteId}`));

      if (itemsList.length > 0 || hasSavedDraft) {
        savePedidoDraft(itemsList);
      }
    }
  }, [pedidoMap, nonVendaItems, clienteId, isReady]);

  const handleClearAll = () => {
    setShowClearConfirm(true);
  };

  const confirmClearAll = () => {
    setEstoqueMap({});
    setPedidoMap({});
    setNonVendaItems([]);
    setTouchedItems(new Set());
    setShowClearConfirm(false);
    if (clienteId) {
      localStorage.setItem(`estoque_${clienteId}`, JSON.stringify({}));
      localStorage.removeItem(`pedido_${clienteId}`);
      supabase.from('pedidos_em_aberto').delete().eq('cliente_id', clienteId).then(({ error }) => {
        if (error) console.error('Erro ao limpar pedido aberto pela contagem:', error);
      });
    }
  };

  const handleSave = async () => {
    if (!clienteId) return;
    setSaving(true);

    try {
      const touchedProductIds = new Set(touchedItems);
      const itemsToUpsert = processedItems
        .filter(item => touchedProductIds.has(item.produto_id))
        .map(item => ({
          cliente_id: clienteId,
          produto_id: item.produto_id,
          quantidade_atual: estoqueMap[item.produto_id] || 0,
          ultima_contagem: new Date().toISOString().split('T')[0]
        }));

      if (itemsToUpsert.length === 0) {
        alert('Nenhuma contagem alterada para salvar.');
        setSaving(false);
        return;
      }

      // Use the offline-safe central save wrapper!
      await saveStockCount(clienteId, itemsToUpsert);

      // Clear local stock draft after successful save
      localStorage.removeItem(`estoque_${clienteId}`);

      // Force cache update in global dataManager so subsequent page visits reflect the new stock count immediately
      await loadClientDetails(clienteId, true);

      alert('Estoque atualizado com sucesso!');
      navigate(`/cliente/${clienteId}`);
    } catch (err) {
      console.error('Erro ao salvar estoque:', err);
      alert('Erro ao salvar estoque.');
    } finally {
      setSaving(false);
    }
  };

  const handleGoToPedido = async () => {
    const itemsList = buildPedidoItemsList();
    await savePedidoDraft(itemsList);

    navigate(`/pedido/novo/${clienteId}`);
  };
  const handleExportPDF = async () => {
    if (!exportRef.current) return;
    
    try {
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      const pages = exportRef.current?.querySelectorAll('.pdf-page');
      if (!pages || pages.length === 0) return;

      for (let i = 0; i < pages.length; i++) {
        const page = pages[i] as HTMLElement;
        const canvas = await html2canvas(page, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 800
        });
        
        const imgData = canvas.toDataURL('image/jpeg', 0.85);
        
        if (i > 0) pdf.addPage();
        
        // A4 is 210mm x 297mm
        const imgWidth = 210;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        
        pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      }

      const pdfBlob = pdf.output('blob');
      const fileName = `contagem-${cliente?.cliente || 'cliente'}-${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`;
      const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

      // sharing logic
      const shareData = {
        files: [file],
        title: 'CONTAGEM ESTOQUE',
        text: `Contagem de estoque - ${cliente?.cliente}`
      };

      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
        } catch (shareErr) {
          if ((shareErr as Error).name !== 'AbortError') {
            pdf.save(fileName);
          }
        }
      } else {
        pdf.save(fileName);
      }
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao exportar PDF.');
    }
  };

  const filteredItems = useMemo(() => {
    const startTime = performance.now();
    let result = processedItems;

    if (DEBUG_STOCK) {
      console.log(`[DEBUG_STOCK] Aplicando filtros na tela. Entrada = ${processedItems.length} itens`);
    }

    if (searchTerm.trim()) {
      const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter(item => {
        const productName = item.produto_nome.toLowerCase();
        return searchWords.every(word => productName.includes(word));
      });
      if (DEBUG_STOCK) {
        console.log(`[DEBUG_STOCK] Após filtro de busca ("${searchTerm}"): ${result.length} itens`);
      }
    }

    if (selectedFamily !== 'Todas') {
      if (selectedFamily === 'Não Contados') {
        result = result.filter(item =>
          estoqueMap[item.produto_id] === undefined ||
          estoqueMap[item.produto_id] === null ||
          countedGraceItems.has(item.produto_id)
        );
      } else {
        result = result.filter(item => item.familia === selectedFamily);
      }
      if (DEBUG_STOCK) {
        console.log(`[DEBUG_STOCK] Após filtro de família ("${selectedFamily}"): ${result.length} itens`);
      }
    }

    if (selectedWeight !== 'Todos') {
      const targetWeight = Number(selectedWeight);
      result = result.filter(item => Math.abs(item.peso_unitario - targetWeight) < 0.001);
      if (DEBUG_STOCK) {
        console.log(`[DEBUG_STOCK] Após filtro de peso ("${selectedWeight}"): ${result.length} itens`);
      }
    }

    if (DEBUG_STOCK) {
      console.log(`[DEBUG_STOCK] Filtros aplicados em ${(performance.now() - startTime).toFixed(2)}ms. Entregando ${result.length} itens para renderização.`);
    }

    console.log(`[CONTAGEM] Total de itens recebidos: ${processedItems.length} | Filtros aplicados - busca: "${searchTerm}", família: "${selectedFamily}", peso: "${selectedWeight}" | Total exibido na tela: ${result.length}`);

    return result;
  }, [processedItems, searchTerm, selectedFamily, selectedWeight, estoqueMap, countedGraceItems]);

  // Auto-enable inactive display if all loaded products are inactive
  useEffect(() => {
    if (isReady && processedItems.length > 0) {
      const hasActive = processedItems.some(item => item.ativo);
      if (!hasActive && !showInactive) {
        console.log("[CONTAGEM] Nenhum produto ativo encontrado. Ativando exibição de inativos automaticamente.");
        setShowInactive(true);
      }
    }
  }, [isReady, processedItems, showInactive]);

  // Audit logs for client verification as requested
  useEffect(() => {
    if (!clienteId || !cliente || !isReady) return;
    
    const clientName = cliente?.cliente || 'Carregando...';
    const totalProducts = produtos.length;
    const totalHist = historico.length;
    const totalEstoque = cacheData?.estoque?.length || 0;
    const baseListCount = processedItems.length;
    const activeFilterCount = processedItems.filter(item => item.ativo).length;
    const inactiveFilterCount = processedItems.length; // showInactive includes all base list items
    
    // Search filter count
    const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    const afterSearchCount = processedItems.filter(item => {
      if (!searchTerm.trim()) return true;
      const productName = item.produto_nome.toLowerCase();
      return searchWords.every(word => productName.includes(word));
    }).length;

    // Category filter count
    const afterCategoryCount = processedItems.filter(item => {
      if (selectedFamily === 'Todas') return true;
      if (selectedFamily === 'Não Contados') {
        return estoqueMap[item.produto_id] === undefined ||
          estoqueMap[item.produto_id] === null ||
          countedGraceItems.has(item.produto_id);
      }
      return item.familia === selectedFamily;
    }).length;

    // Weight filter count
    const afterWeightCount = processedItems.filter(item => {
      if (selectedWeight === 'Todos') return true;
      return Math.abs(item.peso_unitario - Number(selectedWeight)) < 0.001;
    }).length;

    const finalCount = filteredItems.length;

    console.log(`=== AUDITORIA DE CONTAGEM DE ESTOQUE ===`);
    console.log(`1. clienteId recebido pela tela: ${clienteId}`);
    console.log(`2. Nome do cliente carregado: ${clientName}`);
    console.log(`3. Quantidade de produtos carregados da tabela de produtos: ${totalProducts}`);
    console.log(`4. Quantidade de registros em hist_vendas: ${totalHist}`);
    console.log(`5. Quantidade de registros em estoque_cliente: ${totalEstoque}`);
    console.log(`6. Quantidade de produtos após montar a lista base: ${baseListCount}`);
    console.log(`7. Quantidade após aplicar filtro de ativos: ${activeFilterCount}`);
    console.log(`8. Quantidade após aplicar filtro de inativos: ${inactiveFilterCount}`);
    console.log(`9. Quantidade após aplicar filtro de busca: ${afterSearchCount}`);
    console.log(`10. Quantidade após aplicar filtro de categoria: ${afterCategoryCount}`);
    console.log(`11. Quantidade após aplicar filtro de peso: ${afterWeightCount}`);
    console.log(`12. Quantidade final entregue para renderização: ${finalCount}`);
    console.log(`13. Quantidade efetivamente renderizada no DOM: ${finalCount}`);
    console.log(`========================================`);
  }, [
    clienteId, 
    cliente, 
    produtos, 
    historico, 
    cacheData, 
    processedItems, 
    filteredItems, 
    searchTerm, 
    selectedFamily, 
    selectedWeight, 
    estoqueMap,
    isReady
  ]);

  if (loading) return <StockCountSkeleton />;

  const isOverdueGlobal = diasDesdeUltimoPedidoGlobal > mediaCicloGlobal;

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-2 flex flex-col">
      {/* Spreadsheet Header */}
      <div className="bg-white border-b border-neutral-200 shadow-sm">
        <div className="w-full px-2 py-1 md:py-1.5">
          {/* Desktop/Tablet Header */}
          <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto] gap-x-3 gap-y-1 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <button onClick={() => navigate(-1)} className="p-1 hover:bg-neutral-100 rounded-full transition-colors shrink-0">
                <ArrowLeft size={16} />
              </button>
              <h1 className="text-xs font-black text-neutral-800 flex-1 leading-none truncate min-w-0">
                {cliente?.cliente}
              </h1>
              <div className="flex items-center gap-3 shrink-0 text-[10px]">
                <div className="text-center">
                  <span className="text-[8px] font-bold text-neutral-400 uppercase block leading-none">Ult. Ped</span>
                  <span className={cn("text-xs font-black", isOverdueGlobal ? "text-red-600" : "text-neutral-800")}>
                    {diasDesdeUltimoPedidoGlobal}d
                  </span>
                </div>
                <div className="text-center">
                  <span className="text-[8px] font-bold text-neutral-400 uppercase block leading-none">Ciclo</span>
                  <span className="text-xs font-black text-neutral-800 bg-neutral-100 px-1 rounded">
                    {mediaCicloGlobal}d
                  </span>
                </div>
                <div className="text-center">
                  <span className="text-[8px] font-bold text-neutral-400 uppercase block leading-none">Peso Ped.</span>
                  <span className="text-[10px] font-black text-orange-600 bg-orange-50 px-1 py-0.2 rounded whitespace-nowrap">
                    {formatWeight(totalPesoPedido)}
                  </span>
                </div>
              </div>
            </div>

            <div className="row-span-2 flex items-center justify-end gap-2 shrink-0">
              <button 
                onClick={handleExportPDF}
                className="w-10 h-10 flex items-center justify-center bg-white text-neutral-700 rounded-full shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-all active:scale-95"
                title="Exportar PDF"
              >
                <Download size={20} />
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="w-10 h-10 flex items-center justify-center bg-white text-green-600 rounded-full shadow-sm border border-neutral-200 hover:bg-green-50 disabled:opacity-50 transition-all active:scale-95"
                title={saving ? 'Salvando...' : 'Salvar Contagem'}
              >
                <Save size={20} />
              </button>
              <button 
                onClick={handleGoToPedido}
                className="w-10 h-10 flex items-center justify-center bg-orange-600 text-white rounded-full shadow-sm border border-orange-700 hover:bg-orange-700 transition-all active:scale-95"
                title="Ir para Pedido"
              >
                <ShoppingCart size={20} />
              </button>
              <button 
                onClick={() => navigate(`/cliente/${clienteId}`)}
                className="w-10 h-10 flex items-center justify-center bg-white text-orange-600 rounded-full shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-all active:scale-95"
                title="Home do Cliente"
              >
                <Home size={20} />
              </button>
            </div>

            <div className="relative min-w-0">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" size={12} />
              <input 
                type="text" 
                placeholder="Buscar produto..."
                className="w-full pl-6 pr-6 bg-neutral-100 rounded-md outline-none text-[10px] font-bold text-neutral-800 border border-neutral-200 focus:ring-1 focus:ring-orange-500 transition-all h-7"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-0.5 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Mobile Header */}
          <div className="flex md:hidden flex-col gap-0.5 mb-1 px-1">
            <div className="flex items-center gap-1">
              <button onClick={() => navigate(-1)} className="p-0.5 hover:bg-neutral-100 rounded-full transition-colors shrink-0">
                <ArrowLeft size={14} />
              </button>
              <h1 className="text-[11px] font-black text-neutral-800 flex-1 leading-none line-clamp-1">
                {cliente?.cliente}
              </h1>
              <button 
                onClick={handleExportPDF}
                className="w-8 h-8 flex items-center justify-center bg-white text-neutral-700 rounded-full shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-all active:scale-95 shrink-0"
                title="Exportar PDF"
              >
                <Download size={17} />
              </button>
              <button 
                onClick={handleSave}
                disabled={saving}
                className="w-8 h-8 flex items-center justify-center bg-white text-green-600 rounded-full shadow-sm border border-neutral-200 hover:bg-green-50 disabled:opacity-50 transition-all active:scale-95 shrink-0"
                title={saving ? 'Salvando...' : 'Salvar Contagem'}
              >
                <Save size={17} />
              </button>
              <button 
                onClick={handleGoToPedido}
                className="w-8 h-8 flex items-center justify-center bg-orange-600 text-white rounded-full shadow-sm border border-orange-700 hover:bg-orange-700 transition-all active:scale-95 shrink-0"
                title="Ir para Pedido"
              >
                <ShoppingCart size={17} />
              </button>
              <button 
                onClick={() => navigate(`/cliente/${clienteId}`)}
                className="w-8 h-8 flex items-center justify-center bg-white text-orange-600 rounded-full shadow-sm border border-neutral-200 hover:bg-neutral-50 transition-all active:scale-95 shrink-0"
                title="Home do Cliente"
              >
                <Home size={17} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-0.5 bg-neutral-50 py-0.5 px-1 rounded border border-neutral-100 text-center">
              <div className="border-r border-neutral-200">
                <p className="text-[7.5px] font-black text-neutral-400 uppercase leading-none">Ult. Pedido</p>
                <p className={cn("text-[9px] font-black leading-tight", isOverdueGlobal ? "text-red-600" : "text-neutral-800")}>
                  {diasDesdeUltimoPedidoGlobal}d
                </p>
              </div>
              <div className="border-r border-neutral-200">
                <p className="text-[7.5px] font-black text-neutral-400 uppercase leading-none">Ciclo Médio</p>
                <p className="text-[9px] font-black text-neutral-800 leading-tight">
                  {mediaCicloGlobal}d
                </p>
              </div>
              <div>
                <p className="text-[7.5px] font-black text-neutral-400 uppercase leading-none">Peso Pedido</p>
                <p className="text-[9px] font-black text-orange-600 leading-tight">
                  {formatWeight(totalPesoPedido)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-1 md:space-y-0">
            <div className="relative md:hidden">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" size={12} />
              <input 
                type="text" 
                placeholder="Buscar produto..."
                className="w-full pl-6 pr-6 bg-neutral-100 rounded-md outline-none text-[11px] font-bold text-neutral-800 border border-neutral-200 focus:ring-1 focus:ring-orange-500 transition-all h-7"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-0.5 transition-colors"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="flex flex-wrap md:flex-nowrap items-center justify-between md:justify-end gap-1 md:gap-1.5 w-full pb-0.5">
              <div className="flex bg-neutral-100 p-0.5 rounded border border-neutral-200 shrink-0 h-8">
                <button
                  onClick={() => setViewMode('contagem')}
                  className={cn(
                    "px-3 md:px-4 rounded text-[10px] md:text-[11px] font-black transition-all cursor-pointer whitespace-nowrap text-center",
                    viewMode === 'contagem' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                  )}
                >
                  Contagem
                </button>
                <button
                  onClick={() => setViewMode('pedido')}
                  className={cn(
                    "px-3 md:px-4 rounded text-[10px] md:text-[11px] font-black transition-all cursor-pointer whitespace-nowrap text-center",
                    viewMode === 'pedido' ? "bg-white text-green-600 shadow-sm" : "text-neutral-500 hover:text-neutral-800"
                  )}
                >
                  Pedido
                </button>
              </div>


              <button 
                onClick={handleClearAll}
                className="px-2 md:px-4 py-0.5 bg-red-600 text-white rounded text-[9.5px] md:text-[11px] font-black hover:bg-red-700 transition-all flex items-center gap-1 shrink-0 shadow-sm active:scale-95 cursor-pointer h-6 md:h-8"
              >
                <Trash2 size={12} /> Limpar
              </button>

              <button 
                onClick={() => setShowInactive(!showInactive)}
                className={cn(
                  "px-2 md:px-4 py-0.5 rounded text-[9.5px] md:text-[11px] font-black transition-colors cursor-pointer shrink-0 border h-6 md:h-8 flex items-center gap-1",
                  showInactive 
                    ? "bg-orange-600 text-white border-orange-700 shadow-sm" 
                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 border-neutral-200"
                )}
              >
                <span>{showInactive ? "Ocultar inativos" : "Mostrar inativos"}</span>
              </button>

              <div className="relative shrink-0">
                <select
                  value={selectedWeight}
                  onChange={(e) => setSelectedWeight(e.target.value)}
                  className="pl-2 pr-5 h-6 md:h-8 bg-neutral-100 rounded outline-none text-[9.5px] md:text-[11px] font-black text-neutral-600 appearance-none border border-neutral-200 cursor-pointer max-w-[75px] md:max-w-[100px] truncate"
                >
                  {weights.map(w => (
                    <option key={w} value={w}>
                      {w === 'Todos' ? 'Emb: TD' : formatWeight(Number(w))}
                    </option>
                  ))}
                </select>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                  <TrendingDown size={11} />
                </div>
              </div>

              <div className="relative shrink-0">
                <select
                  value={selectedFamily}
                  onChange={(e) => setSelectedFamily(e.target.value)}
                  className="pl-2 pr-5 h-6 md:h-8 bg-neutral-100 rounded outline-none text-[9.5px] md:text-[11px] font-black text-neutral-600 appearance-none border border-neutral-200 cursor-pointer max-w-[95px] md:max-w-[135px] truncate"
                >
                  {families.map(f => (
                    <option key={f} value={f}>{f === 'Todas' ? 'Fam: Todas' : f}</option>
                  ))}
                </select>
                <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                  <Package size={11} />
                </div>
              </div>
          </div>
        </div>
      </div>
      </div>
      <div className="w-full px-1 mt-1 flex-1 flex flex-col min-h-0">
        {filteredItems.length === 0 ? (
          <div className="w-full bg-white rounded-lg shadow-sm border border-neutral-200 p-8 md:p-12 text-center flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-orange-50 rounded-full flex items-center justify-center text-orange-600">
              <Package size={32} />
            </div>
            <div className="max-w-md space-y-2">
              <h3 className="text-base font-black text-neutral-800">
                {processedItems.length === 0 
                  ? "Sem Histórico de Compras" 
                  : !showInactive && processedItems.some(item => !item.ativo)
                    ? "Nenhum Produto Ativo Encontrado"
                    : "Nenhum Item Encontrado"}
              </h3>
              <p className="text-xs text-neutral-500 leading-relaxed">
                {processedItems.length === 0 
                  ? "Este cliente não possui histórico de compras recente ou faturamento qualificado para contagem de estoque." 
                  : !showInactive && processedItems.some(item => !item.ativo)
                    ? "Nenhum produto ativo foi encontrado para este cliente dentro do ciclo de 365 dias. Existem produtos inativos disponíveis."
                    : "Nenhum produto atendeu aos critérios de busca ou filtros selecionados."}
              </p>
            </div>
            
            <div className="flex flex-wrap gap-2 justify-center pt-2">
              {processedItems.length > 0 && !showInactive && processedItems.some(item => !item.ativo) && (
                <button
                  onClick={() => setShowInactive(true)}
                  className="px-4 py-2 bg-orange-600 text-white rounded-lg text-xs font-black shadow-sm hover:bg-orange-700 active:scale-95 transition-all cursor-pointer"
                >
                  Exibir Produtos Inativos
                </button>
              )}
              {(searchTerm || selectedFamily !== 'Todas' || selectedWeight !== 'Todos') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setSelectedFamily('Todas');
                    setSelectedWeight('Todos');
                  }}
                  className="px-4 py-2 bg-neutral-100 text-neutral-700 rounded-lg text-xs font-black border border-neutral-200 hover:bg-neutral-200 active:scale-95 transition-all cursor-pointer"
                >
                  Limpar Filtros
                </button>
              )}
              <button
                onClick={() => navigate('/clientes')}
                className="px-4 py-2 bg-neutral-800 text-white rounded-lg text-xs font-black hover:bg-neutral-700 active:scale-95 transition-all cursor-pointer"
              >
                Voltar aos Clientes
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Spreadsheet Table Container */}
            <div className="flex bg-white rounded-lg shadow-sm border border-neutral-200 flex-col overflow-hidden max-h-[80vh] min-h-[300px] w-full">
          <div className="overflow-y-auto overflow-x-hidden flex-1 w-full">
            <div className="w-full">
              <div 
                className={cn(
                  "grid bg-neutral-100 border-b border-neutral-200 text-[10px] md:text-[11px] font-bold text-neutral-500 uppercase tracking-tight sticky top-0 z-[100] shadow-sm",
                  gridCols
                )}
              >
                {viewMode === 'contagem' && (
                  <>
                    <div className="px-1.5 border-r border-neutral-200 flex items-center h-8">Produto</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8 leading-none">Ult.<br/>Ped.</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8">Qtd</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8 leading-none">Ult.<br/>Cont.</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8">Est.</div>
                    <div className="p-0.5 text-center flex items-center justify-center h-8 leading-none">Ideal</div>
                  </>
                )}

                {viewMode === 'pedido' && (
                  <>
                    <div className="px-1.5 border-r border-neutral-200 flex items-center h-8">Produto</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8 leading-none">Ult.<br/>Ped.</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8">Qtd</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8 leading-none">Ult.<br/>Cont.</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-8 leading-none">Ideal</div>
                    <div className="p-0.5 text-center flex items-center justify-center h-8">Pedido</div>
                  </>
                )}
              </div>

              <div className="divide-y divide-neutral-100 relative z-0">
              {filteredItems.map((item) => {
                const isTouched = touchedItems.has(item.produto_id);
                const isBelowIdeal = item.estoque_ideal > 0;
                const isZeroStock = item.quantidade_atual === 0;
                const isLastOrder = item.dias_ult_compra === diasDesdeUltimoPedidoGlobal;

                const rowStyle = isTouched 
                  ? (isZeroStock ? "text-red-600 font-black" : isBelowIdeal ? "font-black text-neutral-900" : "text-neutral-900 font-bold")
                  : "text-neutral-800 font-normal";

                return (
                  <div 
                    key={item.produto_id} 
                    className={cn(
                       "grid items-stretch text-[12px] md:text-[13px] transition-colors cursor-pointer even:bg-neutral-200/40",
                      gridCols,
                      rowStyle,
                      "hover:bg-orange-50/30"
                    )}
                    onClick={() => setSelectedProductHistory(item)}
                  >
                    {viewMode === 'contagem' && (
                      <>
                        <div className="px-1.5 py-1 border-r border-neutral-100 flex items-center min-h-10 leading-tight min-w-0">
                          <span className="block font-bold text-[11px] md:text-[12px] whitespace-normal break-words line-clamp-2 md:line-clamp-none">{item.produto_nome}</span>
                        </div>
                        <div className={cn(
                          "p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px]",
                          item.dias_ult_compra > 180 
                            ? "text-red-600 font-black bg-red-50/50" 
                            : isLastOrder
                              ? "font-semibold text-neutral-950"
                              : "text-neutral-400 font-normal opacity-70"
                        )}>
                          {item.dias_ult_compra}
                        </div>
                        <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px] opacity-70">
                          {item.qtd_ult_compra}
                        </div>
                        <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px] opacity-70">
                          {item.ultima_contagem_valor}
                        </div>
                        <div className={cn(
                          "p-0.5 border-r border-neutral-100 flex items-center justify-center gap-0.5 min-h-10",
                          isBelowIdeal ? "bg-red-50/30" : ""
                        )} onClick={(e) => e.stopPropagation()}>
                          <button 
                            onClick={() => updateQuantity(item.produto_id, (estoqueMap[item.produto_id] || 0) - 1)}
                            className="w-7 h-7 flex items-center justify-center bg-white border border-orange-200 rounded text-orange-600 hover:bg-orange-50 active:scale-90 transition-transform cursor-pointer shrink-0"
                          >
                            <Minus size={12} />
                          </button>
                          <input 
                            type="number" 
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className={cn(
                              "w-8 md:w-9 border rounded py-0.5 text-center font-black outline-none focus:ring-1 focus:ring-orange-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-[11px] md:text-[12px]",
                              isBelowIdeal ? "bg-red-100 border-red-200 text-red-700" : "bg-orange-50 border-orange-100 text-orange-700"
                            )}
                            value={estoqueMap[item.produto_id] ?? ''}
                            onChange={(e) => updateQuantity(item.produto_id, e.target.value)}
                          />
                          <button 
                            onClick={() => updateQuantity(item.produto_id, (estoqueMap[item.produto_id] || 0) + 1)}
                            className="w-7 h-7 flex items-center justify-center bg-orange-600 border border-orange-700 rounded text-white hover:bg-orange-700 active:scale-90 transition-transform cursor-pointer shrink-0"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                        <div className={cn(
                          "p-0.5 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px]",
                          isBelowIdeal ? "text-red-600 font-black bg-red-50/30" : "font-bold"
                        )}>
                          {item.estoque_ideal}
                        </div>
                      </>
                    )}

                    {viewMode === 'pedido' && (
                      <>
                        <div className="px-1.5 py-1 border-r border-neutral-100 flex items-center min-h-10 leading-tight min-w-0">
                          <span className="block font-bold text-[11px] md:text-[12px] whitespace-normal break-words line-clamp-2 md:line-clamp-none">{item.produto_nome}</span>
                        </div>
                        <div className={cn(
                          "p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px]",
                          item.dias_ult_compra > 180 
                            ? "text-red-600 font-black bg-red-50/50" 
                            : isLastOrder
                              ? "font-semibold text-neutral-950"
                              : "text-neutral-400 font-normal opacity-70"
                        )}>
                          {item.dias_ult_compra}
                        </div>
                        <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px] opacity-70">
                          {item.qtd_ult_compra}
                        </div>
                        <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px] opacity-70">
                          {item.ultima_contagem_valor}
                        </div>
                        <div className={cn(
                          "p-0.5 border-r border-neutral-100 text-center flex items-center justify-center min-h-10 text-[11px] md:text-[12px]",
                          isBelowIdeal ? "text-red-600 font-black bg-red-50/30" : "font-bold"
                        )}>
                          {item.estoque_ideal}
                        </div>
                        <div className="p-0.5 flex items-center justify-center gap-0.5 min-h-10" onClick={(e) => e.stopPropagation()}>
                          <button 
                            onClick={() => updatePedido(item.produto_id, (pedidoMap[item.produto_id] || 0) - 1)}
                            className="w-7 h-7 flex items-center justify-center bg-white border border-green-200 rounded text-green-600 hover:bg-green-50 active:scale-90 transition-transform cursor-pointer shrink-0"
                          >
                            <Minus size={12} />
                          </button>
                          <input 
                            type="number" 
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="w-8 md:w-9 bg-green-50 border border-green-100 rounded py-0.5 text-center font-black text-green-700 outline-none focus:ring-1 focus:ring-green-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-[11px] md:text-[12px]"
                            value={pedidoMap[item.produto_id] || ''}
                            onChange={(e) => updatePedido(item.produto_id, e.target.value)}
                          />
                          <button 
                            onClick={() => updatePedido(item.produto_id, (pedidoMap[item.produto_id] || 0) + 1)}
                            className="w-7 h-7 flex items-center justify-center bg-green-600 border border-green-700 rounded text-white hover:bg-green-700 active:scale-90 transition-transform cursor-pointer shrink-0"
                          >
                            <Plus size={12} />
                          </button>
                        </div>
                      </>
                    )}

                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>
      </>
    )}
  </div>


      <AnimatePresence>
        {showClearConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl border border-neutral-200"
            >
              <h3 className="text-base font-black text-neutral-900">Zerar contagem</h3>
              <p className="mt-2 text-sm font-medium text-neutral-600">Tem certeza que deseja zerar toda a contagem e também limpar os itens lançados no pedido?</p>
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="flex-1 rounded-lg border border-neutral-200 bg-white px-4 py-2.5 text-sm font-black text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmClearAll}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-black text-white transition-colors hover:bg-red-700"
                >
                  Limpar tudo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* History Modal */}
      <AnimatePresence>
        {selectedProductHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-lg shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-orange-100 flex items-center justify-center text-orange-600">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="font-black text-neutral-800 leading-tight">Histórico de Compra</h3>
                    <p className="text-xs font-bold text-neutral-500 uppercase">{selectedProductHistory.produto_nome}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedProductHistory(null)}
                  className="p-2 hover:bg-neutral-200 rounded-full transition-colors text-neutral-400"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="mobile-card-table flex-1 overflow-auto p-3 md:p-4">
                <table className="w-full min-w-[550px] md:min-w-0 text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-black text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                      <th className="pb-2 px-2">Data</th>
                      <th className="pb-2 px-2 text-center">Qtd</th>
                      <th className="pb-2 px-2 text-center">Peso Total</th>
                      <th className="pb-2 px-2 text-right">Valor Pago</th>
                      <th className="pb-2 px-2 text-center">Pedido</th>
                      <th className="pb-2 px-2 text-center">xDt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-50">
                    {(() => {
                      const productVendas = historico
                        .filter(h => h.produto_id === selectedProductHistory.produto_id)
                        .sort((a, b) => new Date(b.faturamento).getTime() - new Date(a.faturamento).getTime());

                      return productVendas.map((venda) => {
                        const unitPrice = (venda["r$_total"] / venda.qtd) / selectedProductHistory.quant_embalagem;
                        const totalOrderWeight = orderWeightByDay[venda.faturamento] || 0;

                        return (
                          <tr key={venda.id} className="text-xs hover:bg-neutral-50 transition-colors">
                            <td data-label="Data" className="py-3 px-2 font-bold text-neutral-700">
                              {format(parseISO(venda.faturamento), 'dd/MM/yyyy')}
                            </td>
                            <td data-label="Quantidade" className="py-3 px-2 text-center font-medium text-neutral-600">
                              {venda.qtd * selectedProductHistory.quant_embalagem} un
                            </td>
                            <td data-label="Peso total" className="py-3 px-2 text-center text-neutral-500">
                              {formatWeight(venda.qtd * selectedProductHistory.peso)}
                            </td>
                            <td data-label="Valor pago" className="py-3 px-2 text-right font-bold text-neutral-800">
                              {formatCurrency(unitPrice)}
                            </td>
                            <td data-label="Peso do pedido" className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-orange-100 text-orange-600">
                                {formatWeight(totalOrderWeight)}
                              </span>
                            </td>
                            <td data-label="Tabela (XDT)" className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-neutral-100 text-neutral-600">
                                {venda.xdt || 0}
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>

              <div className="p-4 bg-neutral-50 border-t border-neutral-100 flex justify-end">
                <button 
                  onClick={() => setSelectedProductHistory(null)}
                  className="px-6 py-2 bg-neutral-800 text-white rounded-lg font-black text-xs uppercase tracking-widest hover:bg-neutral-700 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden Export View - Professional A4 Format */}
<div 
  className="fixed top-0 left-0 bg-white opacity-0 pointer-events-none z-[-100]" 
  ref={exportRef}
  style={{ width: '800px', color: '#171717' }}
>
  {(() => {
    // Smart pagination: First page fits less items due to header/client info
    const chunks = [];
    let i = 0;
    let isFirstPage = true;
    
    while (i < processedItems.length) {
      const itemsLimit = isFirstPage ? 12 : 18;
      chunks.push(processedItems.slice(i, i + itemsLimit));
      i += itemsLimit;
      isFirstPage = false;
    }

    return chunks.map((chunk, pageIdx) => (
      <div 
        key={pageIdx}
        className="pdf-page w-[800px] h-[1130px] bg-white p-[40px] flex flex-col font-sans mb-10"
        style={{ fontFamily: 'Arial, sans-serif', backgroundColor: '#ffffff', color: '#171717' }}
      >
        {/* Header */}
        <div className="flex justify-between items-start border-b-2 pb-6 mb-8" style={{ borderColor: '#262626' }}>
          <div className="flex flex-col">
            <h1 className="text-3xl font-black uppercase tracking-tighter" style={{ color: '#171717' }}>Contagem de Estoque</h1>
            <div className="mt-2 space-y-1">
              <p className="text-sm font-bold" style={{ color: '#171717' }}>{cliente?.cliente}</p>
              <div className="flex gap-4">
                <p className="text-sm font-bold" style={{ color: '#737373' }}>Data: {new Date().toLocaleDateString('pt-BR')}</p>
                <p className="text-sm font-bold" style={{ color: '#737373' }}>Últ. Pedido: {diasDesdeUltimoPedidoGlobal} dias</p>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <img 
              src="https://wsrv.nl/?url=https://adimax.com.br/wp-content/uploads/2021/06/logo_adimax-04968c974e8e5d15ddb822152395b3f6.png&w=400&output=png" 
              alt="ADIMAX" 
              className="h-12 w-auto mb-2"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
            />
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#a3a3a3' }}>Parceiro Oficial</span>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: '#171717', color: '#ffffff' }}>
                <th className="py-3 px-2 text-left text-[9px] font-black uppercase tracking-widest rounded-tl-lg">Produto</th>
                <th className="py-3 px-2 text-center text-[9px] font-black uppercase tracking-widest">Ult. Contagem</th>
                <th className="py-3 px-2 text-center text-[9px] font-black uppercase tracking-widest">Ult. Pedido ({diasDesdeUltimoPedidoGlobal}d)</th>
                <th className="py-3 px-2 text-center text-[9px] font-black uppercase tracking-widest" style={{ borderRight: '2px solid #e5e5e5' }}>Ult. Estoque</th>
                <th className="py-3 px-2 text-center text-[9px] font-black uppercase tracking-widest">Contagem Atual</th>
                <th className="py-3 px-2 text-center text-[9px] font-black uppercase tracking-widest rounded-tr-lg">Venda</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: '#f5f5f5' }}>
              {chunk.map((item, idx) => {
                const currentStock = estoqueMap[item.produto_id] ?? 0;
                const ultEstoque = item.ultima_contagem_valor + item.qtd_ult_compra;
                const venda = ultEstoque - currentStock;

                return (
                  <tr key={item.produto_id} className="text-[11px]" style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td className="py-3 px-2 font-bold leading-tight break-words max-w-[200px]" style={{ color: '#262626' }}>
                      {item.produto_nome}
                    </td>
                    <td className="py-3 px-2 text-center font-bold" style={{ color: '#737373' }}>
                      {item.ultima_contagem_valor}
                    </td>
                    <td className="py-3 px-2 text-center font-bold" style={{ color: '#737373' }}>
                      {item.qtd_ult_compra}
                    </td>
                    <td className="py-3 px-2 text-center font-black" style={{ borderRight: '2px solid #f5f5f5', color: '#171717' }}>
                      {ultEstoque}
                    </td>
                    <td className="py-3 px-2 text-center font-black" style={{ backgroundColor: 'rgba(255, 247, 237, 0.3)', color: '#171717' }}>
                      {currentStock}
                    </td>
                    <td className="py-3 px-2 text-center font-black" style={{ color: venda > 0 ? '#dc2626' : (venda < 0 ? '#dc2626' : '#a3a3a3') }}>
                      {venda}
                    </td>
                  </tr>
                );
              })}

            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-8 border-t text-center" style={{ borderColor: '#f5f5f5' }}>
          <p className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: '#d4d4d4' }}>MAICON OLIVEIRA REPRESENTAÇÕES</p>
          <p className="text-[10px] font-bold mt-2 italic uppercase tracking-wider" style={{ color: '#a3a3a3' }}>Este documento é uma contagem de estoque e não possui validade fiscal.</p>
          <p className="text-[10px] font-bold mt-4" style={{ color: '#a3a3a3' }}>Página {pageIdx + 1} de {chunks.length}</p>
        </div>
      </div>
    ));
  })()}
</div>
    </div>
  );
}
