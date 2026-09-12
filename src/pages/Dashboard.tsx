import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  TrendingUp, 
  Package, 
  Users, 
  Search, 
  X, 
  ChevronRight, 
  ArrowUpRight, 
  ArrowDownRight, 
  Minus,
  Calendar,
  Layers,
  RotateCcw,
  DollarSign,
  PieChart,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Clock,
  Percent,
  Activity,
  ArrowRight,
  Filter,
  Eye,
  MessageCircle,
  ExternalLink,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  Legend,
  ComposedChart
} from 'recharts';
import { supabase } from '../lib/supabase';
import { Cliente, Produto, HistVenda } from '../types';
import { cn, formatWeight, formatCurrency, deduplicateSales, parseSaleDate } from '../lib/utils';
import { PageHeader } from '../components/ui/AppChrome';
import { useDataManager } from '../lib/dataManager';
import { classifySaleRecord } from '../lib/salesClassifier';
import { shouldExcludeSale } from '../constants';
import { calcularCicloPonderado } from '../lib/calculations';
import { 
  subMonths, 
  startOfMonth, 
  endOfMonth, 
  parseISO, 
  format, 
  isWithinInterval, 
  differenceInDays,
  differenceInMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  TrendMode, 
  TrendCategory, 
  TREND_CATEGORIES, 
  PeriodDataPoint, 
  computePortfolioAndClientsEvolution 
} from '../lib/salesTrendAnalysis';
import { fetchOpenOrderSales } from '../lib/openOrderSales';

export type DashboardTab = 'evolucao' | 'visao_geral' | 'curva_abc' | 'mix_produtos' | 'positivacao';
type AbcMetric = 'volume' | 'faturamento' | 'ponderado';

function abcValue(item: { totalKg: number; totalVal: number }, totals: { totalKg: number; totalVal: number }, metric: AbcMetric): number {
  if (metric === 'volume') return item.totalKg;
  if (metric === 'faturamento') return item.totalVal;

  // Each component is a share of its own total; kg and reais are never added directly.
  // If one total is unavailable, use the available component at full weight.
  const hasKg = totals.totalKg > 0;
  const hasVal = totals.totalVal > 0;
  if (hasKg && hasVal) return 0.5 * item.totalKg / totals.totalKg + 0.5 * item.totalVal / totals.totalVal;
  if (hasKg) return item.totalKg / totals.totalKg;
  if (hasVal) return item.totalVal / totals.totalVal;
  return 0;
}

export function Dashboard() {
  const navigate = useNavigate();
  const {
    clientes: cachedClientes,
    produtos: cachedProdutos,
    hist_vendas: cachedHistorico,
    loadingGlobal
  } = useDataManager();

  const [activeTab, setActiveTab] = useState<DashboardTab>('evolucao');
  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [allSalesData, setAllSalesData] = useState<HistVenda[]>([]);
  const [openOrderSales, setOpenOrderSales] = useState<HistVenda[]>([]);

  // --- Date range for General / ABC / Mix / Positivation ---
  const [selectedMonthOffset, setSelectedMonthOffset] = useState<number>(0); // 0 = current month, -1 = last month, etc.
  const [generalPeriodMode, setGeneralPeriodMode] = useState<'current_month' | 'last_3_months' | 'last_12_months' | 'all'>('current_month');

  // --- State for Sales Trend Evolution (Tab 1) ---
  const [trendMode, setTrendMode] = useState<TrendMode>('quarterly');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [situationFilter, setSituationFilter] = useState<TrendCategory | 'all' | 'alert'>('all');
  const [clientSearchQuery, setClientSearchQuery] = useState('');
  const [startPeriodKey, setStartPeriodKey] = useState<string>('');
  const [endPeriodKey, setEndPeriodKey] = useState<string>('');
  const [trendSortField, setTrendSortField] = useState<'clienteNome' | 'currentKg' | 'trend' | 'variacao' | 'period'>('currentKg');
  const [trendSortDirection, setTrendSortDirection] = useState<'asc' | 'desc'>('desc');

  // --- State for ABC Curve (Tab 3) ---
  const [abcType, setAbcType] = useState<'clientes' | 'produtos'>('clientes');
  const [abcMetric, setAbcMetric] = useState<AbcMetric>('volume');
  const [abcClassFilter, setAbcClassFilter] = useState<'all' | 'A' | 'B' | 'C'>('all');
  const [abcSearchQuery, setAbcSearchQuery] = useState('');

  // --- State for Positivation (Tab 5) ---
  const [positivacaoStatusFilter, setPositivacaoStatusFilter] = useState<'all' | 'positivado' | 'pendente'>('all');
  const [positivacaoSearchQuery, setPositivacaoSearchQuery] = useState('');

  // --- State for Monthly Comparison Chart (Tab 2) ---
  const [monthlyMetricMode, setMonthlyMetricMode] = useState<'volume' | 'faturamento'>('volume');
  const [selectedComparativeYears, setSelectedComparativeYears] = useState<number[]>([]);
  const [selectedComparativeMonths, setSelectedComparativeMonths] = useState<number[]>([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

  // --- Load Initial Base Data ---
  useEffect(() => {
    async function loadBaseData() {
      try {
        if (cachedClientes.length > 0) setClientes(cachedClientes);
        if (cachedProdutos.length > 0) {
          setProdutos(cachedProdutos.filter(p => p.familia?.toLowerCase() !== 'amostras e brindes'));
        }

        if (navigator.onLine === false) return;

        const [
          { data: cData },
          { data: pData }
        ] = await Promise.all([
          supabase.from('clientes').select('*').order('cliente'),
          supabase.from('produtos').select('*').order('produto')
        ]);

        if (cData) setClientes(cData);
        if (pData) setProdutos(pData.filter(p => p.familia?.toLowerCase() !== 'amostras e brindes'));
      } catch (err) {
        console.error('Error loading base data:', err);
      }
    }
    loadBaseData();
  }, [cachedClientes, cachedProdutos]);

  // --- Load Full Historical Sales Data ---
  useEffect(() => {
    async function loadSalesData() {
      setLoading(true);
      try {
        if (cachedHistorico.length > 0) {
          setAllSalesData(deduplicateSales(cachedHistorico));
          setLoading(false);
          return;
        }

        if (navigator.onLine === false) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from('hist_vendas')
          .select('*');

        if (!error && data) {
          setAllSalesData(deduplicateSales(data));
        }
      } catch (err) {
        console.error('Error loading full sales history:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSalesData();
  }, [cachedHistorico]);

  // --- Load Open Orders as Sales with Realtime Sync ---
  useEffect(() => {
    let active = true;

    async function loadOpenOrders() {
      if (clientes.length === 0 || produtos.length === 0) return;
      try {
        const sales = await fetchOpenOrderSales(clientes, produtos);
        if (active) {
          setOpenOrderSales(sales);
        }
      } catch (err) {
        console.error('Error fetching open orders for dashboard:', err);
      }
    }

    void loadOpenOrders();

    if (navigator.onLine === false) return;

    const channel = supabase
      .channel('dashboard-pedidos-em-aberto')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_em_aberto' }, () => {
        void loadOpenOrders();
      })
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [clientes, produtos]);

  // Combined sales dataset: historical imported sales + open orders treated as sales
  const allSalesWithOpenOrders = useMemo(() => {
    if (openOrderSales.length === 0) return allSalesData;
    return [...allSalesData, ...openOrderSales];
  }, [allSalesData, openOrderSales]);

  // STRICT FILTER: Only ACTIVE clients are analyzed
  const activeClientes = useMemo(() => {
    return clientes.filter(c => c.ativo !== false);
  }, [clientes]);

  const activeClientIds = useMemo(() => {
    return new Set(activeClientes.map(c => c.id));
  }, [activeClientes]);

  // Strict filter: sales must belong to active clients only & qualify as commercial sales
  const validActiveSales = useMemo(() => {
    return allSalesWithOpenOrders.filter(h => {
      if (!h.cliente_id || !activeClientIds.has(h.cliente_id)) return false;
      const classification = classifySaleRecord(h);
      return classification.entraFaturamento;
    });
  }, [allSalesWithOpenOrders, activeClientIds]);

  // Map of products for fast O(1) lookup
  const produtosMap = useMemo(() => {
    const map: Record<string, Produto> = {};
    produtos.forEach(p => {
      map[p.id] = p;
      if (p.produto) {
        map[p.produto.toLowerCase()] = p;
      }
    });
    return map;
  }, [produtos]);

  // --- TAB 1: EVOLUÇÃO DE VENDAS COMPUTATION ---
  const {
    portfolioSeries,
    portfolioTrend,
    clientsEvolution,
    periodOptions,
    trendCounts,
    recentAlertCount
  } = useMemo(() => {
    return computePortfolioAndClientsEvolution(
      allSalesWithOpenOrders,
      activeClientes,
      produtosMap,
      trendMode,
      {
        startKey: startPeriodKey || undefined,
        endKey: endPeriodKey || undefined
      }
    );
  }, [allSalesWithOpenOrders, activeClientes, produtosMap, trendMode, startPeriodKey, endPeriodKey]);

  useEffect(() => {
    if (periodOptions.length > 0) {
      if (!startPeriodKey || !periodOptions.some(p => p.periodKey === startPeriodKey)) {
        setStartPeriodKey(periodOptions[0].periodKey);
      }
      if (!endPeriodKey || !periodOptions.some(p => p.periodKey === endPeriodKey)) {
        setEndPeriodKey(periodOptions[periodOptions.length - 1].periodKey);
      }
    }
  }, [periodOptions, trendMode]);

  const selectedClientEvolution = useMemo(() => {
    if (!selectedClientId) return null;
    return clientsEvolution.find(c => c.clienteId === selectedClientId) || null;
  }, [selectedClientId, clientsEvolution]);

  const activeSeries = useMemo(() => {
    if (selectedClientEvolution) return selectedClientEvolution.series;
    return portfolioSeries;
  }, [selectedClientEvolution, portfolioSeries]);

  const activeTrend = useMemo(() => {
    if (selectedClientEvolution) return selectedClientEvolution.trend;
    return portfolioTrend;
  }, [selectedClientEvolution, portfolioTrend]);

  const filteredTrendClients = useMemo(() => {
    const searchTerms = clientSearchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    const filtered = clientsEvolution.filter(item => {
      if (situationFilter === 'alert') {
        if (!item.recentAlert) return false;
      } else if (situationFilter !== 'all' && item.trend.category !== situationFilter) {
        return false;
      }

      if (searchTerms.length > 0) {
        const targetStr = `${item.clienteNome} ${item.cidade}`.toLowerCase();
        const matchesAll = searchTerms.every(term => targetStr.includes(term));
        if (!matchesAll) return false;
      }
      return true;
    });

    const categoryPriority: Record<TrendCategory, number> = {
      strong_growth: 5,
      growth: 4,
      stable: 3,
      decline: 2,
      strong_decline: 1,
      insufficient_data: 0
    };

    return [...filtered].sort((a, b) => {
      let comparison = 0;
      switch (trendSortField) {
        case 'clienteNome':
          comparison = a.clienteNome.localeCompare(b.clienteNome, 'pt-BR');
          break;
        case 'currentKg':
          comparison = a.currentKg - b.currentKg;
          break;
        case 'trend': {
          const aPriority = categoryPriority[a.trend.category] ?? -1;
          const bPriority = categoryPriority[b.trend.category] ?? -1;
          comparison = aPriority - bPriority;
          break;
        }
        case 'variacao':
          comparison = a.trend.totalTrendChangePct - b.trend.totalTrendChangePct;
          break;
        case 'period':
          comparison = a.latestPeriodLabel.localeCompare(b.latestPeriodLabel);
          break;
        default:
          comparison = 0;
      }

      return trendSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [clientsEvolution, situationFilter, clientSearchQuery, trendSortField, trendSortDirection]);

  const currentPeriodVolume = useMemo(() => {
    if (activeSeries.length === 0) return 0;
    const latest = activeSeries[activeSeries.length - 1];
    return latest ? latest.chartKg : 0;
  }, [activeSeries]);

  const latestPeriodLabel = useMemo(() => {
    if (activeSeries.length === 0) return '-';
    const latest = activeSeries[activeSeries.length - 1];
    return latest ? latest.label : '-';
  }, [activeSeries]);

  // --- TAB 2: VISÃO GERAL & FATURAMENTO COMPUTATIONS ---
  const currentMonthDate = useMemo(() => {
    const now = new Date();
    return subMonths(now, -selectedMonthOffset); // when offset is 0, now; when -1, subMonths 1
  }, [selectedMonthOffset]);

  const currentMonthInterval = useMemo(() => {
    return {
      start: startOfMonth(currentMonthDate),
      end: endOfMonth(currentMonthDate)
    };
  }, [currentMonthDate]);

  const previousMonthInterval = useMemo(() => {
    const prev = subMonths(currentMonthDate, 1);
    return {
      start: startOfMonth(prev),
      end: endOfMonth(prev)
    };
  }, [currentMonthDate]);

  // Monthly stats for current selected month
  const monthlyMetrics = useMemo(() => {
    let currentFaturamento = 0;
    let currentKg = 0;
    const currentOrders = new Set<string>();
    const currentPositivados = new Set<string>();

    let prevFaturamento = 0;
    let prevKg = 0;
    const prevOrders = new Set<string>();
    const prevPositivados = new Set<string>();

    validActiveSales.forEach(h => {
      if (!h.faturamento) return;
      const d = parseISO(h.faturamento);
      if (isNaN(d.getTime())) return;

      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      const weightUnit = prod?.peso_embalagem || 0;
      const kg = (h.qtd || 0) * weightUnit;
      const val = Number(h.r$_total) || 0;
      const orderId = h.pedido_id || h.numero_pedido_erp || `${h.cliente}_${h.faturamento}`;

      if (isWithinInterval(d, currentMonthInterval)) {
        currentFaturamento += val;
        currentKg += kg;
        currentOrders.add(orderId);
        if (h.cliente_id) currentPositivados.add(h.cliente_id);
      } else if (isWithinInterval(d, previousMonthInterval)) {
        prevFaturamento += val;
        prevKg += kg;
        prevOrders.add(orderId);
        if (h.cliente_id) prevPositivados.add(h.cliente_id);
      }
    });

    const currentTicketMedio = currentOrders.size > 0 ? currentFaturamento / currentOrders.size : 0;
    const currentPrecoMedioKg = currentKg > 0 ? currentFaturamento / currentKg : 0;
    const positivacaoRate = activeClientes.length > 0 ? (currentPositivados.size / activeClientes.length) * 100 : 0;

    const faturamentoGrowth = prevFaturamento > 0 ? ((currentFaturamento - prevFaturamento) / prevFaturamento) * 100 : 0;
    const kgGrowth = prevKg > 0 ? ((currentKg - prevKg) / prevKg) * 100 : 0;

    return {
      currentFaturamento,
      currentKg,
      currentOrdersCount: currentOrders.size,
      currentPositivadosCount: currentPositivados.size,
      currentTicketMedio,
      currentPrecoMedioKg,
      positivacaoRate,
      prevFaturamento,
      prevKg,
      faturamentoGrowth,
      kgGrowth,
      currentPositivadosSet: currentPositivados
    };
  }, [validActiveSales, currentMonthInterval, previousMonthInterval, produtosMap, activeClientes.length]);

  // Available years from sales data
  const availableYears = useMemo(() => {
    const yearsSet = new Set<number>();
    validActiveSales.forEach(h => {
      if (!h.faturamento) return;
      const d = parseSaleDate(h.faturamento);
      if (d && !isNaN(d.getTime())) {
        yearsSet.add(d.getFullYear());
      }
    });
    const sorted = Array.from(yearsSet).sort((a, b) => a - b);
    return sorted.length > 0 ? sorted : [new Date().getFullYear()];
  }, [validActiveSales]);

  // Sync selected years if empty
  useEffect(() => {
    if (availableYears.length > 0 && selectedComparativeYears.length === 0) {
      setSelectedComparativeYears(availableYears);
    }
  }, [availableYears, selectedComparativeYears.length]);

  // Colors for each year
  const YEAR_COLORS: Record<number, string> = {
    2023: '#8b5cf6',
    2024: '#3b82f6',
    2025: '#10b981',
    2026: '#ea580c',
    2027: '#f59e0b',
    2028: '#ec4899'
  };

  const MONTH_NAMES = [
    { num: 1, label: 'Jan' },
    { num: 2, label: 'Fev' },
    { num: 3, label: 'Mar' },
    { num: 4, label: 'Abr' },
    { num: 5, label: 'Mai' },
    { num: 6, label: 'Jun' },
    { num: 7, label: 'Jul' },
    { num: 8, label: 'Ago' },
    { num: 9, label: 'Set' },
    { num: 10, label: 'Out' },
    { num: 11, label: 'Nov' },
    { num: 12, label: 'Dez' }
  ];

  // Comparative Monthly Chart Data (Jan - Dec, grouped by Year)
  const comparativeMonthlyData = useMemo(() => {
    // 12 months structure
    const dataByMonth = MONTH_NAMES.map(m => {
      const row: Record<string, any> = {
        mesNum: m.num,
        mesLabel: m.label
      };
      availableYears.forEach(yr => {
        row[String(yr)] = 0;
      });
      return row;
    });

    validActiveSales.forEach(h => {
      if (!h.faturamento) return;
      const d = parseSaleDate(h.faturamento);
      if (!d || isNaN(d.getTime())) return;

      const yr = d.getFullYear();
      const monthNum = d.getMonth() + 1; // 1-12

      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      const weightUnit = prod?.peso_embalagem || 0;
      const kg = (h.qtd || 0) * weightUnit;
      const val = Number(h.r$_total) || 0;

      const targetMonth = dataByMonth.find(m => m.mesNum === monthNum);
      if (targetMonth && targetMonth[String(yr)] !== undefined) {
        if (monthlyMetricMode === 'volume') {
          targetMonth[String(yr)] += kg;
        } else {
          targetMonth[String(yr)] += val;
        }
      }
    });

    // Filter by selected months
    return dataByMonth.filter(m => selectedComparativeMonths.includes(m.mesNum));
  }, [validActiveSales, produtosMap, availableYears, monthlyMetricMode, selectedComparativeMonths]);

  // --- TAB 3: CURVA ABC COMPUTATIONS ---
  const abcData = useMemo(() => {
    // Filter sales based on periodMode
    let filteredSales = validActiveSales;
    if (generalPeriodMode === 'current_month') {
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && isWithinInterval(d, currentMonthInterval);
      });
    } else if (generalPeriodMode === 'last_3_months') {
      const threeMonthsAgo = subMonths(new Date(), 3);
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && d >= threeMonthsAgo;
      });
    } else if (generalPeriodMode === 'last_12_months') {
      const twelveMonthsAgo = subMonths(new Date(), 12);
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && d >= twelveMonthsAgo;
      });
    }

    if (abcType === 'clientes') {
      // Group by active client
      const clientMap: Record<string, { id: string; name: string; cidade: string; totalVal: number; totalKg: number }> = {};
      activeClientes.forEach(c => {
        clientMap[c.id] = { id: c.id, name: c.cliente, cidade: c.cidade || '-', totalVal: 0, totalKg: 0 };
      });

      filteredSales.forEach(h => {
        if (!h.cliente_id || !clientMap[h.cliente_id]) return;
        const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
        const weightUnit = prod?.peso_embalagem || 0;
        const kg = (h.qtd || 0) * weightUnit;
        const val = Number(h.r$_total) || 0;

        clientMap[h.cliente_id].totalVal += val;
        clientMap[h.cliente_id].totalKg += kg;
      });

      const list = Object.values(clientMap);
      const totals = list.reduce((acc, c) => ({ totalKg: acc.totalKg + c.totalKg, totalVal: acc.totalVal + c.totalVal }), { totalKg: 0, totalVal: 0 });
      const totalSum = abcMetric === 'ponderado' ? Number(totals.totalKg > 0 || totals.totalVal > 0) : abcMetric === 'faturamento' ? totals.totalVal : totals.totalKg;

      // Sort descending
      list.sort((a, b) => {
        const valA = abcValue(a, totals, abcMetric);
        const valB = abcValue(b, totals, abcMetric);
        return valB - valA;
      });

      let accumulated = 0;
      const enrichedList = list.map(item => {
        const value = abcValue(item, totals, abcMetric);
        const sharePct = totalSum > 0 ? (value / totalSum) * 100 : 0;
        accumulated += sharePct;
        const accumulatedPct = Math.min(100, accumulated);

        let classe: 'A' | 'B' | 'C' = 'C';
        if (accumulatedPct <= 80 || (accumulated - sharePct < 80)) {
          classe = 'A';
        } else if (accumulatedPct <= 95 || (accumulated - sharePct < 95)) {
          classe = 'B';
        }

        return {
          id: item.id,
          name: item.name,
          subText: item.cidade,
          totalVal: item.totalVal,
          totalKg: item.totalKg,
          value,
          sharePct,
          accumulatedPct,
          classe
        };
      });

      return {
        items: enrichedList,
        totalSum,
        countA: enrichedList.filter(i => i.classe === 'A').length,
        countB: enrichedList.filter(i => i.classe === 'B').length,
        countC: enrichedList.filter(i => i.classe === 'C').length
      };
    } else {
      // Group by Product
      const productMap: Record<string, { id: string; name: string; familia: string; totalVal: number; totalKg: number }> = {};
      produtos.forEach(p => {
        productMap[p.id] = { id: p.id, name: p.produto, familia: p.familia || '-', totalVal: 0, totalKg: 0 };
      });

      filteredSales.forEach(h => {
        const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
        if (!prod || !productMap[prod.id]) return;
        const weightUnit = prod?.peso_embalagem || 0;
        const kg = (h.qtd || 0) * weightUnit;
        const val = Number(h.r$_total) || 0;

        productMap[prod.id].totalVal += val;
        productMap[prod.id].totalKg += kg;
      });

      const list = Object.values(productMap).filter(p => p.totalVal > 0 || p.totalKg > 0);
      const totals = list.reduce((acc, p) => ({ totalKg: acc.totalKg + p.totalKg, totalVal: acc.totalVal + p.totalVal }), { totalKg: 0, totalVal: 0 });
      const totalSum = abcMetric === 'ponderado' ? Number(totals.totalKg > 0 || totals.totalVal > 0) : abcMetric === 'faturamento' ? totals.totalVal : totals.totalKg;

      list.sort((a, b) => {
        const valA = abcValue(a, totals, abcMetric);
        const valB = abcValue(b, totals, abcMetric);
        return valB - valA;
      });

      let accumulated = 0;
      const enrichedList = list.map(item => {
        const value = abcValue(item, totals, abcMetric);
        const sharePct = totalSum > 0 ? (value / totalSum) * 100 : 0;
        accumulated += sharePct;
        const accumulatedPct = Math.min(100, accumulated);

        let classe: 'A' | 'B' | 'C' = 'C';
        if (accumulatedPct <= 80 || (accumulated - sharePct < 80)) {
          classe = 'A';
        } else if (accumulatedPct <= 95 || (accumulated - sharePct < 95)) {
          classe = 'B';
        }

        return {
          id: item.id,
          name: item.name,
          subText: item.familia,
          totalVal: item.totalVal,
          totalKg: item.totalKg,
          value,
          sharePct,
          accumulatedPct,
          classe
        };
      });

      return {
        items: enrichedList,
        totalSum,
        countA: enrichedList.filter(i => i.classe === 'A').length,
        countB: enrichedList.filter(i => i.classe === 'B').length,
        countC: enrichedList.filter(i => i.classe === 'C').length
      };
    }
  }, [validActiveSales, activeClientes, produtos, produtosMap, abcType, abcMetric, generalPeriodMode, currentMonthInterval]);

  const filteredAbcItems = useMemo(() => {
    const searchTerms = abcSearchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    return abcData.items.filter(item => {
      if (abcClassFilter !== 'all' && item.classe !== abcClassFilter) return false;
      if (searchTerms.length > 0) {
        const targetStr = `${item.name} ${item.subText}`.toLowerCase();
        const matchesAll = searchTerms.every(term => targetStr.includes(term));
        if (!matchesAll) return false;
      }
      return true;
    });
  }, [abcData.items, abcClassFilter, abcSearchQuery]);

  // --- TAB 4: MIX DE PRODUTOS & FAMÍLIAS COMPUTATION ---
  const productMixData = useMemo(() => {
    let filteredSales = validActiveSales;
    if (generalPeriodMode === 'current_month') {
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && isWithinInterval(d, currentMonthInterval);
      });
    } else if (generalPeriodMode === 'last_3_months') {
      const threeMonthsAgo = subMonths(new Date(), 3);
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && d >= threeMonthsAgo;
      });
    } else if (generalPeriodMode === 'last_12_months') {
      const twelveMonthsAgo = subMonths(new Date(), 12);
      filteredSales = validActiveSales.filter(h => {
        if (!h.faturamento) return false;
        const d = parseISO(h.faturamento);
        return !isNaN(d.getTime()) && d >= twelveMonthsAgo;
      });
    }

    const familyMap: Record<string, { name: string; totalKg: number; totalVal: number; itemsCount: number }> = {};

    filteredSales.forEach(h => {
      const prod = produtosMap[h.produto_id] || (h.produtos ? produtosMap[h.produtos.toLowerCase()] : null);
      const familyName = prod?.familia?.trim() || 'Outros';
      if (familyName.toLowerCase() === 'amostras e brindes') return;

      if (!familyMap[familyName]) {
        familyMap[familyName] = { name: familyName, totalKg: 0, totalVal: 0, itemsCount: 0 };
      }

      const weightUnit = prod?.peso_embalagem || 0;
      const kg = (h.qtd || 0) * weightUnit;
      const val = Number(h.r$_total) || 0;

      familyMap[familyName].totalKg += kg;
      familyMap[familyName].totalVal += val;
      familyMap[familyName].itemsCount += (h.qtd || 0);
    });

    const list = Object.values(familyMap);
    const totalVolume = list.reduce((acc, f) => acc + f.totalKg, 0);
    const totalFaturamento = list.reduce((acc, f) => acc + f.totalVal, 0);

    list.sort((a, b) => b.totalKg - a.totalKg);

    const enriched = list.map(f => {
      const shareKg = totalVolume > 0 ? (f.totalKg / totalVolume) * 100 : 0;
      const shareVal = totalFaturamento > 0 ? (f.totalVal / totalFaturamento) * 100 : 0;
      const precoMedioKg = f.totalKg > 0 ? f.totalVal / f.totalKg : 0;
      return {
        ...f,
        shareKg,
        shareVal,
        precoMedioKg
      };
    });

    return {
      families: enriched,
      totalVolume,
      totalFaturamento
    };
  }, [validActiveSales, produtosMap, generalPeriodMode, currentMonthInterval]);

  // --- TAB 5: POSITIVAÇÃO & RECORRÊNCIA COMPUTATION ---
  const positivacaoData = useMemo(() => {
    // Sales dates per active client for repurchase cycle calculation
    const salesDatesByClient: Record<string, string[]> = {};
    validActiveSales.forEach(h => {
      if (!h.cliente_id || !h.faturamento) return;
      if (!salesDatesByClient[h.cliente_id]) {
        salesDatesByClient[h.cliente_id] = [];
      }
      salesDatesByClient[h.cliente_id].push(h.faturamento);
    });

    // Month positivados set
    const positivadosSet = monthlyMetrics.currentPositivadosSet;

    const list = activeClientes.map(cliente => {
      const isPositivado = positivadosSet.has(cliente.id);
      const clientSalesDates = salesDatesByClient[cliente.id] || [];
      const cicloPonderado = calcularCicloPonderado(clientSalesDates);

      let latestPurchaseDateStr = cliente.ultima_compra;
      if (clientSalesDates.length > 0) {
        const sortedDates = [...clientSalesDates].sort().reverse();
        if (!latestPurchaseDateStr || sortedDates[0] > latestPurchaseDateStr) {
          latestPurchaseDateStr = sortedDates[0];
        }
      }

      let daysSinceLastPurchase = 999;
      if (latestPurchaseDateStr) {
        const d = parseISO(latestPurchaseDateStr);
        if (!isNaN(d.getTime())) {
          daysSinceLastPurchase = Math.max(0, differenceInDays(new Date(), d));
        }
      }

      return {
        clienteId: cliente.id,
        clienteNome: cliente.cliente,
        cidade: cliente.cidade || '-',
        telefone: cliente.telefone,
        isPositivado,
        ultimaCompra: latestPurchaseDateStr,
        daysSinceLastPurchase,
        cicloPonderado
      };
    });

    // Sort: non-positivados first by days since purchase descending
    list.sort((a, b) => {
      if (a.isPositivado !== b.isPositivado) {
        return a.isPositivado ? 1 : -1;
      }
      return b.daysSinceLastPurchase - a.daysSinceLastPurchase;
    });

    return list;
  }, [activeClientes, validActiveSales, monthlyMetrics.currentPositivadosSet]);

  const filteredPositivacaoList = useMemo(() => {
    const searchTerms = positivacaoSearchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    return positivacaoData.filter(item => {
      if (positivacaoStatusFilter === 'positivado' && !item.isPositivado) return false;
      if (positivacaoStatusFilter === 'pendente' && item.isPositivado) return false;

      if (searchTerms.length > 0) {
        const targetStr = `${item.clienteNome} ${item.cidade}`.toLowerCase();
        const matchesAll = searchTerms.every(term => targetStr.includes(term));
        if (!matchesAll) return false;
      }

      return true;
    });
  }, [positivacaoData, positivacaoStatusFilter, positivacaoSearchQuery]);

  const sendWhatsAppMessage = (item: { clienteNome: string; telefone?: string }) => {
    if (!item.telefone) {
      alert('Cliente sem telefone cadastrado.');
      return;
    }
    const cleanPhone = String(item.telefone).replace(/\D/g, '');
    const message = `Olá! Tudo bem? Passando para conversarmos sobre reposição de estoque e pedidos.`;
    window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const tabsConfig = [
    { id: 'evolucao' as const, label: 'Evolução de Vendas', icon: TrendingUp, badge: 'Novo' },
    { id: 'visao_geral' as const, label: 'Visão Geral & Faturamento', icon: DollarSign },
    { id: 'curva_abc' as const, label: 'Curva ABC (Pareto)', icon: BarChart3 },
    { id: 'mix_produtos' as const, label: 'Mix de Produtos', icon: Package },
    { id: 'positivacao' as const, label: 'Positivação da Carteira', icon: Users },
  ];

  const situationList: TrendCategory[] = [
    'strong_growth',
    'growth',
    'stable',
    'decline',
    'strong_decline'
  ];

  const COLORS_FAMILIES = ['#ea580c', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4', '#64748b'];

  return (
    <div className="flex flex-col gap-4 pb-12 w-full max-w-full">
      {/* Header */}
      <PageHeader
        title="Análise Comercial"
        subtitle={`Inteligência de vendas e performance da carteira (${activeClientes.length} clientes ativos)`}
        icon={<TrendingUp className="text-orange-600" />}
        className="shrink-0"
        actions={
          activeTab === 'evolucao' ? (
            <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 shadow-sm">
              <button
                type="button"
                id="btn-trend-quarterly"
                onClick={() => setTrendMode('quarterly')}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-black transition-all",
                  trendMode === 'quarterly'
                    ? "bg-white text-orange-600 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900"
                )}
              >
                <Calendar size={14} />
                Trimestral
              </button>
              <button
                type="button"
                id="btn-trend-annual"
                onClick={() => setTrendMode('annual')}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-black transition-all",
                  trendMode === 'annual'
                    ? "bg-white text-orange-600 shadow-sm"
                    : "text-neutral-600 hover:text-neutral-900"
                )}
              >
                <Layers size={14} />
                Anual
              </button>
            </div>
          ) : activeTab === 'visao_geral' ? (
            <div className="flex items-center gap-2">
              <select
                id="select-month-offset"
                value={selectedMonthOffset}
                onChange={(e) => setSelectedMonthOffset(Number(e.target.value))}
                className="py-1.5 px-3 bg-white border border-neutral-200 rounded-lg text-xs font-bold text-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value={0}>Mês Atual ({format(new Date(), 'MMMM/yyyy', { locale: ptBR })})</option>
                <option value={-1}>Mês Anterior ({format(subMonths(new Date(), 1), 'MMMM/yyyy', { locale: ptBR })})</option>
                <option value={-2}>2 Meses Atrás ({format(subMonths(new Date(), 2), 'MMMM/yyyy', { locale: ptBR })})</option>
                <option value={-3}>3 Meses Atrás ({format(subMonths(new Date(), 3), 'MMMM/yyyy', { locale: ptBR })})</option>
              </select>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-neutral-500">Período:</span>
              <select
                id="select-general-period-mode"
                value={generalPeriodMode}
                onChange={(e) => setGeneralPeriodMode(e.target.value as any)}
                className="py-1.5 px-3 bg-white border border-neutral-200 rounded-lg text-xs font-bold text-neutral-800 shadow-sm outline-none focus:ring-2 focus:ring-orange-500"
              >
                <option value="current_month">Mês Atual</option>
                <option value="last_3_months">Últimos 3 Meses</option>
                <option value="last_12_months">Últimos 12 Meses</option>
                <option value="all">Todo o Histórico</option>
              </select>
            </div>
          )
        }
      />

      {/* Main Navigation Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-neutral-200 scrollbar-none">
        {tabsConfig.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              id={`tab-btn-${tab.id}`}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-black whitespace-nowrap transition-all border",
                isActive
                  ? "bg-orange-600 text-white border-orange-600 shadow-sm"
                  : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50 hover:text-neutral-900"
              )}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
              {tab.badge && (
                <span className={cn(
                  "px-1.5 py-0.2 rounded text-[10px] uppercase tracking-wider font-extrabold",
                  isActive ? "bg-white/20 text-white" : "bg-orange-100 text-orange-700"
                )}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ================= TAB 1: EVOLUÇÃO DE VENDAS ================= */}
      {activeTab === 'evolucao' && (
        <div className="flex flex-col gap-4">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Card 1: Volume Atual */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  {selectedClientEvolution ? 'Volume do Cliente' : 'Volume da Carteira Ativa'}
                </span>
                <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
                  <Package size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-neutral-900">
                  {formatWeight(currentPeriodVolume)}
                </div>
                <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                  {trendMode === 'quarterly' 
                    ? `Total vendido em ${latestPeriodLabel}` 
                    : `Média mensal no ano ${latestPeriodLabel}`}
                </p>
              </div>
            </div>

            {/* Card 2: Tendência Geral */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Tendência da Série
                </span>
                <span className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-black flex items-center gap-1",
                  activeTrend.categoryInfo.badgeClass
                )}>
                  <span>{activeTrend.categoryInfo.emoji}</span>
                  <span>{activeTrend.categoryInfo.label}</span>
                </span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-neutral-900">
                  {activeTrend.totalTrendChangePct > 0 ? '+' : ''}
                  {activeTrend.totalTrendChangePct.toFixed(1)}%
                </span>
                <span className="text-xs font-semibold text-neutral-500">
                  ao longo do histórico
                </span>
              </div>
              <p className="text-[11px] font-medium text-neutral-400 mt-1">
                {activeTrend.dataPointsCount} períodos analisados ({activeSeries[0]?.label || '-'} → {activeSeries[activeSeries.length - 1]?.label || '-'})
              </p>
            </div>

            {/* Card 3: Distribuição da Carteira Ativa */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Situação dos Clientes Ativos
                </span>
                <span className="text-xs font-bold text-neutral-500">
                  {activeClientes.length} ativos
                </span>
              </div>
              
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-1">
                {situationList.map(catKey => {
                  const catInfo = TREND_CATEGORIES[catKey];
                  const count = trendCounts[catKey] || 0;
                  const isSelected = situationFilter === catKey;

                  return (
                    <button
                      key={catKey}
                      type="button"
                      onClick={() => setSituationFilter(current => current === catKey ? 'all' : catKey)}
                      className={cn(
                        "flex flex-col items-center justify-center p-1.5 rounded-lg border transition-all text-center",
                        isSelected 
                          ? "ring-2 ring-orange-500 font-black " + catInfo.bgClass
                          : "border-neutral-200 bg-neutral-50 hover:bg-white text-neutral-700"
                      )}
                      title={`Filtrar por ${catInfo.label}`}
                    >
                      <span className="text-sm">{catInfo.emoji}</span>
                      <span className="text-xs font-black mt-0.5">{count}</span>
                      <span className="text-[9px] font-bold text-neutral-400 truncate w-full">
                        {catInfo.shortLabel}
                      </span>
                    </button>
                  );
                })}

                {/* Button ⚠️ Alerta */}
                <button
                  type="button"
                  id="btn-filter-trend-alert"
                  onClick={() => setSituationFilter(current => current === 'alert' ? 'all' : 'alert')}
                  className={cn(
                    "flex flex-col items-center justify-center p-1.5 rounded-lg border transition-all text-center",
                    situationFilter === 'alert'
                      ? "ring-2 ring-amber-500 font-black bg-amber-100 text-amber-900 border-amber-300"
                      : "border-amber-200/80 bg-amber-50/60 hover:bg-amber-50 text-amber-800"
                  )}
                  title="Filtrar clientes com alerta de queda recente (micro-tendência)"
                >
                  <span className="text-sm">⚠️</span>
                  <span className="text-xs font-black mt-0.5 text-amber-900">{recentAlertCount}</span>
                  <span className="text-[9px] font-bold text-amber-700 truncate w-full">
                    Alerta
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Main Chart Card */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-neutral-100">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-4 bg-orange-500 rounded-full" />
                  <h2 className="text-base font-black text-neutral-900 tracking-tight">
                    {selectedClientEvolution 
                      ? `Evolução de Vendas — ${selectedClientEvolution.clienteNome}` 
                      : 'Evolução Consolidada da Carteira Ativa (kg)'}
                  </h2>
                </div>
                <p className="text-xs font-medium text-neutral-500 mt-0.5 ml-3.5">
                  {selectedClientEvolution
                    ? `Cidade: ${selectedClientEvolution.cidade} • ${trendMode === 'quarterly' ? 'Média mensal por trimestre' : 'Média mensal anual'} (kg/mês ponderada)`
                    : `${trendMode === 'quarterly' ? 'Média mensal dos clientes ativos por trimestre' : 'Ritmo médio mensal vendido por ano'} (kg/mês ponderada)`}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1.5 text-neutral-700 font-bold bg-neutral-100 px-2.5 py-1 rounded-md">
                    <span className="w-2.5 h-2.5 bg-orange-500 rounded-sm inline-block"></span> Média Real (kg/mês)
                  </span>
                  <span className="flex items-center gap-1.5 text-blue-700 font-bold bg-blue-50 px-2.5 py-1 rounded-md">
                    <span className="w-3 h-0.5 border-t-2 border-dashed border-blue-600 inline-block"></span> Linha de Tendência
                  </span>
                </div>

                {selectedClientEvolution && (
                  <button
                    type="button"
                    id="btn-clear-selected-client"
                    onClick={() => setSelectedClientId(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-xs font-bold text-neutral-700 transition-colors self-start sm:self-auto"
                  >
                    <X size={14} />
                    Voltar para Toda a Carteira
                  </button>
                )}
              </div>
            </div>

            {/* Chart Rendering */}
            <div className="h-72 sm:h-80 w-full">
              {activeSeries.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-neutral-400">
                  <Package size={32} className="mb-2 opacity-50" />
                  <p className="text-xs font-bold">Nenhum dado disponível para o período selecionado.</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={activeSeries} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                    <defs>
                      <linearGradient id="colorSalesKg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ea580c" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#ea580c" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                    <XAxis 
                      dataKey="label" 
                      axisLine={{ stroke: '#e5e5e5' }}
                      tickLine={false} 
                      tick={{ fontSize: 11, fontWeight: 700, fill: '#737373' }}
                      dy={6}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }}
                      tickFormatter={(val) => `${(val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`}
                      width={46}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        borderRadius: '12px', 
                        border: '1px solid #e5e5e5', 
                        boxShadow: '0 10px 25px rgba(0,0,0,0.08)', 
                        fontSize: '11px',
                        padding: '10px 14px'
                      }}
                      formatter={(value: any, name: string) => {
                        const formatted = `${formatWeight(Number(value))} / mês`;
                        if (name === 'trendKg') {
                          return [formatted, 'Linha de Tendência'];
                        }
                        return [
                          formatted, 
                          trendMode === 'quarterly' ? 'Média Mensal no Trimestre' : 'Média Mensal no Ano'
                        ];
                      }}
                      labelFormatter={(label) => `Período: ${label}`}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="chartKg" 
                      name="chartKg"
                      stroke="#ea580c" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorSalesKg)"
                      dot={{ r: 4, fill: '#ffffff', stroke: '#ea580c', strokeWidth: 2 }}
                      activeDot={{ r: 6, fill: '#ea580c', stroke: '#ffffff', strokeWidth: 2 }}
                    />
                    <Line 
                      type="linear" 
                      dataKey="trendKg" 
                      name="trendKg"
                      stroke="#2563eb" 
                      strokeWidth={2.5} 
                      strokeDasharray="6 6" 
                      dot={false}
                      activeDot={{ r: 5, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Clients Evolution Table Section */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-4 mb-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-neutral-900 uppercase tracking-tight flex items-center gap-2">
                    <div className="w-1.5 h-3.5 bg-orange-500 rounded-full" />
                    Clientes Ativos e Tendências
                  </h3>
                  <p className="text-xs font-medium text-neutral-500 mt-0.5">
                    Ordenado por maior volume vendido no período mais recente
                  </p>
                </div>

                <span className="text-xs font-bold text-neutral-500 self-start sm:self-auto">
                  Exibindo {filteredTrendClients.length} de {activeClientes.length} clientes ativos
                </span>
              </div>

              {/* Filters Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
                {/* Search Input */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={15} />
                  <input
                    type="text"
                    id="input-trend-search"
                    placeholder="Buscar cliente ativo ou cidade..."
                    value={clientSearchQuery}
                    onChange={(e) => setClientSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-800 placeholder-neutral-400 outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  {clientSearchQuery && (
                    <button 
                      type="button"
                      onClick={() => setClientSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Situation Filter */}
                <div>
                  <select
                    id="select-trend-situation"
                    value={situationFilter}
                    onChange={(e) => setSituationFilter(e.target.value as any)}
                    className="w-full py-2 px-3 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    <option value="all">Todas as Situações</option>
                    <option value="alert">⚠️ Alerta ({recentAlertCount})</option>
                    <option value="strong_growth">🚀 Crescimento forte</option>
                    <option value="growth">📈 Crescimento</option>
                    <option value="stable">➡️ Estável</option>
                    <option value="decline">📉 Queda</option>
                    <option value="strong_decline">🔴 Queda forte</option>
                    <option value="insufficient_data">⚪ Dados insuficientes</option>
                  </select>
                </div>

                {/* Start Period Filter */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400 shrink-0">De:</span>
                  <select
                    id="select-trend-start-period"
                    value={startPeriodKey}
                    onChange={(e) => setStartPeriodKey(e.target.value)}
                    className="w-full py-2 px-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {periodOptions.map(p => (
                      <option key={`start-${p.periodKey}`} value={p.periodKey}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* End Period Filter & Reset */}
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-neutral-400 shrink-0">Até:</span>
                  <select
                    id="select-trend-end-period"
                    value={endPeriodKey}
                    onChange={(e) => setEndPeriodKey(e.target.value)}
                    className="w-full py-2 px-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-700 outline-none focus:ring-2 focus:ring-orange-500"
                  >
                    {periodOptions.map(p => (
                      <option key={`end-${p.periodKey}`} value={p.periodKey}>
                        {p.label}
                      </option>
                    ))}
                  </select>

                  {(situationFilter !== 'all' || clientSearchQuery || (periodOptions.length > 0 && (startPeriodKey !== periodOptions[0].periodKey || endPeriodKey !== periodOptions[periodOptions.length - 1].periodKey))) && (
                    <button
                      type="button"
                      id="btn-trend-reset"
                      onClick={() => {
                        setSelectedClientId(null);
                        setSituationFilter('all');
                        setClientSearchQuery('');
                        if (periodOptions.length > 0) {
                          setStartPeriodKey(periodOptions[0].periodKey);
                          setEndPeriodKey(periodOptions[periodOptions.length - 1].periodKey);
                        }
                      }}
                      title="Limpar Filtros"
                      className="p-2 rounded-lg border border-neutral-200 bg-neutral-50 hover:bg-neutral-100 text-neutral-600 transition-colors shrink-0"
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Table Content */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80 select-none">
                    {/* Cliente Ativo */}
                    <th 
                      id="th-trend-cliente"
                      onClick={() => {
                        if (trendSortField === 'clienteNome') {
                          setTrendSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setTrendSortField('clienteNome');
                          setTrendSortDirection('asc');
                        }
                      }}
                      className="py-2.5 px-3 text-xs font-black text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100/80 transition-colors"
                      title="Clique para ordenar por Cliente"
                    >
                      <div className="inline-flex items-center gap-1.5">
                        <span>Cliente Ativo</span>
                        {trendSortField === 'clienteNome' ? (
                          trendSortDirection === 'asc' ? (
                            <ArrowUp size={13} className="text-orange-600 stroke-[2.5]" />
                          ) : (
                            <ArrowDown size={13} className="text-orange-600 stroke-[2.5]" />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="text-neutral-400 opacity-60" />
                        )}
                      </div>
                    </th>

                    {/* Venda Atual */}
                    <th 
                      id="th-trend-venda-atual"
                      onClick={() => {
                        if (trendSortField === 'currentKg') {
                          setTrendSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setTrendSortField('currentKg');
                          setTrendSortDirection('desc');
                        }
                      }}
                      className="py-2.5 px-3 text-right text-xs font-black text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100/80 transition-colors"
                      title="Clique para ordenar por Volume Atual"
                    >
                      <div className="inline-flex items-center justify-end gap-1.5 w-full">
                        <span>Venda Atual</span>
                        {trendSortField === 'currentKg' ? (
                          trendSortDirection === 'asc' ? (
                            <ArrowUp size={13} className="text-orange-600 stroke-[2.5]" />
                          ) : (
                            <ArrowDown size={13} className="text-orange-600 stroke-[2.5]" />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="text-neutral-400 opacity-60" />
                        )}
                      </div>
                    </th>

                    {/* Tendência */}
                    <th 
                      id="th-trend-situacao"
                      onClick={() => {
                        if (trendSortField === 'trend') {
                          setTrendSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setTrendSortField('trend');
                          setTrendSortDirection('desc');
                        }
                      }}
                      className="py-2.5 px-3 text-center text-xs font-black text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100/80 transition-colors"
                      title="Clique para ordenar por Classificação de Tendência"
                    >
                      <div className="inline-flex items-center justify-center gap-1.5 w-full">
                        <span>Tendência</span>
                        {trendSortField === 'trend' ? (
                          trendSortDirection === 'asc' ? (
                            <ArrowUp size={13} className="text-orange-600 stroke-[2.5]" />
                          ) : (
                            <ArrowDown size={13} className="text-orange-600 stroke-[2.5]" />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="text-neutral-400 opacity-60" />
                        )}
                      </div>
                    </th>

                    {/* Variação */}
                    <th 
                      id="th-trend-variacao"
                      onClick={() => {
                        if (trendSortField === 'variacao') {
                          setTrendSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setTrendSortField('variacao');
                          setTrendSortDirection('desc');
                        }
                      }}
                      className="py-2.5 px-3 text-right text-xs font-black text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100/80 transition-colors"
                      title="Clique para ordenar por Percentual de Variação"
                    >
                      <div className="inline-flex items-center justify-end gap-1.5 w-full">
                        <span>Variação</span>
                        {trendSortField === 'variacao' ? (
                          trendSortDirection === 'asc' ? (
                            <ArrowUp size={13} className="text-orange-600 stroke-[2.5]" />
                          ) : (
                            <ArrowDown size={13} className="text-orange-600 stroke-[2.5]" />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="text-neutral-400 opacity-60" />
                        )}
                      </div>
                    </th>

                    {/* Período */}
                    <th 
                      id="th-trend-periodo"
                      onClick={() => {
                        if (trendSortField === 'period') {
                          setTrendSortDirection(d => d === 'asc' ? 'desc' : 'asc');
                        } else {
                          setTrendSortField('period');
                          setTrendSortDirection('desc');
                        }
                      }}
                      className="py-2.5 px-3 text-center text-xs font-black text-neutral-600 uppercase tracking-wider cursor-pointer hover:bg-neutral-100/80 transition-colors"
                      title="Clique para ordenar por Período"
                    >
                      <div className="inline-flex items-center justify-center gap-1.5 w-full">
                        <span>Período</span>
                        {trendSortField === 'period' ? (
                          trendSortDirection === 'asc' ? (
                            <ArrowUp size={13} className="text-orange-600 stroke-[2.5]" />
                          ) : (
                            <ArrowDown size={13} className="text-orange-600 stroke-[2.5]" />
                          )
                        ) : (
                          <ArrowUpDown size={12} className="text-neutral-400 opacity-60" />
                        )}
                      </div>
                    </th>

                    {/* Ação */}
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider w-16">
                      Ação
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredTrendClients.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-neutral-400 font-bold text-xs">
                        Nenhum cliente ativo encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredTrendClients.map((item) => {
                      const isSelected = selectedClientId === item.clienteId;
                      const catInfo = item.trend.categoryInfo;

                      return (
                        <tr 
                          key={item.clienteId}
                          onClick={() => setSelectedClientId(current => current === item.clienteId ? null : item.clienteId)}
                          className={cn(
                            "hover:bg-orange-50/40 cursor-pointer transition-colors",
                            isSelected && "bg-orange-50/80 font-bold"
                          )}
                        >
                          {/* Cliente */}
                          <td className="py-3 px-3">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={cn(
                                  "text-xs font-bold text-neutral-900 leading-snug",
                                  isSelected && "text-orange-600 font-black"
                                )}>
                                  {item.clienteNome}
                                </span>
                                {item.recentAlert && (
                                  <span 
                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300 shrink-0"
                                    title={item.recentAlertReason || 'Alerta de queda recente'}
                                  >
                                    <span>⚠️</span>
                                    <span>Alerta</span>
                                  </span>
                                )}
                              </div>
                              <span className="text-[11px] text-neutral-400 font-medium">
                                {item.cidade}
                              </span>
                            </div>
                          </td>

                          {/* Venda Atual */}
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            <span className="text-xs font-black text-neutral-900">
                              {formatWeight(item.currentKg)}
                            </span>
                            <span className="text-[10px] text-neutral-400 font-medium block">
                              /mês
                            </span>
                          </td>

                          {/* Tendência */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <span className={cn(
                              "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border",
                              catInfo.badgeClass
                            )}>
                              <span>{catInfo.emoji}</span>
                              <span>{catInfo.label}</span>
                            </span>
                          </td>

                          {/* Variação */}
                          <td className="py-3 px-3 text-right whitespace-nowrap">
                            {item.trend.category === 'insufficient_data' ? (
                              <span className="text-[11px] font-medium text-neutral-400">
                                -
                              </span>
                            ) : (
                              <div className={cn(
                                "inline-flex items-center gap-0.5 text-xs font-black",
                                item.trend.totalTrendChangePct > 0 
                                  ? "text-emerald-600" 
                                  : item.trend.totalTrendChangePct < 0 
                                  ? "text-rose-600" 
                                  : "text-neutral-600"
                              )}>
                                {item.trend.totalTrendChangePct > 0 && <ArrowUpRight size={12} />}
                                {item.trend.totalTrendChangePct < 0 && <ArrowDownRight size={12} />}
                                {item.trend.totalTrendChangePct === 0 && <Minus size={12} />}
                                <span>
                                  {item.trend.totalTrendChangePct > 0 ? '+' : ''}
                                  {item.trend.totalTrendChangePct.toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Período */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <span className="text-xs font-semibold text-neutral-600">
                              {item.latestPeriodLabel}
                            </span>
                          </td>

                          {/* Ação */}
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedClientId(current => current === item.clienteId ? null : item.clienteId);
                              }}
                              className={cn(
                                "p-1.5 rounded-lg transition-colors",
                                isSelected
                                  ? "bg-orange-500 text-white shadow-sm"
                                  : "bg-neutral-100 text-neutral-600 hover:bg-orange-100 hover:text-orange-700"
                              )}
                              title={isSelected ? "Desmarcar cliente" : "Ver evolução no gráfico"}
                            >
                              <ChevronRight size={14} className={cn("transition-transform", isSelected && "rotate-90")} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 2: VISÃO GERAL & FATURAMENTO ================= */}
      {activeTab === 'visao_geral' && (
        <div className="flex flex-col gap-4">
          {/* Main KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Faturamento */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Faturamento (R$)
                </span>
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                  <DollarSign size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-neutral-900">
                  {formatCurrency(monthlyMetrics.currentFaturamento)}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className={cn(
                    "text-xs font-bold flex items-center",
                    monthlyMetrics.faturamentoGrowth >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {monthlyMetrics.faturamentoGrowth >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {Math.abs(monthlyMetrics.faturamentoGrowth).toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-neutral-400 font-medium">vs mês anterior</span>
                </div>
              </div>
            </div>

            {/* Volume em kg */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Volume Faturado
                </span>
                <div className="p-2 rounded-lg bg-orange-50 text-orange-600">
                  <Package size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-neutral-900">
                  {formatWeight(monthlyMetrics.currentKg)}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className={cn(
                    "text-xs font-bold flex items-center",
                    monthlyMetrics.kgGrowth >= 0 ? "text-emerald-600" : "text-rose-600"
                  )}>
                    {monthlyMetrics.kgGrowth >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {Math.abs(monthlyMetrics.kgGrowth).toFixed(1)}%
                  </span>
                  <span className="text-[11px] text-neutral-400 font-medium">vs mês anterior</span>
                </div>
              </div>
            </div>

            {/* Preço Médio / kg */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Preço Médio / kg
                </span>
                <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
                  <Activity size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-neutral-900">
                  {formatCurrency(monthlyMetrics.currentPrecoMedioKg)}
                </div>
                <p className="text-xs font-semibold text-neutral-500 mt-1">
                  Ticket Médio: {formatCurrency(monthlyMetrics.currentTicketMedio)}
                </p>
              </div>
            </div>

            {/* Positivação */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                  Positivação da Carteira
                </span>
                <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
                  <Users size={18} />
                </div>
              </div>
              <div className="mt-2">
                <div className="text-2xl font-black text-neutral-900">
                  {monthlyMetrics.positivacaoRate.toFixed(1)}%
                </div>
                <p className="text-xs font-semibold text-neutral-500 mt-1">
                  {monthlyMetrics.currentPositivadosCount} de {activeClientes.length} clientes ativos
                </p>
              </div>
            </div>
          </div>

          {/* Monthly Comparison History Chart */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-neutral-100">
              <div>
                <h3 className="text-sm font-black text-neutral-900 uppercase tracking-tight flex items-center gap-2">
                  <div className="w-1.5 h-3.5 bg-orange-500 rounded-full" />
                  Evolução Mensal ({monthlyMetricMode === 'volume' ? 'Volume em kg' : 'Faturamento em R$'}) por Ano
                </h3>
                <p className="text-xs font-medium text-neutral-500 mt-0.5">
                  Comparativo de desempenho mês a mês entre os anos da base
                </p>
              </div>

              {/* Selector for Metric: Volume (kg) vs Faturamento (R$) */}
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-1 shadow-sm shrink-0">
                <button
                  type="button"
                  id="btn-metric-volume"
                  onClick={() => setMonthlyMetricMode('volume')}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-black transition-all",
                    monthlyMetricMode === 'volume'
                      ? "bg-white text-orange-600 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  <Package size={14} />
                  Volume (kg)
                </button>
                <button
                  type="button"
                  id="btn-metric-faturamento"
                  onClick={() => setMonthlyMetricMode('faturamento')}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-black transition-all",
                    monthlyMetricMode === 'faturamento'
                      ? "bg-white text-emerald-600 shadow-sm"
                      : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  <DollarSign size={14} />
                  Faturamento (R$)
                </button>
              </div>
            </div>

            {/* Interactive Filters: Years & Months */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4 p-2.5 bg-neutral-50 rounded-xl border border-neutral-200/70">
              {/* Year toggles (Interactive Legend) */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-black text-neutral-500 uppercase tracking-wider mr-1">
                  Anos:
                </span>
                {availableYears.map(yr => {
                  const isYearSelected = selectedComparativeYears.includes(yr);
                  const yrColor = YEAR_COLORS[yr] || '#64748b';

                  return (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => {
                        setSelectedComparativeYears(prev => {
                          if (prev.includes(yr)) {
                            // Don't deselect all
                            if (prev.length === 1) return prev;
                            return prev.filter(y => y !== yr);
                          } else {
                            return [...prev, yr].sort((a, b) => a - b);
                          }
                        });
                      }}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border",
                        isYearSelected
                          ? "bg-white text-neutral-900 shadow-sm border-neutral-300"
                          : "bg-neutral-100 text-neutral-400 border-transparent opacity-50 hover:opacity-80"
                      )}
                      title={isYearSelected ? `Ocultar ano ${yr}` : `Exibir ano ${yr}`}
                    >
                      <span 
                        className="w-2.5 h-2.5 rounded-full" 
                        style={{ backgroundColor: isYearSelected ? yrColor : '#cbd5e1' }}
                      />
                      <span>{yr}</span>
                    </button>
                  );
                })}
              </div>

              {/* Month quick filters / toggle */}
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[11px] font-black text-neutral-500 uppercase tracking-wider mr-1">
                  Meses:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedComparativeMonths.length === 12) {
                      // If all are selected, clear all or keep just current month
                      setSelectedComparativeMonths([new Date().getMonth() + 1]);
                    } else {
                      // Select all 12 months
                      setSelectedComparativeMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
                    }
                  }}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-bold transition-all border",
                    selectedComparativeMonths.length === 12
                      ? "bg-neutral-800 text-white border-neutral-900 shadow-xs"
                      : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-100"
                  )}
                  title={selectedComparativeMonths.length === 12 ? "Alternar seleção de meses" : "Selecionar todos os meses"}
                >
                  Todos
                </button>
                {MONTH_NAMES.map(m => {
                  const isMonthSelected = selectedComparativeMonths.includes(m.num);
                  return (
                    <button
                      key={m.num}
                      type="button"
                      onClick={() => {
                        setSelectedComparativeMonths(prev => {
                          if (prev.includes(m.num)) {
                            if (prev.length === 1) return prev; // keep at least 1
                            return prev.filter(n => n !== m.num);
                          } else {
                            return [...prev, m.num].sort((a, b) => a - b);
                          }
                        });
                      }}
                      className={cn(
                        "px-2 py-0.5 rounded text-[11px] font-bold transition-colors",
                        isMonthSelected
                          ? "bg-orange-500 text-white shadow-xs"
                          : "bg-neutral-200/70 text-neutral-400 hover:bg-neutral-300 hover:text-neutral-700"
                      )}
                      title={isMonthSelected ? `Ocultar ${m.label}` : `Exibir ${m.label}`}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-80 sm:h-96 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={comparativeMonthlyData} margin={{ top: 12, right: 16, left: 10, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis 
                    dataKey="mesLabel" 
                    axisLine={{ stroke: '#e5e5e5' }}
                    tickLine={false} 
                    tick={{ fontSize: 11, fontWeight: 700, fill: '#737373' }}
                    dy={6}
                  />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#a3a3a3' }}
                    tickFormatter={(val) => 
                      monthlyMetricMode === 'faturamento' 
                        ? `R$ ${(val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k` 
                        : `${(val / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}k kg`
                    }
                    width={60}
                  />
                  <Tooltip 
                    contentStyle={{ 
                      borderRadius: '12px', 
                      border: '1px solid #e5e5e5', 
                      boxShadow: '0 10px 25px rgba(0,0,0,0.08)', 
                      fontSize: '11px',
                      padding: '10px 14px'
                    }}
                    formatter={(value: any, name: string) => [
                      monthlyMetricMode === 'faturamento' ? formatCurrency(Number(value)) : formatWeight(Number(value)),
                      `Ano ${name}`
                    ]}
                    labelFormatter={(label) => `Mês de ${label}`}
                  />
                  {[...selectedComparativeYears]
                    .sort((a, b) => a - b)
                    .map(yr => (
                      <Bar 
                        key={yr} 
                        dataKey={String(yr)} 
                        name={String(yr)} 
                        fill={YEAR_COLORS[yr] || '#64748b'} 
                        radius={[4, 4, 0, 0]} 
                      />
                    ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 3: CURVA ABC (PARETO) ================= */}
      {activeTab === 'curva_abc' && (
        <div className="flex flex-col gap-4">
          {/* Controls Bar */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Type Switcher: Clientes / Produtos */}
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setAbcType('clientes')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    abcType === 'clientes' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Clientes Ativos
                </button>
                <button
                  type="button"
                  onClick={() => setAbcType('produtos')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    abcType === 'produtos' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Produtos
                </button>
              </div>

              {/* Metric Switcher: Volume (kg) / Faturamento (R$) / Ponderado */}
              <div className="inline-flex flex-wrap rounded-lg border border-neutral-200 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setAbcMetric('volume')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    abcMetric === 'volume' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Por Volume (kg)
                </button>
                <button
                  type="button"
                  onClick={() => setAbcMetric('faturamento')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    abcMetric === 'faturamento' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Por Faturamento (R$)
                </button>
                <button
                  type="button"
                  onClick={() => setAbcMetric('ponderado')}
                  title="Média das participações no volume e no faturamento (50% cada)"
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    abcMetric === 'ponderado' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Ponderado (50/50)
                </button>
              </div>
            </div>

            {/* Classes Count Pills */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAbcClassFilter(current => current === 'A' ? 'all' : 'A')}
                className={cn(
                  "px-3 py-1.5 rounded-lg border text-xs font-black transition-all flex items-center gap-1.5",
                  abcClassFilter === 'A' ? "ring-2 ring-emerald-500 bg-emerald-50 text-emerald-700 border-emerald-300" : "bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-white"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>Classe A (80%):</span>
                <span className="font-extrabold">{abcData.countA}</span>
              </button>
              <button
                type="button"
                onClick={() => setAbcClassFilter(current => current === 'B' ? 'all' : 'B')}
                className={cn(
                  "px-3 py-1.5 rounded-lg border text-xs font-black transition-all flex items-center gap-1.5",
                  abcClassFilter === 'B' ? "ring-2 ring-amber-500 bg-amber-50 text-amber-700 border-amber-300" : "bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-white"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span>Classe B (15%):</span>
                <span className="font-extrabold">{abcData.countB}</span>
              </button>
              <button
                type="button"
                onClick={() => setAbcClassFilter(current => current === 'C' ? 'all' : 'C')}
                className={cn(
                  "px-3 py-1.5 rounded-lg border text-xs font-black transition-all flex items-center gap-1.5",
                  abcClassFilter === 'C' ? "ring-2 ring-rose-500 bg-rose-50 text-rose-700 border-rose-300" : "bg-neutral-50 text-neutral-700 border-neutral-200 hover:bg-white"
                )}
              >
                <span className="w-2 h-2 rounded-full bg-rose-500" />
                <span>Classe C (5%):</span>
                <span className="font-extrabold">{abcData.countC}</span>
              </button>
            </div>
          </div>

          {/* ABC Table */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={15} />
                <input
                  type="text"
                  placeholder={`Buscar ${abcType === 'clientes' ? 'cliente ou cidade...' : 'produto ou família...'}`}
                  value={abcSearchQuery}
                  onChange={(e) => setAbcSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-800 placeholder-neutral-400 outline-none focus:ring-2 focus:ring-orange-500"
                />
                {abcSearchQuery && (
                  <button 
                    type="button"
                    onClick={() => setAbcSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <span className="text-xs font-bold text-neutral-500">
                {abcMetric === 'ponderado'
                  ? 'Participação combinada: 50% volume + 50% faturamento'
                  : <>Total acumulado: {abcMetric === 'faturamento' ? formatCurrency(abcData.totalSum) : formatWeight(abcData.totalSum)}</>}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80">
                    <th className="py-2.5 px-3 text-xs font-black text-neutral-500 uppercase tracking-wider w-16 text-center">
                      Pos.
                    </th>
                    <th className="py-2.5 px-3 text-xs font-black text-neutral-500 uppercase tracking-wider">
                      {abcType === 'clientes' ? 'Cliente Ativo' : 'Produto'}
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Volume (kg)
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Faturamento (R$)
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Part. %
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Acumulado %
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Classe
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredAbcItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-neutral-400 font-bold text-xs">
                        Nenhum registro encontrado para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredAbcItems.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-3 text-center text-xs font-bold text-neutral-400">
                          #{idx + 1}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-neutral-900">{item.name}</span>
                            <span className="text-[11px] text-neutral-400 font-medium">{item.subText}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-800">
                          {formatWeight(item.totalKg)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-800">
                          {formatCurrency(item.totalVal)}
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-black text-neutral-700">
                          {item.sharePct.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-500">
                          {item.accumulatedPct.toFixed(1)}%
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={cn(
                            "px-2.5 py-0.5 rounded-full text-xs font-black border",
                            item.classe === 'A' ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                            item.classe === 'B' ? "bg-amber-100 text-amber-800 border-amber-300" :
                            "bg-rose-100 text-rose-800 border-rose-300"
                          )}>
                            Classe {item.classe}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 4: MIX DE PRODUTOS ================= */}
      {activeTab === 'mix_produtos' && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Mix Summary Cards */}
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Volume Total do Mix
              </span>
              <div className="text-2xl font-black text-neutral-900 mt-2">
                {formatWeight(productMixData.totalVolume)}
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Em {productMixData.families.length} famílias de produtos
              </p>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Faturamento Total do Mix
              </span>
              <div className="text-2xl font-black text-neutral-900 mt-2">
                {formatCurrency(productMixData.totalFaturamento)}
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Vendas da carteira ativa no período
              </p>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Preço Médio Consolidado
              </span>
              <div className="text-2xl font-black text-neutral-900 mt-2">
                {formatCurrency(productMixData.totalVolume > 0 ? productMixData.totalFaturamento / productMixData.totalVolume : 0)}
                <span className="text-xs font-bold text-neutral-400 ml-1">/kg</span>
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Média ponderada por quilograma
              </p>
            </div>
          </div>

          {/* Families Breakdown Table */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-100">
              <h3 className="text-sm font-black text-neutral-900 uppercase tracking-tight flex items-center gap-2">
                <div className="w-1.5 h-3.5 bg-orange-500 rounded-full" />
                Participação por Família de Produtos
              </h3>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80">
                    <th className="py-2.5 px-3 text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Família
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Volume (kg)
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Share Volume
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Faturamento (R$)
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Share Receita
                    </th>
                    <th className="py-2.5 px-3 text-right text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Preço Médio / kg
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {productMixData.families.map((fam, idx) => (
                    <tr key={fam.name} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-3 h-3 rounded-full shrink-0" 
                            style={{ backgroundColor: COLORS_FAMILIES[idx % COLORS_FAMILIES.length] }} 
                          />
                          <span className="text-xs font-black text-neutral-900">{fam.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-800">
                        {formatWeight(fam.totalKg)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-neutral-100 h-2 rounded-full overflow-hidden">
                            <div 
                              className="bg-orange-500 h-full rounded-full" 
                              style={{ width: `${Math.min(100, fam.shareKg)}%` }} 
                            />
                          </div>
                          <span className="text-xs font-black text-neutral-700 w-10 text-right">
                            {fam.shareKg.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-800">
                        {formatCurrency(fam.totalVal)}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <span className="text-xs font-bold text-neutral-600">
                          {fam.shareVal.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap text-xs font-bold text-neutral-900">
                        {formatCurrency(fam.precoMedioKg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ================= TAB 5: POSITIVAÇÃO DA CARTEIRA ================= */}
      {activeTab === 'positivacao' && (
        <div className="flex flex-col gap-4">
          {/* Header Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Clientes Ativos
              </span>
              <div className="text-2xl font-black text-neutral-900 mt-2">
                {activeClientes.length}
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Base total de clientes ativos
              </p>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Positivados no Mês
              </span>
              <div className="text-2xl font-black text-emerald-600 mt-2">
                {monthlyMetrics.currentPositivadosCount}
                <span className="text-xs font-bold text-neutral-400 ml-1.5">
                  ({monthlyMetrics.positivacaoRate.toFixed(1)}%)
                </span>
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Compraram em {format(currentMonthDate, 'MMMM/yyyy', { locale: ptBR })}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 p-4 shadow-sm">
              <span className="text-[11px] font-black text-neutral-400 uppercase tracking-wider">
                Pendentes de Compra
              </span>
              <div className="text-2xl font-black text-rose-600 mt-2">
                {activeClientes.length - monthlyMetrics.currentPositivadosCount}
                <span className="text-xs font-bold text-neutral-400 ml-1.5">
                  ({(100 - monthlyMetrics.positivacaoRate).toFixed(1)}%)
                </span>
              </div>
              <p className="text-xs font-semibold text-neutral-500 mt-0.5">
                Ainda não compraram neste mês
              </p>
            </div>
          </div>

          {/* Positivation Table */}
          <div className="bg-white rounded-xl border border-neutral-200 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="relative w-full sm:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={15} />
                <input
                  type="text"
                  placeholder="Buscar cliente ativo ou cidade..."
                  value={positivacaoSearchQuery}
                  onChange={(e) => setPositivacaoSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold text-neutral-800 placeholder-neutral-400 outline-none focus:ring-2 focus:ring-orange-500"
                />
                {positivacaoSearchQuery && (
                  <button 
                    type="button"
                    onClick={() => setPositivacaoSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* Status Filter */}
              <div className="inline-flex rounded-lg border border-neutral-200 bg-neutral-100 p-1">
                <button
                  type="button"
                  onClick={() => setPositivacaoStatusFilter('all')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    positivacaoStatusFilter === 'all' ? "bg-white text-orange-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Todos ({positivacaoData.length})
                </button>
                <button
                  type="button"
                  onClick={() => setPositivacaoStatusFilter('positivado')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    positivacaoStatusFilter === 'positivado' ? "bg-white text-emerald-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Positivados ({monthlyMetrics.currentPositivadosCount})
                </button>
                <button
                  type="button"
                  onClick={() => setPositivacaoStatusFilter('pendente')}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-black transition-all",
                    positivacaoStatusFilter === 'pendente' ? "bg-white text-rose-600 shadow-sm" : "text-neutral-600 hover:text-neutral-900"
                  )}
                >
                  Pendentes ({activeClientes.length - monthlyMetrics.currentPositivadosCount})
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 bg-neutral-50/80">
                    <th className="py-2.5 px-3 text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Cliente Ativo
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Status do Mês
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Última Compra
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Dias s/ Compra
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider">
                      Ciclo Ponderado
                    </th>
                    <th className="py-2.5 px-3 text-center text-xs font-black text-neutral-500 uppercase tracking-wider w-24">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {filteredPositivacaoList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-neutral-400 font-bold text-xs">
                        Nenhum cliente ativo encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredPositivacaoList.map((item) => (
                      <tr key={item.clienteId} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-neutral-900">{item.clienteNome}</span>
                            <span className="text-[11px] text-neutral-400 font-medium">{item.cidade}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          {item.isPositivado ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                              <CheckCircle2 size={12} />
                              Positivado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-300">
                              <Clock size={12} />
                              Pendente
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap text-xs font-semibold text-neutral-600">
                          {item.ultimaCompra ? format(parseISO(item.ultimaCompra), 'dd/MM/yyyy') : '-'}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <span className={cn(
                            "text-xs font-black",
                            item.daysSinceLastPurchase > 60 ? "text-rose-600 font-black" :
                            item.daysSinceLastPurchase > 30 ? "text-amber-600 font-bold" :
                            "text-neutral-700"
                          )}>
                            {item.daysSinceLastPurchase === 999 ? '-' : `${item.daysSinceLastPurchase} dias`}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap text-xs font-semibold text-neutral-600">
                          {item.cicloPonderado > 0 ? `${item.cicloPonderado} dias` : '-'}
                        </td>
                        <td className="py-3 px-3 text-center whitespace-nowrap">
                          <div className="flex items-center justify-center gap-1.5">
                            {item.telefone && (
                              <button
                                type="button"
                                onClick={() => sendWhatsAppMessage(item)}
                                className="p-1.5 rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
                                title="Enviar mensagem via WhatsApp"
                              >
                                <MessageCircle size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => navigate(`/clientes/${item.clienteId}`)}
                              className="p-1.5 rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition-colors"
                              title="Abrir ficha do cliente"
                            >
                              <ExternalLink size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 z-[200] bg-white/40 backdrop-blur-[2px] flex items-center justify-center">
          <div className="bg-white p-6 rounded-xl shadow-2xl border border-neutral-200 flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin" />
            <p className="text-xs font-bold text-neutral-600">Carregando histórico de vendas...</p>
          </div>
        </div>
      )}
    </div>
  );
}
