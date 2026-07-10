import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Search,
  Save,
  Target,
  CalendarDays,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  X
} from 'lucide-react';
import { Cliente, Produto, HistVenda } from '../types';
import { supabase } from '../lib/supabase';
import { cn, deduplicateSales, formatWeight } from '../lib/utils';
import { 
  startOfMonth, 
  endOfMonth, 
  isWithinInterval, 
  parseISO, 
  format, 
  getDate, 
  getDaysInMonth,
  differenceInDays,
  subMonths
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { classifySaleRecord } from '../lib/salesClassifier';
import { ActionButton, PageHeader } from '../components/ui/AppChrome';
import { useDataManager } from '../lib/dataManager';

import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from '../lib/mockData';

export function MetasPage() {
  const navigate = useNavigate();
  const {
    clientes: cachedClientes,
    produtos: cachedProdutos,
    metas: cachedMetas,
    hist_vendas: cachedHistorico
  } = useDataManager();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<{ id: string, success: boolean } | null>(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const saved = localStorage.getItem('metas_start_date');
    return saved || format(startOfMonth(new Date()), 'yyyy-MM-dd');
  });
  const [deadlineDate, setDeadlineDate] = useState<string>(() => {
    const saved = localStorage.getItem('metas_deadline_date');
    return saved || format(endOfMonth(new Date()), 'yyyy-MM-dd');
  });

  useEffect(() => {
    localStorage.setItem('metas_start_date', startDate);
  }, [startDate]);

  useEffect(() => {
    localStorage.setItem('metas_deadline_date', deadlineDate);
  }, [deadlineDate]);
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'cliente', direction: 'asc' });
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const resetAgendaVisitsToPending = async () => {
    try {
      const { data: visitasData, error: visitasError } = await supabase
        .from('agenda_visitas')
        .select('id, status, clientes!inner(ativo)')
        .eq('clientes.ativo', true);

      if (visitasError) throw visitasError;

      const pendingVisitIds = (visitasData || [])
        .filter(visita => visita.id && visita.status !== 'pendente')
        .map(visita => visita.id);

      if (pendingVisitIds.length === 0) return;

      const updatedAt = new Date().toISOString();
      for (let i = 0; i < pendingVisitIds.length; i += 100) {
        const batch = pendingVisitIds.slice(i, i + 100);
        const { error } = await supabase
          .from('agenda_visitas')
          .update({ status: 'pendente', updated_at: updatedAt })
          .in('id', batch);

        if (error) throw error;
      }
    } catch (err) {
      console.error('Erro ao redefinir visitas para pendente ao alterar janela de metas:', err);
    }
  };

  const handleStartDateChange = (value: string) => {
    if (value === startDate) return;
    setStartDate(value);
    if (value) void resetAgendaVisitsToPending();
  };

  const handleDeadlineDateChange = (value: string) => {
    if (value === deadlineDate) return;
    setDeadlineDate(value);
    if (value) void resetAgendaVisitsToPending();
  };

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const applyLocalData = () => {
          const localClientes = (cachedClientes.length > 0 ? cachedClientes : MOCK_CLIENTES).map(c => ({
            ...c,
            meta: cachedMetas[c.id] || c.meta || 0
          }));

          setClientes(localClientes);
          setProdutos(cachedProdutos.length > 0 ? cachedProdutos : MOCK_PRODUTOS);
          setHistorico(cachedHistorico.length > 0 ? deduplicateSales(cachedHistorico) : MOCK_HISTORICO);
        };

        applyLocalData();

        if (navigator.onLine === false) return;
        
        // Load Clientes
        const { data: cData } = await supabase.from('clientes').select('*').order('cliente');
        
        // Load Metas
        const { data: mData } = await supabase.from('metas').select('cliente_id, meta');
        
        const metasMap: Record<string, number> = {};
        if (mData) {
          mData.forEach(m => metasMap[m.cliente_id] = m.meta);
        }

        const finalClientes = (cData && cData.length > 0 ? cData : MOCK_CLIENTES).map(c => ({
          ...c,
          meta: metasMap[c.id] || 0
        }));

        setClientes(finalClientes);

        // Load Produtos
        const { data: pData } = await supabase.from('produtos').select('*');
        setProdutos(pData && pData.length > 0 ? pData : MOCK_PRODUTOS);

        // Load Historico (last 12 months for better averages)
        const twelveMonthsAgo = subMonths(new Date(), 12);
        
        const { data: hData } = await supabase
          .from('hist_vendas')
          .select('*')
          .gte('faturamento', twelveMonthsAgo.toISOString());
        
        if (hData) {
          const uniqueMap = new Map();
          hData.forEach((h: HistVenda) => {
            const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
            if (!uniqueMap.has(key)) {
              uniqueMap.set(key, h);
            }
          });
          setHistorico(Array.from(uniqueMap.values()) as HistVenda[]);
        } else {
          setHistorico(MOCK_HISTORICO);
        }
      } catch (err) {
        console.error('Erro ao carregar metas:', err);
        if (cachedClientes.length === 0 && cachedProdutos.length === 0 && cachedHistorico.length === 0) {
          setClientes(MOCK_CLIENTES);
          setProdutos(MOCK_PRODUTOS);
          setHistorico(MOCK_HISTORICO);
        }
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [cachedClientes, cachedProdutos, cachedMetas, cachedHistorico]);

  const handleUpdateMeta = async (clienteId: string, newMeta: number) => {
    try {
      setSavingId(clienteId);
      setSaveStatus(null);

      // Use upsert to save to 'metas' table
      const { error } = await supabase
        .from('metas')
        .upsert({ 
          cliente_id: clienteId, 
          meta: newMeta 
        }, { onConflict: 'cliente_id' });

      if (error) throw error;

      setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, meta: newMeta } : c));
      setSaveStatus({ id: clienteId, success: true });
      
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      console.error('Erro ao atualizar meta:', err);
      setSaveStatus({ id: clienteId, success: false });
    } finally {
      setSavingId(null);
    }
  };

  const handleClearAllMetas = async () => {
    try {
      setLoading(true);
      const activeIds = stats.tableData.map(c => c.id);
      
      // Delete from 'metas' table to clear
      const { error } = await supabase
        .from('metas')
        .delete()
        .in('cliente_id', activeIds);

      if (error) throw error;

      setClientes(prev => prev.map(c => 
        activeIds.includes(c.id) ? { ...c, meta: 0 } : c
      ));
      setShowClearConfirm(false);
    } catch (err) {
      console.error('Erro ao zerar metas:', err);
    } finally {
      setLoading(false);
    }
  };

  const produtosMap = useMemo(() => {
    const map: Record<string, Produto> = {};
    produtos.forEach(p => map[p.id] = p);
    return map;
  }, [produtos]);

  const stats = useMemo(() => {
    const now = new Date();
    const start = parseISO(startDate);
    const end = parseISO(deadlineDate);
    const totalDays = Math.max(1, differenceInDays(end, start) + 1);
    const daysPassed = Math.max(1, differenceInDays(now, start) + 1);

    const currentMonthVendas = historico.filter(h => {
      const date = parseISO(h.faturamento);
      return isWithinInterval(date, { start, end });
    });

    const activeClientes = clientes.filter(c => c.ativo);
    const metaTotal = activeClientes.reduce((acc, c) => acc + (c.meta || 0), 0);
    
    let realizadoTotal = 0;
    const realizadoPorCliente: Record<string, number> = {};

    currentMonthVendas.forEach(v => {
      if (!classifySaleRecord(v).entraMetas) return;
      const prod = produtosMap[v.produto_id];
      if (!prod) return;
      const weight = v.qtd * (prod.peso_embalagem || 0);
      realizadoTotal += weight;
      realizadoPorCliente[v.cliente_id] = (realizadoPorCliente[v.cliente_id] || 0) + weight;
    });

    const percentualAtual = metaTotal > 0 ? (realizadoTotal / metaTotal) * 100 : 0;
    const esperadoPercent = totalDays > 0 ? (daysPassed / totalDays) * 100 : 0;
    const projetadoHoje = metaTotal * (esperadoPercent / 100);
    const gapTotal = realizadoTotal - projetadoHoje;

    // Table Data
    const tableData = activeClientes.map(c => {
      const clienteVendas = historico.filter(h => h.cliente_id === c.id);
      
      // Med 6: Average weight per month over last 6 completed months (excluding current month)
      const firstDayOfCurrentMonth = startOfMonth(now);
      const sixMonthsAgo = startOfMonth(subMonths(now, 6));
      
      const last6MonthsVendas = clienteVendas.filter(v => {
        const date = parseISO(v.faturamento);
        return date >= sixMonthsAgo && date < firstDayOfCurrentMonth && classifySaleRecord(v).entraMetas;
      });

      const weightTotal6Meses = last6MonthsVendas.reduce((acc, v) => {
        const prod = produtosMap[v.produto_id];
        return acc + (v.qtd * (prod?.peso_embalagem || 0));
      }, 0);
      const med6 = weightTotal6Meses / 6;
      
      // Use only commercial sales for purchase cycle (exclude merchandising / gifts)
      const recompraVendas = clienteVendas.filter(v => classifySaleRecord(v).influenciaConsumo);
      const sortedRecompraVendas = [...recompraVendas]
        .sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());

      // Ult Ped: Days since last order
      const ultVenda = sortedRecompraVendas[0];
      const diasUltPedido = ultVenda ? differenceInDays(now, parseISO(ultVenda.faturamento)) : 0;
      
      // Méd Dias: Average cycle (Total days from first purchase to now / Number of unique purchase days)
      let medDias = 0;
      if (sortedRecompraVendas.length > 0) {
        const oldest = parseISO(sortedRecompraVendas[sortedRecompraVendas.length - 1].faturamento);
        const totalDaysSinceFirst = differenceInDays(now, oldest);
        
        // Get unique days of purchase
        const uniqueDays = new Set(recompraVendas
          .map(v => format(parseISO(v.faturamento), 'yyyy-MM-dd')));
        const uniqueDaysCount = uniqueDays.size;
        
        if (uniqueDaysCount > 0) {
          medDias = Math.round(totalDaysSinceFirst / uniqueDaysCount);
        }
      }

      const vendMes = realizadoPorCliente[c.id] || 0;
      const gapCliente = diasUltPedido - medDias;

      return {
        ...c,
        med6,
        medDias,
        ultPed: diasUltPedido,
        gap: gapCliente,
        vend: vendMes
      };
    });

    return {
      metaTotal,
      realizadoTotal,
      percentualAtual,
      projetadoHoje,
      gapTotal,
      esperadoPercent,
      tableData
    };
  }, [historico, clientes, produtosMap, startDate, deadlineDate]);

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev?.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'desc' };
    });
  };

  const sortedAndFilteredData = useMemo(() => {
    const searchWords = searchTerm.toLowerCase().split(' ').filter(word => word.length > 0);
    
    let data = stats.tableData.filter(c => {
      if (searchWords.length === 0) return true;
      
      const targetString = `${c.cliente} ${c.cidade || ''}`.toLowerCase();
      return searchWords.every(word => targetString.includes(word));
    });

    if (sortConfig) {
      data = [...data].sort((a, b) => {
        const aValue = a[sortConfig.key as keyof typeof a];
        const bValue = b[sortConfig.key as keyof typeof b];

        if (aValue === undefined || bValue === undefined) return 0;
        
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortConfig.direction === 'asc' 
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'asc' 
            ? aValue - bValue
            : bValue - aValue;
        }

        return 0;
      });
    }

    return data;
  }, [stats.tableData, searchTerm, sortConfig]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600"></div>
        <p className="text-neutral-500 font-medium">Carregando planilha de metas...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] space-y-3 pb-4">
      <PageHeader
        title="Gestão de Metas"
        subtitle={format(new Date(), 'MMMM yyyy', { locale: ptBR })}
        icon={<Target />}
        className="flex-row items-start justify-between gap-3 pb-3 [&>div:last-child]:self-start"
        actions={
          <ActionButton onClick={() => navigate(-1)} variant="secondary" size="sm" icon={<ArrowLeft />}>
            Voltar
          </ActionButton>
        }
      />

      {/* Executive Summary */}
      <div className="w-full min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm">
        <div className="grid min-w-0 grid-cols-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_270px]">
          <div className="min-w-0 space-y-2">
            <div className="grid min-w-0 grid-cols-1 gap-1.5 md:grid-cols-[repeat(2,minmax(0,1fr))]">
              <ProgressBar label="Esperado" value={stats.esperadoPercent} tone="blue" />
              <ProgressBar label="Atual" value={stats.percentualAtual} tone={stats.percentualAtual >= stats.esperadoPercent ? "green" : "orange"} />
            </div>

            <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5 sm:grid-cols-[repeat(4,minmax(0,1fr))]">
              <SummaryMetric label="Projetado" value={formatWeight(stats.projetadoHoje)} />
              <SummaryMetric label="Vendas" value={formatWeight(stats.realizadoTotal)} strong />
              <SummaryMetric label="Meta" value={formatWeight(stats.metaTotal)} />
              <div className={cn(
                "min-w-0 overflow-hidden rounded-md border px-2 py-1",
                stats.gapTotal >= 0 ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"
              )}>
                <p className="block max-w-full truncate text-[9px] font-black uppercase leading-none opacity-70">GAP</p>
                <p className="mt-0.5 block max-w-full truncate whitespace-nowrap text-[11px] font-black leading-tight sm:text-xs">{formatWeight(stats.gapTotal)}</p>
              </div>
            </div>
          </div>

          <div className="min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 p-2 lg:w-[270px] lg:justify-self-end">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wide text-neutral-400">
              <CalendarDays size={13} />
              Janela
            </div>
            <div className="grid min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
              <label className="block">
                <span className="sr-only">Inicio</span>
                <input 
                  type="date" 
                  value={startDate}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  className="h-7 w-full rounded-md border border-neutral-200 bg-white px-1.5 text-[10px] font-black text-neutral-800 outline-none transition-colors hover:border-neutral-300 focus:border-orange-500"
                />
              </label>
              <label className="block">
                <span className="sr-only">Prazo Final</span>
                <input 
                  type="date" 
                  value={deadlineDate}
                  onChange={(e) => handleDeadlineDateChange(e.target.value)}
                  className="h-7 w-full rounded-md border border-neutral-200 bg-white px-1.5 text-[10px] font-black text-neutral-800 outline-none transition-colors hover:border-neutral-300 focus:border-orange-500"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
            <input
              type="text"
              placeholder="Buscar cliente ou cidade..."
              className="w-full pl-9 pr-9 py-1.5 bg-white border border-neutral-200 rounded-lg shadow-sm focus:ring-2 focus:ring-orange-500 outline-none text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 p-1 transition-colors"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <button 
            onClick={() => setShowClearConfirm(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-red-400 transition-colors hover:border-red-100 hover:bg-red-50 hover:text-red-600"
            title="Zerar todas as metas"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="shrink-0 text-xs font-medium text-neutral-500 md:text-right">
          Exibindo {sortedAndFilteredData.length} clientes
        </div>
      </div>

      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-neutral-900">Confirmar Limpeza</h3>
              <button onClick={() => setShowClearConfirm(false)} className="p-1 hover:bg-neutral-100 rounded-full">
                <X size={20} />
              </button>
            </div>
            <p className="text-neutral-600 mb-6">
              Tem certeza que deseja zerar todas as metas dos clientes ativos? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 px-4 py-2 border border-neutral-200 rounded-lg font-bold text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleClearAllMetas}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors"
              >
                Sim, Limpar Tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spreadsheet Table */}
      <div className="bg-white rounded-lg border border-neutral-200 shadow-sm overflow-hidden overflow-y-auto flex-1 h-full min-h-0">
        <table className="w-full text-left border-separate border-spacing-0">
          <thead className="sticky top-0 z-20">
            <tr className="bg-neutral-50 text-[10px] font-bold uppercase text-neutral-500">
              <th 
                className="px-3 py-3 border-r border-b border-neutral-200 sticky left-0 bg-neutral-50 z-30 cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('cliente')}
              >
                Clientes
              </th>
              <th 
                className="w-14 px-1 py-3 border-r border-b border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('med6')}
              >
                Med. 6
              </th>
              <th 
                className="w-14 px-1 py-3 border-r border-b border-neutral-200 text-center cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('medDias')}
              >
                Méd Dias
              </th>
              <th 
                className="w-14 px-1 py-3 border-r border-b border-neutral-200 text-center cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('ultPed')}
              >
                Últ Ped
              </th>
              <th 
                className="w-16 px-1 py-3 border-r border-b border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('gap')}
              >
                PRÓX PED
              </th>
              <th 
                className="w-20 px-2 py-3 border-r border-b border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('meta')}
              >
                Meta (KG)
              </th>
              <th 
                className="w-16 px-2 py-3 border-b border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('vend')}
              >
                Vend
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sortedAndFilteredData.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50 transition-colors group">
                <td className="px-3 py-3 border-r border-b border-neutral-100 font-bold text-neutral-800 text-[12px] sticky left-0 bg-white group-hover:bg-neutral-50 z-10 leading-tight">
                  <button 
                    onClick={() => navigate(`/cliente/${row.id}`, { state: { fromMetas: true } })}
                    className="text-left hover:text-orange-600 transition-colors"
                  >
                    {row.cliente}
                  </button>
                </td>
                <td className="px-1 py-3 border-r border-b border-neutral-100 text-right text-[12px] text-neutral-600 font-medium">
                  {row.med6.toFixed(1)}
                </td>
                <td className="px-1 py-3 border-r border-b border-neutral-100 text-center text-[12px] text-neutral-500">
                  {row.medDias || '-'}
                </td>
                <td className="px-1 py-3 border-r border-b border-neutral-100 text-center text-[12px] text-neutral-500">
                  {row.ultPed}
                </td>
                <td className={cn(
                  "px-1 py-3 border-r border-b border-neutral-100 text-right text-[12px] font-bold",
                  row.gap <= 0 ? "text-green-600" : "text-red-500"
                )}>
                  {row.gap}
                </td>
                <td className="px-1 py-2 border-r border-b border-neutral-100">
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      inputMode="decimal"
                      pattern="[0-9]*[.,]?[0-9]*"
                      defaultValue={row.meta}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val !== row.meta) {
                          handleUpdateMeta(row.id, val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          if (!isNaN(val) && val !== row.meta) {
                            handleUpdateMeta(row.id, val);
                          }
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-full bg-transparent text-right pr-5 py-1 font-bold text-neutral-700 outline-none focus:ring-1 focus:ring-orange-500 rounded px-1 text-[12px]"
                    />
                    <div className="absolute right-0.5">
                      {savingId === row.id ? (
                        <Loader2 size={10} className="animate-spin text-orange-500" />
                      ) : saveStatus?.id === row.id ? (
                        saveStatus.success ? (
                          <CheckCircle2 size={10} className="text-green-500" />
                        ) : (
                          <AlertCircle size={10} className="text-red-500" />
                        )
                      ) : (
                        <Save size={10} className="text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(
                  "px-2 py-3 border-b border-neutral-100 text-right text-[12px] font-black transition-colors duration-300",
                  row.vend === 0 
                    ? "bg-red-600 text-white" 
                    : row.vend >= row.meta 
                      ? "bg-green-600 text-white"
                      : "bg-orange-500 text-white"
                )}>
                  {row.vend.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}

function ProgressBar({ label, value, tone }: { label: string; value: number; tone: 'blue' | 'green' | 'orange' }) {
  const toneClasses = {
    blue: 'bg-blue-500',
    green: 'bg-emerald-500',
    orange: 'bg-orange-500'
  };

  return (
    <div className="relative h-[26px] min-w-0 overflow-hidden rounded-md bg-neutral-100">
      <div className={cn("absolute inset-y-0 left-0 transition-all duration-500", toneClasses[tone])} style={{ width: `${Math.min(100, value)}%` }} />
      <div className="absolute inset-0 flex items-center justify-between gap-2 px-2.5 text-[10px] font-black">
        <span className="min-w-0 truncate text-neutral-800 mix-blend-multiply">{label}</span>
        <span className="shrink-0 rounded bg-white/85 px-1.5 py-0.5 text-[9px] text-neutral-900 shadow-sm">{value.toFixed(2)}%</span>
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1">
      <p className="block max-w-full truncate text-[9px] font-black uppercase leading-none text-neutral-400">{label}</p>
      <p className={cn("mt-0.5 block max-w-full truncate whitespace-nowrap text-[11px] font-black leading-tight sm:text-xs", strong ? "text-orange-600" : "text-neutral-900")}>{value}</p>
    </div>
  );
}
