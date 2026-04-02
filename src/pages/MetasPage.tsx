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
  const [startDate, setStartDate] = useState<string>(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [deadlineDate, setDeadlineDate] = useState<string>(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({ key: 'cliente', direction: 'asc' });
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        
        // Load Clientes
        const { data: cData } = await supabase.from('clientes').select('*').order('cliente');
        setClientes(cData && cData.length > 0 ? cData : MOCK_CLIENTES);

        // Load Produtos
        const { data: pData } = await supabase.from('produtos').select('*');
        setProdutos(pData && pData.length > 0 ? pData : MOCK_PRODUTOS);

        // Load Historico (last 12 months for better averages)
        const twelveMonthsAgo = subMonths(new Date(), 12);
        
        const { data: hData } = await supabase
          .from('hist_vendas')
          .select('*')
          .gte('faturamento', twelveMonthsAgo.toISOString());
        
        setHistorico(hData && hData.length > 0 ? hData : MOCK_HISTORICO);
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

      const { error } = await supabase
        .from('clientes')
        .update({ meta_kg: newMeta })
        .eq('id', clienteId);

      if (error) throw error;

      setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, meta_kg: newMeta } : c));
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
      
      const { error } = await supabase
        .from('clientes')
        .update({ meta_kg: 0 })
        .in('id', activeIds);

      if (error) throw error;

      setClientes(prev => prev.map(c => 
        activeIds.includes(c.id) ? { ...c, meta_kg: 0 } : c
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
    const metaTotal = activeClientes.reduce((acc, c) => acc + (c.meta_kg || 0), 0);
    
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
      
      // Med 6: Average weight per month over last 6 months
      const sixMonthsAgo = subMonths(now, 6);
      const last6MonthsVendas = clienteVendas.filter(v => parseISO(v.faturamento) >= sixMonthsAgo);
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
    let data = stats.tableData.filter(c => 
      c.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cidade?.toLowerCase().includes(searchTerm.toLowerCase())
    );

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
    <div className="space-y-6 pb-20">
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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-0 border border-neutral-300 rounded-lg overflow-hidden shadow-sm bg-neutral-800 text-white text-[10px]">
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-700">
          <p className="text-[8px] font-bold uppercase opacity-70">Esperado</p>
          <p className="text-sm font-black">{stats.esperadoPercent.toFixed(2)}%</p>
          <div className="w-full h-1 bg-neutral-600 mt-1 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400" style={{ width: `${Math.min(100, stats.esperadoPercent)}%` }} />
          </div>
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-700">
          <p className="text-[8px] font-bold uppercase opacity-70">Início</p>
          <input 
            type="date" 
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-transparent text-white text-xs font-black outline-none cursor-pointer hover:text-orange-400 transition-colors text-center"
          />
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[8px] font-bold uppercase opacity-70">Projetado Hoje</p>
          <p className="text-sm font-black">{formatWeight(stats.projetadoHoje)}</p>
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[8px] font-bold uppercase opacity-70">GAP</p>
          <p className={cn("text-sm font-black", stats.gapTotal >= 0 ? "text-green-400" : "text-red-400")}>
            {formatWeight(stats.gapTotal)}
          </p>
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-600">
          <p className="text-[8px] font-bold uppercase opacity-70">Atual</p>
          <p className="text-sm font-black">{stats.percentualAtual.toFixed(2)}%</p>
          <div className="w-full h-1 bg-neutral-500 mt-1 rounded-full overflow-hidden">
            <div className={cn("h-full", stats.percentualAtual >= stats.esperadoPercent ? "bg-green-400" : "bg-orange-400")} style={{ width: `${Math.min(100, stats.percentualAtual)}%` }} />
          </div>
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-700">
          <p className="text-[8px] font-bold uppercase opacity-70">Prazo Final</p>
          <input 
            type="date" 
            value={deadlineDate}
            onChange={(e) => setDeadlineDate(e.target.value)}
            className="bg-transparent text-white text-xs font-black outline-none cursor-pointer hover:text-orange-400 transition-colors text-center"
          />
        </div>
        <div className="p-1.5 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[8px] font-bold uppercase opacity-70">Meta</p>
          <p className="text-sm font-black">{formatWeight(stats.metaTotal)}</p>
        </div>
        <div className="p-1.5 border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[8px] font-bold uppercase opacity-70">Vendas</p>
          <p className="text-sm font-black">{formatWeight(stats.realizadoTotal)}</p>
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
              className="w-full pl-10 pr-4 py-2 bg-white border border-neutral-200 rounded-xl shadow-sm focus:ring-2 focus:ring-orange-500 outline-none"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
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
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden overflow-y-auto max-h-[calc(100vh-320px)]">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead className="sticky top-0 z-20">
            <tr className="bg-neutral-50 text-[9px] font-bold uppercase text-neutral-500 border-b border-neutral-200">
              <th 
                className="px-3 py-2 border-r border-neutral-200 sticky left-0 bg-neutral-50 z-30 cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('cliente')}
              >
                Clientes
              </th>
              <th 
                className="px-2 py-2 border-r border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('med6')}
              >
                Med. 6
              </th>
              <th 
                className="px-2 py-2 border-r border-neutral-200 text-center cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('medDias')}
              >
                Méd Dias
              </th>
              <th 
                className="px-2 py-2 border-r border-neutral-200 text-center cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('ultPed')}
              >
                Últ Ped
              </th>
              <th 
                className="px-2 py-2 border-r border-neutral-200 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('gap')}
              >
                PRÓX PED
              </th>
              <th 
                className="px-3 py-2 border-r border-neutral-200 text-right bg-orange-50 text-orange-700 cursor-pointer hover:bg-orange-100 transition-colors"
                onClick={() => handleSort('meta_kg')}
              >
                Meta (KG)
              </th>
              <th 
                className="px-3 py-2 text-right cursor-pointer hover:bg-neutral-100 transition-colors"
                onClick={() => handleSort('vend')}
              >
                Vend
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sortedAndFilteredData.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50 transition-colors group">
                <td className="px-3 py-2 border-r border-neutral-200 font-bold text-neutral-800 text-[11px] sticky left-0 bg-white group-hover:bg-neutral-50 z-10">
                  {row.cliente}
                </td>
                <td className="px-2 py-2 border-r border-neutral-200 text-right text-[11px] text-neutral-600 font-medium">
                  {row.med6.toFixed(1)}
                </td>
                <td className="px-2 py-2 border-r border-neutral-200 text-center text-[11px] text-neutral-500">
                  {row.medDias || '-'}
                </td>
                <td className="px-2 py-2 border-r border-neutral-200 text-center text-[11px] text-neutral-500">
                  {row.ultPed}
                </td>
                <td className={cn(
                  "px-2 py-2 border-r border-neutral-200 text-right text-[11px] font-bold",
                  row.gap <= 0 ? "text-green-600" : "text-red-500"
                )}>
                  {row.gap}
                </td>
                <td className="px-2 py-1 border-r border-neutral-200 bg-orange-50/30">
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      defaultValue={row.meta_kg}
                      onBlur={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val !== row.meta_kg) {
                          handleUpdateMeta(row.id, val);
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const val = parseFloat((e.target as HTMLInputElement).value);
                          if (!isNaN(val) && val !== row.meta_kg) {
                            handleUpdateMeta(row.id, val);
                          }
                          (e.target as HTMLInputElement).blur();
                        }
                      }}
                      className="w-full bg-transparent text-right pr-6 py-0.5 font-black text-orange-700 outline-none focus:ring-1 focus:ring-orange-500 rounded px-1 text-[11px]"
                    />
                    <div className="absolute right-1">
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
                  "px-3 py-2 text-right text-[11px] font-black",
                  row.vend === 0 ? "bg-red-900 text-white" : "bg-neutral-50/50 text-neutral-800"
                )}>
                  {row.vend.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend / Info */}
      <div className="flex flex-wrap gap-4 text-[10px] text-neutral-400 font-bold uppercase tracking-widest">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-neutral-700 rounded-full"></div>
          <span>Med. 6: Média KG mensal (últimos 6 meses)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-neutral-700 rounded-full"></div>
          <span>Méd Dias: Ciclo médio de compra (dias)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-neutral-700 rounded-full"></div>
          <span>Últ Ped: Dias desde o último pedido</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 bg-neutral-700 rounded-full"></div>
          <span>0%: Atraso (Últ Ped - Méd Dias)</span>
        </div>
      </div>
    </div>
  );
}
