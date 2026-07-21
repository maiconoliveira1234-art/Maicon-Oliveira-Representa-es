import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { 
  ArrowLeft, 
  ShoppingCart, 
  History, 
  Package, 
  Target, 
  TrendingUp, 
  TrendingDown, 
  Calendar,
  Plus,
  Minus,
  Save,
  Trash2,
  Search,
  ChevronDown,
  Share2,
  X,
  FileText,
  Eye,
  Home,
  Coins
} from 'lucide-react';
import { Cliente, Produto, ItemPedido, PrecoFaixa } from '../types';
import { supabase } from '../lib/supabase';
import { getFromLocal } from '../lib/offline';
import { 
  getFaixaPreco, 
  getValorUnitario, 
  calcularPrecoComDesconto,
  deveManterFaixaAnterior 
} from '../lib/calculations';
import { cn, formatCurrency, formatWeight } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getAvailableTerms } from '../lib/paymentTerms';
import { parseISO, differenceInDays, startOfWeek, addWeeks, addDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from '../lib/mockData';

import { useDataManager } from '../lib/dataManager';
import { StockCountSkeleton } from '../components/ui/Skeleton';
import { logDiagnostic } from '../lib/diagnostics';

export function OrderPage() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { produtos: allProducts, clientCache, loadClientDetails, clientes } = useDataManager();
  
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [itens, setItens] = useState<Partial<ItemPedido>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [showFlexCard, setShowFlexCard] = useState(false);
  const [showOrderDetails, setShowOrderDetails] = useState(false);
  const [productSelectorType, setProductSelectorType] = useState<'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING'>('VENDA');
  const [selectedPrazo, setSelectedPrazo] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('Todas');
  const [selectedWeight, setSelectedWeight] = useState('Todos');
  const [showOnlyPositivados, setShowOnlyPositivados] = useState(false);
  const [positivadosIds, setPositivadosIds] = useState<Set<string>>(new Set());
  const [pesoConquistado, setPesoConquistado] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [observacoes, setObservacoes] = useState('');
  const [manualFaixa, setManualFaixa] = useState<PrecoFaixa | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const historicoCliente = useMemo(() => {
    return clienteId ? clientCache[clienteId]?.historico || [] : [];
  }, [clientCache, clienteId]);

  const lastPurchaseByProduct = useMemo(() => {
    const map = new Map<string, { quantidade: number; dias: number }>();

    historicoCliente.forEach(item => {
      if (!item.produto_id || map.has(item.produto_id)) return;

      try {
        const lastDate = parseISO(item.faturamento);
        map.set(item.produto_id, {
          quantidade: item.qtd * (allProducts.find(prod => prod.id === item.produto_id)?.quant_embalagem || 1),
          dias: Math.max(0, differenceInDays(new Date(), lastDate))
        });
      } catch (error) {
        map.set(item.produto_id, { quantidade: item.qtd, dias: 0 });
      }
    });

    return map;
  }, [historicoCliente, allProducts]);
  const itemsEndRef = React.useRef<HTMLDivElement>(null);
  const orderDetailsRef = React.useRef<HTMLDivElement>(null);
  const orderFooterRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    let frameId = 0;

    const positionFooter = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(() => {
        if (!orderFooterRef.current) return;

        const visualBottom = viewport
          ? viewport.offsetTop + viewport.height
          : window.innerHeight;
        const offset = Math.min(0, visualBottom - window.innerHeight);
        orderFooterRef.current.style.transform = `translate3d(0, ${Math.round(offset)}px, 0)`;
      });
    };

    positionFooter();
    window.addEventListener('resize', positionFooter);
    window.addEventListener('orientationchange', positionFooter);
    viewport?.addEventListener('resize', positionFooter);
    viewport?.addEventListener('scroll', positionFooter);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', positionFooter);
      window.removeEventListener('orientationchange', positionFooter);
      viewport?.removeEventListener('resize', positionFooter);
      viewport?.removeEventListener('scroll', positionFooter);
    };
  }, []);

  const families = useMemo(() => {
    const activeProducts = produtos.filter(p => p.ativo !== false);
    const uniqueFamilies = Array.from(new Set(activeProducts.map(p => p.familia).filter(Boolean)));
    return ['Todas', ...uniqueFamilies.sort()];
  }, [produtos]);

  const weights = useMemo(() => {
    let list = produtos.filter(p => p.ativo !== false);
    if (selectedFamily !== 'Todas') {
      list = list.filter(p => p.familia === selectedFamily);
    }
    const unique = Array.from(new Set(list.map(p => {
      const pesoUnitario = (p.peso_embalagem || 0) / (p.quant_embalagem || 1);
      return Number(pesoUnitario.toFixed(3));
    }))) as number[];
    return ['Todos', ...unique.filter(w => w > 0).sort((a, b) => a - b)];
  }, [produtos, selectedFamily]);

  useEffect(() => {
    if (selectedWeight !== 'Todos' && !weights.includes(Number(selectedWeight))) {
      setSelectedWeight('Todos');
    }
  }, [weights, selectedWeight]);

  const filteredAndSortedProducts = useMemo(() => {
    const searchWords = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
    
    return produtos
      .filter(p => {
        const productName = p.produto?.toLowerCase() || '';
        const productFamily = p.familia?.toLowerCase() || '';
        const targetString = `${productName} ${productFamily}`;
        
        const matchesSearch = searchWords.length === 0 || searchWords.every(word => targetString.includes(word));
        const matchesFamily = selectedFamily === 'Todas' || p.familia === selectedFamily;
        
        const pesoUnitario = (p.peso_embalagem || 0) / (p.quant_embalagem || 1);
        const matchesWeight = selectedWeight === 'Todos' || Math.abs(pesoUnitario - Number(selectedWeight)) < 0.001;

        const matchesPositivados = !showOnlyPositivados || positivadosIds.has(p.id);
        const isActive = p.ativo !== false; // Only show active products
        return matchesSearch && matchesFamily && matchesWeight && matchesPositivados && isActive;
      })
      .sort((a, b) => {
        // First sort by family
        const familyCompare = (a.familia || '').localeCompare(b.familia || '');
        if (familyCompare !== 0) return familyCompare;
        // Then sort by product name
        return (a.produto || '').localeCompare(b.produto || '');
      });
  }, [produtos, searchTerm, selectedFamily, selectedWeight, showOnlyPositivados, positivadosIds]);

  useEffect(() => {
    async function loadData() {
      if (!clienteId) return;
      
      const loadStartTime = performance.now();
      logDiagnostic('DEBUG_ORDER', `Iniciando carregamento de dados do pedido para cliente ID: ${clienteId}`);
      
      try {
        setLoading(true);
        
        // Ensure initial data is loaded in context
        const cacheStartTime = performance.now();
        const cache = await loadClientDetails(clienteId);
        logDiagnostic('DEBUG_ORDER', `Dados de cache carregados em ${(performance.now() - cacheStartTime).toFixed(2)}ms. Histórico: ${cache?.historico?.length || 0} registros`);
 
        // Load Cliente
        const clientStartTime = performance.now();
        const clienteData = (clientes || []).find(c => c.id === clienteId);
        
        if (!clienteData) {
          setCliente(MOCK_CLIENTES.find(c => c.id === clienteId) || null);
        } else {
          setCliente(clienteData);
          logDiagnostic('DEBUG_ORDER', `Cliente carregado do DataManager em ${(performance.now() - clientStartTime).toFixed(2)}ms: ${clienteData.cliente}`);
        }

        // Use products from context
        const produtosData = allProducts.length > 0 ? allProducts : MOCK_PRODUTOS;
        setProdutos(produtosData);

        const today = new Date();
        let totalPesoConquistado = 0;

        if (cache && cache.historico.length > 0) {
          const ids = new Set<string>();
          cache.historico.forEach(h => {
            // Positivados
            if (h.produto_id) ids.add(h.produto_id);
            else if (h.produtos) {
              const matched = produtosData?.find(p => p.produto.toLowerCase() === h.produtos.toLowerCase());
              if (matched) ids.add(matched.id);
            }

            // Conquered Weight (last 28 days)
            try {
              const saleDate = parseISO(h.faturamento);
              const daysSince = differenceInDays(today, saleDate);
              if (daysSince >= 0 && daysSince <= 28) {
                const prod = produtosData?.find(p => p.id === h.produto_id || p.produto.toLowerCase() === h.produtos?.toLowerCase());
                if (prod) {
                  totalPesoConquistado += (h.qtd * prod.peso_embalagem);
                }
              }
            } catch (e) {
              console.error('Erro ao processar data de faturamento:', h.faturamento);
            }
          });
          setPositivadosIds(ids);
          setPesoConquistado(totalPesoConquistado);
        } else {
          // Fallback to mock data if no history in cache and no error (could be first time)
          const mockIds = new Set();
          let mockPeso = 0;
          MOCK_HISTORICO
            .filter(h => h.cliente_id === clienteId)
            .forEach(h => {
              mockIds.add(h.produto_id);
              try {
                const saleDate = parseISO(h.faturamento);
                const daysSince = differenceInDays(today, saleDate);
                if (daysSince >= 0 && daysSince <= 28) {
                  const prod = MOCK_PRODUTOS.find(p => p.id === h.produto_id);
                  if (prod) {
                    mockPeso += (h.qtd * prod.peso_embalagem);
                  }
                }
              } catch (e) {}
            });
          setPositivadosIds(mockIds as Set<string>);
          setPesoConquistado(mockPeso);
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
        setCliente(MOCK_CLIENTES.find(c => c.id === clienteId) || null);
        setProdutos(MOCK_PRODUTOS);
      } finally {
        setLoading(false);
        logDiagnostic('DEBUG_ORDER', `Finalizado carregamento de dados do pedido em ${(performance.now() - loadStartTime).toFixed(2)}ms`);
      }
    }
    loadData();
  }, [clienteId, allProducts, loadClientDetails, clientCache?.[clienteId || '']]);

  const pesoTotal = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.peso_total || 0), 0);
  }, [itens]);

  const faixaPreco = useMemo(() => {
    // Rule: Effective weight is the max between current order weight and weight from last 28 days
    const pesoEfetivo = Math.max(pesoTotal, pesoConquistado);
    return getFaixaPreco(pesoEfetivo);
  }, [pesoTotal, pesoConquistado]);

  const currentFaixa = manualFaixa || faixaPreco;

  const computedItens = useMemo(() => {
    // 1. Separate normal sale items to compute unit values
    const vendaItems = itens.filter(i => !i.tipo_operacao || i.tipo_operacao === 'VENDA');
    const nonVendaItems = itens.filter(i => i.tipo_operacao && i.tipo_operacao !== 'VENDA');

    // 2. Computed values for venda items
    const processedVenda = vendaItems.map(item => {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (!produto) return item;
      const discount = getValorUnitario(produto, currentFaixa) || 0;
      const unitario = calcularPrecoComDesconto(produto.custo_und, discount);
      const valorTotalItem = unitario * (item.quantidade || 0) * (produto.quant_embalagem || 1);
      return {
        ...item,
        valor_unitario: unitario,
        valor_total: valorTotalItem,
        peso_total: (item.quantidade || 0) * produto.peso_embalagem
      };
    });

    // 3. Computed values for bonificacao / merchandising items
    const processedNonVenda = nonVendaItems.map(item => {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (!produto) return item;
      
      const matchingVenda = processedVenda.find(v => v.produto_id === item.produto_id);
      let unitario = 0;
      
      if (matchingVenda) {
        unitario = matchingVenda.valor_unitario || 0;
      } else {
        unitario = produto.custo_und; // full price / cadastrado
      }
      
      const valorTotalItem = unitario * (item.quantidade || 0) * (produto.quant_embalagem || 1);
      
      return {
        ...item,
        valor_unitario: unitario,
        valor_total: valorTotalItem,
        peso_total: (item.quantidade || 0) * produto.peso_embalagem
      };
    });

    return [...processedVenda, ...processedNonVenda];
  }, [itens, produtos, currentFaixa]);

  const valorVendasSubtotal = useMemo(() => {
    return computedItens
      .filter(item => !item.tipo_operacao || item.tipo_operacao === 'VENDA')
      .reduce((acc, item) => acc + (item.valor_total || 0), 0);
  }, [computedItens]);

  const verbaGeradaEstimada = useMemo(() => {
    return valorVendasSubtotal * 0.02;
  }, [valorVendasSubtotal]);

  const totalBonificacoes = useMemo(() => {
    return computedItens
      .filter(item => item.tipo_operacao === 'BONIFICACAO_COMERCIAL')
      .reduce((acc, item) => acc + (item.valor_total || 0), 0);
  }, [computedItens]);

  const totalMerchandising = useMemo(() => {
    return computedItens
      .filter(item => item.tipo_operacao === 'MERCHANDISING')
      .reduce((acc, item) => acc + (item.valor_total || 0), 0);
  }, [computedItens]);

  const valorFinalCliente = useMemo(() => {
    return valorVendasSubtotal;
  }, [valorVendasSubtotal]);

  const prefilledApplied = React.useRef(false);
  const initialLoadDone = React.useRef(false);

  // Reset load state when client changes
  useEffect(() => {
    initialLoadDone.current = false;
    setIsReady(false);
    prefilledApplied.current = false;
    setManualFaixa(null);
    setStartedAt(null);
  }, [clienteId]);

  // Load saved items when client or products change
  useEffect(() => {
    let active = true;
    const loadSavedOrder = async () => {
      if (!loading && produtos.length > 0 && clienteId && !initialLoadDone.current) {
        let savedData: any = null;
        
        // 1. Try Supabase first
        try {
          const { data, error } = await supabase
            .from('pedidos_em_aberto')
            .select('*')
            .eq('cliente_id', clienteId)
            .maybeSingle();
          if (!error && data) {
            savedData = {
              items: data.items,
              prazo: data.prazo,
              obs: data.obs,
              manualFaixa: data.manual_faixa,
              startedAt: data.started_at
            };
          }
        } catch (dbErr) {
          console.error('Error fetching open order from DB:', dbErr);
        }

        // 2. Fallback to localStorage if not found/error
        if (!savedData) {
          const saved = localStorage.getItem(`pedido_${clienteId}`);
          if (saved) {
            try {
              savedData = JSON.parse(saved);
            } catch (e) {
              console.error('Error parsing localStorage:', e);
            }
          }
        }

        if (!active) return;

        if (savedData) {
          try {
            let loadedItemsList: Array<{ produto_id: string, quantidade: number, tipo_operacao?: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' }> = [];
            
            // Handle both old format (Record<string, number>) and new format ({ items, prazo, obs })
            if (savedData && typeof savedData === 'object' && 'items' in savedData) {
              if (Array.isArray(savedData.items)) {
                loadedItemsList = savedData.items;
              } else {
                loadedItemsList = Object.entries(savedData.items || {}).map(([pId, qty]) => ({
                  produto_id: pId,
                  quantidade: qty as number,
                  tipo_operacao: 'VENDA'
                }));
              }
              if (savedData.prazo) setSelectedPrazo(savedData.prazo);
              if (savedData.obs) setObservacoes(savedData.obs);
              if (savedData.manualFaixa) setManualFaixa(savedData.manualFaixa);
              if (savedData.startedAt) {
                setStartedAt(savedData.startedAt);
              }
            } else if (savedData && typeof savedData === 'object') {
              loadedItemsList = Object.entries(savedData).map(([pId, qty]) => ({
                produto_id: pId,
                quantidade: qty as number,
                tipo_operacao: 'VENDA'
              }));
            }

            const newItens: Partial<ItemPedido>[] = [];
            
            // Calculate initial weight to get correct initial price range
            let tempPesoTotal = 0;
            loadedItemsList.forEach(item => {
              const produto = produtos.find(p => p.id === item.produto_id);
              if (produto && (item.quantidade || 0) > 0) {
                tempPesoTotal += (item.quantidade || 0) * produto.peso_embalagem;
              }
            });

            const tempFaixa = getFaixaPreco(Math.max(tempPesoTotal, pesoConquistado));

            loadedItemsList.forEach(item => {
              const produto = produtos.find(p => p.id === item.produto_id);
              if (!produto) return;

              const extraQtd = item.quantidade || 0;
              if (extraQtd > 0) {
                const discount = getValorUnitario(produto, tempFaixa) || 0;
                const unitario = calcularPrecoComDesconto(produto.custo_und, discount);
                const valorTotalItem = unitario * extraQtd * (produto.quant_embalagem || 1);

                newItens.push({
                  produto_id: item.produto_id,
                  quantidade: extraQtd,
                  peso_total: extraQtd * produto.peso_embalagem,
                  valor_unitario: unitario,
                  valor_total: valorTotalItem,
                  tipo_operacao: item.tipo_operacao || 'VENDA'
                });
              }
            });
            setItens(newItens);
          } catch (e) {
            console.error('Error parsing saved order:', e);
            setItens([]);
            setStartedAt(null);
          }
        } else {
          setItens([]);
          setStartedAt(null);
        }
        setIsReady(true);
        initialLoadDone.current = true;
      }
    };

    loadSavedOrder();
    return () => {
      active = false;
    };
  }, [loading, produtos, clienteId, pesoConquistado]);

  // Manage start date of the draft order
  useEffect(() => {
    if (isReady && itens.length > 0 && !startedAt) {
      setStartedAt(new Date().toISOString());
    } else if (isReady && itens.length === 0 && startedAt) {
      setStartedAt(null);
    }
  }, [itens, startedAt, isReady]);

  // Persist items to localStorage and database (Supabase)
  useEffect(() => {
    if (isReady && clienteId) {
      if (itens.length === 0) {
        localStorage.removeItem(`pedido_${clienteId}`);
        // Also clean up from Supabase DB asynchronously
        supabase.from('pedidos_em_aberto').delete().eq('cliente_id', clienteId).then(({ error }) => {
          if (error) console.error('Erro ao deletar do DB:', error);
        });
        return;
      }

      const rawItemList = itens.map(item => ({
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        tipo_operacao: item.tipo_operacao || 'VENDA'
      }));
      
      const dataToSave = {
        items: rawItemList,
        prazo: selectedPrazo,
        obs: observacoes,
        manualFaixa: manualFaixa,
        startedAt: startedAt || new Date().toISOString()
      };
      
      // Update localStorage instantly for snappiness
      localStorage.setItem(`pedido_${clienteId}`, JSON.stringify(dataToSave));

      // Debounce saving to Supabase (e.g. 1 second delay) to prevent database spam on fast interactions
      const saveTimer = setTimeout(async () => {
        try {
          const { error } = await supabase
            .from('pedidos_em_aberto')
            .upsert({
              cliente_id: clienteId,
              items: rawItemList,
              prazo: selectedPrazo || null,
              obs: observacoes || null,
              manual_faixa: manualFaixa || null,
              desconto_extra: 0,
              started_at: startedAt || new Date().toISOString(),
              updated_at: new Date().toISOString()
            }, { onConflict: 'cliente_id' });
          if (error) {
            console.error('Error upserting to DB:', error);
          }
        } catch (dbErr) {
          console.error('Error saving open order to DB:', dbErr);
        }
      }, 1000);

      return () => clearTimeout(saveTimer);
    }
  }, [itens, clienteId, isReady, selectedPrazo, observacoes, manualFaixa, startedAt]);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const receiptRef = React.useRef<HTMLDivElement>(null);

  const handleClearOrder = () => {
    setItens([]);
    setManualFaixa(null);
    setStartedAt(null);
    setSelectedPrazo('');
    setObservacoes('');
    setShowClearConfirm(false);
    if (clienteId) {
      localStorage.removeItem(`pedido_${clienteId}`);
      // Also clean up from Supabase DB
      supabase.from('pedidos_em_aberto').delete().eq('cliente_id', clienteId).then(({ error }) => {
        if (error) console.error('Erro ao deletar do DB:', error);
      });
    }
  };

  const valorTotal = useMemo(() => {
    return valorFinalCliente;
  }, [valorFinalCliente]);

  const availableTerms = useMemo(() => {
    return getAvailableTerms(valorTotal);
  }, [valorTotal]);

  // Reset selected term if it's no longer available
  useEffect(() => {
    if (selectedPrazo && !availableTerms.includes(selectedPrazo)) {
      setSelectedPrazo('');
    }
  }, [availableTerms, selectedPrazo]);

  const addItem = (produto: Produto, tipoOps: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' = 'VENDA') => {
    setItens(prev => {
      const existing = prev.find(i => i.produto_id === produto.id && (i.tipo_operacao || 'VENDA') === tipoOps);
      const discount = getValorUnitario(produto, currentFaixa) || 0;
      const unitario = calcularPrecoComDesconto(produto.custo_und, discount);

      if (existing) {
        return prev.map(item => {
          if (item.produto_id === produto.id && (item.tipo_operacao || 'VENDA') === tipoOps) {
            const nextQty = (item.quantidade || 0) + 1;
            return {
              ...item,
              quantidade: nextQty,
              peso_total: nextQty * produto.peso_embalagem,
              valor_unitario: unitario,
              valor_total: unitario * nextQty * (produto.quant_embalagem || 1)
            };
          }
          return item;
        });
      }

      return [...prev, {
        produto_id: produto.id,
        quantidade: 1,
        peso_total: produto.peso_embalagem,
        valor_unitario: unitario,
        valor_total: unitario * (produto.quant_embalagem || 1),
        tipo_operacao: tipoOps
      }];
    });

    setShowProductSelector(false);
  };

  const updateItem = (produtoId: string, qtd: number, tipoOps: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING' = 'VENDA') => {
    setItens(prev => {
      if (qtd <= 0) {
        return prev.filter(i => !(i.produto_id === produtoId && (i.tipo_operacao || 'VENDA') === tipoOps));
      }

      return prev.map(item => {
        if (item.produto_id === produtoId && (item.tipo_operacao || 'VENDA') === tipoOps) {
          const produto = produtos.find(p => p.id === produtoId)!;
          const pesoItem = qtd * produto.peso_embalagem;
          const discount = getValorUnitario(produto, currentFaixa) || 0;
          const unitario = calcularPrecoComDesconto(produto.custo_und, discount);
          const valorTotalItem = unitario * qtd * (produto.quant_embalagem || 1);
          
          return {
            ...item,
            quantidade: qtd,
            peso_total: pesoItem,
            valor_unitario: unitario,
            valor_total: valorTotalItem
          };
        }
        return item;
      });
    });
  };

  const updateItemType = (produtoId: string, currentType: string, newType: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING') => {
    setItens(prev => {
      const existingNewTypeIdx = prev.findIndex(i => i.produto_id === produtoId && (i.tipo_operacao || 'VENDA') === newType);
      const targetItemIdx = prev.findIndex(i => i.produto_id === produtoId && (i.tipo_operacao || 'VENDA') === currentType);
      
      if (targetItemIdx === -1) return prev;
      
      const targetItem = prev[targetItemIdx];
      
      if (existingNewTypeIdx !== -1 && existingNewTypeIdx !== targetItemIdx) {
        const existingNewType = prev[existingNewTypeIdx];
        const mergedQty = (existingNewType.quantidade || 0) + (targetItem.quantidade || 0);
        
        const nextList = prev.filter((_, idx) => idx !== targetItemIdx);
        return nextList.map(item => {
          if (item.produto_id === produtoId && (item.tipo_operacao || 'VENDA') === newType) {
            const produto = produtos.find(p => p.id === produtoId)!;
            const pesoItem = mergedQty * produto.peso_embalagem;
            const discount = getValorUnitario(produto, currentFaixa) || 0;
            const unitario = calcularPrecoComDesconto(produto.custo_und, discount);
            const valorTotalItem = unitario * mergedQty * (produto.quant_embalagem || 1);
            return {
              ...item,
              quantidade: mergedQty,
              peso_total: pesoItem,
              valor_unitario: unitario,
              valor_total: valorTotalItem
            };
          }
          return item;
        });
      } else {
        return prev.map((item, idx) => {
          if (idx === targetItemIdx) {
            return {
              ...item,
              tipo_operacao: newType
            };
          }
          return item;
        });
      }
    });
  };

  // Recalculate all items when faixa changes
  useEffect(() => {
    setItens(prev => prev.map(item => {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (!produto) return item;
      const discount = getValorUnitario(produto, currentFaixa) || 0;
      const unitario = calcularPrecoComDesconto(produto.custo_und, discount);
      const valorTotalItem = unitario * (item.quantidade || 0) * (produto.quant_embalagem || 1);
      
      return {
        ...item,
        valor_unitario: unitario,
        valor_total: valorTotalItem
      };
    }));
  }, [currentFaixa, produtos]);

  // Scroll to bottom when items are added
  useEffect(() => {
    if (itens.length > 0) {
      // Use a small timeout to allow the DOM to update with the new item
      const timer = setTimeout(() => {
        if (itemsEndRef.current) {
          // Scroll the element into view, aiming for the center to avoid fixed footer overlap
          itemsEndRef.current.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [itens.length]);

  const installmentDetails = useMemo(() => {
    if (!selectedPrazo || selectedPrazo === 'À Vista') {
      return {
        numBoletos: 1,
        valorBoleto: valorTotal,
        dataVencimento: null
      };
    }

    // Parse "02 Boletos (14-21)" or "01 Boleto (07)"
    const match = selectedPrazo.match(/(\d+)\s+Boleto[s]?\s+\((\d+)/);
    if (!match) return { numBoletos: 1, valorBoleto: valorTotal, dataVencimento: null };

    const numBoletos = parseInt(match[1], 10);
    const firstDays = parseInt(match[2], 10);
    const valorBoleto = valorTotal / numBoletos;

    // Calculation: Saturday of the following week + firstDays
    const today = new Date();
    const startOfThisWeek = startOfWeek(today, { weekStartsOn: 0 }); // Sunday
    const startOfNextWeek = addWeeks(startOfThisWeek, 1); // Next Sunday
    const followingSaturday = addDays(startOfNextWeek, 6); // Next Saturday
    const dataVencimento = addDays(followingSaturday, firstDays);

    return {
      numBoletos,
      valorBoleto,
      dataVencimento
    };
  }, [selectedPrazo, valorTotal]);

  const handleSave = async (shouldClear: boolean = true) => {
    if (!clienteId) return;

    if (itens.length === 0) {
      alert('Por favor, adicione pelo menos um produto ao pedido.');
      return;
    }

    if (!selectedPrazo || selectedPrazo === '') {
      alert('Por favor, selecione uma condição de pagamento.');
      return;
    }

    try {
      setIsGeneratingImage(true);
      
      // 1. Generate PDF
      if (receiptRef.current) {
        // Wait a bit for the DOM to be ready and styles to apply
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4'
        });

        const pages = receiptRef.current?.querySelectorAll('.pdf-page');
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
        const safeClientName = (cliente?.cliente || 'CLIENTE').replace(/[^a-zA-Z0-9]/g, '_');
        const fileName = `ORCAMENTO_${safeClientName}.pdf`;
        const file = new File([pdfBlob], fileName, { type: 'application/pdf' });

        // sharing logic
        const shareData = {
          files: [file],
          title: 'ORCAMENTO',
          text: `ORCAMENTO - ${cliente?.cliente}`,
        };

        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
          try {
            await navigator.share(shareData);
          } catch (shareErr) {
            console.error('Error sharing:', shareErr);
            // Fallback to download if share fails or is cancelled
            if ((shareErr as Error).name !== 'AbortError') {
              pdf.save(fileName);
            }
          }
        } else {
          // Fallback for browsers that don't support file sharing
          pdf.save(fileName);
          if (navigator.share) {
            alert('PDF gerado e baixado! Seu navegador não suportou o compartilhamento direto de arquivos (comum em alguns modelos ou versões antigas). Você pode enviar o arquivo baixado manualmente.');
          }
        }
      }

      if (shouldClear) {
        if (clienteId) {
          localStorage.removeItem(`pedido_${clienteId}`);
          // Also clean up from Supabase DB
          supabase.from('pedidos_em_aberto').delete().eq('cliente_id', clienteId).then(({ error }) => {
            if (error) console.error('Erro ao deletar do DB ao finalizar:', error);
          });
        }
        alert('Orçamento gerado com sucesso!');
        navigate(`/cliente/${clienteId}`);
      } else {
        alert('Orçamento compartilhado com sucesso!');
      }
    } catch (err) {
      console.error('Erro ao finalizar pedido:', err);
      alert('Erro ao finalizar pedido. Tente novamente.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  if (loading) return <StockCountSkeleton />;

  return (
    <div className="space-y-6 pb-44 md:pb-48">
      <header className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-white rounded-full transition-colors">
            <ArrowLeft size={24} />
          </button>
          <div>
            <h2 className="text-xl font-bold text-neutral-900">Novo Pedido</h2>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 text-sm text-neutral-500">
              <span className="font-semibold">{cliente?.cliente}</span>
              {startedAt && (
                <>
                  <span className="hidden sm:inline text-neutral-300">|</span>
                  <span className="text-orange-600 font-extrabold flex items-center gap-1">
                    Iniciado em: {(() => {
                      try {
                        const d = new Date(startedAt);
                        if (isNaN(d.getTime())) return '';
                        const day = String(d.getDate()).padStart(2, '0');
                        const month = String(d.getMonth() + 1).padStart(2, '0');
                        const year = d.getFullYear();
                        const hours = String(d.getHours()).padStart(2, '0');
                        const minutes = String(d.getMinutes()).padStart(2, '0');
                        return `${day}/${month}/${year} às ${hours}:${minutes}`;
                      } catch (e) {
                        return '';
                      }
                    })()}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => navigate(`/cliente/${clienteId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white text-neutral-700 rounded-lg font-bold text-sm border border-neutral-200 shadow-sm hover:bg-neutral-50 transition-all active:scale-95"
          >
            <Home size={18} className="text-orange-600" />
            <span>Home</span>
          </button>
          <button 
            onClick={() => navigate(`/estoque/${clienteId}`)}
            className="flex items-center gap-2 px-4 py-2 bg-white text-neutral-700 rounded-lg font-bold text-sm border border-neutral-200 shadow-sm hover:bg-neutral-50 transition-all active:scale-95"
          >
            <Package size={18} className="text-orange-600" />
            <span>Contagem</span>
          </button>
        </div>
      </header>

<div 
  className="fixed top-0 left-0 bg-white opacity-0 pointer-events-none z-[-100]" 
  ref={receiptRef}
  style={{ width: '800px', color: '#171717' }}
>
  {(() => {
    // Sort items alphabetically by product name
    const sortedItens = [...computedItens].sort((a, b) => {
      const prodA = produtos.find(p => p.id === a.produto_id)?.produto || '';
      const prodB = produtos.find(p => p.id === b.produto_id)?.produto || '';
      return prodA.localeCompare(prodB);
    });

    const orderDateStr = (() => {
      try {
        const d = startedAt ? new Date(startedAt) : new Date();
        return d.toLocaleDateString('pt-BR');
      } catch (e) {
        return new Date().toLocaleDateString('pt-BR');
      }
    })();

    const orderTimeStr = (() => {
      try {
        const d = startedAt ? new Date(startedAt) : new Date();
        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      }
    })();

    // Smart pagination: First page fits less items due to header/client info
    const chunks = [];
    let i = 0;
    let isFirstPage = true;
    
    while (i < sortedItens.length) {
      const itemsLimit = isFirstPage ? 10 : 15;
      chunks.push(sortedItens.slice(i, i + itemsLimit));
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
        <div className="flex justify-between items-start border-b-2 border-neutral-800 pb-6 mb-8" style={{ borderColor: '#262626' }}>
          <div className="flex flex-col">
            <h1 className="text-3xl font-black uppercase tracking-tighter" style={{ color: '#171717' }}>Resumo do Orçamento</h1>
            <div className="mt-2 space-y-1">
              <p className="text-sm font-bold" style={{ color: '#737373' }}>Data: {orderDateStr}</p>
              <p className="text-sm font-bold" style={{ color: '#737373' }}>Hora: {orderTimeStr}</p>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <img 
              src="https://wsrv.nl/?url=https://adimax.com.br/wp-content/uploads/2021/06/logo_adimax-04968c974e8e5d15ddb822152395b3f6.png&w=400&output=png" 
              alt="ADIMAX" 
              className="h-12 w-auto mb-1"
              crossOrigin="anonymous"
              referrerPolicy="no-referrer"
            />
            <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#a3a3a3' }}>Parceiro Oficial</span>
          </div>
        </div>

        {/* Client Info (Only on first page) */}
        {pageIdx === 0 && (
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div className="p-4 rounded-lg border" style={{ backgroundColor: '#fafafa', borderColor: '#f5f5f5' }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#a3a3a3' }}>Cliente</p>
              <p className="text-lg font-black leading-tight" style={{ color: '#171717' }}>{cliente?.cliente}</p>
              <p className="text-sm font-bold mt-1" style={{ color: '#737373' }}>{cliente?.cidade}</p>
            </div>
            <div className="p-4 rounded-lg border" style={{ backgroundColor: '#fafafa', borderColor: '#f5f5f5' }}>
              <p className="text-[10px] font-black uppercase tracking-widest mb-1" style={{ color: '#a3a3a3' }}>Vendedor</p>
              <p className="text-lg font-black leading-tight" style={{ color: '#171717' }}>MAICON OLIVEIRA</p>
              <p className="text-sm font-bold mt-1" style={{ color: '#737373' }}>Representante Comercial</p>
            </div>
          </div>
        )}

        {/* Items Table */}
        <div className="flex-1">
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: '#171717', color: '#ffffff' }}>
                <th className="py-3 px-4 text-left text-[10px] font-black uppercase tracking-widest rounded-tl-lg">Produto</th>
                <th className="py-3 px-4 text-center text-[10px] font-black uppercase tracking-widest">Qtd</th>
                <th className="py-3 px-4 text-center text-[10px] font-black uppercase tracking-widest">Peso</th>
                <th className="py-3 px-4 text-right text-[10px] font-black uppercase tracking-widest">Unitário</th>
                <th className="py-3 px-4 text-right text-[10px] font-black uppercase tracking-widest rounded-tr-lg">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f5f5f5]" style={{ borderColor: '#f5f5f5' }}>
              {chunk.map((item, idx) => {
                const produto = produtos.find(p => p.id === item.produto_id)!;
                return (
                  <tr key={idx} className="text-sm" style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#fafafa' }}>
                    <td className="py-4 px-4 font-bold leading-tight max-w-[300px] break-words" style={{ color: '#262626' }}>
                      <div>{produto?.produto}</div>
                      {item.tipo_operacao && item.tipo_operacao !== 'VENDA' && (
                        <div className="text-[9px] font-black tracking-widest text-orange-600 uppercase mt-0.5" style={{ color: '#ea580c' }}>
                          {item.tipo_operacao === 'BONIFICACAO_COMERCIAL' ? '• Bonificação' : '• Merchandising / Brinde'}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-4 text-center font-black" style={{ color: '#525252' }}>
                      {item.quantidade} {produto.quant_embalagem > 1 ? 'CX' : 'UN'}
                    </td>
                    <td className="py-4 px-4 text-center font-bold" style={{ color: '#737373' }}>
                      {formatWeight(item.peso_total || 0)}
                    </td>
                    <td className="py-4 px-4 text-right font-bold" style={{ color: '#737373' }}>
                      {formatCurrency(item.valor_unitario || 0)}
                    </td>
                    <td className="py-4 px-4 text-right font-black" style={{ color: '#171717' }}>
                      {formatCurrency(item.valor_total || 0)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Summary Section (Only on last page) */}
        {pageIdx === chunks.length - 1 && (
          <div className="mt-8 pt-8 border-t-2" style={{ borderColor: '#f5f5f5' }}>
            <div className="grid grid-cols-2 gap-12 items-stretch">
              <div className="flex flex-col gap-4">
                <div className="p-4 border rounded-lg" style={{ borderColor: '#e5e5e5' }}>
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: '#a3a3a3' }}>Condições de Pagamento</p>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm font-bold" style={{ color: '#525252' }}>Condição:</span>
                      <span className="text-sm font-black" style={{ color: '#171717' }}>{selectedPrazo}</span>
                    </div>
                    {selectedPrazo && selectedPrazo !== 'À Vista' && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-sm font-bold" style={{ color: '#525252' }}>Valor por Boleto:</span>
                          <span className="text-sm font-black" style={{ color: '#171717' }}>{formatCurrency(installmentDetails.valorBoleto)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-sm font-bold" style={{ color: '#525252' }}>1º Vencimento (Estimado):</span>
                          <span className="text-sm font-black" style={{ color: '#171717' }}>
                            {installmentDetails.dataVencimento ? format(installmentDetails.dataVencimento, 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                
                {observacoes && (
                  <div className="p-5 border-2 rounded-lg" style={{ borderColor: '#ffedd5', backgroundColor: '#fff7ed' }}>
                    <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: '#ea580c' }}>Observações Importantes</p>
                    <p className="text-sm font-black leading-relaxed whitespace-pre-wrap uppercase" style={{ color: '#171717' }}>{observacoes}</p>
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-between">
                <div className="space-y-4">
                  {pesoConquistado > 0 && (
                    <div className="flex justify-between items-center px-4 py-2 rounded-lg border opacity-60" style={{ backgroundColor: '#fafafa', borderColor: '#f5f5f5' }}>
                      <span className="text-[8px] font-black uppercase tracking-widest" style={{ color: '#a3a3a3' }}>Peso Acumulado (28 dias)</span>
                      <span className="text-sm font-bold" style={{ color: '#171717' }}>{formatWeight(pesoConquistado)}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-4 rounded-lg border" style={{ backgroundColor: '#fafafa', borderColor: '#f5f5f5' }}>
                    <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: '#a3a3a3' }}>Peso do Pedido</span>
                    <span className="text-xl font-black" style={{ color: '#171717' }}>{formatWeight(pesoTotal)}</span>
                  </div>
                </div>
                
                <div className="flex justify-between items-center p-6 rounded-lg shadow-xl" style={{ backgroundColor: '#171717' }}>
                  <span className="text-xs font-black uppercase tracking-widest" style={{ color: '#a3a3a3' }}>Valor Total do Orçamento</span>
                  <span className="text-3xl font-black" style={{ color: '#ffffff' }}>{formatCurrency(valorTotal)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-12 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: '#d4d4d4' }}>MAICON OLIVEIRA REPRESENTAÇÕES</p>
          <p className="text-[10px] font-bold mt-2 italic uppercase tracking-wider" style={{ color: '#a3a3a3' }}>Este documento é um orçamento e não possui validade fiscal.</p>
          <p className="text-[10px] font-bold mt-4" style={{ color: '#a3a3a3' }}>Página {pageIdx + 1} de {chunks.length}</p>
        </div>
      </div>
    ));
  })()}
</div>

      {/* Order Details */}
      {false && (
      <div ref={orderDetailsRef} className="bg-white p-4 rounded-lg border border-neutral-200 shadow-sm space-y-4 scroll-mt-4">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
          <div className="flex items-center gap-2">
            <FileText className="text-orange-600" size={18} />
            <div>
              <h3 className="font-black text-neutral-900 leading-tight">Dados do pedido</h3>
              <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Pagamento e observações</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-neutral-500 uppercase tracking-wider">Observações</label>
            <textarea 
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Digite aqui observações importantes..."
              className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none h-24"
            />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-neutral-500 uppercase tracking-wider">Pagamento</label>
              <div className="relative">
                <select
                  value={selectedPrazo}
                  onChange={(e) => setSelectedPrazo(e.target.value)}
                  className="w-full pl-3 pr-10 py-3 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all text-sm"
                >
                  <option value="" disabled>Selecione...</option>
                  {availableTerms.map((prazo) => (
                    <option key={prazo} value={prazo}>
                      {prazo}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                  <ChevronDown size={16} />
                </div>
              </div>
            </div>

            {selectedPrazo && selectedPrazo !== 'À Vista' && (
              <motion.div 
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="grid grid-cols-2 gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg"
              >
                <div>
                  <p className="text-[9px] font-black text-orange-600 uppercase tracking-wider">Valor Boleto</p>
                  <p className="text-sm font-black text-neutral-900">{formatCurrency(installmentDetails.valorBoleto)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-black text-orange-600 uppercase tracking-wider">1º Venc. Est.</p>
                  <p className="text-sm font-black text-neutral-900">
                    {installmentDetails.dataVencimento ? format(installmentDetails.dataVencimento, 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                  </p>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      )}

      {/* Items List */}
      <div className="space-y-3">
        <div className="px-1 py-3 border-b border-neutral-200">
          <h3 className="font-bold text-neutral-800">Itens do Orçamento</h3>
        </div>

        {itens.filter(item => !item.tipo_operacao || item.tipo_operacao === 'VENDA').length === 0 ? (
          <div className="bg-white p-12 rounded-lg border border-dashed border-neutral-300 text-center text-neutral-400 font-bold text-xs uppercase tracking-wider">
            Nenhum item de venda adicionado.
          </div>
        ) : (
          <div className="space-y-3">
            {computedItens
              .filter(item => !item.tipo_operacao || item.tipo_operacao === 'VENDA')
              .map((item, index) => {
                const produto = produtos.find(p => p.id === item.produto_id);
                if (!produto) return null;
                
                const opType = item.tipo_operacao || 'VENDA';

                return (
                  <div key={`${item.produto_id}_${opType}`} className="bg-white p-4 rounded-lg border border-neutral-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-all border-l-4 border-l-blue-500">
                    <div className="flex-1">
                      <h4 className="font-bold text-neutral-900">{produto.produto}</h4>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                        <span>{(produto.peso_embalagem / (produto.quant_embalagem || 1)).toFixed(2)}kg / un</span>
                        <span className="text-neutral-300">|</span>
                        <span>Total: {formatWeight(item.peso_total || 0)}</span>
                        <span className="text-neutral-300">|</span>
                        <span>{formatCurrency(item.valor_unitario || 0)} / un</span>
                      </div>
                      <p className="text-orange-600 font-bold mt-1">{formatCurrency(item.valor_total || 0)}</p>
                    </div>
                    <div className="flex items-center gap-2 self-end md:self-auto">
                      <button 
                        onClick={() => updateItem(item.produto_id!, 0, opType)}
                        className="w-8 h-8 flex items-center justify-center bg-red-50 rounded-lg text-red-600 hover:bg-red-100 transition-colors"
                        title="Remover item"
                      >
                        <Trash2 size={16} />
                      </button>
                      <div className="flex items-center gap-3 bg-neutral-50 p-1 rounded-lg border border-neutral-100">
                        <button 
                          onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) - 1, opType)}
                          className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-neutral-600"
                        >
                          <Minus size={16} />
                        </button>
                        <input 
                          type="number" 
                          inputMode="numeric"
                          pattern="[0-9]*"
                          className="w-10 text-center font-bold text-neutral-900 bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          value={item.quantidade || ''}
                          onChange={(e) => updateItem(item.produto_id!, parseInt(e.target.value) || 0, opType)}
                        />
                        <button 
                          onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) + 1, opType)}
                          className="w-8 h-8 flex items-center justify-center bg-orange-600 rounded-lg shadow-sm text-white"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        <button 
          onClick={() => {
            setProductSelectorType('VENDA');
            setShowProductSelector(true);
          }}
          className="w-full py-4 bg-white rounded-lg border-2 border-dashed border-orange-200 text-orange-600 font-bold flex items-center justify-center gap-2 hover:bg-orange-50 transition-all active:scale-95 mt-4"
        >
          <Plus size={20} /> Adicionar Produto
        </button>

        <AnimatePresence>
          {showOrderDetails && (
            <motion.div
              ref={orderDetailsRef}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="bg-white p-4 rounded-lg border border-neutral-200 shadow-sm space-y-4 scroll-mt-4"
            >
              <div className="flex items-center justify-between gap-3 border-b border-neutral-100 pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="text-orange-600" size={18} />
                  <div>
                    <h3 className="font-black text-neutral-900 leading-tight">Dados do pedido</h3>
                    <p className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">Pagamento e observações</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-neutral-500 uppercase tracking-wider">Observações</label>
                  <textarea
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Digite aqui observações importantes..."
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-medium text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 transition-all resize-none h-24"
                  />
                </div>

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-neutral-500 uppercase tracking-wider">Pagamento</label>
                    <div className="relative">
                      <select
                        value={selectedPrazo}
                        onChange={(e) => setSelectedPrazo(e.target.value)}
                        className="w-full pl-3 pr-10 py-3 bg-neutral-50 border border-neutral-200 rounded-lg font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all text-sm"
                      >
                        <option value="" disabled>Selecione...</option>
                        {availableTerms.map((prazo) => (
                          <option key={prazo} value={prazo}>
                            {prazo}
                          </option>
                        ))}
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                        <ChevronDown size={16} />
                      </div>
                    </div>
                  </div>

                  {selectedPrazo && selectedPrazo !== 'À Vista' && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="grid grid-cols-2 gap-3 p-3 bg-orange-50 border border-orange-100 rounded-lg"
                    >
                      <div>
                        <p className="text-[9px] font-black text-orange-600 uppercase tracking-wider">Valor Boleto</p>
                        <p className="text-sm font-black text-neutral-900">{formatCurrency(installmentDetails.valorBoleto)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[9px] font-black text-orange-600 uppercase tracking-wider">1º Venc. Est.</p>
                        <p className="text-sm font-black text-neutral-900">
                          {installmentDetails.dataVencimento ? format(installmentDetails.dataVencimento, 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Verba Flex Card Section */}
        {showFlexCard && (
          <div className="bg-neutral-50 p-4 rounded-lg border border-neutral-200 shadow-xs space-y-3 mt-4">
            <div className="flex justify-between items-center pb-2 border-b border-neutral-200">
              <div className="flex items-center gap-2">
                <Coins size={18} className="text-orange-600" />
                <span className="text-xs font-black uppercase text-neutral-800 tracking-wider">Verba Flex Comercial</span>
              </div>
              <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-bold">Painel de Controle</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3 text-xs font-bold text-neutral-600">
              <div className="p-2.5 bg-white border border-neutral-200/50 rounded-lg">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-black">Saldo Acumulado</p>
                <p className="text-sm font-extrabold text-neutral-900 mt-0.5">{formatCurrency(cliente?.flex_saldo || 0)}</p>
              </div>
              <div className="p-2.5 bg-white border border-neutral-200/50 rounded-lg">
                <p className="text-[10px] text-neutral-400 uppercase tracking-widest font-black">Gerado no Faturamento</p>
                <p className="text-sm font-extrabold text-green-600 mt-0.5">+{formatCurrency(verbaGeradaEstimada)} (2%)</p>
              </div>
            </div>

            {/* Discount consumption from orders removed from Flex rules */}

            {/* Inserir Item Bonificado inside this Card */}
            <div className="pt-2 border-t border-neutral-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-neutral-500 tracking-wider flex items-center gap-1">
                  <Coins size={12} className="text-orange-500" />
                  Itens Bonificados (Flex)
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProductSelectorType('BONIFICACAO_COMERCIAL');
                    setShowProductSelector(true);
                  }}
                  className="px-2.5 py-1 bg-orange-600 text-white rounded-lg text-xs font-bold hover:bg-orange-700 transition-all flex items-center gap-1 shadow-sm active:scale-95"
                >
                  <Plus size={12} />
                  <span>Inserir Item Bonificado</span>
                </button>
              </div>

              {itens.filter(item => (item.tipo_operacao || 'VENDA') === 'BONIFICACAO_COMERCIAL').length === 0 ? (
                <p className="text-[11px] text-neutral-400 italic bg-white p-3 rounded-lg border border-neutral-100/50 text-center">
                  Nenhum item bonificado adicionado ainda.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {computedItens
                    .filter(item => (item.tipo_operacao || 'VENDA') === 'BONIFICACAO_COMERCIAL')
                    .map(item => {
                      const produto = produtos.find(p => p.id === item.produto_id);
                      if (!produto) return null;
                      return (
                        <div key={item.produto_id} className="flex items-center justify-between p-2.5 bg-white border border-neutral-200/50 rounded-lg">
                          <div className="flex-1 min-w-0 pr-2">
                            <p className="text-[11px] font-bold text-neutral-800 truncate">{produto.produto}</p>
                            <p className="text-[9px] text-neutral-400 font-medium">
                              {item.quantidade} x R$ {(item.valor_unitario || 0).toFixed(2)} | Peso: {formatWeight(item.peso_total || 0)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) - 1, 'BONIFICACAO_COMERCIAL')}
                              className="w-5 h-5 flex items-center justify-center bg-neutral-100 rounded text-neutral-600 hover:bg-neutral-200"
                            >
                              <Minus size={11} />
                            </button>
                            <span className="text-xs font-black min-w-[14px] text-center">{item.quantidade}</span>
                            <button
                              type="button"
                              onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) + 1, 'BONIFICACAO_COMERCIAL')}
                              className="w-5 h-5 flex items-center justify-center bg-orange-600 rounded text-white hover:bg-orange-700"
                            >
                              <Plus size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={() => updateItem(item.produto_id!, 0, 'BONIFICACAO_COMERCIAL')}
                              className="w-5 h-5 flex items-center justify-center bg-red-50 text-red-650 rounded hover:bg-red-100 ml-1"
                              title="Remover bonificação"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* Consumption summaries */}
            <div className="space-y-1.5 text-[11px] font-bold text-neutral-500 border-t border-dashed border-neutral-200 pt-2.5">
              <div className="flex justify-between">
                <span>Total Consumido por Bonificações:</span>
                <span className="text-orange-600 font-extrabold">{formatCurrency(totalBonificacoes)}</span>
              </div>
              <div className="flex justify-between">
                <span>Total Consumido por Merchandising:</span>
                <span className="text-purple-600 font-extrabold">{formatCurrency(totalMerchandising)}</span>
              </div>
              <div className="flex justify-between border-t border-neutral-100 pt-1 text-xs font-extrabold text-neutral-900">
                <span>Projeção de Saldo Pós-Faturamento:</span>
                <span className={cn(
                  (cliente?.flex_saldo || 0) + verbaGeradaEstimada - totalBonificacoes - totalMerchandising >= 0 
                    ? "text-emerald-600" 
                    : "text-rose-600 animate-pulse"
                )}>
                  {formatCurrency(Number(((cliente?.flex_saldo || 0) + verbaGeradaEstimada - totalBonificacoes - totalMerchandising).toFixed(2)))}
                </span>
              </div>
            </div>

            <p className="text-[9px] font-semibold text-neutral-400 italic text-center leading-tight">
              *Saldo sujeito a alteração devido a pedidos ainda não faturados pelo ERP.
            </p>
          </div>
        )}

        <div ref={itemsEndRef} className="h-20" />
      </div>

      {/* Bottom Section (Fixed) */}
      {createPortal(<div
        ref={orderFooterRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-md border-t border-neutral-200 shadow-[0_-8px_18px_rgba(0,0,0,0.08)] p-2 pb-[calc(8px+env(safe-area-inset-bottom))] md:p-3 md:pb-[calc(12px+env(safe-area-inset-bottom))] will-change-transform"
      >
        <div className="max-w-4xl mx-auto space-y-2">
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-orange-600 p-2 text-white shadow-sm">
            <div className="min-w-0 text-center">
              <p className="text-[8px] uppercase font-bold opacity-80">Peso</p>
              <p className="text-xs md:text-sm font-black truncate">{formatWeight(pesoTotal)}</p>
            </div>
            <div className="min-w-0 text-center border-x border-white/20 px-1">
              <p className="text-[8px] uppercase font-bold opacity-80">Faixa</p>
              <p className="text-[10px] md:text-xs font-black truncate">{faixaPreco}</p>
            </div>
            <div className="min-w-0 text-center border-r border-white/20 px-1">
              <p className="text-[8px] uppercase font-bold opacity-80">Recompra</p>
              <p className="text-[10px] md:text-xs font-black truncate">{pesoConquistado > 0 ? formatWeight(pesoConquistado) : '-'}</p>
            </div>
            <div className="min-w-0 text-right">
              <p className="text-[8px] uppercase font-bold opacity-80">Total</p>
              <p className="text-xs md:text-sm font-black truncate">{formatCurrency(valorTotal)}</p>
            </div>
          </div>

          <div className="flex gap-2">
            {showClearConfirm ? (
              <div className="flex-1 bg-white p-1 rounded-lg border-2 border-red-200 shadow-lg flex gap-2 items-center">
                <p className="text-[10px] font-bold text-neutral-800 flex-1 px-1">Limpar?</p>
                <button 
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-2 bg-neutral-100 text-neutral-600 rounded-lg font-bold text-[10px]"
                >
                  Não
                </button>
                <button 
                  onClick={handleClearOrder}
                  className="px-3 py-2 bg-red-600 text-white rounded-lg font-bold text-[10px]"
                >
                  Sim
                </button>
              </div>
            ) : (
              <>
                <button 
                  onClick={() => {
                    setShowOrderDetails((current) => {
                      const next = !current;
                      if (!current) {
                        window.setTimeout(() => {
                          orderDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 80);
                      }
                      return next;
                    });
                  }}
                  className={cn(
                    "flex-1 py-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all text-[11px]",
                    showOrderDetails
                      ? "bg-orange-600 text-white ring-2 ring-orange-300"
                      : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                  )}
                >
                  <FileText size={15} /> Dados
                </button>
                <button 
                  onClick={() => setShowFlexCard(!showFlexCard)}
                  className={cn(
                    "px-3 py-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all text-[11px] shadow-sm",
                    showFlexCard 
                      ? "bg-orange-600 text-white ring-2 ring-orange-300" 
                      : "bg-orange-50 border border-orange-200 text-orange-700 hover:bg-orange-100"
                  )}
                  title="Verba Flex"
                >
                  <Coins size={15} className={showFlexCard ? "animate-pulse" : ""} />
                  <span>FX</span>
                </button>
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="flex-1 bg-neutral-100 text-neutral-600 py-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 hover:bg-neutral-200 transition-all text-[11px]"
                >
                  <Trash2 size={15} /> Limpar
                </button>
                <button 
                  onClick={() => setShowPreview(true)}
                  className="flex-1 bg-white border border-neutral-200 text-neutral-700 py-2.5 rounded-lg font-bold flex items-center justify-center gap-1.5 hover:bg-neutral-50 transition-all text-[11px]"
                >
                  <Eye size={15} /> Ver
                </button>
              </>
            )}
            <button 
              onClick={() => handleSave(true)}
              disabled={isGeneratingImage}
              className="flex-[1.35] bg-green-600 text-white py-2.5 rounded-lg font-bold shadow-md flex items-center justify-center gap-1.5 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-[11px]"
            >
              {isGeneratingImage ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Save size={15} />
              )}
              <span>{isGeneratingImage ? 'Gerando...' : 'Finalizar'}</span>
            </button>
          </div>
        </div>
      </div>, document.body)}

      {/* PDF Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-neutral-100 w-full max-w-4xl h-[90vh] rounded-lg overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="bg-white p-4 border-b border-neutral-200 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-100 text-orange-600 rounded-lg">
                    <FileText size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-neutral-900">Visualização do Orçamento</h3>
                    <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Confira os dados antes de compartilhar</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => handleSave(false)}
                    disabled={isGeneratingImage}
                    className="px-4 py-2 bg-orange-600 text-white rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-orange-700 transition-all disabled:opacity-50"
                  >
                    {isGeneratingImage ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Share2 size={18} />
                    )}
                    <span>{isGeneratingImage ? 'Gerando...' : 'Compartilhar'}</span>
                  </button>
                  <button 
                    onClick={() => setShowPreview(false)} 
                    className="p-2 text-neutral-400 hover:bg-neutral-100 rounded-full transition-colors"
                  >
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 bg-neutral-200/50">
                <div className="max-w-[800px] mx-auto shadow-2xl">
                  {(() => {
                    const sortedItens = [...computedItens].sort((a, b) => {
                      const prodA = produtos.find(p => p.id === a.produto_id)?.produto || '';
                      const prodB = produtos.find(p => p.id === b.produto_id)?.produto || '';
                      return prodA.localeCompare(prodB);
                    });

                    const orderDateStr = (() => {
                      try {
                        const d = startedAt ? new Date(startedAt) : new Date();
                        return d.toLocaleDateString('pt-BR');
                      } catch (e) {
                        return new Date().toLocaleDateString('pt-BR');
                      }
                    })();

                    const orderTimeStr = (() => {
                      try {
                        const d = startedAt ? new Date(startedAt) : new Date();
                        return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      } catch (e) {
                        return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      }
                    })();

                    const chunks = [];
                    let i = 0;
                    let isFirstPage = true;
                    while (i < sortedItens.length) {
                      const itemsLimit = isFirstPage ? 10 : 15;
                      chunks.push(sortedItens.slice(i, i + itemsLimit));
                      i += itemsLimit;
                      isFirstPage = false;
                    }

                    return chunks.map((chunk, pageIdx) => (
                      <div 
                        key={pageIdx}
                        className="w-full aspect-[1/1.414] bg-white p-[5%] flex flex-col font-sans text-[#171717] mb-8 last:mb-0 rounded-sm"
                        style={{ fontFamily: 'Arial, sans-serif' }}
                      >
                        {/* Header */}
                        <div className="flex justify-between items-start border-b-2 border-[#262626] pb-4 mb-6">
                          <div className="flex flex-col">
                            <h1 className="text-2xl font-black uppercase tracking-tighter text-[#171717]">Resumo do Orçamento</h1>
                            <div className="mt-1 space-y-0.5">
                              <p className="text-[10px] font-bold text-[#737373]">Data: {orderDateStr}</p>
                              <p className="text-[10px] font-bold text-[#737373]">Hora: {orderTimeStr}</p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end">
                            <img 
                              src="https://wsrv.nl/?url=https://adimax.com.br/wp-content/uploads/2021/06/logo_adimax-04968c974e8e5d15ddb822152395b3f6.png&w=300&output=png" 
                              alt="ADIMAX" 
                              className="h-8 w-auto mb-1"
                              crossOrigin="anonymous"
                              referrerPolicy="no-referrer"
                            />
                            <span className="text-[6px] font-black text-[#a3a3a3] uppercase tracking-widest">Parceiro Oficial</span>
                          </div>
                        </div>

                        {/* Client Info */}
                        {pageIdx === 0 && (
                          <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="p-3 bg-[#fafafa] rounded-lg border border-[#f5f5f5]">
                              <p className="text-[8px] font-black text-[#a3a3a3] uppercase tracking-widest mb-0.5">Cliente</p>
                              <p className="text-sm font-black text-[#171717] leading-tight">{cliente?.cliente}</p>
                              <p className="text-[10px] font-bold text-[#737373] mt-0.5">{cliente?.cidade}</p>
                            </div>
                            <div className="p-3 bg-[#fafafa] rounded-lg border border-[#f5f5f5]">
                              <p className="text-[8px] font-black text-[#a3a3a3] uppercase tracking-widest mb-0.5">Vendedor</p>
                              <p className="text-sm font-black text-[#171717] leading-tight">MAICON OLIVEIRA</p>
                              <p className="text-[10px] font-bold text-[#737373] mt-0.5">Representante Comercial</p>
                            </div>
                          </div>
                        )}

                        {/* Items Table */}
                        <div className="flex-1 overflow-hidden">
                          <table className="w-full border-collapse">
                            <thead>
                              <tr className="bg-[#171717] text-[#ffffff]">
                                <th className="py-2 px-3 text-left text-[8px] font-black uppercase tracking-widest rounded-tl-md">Produto</th>
                                <th className="py-2 px-3 text-center text-[8px] font-black uppercase tracking-widest">Qtd</th>
                                <th className="py-2 px-3 text-center text-[8px] font-black uppercase tracking-widest">Peso</th>
                                <th className="py-2 px-3 text-right text-[8px] font-black uppercase tracking-widest">Unitário</th>
                                <th className="py-2 px-3 text-right text-[8px] font-black uppercase tracking-widest rounded-tr-md">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#f5f5f5]">
                              {chunk.map((item, idx) => {
                                const produto = produtos.find(p => p.id === item.produto_id)!;
                                return (
                                  <tr key={idx} className={cn("text-[10px]", idx % 2 === 0 ? "bg-[#ffffff]" : "bg-[#fafafa]")}>
                                    <td className="py-2 px-3 font-bold text-[#262626] leading-tight max-w-[200px] break-words">
                                      <div>{produto?.produto}</div>
                                      {item.tipo_operacao && item.tipo_operacao !== 'VENDA' && (
                                        <div className="text-[8px] font-black tracking-widest text-[#ea580c] uppercase mt-0.5">
                                          {item.tipo_operacao === 'BONIFICACAO_COMERCIAL' ? '• Bonificação' : '• Merchandising'}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-center font-black text-[#525252]">
                                      {item.quantidade} {produto.quant_embalagem > 1 ? 'CX' : 'UN'}
                                    </td>
                                    <td className="py-2 px-3 text-center font-bold text-[#737373]">
                                      {formatWeight(item.peso_total || 0)}
                                    </td>
                                    <td className="py-2 px-3 text-right font-bold text-[#737373]">
                                      {formatCurrency(item.valor_unitario || 0)}
                                    </td>
                                    <td className="py-2 px-3 text-right font-black text-[#171717]">
                                      {formatCurrency(item.valor_total || 0)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Summary Section */}
                        {pageIdx === chunks.length - 1 && (
                          <div className="mt-6 pt-6 border-t-2 border-[#f5f5f5]">
                            <div className="grid grid-cols-2 gap-8 items-stretch">
                              <div className="flex flex-col gap-3">
                                <div className="p-3 border border-[#e5e5e5] rounded-lg">
                                  <p className="text-[8px] font-black text-[#a3a3a3] uppercase tracking-widest mb-1.5">Condições de Pagamento</p>
                                  <div className="space-y-1">
                                    <div className="flex justify-between">
                                      <span className="text-[10px] font-bold text-[#525252]">Condição:</span>
                                      <span className="text-[10px] font-black text-[#171717]">{selectedPrazo}</span>
                                    </div>
                                    {selectedPrazo && selectedPrazo !== 'À Vista' && (
                                      <>
                                        <div className="flex justify-between">
                                          <span className="text-[10px] font-bold text-[#525252]">Valor por Boleto:</span>
                                          <span className="text-[10px] font-black text-[#171717]">{formatCurrency(installmentDetails.valorBoleto)}</span>
                                        </div>
                                        <div className="flex justify-between">
                                          <span className="text-[10px] font-bold text-[#525252]">1º Vencimento (Estimado):</span>
                                          <span className="text-[10px] font-black text-[#171717]">
                                            {installmentDetails.dataVencimento ? format(installmentDetails.dataVencimento, 'dd/MM/yyyy', { locale: ptBR }) : '-'}
                                          </span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                                
                                {observacoes && (
                                  <div className="p-4 border-2 rounded-lg" style={{ borderColor: '#ffedd5', backgroundColor: 'rgba(255, 247, 237, 0.3)' }}>
                                    <p className="text-[8px] font-black uppercase tracking-widest mb-1.5" style={{ color: '#ea580c' }}>Observações Importantes</p>
                                    <p className="text-[11px] font-black text-[#171717] leading-relaxed whitespace-pre-wrap uppercase">{observacoes}</p>
                                  </div>
                                )}
                              </div>

                              <div className="flex flex-col justify-between">
                                <div className="space-y-3">
                                  {pesoConquistado > 0 && (
                                    <div className="flex justify-between items-center px-3 py-2 bg-[#fafafa] rounded-lg border border-[#f5f5f5] opacity-60">
                                      <span className="text-[7px] font-black text-[#a3a3a3] uppercase tracking-widest">Peso Acumulado (28 dias)</span>
                                      <span className="text-xs font-bold text-[#171717]">{formatWeight(pesoConquistado)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between items-center p-3 bg-[#fafafa] rounded-lg border border-[#f5f5f5]">
                                    <span className="text-[8px] font-black text-[#a3a3a3] uppercase tracking-widest">Peso do Pedido</span>
                                    <span className="text-sm font-black text-[#171717]">{formatWeight(pesoTotal)}</span>
                                  </div>
                                </div>
                                <div className="flex justify-between items-center p-4 bg-[#171717] rounded-lg shadow-lg">
                                  <span className="text-[10px] font-black text-[#a3a3a3] uppercase tracking-widest">Total</span>
                                  <span className="text-xl font-black text-[#ffffff]">{formatCurrency(valorTotal)}</span>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Footer */}
                        <div className="mt-8 text-center">
                          <p className="text-[8px] font-black text-[#d4d4d4] uppercase tracking-[0.2em]">MAICON OLIVEIRA REPRESENTAÇÕES</p>
                          <p className="text-[8px] font-bold text-[#a3a3a3] mt-1 italic uppercase tracking-wider">Este documento é um orçamento e não possui validade fiscal.</p>
                          <p className="text-[8px] font-bold text-[#a3a3a3] mt-2">Página {pageIdx + 1} de {chunks.length}</p>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Product Selector Modal */}
      <AnimatePresence>
        {showProductSelector && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[100] flex items-end md:items-center justify-center p-4"
          >
            <motion.div 
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              className="bg-white w-full max-w-lg rounded-t-lg md:rounded-lg p-6 max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">
                  {productSelectorType === 'BONIFICACAO_COMERCIAL' ? 'Selecionar Produto Bonificado (Flex)' : 'Selecionar Produto'}
                </h3>
                <button onClick={() => setShowProductSelector(false)} className="p-2 text-neutral-400">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex flex-col gap-3 mb-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                    <input 
                      type="text" 
                      placeholder="Filtrar produtos..."
                      className="w-full pl-10 pr-10 py-3 bg-neutral-100 rounded-lg outline-none focus:ring-2 focus:ring-orange-500"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    {searchTerm && (
                      <button
                        onClick={() => setSearchTerm('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1 transition-colors"
                      >
                        <X size={18} />
                      </button>
                    )}
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-neutral-100 px-4 py-3 rounded-lg border border-neutral-200">
                    <input 
                      type="checkbox" 
                      checked={showOnlyPositivados}
                      onChange={(e) => setShowOnlyPositivados(e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-xs font-bold text-neutral-700">Positivados</span>
                  </label>
                </div>
                
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <select
                      value={selectedFamily}
                      onChange={(e) => setSelectedFamily(e.target.value)}
                      className="w-full pl-4 pr-10 py-3 bg-neutral-100 rounded-lg font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all text-xs"
                    >
                      {families.map((family) => (
                        <option key={family} value={family}>
                          {family}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                      <ChevronDown size={16} />
                    </div>
                  </div>

                  {/* Packaging / Embalagem Selector */}
                  <div className="relative flex-1">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                      <TrendingDown size={16} />
                    </div>
                    <select
                      value={selectedWeight}
                      onChange={(e) => setSelectedWeight(e.target.value)}
                      className="w-full pl-9 pr-8 py-3 bg-neutral-100 rounded-lg font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all text-xs"
                    >
                      {weights.map(w => (
                        <option key={w} value={w}>
                          {w === 'Todos' ? 'Emb: Todos' : formatWeight(Number(w))}
                        </option>
                      ))}
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                      <ChevronDown size={16} />
                    </div>
                  </div>

                  <div className="relative flex-1">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                      <TrendingUp size={16} />
                    </div>
                    <select
                      value={currentFaixa}
                      onChange={(e) => setManualFaixa(e.target.value as PrecoFaixa)}
                      className="w-full pl-9 pr-8 py-3 bg-orange-50 rounded-lg font-black text-orange-700 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all border border-orange-100 text-xs"
                    >
                      <option value="livre">Livre</option>
                      <option value="200kg">200kg</option>
                      <option value="500kg">500kg</option>
                      <option value="1000kg">1000kg</option>
                      <option value="2000kg">2000kg</option>
                      <option value="4000kg">4000kg</option>
                    </select>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-orange-400">
                      <ChevronDown size={16} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {filteredAndSortedProducts.map(produto => {
                  const lastPurchase = lastPurchaseByProduct.get(produto.id);

                  return (
                    <button
                      key={produto.id}
                      onClick={() => addItem(produto, productSelectorType)}
                      className="w-full text-left p-4 rounded-lg border border-neutral-100 hover:bg-orange-50 hover:border-orange-200 transition-all flex justify-between items-center gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="px-2 py-0.5 bg-neutral-100 text-neutral-500 text-[8px] font-bold rounded uppercase">
                            {produto.familia}
                          </span>
                          {lastPurchase && (
                            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-black rounded-full">
                              Últ. compra: {lastPurchase.quantidade}
                            </span>
                          )}
                        </div>
                        <p className="font-bold text-neutral-900 break-words">{produto.produto}</p>
                        <p className="text-xs text-neutral-500">
                          {(produto.peso_embalagem / (produto.quant_embalagem || 1)).toFixed(2)}kg / un
                          {lastPurchase ? ` • há ${lastPurchase.dias} dias` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-orange-600">
                          {formatCurrency(calcularPrecoComDesconto(produto.custo_und, getValorUnitario(produto, currentFaixa)))}
                        </p>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase">Por Unidade</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
