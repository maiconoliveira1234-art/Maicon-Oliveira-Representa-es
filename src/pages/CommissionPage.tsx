import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Produto, Cliente, HistVenda } from '../types';
import { 
  Loader2, 
  DollarSign, 
  TrendingUp, 
  Users, 
  Package, 
  Calendar,
  Filter,
  ChevronDown,
  BarChart3,
  PieChart as PieChartIcon,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { cn } from '../lib/utils';
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, isSameDay, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';

interface CommissionData extends HistVenda {
  comissao_valor: number;
  comissao_percent: number;
  familia: string;
  peso_venda: number;
}

type GroupBy = 'cliente' | 'produto' | 'familia';

export function CommissionPage() {
  const [loading, setLoading] = useState(true);
  const [vendas, setVendas] = useState<CommissionData[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  
  // Filters
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), 'yyyy-MM'));
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [selectedProdutoId, setSelectedProdutoId] = useState('');
  const [selectedFamilia, setSelectedFamilia] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('cliente');

  const deadlineDate = useMemo(() => {
    return localStorage.getItem('metas_deadline_date') || format(endOfMonth(new Date()), 'yyyy-MM-dd');
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        const start = startOfMonth(parseISO(`${selectedMonth}-01`));
        const end = endOfMonth(parseISO(`${selectedMonth}-01`));

        const [vendasRes, produtosRes, clientesRes] = await Promise.all([
          supabase
            .from('hist_vendas')
            .select('*')
            .gte('faturamento', format(start, 'yyyy-MM-dd'))
            .lte('faturamento', format(end, 'yyyy-MM-dd')),
          supabase.from('produtos').select('*'),
          supabase.from('clientes').select('*').order('cliente')
        ]);

        if (vendasRes.error) throw vendasRes.error;
        if (produtosRes.error) throw produtosRes.error;
        if (clientesRes.error) throw clientesRes.error;

        const productsMap = new Map(produtosRes.data.map(p => [p.id, p]));
        
        const enrichedVendas: CommissionData[] = (vendasRes.data || []).map(v => {
          const prod = productsMap.get(v.produto_id);
          const comissao_percent = prod?.comissao || 0;
          const comissao_valor = v["r$_total"] * comissao_percent;
          const peso_venda = v.qtd * (prod?.peso_embalagem || 0);
          
          return {
            ...v,
            comissao_percent,
            comissao_valor,
            familia: prod?.familia || 'Sem Família',
            peso_venda
          };
        });

        setVendas(enrichedVendas);
        setProdutos(produtosRes.data || []);
        setClientes(clientesRes.data || []);
      } catch (err) {
        console.error('Erro ao carregar dados de comissão:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [selectedMonth]);

  const filteredVendas = useMemo(() => {
    return vendas.filter(v => {
      const matchCliente = !selectedClienteId || v.cliente_id === selectedClienteId;
      const matchProduto = !selectedProdutoId || v.produto_id === selectedProdutoId;
      const matchFamilia = !selectedFamilia || v.familia === selectedFamilia;
      return matchCliente && matchProduto && matchFamilia;
    });
  }, [vendas, selectedClienteId, selectedProdutoId, selectedFamilia]);

  const stats = useMemo(() => {
    const totalVendido = filteredVendas.reduce((acc, v) => acc + v["r$_total"], 0);
    const totalComissao = filteredVendas.reduce((acc, v) => acc + v.comissao_valor, 0);
    const totalPedidos = new Set(filteredVendas.map(v => `${v.cliente_id}-${v.faturamento}`)).size;
    const percentualMedio = totalVendido > 0 ? (totalComissao / totalVendido) * 100 : 0;
    const ticketMedio = totalPedidos > 0 ? totalVendido / totalPedidos : 0;

    // Trend calculation
    const now = new Date();
    const monthStart = startOfMonth(parseISO(`${selectedMonth}-01`));
    const deadline = parseISO(deadlineDate);
    
    const daysPassed = Math.max(1, differenceInDays(now, monthStart) + 1);
    const totalDays = Math.max(1, differenceInDays(deadline, monthStart) + 1);
    
    const projectionFactor = totalDays / daysPassed;
    const projetadoComissao = totalComissao * projectionFactor;

    return {
      totalVendido,
      totalComissao,
      totalPedidos,
      percentualMedio,
      ticketMedio,
      projetadoComissao,
      isPositiveTrend: projetadoComissao >= totalComissao // Simple indicator
    };
  }, [filteredVendas, selectedMonth, deadlineDate]);

  const dailyData = useMemo(() => {
    const start = startOfMonth(parseISO(`${selectedMonth}-01`));
    const end = endOfMonth(parseISO(`${selectedMonth}-01`));
    const days = eachDayOfInterval({ start, end });

    return days.map(day => {
      const dayVendas = filteredVendas.filter(v => isSameDay(parseISO(v.faturamento), day));
      return {
        date: format(day, 'dd/MM'),
        vendas: dayVendas.reduce((acc, v) => acc + v["r$_total"], 0),
        comissao: dayVendas.reduce((acc, v) => acc + v.comissao_valor, 0)
      };
    });
  }, [filteredVendas, selectedMonth]);

  const groupedData = useMemo(() => {
    const groups: Record<string, { label: string, total: number, comissao: number, peso: number }> = {};

    filteredVendas.forEach(v => {
      let key = '';
      let label = '';

      if (groupBy === 'cliente') {
        key = v.cliente_id;
        label = v.cliente;
      } else if (groupBy === 'produto') {
        key = v.produto_id;
        label = v.produtos;
      } else if (groupBy === 'familia') {
        key = v.familia;
        label = v.familia;
      }

      if (!groups[key]) {
        groups[key] = { label, total: 0, comissao: 0, peso: 0 };
      }

      groups[key].total += v["r$_total"];
      groups[key].comissao += v.comissao_valor;
      groups[key].peso += v.peso_venda;
    });

    return Object.values(groups).sort((a, b) => b.total - a.total);
  }, [filteredVendas, groupBy]);

  const families = useMemo(() => {
    const fams = new Set(produtos.map(p => p.familia).filter(Boolean));
    return Array.from(fams).sort();
  }, [produtos]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-orange-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-2">
            <DollarSign className="text-orange-600" />
            Acompanhamento de Comissão
          </h1>
          <p className="text-neutral-500 text-sm">
            Análise detalhada de vendas e comissões por período.
          </p>
        </div>

        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-neutral-200 shadow-sm">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="bg-transparent border-none outline-none text-sm font-bold px-3 py-1.5"
          />
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Cliente</label>
          <select
            value={selectedClienteId}
            onChange={(e) => setSelectedClienteId(e.target.value)}
            className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Todos os Clientes</option>
            {clientes.map(c => (
              <option key={c.id} value={c.id}>{c.cliente}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Produto</label>
          <select
            value={selectedProdutoId}
            onChange={(e) => setSelectedProdutoId(e.target.value)}
            className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Todos os Produtos</option>
            {produtos.map(p => (
              <option key={p.id} value={p.id}>{p.produto}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Família</label>
          <select
            value={selectedFamilia}
            onChange={(e) => setSelectedFamilia(e.target.value)}
            className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">Todas as Famílias</option>
            {families.map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Agrupar Por</label>
          <div className="flex gap-1">
            {(['cliente', 'produto', 'familia'] as GroupBy[]).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={cn(
                  "flex-1 py-2 rounded-lg text-[10px] font-bold uppercase transition-all border",
                  groupBy === g 
                    ? "bg-orange-600 border-orange-600 text-white" 
                    : "bg-white border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <StatCard 
          label="Total Vendido" 
          value={`R$ ${stats.totalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<DollarSign size={20} />}
          color="blue"
        />
        <StatCard 
          label="Total Comissão" 
          value={`R$ ${stats.totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp size={20} />}
          color="orange"
        />
        <StatCard 
          label="Tendência Comissão" 
          value={`R$ ${stats.projetadoComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<TrendingUp size={20} />}
          color="green"
          trend={stats.isPositiveTrend ? "up" : "down"}
        />
        <StatCard 
          label="Comissão Média" 
          value={`${stats.percentualMedio.toFixed(2)}%`}
          icon={<PieChartIcon size={20} />}
          color="purple"
        />
        <StatCard 
          label="Pedidos" 
          value={stats.totalPedidos.toString()}
          icon={<Users size={20} />}
          color="neutral"
        />
        <StatCard 
          label="Ticket Médio" 
          value={`R$ ${stats.ticketMedio.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          icon={<BarChart3 size={20} />}
          color="neutral"
        />
      </div>

      {/* Chart */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <h3 className="font-black text-neutral-900 flex items-center gap-2">
            <BarChart3 className="text-orange-600" size={20} />
            Evolução Diária
          </h3>
        </div>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis 
                dataKey="date" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 'bold', fill: '#a3a3a3' }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fontWeight: 'bold', fill: '#a3a3a3' }}
                tickFormatter={(val) => `R$ ${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                formatter={(val: number) => [`R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']}
              />
              <Bar 
                dataKey="vendas" 
                fill="#ea580c" 
                radius={[4, 4, 0, 0]} 
                name="Vendas"
              />
              <Bar 
                dataKey="comissao" 
                fill="#8b5cf6" 
                radius={[4, 4, 0, 0]} 
                name="Comissão"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
          <h3 className="font-black text-neutral-900 uppercase text-xs tracking-widest">
            {`Agrupado por ${groupBy}`}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-neutral-50 text-[10px] uppercase font-black text-neutral-400 border-b border-neutral-200">
                <th className="px-4 py-3">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                <th className="px-4 py-3 text-right">Peso Total</th>
                <th className="px-4 py-3 text-right">Valor Total</th>
                <th className="px-4 py-3 text-right">Comissão Total</th>
                <th className="px-4 py-3 text-right">% Médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {groupedData?.map((g, idx) => (
                <tr key={idx} className="hover:bg-neutral-50 transition-colors text-xs">
                  <td className="px-4 py-3 font-bold text-neutral-900">{g.label}</td>
                  <td className="px-4 py-3 text-right font-medium">{g.peso.toFixed(1)} kg</td>
                  <td className="px-4 py-3 text-right font-bold">
                    R$ {g.total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-orange-600">
                    R$ {g.comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500">
                    {((g.comissao / g.total) * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-neutral-900 text-white">
              <tr className="text-xs font-bold">
                <td className="px-4 py-3 uppercase tracking-widest opacity-70">Total</td>
                <td className="px-4 py-3 text-right">{filteredVendas.reduce((acc, v) => acc + v.peso_venda, 0).toFixed(1)} kg</td>
                <td className="px-4 py-3 text-right">R$ {stats.totalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-3 text-right text-orange-400">R$ {stats.totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="px-4 py-3 text-right">{stats.percentualMedio.toFixed(2)}%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, trend }: { label: string, value: string, icon: React.ReactNode, color: string, trend?: 'up' | 'down' }) {
  const colorClasses = {
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    green: "bg-green-50 text-green-600 border-green-100",
    neutral: "bg-neutral-50 text-neutral-600 border-neutral-100"
  }[color as any] || "bg-neutral-50 text-neutral-600 border-neutral-100";

  return (
    <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm space-y-2 relative overflow-hidden">
      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center border", colorClasses)}>
        {icon}
      </div>
      <div>
        <p className="text-[10px] font-black text-neutral-400 uppercase tracking-widest flex items-center gap-1">
          {label}
          {trend && (
            <span className={cn(trend === 'up' ? "text-green-500" : "text-red-500")}>
              {trend === 'up' ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            </span>
          )}
        </p>
        <p className="text-lg font-black text-neutral-900">{value}</p>
      </div>
    </div>
  );
}
