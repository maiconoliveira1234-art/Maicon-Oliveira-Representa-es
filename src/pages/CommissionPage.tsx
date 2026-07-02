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
  Legend
} from 'recharts';

interface CommissionData extends HistVenda {
  comissao_valor: number;
  comissao_percent: number;
  familia: string;
  peso_venda: number;
}

type GroupBy = 'cliente' | 'produto' | 'familia';

const IPI_COMMISSION_FAMILY_CODES = new Set(['01', '02', '04', '07', '08', '11', '12', '14', '15']);
const IPI_COMMISSION_FACTOR = 0.935;
const IPI_WEIGHT_LIMIT_KG = 10.1;

function getFamilyCode(familia?: string) {
  return (familia || '').trim().slice(0, 2);
}

function shouldApplyIpiCommissionDiscount(produto?: Produto | null) {
  if (!produto) return false;
  const familyCode = getFamilyCode(produto.familia);
  const packageWeight = Number(produto.peso_embalagem) || 0;
  return IPI_COMMISSION_FAMILY_CODES.has(familyCode) && packageWeight < IPI_WEIGHT_LIMIT_KG;
}

function normalizeCommissionPercent(rawPercent: number) {
  if (!Number.isFinite(rawPercent) || rawPercent <= 0) return 0;
  return rawPercent > 1 ? rawPercent / 100 : rawPercent;
}

function calculateCommissionValue(totalValue: number, commissionPercent: number, produto?: Produto | null) {
  const baseCommission = totalValue * normalizeCommissionPercent(commissionPercent);
  return shouldApplyIpiCommissionDiscount(produto) ? baseCommission * IPI_COMMISSION_FACTOR : baseCommission;
}

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
  const [showFilters, setShowFilters] = useState(false);

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
          const comissao_valor = calculateCommissionValue(rTotalCorrected, comissao_percent, prod);
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

  // Filter sales based on selected filters
  useEffect(() => {
    let filtered = allHistoryVendas;

    if (useCustomRange) {
      filtered = filtered.filter(v => {
        const date = parseISO(v.faturamento);
        return !isBefore(date, parseISO(customRange.start)) && !isAfter(date, parseISO(customRange.end));
      });
    } else {
      if (selectedYears.length > 0) {
        filtered = filtered.filter(v => selectedYears.includes(new Date(v.faturamento).getFullYear()));
      }
      if (selectedMonths.length > 0) {
        filtered = filtered.filter(v => selectedMonths.includes(new Date(v.faturamento).getMonth() + 1));
      }
    }

    if (selectedClienteId) {
      filtered = filtered.filter(v => v.cliente_id === selectedClienteId);
    }
    if (selectedProdutoId) {
      filtered = filtered.filter(v => v.produto_id === selectedProdutoId);
    }
    if (selectedFamilia) {
      filtered = filtered.filter(v => v.familia === selectedFamilia);
    }

    setVendas(filtered);
  }, [allHistoryVendas, selectedYears, selectedMonths, useCustomRange, customRange, selectedClienteId, selectedProdutoId, selectedFamilia]);

  const filteredVendas = vendas;

  // Monthly evolution data for 2024, 2025, 2026
  const monthlyEvolution = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const years = [2024, 2025, 2026];
    
    return months.map((month, index) => {
      const entry: any = { month };
      years.forEach(year => {
        const yearMonthData = allHistoryVendas.filter(h => {
          const date = new Date(h.faturamento);
          return date.getFullYear() === year && date.getMonth() === index;
        });
        entry[`comissao_${year}`] = yearMonthData.reduce((acc, h) => acc + (h.comissao_valor || 0), 0);
      });
      return entry;
    });
  }, [allHistoryVendas]);

  // Stats
  const stats = useMemo(() => {
    const totalVendido = filteredVendas.reduce((acc, v) => acc + (v["r$_total"] || 0), 0);
    const totalComissao = filteredVendas.reduce((acc, v) => acc + v.comissao_valor, 0);
    const pesoTotal = filteredVendas.reduce((acc, v) => acc + v.peso_venda, 0);
    const percentualMedio = totalVendido > 0 ? (totalComissao / totalVendido) * 100 : 0;

    // Projected Commission
    let projetadoComissao = totalComissao;
    let isProjection = false;
    
    if (!useCustomRange && selectedYears.length === 1 && selectedMonths.length === 1) {
      const year = selectedYears[0];
      const month = selectedMonths[0];
      const selectedDate = new Date(year, month - 1, 1);
      const deadline = parseISO(deadlineDate);
      
      if (selectedDate.getMonth() === deadline.getMonth() && selectedDate.getFullYear() === deadline.getFullYear()) {
        const start = startOfMonth(selectedDate);
        const end = deadline;
        const today = new Date();
        const effectiveToday = isBefore(today, end) ? today : end;
        const daysPassed = Math.max(1, differenceInDays(effectiveToday, start) + 1);
        const totalDays = differenceInDays(end, start) + 1;
        projetadoComissao = totalComissao * (totalDays / daysPassed);
        isProjection = true;
      }
    }

    return {
      totalVendido,
      totalComissao,
      pesoTotal,
      percentualMedio,
      totalItens: filteredVendas.length,
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
        key = v.produto_id || v.produtos;
        label = v.produtos;
      } else {
        key = v.familia;
        label = v.familia;
      }

      if (!groups[key]) {
        groups[key] = { label, total: 0, comissao: 0, peso: 0 };
      }

      groups[key].total += v["r$_total"] || 0;
      groups[key].comissao += v.comissao_valor;
      groups[key].peso += v.peso_venda;
    });

    return Object.values(groups)
      .sort((a, b) => b.comissao - a.comissao)
      .slice(0, 20);
  }, [filteredVendas, groupBy]);

  const uniqueFamilies = useMemo(() => {
    return Array.from(new Set(allHistoryVendas.map(v => v.familia))).sort();
  }, [allHistoryVendas]);

  const filteredClientes = useMemo(() => {
    return clientes.filter(c => c.cliente.toLowerCase().includes(clientSearch.toLowerCase()));
  }, [clientes, clientSearch]);

  const filteredProdutos = useMemo(() => {
    return produtos.filter(p => p.produto.toLowerCase().includes(productSearch.toLowerCase()));
  }, [produtos, productSearch]);

  const toggleYear = (year: number) => {
    setSelectedYears(prev => prev.includes(year) ? prev.filter(y => y !== year) : [...prev, year]);
  };

  const toggleMonth = (month: number) => {
    setSelectedMonths(prev => prev.includes(month) ? prev.filter(m => m !== month) : [...prev, month]);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin text-orange-600 mx-auto mb-4" size={40} />
          <p className="text-neutral-500 font-bold">Calculando comissões...</p>
        </div>
      </div>
    );
  }

  const years = [2024, 2025, 2026];
  const months = [
    { value: 1, label: 'Jan' }, { value: 2, label: 'Fev' }, { value: 3, label: 'Mar' },
    { value: 4, label: 'Abr' }, { value: 5, label: 'Mai' }, { value: 6, label: 'Jun' },
    { value: 7, label: 'Jul' }, { value: 8, label: 'Ago' }, { value: 9, label: 'Set' },
    { value: 10, label: 'Out' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dez' }
  ];

  return (
    <div className="min-h-screen bg-neutral-100/70 p-3 md:p-5 space-y-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-black text-neutral-950 tracking-tight flex items-center gap-2">
            <DollarSign className="text-orange-600" size={28} />
            Acompanhamento de Comissão
          </h1>
          <p className="text-sm text-neutral-500 font-medium mt-1">Análise detalhada de comissões por período, cliente e produto</p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-black transition-all border",
            showFilters ? "bg-orange-600 text-white border-orange-600 shadow-sm" : "bg-white text-neutral-700 border-neutral-300 hover:border-neutral-400"
          )}
        >
          <Filter size={20} />
          Filtros
        </button>
      </div>

      {/* Filters Panel */}
      {showFilters && (
        <div className="bg-white p-4 rounded-xl border border-neutral-200 shadow-sm space-y-4 animate-in slide-in-from-top-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date Type Toggle */}
            <div className="col-span-full flex gap-1 bg-neutral-100 p-1 rounded-lg w-fit">
              <button
                onClick={() => setUseCustomRange(false)}
                className={cn("px-3 py-1.5 rounded-md text-sm font-bold transition-all", !useCustomRange ? "bg-white shadow-sm text-orange-600" : "text-neutral-500")}
              >
                Mês/Ano
              </button>
              <button
                onClick={() => setUseCustomRange(true)}
                className={cn("px-3 py-1.5 rounded-md text-sm font-bold transition-all", useCustomRange ? "bg-white shadow-sm text-orange-600" : "text-neutral-500")}
              >
                Período Personalizado
              </button>
            </div>

            {useCustomRange ? (
              <>
                <div>
                  <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Data Início</label>
                  <input
                    type="date"
                    value={customRange.start}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Data Fim</label>
                  <input
                    type="date"
                    value={customRange.end}
                    onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold"
                  />
                </div>
              </>
            ) : (
              <>
                {/* Year Multi Select */}
                <div className="relative">
                  <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Anos</label>
                  <button
                    onClick={() => setShowYearDropdown(!showYearDropdown)}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold flex justify-between items-center"
                  >
                    {selectedYears.length > 0 ? selectedYears.join(', ') : 'Todos'}
                    <ChevronDown size={16} />
                  </button>
                  {showYearDropdown && (
                    <div className="absolute z-20 mt-2 w-full bg-white border border-neutral-200 rounded-lg shadow-xl p-2">
                      {years.map(year => (
                        <label key={year} className="flex items-center gap-2 p-2 hover:bg-neutral-50 rounded-md cursor-pointer">
                          <input type="checkbox" checked={selectedYears.includes(year)} onChange={() => toggleYear(year)} className="accent-orange-600" />
                          <span className="font-bold">{year}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Month Multi Select */}
                <div className="relative">
                  <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Meses</label>
                  <button
                    onClick={() => setShowMonthDropdown(!showMonthDropdown)}
                    className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold flex justify-between items-center"
                  >
                    {selectedMonths.length > 0 ? `${selectedMonths.length} selecionado(s)` : 'Todos'}
                    <ChevronDown size={16} />
                  </button>
                  {showMonthDropdown && (
                    <div className="absolute z-20 mt-2 w-64 bg-white border border-neutral-200 rounded-lg shadow-xl p-2 grid grid-cols-3 gap-1">
                      {months.map(m => (
                        <label key={m.value} className="flex items-center gap-1 p-2 hover:bg-neutral-50 rounded-md cursor-pointer text-sm">
                          <input type="checkbox" checked={selectedMonths.includes(m.value)} onChange={() => toggleMonth(m.value)} className="accent-orange-600" />
                          <span className="font-bold">{m.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Client Select */}
            <div className="relative">
              <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Cliente</label>
              <button
                onClick={() => setShowClientDropdown(!showClientDropdown)}
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold flex justify-between items-center truncate"
              >
                <span className="truncate">{selectedClienteId ? clientes.find(c => c.id === selectedClienteId)?.cliente : 'Todos'}</span>
                <ChevronDown size={16} className="shrink-0" />
              </button>
              {showClientDropdown && (
                <div className="absolute z-20 mt-2 w-80 bg-white border border-neutral-200 rounded-lg shadow-xl p-2 max-h-80 overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    className="w-full px-3 py-2 mb-2 bg-neutral-50 border border-neutral-200 rounded-md text-sm outline-none"
                  />
                  <button
                    onClick={() => { setSelectedClienteId(''); setShowClientDropdown(false); }}
                    className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-bold text-orange-600"
                  >
                    Todos os Clientes
                  </button>
                  {filteredClientes.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClienteId(c.id); setShowClientDropdown(false); }}
                      className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-medium text-sm truncate"
                    >
                      {c.cliente}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Select */}
            <div className="relative">
              <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Produto</label>
              <button
                onClick={() => setShowProductDropdown(!showProductDropdown)}
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold flex justify-between items-center truncate"
              >
                <span className="truncate">{selectedProdutoId ? produtos.find(p => p.id === selectedProdutoId)?.produto : 'Todos'}</span>
                <ChevronDown size={16} className="shrink-0" />
              </button>
              {showProductDropdown && (
                <div className="absolute z-20 mt-2 w-80 bg-white border border-neutral-200 rounded-lg shadow-xl p-2 max-h-80 overflow-y-auto">
                  <input
                    type="text"
                    placeholder="Buscar produto..."
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="w-full px-3 py-2 mb-2 bg-neutral-50 border border-neutral-200 rounded-md text-sm outline-none"
                  />
                  <button
                    onClick={() => { setSelectedProdutoId(''); setShowProductDropdown(false); }}
                    className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-bold text-orange-600"
                  >
                    Todos os Produtos
                  </button>
                  {filteredProdutos.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedProdutoId(p.id); setShowProductDropdown(false); }}
                      className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-medium text-sm truncate"
                    >
                      {p.produto}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Family Select */}
            <div className="relative">
              <label className="text-xs font-bold text-neutral-500 uppercase mb-2 block">Família</label>
              <button
                onClick={() => setShowFamilyDropdown(!showFamilyDropdown)}
                className="w-full px-3 py-2 bg-white border border-neutral-300 rounded-lg text-sm font-bold flex justify-between items-center truncate"
              >
                <span className="truncate">{selectedFamilia || 'Todas'}</span>
                <ChevronDown size={16} className="shrink-0" />
              </button>
              {showFamilyDropdown && (
                <div className="absolute z-20 mt-2 w-64 bg-white border border-neutral-200 rounded-lg shadow-xl p-2 max-h-80 overflow-y-auto">
                  <button
                    onClick={() => { setSelectedFamilia(''); setShowFamilyDropdown(false); }}
                    className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-bold text-orange-600"
                  >
                    Todas as Famílias
                  </button>
                  {uniqueFamilies.map(f => (
                    <button
                      key={f}
                      onClick={() => { setSelectedFamilia(f); setShowFamilyDropdown(false); }}
                      className="w-full text-left p-2 hover:bg-neutral-50 rounded-md font-medium text-sm truncate"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Group By */}
          <div className="flex items-center gap-2 pt-2 border-t border-neutral-100">
            <span className="text-xs font-bold text-neutral-500 uppercase">Agrupar por:</span>
            {(['cliente', 'produto', 'familia'] as GroupBy[]).map(g => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={cn(
                  "px-3 py-1 rounded-md text-sm font-bold capitalize transition-all",
                  groupBy === g ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <StatCard 
          icon={<DollarSign />} 
          label="Total Vendido" 
          value={`R$ ${stats.totalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          color="blue"
        />
        <StatCard 
          icon={<TrendingUp />} 
          label="Total Comissão" 
          value={`R$ ${stats.totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          color="orange"
        />
        <StatCard 
          icon={<BarChart3 />} 
          label="Tendência Comissão" 
          value={`R$ ${stats.projetadoComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
          color={stats.isPositiveTrend ? "green" : "red"}
          trend={stats.isPositiveTrend}
        />
        <StatCard 
          icon={<PieChartIcon />} 
          label="Comissão Média" 
          value={`${stats.percentualMedio.toFixed(2)}%`}
          color="purple"
        />
        <StatCard 
          icon={<Package />} 
          label="Peso Total" 
          value={`${stats.pesoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg`}
          color="green"
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Evolution Chart */}
        <div className="bg-white p-4 md:p-5 rounded-xl border border-neutral-200 shadow-sm lg:col-span-2">
          <h3 className="text-base font-black text-neutral-900 mb-4 flex items-center gap-2">
            <Calendar className="text-neutral-500" size={18} />
            Comparativo Mensal de Comissão
          </h3>
          <div className="h-72 md:h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyEvolution} barCategoryGap="60%" barGap={2} barSize={10} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fontWeight: 700, fill: '#525252' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => `R$ ${(value / 1000).toFixed(0)}k`} tick={{ fontSize: 11, fill: '#737373' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  formatter={(value: any) => [`R$ ${Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, '']}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', boxShadow: '0 10px 20px rgba(0,0,0,0.08)' }}
                />
                <Legend />
                <Bar dataKey="comissao_2024" name="2024" fill="#22c55e" radius={[6, 6, 0, 0]} />
                <Bar dataKey="comissao_2025" name="2025" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="comissao_2026" name="2026" fill="#ea580c" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Grouped Data Table */}
        <div className="bg-white p-4 md:p-5 rounded-xl border border-neutral-200 shadow-sm lg:col-span-2">
          <h3 className="text-base font-black text-neutral-900 mb-4 flex items-center gap-2">
            <Users className="text-neutral-500" size={18} />
            Ranking por {groupBy === 'cliente' ? 'Cliente' : groupBy === 'produto' ? 'Produto' : 'Família'}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-[11px] text-neutral-500 uppercase font-black">
                  <th className="px-3 py-2.5">{groupBy === 'cliente' ? 'Cliente' : groupBy === 'produto' ? 'Produto' : 'Família'}</th>
                  <th className="px-3 py-2.5 text-right">Valor Total</th>
                  <th className="px-3 py-2.5 text-right">Comissão Total</th>
                  <th className="px-3 py-2.5 text-right">% Médio</th>
                  <th className="px-3 py-2.5 text-right">Peso</th>
                </tr>
              </thead>
              <tbody>
                {groupedData.map((g, idx) => (
                  <tr key={idx} className="border-b border-neutral-100 hover:bg-neutral-50 transition-colors">
                    <td className="px-3 py-2.5 font-bold text-neutral-800 max-w-md truncate">{g.label}</td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      R$ {g.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-black text-neutral-900">
                      R$ {g.comissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-3 py-2.5 text-right font-medium">
                      {((g.comissao / g.total) * 100).toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-neutral-500">
                      {g.peso.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-neutral-100 font-black border-t border-neutral-200">
                <tr>
                  <td className="px-3 py-2.5">TOTAL</td>
                  <td className="px-3 py-2.5 text-right">R$ {stats.totalVendido.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2.5 text-right text-neutral-900">R$ {stats.totalComissao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-3 py-2.5 text-right">{stats.percentualMedio.toFixed(2)}%</td>
                  <td className="px-3 py-2.5 text-right">{stats.pesoTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} kg</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color, trend }: { icon: React.ReactNode; label: string; value: string; color: string; trend?: boolean }) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600'
  } as any;

  return (
    <div className="bg-white px-3 py-2 rounded-lg border border-neutral-200 shadow-sm min-h-[64px]">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className={cn("w-6 h-6 rounded-md flex items-center justify-center bg-neutral-50 [&_svg]:w-3.5 [&_svg]:h-3.5", colorClasses[color])}>
          {icon}
        </div>
        {trend !== undefined && (
          <div className={cn("flex items-center gap-0.5 text-[10px] font-bold leading-none", trend ? "text-green-600" : "text-red-600")}>
            {trend ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            Projeção
          </div>
        )}
      </div>
      <p className="text-[10px] font-black text-neutral-500 uppercase leading-none mb-1">{label}</p>
      <h3 className="text-base md:text-lg font-black text-neutral-950 truncate leading-tight">{value}</h3>
    </div>
  );
}
