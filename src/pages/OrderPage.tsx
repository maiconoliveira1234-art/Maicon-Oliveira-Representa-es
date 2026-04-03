import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { toJpeg } from 'html-to-image';
import { 
  ArrowLeft, 
  ShoppingCart, 
  History, 
  Package, 
  Target, 
  TrendingUp, 
  Calendar,
  Plus,
  Minus,
  Save,
  Trash2,
  Search,
  ChevronDown,
  Share2,
  X
} from 'lucide-react';
import { Cliente, Produto, ItemPedido, PrecoFaixa } from '../types';
import { supabase } from '../lib/supabase';
import { getFromLocal } from '../lib/offline';
import { 
  getFaixaPreco, 
  getValorUnitario, 
  deveManterFaixaAnterior 
} from '../lib/calculations';
import { cn, formatCurrency, formatWeight } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { getAvailableTerms } from '../lib/paymentTerms';

import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from '../lib/mockData';

export function OrderPage() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [itens, setItens] = useState<Partial<ItemPedido>[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [selectedPrazo, setSelectedPrazo] = useState('');
  const [selectedFamily, setSelectedFamily] = useState('Todas');
  const [showOnlyPositivados, setShowOnlyPositivados] = useState(false);
  const [positivadosIds, setPositivadosIds] = useState<Set<string>>(new Set());
  const itemsEndRef = React.useRef<HTMLDivElement>(null);

  const families = useMemo(() => {
    const uniqueFamilies = Array.from(new Set(produtos.map(p => p.familia).filter(Boolean)));
    return ['Todas', ...uniqueFamilies.sort()];
  }, [produtos]);

  const filteredAndSortedProducts = useMemo(() => {
    return produtos
      .filter(p => {
        const matchesSearch = (p.produto?.toLowerCase() || '').includes(searchTerm.toLowerCase());
        const matchesFamily = selectedFamily === 'Todas' || p.familia === selectedFamily;
        const matchesPositivados = !showOnlyPositivados || positivadosIds.has(p.id);
        return matchesSearch && matchesFamily && matchesPositivados;
      })
      .sort((a, b) => {
        // First sort by family
        const familyCompare = (a.familia || '').localeCompare(b.familia || '');
        if (familyCompare !== 0) return familyCompare;
        // Then sort by product name
        return (a.produto || '').localeCompare(b.produto || '');
      });
  }, [produtos, searchTerm, selectedFamily, showOnlyPositivados, positivadosIds]);

  useEffect(() => {
    async function loadData() {
      if (!clienteId) return;
      
      try {
        // Load Cliente
        const { data: clienteData, error: cError } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', clienteId)
          .single();
        
        if (cError) {
          console.error('Supabase Error (order cliente):', cError.message);
          setCliente(MOCK_CLIENTES.find(c => c.id === clienteId) || null);
        } else if (!clienteData) {
          setCliente(MOCK_CLIENTES.find(c => c.id === clienteId) || null);
        } else {
          setCliente(clienteData);
        }

        // Load Produtos
        const { data: produtosData, error: pError } = await supabase
          .from('produtos')
          .select('*')
          .order('produto');
        
        if (pError) {
          console.error('Supabase Error (order produtos):', pError.message);
          setProdutos(MOCK_PRODUTOS);
        } else if (!produtosData || produtosData.length === 0) {
          setProdutos(MOCK_PRODUTOS);
        } else {
          setProdutos(produtosData);
        }

        // Load Positivados (previously purchased products)
        const { data: histData, error: hError } = await supabase
          .from('hist_vendas')
          .select('produto_id, produtos')
          .eq('cliente_id', clienteId);
        
        if (!hError && histData && histData.length > 0) {
          const ids = new Set<string>();
          histData.forEach(h => {
            if (h.produto_id) ids.add(h.produto_id);
            // Fallback: if we have the name, find the product ID from our loaded products
            else if (h.produtos) {
              const matched = produtosData?.find(p => p.produto.toLowerCase() === h.produtos.toLowerCase());
              if (matched) ids.add(matched.id);
            }
          });
          setPositivadosIds(ids);
        } else {
          // Fallback to mock data
          const mockIds = new Set(
            MOCK_HISTORICO
              .filter(h => h.cliente_id === clienteId)
              .map(h => h.produto_id)
          );
          setPositivadosIds(mockIds);
        }
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
        setCliente(MOCK_CLIENTES.find(c => c.id === clienteId) || null);
        setProdutos(MOCK_PRODUTOS);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [clienteId]);

  const pesoTotal = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.peso_total || 0), 0);
  }, [itens]);

  const faixaPreco = useMemo(() => {
    const faixaCalculada = getFaixaPreco(pesoTotal);
    
    if (cliente && deveManterFaixaAnterior(cliente.ultima_compra)) {
      return faixaCalculada; 
    }
    
    return faixaCalculada;
  }, [pesoTotal, cliente]);

  const prefilledApplied = React.useRef(false);

  // Clear items when client changes
  useEffect(() => {
    setItens([]);
    prefilledApplied.current = false;
  }, [clienteId]);

  // Handle prefilled items from StockCountPage
  useEffect(() => {
    if (!loading && produtos.length > 0 && location.state?.prefilledItems && !prefilledApplied.current) {
      const prefilled = location.state.prefilledItems as Record<string, number>;
      const newItens: Partial<ItemPedido>[] = [];
      
      Object.entries(prefilled).forEach(([produtoId, extraQtd]) => {
        const produto = produtos.find(p => p.id === produtoId);
        if (!produto) return;

        if (extraQtd > 0) {
          const discount = getValorUnitario(produto, faixaPreco) || 0;
          const unitario = produto.custo_und * (1 - discount);
          const valorTotalItem = unitario * extraQtd * (produto.quant_embalagem || 1);
          
          newItens.push({
            produto_id: produtoId,
            quantidade: extraQtd,
            peso_total: extraQtd * produto.peso_embalagem,
            valor_unitario: unitario,
            valor_total: valorTotalItem
          });
        }
      });

      if (newItens.length > 0) {
        setItens(newItens);
      }
      prefilledApplied.current = true;
    }
  }, [loading, produtos, location.state, faixaPreco]);

  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const receiptRef = React.useRef<HTMLDivElement>(null);

  const handleClearOrder = () => {
    setItens([]);
    setShowClearConfirm(false);
  };

  const valorTotal = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.valor_total || 0), 0);
  }, [itens]);

  const availableTerms = useMemo(() => {
    return getAvailableTerms(valorTotal);
  }, [valorTotal]);

  // Reset selected term if it's no longer available
  useEffect(() => {
    if (selectedPrazo && !availableTerms.includes(selectedPrazo)) {
      setSelectedPrazo('');
    }
  }, [availableTerms, selectedPrazo]);

  const addItem = (produto: Produto) => {
    const existing = itens.find(i => i.produto_id === produto.id);
    if (existing) {
      updateItem(produto.id, (existing.quantidade || 0) + 1);
    } else {
      const discount = getValorUnitario(produto, faixaPreco) || 0;
      const unitario = produto.custo_und * (1 - discount);
      const valorTotalItem = unitario * (produto.quant_embalagem || 1);
      
      const novoItem: Partial<ItemPedido> = {
        produto_id: produto.id,
        quantidade: 1,
        peso_total: produto.peso_embalagem,
        valor_unitario: unitario,
        valor_total: valorTotalItem
      };
      setItens([...itens, novoItem]);
    }
    setShowProductSelector(false);
  };

  const updateItem = (produtoId: string, qtd: number) => {
    setItens(prev => {
      if (qtd <= 0) {
        return prev.filter(i => i.produto_id !== produtoId);
      }

      return prev.map(item => {
        if (item.produto_id === produtoId) {
          const produto = produtos.find(p => p.id === produtoId)!;
          const pesoItem = qtd * produto.peso_embalagem;
          const discount = getValorUnitario(produto, faixaPreco) || 0;
          const unitario = produto.custo_und * (1 - discount);
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

  // Recalculate all items when faixa changes
  useEffect(() => {
    setItens(prev => prev.map(item => {
      const produto = produtos.find(p => p.id === item.produto_id);
      if (!produto) return item;
      const discount = getValorUnitario(produto, faixaPreco) || 0;
      const unitario = produto.custo_und * (1 - discount);
      const valorTotalItem = unitario * (item.quantidade || 0) * (produto.quant_embalagem || 1);
      
      return {
        ...item,
        valor_unitario: unitario,
        valor_total: valorTotalItem
      };
    }));
  }, [faixaPreco, produtos]);

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

  const handleSave = async () => {
    if (!clienteId) return;

    if (itens.length === 0) {
      alert('Por favor, adicione pelo menos um produto ao pedido.');
      return;
    }

    if (!selectedPrazo) {
      alert('Por favor, selecione uma condição de pagamento.');
      return;
    }

    try {
      setIsGeneratingImage(true);
      
      // 1. Generate Image
      if (receiptRef.current) {
        // Wait a bit for the DOM to be ready and styles to apply
        await new Promise(resolve => setTimeout(resolve, 500));
        
        const dataUrl = await toJpeg(receiptRef.current, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          cacheBust: true,
        });

        // 2. Share via WhatsApp
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], `pedido_${cliente?.cliente?.replace(/\s+/g, '_')}.jpg`, { type: 'image/jpeg' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({
              files: [file],
              title: 'Resumo do Pedido',
              text: `Resumo do pedido - ${cliente?.cliente}`,
            });
          } catch (shareErr) {
            console.error('Error sharing:', shareErr);
            // Fallback to download if share fails or is cancelled
            const link = document.createElement('a');
            link.download = `pedido_${cliente?.cliente}.jpg`;
            link.href = dataUrl;
            link.click();
          }
        } else {
          // Fallback for browsers that don't support file sharing
          const link = document.createElement('a');
          link.download = `pedido_${cliente?.cliente}.jpg`;
          link.href = dataUrl;
          link.click();
          alert('Imagem do pedido gerada! Como seu navegador não suporta compartilhamento direto de arquivos, o resumo foi baixado. Você pode enviá-lo manualmente pelo WhatsApp.');
        }
      }

      alert('Pedido finalizado com sucesso!');
      navigate(`/cliente/${clienteId}`);
    } catch (err) {
      console.error('Erro ao finalizar pedido:', err);
      alert('Erro ao finalizar pedido. Tente novamente.');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Carregando...</div>;

  return (
    <div className="space-y-6 pb-80">
      <header className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-white rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Novo Pedido</h2>
          <p className="text-sm text-neutral-500">{cliente?.cliente}</p>
        </div>
      </header>

      {/* Hidden Receipt for Image Generation */}
      <div className="fixed -left-[9999px] top-0">
        <div 
          ref={receiptRef}
          className="w-[400px] bg-white p-8 space-y-6"
        >
          <div className="text-center border-b-2 border-neutral-100 pb-6">
            <h1 className="text-2xl font-black text-neutral-900 uppercase tracking-tighter">Resumo do Pedido</h1>
            <p className="text-neutral-500 font-bold mt-1">{new Date().toLocaleDateString('pt-BR')} - {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-black text-neutral-400 uppercase">Cliente</p>
            <p className="text-lg font-black text-neutral-900 leading-tight">{cliente?.cliente}</p>
            <p className="text-sm text-neutral-500 font-bold">{cliente?.cidade}</p>
          </div>

          <div className="space-y-4">
            <p className="text-[10px] font-black text-neutral-400 uppercase border-b border-neutral-100 pb-1">Itens do Pedido</p>
            {itens.map((item, idx) => {
              const produto = produtos.find(p => p.id === item.produto_id)!;
              return (
                <div key={idx} className="flex justify-between items-start gap-4">
                  <div className="flex-1">
                    <p className="font-bold text-neutral-900 text-sm leading-tight">{produto.produto}</p>
                    <p className="text-[10px] text-neutral-400 font-bold uppercase">{item.quantidade} UN • {formatWeight(item.peso_total || 0)}</p>
                  </div>
                  <p className="font-black text-neutral-900 text-sm">{formatCurrency(item.valor_total || 0)}</p>
                </div>
              );
            })}
          </div>

          <div className="pt-6 border-t-2 border-neutral-100 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-black text-neutral-400 uppercase">Condição</p>
                <p className="font-black text-neutral-900">{selectedPrazo}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-neutral-400 uppercase">Faixa</p>
                <p className="font-black text-orange-600">{faixaPreco}</p>
              </div>
            </div>

            <div className="bg-neutral-900 text-white p-6 rounded-2xl flex justify-between items-center">
              <div>
                <p className="text-[10px] font-black opacity-60 uppercase">Peso Total</p>
                <p className="text-xl font-black">{formatWeight(pesoTotal)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black opacity-60 uppercase">Valor Total</p>
                <p className="text-2xl font-black">{formatCurrency(valorTotal)}</p>
              </div>
            </div>
          </div>

          <div className="text-center pt-4">
            <p className="text-[10px] font-black text-neutral-300 uppercase tracking-widest">Gerado via Sales Tablet</p>
          </div>
        </div>
      </div>

      {/* Items List */}
      <div className="space-y-3">
        <div className="px-1 py-3 border-b border-neutral-200">
          <h3 className="font-bold text-neutral-800">Itens do Pedido</h3>
        </div>

        {itens.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-dashed border-neutral-300 text-center text-neutral-400">
            Nenhum item adicionado.
          </div>
        ) : (
          <div className="space-y-3">
            {itens.map(item => {
              const produto = produtos.find(p => p.id === item.produto_id)!;
              return (
                <div key={item.produto_id} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm flex items-center justify-between">
                  <div className="flex-1">
                    <h4 className="font-bold text-neutral-900">{produto.produto}</h4>
                    <div className="flex gap-3 mt-1 text-[10px] font-bold text-neutral-400 uppercase tracking-wider">
                      <span>{(produto.peso_embalagem / (produto.quant_embalagem || 1)).toFixed(2)}kg / un</span>
                      <span className="text-neutral-300">|</span>
                      <span>Total: {formatWeight(item.peso_total || 0)}</span>
                      <span className="text-neutral-300">|</span>
                      <span>{formatCurrency(item.valor_unitario || 0)} / un</span>
                    </div>
                    <p className="text-orange-600 font-bold mt-1">{formatCurrency(item.valor_total || 0)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => updateItem(item.produto_id!, 0)}
                      className="w-8 h-8 flex items-center justify-center bg-red-50 rounded-lg text-red-600 hover:bg-red-100 transition-colors"
                      title="Remover item"
                    >
                      <Trash2 size={16} />
                    </button>
                    <div className="flex items-center gap-3 bg-neutral-50 p-1 rounded-xl border border-neutral-100">
                      <button 
                        onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) - 1)}
                        className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-neutral-600"
                      >
                        <Minus size={16} />
                      </button>
                      <input 
                        type="number" 
                        className="w-10 text-center font-bold text-neutral-900 bg-transparent outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={item.quantidade || ''}
                        onChange={(e) => updateItem(item.produto_id!, parseInt(e.target.value) || 0)}
                      />
                      <button 
                        onClick={() => updateItem(item.produto_id!, (item.quantidade || 0) + 1)}
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
          onClick={() => setShowProductSelector(true)}
          className="w-full py-4 bg-white rounded-2xl border-2 border-dashed border-orange-200 text-orange-600 font-bold flex items-center justify-center gap-2 hover:bg-orange-50 transition-all active:scale-95"
        >
          <Plus size={20} /> Adicionar Produto
        </button>
        <div ref={itemsEndRef} className="h-12" />
      </div>

      {/* Bottom Section (Fixed) */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-t border-neutral-200 p-4 md:p-6 space-y-4 shadow-[0_-10px_20px_rgba(0,0,0,0.05)]">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            {/* Payment Terms Selection */}
            <div className="flex-1 w-full space-y-2">
              <div className="flex items-center gap-2">
                <Calendar className="text-orange-600" size={16} />
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">Condição de Pagamento</h3>
              </div>
              <div className="relative">
                <select
                  value={selectedPrazo}
                  onChange={(e) => setSelectedPrazo(e.target.value)}
                  className="w-full pl-4 pr-10 py-3 bg-neutral-50 border border-neutral-200 rounded-xl font-bold text-neutral-800 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all"
                >
                  <option value="" disabled>Selecione...</option>
                  {availableTerms.map((prazo) => (
                    <option key={prazo} value={prazo}>
                      {prazo}
                    </option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                  <ChevronDown size={20} />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 w-full md:w-auto">
              {showClearConfirm ? (
                <div className="flex-1 md:w-64 bg-white p-2 rounded-2xl border-2 border-red-200 shadow-lg flex gap-2 items-center">
                  <p className="text-[10px] font-bold text-neutral-800 flex-1 px-2">Limpar pedido?</p>
                  <button 
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-2 bg-neutral-100 text-neutral-600 rounded-xl font-bold text-[10px]"
                  >
                    Não
                  </button>
                  <button 
                    onClick={handleClearOrder}
                    className="px-3 py-2 bg-red-600 text-white rounded-xl font-bold text-[10px]"
                  >
                    Sim
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setShowClearConfirm(true)}
                  className="flex-1 md:w-40 bg-neutral-100 text-neutral-600 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-200 transition-all"
                >
                  <Trash2 size={18} /> Limpar
                </button>
              )}
              <button 
                onClick={handleSave}
                disabled={isGeneratingImage}
                className="flex-[2] md:w-64 bg-green-600 text-white py-4 rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
              >
                {isGeneratingImage ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Save size={20} />
                )}
                <span>{isGeneratingImage ? 'Gerando...' : 'Finalizar Pedido'}</span>
              </button>
            </div>
          </div>

          {/* Summary Bar */}
          <div className="bg-orange-600 text-white p-4 rounded-2xl shadow-lg flex justify-between items-center">
            <div>
              <p className="text-[10px] uppercase font-bold opacity-80">Peso Total</p>
              <p className="text-xl font-black">{formatWeight(pesoTotal)}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] uppercase font-bold opacity-80">Faixa</p>
              <p className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded-full">{faixaPreco}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase font-bold opacity-80">Valor Total</p>
              <p className="text-xl font-black">{formatCurrency(valorTotal)}</p>
            </div>
          </div>
        </div>
      </div>

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
              className="bg-white w-full max-w-lg rounded-t-3xl md:rounded-3xl p-6 max-h-[80vh] overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold">Selecionar Produto</h3>
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
                      className="w-full pl-10 pr-4 py-3 bg-neutral-100 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer bg-neutral-100 px-4 py-3 rounded-xl border border-neutral-200">
                    <input 
                      type="checkbox" 
                      checked={showOnlyPositivados}
                      onChange={(e) => setShowOnlyPositivados(e.target.checked)}
                      className="w-4 h-4 rounded border-neutral-300 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-xs font-bold text-neutral-700">Positivados</span>
                  </label>
                </div>
                
                <div className="relative">
                  <select
                    value={selectedFamily}
                    onChange={(e) => setSelectedFamily(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 bg-neutral-100 rounded-xl font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500 appearance-none transition-all"
                  >
                    {families.map((family) => (
                      <option key={family} value={family}>
                        Família: {family}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                    <ChevronDown size={20} />
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {filteredAndSortedProducts.map(produto => (
                  <button
                    key={produto.id}
                    onClick={() => addItem(produto)}
                    className="w-full text-left p-4 rounded-xl border border-neutral-100 hover:bg-orange-50 hover:border-orange-200 transition-all flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-neutral-100 text-neutral-500 text-[8px] font-bold rounded uppercase">
                          {produto.familia}
                        </span>
                      </div>
                      <p className="font-bold text-neutral-900">{produto.produto}</p>
                      <p className="text-xs text-neutral-500">{(produto.peso_embalagem / (produto.quant_embalagem || 1)).toFixed(2)}kg / un</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-orange-600">
                        {formatCurrency(produto.custo_und * (1 - (getValorUnitario(produto, faixaPreco) || 0)))}
                      </p>
                      <p className="text-[10px] text-neutral-400 font-bold uppercase">Por Unidade</p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
