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
import { classifySaleRecord } from '../lib/salesClassifier';
import { format, startOfMonth, endOfMonth, parseISO, eachDayOfInterval, isSameDay, differenceInDays, isAfter, isBefore, max } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { shouldExcludeSale } from '../constants';
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
  const [selectedYears, setSelectedYears] = useState<number[]>([new Date().getFullYear()]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([new Date().getMonth() + 1]); // Default to current month
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customRange, setCustomRange] = useState({
    start: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    end: format(endOfMonth(new Date()), 'yyyy-MM-dd')
  });
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [selectedProdutoId, setSelectedProdutoId] = useState('');
  const [selectedFamilia, setSelectedFamilia] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('cliente');

  const [showYearDropdown, setShowYearDropdown] = useState(false);
  const [showMonthDropdown, setShowMonthDropdown] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [showFamilyDropdown, setShowFamilyDropdown] = useState(false);

  const [clientSearch, setClientSearch] = useState('');
  const [productSearch, setProductSearch] = useState('');

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
          const classification = classifySaleRecord(v);
          const prod = productsMap.get(v.produto_id) || (v.produtos ? productsMap.get(v.produtos.toLowerCase()) : null);
          
          const comissao_percent = classification.entraComissao ? (prod?.comissao || 0) : 0;
          const rTotalCorrected = classification.entraFaturamento ? (v["r$_total"] || 0) : 0;
          const comissao_valor = rTotalCorrected * comissao_percent;
          const peso_venda = (v.qtd || 0) * (prod?.peso_embalagem || 0);

          return {
            ...v,
            "r$_total": rTotalCorrected,
            comissao_percent,
            comissao_valor,
            familia: prod?.familia || 'Sem Família',
            peso_venda
          };
        });

        // Apply selective cutoff globally just to be safe with this data source
        const finalEnriched = enrichedVendas.filter(v => {
          return !shouldExcludeSale(v.cliente, v.faturamento);
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

  const filteredVendas = useMemo(() => {
    return allHistoryVendas.filter(v => {
      const vDate = parseISO(v.faturamento);
      
      if (useCustomRange) {
        const start = parseISO(customRange.start);
        const end = parseISO(customRange.end);
        if (vDate < start || vDate > end) return false;
      } else {
        const yearMatch = selectedYears.length === 0 || selectedYears.includes(vDate.getFullYear());
        const monthMatch = selectedMonths.length === 0 || selectedMonths.includes(vDate.getMonth() + 1);
        if (!yearMatch || !monthMatch) return false;
      }

      const matchCliente = !selectedClienteId || v.cliente_id === selectedClienteId;
      const matchProduto = !selectedProdutoId || v.produto_id === selectedProdutoId;
      const matchFamilia = !selectedFamilia || v.familia === selectedFamilia;
      return matchCliente && matchProduto && matchFamilia;
    });
  }, [allHistoryVendas, useCustomRange, customRange, selectedYears, selectedMonths, selectedClienteId, selectedProdutoId, selectedFamilia]);

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

    // Projection calculation (only relevant if single current month is selected)
    const now = new Date();
    let projetadoComissao = totalComissao;
    
    if (!useCustomRange && selectedYears.length === 1 && selectedMonths.length === 1) {
      const targetMonthStart = new Date(selectedYears[0], selectedMonths[0] - 1, 1);
      const targetMonthEnd = endOfMonth(targetMonthStart);
      
      if (now >= targetMonthStart && now <= targetMonthEnd) {
        const daysPassed = Math.max(1, differenceInDays(now, targetMonthStart) + 1);
        const totalDays = Math.max(1, differenceInDays(targetMonthEnd, targetMonthStart) + 1);
        projetadoComissao = totalComissao * (totalDays / daysPassed);
      }
    }

    return {
      totalVendido,
      totalComissao,
      totalPedidos,
      percentualMedio,
      ticketMedio,
      projetadoComissao,
      isPositiveTrend: projetadoComissao >= totalComissao
    };
  }, [filteredVendas, useCustomRange, selectedYears, selectedMonths, deadlineDate]);

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
          <h1 className="text-2xl font-black text-neutral-900 tracking-tight">
            Comissões
          </h1>
          <p className="text-neutral-500 text-sm">
            Análise detalhada de vendas e comissões por período.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Year Dropdown */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Anos</label>
            <div className="relative">
              <button 
                onClick={() => setShowYearDropdown(!showYearDropdown)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
              >
                <span className="truncate">
                  {selectedYears.length === 0 ? "Todos os Anos" : `${selectedYears.length} selecionados`}
                </span>
                <ChevronDown size={16} className={cn("transition-transform", showYearDropdown && "rotate-180")} />
              </button>
              
              {showYearDropdown && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowYearDropdown(false)} />
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] p-1">
                    {[2024, 2025, 2026].map(y => (
                      <button
                        key={y}
                        onClick={() => {
                          setSelectedYears(prev => prev.includes(y) ? prev.filter(item => item !== y) : [...prev, y]);
                          setUseCustomRange(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-50 flex items-center gap-3 text-sm font-medium"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selectedYears.includes(y) ? "bg-orange-500 border-orange-500" : "border-neutral-300"
                        )}>
                          {selectedYears.includes(y) && <TrendingUp size={10} className="text-white" strokeWidth={4} />}
                        </div>
                        <span>{y}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setSelectedYears([]);
                        setUseCustomRange(false);
                      }}
                      className="w-full text-center py-2 text-[10px] font-black uppercase text-orange-600 hover:bg-orange-50 rounded-lg mt-1"
                    >
                      Limpar / Selecionar Todos
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Month Dropdown */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Meses</label>
            <div className="relative">
              <button 
                onClick={() => setShowMonthDropdown(!showMonthDropdown)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
              >
                <span className="truncate">
                  {selectedMonths.length === 0 ? "Todos os Meses" : `${selectedMonths.length} selecionados`}
                </span>
                <ChevronDown size={16} className={cn("transition-transform", showMonthDropdown && "rotate-180")} />
              </button>
              
              {showMonthDropdown && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowMonthDropdown(false)} />
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] max-h-64 overflow-y-auto p-1">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <button
                        key={i + 1}
                        onClick={() => {
                          setSelectedMonths(prev => prev.includes(i + 1) ? prev.filter(m => m !== i + 1) : [...prev, i + 1]);
                          setUseCustomRange(false);
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-50 flex items-center gap-3 text-sm font-medium"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          selectedMonths.includes(i + 1) ? "bg-orange-500 border-orange-500" : "border-neutral-300"
                        )}>
                          {selectedMonths.includes(i + 1) && <TrendingUp size={10} className="text-white" strokeWidth={4} />}
                        </div>
                        <span>{format(new Date(2024, i, 1), 'MMMM', { locale: ptBR })}</span>
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        setSelectedMonths([]);
                        setUseCustomRange(false);
                      }}
                      className="w-full text-center py-2 text-[10px] font-black uppercase text-orange-600 hover:bg-orange-50 rounded-lg mt-1"
                    >
                      Limpar / Selecionar Todos
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Custom Date Range Toggle */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Período Customizado</label>
            <div className="flex bg-neutral-100 p-1 rounded-xl border border-neutral-200 h-[42px]">
              <button 
                onClick={() => setUseCustomRange(false)}
                className={cn(
                  "flex-1 text-[10px] font-bold rounded-lg transition-all",
                  !useCustomRange ? "bg-white text-orange-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Anos/Meses
              </button>
              <button 
                onClick={() => setUseCustomRange(true)}
                className={cn(
                  "flex-1 text-[10px] font-bold rounded-lg transition-all",
                  useCustomRange ? "bg-white text-orange-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Datas Específicas
              </button>
            </div>
          </div>

          {/* Specific Dates Inputs */}
          {useCustomRange ? (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Datas</label>
              <div className="flex gap-2">
                <input 
                  type="date" 
                  value={customRange.start}
                  onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:ring-2 focus:ring-orange-500"
                />
                <input 
                  type="date" 
                  value={customRange.end}
                  onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                  className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:ring-2 focus:ring-orange-500"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-end h-[42px] mt-6">
              <button 
                onClick={() => {
                  setSelectedYears([2024, 2025, 2026]);
                  setSelectedMonths([]);
                  setUseCustomRange(false);
                }}
                className="w-full h-[42px] bg-neutral-900 text-white rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2"
              >
                <Calendar size={14} />
                Todo o Período
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4 border-t border-neutral-100">
          {/* Client Filter (Dropdown Style) */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Cliente</label>
            <div className="relative">
              <button 
                onClick={() => setShowClientDropdown(!showClientDropdown)}
                className="w-full flex items-center justify-between px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold flex-1 truncate"
              >
                <span className="truncate">
                  {selectedClienteId ? clientes.find(c => c.id === selectedClienteId)?.cliente : "Todos os Clientes"}
                </span>
                <ChevronDown size={14} />
              </button>
              {showClientDropdown && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowClientDropdown(false)} />
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] p-2 min-w-[280px]">
                    <div className="p-2 border-b border-neutral-100 mb-2">
                      <input 
                        placeholder="Buscar cliente..." 
                        value={clientSearch}
                        onChange={(e) => setClientSearch(e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      <button 
                        onClick={() => { setSelectedClienteId(''); setShowClientDropdown(false); }}
                        className={cn("w-full text-left px-3 py-2 rounded-lg text-sm font-medium", !selectedClienteId ? "bg-orange-50 text-orange-600" : "hover:bg-neutral-50")}
                      >
                        Todos os Clientes
                      </button>
                      {clientes
                        .filter(c => c.cliente.toLowerCase().includes(clientSearch.toLowerCase()))
                        .map(c => (
                        <button
                          key={c.id}
                          onClick={() => { setSelectedClienteId(c.id); setShowClientDropdown(false); }}
                          className={cn("w-full text-left px-3 py-2 rounded-lg text-sm font-medium truncate", selectedClienteId === c.id ? "bg-orange-50 text-orange-600" : "hover:bg-neutral-50")}
                        >
                          {c.cliente}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Product Filter */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Produto</label>
            <div className="relative">
              <button 
                onClick={() => setShowProductDropdown(!showProductDropdown)}
                className="w-full flex items-center justify-between px-4 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold truncate"
              >
                <span className="truncate">
                  {selectedProdutoId ? produtos.find(p => p.id === selectedProdutoId)?.produto : "Todos os Produtos"}
                </span>
                <ChevronDown size={14} />
              </button>
              {showProductDropdown && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowProductDropdown(false)} />
                  <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] p-2 min-w-[280px]">
                    <div className="p-2 border-b border-neutral-100 mb-2">
                      <input 
                        placeholder="Buscar produto..." 
                        value={productSearch}
                        onChange={(e) => setProductSearch(e.target.value)}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="max-h-60 overflow-y-auto">
                      <button 
                        onClick={() => { setSelectedProdutoId(''); setShowProductDropdown(false); }}
                        className={cn("w-full text-left px-3 py-2 rounded-lg text-sm font-medium", !selectedProdutoId ? "bg-orange-50 text-orange-600" : "hover:bg-neutral-50")}
                      >
                        Todos os Produtos
                      </button>
                      {produtos
                        .filter(p => p.produto.toLowerCase().includes(productSearch.toLowerCase()))
                        .map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedProdutoId(p.id); setShowProductDropdown(false); }}
                          className={cn("w-full text-left px-3 py-2 rounded-lg text-sm font-medium truncate", selectedProdutoId === p.id ? "bg-orange-50 text-orange-600" : "hover:bg-neutral-50")}
                        >
                          {p.produto}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Família</label>
            <select
              value={selectedFamilia}
              onChange={(e) => setSelectedFamilia(e.target.value)}
              className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
            >
              <option value="">Todas as Famílias</option>
              {families.map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest block">Agrupar Por</label>
            <div className="flex bg-neutral-100 p-1 rounded-xl border border-neutral-200 h-[42px]">
              {(['cliente', 'produto', 'familia'] as GroupBy[]).map((g) => (
                <button
                  key={g}
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    "flex-1 text-[10px] font-black uppercase transition-all rounded-lg",
                    groupBy === g 
                      ? "bg-white text-orange-600 shadow-sm" 
                      : "text-neutral-500 hover:text-neutral-700"
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
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
              <BarChart data={monthlyComparisonData} barCategoryGap="35%" barGap={3} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
                  barSize={12}
                />
                <Bar 
                  dataKey="comissao_2025" 
                  name="2025" 
                  fill="#f97316" 
                  radius={[2, 2, 0, 0]} 
                  barSize={12}
                />
                <Bar 
                  dataKey="comissao_2026" 
                  name="2026" 
                  fill="#10b981" 
                  radius={[2, 2, 0, 0]} 
                  barSize={12}
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
