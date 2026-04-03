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
  Trash2
} from 'lucide-react';
import { toJpeg } from 'html-to-image';
import { Cliente, Produto, EstoqueCliente, HistVenda } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight, formatCurrency } from '../lib/utils';
import { differenceInDays, parseISO, format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';

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
  estoque_ideal: number;
  ativo: boolean;
  quant_embalagem: number;
}

export function StockCountPage() {
  const { clienteId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [estoqueMap, setEstoqueMap] = useState<Record<string, number>>({});
  const [ultimaContagemMap, setUltimaContagemMap] = useState<Record<string, number>>({});
  const [pedidoMap, setPedidoMap] = useState<Record<string, number>>({});
  const [produtosMap, setProdutosMap] = useState<Record<string, Produto>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [showCycle, setShowCycle] = useState(false);
  const [selectedProductHistory, setSelectedProductHistory] = useState<ItemEstoqueData | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [touchedItems, setTouchedItems] = useState<Set<string>>(new Set());
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadData() {
      if (!clienteId) return;
      
      try {
        setLoading(true);
        // Load Cliente
        const { data: clienteData } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', clienteId)
          .single();
        
        if (clienteData) setCliente(clienteData);

        // Load Products
        const { data: prodData } = await supabase
          .from('produtos')
          .select('*');
        
        if (prodData) {
          const pMap: Record<string, Produto> = {};
          prodData.forEach(p => pMap[p.id] = p);
          setProdutosMap(pMap);
        }

        // Load all historical sales for this client to calculate averages
        const { data: histData } = await supabase
          .from('hist_vendas')
          .select('*')
          .eq('cliente_id', clienteId)
          .order('faturamento', { ascending: false });
        
        if (histData) {
          const uniqueMap = new Map();
          histData.forEach((h: HistVenda) => {
            const key = `${h.faturamento}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, h);
            }
          });
          const uniqueHist = Array.from(uniqueMap.values()) as HistVenda[];
          
          // Sort by date descending before setting state
          const sortedHist = uniqueHist.sort((a, b) => 
            new Date(b.faturamento).getTime() - new Date(a.faturamento).getTime()
          );
          setHistorico(sortedHist);
        }

        // Load current stock from DB
        const { data: estoqueData } = await supabase
          .from('estoque_cliente')
          .select('*')
          .eq('cliente_id', clienteId);
        
        const initialEstoque: Record<string, number> = {};
        const uMap: Record<string, number> = {};
        
        if (estoqueData) {
          estoqueData.forEach(e => {
            initialEstoque[e.produto_id] = e.quantidade_atual;
            uMap[e.produto_id] = e.quantidade_atual;
          });
        }
        setUltimaContagemMap(uMap);

        // Merge with localStorage
        const savedEstoque = localStorage.getItem(`estoque_${clienteId}`);
        const savedPedido = localStorage.getItem(`pedido_${clienteId}`);
        
        if (savedEstoque) {
          try {
            const parsed = JSON.parse(savedEstoque);
            Object.assign(initialEstoque, parsed);
          } catch (e) {
            console.error('Error parsing saved estoque:', e);
          }
        }
        setEstoqueMap(initialEstoque);

        if (savedPedido) {
          try {
            setPedidoMap(JSON.parse(savedPedido));
          } catch (e) {
            console.error('Error parsing saved pedido:', e);
          }
        }

      } catch (err) {
        console.error('Erro ao carregar dados:', err);
      } finally {
        setLoading(false);
        setIsReady(true);
      }
    }
    loadData();
  }, [clienteId]);

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

  const gridCols = showCycle 
    ? "grid-cols-[42px_35px_42px_minmax(100px,1fr)_100px_40px_40px_40px_100px]" 
    : "grid-cols-[42px_35px_42px_minmax(100px,1fr)_100px_40px_100px]";

  const processedItems = useMemo(() => {
    const items: Record<string, HistVenda[]> = {};
    historico.forEach(h => {
      if (!items[h.produto_id]) items[h.produto_id] = [];
      items[h.produto_id].push(h);
    });

    const result: ItemEstoqueData[] = Object.entries(items)
      .map(([produtoId, vendas]) => {
        const sortedVendas = [...vendas].sort((a, b) => 
          parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime()
        );
        
        const ultVenda = sortedVendas[0];
        const oldestVenda = sortedVendas[sortedVendas.length - 1];
        const diasUltCompra = differenceInDays(new Date(), parseISO(ultVenda.faturamento));
        
        // Filter: only if purchased in the last 365 days
        if (diasUltCompra > 365) return null;

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
        const estoqueIdeal = Math.ceil(consumoDiario * mediaCiclo * quantEmbalagem);

        // Tendencia (Column T in image) - Simplified logic: how many cycles passed
        const tendencia = mediaCiclo > 0 ? Math.floor(diasUltCompra / mediaCiclo) * -1 : 0;

        return {
          produto_id: produtoId,
          produto_nome: ultVenda.produtos,
          dias_ult_compra: diasUltCompra,
          qtd_ult_compra: ultVenda.qtd * quantEmbalagem,
          quantidade_atual: estoqueMap[produtoId] || 0,
          ultima_contagem_valor: ultimaContagemMap[produtoId] || 0,
          media_qtd: Math.round(mediaQtd * quantEmbalagem),
          media_ciclo: mediaCiclo,
          tendencia,
          peso: produto?.peso_embalagem || 0,
          estoque_ideal: estoqueIdeal,
          ativo: produto?.ativo ?? true,
          quant_embalagem: quantEmbalagem
        };
      })
      .filter((item): item is ItemEstoqueData => item !== null);

    // Sort: Alphabetical and Active status
    return result
      .filter(item => showInactive || item.ativo)
      .sort((a, b) => a.produto_nome.localeCompare(b.produto_nome));
  }, [historico, estoqueMap, ultimaContagemMap, produtosMap, mediaCicloGlobal, showInactive]);

  const diasDesdeUltimoPedidoGlobal = useMemo(() => {
    if (historico.length === 0) return 0;
    return differenceInDays(new Date(), parseISO(historico[0].faturamento));
  }, [historico]);

  const updateQuantity = (produtoId: string, val: string | number) => {
    const num = typeof val === 'string' ? parseInt(val) : val;
    setEstoqueMap(prev => ({
      ...prev,
      [produtoId]: isNaN(num) ? 0 : Math.max(0, num)
    }));
    setTouchedItems(prev => new Set(prev).add(produtoId));
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

  // Persist state to localStorage to survive navigation
  useEffect(() => {
    if (isReady && clienteId) {
      localStorage.setItem(`estoque_${clienteId}`, JSON.stringify(estoqueMap));
    }
  }, [estoqueMap, clienteId, isReady]);

  useEffect(() => {
    if (isReady && clienteId) {
      localStorage.setItem(`pedido_${clienteId}`, JSON.stringify(pedidoMap));
    }
  }, [pedidoMap, clienteId, isReady]);

  const handleSave = async () => {
    if (!clienteId) return;
    setSaving(true);

    try {
      // Use processedItems to ensure we save all visible items
      const itemsToUpsert = processedItems.map(item => ({
        cliente_id: clienteId,
        produto_id: item.produto_id,
        quantidade_atual: estoqueMap[item.produto_id] || 0,
        ultima_contagem: new Date().toISOString().split('T')[0]
      }));

      if (itemsToUpsert.length === 0) {
        alert('Nenhuma contagem para salvar.');
        setSaving(false);
        return;
      }

      // Try upsert without explicit onConflict first, or use a more generic approach
      // If the constraint error persists, it might be because the table doesn't have a unique constraint on (cliente_id, produto_id)
      const { error } = await supabase
        .from('estoque_cliente')
        .upsert(itemsToUpsert, { 
          onConflict: 'cliente_id,produto_id',
          ignoreDuplicates: false
        });

      if (error) {
        // Fallback for missing constraint: delete and insert (less efficient but works)
        console.warn('Upsert failed, trying delete/insert fallback:', error);
        const { error: deleteError } = await supabase
          .from('estoque_cliente')
          .delete()
          .eq('cliente_id', clienteId);
        
        if (deleteError) throw deleteError;

        const { error: insertError } = await supabase
          .from('estoque_cliente')
          .insert(itemsToUpsert);
        
        if (insertError) throw insertError;
      }

      // Clear local storage after successful save
      localStorage.removeItem(`estoque_${clienteId}`);
      localStorage.removeItem(`pedido_${clienteId}`);

      alert('Estoque atualizado com sucesso!');
      navigate(`/cliente/${clienteId}`);
    } catch (err) {
      console.error('Erro ao salvar estoque:', err);
      alert('Erro ao salvar estoque. Verifique sua conexão.');
    } finally {
      setSaving(false);
    }
  };

  const handleExportImage = async () => {
    if (!exportRef.current) return;
    
    try {
      const dataUrl = await toJpeg(exportRef.current, { quality: 0.95, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `contagem-${cliente?.cliente || 'cliente'}-${new Date().toLocaleDateString()}.jpeg`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Erro ao exportar imagem:', err);
      alert('Erro ao exportar imagem.');
    }
  };

  const filteredItems = processedItems.filter(item => 
    item.produto_nome.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <div className="p-8 text-center">Carregando...</div>;

  const isOverdueGlobal = diasDesdeUltimoPedidoGlobal > mediaCicloGlobal;

  return (
    <div className="min-h-screen bg-[#f8f9fa] pb-32 flex flex-col">
      {/* Spreadsheet Header */}
      <div className="bg-white border-b border-neutral-200 shadow-sm">
        <div className="w-full px-2 py-3">
          <div className="flex items-center gap-4 mb-4">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-lg font-bold text-neutral-800 truncate">{cliente?.cliente}</h1>
            <div className="ml-auto flex items-center gap-6">
              <div className="text-center">
                <p className="text-[10px] font-bold text-neutral-400 uppercase">Ult. Ped.</p>
                <p className={cn("text-lg font-black", isOverdueGlobal ? "text-red-600" : "text-neutral-800")}>
                  {diasDesdeUltimoPedidoGlobal}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-neutral-400 uppercase">Ciclo Méd.</p>
                <p className="text-lg font-black text-neutral-800 bg-neutral-100 px-3 rounded-lg">
                  {mediaCicloGlobal}
                </p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-neutral-400 uppercase">Peso Pedido</p>
                <p className="text-lg font-black text-orange-600 bg-orange-50 px-3 rounded-lg">
                  {formatWeight(totalPesoPedido)}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
              <input 
                type="text" 
                placeholder="Filtrar itens positivados..."
                className="w-full pl-10 pr-4 py-2 bg-neutral-100 rounded-lg outline-none text-sm"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 px-3 py-2 bg-neutral-100 rounded-lg cursor-pointer hover:bg-neutral-200 transition-colors">
              <input 
                type="checkbox" 
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="w-4 h-4 text-orange-600 border-neutral-300 rounded focus:ring-orange-500"
              />
              <span className="text-xs font-bold text-neutral-600">Inativos</span>
            </label>
            <button 
              onClick={() => setShowCycle(!showCycle)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-bold transition-colors",
                showCycle ? "bg-orange-600 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
              )}
            >
              Ciclo
            </button>
          </div>
        </div>
      </div>      <div className="w-full px-1 mt-2 flex-1 flex flex-col min-h-0">
        {/* Spreadsheet Table Container */}
        <div className="bg-white rounded-xl shadow-sm border border-neutral-200 flex flex-col overflow-hidden">
          <div className="overflow-y-auto max-h-[calc(100vh-280px)]">
            <div className="w-full">
              <div 
                className={cn(
                  "grid bg-neutral-100 border-b border-neutral-200 text-[10px] font-bold text-neutral-500 uppercase tracking-tight sticky top-0 z-[100] shadow-sm",
                  gridCols
                )}
              >
                <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Ult.<br/>Ped</div>
                <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Qtd</div>
                <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Ult.<br/>Cont</div>
                <div className="p-2 border-r border-neutral-200 flex items-center h-9">Item</div>
                <div className="p-1 border-r border-neutral-200 text-center flex items-center justify-center h-9">Estoque</div>
                {showCycle && (
                  <>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Méd.</div>
                    <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Ciclo</div>
                  </>
                )}
                <div className="p-0.5 border-r border-neutral-200 text-center flex items-center justify-center h-9 leading-none">Ideal</div>
                <div className="p-1 text-center flex items-center justify-center h-9">Pedido</div>
              </div>

              <div className="divide-y divide-neutral-100 relative z-0">
              {filteredItems.map((item) => {
                const isTouched = touchedItems.has(item.produto_id);
                const isBelowIdeal = item.quantidade_atual < item.estoque_ideal;
                const isZeroStock = item.quantidade_atual === 0;

                const rowStyle = isTouched 
                  ? (isZeroStock ? "text-red-600 font-black" : isBelowIdeal ? "font-black text-neutral-900" : "text-neutral-900 font-bold")
                  : "text-neutral-800 font-normal";

                return (
                  <div 
                    key={item.produto_id} 
                    className={cn(
                      "grid items-center text-[12px] transition-colors cursor-pointer even:bg-neutral-50/50",
                      gridCols,
                      rowStyle,
                      "hover:bg-orange-50/30"
                    )}
                    onClick={() => setSelectedProductHistory(item)}
                  >
                  <div className={cn("p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10", isTouched && isBelowIdeal && !isZeroStock ? "text-red-600" : "")}>
                    {item.dias_ult_compra}
                  </div>
                  <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10 opacity-50">
                    {item.qtd_ult_compra}
                  </div>
                  <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10 opacity-50">
                    {item.ultima_contagem_valor}
                  </div>
                  <div className={cn(
                    "p-2 border-r border-neutral-100 truncate flex items-center h-10 leading-tight"
                  )}>
                    {item.produto_nome}
                  </div>
                  <div className="p-1 border-r border-neutral-100 flex items-center justify-center gap-1 h-10" onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={() => updateQuantity(item.produto_id, (estoqueMap[item.produto_id] || 0) - 1)}
                      className="w-7 h-7 flex items-center justify-center bg-white border border-orange-200 rounded text-orange-600 hover:bg-orange-50 active:scale-90 transition-transform"
                    >
                      <Minus size={14} />
                    </button>
                    <input 
                      type="number" 
                      className="w-9 bg-orange-50 border border-orange-100 rounded py-1 text-center font-black text-orange-700 outline-none focus:ring-1 focus:ring-orange-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-[12px]"
                      value={estoqueMap[item.produto_id] ?? ''}
                      onChange={(e) => updateQuantity(item.produto_id, e.target.value)}
                    />
                    <button 
                      onClick={() => updateQuantity(item.produto_id, (estoqueMap[item.produto_id] || 0) + 1)}
                      className="w-7 h-7 flex items-center justify-center bg-orange-600 border border-orange-700 rounded text-white hover:bg-orange-700 active:scale-90 transition-transform"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  {showCycle && (
                    <>
                      <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10 opacity-50">
                        {item.media_qtd}
                      </div>
                      <div className="p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10 opacity-50">
                        {item.media_ciclo}
                      </div>
                    </>
                  )}
                  <div className={cn(
                    "p-0.5 border-r border-neutral-100 text-center flex items-center justify-center h-10"
                  )}>
                    {item.estoque_ideal}
                  </div>
                  <div className="p-1 flex items-center justify-center gap-1 h-10" onClick={(e) => e.stopPropagation()}>
                    <button 
                      onClick={() => updatePedido(item.produto_id, (pedidoMap[item.produto_id] || 0) - 1)}
                      className="w-7 h-7 flex items-center justify-center bg-white border border-green-200 rounded text-green-600 hover:bg-green-50 active:scale-90 transition-transform"
                    >
                      <Minus size={14} />
                    </button>
                    <input 
                      type="number" 
                      className="w-9 bg-green-50 border border-green-100 rounded py-1 text-center font-black text-green-700 outline-none focus:ring-1 focus:ring-green-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-[12px]"
                      value={pedidoMap[item.produto_id] || ''}
                      onChange={(e) => updatePedido(item.produto_id, e.target.value)}
                    />
                    <button 
                      onClick={() => updatePedido(item.produto_id, (pedidoMap[item.produto_id] || 0) + 1)}
                      className="w-7 h-7 flex items-center justify-center bg-green-600 border border-green-700 rounded text-white hover:bg-green-700 active:scale-90 transition-transform"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* Floating Buttons */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 w-full max-w-lg px-4 flex gap-2">
        <button 
          onClick={handleExportImage}
          className="bg-neutral-800 text-white p-4 rounded-2xl font-bold shadow-2xl flex items-center justify-center gap-2 hover:bg-neutral-900 transition-all active:scale-95"
          title="Exportar Imagem"
        >
          <Download size={20} />
        </button>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-white text-orange-600 border-2 border-orange-600 py-4 rounded-2xl font-bold shadow-2xl flex items-center justify-center gap-2 hover:bg-orange-50 disabled:opacity-50 transition-all active:scale-95"
        >
          <Save size={20} /> {saving ? 'Salvando...' : 'Salvar Contagem'}
        </button>
        <button 
          onClick={() => {
            const finalPedidoMap: Record<string, number> = {};
            processedItems.forEach(item => {
              const extraPackages = pedidoMap[item.produto_id] || 0;
              if (extraPackages > 0) finalPedidoMap[item.produto_id] = extraPackages;
            });
            navigate(`/pedido/novo/${clienteId}`, { state: { prefilledItems: finalPedidoMap } });
          }}
          className="flex-1 bg-orange-600 text-white py-4 rounded-2xl font-bold shadow-2xl flex items-center justify-center gap-2 hover:bg-orange-700 transition-all active:scale-95"
        >
          <ShoppingCart size={20} /> Ir para Pedido
        </button>
      </div>

      {/* History Modal */}
      <AnimatePresence>
        {selectedProductHistory && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600">
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

              <div className="flex-1 overflow-auto p-4">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="text-[10px] font-black text-neutral-400 uppercase tracking-wider border-b border-neutral-100">
                      <th className="pb-2 px-2">Data</th>
                      <th className="pb-2 px-2 text-center">Qtd</th>
                      <th className="pb-2 px-2 text-center">Peso Total</th>
                      <th className="pb-2 px-2 text-right">Valor Pago</th>
                      <th className="pb-2 px-2 text-center">Tabela</th>
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
                        const produto = produtosMap[venda.produto_id];
                        let tabela = '-';
                        if (produto) {
                          const xdtNormalized = venda.xdt / 100;
                          if (xdtNormalized === produto.livre) tabela = 'Livre';
                          else if (xdtNormalized === produto["200kg"]) tabela = '200kg';
                          else if (xdtNormalized === produto["500kg"]) tabela = '500kg';
                          else if (xdtNormalized === produto["1000kg"]) tabela = '1000kg';
                          else if (xdtNormalized === produto["2000kg"]) tabela = '2000kg';
                          else if (xdtNormalized === produto["4000kg"]) tabela = '4000kg';
                        }

                        return (
                          <tr key={venda.id} className="text-xs hover:bg-neutral-50 transition-colors">
                            <td className="py-3 px-2 font-bold text-neutral-700">
                              {format(parseISO(venda.faturamento), 'dd/MM/yyyy')}
                            </td>
                            <td className="py-3 px-2 text-center font-medium text-neutral-600">
                              {venda.qtd * selectedProductHistory.quant_embalagem} un
                            </td>
                            <td className="py-3 px-2 text-center text-neutral-500">
                              {formatWeight(venda.qtd * selectedProductHistory.peso)}
                            </td>
                            <td className="py-3 px-2 text-right font-bold text-neutral-800">
                              {formatCurrency(unitPrice)}
                            </td>
                            <td className="py-3 px-2 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-neutral-100 text-neutral-600">
                                {tabela}
                              </span>
                            </td>
                            <td className="py-3 px-2 text-center">
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
                  className="px-6 py-2 bg-neutral-800 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-neutral-700 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden Export View */}
      <div className="fixed -left-[9999px] top-0">
        <div ref={exportRef} className="bg-white p-8 w-[800px]">
          <div className="border-b-2 border-orange-600 pb-4 mb-6">
            <h1 className="text-2xl font-black text-neutral-800 uppercase tracking-tight">Contagem de Estoque</h1>
            <p className="text-lg font-bold text-orange-600">{cliente?.cliente}</p>
            <p className="text-sm text-neutral-400">{new Date().toLocaleDateString()}</p>
          </div>
          
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-neutral-100 text-left">
                <th className="p-3 border border-neutral-200 text-xs font-bold uppercase">Item</th>
                <th className="p-3 border border-neutral-200 text-xs font-bold uppercase text-center">Ult. Contagem</th>
                <th className="p-3 border border-neutral-200 text-xs font-bold uppercase text-center">Contagem Atual</th>
              </tr>
            </thead>
            <tbody>
              {processedItems.map(item => (
                <tr key={item.produto_id}>
                  <td className="p-3 border border-neutral-200 text-sm font-medium">{item.produto_nome}</td>
                  <td className="p-3 border border-neutral-200 text-sm text-center font-bold text-neutral-500">{item.ultima_contagem_valor}</td>
                  <td className="p-3 border border-neutral-200 text-sm text-center font-black text-orange-600">{estoqueMap[item.produto_id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
          
          <div className="mt-8 pt-4 border-t border-neutral-100 text-[10px] text-neutral-400 text-center">
            Gerado por Força de Vendas App
          </div>
        </div>
      </div>
    </div>
  );
}
