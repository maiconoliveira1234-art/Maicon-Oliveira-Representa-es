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
import { cn, deduplicateSales } from '../lib/utils';
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, isSameDay, differenceInDays, isAfter, isBefore, max } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { SALES_CUTOFF_DATE, SALES_CUTOFF_CLIENTS } from '../constants';
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
  Area,
  Legend
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
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customRange, setCustomRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [selectedProdutoId, setSelectedProdutoId] = useState('');
  const [selectedFamilia, setSelectedFamilia] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('cliente');

  const [allHistoryVendas, setAllHistoryVendas] = useState<CommissionData[]>([]);

  const deadlineDate = useMemo(() => {
    return localStorage.getItem('metas_deadline_date') || format(endOfMonth(new Date()), 'yyyy-MM-dd');
  }, []);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // Fetch from 2024 to allow evolution chart
        const startOfHistory = '2024-01-01';
        
        const [vendasRes, produtosRes, clientesRes] = await Promise.all([
          supabase
            .from('hist_vendas')
            .select('*')
            .gte('faturamento', startOfHistory),
          supabase.from('produtos').select('*'),
          supabase.from('clientes').select('*').order('cliente')
        ]);

        if (vendasRes.error) throw vendasRes.error;
        if (produtosRes.error) throw produtosRes.error;
        if (clientesRes.error) throw clientesRes.error;

        // Deduplicate data
        const uniqueVendas = deduplicateSales(vendasRes.data || []);

        // Create a more robust products map with name fallback
        const productsMap = new Map();
        (produtosRes.data || []).forEach(p => {
          productsMap.set(p.id, p);
          productsMap.set(p.produto.toLowerCase(), p);
        });
        
        const enrichedVendas: CommissionData[] = uniqueVendas.map(v => {
          const prod = productsMap.get(v.produto_id) || (v.produtos ? productsMap.get(v.produtos.toLowerCase()) : null);
          const comissao_percent = prod?.comissao || 0;
          const comissao_valor = (v["r$_total"] || 0) * comissao_percent;
          const peso_venda = (v.qtd || 0) * (prod?.peso_embalagem || 0);
          
          return {
            ...v,
            comissao_percent,
            comissao_valor,
            familia: prod?.familia || 'Sem Família',
            peso_venda
          };
        });

        // Apply selective cutoff globally just to be safe with this data source
        const finalEnriched = enrichedVendas.filter(v => {
          const clientName = (v.cliente || '').trim().toUpperCase();
          if (SALES_CUTOFF_CLIENTS.includes(clientName)) {
            return v.faturamento >= SALES_CUTOFF_DATE;
          }
          return true;
        });

        setAllHistoryVendas(finalEnriched);
        setProdutos(produtosRes.data || []);
        setClientes(clientesRes.data || []);
      } catch (err) {
        console.error('Erro ao carregar dados de comissão:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  const currentRange = useMemo(() => {
    if (useCustomRange) {
      return {
        start: parseISO(customRange.start),
        end: parseISO(customRange.end)
      };
    }
    const date = parseISO(`${selectedMonth}-01`);
    return {
      start: startOfMonth(date),
      end: endOfMonth(date)
    };
  }, [useCustomRange, customRange, selectedMonth]);

  const filteredVendas = useMemo(() => {
    return allHistoryVendas.filter(v => {
      const vDate = parseISO(v.faturamento);
      const isWithinDate = vDate >= currentRange.start && vDate <= currentRange.end;
      if (!isWithinDate) return false;

      const matchCliente = !selectedClienteId || v.cliente_id === selectedClienteId;
      const matchProduto = !selectedProdutoId || v.produto_id === selectedProdutoId;
      const matchFamilia = !selectedFamilia || v.familia === selectedFamilia;
      return matchCliente && matchProduto && matchFamilia;
    });
  }, [allHistoryVendas, currentRange, selectedClienteId, selectedProdutoId, selectedFamilia]);

  const monthlyComparisonData = useMemo(() => {
    const months = Array.from({ length: 12 }).map((_, i) => i);
    const years = [2024, 2025, 2026];

    return months.map(monthIndex => {
      const monthName = format(new Date(2024, monthIndex, 1), 'MMM', { locale: ptBR });
      const entry: any = { name: monthName };
      
      years.forEach(year => {
        const yearMonthData = allHistoryVendas.filter(h => {
          const d = parseISO(h.faturamento);
          // Apply current filters (except date range)
          const matchCliente = !selectedClienteId || h.cliente_id === selectedClienteId;
          const matchProduto = !selectedProdutoId || h.produto_id === selectedProdutoId;
          const matchFamilia = !selectedFamilia || h.familia === selectedFamilia;
          
          return d.getFullYear() === year && d.getMonth() === monthIndex && matchCliente && matchProduto && matchFamilia;
        });
        
        entry[`comissao_${year}`] = yearMonthData.reduce((acc, h) => acc + (h.comissao_valor || 0), 0);
      });

      return entry;
    });
  }, [allHistoryVendas, selectedClienteId, selectedProdutoId, selectedFamilia]);

  const stats = useMemo(() => {
    const totalVendido = filteredVendas.reduce((acc, v) => acc + v["r$_total"], 0);
    const totalComissao = filteredVendas.reduce((acc, v) => acc + v.comissao_valor, 0);
    const totalPedidos = new Set(filteredVendas.map(v => `${v.cliente_id}-${v.faturamento}`)).size;
    const percentualMedio = totalVendido > 0 ? (totalComissao / totalVendido) * 100 : 0;
    const ticketMedio = totalPedidos > 0 ? totalVendido / totalPedidos : 0;

    // Trend calculation
    const now = new Date();
    const monthStart = currentRange.start;
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
          <div className="flex items-center bg-neutral-100 rounded-lg p-0.5">
            <button
              onClick={() => setUseCustomRange(false)}
              className={cn(
                "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                !useCustomRange ? "bg-white shadow-sm text-orange-600" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Mês
            </button>
            <button
              onClick={() => setUseCustomRange(true)}
              className={cn(
                "px-3 py-1 text-[10px] font-bold rounded-md transition-all",
                useCustomRange ? "bg-white shadow-sm text-orange-600" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              Período
            </button>
          </div>
          
          {!useCustomRange ? (
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-bold px-3 py-1.5"
            />
          ) : (
            <div className="flex items-center gap-2 px-2">
              <input
                type="date"
                value={customRange.start}
                onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                className="bg-transparent border-none outline-none text-[10px] font-bold"
              />
              <span className="text-neutral-300">|</span>
              <input
                type="date"
                value={customRange.end}
                onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                className="bg-transparent border-none outline-none text-[10px] font-bold"
              />
            </div>
          )}
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

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6">
        {/* Evolution Chart */}
        <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-black text-neutral-900 flex items-center gap-2">
              <BarChart3 className="text-blue-600" size={20} />
              Comparativo Mensal de Comissão
            </h3>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyComparisonData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 'bold', fill: '#a3a3a3' }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 9, fontWeight: 'bold', fill: '#a3a3a3' }}
                  tickFormatter={(val) => `R$ ${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val}`}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
                  formatter={(val: number) => [`R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']}
                />
                <Legend verticalAlign="top" align="center" iconType="circle" wrapperStyle={{ paddingBottom: '10px', fontSize: '9px', fontWeight: 'bold' }} />
                <Bar 
                  dataKey="comissao_2024" 
                  name="2024" 
                  fill="#3b82f6" 
                  radius={[2, 2, 0, 0]} 
                  barSize={20}
                />
                <Bar 
                  dataKey="comissao_2025" 
                  name="2025" 
                  fill="#f97316" 
                  radius={[2, 2, 0, 0]} 
                  barSize={20}
                />
                <Bar 
                  dataKey="comissao_2026" 
                  name="2026" 
                  fill="#10b981" 
                  radius={[2, 2, 0, 0]} 
                  barSize={20}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
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
                  <td className="px-4 py-3 text-right font-medium">{g.peso.toFixed(2)} kg</td>
                  <td className="px-4 py-3 text-right font-bold">
                    R$ {g.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-orange-600">
                    R$ {g.comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                <td className="px-4 py-3 text-right">{filteredVendas.reduce((acc, v) => acc + v.peso_venda, 0).toFixed(2)} kg</td>
                <td className="px-4 py-3 text-right">R$ {stats.totalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-3 text-right text-orange-400">R$ {stats.totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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
