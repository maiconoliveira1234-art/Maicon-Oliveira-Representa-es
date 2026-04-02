import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Search,
  Save,
  Loader2,
  CheckCircle2,
  AlertCircle
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

  const produtosMap = useMemo(() => {
    const map: Record<string, Produto> = {};
    produtos.forEach(p => map[p.id] = p);
    return map;
  }, [produtos]);

  const stats = useMemo(() => {
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);
    const currentDay = getDate(now);
    const totalDays = getDaysInMonth(now);

    const currentMonthVendas = historico.filter(h => {
      const date = parseISO(h.faturamento);
      return isWithinInterval(date, { start, end });
    });

    const metaTotal = clientes.reduce((acc, c) => acc + (c.meta_kg || 0), 0);
    
    let realizadoTotal = 0;
    const realizadoPorCliente: Record<string, number> = {};

    currentMonthVendas.forEach(v => {
      const prod = produtosMap[v.produto_id];
      if (!prod) return;
      const weight = v.qtd * (prod.quant_embalagem || 1) * (prod.peso_embalagem || 0);
      realizadoTotal += weight;
      realizadoPorCliente[v.cliente_id] = (realizadoPorCliente[v.cliente_id] || 0) + weight;
    });

    const percentualAtual = metaTotal > 0 ? (realizadoTotal / metaTotal) * 100 : 0;
    const projetadoHoje = currentDay > 0 ? (realizadoTotal / currentDay) * totalDays : 0;
    const gapTotal = realizadoTotal - metaTotal;
    const esperadoPercent = (currentDay / totalDays) * 100;

    // Table Data
    const tableData = clientes.map(c => {
      const clienteVendas = historico.filter(h => h.cliente_id === c.id);
      const sortedVendas = [...clienteVendas].sort((a, b) => parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime());
      
      // Med 6: Average weight per month over last 6 months
      const sixMonthsAgo = subMonths(now, 6);
      const last6MonthsVendas = clienteVendas.filter(v => parseISO(v.faturamento) >= sixMonthsAgo);
      const weightTotal6Meses = last6MonthsVendas.reduce((acc, v) => {
        const prod = produtosMap[v.produto_id];
        return acc + (v.qtd * (prod?.quant_embalagem || 1) * (prod?.peso_embalagem || 0));
      }, 0);
      const med6 = weightTotal6Meses / 6;
      
      // Ult Ped: Days since last order
      const ultVenda = sortedVendas[0];
      const diasUltPedido = ultVenda ? differenceInDays(now, parseISO(ultVenda.faturamento)) : 0;
      
      // Méd Dias: Average cycle
      let medDias = 0;
      if (sortedVendas.length > 1) {
        const oldest = parseISO(sortedVendas[sortedVendas.length - 1].faturamento);
        const newest = parseISO(sortedVendas[0].faturamento);
        medDias = Math.round(differenceInDays(newest, oldest) / (sortedVendas.length - 1));
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
  }, [historico, clientes, produtosMap]);

  const filteredData = stats.tableData.filter(c => 
    c.cliente.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cidade?.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-0 border border-neutral-300 rounded-lg overflow-hidden shadow-sm bg-neutral-800 text-white">
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-700">
          <p className="text-[10px] font-bold uppercase opacity-70">Esperado</p>
          <p className="text-lg font-black">{stats.esperadoPercent.toFixed(2)}%</p>
        </div>
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-600">
          <p className="text-[10px] font-bold uppercase opacity-70">Atual</p>
          <p className="text-lg font-black">{stats.percentualAtual.toFixed(2)}%</p>
        </div>
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[10px] font-bold uppercase opacity-70">Projetado Hoje</p>
          <p className="text-lg font-black">{formatWeight(stats.projetadoHoje)}</p>
        </div>
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[10px] font-bold uppercase opacity-70">GAP</p>
          <p className={cn("text-lg font-black", stats.gapTotal >= 0 ? "text-green-400" : "text-red-400")}>
            {formatWeight(stats.gapTotal)}
          </p>
        </div>
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center bg-neutral-700">
          <p className="text-[10px] font-bold uppercase opacity-70">Data</p>
          <p className="text-lg font-black">{format(new Date(), 'dd/MM/yyyy')}</p>
        </div>
        <div className="p-3 border-r border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[10px] font-bold uppercase opacity-70">Meta</p>
          <p className="text-lg font-black">{formatWeight(stats.metaTotal)}</p>
        </div>
        <div className="p-3 border-b border-neutral-600 flex flex-col items-center justify-center">
          <p className="text-[10px] font-bold uppercase opacity-70">Vendas</p>
          <p className="text-lg font-black">{formatWeight(stats.realizadoTotal)}</p>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
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
        <div className="text-xs text-neutral-500 font-medium">
          Exibindo {filteredData.length} clientes
        </div>
      </div>

      {/* Spreadsheet Table */}
      <div className="bg-white rounded-xl border border-neutral-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[1000px]">
          <thead>
            <tr className="bg-neutral-50 text-[10px] font-bold uppercase text-neutral-500 border-b border-neutral-200">
              <th className="px-4 py-3 border-r border-neutral-200 sticky left-0 bg-neutral-50 z-10">Clientes</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-center">Data_</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-center">Local</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-right">Med. 6</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-center">Méd Dias</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-center">Últ Ped</th>
              <th className="px-2 py-3 border-r border-neutral-200 text-right">0%</th>
              <th className="px-4 py-3 border-r border-neutral-200 text-right bg-orange-50 text-orange-700">Meta (KG)</th>
              <th className="px-4 py-3 text-right">Vend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {filteredData.map((row) => (
              <tr key={row.id} className="hover:bg-neutral-50 transition-colors group">
                <td className="px-4 py-3 border-r border-neutral-200 font-bold text-neutral-800 text-xs sticky left-0 bg-white group-hover:bg-neutral-50 z-10">
                  {row.cliente}
                </td>
                <td className="px-2 py-3 border-r border-neutral-200 text-center text-xs text-neutral-500">
                  {row.dia_visita || '-'}
                </td>
                <td className="px-2 py-3 border-r border-neutral-200 text-center text-xs text-neutral-500 truncate max-w-[80px]">
                  {row.cidade?.substring(0, 3).toUpperCase() || 'N/A'}
                </td>
                <td className="px-2 py-3 border-r border-neutral-200 text-right text-xs text-neutral-600 font-medium">
                  {row.med6.toFixed(1)}
                </td>
                <td className="px-2 py-3 border-r border-neutral-200 text-center text-xs text-neutral-500">
                  {row.medDias || '-'}
                </td>
                <td className="px-2 py-3 border-r border-neutral-200 text-center text-xs text-neutral-500">
                  {row.ultPed}
                </td>
                <td className={cn(
                  "px-2 py-3 border-r border-neutral-200 text-right text-xs font-bold",
                  row.gap <= 0 ? "text-green-600" : "text-red-500"
                )}>
                  {row.gap}
                </td>
                <td className="px-2 py-2 border-r border-neutral-200 bg-orange-50/30">
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
                      className="w-full bg-transparent text-right pr-8 py-1 font-black text-orange-700 outline-none focus:ring-1 focus:ring-orange-500 rounded px-1"
                    />
                    <div className="absolute right-1">
                      {savingId === row.id ? (
                        <Loader2 size={12} className="animate-spin text-orange-500" />
                      ) : saveStatus?.id === row.id ? (
                        saveStatus.success ? (
                          <CheckCircle2 size={12} className="text-green-500" />
                        ) : (
                          <AlertCircle size={12} className="text-red-500" />
                        )
                      ) : (
                        <Save size={12} className="text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(
                  "px-4 py-3 text-right text-xs font-black",
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
