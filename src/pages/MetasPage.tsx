import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Search,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Trash2,
  X
} from 'lucide-react';
import { Cliente, Produto, HistVenda } from '../types';
import { supabase } from '../lib/supabase';
import { cn, formatWeight } from '../lib/utils';
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

import { MOCK_CLIENTES, MOCK_PRODUTOS, MOCK_HISTORICO } from '../lib/mockData';

export function MetasPage() {
  const navigate = useNavigate();
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

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        
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
        setClientes(MOCK_CLIENTES);
        setProdutos(MOCK_PRODUTOS);
        setHistorico(MOCK_HISTORICO);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

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
      const sortedVendas = [...clienteVendas].sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());
      
      // Med 6: Average weight per month over last 6 completed months (excluding current month)
      const firstDayOfCurrentMonth = startOfMonth(now);
      const sixMonthsAgo = startOfMonth(subMonths(now, 6));
      
      const last6MonthsVendas = clienteVendas.filter(v => {
        const date = parseISO(v.faturamento);
        return date >= sixMonthsAgo && date < firstDayOfCurrentMonth;
      });

      const weightTotal6Meses = last6MonthsVendas.reduce((acc, v) => {
        const prod = produtosMap[v.produto_id];
        return acc + (v.qtd * (prod?.peso_embalagem || 0));
      }, 0);
      const med6 = weightTotal6Meses / 6;
      
      // Ult Ped: Days since last order
      const ultVenda = sortedVendas[0];
      const diasUltPedido = ultVenda ? differenceInDays(now, parseISO(ultVenda.faturamento)) : 0;
      
      // Méd Dias: Average cycle (Total days from first purchase to now / Number of unique purchase days)
      let medDias = 0;
      if (sortedVendas.length > 0) {
        const oldest = parseISO(sortedVendas[sortedVendas.length - 1].faturamento);
        const totalDaysSinceFirst = differenceInDays(now, oldest);
        
        // Get unique days of purchase
        const uniqueDays = new Set(clienteVendas.map(v => format(parseISO(v.faturamento), 'yyyy-MM-dd')));
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
    <div className="flex flex-col h-[calc(100vh-100px)] space-y-6 pb-4">
      <header className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-neutral-900">Gestão de Metas</h2>
          <p className="text-neutral-500 capitalize">{format(new Date(), 'MMMM yyyy', { locale: ptBR })}</p>
        </div>
      </header>

      {/* Spreadsheet Style Summary Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 border border-neutral-300 rounded-xl overflow-hidden shadow-md bg-neutral-800 text-white">
        {/* Group 1: Esperado & Atual */}
        <div className="p-3 border-r border-b lg:border-b-0 border-neutral-600 flex flex-col justify-center gap-2 bg-neutral-700/50">
          <div className="grid grid-cols-2 gap-3 px-1">
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-bold uppercase opacity-60">Esperado</p>
              <p className="text-lg font-black text-blue-400 leading-none">{stats.esperadoPercent.toFixed(2)}%</p>
              <div className="w-full h-1.5 bg-neutral-600 rounded-full overflow-hidden mt-1">
                <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${Math.min(100, stats.esperadoPercent)}%` }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[9px] font-bold uppercase opacity-60">Atual</p>
              <p className={cn("text-lg font-black leading-none", stats.percentualAtual >= stats.esperadoPercent ? "text-green-400" : "text-orange-400")}>
                {stats.percentualAtual.toFixed(2)}%
              </p>
              <div className="w-full h-1.5 bg-neutral-600 rounded-full overflow-hidden mt-1">
                <div className={cn("h-full transition-all duration-500", stats.percentualAtual >= stats.esperadoPercent ? "bg-green-500" : "bg-orange-500")} style={{ width: `${Math.min(100, stats.percentualAtual)}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Group 2: Início & Prazo Final */}
        <div className="p-3 border-r border-b lg:border-b-0 border-neutral-600 flex flex-col justify-center gap-2">
          <div className="flex justify-between items-center px-2">
            <div className="text-center flex-1">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">Início</p>
              <input 
                type="date" 
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="bg-transparent text-white text-sm font-black outline-none cursor-pointer hover:text-orange-400 transition-colors text-center w-full"
              />
            </div>
            <div className="h-8 w-[1px] bg-neutral-600 mx-2" />
            <div className="text-center flex-1">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">Prazo Final</p>
              <input 
                type="date" 
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="bg-transparent text-white text-sm font-black outline-none cursor-pointer hover:text-orange-400 transition-colors text-center w-full"
              />
            </div>
          </div>
        </div>

        {/* Group 3: Projetado Hoje & Vendas */}
        <div className="p-3 border-r border-b lg:border-b-0 border-neutral-600 flex flex-col justify-center gap-2 bg-neutral-700/50">
          <div className="flex justify-between items-center px-2">
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">Projetado Hoje</p>
              <p className="text-lg font-black text-neutral-300 leading-none">{formatWeight(stats.projetadoHoje)}</p>
            </div>
            <div className="h-8 w-[1px] bg-neutral-600 mx-2" />
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">Vendas</p>
              <p className="text-lg font-black text-white leading-none">{formatWeight(stats.realizadoTotal)}</p>
            </div>
          </div>
        </div>

        {/* Group 4: Meta & GAP */}
        <div className="p-3 border-neutral-600 flex flex-col justify-center gap-2">
          <div className="flex justify-between items-center px-2">
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">Meta Total</p>
              <p className="text-lg font-black text-white leading-none">{formatWeight(stats.metaTotal)}</p>
            </div>
            <div className="h-8 w-[1px] bg-neutral-600 mx-2" />
            <div className="text-center">
              <p className="text-[9px] font-bold uppercase opacity-60 mb-1">GAP</p>
              <p className={cn("text-lg font-black leading-none", stats.gapTotal >= 0 ? "text-green-400" : "text-red-400")}>
                {formatWeight(stats.gapTotal)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
            <input
              type="text"
              placeholder="Buscar cliente ou cidade..."
              className="w-full pl-10 pr-10 py-2 bg-white border border-neutral-200 rounded-xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none"
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
            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
            title="Zerar todas as metas"
          >
            <Trash2 size={14} />
          </button>
        </div>
        <div className="text-xs text-neutral-500 font-medium">
          Exibindo {sortedAndFilteredData.length} clientes
        </div>
      </div>

      {/* Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 animate-in fade-in zoom-in duration-200">
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
                className="flex-1 px-4 py-2 border border-neutral-200 rounded-xl font-bold text-neutral-600 hover:bg-neutral-50 transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={handleClearAllMetas}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors"
              >
                Sim, Limpar Tudo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spreadsheet Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden overflow-y-auto flex-1 h-full min-h-0">
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
                    : row.meta > 0 && row.vend >= row.meta 
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
