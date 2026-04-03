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
import { cn, formatCurrency, formatWeight } from '../lib/utils';
import { 
  startOfMonth, 
  endOfMonth, 
  subMonths, 
  format, 
  parseISO, 
  isWithinInterval, 
  subDays, 
  differenceInDays,
  startOfYear,
  eachMonthOfInterval,
  isSameMonth,
  isSameYear
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';

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
const KpiCard: React.FC<{ kpi: KpiData }> = ({ kpi }) => {
  const variation = kpi.previousValue > 0 ? ((kpi.value - kpi.previousValue) / kpi.previousValue) * 100 : 0;
  const isPositive = variation >= 0;

  return (
    <div className="bg-white p-3 rounded-2xl border border-neutral-200 shadow-sm hover:shadow-md transition-all">
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
        <div className={cn("flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full", 
          isPositive ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
        )}>
          {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {Math.abs(variation).toFixed(1)}%
        </div>
      </div>
      <p className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-0.5">{kpi.label}</p>
      <h3 className="text-lg font-black text-neutral-900 truncate">{kpi.format(kpi.value)}</h3>
    </div>
  );
};

const ChartCard: React.FC<{ title: string, children: React.ReactNode, className?: string }> = ({ title, children, className }) => (
  <div className={cn("bg-white p-6 rounded-2xl border border-neutral-200 shadow-sm", className)}>
    <h3 className="text-sm font-bold text-neutral-800 mb-6 uppercase tracking-tight flex items-center gap-2">
      <div className="w-1.5 h-4 bg-orange-500 rounded-full" />
      {title}
    </h3>
    <div className="h-[300px] w-full">
      {children}
    </div>
  </div>
);

export function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [prevHistorico, setPrevHistorico] = useState<HistVenda[]>([]);

  // --- Filter State ---
  const [filters, setFilters] = useState<DashboardFilters>({
    clientIds: [],
    families: [],
    productIds: [],
    year: 'all',
    month: 'all',
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
    useCustomRange: false
  });

  const [showFilters, setShowFilters] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [evolutionMetric, setEvolutionMetric] = useState<'value' | 'weight'>('value');

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
        if (pData) setProdutos(pData);
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

  // --- Load Sales Data based on filters ---
  useEffect(() => {
    async function loadSalesData() {
      setLoading(true);
      try {
        let start: Date | null = null;
        let end: Date | null = null;

        if (filters.useCustomRange) {
          start = parseISO(filters.startDate);
          end = parseISO(filters.endDate);
        } else if (filters.year === 'all') {
          // No start/end filtering for year = 'all'
        } else if (filters.month === 'all') {
          start = startOfYear(new Date(filters.year, 0, 1));
          end = endOfMonth(new Date(filters.year, 11, 31));
        } else {
          start = startOfMonth(new Date(filters.year, filters.month - 1, 1));
          end = endOfMonth(new Date(filters.year, filters.month - 1, 1));
        }

        const duration = (start && end) ? differenceInDays(end, start) + 1 : 30;
        const prevStart = start ? subDays(start, duration) : null;
        const prevEnd = end ? subDays(end, duration) : null;

        // Fetch current period
        let query = supabase.from('hist_vendas').select('*');
        if (start) query = query.gte('faturamento', start.toISOString());
        if (end) query = query.lte('faturamento', end.toISOString());
        const { data: currentData } = await query;

        // Deduplicate data to prevent tripled values from accidental multiple imports
        const deduplicate = (data: HistVenda[] | null) => {
          if (!data) return [];
          const uniqueMap = new Map();
          data.forEach(h => {
            // Create a unique key based on core fields
            const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, h);
            }
          });
          return Array.from(uniqueMap.values()) as HistVenda[];
        };

        setHistorico(deduplicate(currentData));

        // Fetch previous period
        let prevData: HistVenda[] = [];
        if (prevStart && prevEnd) {
          const { data: previousData } = await supabase
            .from('hist_vendas')
            .select('*')
            .gte('faturamento', prevStart.toISOString())
            .lte('faturamento', prevEnd.toISOString());
          prevData = deduplicate(previousData);
        }
        setPrevHistorico(prevData);
      } catch (err) {
        console.error('Error loading sales data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSalesData();
  }, [filters.year, filters.month, filters.startDate, filters.endDate, filters.useCustomRange]);

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

  const applyFilters = (data: HistVenda[]) => {
    return data.filter(h => {
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      if (!prod) return false;

      const matchesClient = filters.clientIds.length === 0 || filters.clientIds.includes(h.cliente_id);
      const matchesFamily = filters.families.length === 0 || filters.families.includes(prod.familia);
      const matchesProduct = filters.productIds.length === 0 || (h.produto_id && filters.productIds.includes(h.produto_id));

      return matchesClient && matchesFamily && matchesProduct;
    });
  };

  const filteredHistorico = useMemo(() => applyFilters(historico), [historico, filters, produtosMap]);
  const filteredPrevHistorico = useMemo(() => applyFilters(prevHistorico), [prevHistorico, filters, produtosMap]);

  // --- KPI Calculations ---
  const kpis = useMemo(() => {
    const calculateStats = (data: HistVenda[]) => {
      let revenue = 0;
      let weight = 0;
      let commission = 0;
      const clients = new Set<string>();
      const orders = new Set<string>();

      data.forEach(h => {
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
      { label: 'Comissão', value: current.commission, previousValue: prev.commission, format: formatCurrency, icon: TrendingUp, color: 'green' },
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
        const yearMonthData = filteredHistorico.filter(h => {
          const d = parseISO(h.faturamento);
          return d.getFullYear() === year && d.getMonth() === monthIndex;
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
    const map: Record<string, number> = {};
    filteredHistorico.forEach(h => {
      map[h.cliente] = (map[h.cliente] || 0) + h["r$_total"];
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [filteredHistorico]);

  const revenueByFamilyData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredHistorico.forEach(h => {
      const prod = produtosMap[h.produto_id];
      const family = prod?.familia || 'Outros';
      map[family] = (map[family] || 0) + h["r$_total"];
    });
    
    const sorted = Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
      
    if (sorted.length <= 9) return sorted;
    
    const top9 = sorted.slice(0, 9);
    const othersValue = sorted.slice(9).reduce((acc, curr) => acc + curr.value, 0);
    
    return [...top9, { name: 'Outros', value: othersValue }];
  }, [filteredHistorico, produtosMap]);

  const topProductsData = useMemo(() => {
    const map: Record<string, { revenue: number, weight: number }> = {};
    filteredHistorico.forEach(h => {
      const prod = produtosMap[h.produto_id];
      const name = prod?.produto || 'Desconhecido';
      if (!map[name]) map[name] = { revenue: 0, weight: 0 };
      map[name].revenue += h["r$_total"];
      map[name].weight += h.qtd * (prod?.peso_embalagem || 0);
    });
    return Object.entries(map)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [filteredHistorico, produtosMap]);

  const periodLabel = useMemo(() => {
    if (filters.useCustomRange) {
      return `${format(parseISO(filters.startDate), 'dd/MM/yy')} - ${format(parseISO(filters.endDate), 'dd/MM/yy')}`;
    }
    if (filters.year === 'all') return 'Todo o Período';
    if (filters.month === 'all') return `Ano ${filters.year}`;
    return `${format(new Date(filters.year as number, (filters.month as number) - 1, 1), 'MMMM/yyyy', { locale: ptBR })}`;
  }, [filters]);

  return (
    <div className="space-y-8 pb-12">
      {/* Header & Filters Toggle */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-neutral-900 tracking-tight">Análise Comercial</h2>
          <p className="text-sm text-neutral-500 font-medium">Acompanhamento de performance e metas</p>
        </div>
        <button 
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            "flex items-center gap-2 px-5 py-3 rounded-2xl font-bold transition-all shadow-sm",
            showFilters ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50"
          )}
        >
          <Filter size={18} />
          <span>Filtros</span>
          <ChevronDown size={16} className={cn("transition-transform", showFilters && "rotate-180")} />
        </button>
      </header>

      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-white p-6 rounded-3xl border border-neutral-200 shadow-xl space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Date Selection */}
                <div className="space-y-2">
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

                {/* Custom Range Toggle */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Personalizado</label>
                  <div className="flex items-center gap-3 h-[42px]">
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
                    <span className="text-sm font-bold text-neutral-600">Usar datas específicas</span>
                  </div>
                </div>

                {filters.useCustomRange && (
                  <>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Início</label>
                      <input 
                        type="date" 
                        value={filters.startDate}
                        onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Fim</label>
                      <input 
                        type="date" 
                        value={filters.endDate}
                        onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500"
                      />
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-neutral-100">
                {/* Client Multi-select */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Clientes ({filters.clientIds.length})</label>
                  <div className="relative group">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
                    <input 
                      type="text"
                      placeholder="Buscar clientes..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-orange-500"
                    />
                    {clientSearch && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-50 max-h-60 overflow-y-auto p-2">
                        {clientes
                          .filter(c => c.cliente.toLowerCase().includes(clientSearch.toLowerCase()))
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
                              className="w-full text-left px-3 py-2 rounded-lg hover:bg-neutral-50 flex items-center justify-between text-sm font-medium"
                            >
                              <span>{c.cliente}</span>
                              {filters.clientIds.includes(c.id) && <Check size={14} className="text-orange-500" />}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  {filters.clientIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {filters.clientIds.slice(0, 3).map(id => (
                        <span key={id} className="bg-orange-50 text-orange-600 text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1">
                          {clientes.find(c => c.id === id)?.cliente.split(' ')[0]}
                          <X size={10} className="cursor-pointer" onClick={() => setFilters(prev => ({ ...prev, clientIds: prev.clientIds.filter(i => i !== id) }))} />
                        </span>
                      ))}
                      {filters.clientIds.length > 3 && <span className="text-[10px] font-bold text-neutral-400">+{filters.clientIds.length - 3}</span>}
                    </div>
                  )}
                </div>

                {/* Family Filter */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-neutral-400 uppercase tracking-widest">Família</label>
                  <select 
                    multiple
                    value={filters.families}
                    onChange={(e) => {
                      const values = Array.from(e.target.selectedOptions, (option) => (option as HTMLOptionElement).value);
                      setFilters(prev => ({ ...prev, families: values }));
                    }}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2 font-bold text-sm outline-none focus:ring-2 focus:ring-orange-500 h-[42px]"
                  >
                    {Array.from(new Set(produtos.map(p => p.familia))).map(f => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi, i) => (
          <KpiCard key={i} kpi={kpi} />
        ))}
      </div>

      {/* Main Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Monthly Revenue & Commission */}
        <ChartCard 
          title={`Comparativo Mensal: ${evolutionMetric === 'value' ? 'Faturamento (R$)' : 'Peso (Kg)'}`} 
          className="lg:col-span-2"
        >
          <div className="absolute top-6 right-6 flex bg-neutral-100 p-1 rounded-lg z-10">
            <button 
              onClick={() => setEvolutionMetric('value')}
              className={cn("px-3 py-1 text-[10px] font-bold rounded-md transition-all", evolutionMetric === 'value' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}
            >
              Valor
            </button>
            <button 
              onClick={() => setEvolutionMetric('weight')}
              className={cn("px-3 py-1 text-[10px] font-bold rounded-md transition-all", evolutionMetric === 'weight' ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500")}
            >
              Peso
            </button>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyRevenueData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }} />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
                formatter={(value: any) => evolutionMetric === 'value' ? formatCurrency(value) : formatWeight(value)}
              />
              <Legend verticalAlign="top" align="center" iconType="circle" wrapperStyle={{ paddingBottom: '20px', fontSize: '10px', fontWeight: 700 }} />
              <Bar 
                dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2024`} 
                name="2024" 
                fill="#3b82f6" 
                radius={[4, 4, 0, 0]} 
                barSize={20}
              />
              <Bar 
                dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2025`} 
                name="2025" 
                fill="#f97316" 
                radius={[4, 4, 0, 0]} 
                barSize={20}
              />
              <Bar 
                dataKey={`${evolutionMetric === 'value' ? 'faturamento' : 'peso'}_2026`} 
                name="2026" 
                fill="#10b981" 
                radius={[4, 4, 0, 0]} 
                barSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Revenue by Client */}
        <ChartCard title={`Top 10 Clientes (${periodLabel})`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueByClientData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={120} tick={{ fontSize: 9, fontWeight: 700, fill: '#737373' }} />
              <Tooltip 
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }}
                formatter={(value: any) => formatCurrency(value)}
              />
              <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Revenue by Family */}
        <ChartCard title="Faturamento por Família">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={revenueByFamilyData}
                cx="40%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={5}
                dataKey="value"
              >
                {revenueByFamilyData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }}
                formatter={(value: any) => formatCurrency(value)}
              />
              <Legend 
                layout="vertical" 
                align="right" 
                verticalAlign="middle" 
                iconType="circle" 
                wrapperStyle={{ fontSize: '10px', fontWeight: 700, paddingLeft: '20px' }} 
                formatter={(value: string) => {
                  const item = revenueByFamilyData.find(d => d.name === value);
                  return `${value}: ${formatCurrency(item?.value || 0)}`;
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Products */}
        <ChartCard title="Top 10 Produtos (Volume kg)" className="lg:col-span-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topProductsData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
              <XAxis type="number" hide />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={150} tick={{ fontSize: 9, fontWeight: 700, fill: '#737373' }} />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }}
                formatter={(value: any) => formatWeight(value)}
              />
              <Bar dataKey="weight" fill="#f97316" radius={[0, 4, 4, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
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
