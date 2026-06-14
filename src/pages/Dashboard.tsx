import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutDashboard, 
  TrendingUp, 
  Package, 
  DollarSign, 
  Users, 
  ShoppingCart, 
  Calendar,
  Filter,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Target,
  AlertCircle,
  Search,
  X,
  Check
} from 'lucide-react';
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
  PieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area,
  Legend
} from 'recharts';
import { supabase } from '../lib/supabase';
import { Cliente, Produto, HistVenda } from '../types';
import { cn, formatCurrency, formatWeight, deduplicateSales } from '../lib/utils';
import { classifySaleRecord } from '../lib/salesClassifier';
import { 
  startOfMonth, 
  endOfMonth, 
  subMonths, 
  format, 
  parseISO, 
  isWithinInterval, 
  subDays, 
  subYears,
  differenceInDays,
  startOfYear,
  eachMonthOfInterval,
  isSameMonth,
  isSameYear
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { shouldExcludeSale } from '../constants';

// --- Types for Dashboard ---
type DashboardFilters = {
  clientIds: string[];
  families: string[];
  productIds: string[];
  year: number | 'all';
  month: number | 'all';
  startDate: string;
  endDate: string;
  useCustomRange: boolean;
};

type KpiData = {
  value: number;
  previousValue: number;
  label: string;
  format: (v: number) => string;
  icon: React.ElementType;
  color: string;
};

const COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#f43f5e', '#eab308', '#06b6d4', '#ec4899'];

// --- Helper Components ---
const KpiCard: React.FC<{ kpi: KpiData, onClick?: () => void }> = ({ kpi, onClick }) => {
  const variation = kpi.previousValue > 0 ? ((kpi.value - kpi.previousValue) / kpi.previousValue) * 100 : 0;
  const isPositive = variation >= 0;

  return (
    <div 
      onClick={onClick}
      className={cn(
        "bg-white p-3 rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-all",
        onClick && "cursor-pointer hover:border-orange-300 active:scale-95"
      )}
    >
      <div className="flex justify-between items-start mb-2">
        <div className={cn("p-2 rounded-xl", {
          'bg-blue-50 text-blue-600': kpi.color === 'blue',
          'bg-orange-50 text-orange-600': kpi.color === 'orange',
          'bg-green-50 text-green-600': kpi.color === 'green',
          'bg-purple-50 text-purple-600': kpi.color === 'purple',
          'bg-indigo-50 text-indigo-600': kpi.color === 'indigo',
          'bg-cyan-50 text-cyan-600': kpi.color === 'cyan',
          'bg-rose-50 text-rose-600': kpi.color === 'rose',
        })}>
          <kpi.icon size={18} />
        </div>
        <div className="flex flex-col items-end">
          <div className={cn("flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full", 
            isPositive ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
          )}>
            {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
            {Math.abs(variation).toFixed(1)}%
          </div>
          <span className="text-[8px] font-bold text-neutral-400 mt-1 uppercase tracking-tighter">
            {kpi.format(kpi.previousValue)}
          </span>
        </div>
      </div>
      <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-0.5">{kpi.label}</p>
      <h3 className="text-lg font-black text-neutral-900 truncate">{kpi.format(kpi.value)}</h3>
    </div>
  );
};

const ChartCard: React.FC<{ title: string, children: React.ReactNode, className?: string }> = ({ title, children, className }) => (
  <div className={cn("bg-white p-3 rounded-2xl border border-neutral-200 shadow-sm flex flex-col h-full", className)}>
    <h3 className="text-[11px] font-bold text-neutral-800 mb-2 uppercase tracking-tight flex items-center gap-2 shrink-0">
      <div className="w-1 h-3 bg-orange-500 rounded-full" />
      {title}
    </h3>
    <div className="flex-1 w-full min-h-0">
      {children}
    </div>
  </div>
);

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [allSalesData, setAllSalesData] = useState<HistVenda[]>([]);

  // --- Filter State ---
  const now = new Date();
  const [filters, setFilters] = useState<DashboardFilters>({
    clientIds: [],
    families: [],
    productIds: [],
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    startDate: format(startOfMonth(now), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(now), 'yyyy-MM-dd'),
    useCustomRange: false
  });

  const [showFilters, setShowFilters] = useState(false);
  const [isFilterAnimationFinished, setIsFilterAnimationFinished] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [showFamilyDropdown, setShowFamilyDropdown] = useState(false);
  const [evolutionMetric, setEvolutionMetric] = useState<'value' | 'weight'>('weight');
  
  // --- Chart Visibility State ---
  const [visibleCharts, setVisibleCharts] = useState<string[]>(['monthly']);

  const chartOptions = [
    { id: 'monthly', label: 'Comparativo Mensal' },
    { id: 'clients', label: 'Top 10 Clientes' },
    { id: 'family', label: 'Faturamento por Família' },
    { id: 'products', label: 'Top 10 Produtos' }
  ];

  // --- Load Initial Data ---
  useEffect(() => {
    async function loadBaseData() {
      try {
        const [
          { data: cData },
          { data: pData },
          { data: mData }
        ] = await Promise.all([
          supabase.from('clientes').select('*').order('cliente'),
          supabase.from('produtos').select('*').order('produto'),
          supabase.from('metas').select('*')
        ]);

        if (cData) setClientes(cData);
        if (pData) setProdutos(pData.filter(p => p.familia?.toLowerCase() !== 'amostras e brindes'));
        if (mData) {
          const map: Record<string, number> = {};
          mData.forEach(m => map[m.cliente_id] = m.meta);
          setMetas(map);
        }
      } catch (err) {
        console.error('Error loading base data:', err);
      }
    }
    loadBaseData();
  }, []);

  // --- Load Sales Data (All History) ---
  useEffect(() => {
    async function loadSalesData() {
      setLoading(true);
      try {
        const { data } = await supabase.from('hist_vendas').select('*');
        setAllSalesData(deduplicateSales(data || []));
      } catch (err) {
        console.error('Error loading sales data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSalesData();
  }, []);

  // --- Derived Data & Filtering ---
  const produtosMap = useMemo(() => {
    const map: Record<string, Produto> = {};
    produtos.forEach(p => {
      map[p.id] = p;
      // Also map by name (lowercase) as fallback for old/imported data without IDs
      map[p.produto.toLowerCase()] = p;
    });
    return map;
  }, [produtos]);

  const filteredHistorico = useMemo(() => {
    let start: Date | null = null;
    let end: Date | null = null;

    if (filters.useCustomRange) {
      start = parseISO(filters.startDate);
      end = parseISO(filters.endDate);
    } else if (filters.year === 'all') {
      // No start/end filtering
    } else if (filters.month === 'all') {
      start = startOfYear(new Date(filters.year, 0, 1));
      end = endOfMonth(new Date(filters.year, 11, 31));
    } else {
      start = startOfMonth(new Date(filters.year, filters.month - 1, 1));
      end = endOfMonth(new Date(filters.year, filters.month - 1, 1));
    }

    return allSalesData.filter(h => {
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      if (!prod) return false;

      // Selective cutoff filter
      if (shouldExcludeSale(h.cliente, h.faturamento)) return false;

      const matchesClient = filters.clientIds.length === 0 || filters.clientIds.includes(h.cliente_id);
      const matchesFamily = filters.families.length === 0 || filters.families.includes(prod.familia);
      const matchesProduct = filters.productIds.length === 0 || (h.produto_id && filters.productIds.includes(h.produto_id));
      
      let matchesDate = true;
      if (start || end) {
        const d = parseISO(h.faturamento);
        if (start && d < start) matchesDate = false;
        if (end && d > end) matchesDate = false;
      }

      return matchesClient && matchesFamily && matchesProduct && matchesDate;
    });
  }, [allSalesData, filters, produtosMap]);

  const filteredPrevHistorico = useMemo(() => {
    let start: Date | null = null;
    let end: Date | null = null;

    if (filters.useCustomRange) {
      start = parseISO(filters.startDate);
      end = parseISO(filters.endDate);
    } else if (filters.year === 'all') {
      return [];
    } else if (filters.month === 'all') {
      start = startOfYear(new Date(filters.year, 0, 1));
      end = endOfMonth(new Date(filters.year, 11, 31));
    } else {
      start = startOfMonth(new Date(filters.year, filters.month - 1, 1));
      end = endOfMonth(new Date(filters.year, filters.month - 1, 1));
    }

    const prevStart = start ? subYears(start, 1) : null;
    const prevEnd = end ? subYears(end, 1) : null;

    if (!prevStart || !prevEnd) return [];

    return allSalesData.filter(h => {
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      if (!prod) return false;

      // Selective cutoff filter
      if (shouldExcludeSale(h.cliente, h.faturamento)) return false;

      const matchesClient = filters.clientIds.length === 0 || filters.clientIds.includes(h.cliente_id);
      const matchesFamily = filters.families.length === 0 || filters.families.includes(prod.familia);
      const matchesProduct = filters.productIds.length === 0 || (h.produto_id && filters.productIds.includes(h.produto_id));
      
      const d = parseISO(h.faturamento);
      const matchesDate = d >= prevStart && d <= prevEnd;

      return matchesClient && matchesFamily && matchesProduct && matchesDate;
    });
  }, [allSalesData, filters, produtosMap]);

  // Full history filtered only by client/family/product (for Monthly Comparison)
  const fullFilteredHistory = useMemo(() => {
    return allSalesData.filter(h => {
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      if (!prod) return false;

      // Selective cutoff filter
      if (shouldExcludeSale(h.cliente, h.faturamento)) return false;

      const matchesClient = filters.clientIds.length === 0 || filters.clientIds.includes(h.cliente_id);
      const matchesFamily = filters.families.length === 0 || filters.families.includes(prod.familia);
      const matchesProduct = filters.productIds.length === 0 || (h.produto_id && filters.productIds.includes(h.produto_id));

      return matchesClient && matchesFamily && matchesProduct;
    });
  }, [allSalesData, filters.clientIds, filters.families, filters.productIds, produtosMap]);

  // --- KPI Calculations ---
  const kpis = useMemo(() => {
    const calculateStats = (data: HistVenda[]) => {
      let revenue = 0;
      let weight = 0;
      let commission = 0;
      const clients = new Set<string>();
      const orders = new Set<string>();

      data.forEach(h => {
        const classification = classifySaleRecord(h);
        if (!classification.entraFaturamento) return;

        const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
        const val = h["r$_total"] || 0;
        const q = h.qtd || 0;
        
        revenue += val;
        weight += q * (prod?.peso_embalagem || 0);
        commission += val * ((prod?.comissao || 0) / 100);
        clients.add(h.cliente_id);
        orders.add(`${h.faturamento}-${h.cliente_id}`);
      });

      return { revenue, weight, commission, clientsCount: clients.size, ordersCount: orders.size };
    };

    const current = calculateStats(filteredHistorico);
    const prev = calculateStats(filteredPrevHistorico);

    const ticketMedio = current.clientsCount > 0 ? current.revenue / current.clientsCount : 0;
    const prevTicketMedio = prev.clientsCount > 0 ? prev.revenue / prev.clientsCount : 0;

    const metaTotal = clientes
      .filter(c => filters.clientIds.length === 0 || filters.clientIds.includes(c.id))
      .reduce((acc, c) => acc + (metas[c.id] || 0), 0);

    const data: KpiData[] = [
      { label: 'Faturamento', value: current.revenue, previousValue: prev.revenue, format: formatCurrency, icon: DollarSign, color: 'blue' },
      { label: 'Peso Total', value: current.weight, previousValue: prev.weight, format: formatWeight, icon: Package, color: 'orange' },
      { label: 'Ticket Médio', value: ticketMedio, previousValue: prevTicketMedio, format: formatCurrency, icon: Users, color: 'purple' },
      { label: 'Positivação', value: current.clientsCount, previousValue: prev.clientsCount, format: (v) => `${v} Clientes`, icon: Check, color: 'indigo' },
      { label: 'Pedidos', value: current.ordersCount, previousValue: prev.ordersCount, format: (v) => `${v} Pedidos`, icon: ShoppingCart, color: 'cyan' },
    ];

    return data;
  }, [filteredHistorico, filteredPrevHistorico, produtosMap]);

  // --- Chart Data ---
  const monthlyRevenueData = useMemo(() => {
    const months = Array.from({ length: 12 }).map((_, i) => i);
    const years = [2024, 2025, 2026];

    return months.map(monthIndex => {
      const monthName = format(new Date(2024, monthIndex, 1), 'MMM', { locale: ptBR });
      const entry: any = { name: monthName };
      
      years.forEach(year => {
        const yearMonthData = fullFilteredHistory.filter(h => {
          const d = parseISO(h.faturamento);
          return d.getFullYear() === year && d.getMonth() === monthIndex && classifySaleRecord(h).entraFaturamento;
        });
        
        const value = yearMonthData.reduce((acc, h) => acc + (h["r$_total"] || 0), 0);
        const weight = yearMonthData.reduce((acc, h) => {
          const prod = produtosMap[h.produto_id];
          return acc + (h.qtd * (prod?.peso_embalagem || 0));
        }, 0);
        
        entry[`faturamento_${year}`] = value;
        entry[`peso_${year}`] = weight;
      });

      return entry;
    });
  }, [filteredHistorico, produtosMap]);

  const revenueByClientData = useMemo(() => {
    const map: Record<string, { value: number, weight: number }> = {};
    filteredHistorico.forEach(h => {
      if (!classifySaleRecord(h).entraFaturamento) return;
      if (!map[h.cliente]) map[h.cliente] = { value: 0, weight: 0 };
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      map[h.cliente].value += h["r$_total"];
      map[h.cliente].weight += (h.qtd || 0) * (prod?.peso_embalagem || 0);
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, value: data.value, weight: data.weight }))
      .sort((a, b) => evolutionMetric === 'value' ? b.value - a.value : b.weight - a.weight)
      .slice(0, 10);
  }, [filteredHistorico, evolutionMetric, produtosMap]);

  const revenueByFamilyData = useMemo(() => {
    const map: Record<string, { value: number, weight: number }> = {};
    filteredHistorico.forEach(h => {
      if (!classifySaleRecord(h).entraFaturamento) return;
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      const family = prod?.familia || 'Outros';
      if (!map[family]) map[family] = { value: 0, weight: 0 };
      map[family].value += h["r$_total"];
      map[family].weight += (h.qtd || 0) * (prod?.peso_embalagem || 0);
    });
    
    const sorted = Object.entries(map)
      .map(([name, data]) => ({ name, value: data.value, weight: data.weight }))
      .sort((a, b) => a.name.localeCompare(b.name));
      
    if (sorted.length <= 9) return sorted;
    
    const top9 = sorted.slice(0, 9);
    const othersValue = sorted.slice(9).reduce((acc, curr) => acc + curr.value, 0);
    const othersWeight = sorted.slice(9).reduce((acc, curr) => acc + curr.weight, 0);
    
    return [...top9, { name: 'Outros', value: othersValue, weight: othersWeight }];
  }, [filteredHistorico, produtosMap, evolutionMetric]);

  const topProductsData = useMemo(() => {
    const map: Record<string, { revenue: number, weight: number }> = {};
    filteredHistorico.forEach(h => {
      if (!classifySaleRecord(h).entraFaturamento) return;
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      const name = prod?.produto || h.produtos || 'Desconhecido';
      if (!map[name]) map[name] = { revenue: 0, weight: 0 };
      map[name].revenue += h["r$_total"] || 0;
      map[name].weight += (h.qtd || 0) * (prod?.peso_embalagem || 0);
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => evolutionMetric === 'value' ? b.revenue - a.revenue : b.weight - a.weight)
      .slice(0, 10);
  }, [filteredHistorico, produtosMap, evolutionMetric]);

  const periodLabel = useMemo(() => {
    if (filters.useCustomRange) {
      return `${format(parseISO(filters.startDate), 'dd/MM/yy')} - ${format(parseISO(filters.endDate), 'dd/MM/yy')}`;
    }
    if (filters.year === 'all') return 'Todo o Período';
    if (filters.month === 'all') return `Ano ${filters.year}`;
    return `${format(new Date(filters.year as number, (filters.month as number) - 1, 1), 'MMMM/yyyy', { locale: ptBR })}`;
  }, [filters]);

  return (
    <div className="h-[calc(100vh-100px)] flex flex-col gap-3 overflow-hidden pb-4">
      {/* Header & Filters Toggle */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-2 shrink-0">
        <div>
          <h2 className="text-xl font-black text-neutral-900 tracking-tight">Análise Comercial</h2>
          <p className="text-[10px] text-neutral-500 font-medium">Performance e metas</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button 
            onClick={() => {
              setShowFilters(!showFilters);
              if (showFilters) setIsFilterAnimationFinished(false);
            }}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-xs",
              showFilters ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50"
            )}
          >
            <Filter size={16} />
            <span>Filtros</span>
            <ChevronDown size={14} className={cn("transition-transform", showFilters && "rotate-180")} />
          </button>

          {/* Chart Selection Dropdown */}
          <select 
            value={visibleCharts[0]}
            onChange={(e) => setVisibleCharts([e.target.value])}
            className="bg-white border border-neutral-200 rounded-xl px-3 py-2 font-bold text-xs outline-none focus:ring-2 focus:ring-orange-500 shadow-sm"
          >
            {chartOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>

          {/* Metric Toggle */}
          <div className="flex bg-neutral-100 p-1 rounded-xl border border-neutral-200">
            <button 
              onClick={() => setEvolutionMetric('weight')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1.5",
                evolutionMetric === 'weight' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <Package size={12} />
              Peso
            </button>
            <button 
              onClick={() => setEvolutionMetric('value')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-bold rounded-lg transition-all flex items-center gap-1.5",
                evolutionMetric === 'value' ? "bg-white text-blue-600 shadow-sm" : "text-neutral-500 hover:text-neutral-700"
              )}
            >
              <DollarSign size={12} />
              Valor
            </button>
          </div>
        </div>
      </header>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            onAnimationComplete={() => setIsFilterAnimationFinished(true)}
            className={cn(
              "relative z-[150]",
              isFilterAnimationFinished ? "overflow-visible" : "overflow-hidden"
            )}
          >
            <div className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-xl space-y-6">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="flex flex-wrap gap-6 items-end flex-1">
                  {/* Date Selection */}
                  <div className="space-y-2 min-w-[240px]">
                    <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Período</label>
                    <div className="flex gap-2">
                      <select 
                        value={filters.year}
                        onChange={(e) => setFilters(prev => ({ ...prev, year: e.target.value === 'all' ? 'all' : parseInt(e.target.value), useCustomRange: false }))}
                        className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="all">Todos os Anos</option>
                        {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                      <select 
                        value={filters.month}
                        onChange={(e) => setFilters(prev => ({ ...prev, month: e.target.value === 'all' ? 'all' : parseInt(e.target.value), useCustomRange: false }))}
                        className="flex-[2] bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      >
                        <option value="all">Ano Inteiro</option>
                        {Array.from({ length: 12 }).map((_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {format(new Date(2024, i, 1), 'MMMM', { locale: ptBR })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {filters.useCustomRange && (
                    <div className="flex flex-wrap gap-4 flex-1">
                      <div className="space-y-2 min-w-[140px] flex-1">
                        <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Início</label>
                        <input 
                          type="date" 
                          value={filters.startDate}
                          onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                          className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                      <div className="space-y-2 min-w-[140px] flex-1">
                        <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Fim</label>
                        <input 
                          type="date" 
                          value={filters.endDate}
                          onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                          className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Custom Range Toggle */}
                <div className="space-y-2 min-w-[220px]">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest lg:text-right block">Personalizado</label>
                  <div className="flex items-center justify-between h-[42px] bg-neutral-50 px-4 rounded-xl border border-neutral-200">
                    <span className="text-sm font-bold text-neutral-600">Usar datas específicas</span>
                    <button 
                      onClick={() => setFilters(prev => ({ ...prev, useCustomRange: !prev.useCustomRange }))}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        filters.useCustomRange ? "bg-orange-500" : "bg-neutral-200"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        filters.useCustomRange ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-neutral-100">
                {/* Client Multi-select */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Clientes ({filters.clientIds.length})</label>
                  <div className="relative">
                    <button 
                      onClick={() => setShowClientDropdown(!showClientDropdown)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <span className="truncate">
                        {filters.clientIds.length === 0 ? "Selecionar Clientes" : `${filters.clientIds.length} selecionados`}
                      </span>
                      <ChevronDown size={16} className={cn("transition-transform", showClientDropdown && "rotate-180")} />
                    </button>
                    
                    <AnimatePresence>
                      {showClientDropdown && (
                        <>
                          <div className="fixed inset-0 z-[60]" onClick={() => setShowClientDropdown(false)} />
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] max-h-64 flex flex-col overflow-hidden"
                          >
                            <div className="p-2 border-b border-neutral-100">
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={14} />
                                <input 
                                  type="text"
                                  placeholder="Buscar..."
                                  value={clientSearch}
                                  onChange={(e) => setClientSearch(e.target.value)}
                                  className="w-full pl-9 pr-4 py-1.5 bg-neutral-50 border border-neutral-100 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-orange-500"
                                />
                              </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-1">
                              {(() => {
                                const searchWords = clientSearch.toLowerCase().split(/\s+/).filter(Boolean);
                                return clientes
                                  .filter(c => {
                                    if (searchWords.length === 0) return true;
                                    const targetString = (c.cliente || '').toLowerCase();
                                    return searchWords.every(word => targetString.includes(word));
                                  })
                                  .map(c => (
                                    <button
                                      key={c.id}
                                      onClick={() => {
                                        setFilters(prev => ({
                                          ...prev,
                                          clientIds: prev.clientIds.includes(c.id) 
                                            ? prev.clientIds.filter(id => id !== c.id)
                                            : [...prev.clientIds, c.id]
                                        }));
                                      }}
                                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-50 flex items-center gap-3 text-sm font-medium"
                                    >
                                      <div className={cn(
                                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                        filters.clientIds.includes(c.id) ? "bg-orange-500 border-orange-500" : "border-neutral-300"
                                      )}>
                                        {filters.clientIds.includes(c.id) && <Check size={10} className="text-white" strokeWidth={4} />}
                                      </div>
                                      <span className="truncate">{c.cliente}</span>
                                    </button>
                                  ));
                              })()}
                            </div>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Family Filter */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Família ({filters.families.length})</label>
                  <div className="relative">
                    <button 
                      onClick={() => setShowFamilyDropdown(!showFamilyDropdown)}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-orange-500"
                    >
                      <span className="truncate">
                        {filters.families.length === 0 ? "Selecionar Famílias" : `${filters.families.length} selecionadas`}
                      </span>
                      <ChevronDown size={16} className={cn("transition-transform", showFamilyDropdown && "rotate-180")} />
                    </button>
                    
                    <AnimatePresence>
                      {showFamilyDropdown && (
                        <>
                          <div className="fixed inset-0 z-[60]" onClick={() => setShowFamilyDropdown(false)} />
                          <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 10 }}
                            className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-[70] max-h-64 overflow-y-auto p-1"
                          >
                            {(Array.from(new Set(produtos.map(p => p.familia).filter(Boolean))) as string[])
                              .filter(f => f.toLowerCase() !== 'amostras e brindes')
                              .sort((a, b) => a.localeCompare(b))
                              .map(f => (
                                <button
                                  key={f}
                                onClick={() => {
                                  setFilters(prev => ({
                                    ...prev,
                                    families: prev.families.includes(f) 
                                      ? prev.families.filter(id => id !== f)
                                      : [...prev.families, f]
                                  }));
                                }}
                                className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-50 flex items-center gap-3 text-sm font-medium"
                              >
                                <div className={cn(
                                  "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                  filters.families.includes(f) ? "bg-orange-500 border-orange-500" : "border-neutral-300"
                                )}>
                                  {filters.families.includes(f) && <Check size={10} className="text-white" strokeWidth={4} />}
                                </div>
                                <span className="truncate">{f}</span>
                              </button>
                            ))}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Reset Button */}
                <div className="flex items-end">
                  <button 
                    onClick={() => {
                      setFilters({
                        clientIds: [],
                        families: [],
                        productIds: [],
                        year: 'all',
                        month: 'all',
                        startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
                        endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
                        useCustomRange: false
                      });
                      setClientSearch('');
                    }}
                    className="w-full py-3 border border-neutral-200 rounded-xl font-bold text-neutral-500 hover:bg-neutral-50 transition-all"
                  >
                    Limpar Filtros
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 shrink-0">
        {kpis.map((kpi, i) => (
          <KpiCard 
            key={i} 
            kpi={kpi} 
          />
        ))}
      </div>

      {/* Main Charts Grid */}
      <div className="flex-1 min-h-0">
        <div className={cn(
          "grid gap-4 h-full",
          visibleCharts.length === 1 ? "grid-cols-1 grid-rows-1" : 
          visibleCharts.length === 2 ? "grid-cols-1 lg:grid-cols-2 grid-rows-1" :
          "grid-cols-1 lg:grid-cols-2 grid-rows-2"
        )}>
          {/* Monthly Revenue & Commission */}
          {visibleCharts.includes('monthly') && (
            <ChartCard 
              title={`Comparativo Mensal: ${evolutionMetric === 'value' ? 'Faturamento (R$)' : 'Peso (Kg)'}`} 
              className={cn(visibleCharts.length === 1 || visibleCharts.length === 3 ? "lg:col-span-2" : "")}
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRevenueData} barCategoryGap="35%" barGap={3} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#a3a3a3' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 700, fill: '#a3a3a3' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '10px' }}
                    formatter={(value: any) => evolutionMetric === 'value' ? formatCurrency(value) : formatWeight(value)}
                  />
                  <Legend verticalAlign="top" align="center" iconType="circle" wrapperStyle={{ paddingBottom: '10px', fontSize: '9px', fontWeight: 700 }} />
                  <Bar 
                    dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2024`} 
                    name="2024" 
                    fill="#3b82f6" 
                    radius={[2, 2, 0, 0]} 
                    barSize={12}
                  />
                  <Bar 
                    dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2025`} 
                    name="2025" 
                    fill="#f97316" 
                    radius={[2, 2, 0, 0]} 
                    barSize={12}
                  />
                  <Bar 
                    dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2026`} 
                    name="2026" 
                    fill="#10b981" 
                    radius={[2, 2, 0, 0]} 
                    barSize={12}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Revenue by Client */}
          {visibleCharts.includes('clients') && (
            <ChartCard title={`Top 10 Clientes (${periodLabel})`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueByClientData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={80} tick={{ fontSize: 8, fontWeight: 700, fill: '#737373' }} />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)', fontSize: '10px' }}
                    formatter={(value: any) => evolutionMetric === 'value' ? formatCurrency(value) : formatWeight(value)}
                  />
                  <Bar dataKey={evolutionMetric} fill="#3b82f6" radius={[0, 2, 2, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}

          {/* Revenue by Family */}
          {visibleCharts.includes('family') && (
            <ChartCard title={`${evolutionMetric === 'value' ? 'Faturamento' : 'Peso'} por Família`}>
              <div className="flex h-full items-center gap-4">
                <div className="flex-1 h-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={revenueByFamilyData}
                        cx="50%"
                        cy="50%"
                        innerRadius="45%"
                        outerRadius="85%"
                        paddingAngle={5}
                        dataKey={evolutionMetric}
                      >
                        {revenueByFamilyData.map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)', fontSize: '10px' }}
                        formatter={(value: any) => evolutionMetric === 'value' ? formatCurrency(value) : formatWeight(value)}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="w-[240px] max-h-full overflow-y-auto shrink-0 pr-2">
                  <table className="w-full text-[11px] font-bold text-neutral-600 border-collapse">
                    <thead>
                      <tr className="border-b border-neutral-100">
                        <th className="text-left py-1 font-black text-neutral-400 uppercase tracking-tighter pr-4">Família</th>
                        <th className="text-right py-1 font-black text-neutral-400 uppercase tracking-tighter">
                          {evolutionMetric === 'value' ? 'Valor' : 'Peso'}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...revenueByFamilyData]
                        .sort((a, b) => (b[evolutionMetric] || 0) - (a[evolutionMetric] || 0))
                        .map((entry, index) => (
                          <tr key={`item-${index}`} className="border-b border-neutral-50 last:border-0 hover:bg-neutral-50 transition-colors">
                            <td className="py-1.5 flex items-center gap-2 pr-4">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: COLORS[revenueByFamilyData.indexOf(entry) % COLORS.length] }} />
                              <span className="truncate max-w-[120px]">{entry.name}</span>
                            </td>
                            <td className="py-1.5 text-right text-neutral-900 whitespace-nowrap">
                              {evolutionMetric === 'value' 
                                ? formatCurrency(entry.value) 
                                : formatWeight(entry.weight)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </ChartCard>
          )}

          {/* Top Products */}
          {visibleCharts.includes('products') && (
            <ChartCard title={`Top 10 Produtos (${evolutionMetric === 'value' ? 'R$' : 'kg'})`} className={cn(visibleCharts.length === 1 || (visibleCharts.length === 3 && !visibleCharts.includes('monthly')) ? "lg:col-span-2" : "")}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductsData} layout="vertical" margin={{ top: 0, right: 30, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={100} tick={{ fontSize: 8, fontWeight: 700, fill: '#737373' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)', fontSize: '10px' }}
                    formatter={(value: any) => evolutionMetric === 'value' ? formatCurrency(value) : formatWeight(value)}
                  />
                  <Bar dataKey={evolutionMetric === 'value' ? 'revenue' : 'weight'} fill="#f97316" radius={[0, 2, 2, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          )}
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-[200] bg-white/40 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-white p-8 rounded-3xl shadow-2xl flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin" />
            <p className="text-sm font-bold text-neutral-600">Atualizando dados...</p>
          </div>
        </div>
      )}
    </div>
  );
}
