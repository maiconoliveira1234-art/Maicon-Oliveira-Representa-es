import React, { useState, useEffect, useMemo } from 'react';
import { 
  Settings2, 
  BarChart3, 
  Table as TableIcon, 
  Download, 
  Save, 
  FolderOpen, 
  Plus, 
  X, 
  ChevronRight, 
  ChevronDown,
  Filter,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Search,
  Check,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { format, parseISO, startOfMonth, endOfMonth, isWithinInterval, startOfYear, endOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import { toJpeg } from 'html-to-image';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---

type MetricType = 
  | 'revenue' 
  | 'weight' 
  | 'commission' 
  | 'quantity' 
  | 'orders' 
  | 'avg_ticket' 
  | 'positivation' 
  | 'goal' 
  | 'goal_achievement'
  | 'suggestion'
  | 'last_price'
  | 'suggested_unit_price';

type DimensionType = 
  | 'client' 
  | 'product' 
  | 'family' 
  | 'month' 
  | 'year' 
  | 'date'
  | 'vendedor';

interface ReportConfig {
  id?: string;
  name: string;
  metrics: MetricType[];
  dimensions: DimensionType[];
  filters: {
    clients: string[];
    products: string[];
    families: string[];
    startDate: string;
    endDate: string;
    years: number[];
    months: number[];
    activeOnly: boolean | null;
  };
  chartType: 'auto' | 'bar' | 'line' | 'pie' | 'area';
}

interface DataRow {
  [key: string]: any;
}

// --- Constants ---

const METRICS: { id: MetricType; label: string; description: string }[] = [
  { id: 'revenue', label: 'Faturamento', description: 'Soma de R$ Total' },
  { id: 'weight', label: 'Peso Vendido', description: 'Soma de Qtd * Peso' },
  { id: 'commission', label: 'Comissão', description: 'Soma de Comissões' },
  { id: 'quantity', label: 'Qtd Vendida', description: 'Soma de Quantidades' },
  { id: 'orders', label: 'Nº de Pedidos', description: 'Contagem de Pedidos Únicos' },
  { id: 'avg_ticket', label: 'Ticket Médio', description: 'Faturamento / Pedidos' },
  { id: 'positivation', label: 'Positivação', description: 'Clientes Únicos' },
  { id: 'goal', label: 'Meta', description: 'Soma de Metas' },
  { id: 'goal_achievement', label: '% Atingimento', description: 'Faturamento / Meta' },
  { id: 'suggestion', label: 'Sugestão Total', description: 'Soma de Qtd * Preço Sugerido' },
  { id: 'last_price', label: 'Último Preço Pago', description: 'Preço unitário da última compra' },
  { id: 'suggested_unit_price', label: 'Preço Sugerido (Un)', description: 'Preço de venda sugerido unitário' },
];

const DIMENSIONS: { id: DimensionType; label: string }[] = [
  { id: 'client', label: 'Cliente' },
  { id: 'product', label: 'Produto' },
  { id: 'family', label: 'Família' },
  { id: 'month', label: 'Mês' },
  { id: 'year', label: 'Ano' },
  { id: 'date', label: 'Data' },
  { id: 'vendedor', label: 'Vendedor' },
];

const COLORS = [
  '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899', 
  '#06b6d4', '#f59e0b', '#6366f1', '#14b8a6', '#f43f5e'
];

// --- Helper Components ---

interface FilterDropdownProps {
  label: string;
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

function FilterDropdown({ label, options, selected, onChange, placeholder = "Buscar..." }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = options.filter(opt => 
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const isAllSelected = filtered.length > 0 && filtered.every(opt => selected.includes(opt.id));

  const toggleAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    const filteredIds = filtered.map(opt => opt.id);
    if (isAllSelected) {
      onChange(selected.filter(id => !filteredIds.includes(id)));
    } else {
      onChange(Array.from(new Set([...selected, ...filteredIds])));
    }
  };

  const toggleOne = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  return (
    <div className="space-y-1.5 relative">
      <label className="text-[10px] font-bold text-neutral-500 uppercase flex justify-between items-center">
        {label}
        <span className="text-[9px] text-neutral-400 normal-case font-medium">
          {selected.length} selecionados
        </span>
      </label>
      
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full flex items-center justify-between p-2.5 bg-neutral-50 border rounded-xl text-xs font-bold transition-all text-left",
          isOpen ? "border-orange-500 ring-2 ring-orange-500/10" : "border-neutral-200 hover:border-neutral-300"
        )}
      >
        <span className="truncate pr-4">
          {selected.length === 0 
            ? "Todos" 
            : selected.length === options.length 
              ? "Todos Selecionados"
              : options.filter(o => selected.includes(o.id)).map(o => o.label).join(', ')
          }
        </span>
        <ChevronDown size={14} className={cn("shrink-0 transition-transform", isOpen && "rotate-180")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-full left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-2xl shadow-2xl z-50 flex flex-col max-h-80 overflow-hidden"
            >
              <div className="p-3 border-b border-neutral-100 space-y-2 bg-neutral-50/50">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input 
                    type="text"
                    placeholder={placeholder}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                    className="w-full pl-9 pr-3 py-2 bg-white border border-neutral-200 rounded-xl text-xs font-bold outline-none focus:border-orange-500"
                  />
                </div>
                <button
                  onClick={toggleAll}
                  className="w-full py-1.5 px-3 rounded-lg text-[10px] font-black uppercase tracking-wider bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 transition-all flex items-center justify-center gap-2"
                >
                  {isAllSelected ? <X size={12} /> : <Check size={12} />}
                  {isAllSelected ? "Desmarcar Todos" : "Selecionar Todos"}
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                {filtered.length === 0 ? (
                  <div className="p-4 text-center text-[10px] font-bold text-neutral-400 uppercase">Nenhum resultado</div>
                ) : (
                  filtered.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => toggleOne(opt.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-2 rounded-lg text-xs font-bold transition-all text-left",
                        selected.includes(opt.id) 
                          ? "bg-orange-50 text-orange-700" 
                          : "hover:bg-neutral-50 text-neutral-600"
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border flex items-center justify-center transition-all",
                        selected.includes(opt.id)
                          ? "bg-orange-600 border-orange-600 text-white"
                          : "border-neutral-300 bg-white"
                      )}>
                        {selected.includes(opt.id) && <Check size={10} strokeWidth={4} />}
                      </div>
                      <span className="truncate">{opt.label}</span>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Component ---

export function Reports() {
  // State
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<ReportConfig>({
    name: 'Novo Relatório',
    metrics: ['revenue'],
    dimensions: ['month'],
    filters: {
      clients: [],
      products: [],
      families: [],
      startDate: format(startOfYear(new Date()), 'yyyy-MM-dd'),
      endDate: format(new Date(), 'yyyy-MM-dd'),
      years: [new Date().getFullYear()],
      months: [],
      activeOnly: null,
    },
    chartType: 'auto',
  });

  const [data, setData] = useState<DataRow[]>([]);
  const [baseData, setBaseData] = useState<{
    clients: any[];
    products: any[];
    families: string[];
  }>({
    clients: [],
    products: [],
    families: [],
  });

  const [savedReports, setSavedReports] = useState<ReportConfig[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [reportName, setReportName] = useState('');

  // Load base data for filters
  useEffect(() => {
    async function loadBaseData() {
      try {
        const [
          { data: clients, error: cError },
          { data: products, error: pError },
        ] = await Promise.all([
          supabase.from('clientes').select('id, cliente, cidade, ativo'),
          supabase.from('produtos').select('id, produto, familia'),
        ]);

        if (cError) console.error('Error loading clients:', cError);
        if (pError) console.error('Error loading products:', pError);

        if (clients && products) {
          const families = Array.from(new Set(products.map(p => p.familia).filter(Boolean))) as string[];
          
          setBaseData({
            clients,
            products,
            families: families.sort(),
          });
        }
      } catch (err) {
        console.error('Unexpected error in loadBaseData:', err);
      }

      // Load saved reports from localStorage
      const saved = localStorage.getItem('commercial_saved_reports');
      if (saved) {
        setSavedReports(JSON.parse(saved));
      }
    }
    loadBaseData();
  }, []);

  // Fetch and Process Data
  const generateReport = async () => {
    setLoading(true);
    try {
      // 1. Fetch Sales Data
      let query = supabase.from('hist_vendas').select('*');

      // Apply basic filters in query if possible
      if (config.filters.startDate && config.filters.endDate) {
        query = query.gte('faturamento', config.filters.startDate)
                     .lte('faturamento', config.filters.endDate);
      }

      const { data: sales, error: salesError } = await query;
      if (salesError) throw salesError;

      // 2. Fetch Metas if needed
      let metas: any[] = [];
      if (config.metrics.includes('goal') || config.metrics.includes('goal_achievement')) {
        const { data: metasData } = await supabase.from('metas').select('*');
        metas = metasData || [];
      }

      // 3. Process and Aggregate
      const processedData = aggregateData(sales || [], metas, config, baseData);
      setData(processedData);

    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setLoading(false);
    }
  };

  // Aggregation Logic
  const aggregateData = (
    sales: any[], 
    metas: any[], 
    config: ReportConfig, 
    base: typeof baseData
  ): DataRow[] => {
    const { metrics, dimensions, filters } = config;
    
    // Maps for faster lookup
    const clientMap = Object.fromEntries(base.clients.map(c => [c.id, c]));
    const productMap = Object.fromEntries(base.products.map(p => [p.id, p]));

    // Filter sales
    const filteredSales = sales.filter(s => {
      const client = clientMap[s.cliente_id];
      const product = productMap[s.produto_id];

      if (filters.clients.length > 0 && !filters.clients.includes(s.cliente_id)) return false;
      if (filters.products.length > 0 && !filters.products.includes(s.produto_id)) return false;
      if (filters.families.length > 0 && product && !filters.families.includes(product.familia)) return false;
      if (filters.activeOnly !== null && client && client.ativo !== filters.activeOnly) return false;
      
      const date = parseISO(s.faturamento);
      if (filters.years.length > 0 && !filters.years.includes(date.getFullYear())) return false;
      if (filters.months.length > 0 && !filters.months.includes(date.getMonth() + 1)) return false;

      return true;
    });

    // Grouping
    const groups: Record<string, any> = {};

    filteredSales.forEach(s => {
      const client = clientMap[s.cliente_id];
      const product = productMap[s.produto_id];
      const date = parseISO(s.faturamento);

      // Generate group key
      const groupKeyParts = dimensions.map(d => {
        switch (d) {
          case 'client': return client?.cliente || 'Desconhecido';
          case 'product': return product?.produto || 'Desconhecido';
          case 'family': return product?.familia || 'Sem Família';
          case 'month': return format(date, 'MM/yyyy');
          case 'year': return format(date, 'yyyy');
          case 'date': return format(date, 'dd/MM/yyyy');
          case 'vendedor': return s.vendedor || 'Sem Vendedor';
          default: return 'Outros';
        }
      });
      const groupKey = groupKeyParts.join(' | ');

      if (!groups[groupKey]) {
        groups[groupKey] = {
          _key: groupKey,
          _orders: new Set(),
          _clients: new Set(),
          revenue: 0,
          weight: 0,
          commission: 0,
          quantity: 0,
          orders: 0,
          positivation: 0,
          goal: 0,
          suggestion: 0,
          last_price: 0,
          suggested_unit_price: 0,
          _last_date: null,
        };
        // Add dimension labels to the object
        dimensions.forEach((d, i) => {
          groups[groupKey][d] = groupKeyParts[i];
        });
      }

      const g = groups[groupKey];
      const revenue = Number(s["r$_total"] || 0);
      const qtd = Number(s.qtd || 0);
      const peso_emb = product?.peso_embalagem || s.peso_embalagem || 0;
      const comissao_perc = product?.comissao || 0;
      const sugestao_unit = product?.sugestao || 0;

      g.revenue += revenue;
      g.weight += qtd * peso_emb;
      g.commission += s.comissão ? Number(s.comissão) : (revenue * (comissao_perc / 100));
      g.quantity += qtd;
      g.suggestion += qtd * sugestao_unit;
      g.suggested_unit_price = sugestao_unit;

      // Track last price
      if (!g._last_date || date > g._last_date) {
        g._last_date = date;
        g.last_price = qtd > 0 ? revenue / qtd : 0;
      }
      
      if (s.pedido_id) g._orders.add(s.pedido_id);
      g._clients.add(s.cliente_id);
    });

    // Finalize metrics and add Metas
    const result = Object.values(groups).map(g => {
      g.orders = g._orders.size;
      g.positivation = g._clients.size;
      g.avg_ticket = g.orders > 0 ? g.revenue / g.orders : 0;
      
      // Goal calculation (simplified)
      // If dimension is client, we can use client.meta
      if (dimensions.includes('client')) {
        // Find client ID for this group
        const clientName = g.client;
        const client = base.clients.find(c => c.cliente === clientName);
        if (client) {
          g.goal = client.meta || 0;
        }
      } else if (dimensions.includes('month')) {
        // Sum all metas for that month
        g.goal = base.clients.reduce((acc, c) => acc + (c.meta || 0), 0);
      }

      g.goal_achievement = g.goal > 0 ? g.revenue / g.goal : 0;
      
      return g;
    });

    // Sort by first metric descending
    if (metrics.length > 0) {
      result.sort((a, b) => {
        const valA = a[metrics[0]];
        const valB = b[metrics[0]];
        if (typeof valA === 'number' && typeof valB === 'number') {
          return valB - valA;
        }
        return 0;
      });
    }

    return result;
  };

  // Chart Logic
  const autoChartType = useMemo(() => {
    if (config.chartType !== 'auto') return config.chartType;
    
    const dims = config.dimensions;
    if (dims.includes('month') || dims.includes('date') || dims.includes('year')) return 'line';
    if (dims.includes('family') || dims.includes('city')) return 'pie';
    return 'bar';
  }, [config.dimensions, config.chartType]);

  // Export
  const exportAsJpeg = () => {
    const node = document.getElementById('report-content');
    if (node) {
      setLoading(true);
      // Wait a bit for charts to render completely
      setTimeout(() => {
        toJpeg(node, { 
          backgroundColor: '#fff', 
          quality: 0.95,
          style: {
            padding: '20px',
            borderRadius: '0'
          }
        })
          .then((dataUrl) => {
            const link = document.createElement('a');
            link.download = `${config.name}_${format(new Date(), 'yyyyMMdd_HHmm')}.jpg`;
            link.href = dataUrl;
            link.click();
          })
          .catch((err) => {
            console.error('Export error:', err);
          })
          .finally(() => {
            setLoading(false);
          });
      }, 500);
    }
  };

  // Save/Load
  const saveReport = () => {
    if (!reportName.trim()) return;
    const newReport = { ...config, name: reportName, id: Date.now().toString() };
    const updated = [...savedReports, newReport];
    setSavedReports(updated);
    localStorage.setItem('commercial_saved_reports', JSON.stringify(updated));
    setShowSaveModal(false);
    setReportName('');
    // Update current config name
    setConfig(prev => ({ ...prev, name: reportName }));
  };

  const loadReport = (report: ReportConfig) => {
    setConfig(report);
    setShowLoadModal(false);
    // Optionally auto-generate
    // generateReport();
  };

  const deleteReport = (id: string) => {
    const updated = savedReports.filter(r => r.id !== id);
    setSavedReports(updated);
    localStorage.setItem('commercial_saved_reports', JSON.stringify(updated));
  };

  const clearFilters = () => {
    setConfig({
      ...config,
      filters: {
        clients: [],
        products: [],
        families: [],
        startDate: format(startOfYear(new Date()), 'yyyy-MM-dd'),
        endDate: format(new Date(), 'yyyy-MM-dd'),
        years: [new Date().getFullYear()],
        months: [],
        activeOnly: null,
      }
    });
  };

  // Formatters
  const formatValue = (val: number, metric: MetricType) => {
    if (metric === 'revenue' || metric === 'commission' || metric === 'avg_ticket' || metric === 'goal' || metric === 'suggestion' || metric === 'last_price' || metric === 'suggested_unit_price') {
      return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    }
    if (metric === 'weight') return `${val.toFixed(2)} kg`;
    if (metric === 'goal_achievement') return `${(val * 100).toFixed(1)}%`;
    return val.toLocaleString('pt-BR');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl font-black text-neutral-800 tracking-tight flex items-center gap-2">
            <BarChart3 className="text-orange-600" />
            Relatórios Customizáveis
          </h1>
          <p className="text-neutral-500 text-sm font-medium">Monte suas análises personalizadas</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowLoadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm font-bold text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            <FolderOpen size={18} />
            Abrir
          </button>
          <button 
            onClick={() => setShowSaveModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-neutral-200 rounded-xl text-sm font-bold text-neutral-600 hover:bg-neutral-50 transition-colors"
          >
            <Save size={18} />
            Salvar
          </button>
          <button 
            onClick={exportAsJpeg}
            className="flex items-center gap-2 px-4 py-2 bg-neutral-800 text-white rounded-xl text-sm font-bold hover:bg-neutral-900 transition-colors"
          >
            <Download size={18} />
            Exportar JPEG
          </button>
        </div>
      </header>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Sidebar Configuration */}
        <aside className="w-80 bg-white border border-neutral-200 rounded-2xl flex flex-col overflow-hidden shrink-0">
          <div className="p-4 border-b border-neutral-100 bg-neutral-50/50 flex items-center gap-2">
            <Settings2 size={18} className="text-orange-600" />
            <h2 className="font-black text-neutral-800 text-sm uppercase tracking-wider">Configuração</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
            {/* Metrics */}
            <section>
              <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest mb-3">Métricas</h3>
              <div className="grid grid-cols-1 gap-2">
                {METRICS.map(m => (
                  <label 
                    key={m.id}
                    className={cn(
                      "flex items-center justify-between p-2 rounded-lg border cursor-pointer transition-all",
                      config.metrics.includes(m.id) 
                        ? "bg-orange-50 border-orange-200 text-orange-700" 
                        : "bg-white border-neutral-100 text-neutral-600 hover:border-neutral-200"
                    )}
                  >
                    <div className="flex flex-col">
                      <span className="text-sm font-bold">{m.label}</span>
                      <span className="text-[10px] opacity-70">{m.description}</span>
                    </div>
                    <input 
                      type="checkbox"
                      className="hidden"
                      checked={config.metrics.includes(m.id)}
                      onChange={() => {
                        const next = config.metrics.includes(m.id)
                          ? config.metrics.filter(id => id !== m.id)
                          : [...config.metrics, m.id];
                        setConfig({ ...config, metrics: next });
                      }}
                    />
                    {config.metrics.includes(m.id) && <Check size={16} />}
                  </label>
                ))}
              </div>
            </section>

            {/* Dimensions */}
            <section>
              <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest mb-3">Dimensões (Agrupar por)</h3>
              <div className="flex flex-wrap gap-2">
                {DIMENSIONS.map(d => (
                  <button
                    key={d.id}
                    onClick={() => {
                      const next = config.dimensions.includes(d.id)
                        ? config.dimensions.filter(id => id !== d.id)
                        : [...config.dimensions, d.id];
                      setConfig({ ...config, dimensions: next });
                    }}
                    className={cn(
                      "px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                      config.dimensions.includes(d.id)
                        ? "bg-neutral-800 border-neutral-800 text-white"
                        : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-400"
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Filters */}
            <section className="space-y-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest">Filtros</h3>
                <button 
                  onClick={clearFilters}
                  className="text-[10px] font-bold text-orange-600 hover:text-orange-700 transition-colors"
                >
                  Limpar
                </button>
              </div>
              
              {/* Date Range */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase">Período</label>
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="date" 
                    value={config.filters.startDate}
                    onChange={e => setConfig({ ...config, filters: { ...config.filters, startDate: e.target.value } })}
                    className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold outline-none focus:border-orange-500"
                  />
                  <input 
                    type="date" 
                    value={config.filters.endDate}
                    onChange={e => setConfig({ ...config, filters: { ...config.filters, endDate: e.target.value } })}
                    className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold outline-none focus:border-orange-500"
                  />
                </div>
              </div>

              {/* Multi-selects via FilterDropdown */}
              <FilterDropdown 
                label="Cliente"
                options={baseData.clients.map(c => ({ id: c.id, label: c.cliente }))}
                selected={config.filters.clients}
                onChange={values => setConfig({ ...config, filters: { ...config.filters, clients: values } })}
                placeholder="Buscar cliente..."
              />

              <FilterDropdown 
                label="Família"
                options={baseData.families.map(f => ({ id: f, label: f }))}
                selected={config.filters.families}
                onChange={values => setConfig({ ...config, filters: { ...config.filters, families: values } })}
                placeholder="Buscar família..."
              />

              <FilterDropdown 
                label="Produto"
                options={baseData.products.map(p => ({ id: p.id, label: p.produto }))}
                selected={config.filters.products}
                onChange={values => setConfig({ ...config, filters: { ...config.filters, products: values } })}
                placeholder="Buscar produto..."
              />

              {/* Year/Month Filters */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Ano</label>
                  <select 
                    multiple
                    value={config.filters.years.map(String)}
                    onChange={e => {
                      const select = e.target as HTMLSelectElement;
                      const values = Array.from(select.selectedOptions, option => Number(option.value));
                      setConfig({ ...config, filters: { ...config.filters, years: values } });
                    }}
                    className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold outline-none focus:border-orange-500 h-20"
                  >
                    {[2023, 2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-neutral-500 uppercase">Mês</label>
                  <select 
                    multiple
                    value={config.filters.months.map(String)}
                    onChange={e => {
                      const select = e.target as HTMLSelectElement;
                      const values = Array.from(select.selectedOptions, option => Number(option.value));
                      setConfig({ ...config, filters: { ...config.filters, months: values } });
                    }}
                    className="w-full p-2 bg-neutral-50 border border-neutral-200 rounded-lg text-xs font-bold outline-none focus:border-orange-500 h-20"
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{format(new Date(2024, m - 1), 'MMM', { locale: ptBR })}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Active/Inactive */}
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase">Status Cliente</label>
                <div className="flex gap-2">
                  {[
                    { label: 'Todos', value: null },
                    { label: 'Ativos', value: true },
                    { label: 'Inativos', value: false },
                  ].map(s => (
                    <button
                      key={String(s.value)}
                      onClick={() => setConfig({ ...config, filters: { ...config.filters, activeOnly: s.value } })}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-[10px] font-bold border transition-all",
                        config.filters.activeOnly === s.value
                          ? "bg-neutral-800 border-neutral-800 text-white"
                          : "bg-white border-neutral-200 text-neutral-600 hover:border-neutral-300"
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Chart Type */}
            <section>
              <h3 className="text-xs font-black text-neutral-400 uppercase tracking-widest mb-3">Tipo de Gráfico</h3>
              <div className="grid grid-cols-5 gap-1">
                {[
                  { id: 'auto', icon: <Settings2 size={16} />, label: 'Auto' },
                  { id: 'bar', icon: <BarChart3 size={16} />, label: 'Barra' },
                  { id: 'line', icon: <LineChartIcon size={16} />, label: 'Linha' },
                  { id: 'pie', icon: <PieChartIcon size={16} />, label: 'Pizza' },
                  { id: 'area', icon: <LineChartIcon size={16} />, label: 'Área' },
                ].map(t => (
                  <button
                    key={t.id}
                    onClick={() => setConfig({ ...config, chartType: t.id as any })}
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1",
                      config.chartType === t.id
                        ? "bg-orange-50 border-orange-200 text-orange-600"
                        : "bg-white border-neutral-100 text-neutral-400 hover:border-neutral-200"
                    )}
                    title={t.label}
                  >
                    {t.icon}
                    <span className="text-[8px] font-black uppercase">{t.label}</span>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <div className="p-4 bg-neutral-50 border-t border-neutral-100">
            <button 
              onClick={generateReport}
              disabled={loading || config.metrics.length === 0 || config.dimensions.length === 0}
              className="w-full py-4 bg-orange-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-orange-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <BarChart3 size={18} />
              )}
              {loading ? 'Gerando...' : 'Gerar Relatório'}
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 bg-white border border-neutral-200 rounded-2xl flex flex-col overflow-hidden relative">
          {data.length === 0 && !loading ? (
            <div className="flex-1 flex flex-col items-center justify-center text-neutral-400 p-12 text-center">
              <div className="w-20 h-20 bg-neutral-50 rounded-full flex items-center justify-center mb-4">
                <BarChart3 size={40} />
              </div>
              <h2 className="text-xl font-black text-neutral-800 mb-2">Pronto para analisar?</h2>
              <p className="max-w-xs text-sm font-medium">Escolha as métricas e dimensões ao lado e clique em "Gerar Relatório" para visualizar os dados.</p>
            </div>
          ) : (
            <div id="report-content" className="flex-1 flex flex-col min-h-0 p-6 overflow-y-auto custom-scrollbar">
              {/* Chart Section */}
              <div className="h-80 shrink-0 mb-8 bg-neutral-50/50 rounded-2xl p-4 border border-neutral-100">
                <ResponsiveContainer width="100%" height="100%">
                  {autoChartType === 'pie' ? (
                    <PieChart>
                      <Pie
                        data={data.slice(0, 10)}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={5}
                        dataKey={config.metrics[0]}
                        nameKey={config.dimensions[0]}
                      >
                        {data.slice(0, 10).map((_, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        formatter={(val: any) => formatValue(val, config.metrics[0])}
                      />
                      <Legend />
                    </PieChart>
                  ) : autoChartType === 'line' ? (
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="_key" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        formatter={(val: any, name: any) => [formatValue(val, name as MetricType), METRICS.find(m => m.id === name)?.label]}
                      />
                      <Legend />
                      {config.metrics.map((m, i) => (
                        <Line 
                          key={m} 
                          type="monotone" 
                          dataKey={m} 
                          name={METRICS.find(met => met.id === m)?.label}
                          stroke={COLORS[i % COLORS.length]} 
                          strokeWidth={3}
                          dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                        />
                      ))}
                    </LineChart>
                  ) : autoChartType === 'area' ? (
                    <AreaChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="_key" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        formatter={(val: any, name: any) => [formatValue(val, name as MetricType), METRICS.find(m => m.id === name)?.label]}
                      />
                      <Legend />
                      {config.metrics.map((m, i) => (
                        <Area 
                          key={m} 
                          type="monotone" 
                          dataKey={m} 
                          name={METRICS.find(met => met.id === m)?.label}
                          stroke={COLORS[i % COLORS.length]} 
                          fill={COLORS[i % COLORS.length]} 
                          fillOpacity={0.1}
                        />
                      ))}
                    </AreaChart>
                  ) : (
                    <BarChart data={data.slice(0, 20)}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
                      <XAxis dataKey="_key" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700 }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        formatter={(val: any, name: any) => [formatValue(val, name as MetricType), METRICS.find(m => m.id === name)?.label]}
                      />
                      <Legend />
                      {config.metrics.map((m, i) => (
                        <Bar 
                          key={m} 
                          dataKey={m} 
                          name={METRICS.find(met => met.id === m)?.label}
                          fill={COLORS[i % COLORS.length]} 
                          radius={[4, 4, 0, 0]} 
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* Table Section */}
              <div className="flex-1 min-h-0">
                <div className="overflow-x-auto border border-neutral-100 rounded-2xl">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-neutral-50 border-b border-neutral-100">
                        {config.dimensions.map(d => (
                          <th key={d} className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest">
                            {DIMENSIONS.find(dim => dim.id === d)?.label}
                          </th>
                        ))}
                        {config.metrics.map(m => (
                          <th key={m} className="p-4 text-[10px] font-black text-neutral-400 uppercase tracking-widest text-right">
                            {METRICS.find(met => met.id === m)?.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row, i) => (
                        <tr key={i} className="border-b border-neutral-50 hover:bg-neutral-50/50 transition-colors">
                          {config.dimensions.map(d => (
                            <td key={d} className="p-4 text-sm font-bold text-neutral-700">
                              {row[d]}
                            </td>
                          ))}
                          {config.metrics.map(m => (
                            <td key={m} className="p-4 text-sm font-black text-neutral-900 text-right">
                              {formatValue(row[m], m)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Loading Overlay */}
          {loading && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-sm z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin" />
                <p className="text-sm font-black text-neutral-600 uppercase tracking-widest">Processando Dados...</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Save Modal */}
      <AnimatePresence>
        {showSaveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                <h3 className="text-lg font-black text-neutral-800">Salvar Relatório</h3>
                <button onClick={() => setShowSaveModal(false)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-black text-neutral-400 uppercase tracking-widest">Nome do Relatório</label>
                  <input 
                    type="text" 
                    value={reportName}
                    onChange={e => setReportName(e.target.value)}
                    placeholder="Ex: Vendas por Família 2024"
                    className="w-full p-4 bg-neutral-50 border border-neutral-200 rounded-2xl font-bold outline-none focus:border-orange-500 transition-all"
                  />
                </div>
                <button 
                  onClick={saveReport}
                  disabled={!reportName.trim()}
                  className="w-full py-4 bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest hover:bg-orange-700 transition-all disabled:opacity-50 shadow-lg shadow-orange-200"
                >
                  Confirmar e Salvar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Load Modal */}
      <AnimatePresence>
        {showLoadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-neutral-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
                <h3 className="text-lg font-black text-neutral-800">Relatórios Salvos</h3>
                <button onClick={() => setShowLoadModal(false)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                {savedReports.length === 0 ? (
                  <div className="text-center py-12 text-neutral-400">
                    <FolderOpen size={40} className="mx-auto mb-4 opacity-20" />
                    <p className="font-bold">Nenhum relatório salvo ainda.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {savedReports.map(r => (
                      <div 
                        key={r.id}
                        className="group flex items-center justify-between p-4 bg-neutral-50 border border-neutral-200 rounded-2xl hover:border-orange-300 hover:bg-orange-50/30 transition-all cursor-pointer"
                        onClick={() => loadReport(r)}
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-orange-600 shadow-sm">
                            <BarChart3 size={20} />
                          </div>
                          <div>
                            <h4 className="font-black text-neutral-800">{r.name}</h4>
                            <p className="text-[10px] text-neutral-500 font-bold uppercase tracking-widest">
                              {r.metrics.length} Métricas • {r.dimensions.length} Dimensões
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.id) deleteReport(r.id);
                          }}
                          className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e5e5e5;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #d4d4d4;
        }
      `}</style>
    </div>
  );
}
