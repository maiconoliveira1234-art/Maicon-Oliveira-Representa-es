import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
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
  Search
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

import { MOCK_CLIENTES, MOCK_PRODUTOS } from '../lib/mockData';

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
          const desconto = getValorUnitario(produto, faixaPreco);
          const unitario = produto.custo_total / (produto.quant_embalagem || 1);
          const valorTotalItem = (produto.custo_total * (1 - (desconto || 0))) * extraQtd;
          
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

  const handleClearOrder = () => {
    setItens([]);
    setShowClearConfirm(false);
  };

  const valorTotal = useMemo(() => {
    return itens.reduce((acc, item) => acc + (item.valor_total || 0), 0);
  }, [itens]);

  const addItem = (produto: Produto) => {
    const existing = itens.find(i => i.produto_id === produto.id);
    if (existing) {
      updateItem(produto.id, (existing.quantidade || 0) + 1);
    } else {
      const desconto = getValorUnitario(produto, faixaPreco);
      const unitario = produto.custo_total / (produto.quant_embalagem || 1);
      const valorTotalItem = (produto.custo_total * (1 - (desconto || 0)));
      
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
          const desconto = getValorUnitario(produto, faixaPreco);
          const unitario = produto.custo_total / (produto.quant_embalagem || 1);
          const valorTotalItem = (produto.custo_total * (1 - (desconto || 0))) * qtd;
          
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
      const desconto = getValorUnitario(produto, faixaPreco);
      const unitario = produto.custo_total / (produto.quant_embalagem || 1);
      const valorTotalItem = (produto.custo_total * (1 - (desconto || 0))) * (item.quantidade || 0);
      
      return {
        ...item,
        valor_unitario: unitario,
        valor_total: valorTotalItem
      };
    }));
  }, [faixaPreco, produtos]);

  const handleSave = async () => {
    if (!clienteId || itens.length === 0) return;

    try {
      const { data: pedido, error: pError } = await supabase
        .from('pedidos')
        .insert({
          cliente_id: clienteId,
          peso_total: pesoTotal,
          valor_total: valorTotal,
          data: new Date().toISOString().split('T')[0]
        })
        .select()
        .single();

      if (pError) throw pError;

      const itensParaSalvar = itens.map(item => ({
        pedido_id: pedido.id,
        produto_id: item.produto_id,
        quantidade: item.quantidade,
        peso_total: item.peso_total,
        valor_unitario: item.valor_unitario,
        valor_total: item.valor_total
      }));

      const { error: iError } = await supabase
        .from('itens_pedido')
        .insert(itensParaSalvar);

      if (iError) throw iError;

      alert('Pedido salvo com sucesso!');
      navigate(`/cliente/${clienteId}`);
    } catch (err) {
      console.error('Erro ao salvar pedido:', err);
      alert('Erro ao salvar pedido. Verifique sua conexão.');
    }
  };

  if (loading) return <div className="p-8 text-center">Carregando...</div>;

  return (
    <div className="space-y-6 pb-32">
      <header className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-white rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-neutral-900">Novo Pedido</h2>
          <p className="text-sm text-neutral-500">{cliente?.cliente}</p>
        </div>
      </header>

      {/* Order Summary Sticky */}
      <div className="bg-orange-600 text-white p-4 rounded-2xl shadow-xl flex justify-between items-center sticky top-4 z-40">
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

      {/* Items List */}
      <div className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="font-bold text-neutral-800">Itens do Pedido</h3>
          <button 
            onClick={() => setShowProductSelector(true)}
            className="text-orange-600 text-sm font-bold flex items-center gap-1"
          >
            <Plus size={16} /> Adicionar Produto
          </button>
        </div>

        {itens.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-dashed border-neutral-300 text-center text-neutral-400">
            Nenhum item adicionado.
          </div>
        ) : (
          itens.map(item => {
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
          })
        )}
      </div>

      {/* Action Buttons */}
      <div className="fixed bottom-20 md:bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-64 flex flex-col gap-3">
        {showClearConfirm ? (
          <div className="bg-white p-4 rounded-2xl border-2 border-red-200 shadow-lg animate-in fade-in slide-in-from-bottom-2">
            <p className="text-sm font-bold text-neutral-800 mb-3 text-center">Limpar todo o pedido?</p>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 py-2 bg-neutral-100 text-neutral-600 rounded-xl font-bold text-xs"
              >
                Não
              </button>
              <button 
                onClick={handleClearOrder}
                className="flex-1 py-2 bg-red-600 text-white rounded-xl font-bold text-xs"
              >
                Sim, Limpar
              </button>
            </div>
          </div>
        ) : (
          <button 
            onClick={() => setShowClearConfirm(true)}
            className="w-full bg-neutral-200 text-neutral-600 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-neutral-300 transition-all"
          >
            <Trash2 size={18} /> Limpar Pedido
          </button>
        )}
        <button 
          onClick={handleSave}
          disabled={itens.length === 0}
          className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold shadow-lg flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
        >
          <Save size={20} /> Finalizar Pedido
        </button>
      </div>

      {/* Product Selector Modal */}
      <AnimatePresence>
        {showProductSelector && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 z-[60] flex items-end md:items-center justify-center p-4"
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
                  <Trash2 size={20} />
                </button>
              </div>
              
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                <input 
                  type="text" 
                  placeholder="Filtrar produtos..."
                  className="w-full pl-10 pr-4 py-3 bg-neutral-100 rounded-xl outline-none focus:ring-2 focus:ring-orange-500"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {produtos
                  .filter(p => (p.produto?.toLowerCase() || '').includes(searchTerm.toLowerCase()))
                  .map(produto => (
                    <button
                      key={produto.id}
                      onClick={() => addItem(produto)}
                      className="w-full text-left p-4 rounded-xl border border-neutral-100 hover:bg-orange-50 hover:border-orange-200 transition-all flex justify-between items-center"
                    >
                      <div>
                        <p className="font-bold text-neutral-900">{produto.produto}</p>
                        <p className="text-xs text-neutral-500">{(produto.peso_embalagem / (produto.quant_embalagem || 1)).toFixed(2)}kg / un</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-orange-600">
                          {formatCurrency(produto.custo_total * (1 - (getValorUnitario(produto, faixaPreco) || 0)))}
                        </p>
                        <p className="text-[10px] text-neutral-400 font-bold uppercase">Por Caixa</p>
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
