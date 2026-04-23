import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { 
  ArrowLeft, 
  ShoppingCart, 
  History, 
  Package, 
  Target, 
  TrendingUp, 
  Calendar,
  ChevronRight,
  AlertCircle,
  XCircle
} from 'lucide-react';
import { Cliente, HistVenda, EstoqueCliente } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight, formatCurrency } from '../lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  differenceInDays, 
  parseISO, 
  format,
  isWithinInterval
} from 'date-fns';

import { MOCK_CLIENTES, MOCK_HISTORICO, MOCK_PRODUTOS } from '../lib/mockData';
import { Produto } from '../types';
import { SALES_CUTOFF_DATE, SALES_CUTOFF_CLIENTS } from '../constants';

export function ClienteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [estoque, setEstoque] = useState<EstoqueCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderDate, setSelectedOrderDate] = useState<string | null>(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    async function loadClienteData() {
      if (!id) return;
      try {
        setError(null);
        
        // Fetch Clientes
        const { data: clienteData, error: cError } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', id)
          .single();
        
        if (cError) {
          console.error('Supabase Error (cliente detail):', cError.message);
          setError('Erro ao conectar ao Supabase. Usando dados mock.');
          setCliente(MOCK_CLIENTES.find(c => c.id === id) || null);
        } else if (!clienteData) {
          setCliente(MOCK_CLIENTES.find(c => c.id === id) || null);
        } else {
          // Fetch Meta
          const { data: mData } = await supabase
            .from('metas')
            .select('meta')
            .eq('cliente_id', id)
            .single();
          
          setCliente({
            ...clienteData,
            meta: mData?.meta || 0
          });
        }

        // Fetch Historico
        const { data: histData, error: hError } = await supabase
          .from('hist_vendas')
          .select('*')
          .eq('cliente_id', id)
          .order('faturamento', { ascending: false });
        
        if (hError) {
          console.error('Supabase Error (historico):', hError.message);
          setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
        } else if (!histData || histData.length === 0) {
          setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
        } else {
          // Ensure unique items by composite key to prevent triplication if the database has duplicate rows with different IDs
          const uniqueMap = new Map();
          histData.forEach((h: HistVenda) => {
            const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, h);
            }
          });
          setHistorico(Array.from(uniqueMap.values()) as HistVenda[]);
        }

        // Fetch Produtos
        const { data: pData } = await supabase
          .from('produtos')
          .select('*');
        setProdutos(pData && pData.length > 0 ? pData : MOCK_PRODUTOS);

        // Fetch Estoque
        const { data: estData } = await supabase
          .from('estoque_cliente')
          .select('*')
          .eq('cliente_id', id);
        
        if (estData) setEstoque(estData);

      } catch (err) {
        console.error('Erro ao carregar dados do cliente:', err);
        setCliente(MOCK_CLIENTES.find(c => c.id === id) || null);
        setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
        setProdutos(MOCK_PRODUTOS);
      } finally {
        setLoading(false);
      }
    }
    loadClienteData();
  }, [id]);

  const produtosMap = React.useMemo(() => {
    return produtos.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, Produto>);
  }, [produtos]);

  const ordersByDate = React.useMemo(() => {
    const groups: Record<string, HistVenda[]> = {};
    historico.forEach(h => {
      const date = h.faturamento;
      if (!groups[date]) groups[date] = [];
      groups[date].push(h);
    });
    
    return Object.entries(groups)
      .map(([date, items]) => {
        // Group items by product to avoid duplicates
        const groupedItems: Record<string, HistVenda> = {};
        items.forEach(item => {
          const key = item.produto_id || item.produtos;
          if (!groupedItems[key]) {
            groupedItems[key] = { ...item };
          } else {
            groupedItems[key].qtd += item.qtd;
            groupedItems[key]["r$_total"] += item["r$_total"];
          }
        });

        const finalItems = Object.values(groupedItems);

        return {
          date,
          items: finalItems,
          total: finalItems.reduce((acc, item) => acc + (item["r$_total"] || 0), 0),
          totalWeight: finalItems.reduce((acc, item) => {
            const prod = produtosMap[item.produto_id];
            return acc + (item.qtd * (prod?.peso_embalagem || 0));
          }, 0)
        };
      })
      .sort((a, b) => parseISO(b.date).getTime() - parseISO(a.date).getTime());
  }, [historico, produtosMap]);

  const selectedOrder = React.useMemo(() => {
    if (!selectedOrderDate) return null;
    return ordersByDate.find(o => o.date === selectedOrderDate);
  }, [ordersByDate, selectedOrderDate]);

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!cliente) return <div className="p-8 text-center">Cliente não encontrado.</div>;

  const clientName = (cliente.cliente || '').trim().toUpperCase();
  const isCutoffClient = SALES_CUTOFF_CLIENTS.includes(clientName);

  // Calculations
  const now = new Date();
  const startOfCurrentMonth = startOfMonth(now);
  const endOfCurrentMonth = endOfMonth(now);

  // Realizado (Current Month)
  const realizado = historico
    .filter(h => {
      // Selective cutoff filter
      if (isCutoffClient && h.faturamento < SALES_CUTOFF_DATE) return false;

      const date = parseISO(h.faturamento);
      return date >= startOfCurrentMonth && date <= endOfCurrentMonth;
    })
    .reduce((acc, h) => {
      const prod = produtosMap[h.produto_id];
      return acc + (h.qtd * (prod?.peso_embalagem || 0));
    }, 0);

  // Média 6m (excluding current month)
  const sixMonthsAgo = startOfMonth(subMonths(now, 6));
  const media6mData = historico
    .filter(h => {
      // Selective cutoff filter
      if (isCutoffClient && h.faturamento < SALES_CUTOFF_DATE) return false;

      const date = parseISO(h.faturamento);
      return date >= sixMonthsAgo && date < startOfCurrentMonth;
    });
  const media6m = media6mData.reduce((acc, h) => {
    const prod = produtosMap[h.produto_id];
    return acc + (h.qtd * (prod?.peso_embalagem || 0));
  }, 0) / 6;

  // Média 12m (excluding current month)
  const twelveMonthsAgo = startOfMonth(subMonths(now, 12));
  const media12mData = historico
    .filter(h => {
      // Selective cutoff filter
      if (isCutoffClient && h.faturamento < SALES_CUTOFF_DATE) return false;

      const date = parseISO(h.faturamento);
      return date >= twelveMonthsAgo && date < startOfCurrentMonth;
    });
  const media12m = media12mData.reduce((acc, h) => {
    const prod = produtosMap[h.produto_id];
    return acc + (h.qtd * (prod?.peso_embalagem || 0));
  }, 0) / 12;

  // Ciclo de Compra
  let mediaCiclo = 0;
  let diasUltima = 0;
  
  if (historico.length > 0) {
    const sortedVendas = [...historico].sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());
    const ultVenda = sortedVendas[0];
    diasUltima = differenceInDays(now, parseISO(ultVenda.faturamento));

    const oldest = parseISO(sortedVendas[sortedVendas.length - 1].faturamento);
    const totalDaysSinceFirst = differenceInDays(now, oldest);
    const uniqueDays = new Set(historico.map(v => format(parseISO(v.faturamento), 'yyyy-MM-dd')));
    if (uniqueDays.size > 0) {
      mediaCiclo = Math.round(totalDaysSinceFirst / uniqueDays.size);
    }
  }

  const progresso = cliente.meta > 0 ? Math.round((realizado / cliente.meta) * 100) : 0;
  const statusCiclo = diasUltima <= 28 ? "Válido" : "Inválido";

  const chartData = [
    { name: 'Média 12m', valor: media12m },
    { name: 'Média 6m', valor: media6m },
    { name: 'Realizado', valor: realizado },
    { name: 'Meta', valor: cliente.meta },
  ];

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center gap-4">
        <button 
          onClick={() => {
            if (location.state?.fromMetas) {
              navigate('/metas');
            } else {
              navigate('/');
            }
          }} 
          className="p-2 hover:bg-white rounded-full transition-colors"
        >
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-xl font-bold text-neutral-900">{cliente.cliente}</h2>
          <p className="text-sm text-neutral-500">{cliente.cidade}</p>
        </div>
      </header>

      {error && (
        <div className="bg-red-50 border border-red-100 p-4 rounded-2xl flex items-center gap-3 text-red-700 text-sm">
          <AlertCircle size={20} />
          <p>{error}</p>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3">
        <button 
          onClick={() => navigate(`/pedido/novo/${cliente.id}`)}
          className="bg-orange-600 text-white p-4 rounded-2xl font-bold flex flex-col items-center gap-2 shadow-lg active:scale-95 transition-all"
        >
          <ShoppingCart size={24} />
          <span>Novo Pedido</span>
        </button>
        <button 
          onClick={() => navigate(`/estoque/${cliente.id}`)}
          className="bg-white text-neutral-700 p-4 rounded-2xl font-bold flex flex-col items-center gap-2 border border-neutral-200 shadow-sm active:scale-95 transition-all"
        >
          <Package size={24} className="text-orange-600" />
          <span>Contar Estoque</span>
        </button>
      </div>

      {/* Goal Progress */}
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <Target className="text-orange-600" size={20} />
            Desempenho (kg)
          </h3>
          <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg">Mês Atual</span>
        </div>
        
        <div className="h-64 w-full min-h-[256px]">
          <ResponsiveContainer width="100%" height="100%" minHeight={256} minWidth={0}>
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600 }} />
              <YAxis hide />
              <Tooltip 
                cursor={{ fill: '#f9fafb' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
              />
              <Bar dataKey="valor" radius={[6, 6, 0, 0]} barSize={40}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.name === 'Meta' ? '#ea580c' : entry.name === 'Realizado' ? '#16a34a' : '#94a3b8'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 p-4 bg-neutral-50 rounded-2xl flex justify-between items-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Falta para Meta</p>
            <p className="text-lg font-black text-neutral-800">{formatWeight(Math.max(0, cliente.meta - realizado))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Progresso</p>
            <p className={cn(
              "text-lg font-black",
              progresso >= 100 ? "text-green-600" : "text-orange-600"
            )}>
              {progresso}%
            </p>
          </div>
        </div>
      </section>

      {/* Purchase Cycle */}
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm">
        <h3 className="font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <Calendar className="text-orange-600" size={20} />
          Recompra
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Média</p>
            <p className="text-xl font-bold text-neutral-800">{mediaCiclo}</p>
            <p className="text-[10px] text-neutral-400">dias</p>
          </div>
          <div className="border-x border-neutral-100">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Última</p>
            <p className="text-xl font-bold text-neutral-800">{diasUltima}</p>
            <p className="text-[10px] text-neutral-400">dias atrás</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Recompra</p>
            <p className={cn(
              "text-sm font-bold mt-2 uppercase tracking-tighter",
              statusCiclo === "Válido" ? "text-green-600" : "text-red-600"
            )}>
              {statusCiclo}
            </p>
          </div>
        </div>
      </section>

      {/* Recent History */}
      <section className="space-y-3">
        <div className="flex justify-between items-center px-1">
          <h3 className="font-bold text-neutral-800 flex items-center gap-2">
            <History className="text-orange-600" size={20} />
            Últimos Pedidos
          </h3>
          <button 
            onClick={() => setShowAllHistory(true)}
            className="text-orange-600 text-xs font-bold"
          >
            Ver Tudo
          </button>
        </div>
        
        {ordersByDate.slice(0, 3).map((order) => (
          <button 
            key={order.date} 
            onClick={() => setSelectedOrderDate(order.date)}
            className="w-full bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm flex justify-between items-center hover:bg-neutral-50 transition-colors text-left"
          >
            <div>
              <p className="font-bold text-neutral-900">Pedido em {format(parseISO(order.date), 'dd/MM/yyyy')}</p>
              <p className="text-xs text-neutral-400">{order.items.length} itens • {formatWeight(order.totalWeight)}</p>
            </div>
            <div className="text-right flex items-center gap-2">
              <p className="font-bold text-neutral-900">{formatCurrency(order.total)}</p>
              <ChevronRight size={16} className="text-neutral-300" />
            </div>
          </button>
        ))}
      </section>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-6 border-b border-neutral-100 flex justify-between items-center bg-neutral-50">
              <div>
                <h3 className="text-xl font-black text-neutral-900">Detalhes do Pedido</h3>
                <p className="text-sm text-neutral-500 font-bold">{format(parseISO(selectedOrder.date), 'dd/MM/yyyy')}</p>
              </div>
              <button 
                onClick={() => setSelectedOrderDate(null)}
                className="p-2 hover:bg-neutral-200 rounded-full transition-colors"
              >
                <XCircle size={24} className="text-neutral-400" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {selectedOrder.items.map((item, idx) => {
                const prod = produtosMap[item.produto_id];
                const pesoTotalLinha = item.qtd * (prod?.peso_embalagem || 0);
                const valorUnitario = item.qtd > 0 ? item["r$_total"] / item.qtd : 0;
                
                return (
                  <div key={idx} className="flex justify-between items-start pb-4 border-b border-neutral-50 last:border-0">
                    <div className="flex-1 pr-4">
                      <p className="font-bold text-neutral-900 leading-tight">{item.produtos}</p>
                      <p className="text-xs text-neutral-400 mt-1">
                        Qtd: {item.qtd} un • Peso Total: {formatWeight(pesoTotalLinha)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-neutral-900">{formatCurrency(item["r$_total"])}</p>
                      <p className="text-[10px] font-bold text-neutral-400 uppercase">Unit: {formatCurrency(valorUnitario)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-6 bg-orange-50 border-t border-orange-100">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-bold text-orange-400 uppercase">Total do Pedido</p>
                  <p className="text-2xl font-black text-orange-600">{formatCurrency(selectedOrder.total)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-orange-400 uppercase">Peso Total</p>
                  <p className="text-xl font-black text-neutral-700">{formatWeight(selectedOrder.totalWeight)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Full History View */}
      {showAllHistory && (
        <div className="fixed inset-0 z-40 bg-neutral-50 flex flex-col md:pl-20">
          <header className="bg-white p-4 border-b border-neutral-200 flex items-center justify-between sticky top-0">
            <h2 className="text-xl font-black text-neutral-900 ml-2">Histórico Completo</h2>
            <button 
              onClick={() => setShowAllHistory(false)} 
              className="flex items-center gap-2 px-3 py-2 hover:bg-neutral-100 rounded-xl transition-colors text-neutral-600 font-bold"
            >
              <span>Voltar</span>
              <ArrowLeft size={20} className="rotate-180" />
            </button>
          </header>
          
          <div className="flex-1 overflow-y-auto p-4 max-w-4xl mx-auto w-full space-y-3">
            {ordersByDate.map((order) => (
              <button 
                key={order.date} 
                onClick={() => setSelectedOrderDate(order.date)}
                className="w-full bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm flex justify-between items-center text-left hover:bg-neutral-50 transition-colors"
              >
                <div>
                  <p className="font-bold text-neutral-900">{format(parseISO(order.date), 'dd/MM/yyyy')}</p>
                  <p className="text-xs text-neutral-400">{order.items.length} itens • {formatWeight(order.totalWeight)}</p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <p className="font-bold text-neutral-900">{formatCurrency(order.total)}</p>
                  <ChevronRight size={16} className="text-neutral-300" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
