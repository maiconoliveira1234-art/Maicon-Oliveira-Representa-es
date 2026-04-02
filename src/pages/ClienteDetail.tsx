import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  ShoppingCart, 
  History, 
  Package, 
  Target, 
  TrendingUp, 
  Calendar,
  ChevronRight,
  AlertCircle
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

import { MOCK_CLIENTES, MOCK_HISTORICO } from '../lib/mockData';

export function ClienteDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [estoque, setEstoque] = useState<EstoqueCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadClienteData() {
      if (!id) return;
      try {
        setError(null);
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
          setHistorico(histData);
        }

        const { data: estData } = await supabase
          .from('estoque_cliente')
          .select('*')
          .eq('cliente_id', id);
        
        if (estData) setEstoque(estData);

      } catch (err) {
        console.error('Erro ao carregar dados do cliente:', err);
        setCliente(MOCK_CLIENTES.find(c => c.id === id) || null);
        setHistorico(MOCK_HISTORICO.filter(h => h.cliente_id === id));
      } finally {
        setLoading(false);
      }
    }
    loadClienteData();
  }, [id]);

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!cliente) return <div className="p-8 text-center">Cliente não encontrado.</div>;

  const chartData = [
    { name: 'Média 12m', valor: 4500 },
    { name: 'Média 6m', valor: 5200 },
    { name: 'Realizado', valor: 3800 },
    { name: 'Meta', valor: cliente.meta },
  ];

  return (
    <div className="space-y-6 pb-24">
      <header className="flex items-center gap-4">
        <button onClick={() => navigate('/')} className="p-2 hover:bg-white rounded-full transition-colors">
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
            <p className="text-lg font-black text-neutral-800">{formatWeight(Math.max(0, cliente.meta - 3800))}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Progresso</p>
            <p className="text-lg font-black text-green-600">76%</p>
          </div>
        </div>
      </section>

      {/* Purchase Cycle */}
      <section className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-sm">
        <h3 className="font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <Calendar className="text-orange-600" size={20} />
          Ciclo de Compra
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Média</p>
            <p className="text-xl font-bold text-neutral-800">22</p>
            <p className="text-[10px] text-neutral-400">dias</p>
          </div>
          <div className="border-x border-neutral-100">
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Última</p>
            <p className="text-xl font-bold text-neutral-800">14</p>
            <p className="text-[10px] text-neutral-400">dias atrás</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-neutral-400 uppercase">Status</p>
            <p className="text-sm font-bold text-green-600 mt-2 uppercase tracking-tighter">No Prazo</p>
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
          <button className="text-orange-600 text-xs font-bold">Ver Tudo</button>
        </div>
        
        {historico.slice(0, 3).map((venda) => (
          <div key={venda.id} className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm flex justify-between items-center">
            <div>
              <p className="font-bold text-neutral-900">{venda.produtos}</p>
              <p className="text-xs text-neutral-400">{new Date(venda.faturamento).toLocaleDateString()}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-neutral-900">{formatCurrency(venda["r$_total"])}</p>
              <p className="text-[10px] font-bold text-neutral-400 uppercase">{venda.qtd} un</p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
