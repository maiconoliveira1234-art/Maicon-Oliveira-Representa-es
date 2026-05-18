import React, { useState, useEffect, useMemo } from 'react';
import { Search, Filter, ChevronLeft, ChevronRight, Calendar as CalendarIcon, AlertCircle, RefreshCw, Loader2, CalendarDays, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  format, 
  addDays, 
  subDays, 
  isSameDay, 
  startOfToday,
  differenceInWeeks,
  startOfYear,
  differenceInDays,
  parseISO,
  subMonths,
  startOfMonth,
  endOfMonth,
  isWithinInterval
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { Visita, VisitaStatus, DiaSemana } from '../types/agenda';
import { agendaService } from '../services/agendaService';
import { AgendaStats } from '../components/agenda/AgendaStats';
import { VisitaCardCompact } from '../components/agenda/VisitaCardCompact';
import { AgendaMap } from '../components/agenda/AgendaMap';
import { VisitaDrawer } from '../components/agenda/VisitaDrawer';
import { AgendaDatePicker } from '../components/agenda/AgendaDatePicker';
import { supabase } from '../lib/supabase';
import { HistVenda, Produto } from '../types';
import { MapPin } from 'lucide-react';

const DIAS_MAP: Record<number, DiaSemana> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta'
};

export function AgendaPage() {
  // Data Flow
  const [visitas, setVisitas] = useState<Visita[]>([]);
  const [historico, setHistorico] = useState<HistVenda[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [metas, setMetas] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // View State
  const [selectedDate, setSelectedDate] = useState<Date>(startOfToday());
  const [selectedVisita, setSelectedVisita] = useState<Visita | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCity, setFilterCity] = useState('');
  const [filterStatus, setFilterStatus] = useState<VisitaStatus | 'todos'>('todos');
  const [viewType, setViewType] = useState<'list' | 'map'>('list');

  // Cycle Helper
  const getCycleWeek = (date: Date): 1 | 2 => {
    const anchor = startOfYear(date);
    const weeksSinceAnchor = differenceInWeeks(date, anchor);
    return (weeksSinceAnchor % 2 === 0) ? 1 : 2;
  };

  const getDayName = (date: Date): DiaSemana | null => {
    const dayIdx = date.getDay();
    return DIAS_MAP[dayIdx as keyof typeof DIAS_MAP] || null;
  };

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      setLoading(true);
      setError(null);
      
      const [agendaData, histDataRes, produtosRes, metasRes] = await Promise.all([
        agendaService.getVisitas(),
        supabase.from('hist_vendas').select('*').gte('faturamento', subMonths(new Date(), 12).toISOString()),
        supabase.from('produtos').select('*'),
        supabase.from('metas').select('cliente_id, meta')
      ]);

      setVisitas(agendaData);
      
      if (produtosRes.data) {
        setProdutos(produtosRes.data);
      }

      if (metasRes.data) {
        const map: Record<string, number> = {};
        metasRes.data.forEach(m => map[m.cliente_id] = m.meta);
        setMetas(map);
      }
      
      if (histDataRes.data) {
        const uniqueMap = new Map();
        histDataRes.data.forEach((h: HistVenda) => {
          const key = `${h.faturamento}-${h.cliente_id}-${h.produto_id || h.produtos}-${h.qtd}-${h["r$_total"]}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, h);
        });
        setHistorico(Array.from(uniqueMap.values()) as HistVenda[]);
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar dados');
    } finally {
      setLoading(false);
    }
  }

  async function fetchAgenda() {
    fetchData();
  }

  const gapsMap = useMemo(() => {
    const now = new Date();
    const map: Record<string, number> = {};
    
    // Group history by client
    const histByClient: Record<string, HistVenda[]> = {};
    historico.forEach(h => {
      if (!histByClient[h.cliente_id]) histByClient[h.cliente_id] = [];
      histByClient[h.cliente_id].push(h);
    });

    Object.keys(histByClient).forEach(clientId => {
      const clientHist = histByClient[clientId].sort((a, b) => 
        parseISO(b.faturamento).getTime() - parseISO(a.faturamento).getTime()
      );

      // Ult Ped: Days since last order
      const ultVenda = clientHist[0];
      const diasUltPedido = ultVenda ? differenceInDays(now, parseISO(ultVenda.faturamento)) : 0;

      // Méd Dias: Average cycle
      let medDias = 0;
      const oldest = parseISO(clientHist[clientHist.length - 1].faturamento);
      const totalDaysSinceFirst = differenceInDays(now, oldest);
      const uniqueDays = new Set(clientHist.map(v => format(parseISO(v.faturamento), 'yyyy-MM-dd')));
      if (uniqueDays.size > 0) {
        medDias = Math.round(totalDaysSinceFirst / uniqueDays.size);
      }

      map[clientId] = diasUltPedido - medDias;
    });

    return map;
  }, [historico]);

  async function handleStatusUpdate(id: string, newStatus: VisitaStatus) {
    try {
      const updated = await agendaService.updateStatus(id, newStatus);
      setVisitas(prev => prev.map(v => v.id === id ? updated : v));
      if (selectedVisita?.id === id) {
        setSelectedVisita(updated);
      }
    } catch (err: any) {
      alert('Erro ao atualizar status');
    }
  }

  async function handleNoteUpdate(id: string, note: string) {
    try {
      const updated = await agendaService.updateObservacoes(id, note);
      setVisitas(prev => prev.map(v => v.id === id ? updated : v));
      if (selectedVisita?.id === id) {
        setSelectedVisita(updated);
      }
    } catch (err: any) {
      alert('Erro ao atualizar nota');
    }
  }

  const filteredVisitas = useMemo(() => {
    const currentWeek = getCycleWeek(selectedDate);
    const currentDay = getDayName(selectedDate);

    return visitas.filter(v => {
      const matchesDay = v.semana === currentWeek && v.dia_semana === currentDay;
      const matchesSearch = (v.cliente_nome || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                          (v.cidade || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCity = !filterCity || v.cidade === filterCity;
      const matchesStatus = filterStatus === 'todos' || v.status === filterStatus;

      return matchesDay && matchesSearch && matchesCity && matchesStatus;
    }).sort((a, b) => {
      // Prioritize by Gap (Overdue first - higher gap is more overdue)
      const gapA = a.cliente_id ? (gapsMap[a.cliente_id] || -999) : -999;
      const gapB = b.cliente_id ? (gapsMap[b.cliente_id] || -999) : -999;
      
      if (gapA !== gapB) return gapB - gapA;
      
      // Fallback to time (earlier first)
      return (a.horario_inicio || '').localeCompare(b.horario_inicio || '');
    });
  }, [visitas, selectedDate, searchTerm, filterCity, filterStatus, gapsMap]);

  const agendaStatsData = useMemo(() => {
    const start = startOfMonth(selectedDate);
    const end = endOfMonth(selectedDate);
    const todayClients = filteredVisitas.map(v => v.cliente_id).filter(Boolean) as string[];
    
    // Meta do dia: sum of goals for today's clients
    const metaDia = todayClients.reduce((acc, cid) => acc + (metas[cid] || 0), 0);

    // Pedidos realizados: sum of weights for today's clients in the current month
    const produtosMap: Record<string, Produto> = {};
    produtos.forEach(p => produtosMap[p.id] = p);

    let realizadoTotal = 0;
    const currentMonthVendas = historico.filter(h => {
      const date = parseISO(h.faturamento);
      return isWithinInterval(date, { start, end }) && todayClients.includes(h.cliente_id);
    });

    currentMonthVendas.forEach(v => {
      const prod = produtosMap[v.produto_id];
      if (prod) {
        realizadoTotal += v.qtd * (prod.peso_embalagem || 0);
      }
    });

    return {
      visitasTotal: filteredVisitas.length,
      metaDia,
      realizadoTotal
    };
  }, [filteredVisitas, metas, historico, produtos, selectedDate]);

  const uniqueCities = Array.from(new Set(visitas.map(v => v.cidade))).sort();

  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-50 flex flex-col items-center justify-center p-8">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
          <Loader2 className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-orange-500 animate-pulse" size={24} />
        </div>
        <p className="mt-8 text-neutral-400 font-black text-xs uppercase tracking-[0.2em] animate-pulse">Sincronizando Agenda...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6 text-neutral-900">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto text-rose-500">
            <AlertCircle size={40} />
          </div>
          <h2 className="text-2xl font-black">Falha na Sincronização</h2>
          <p className="text-neutral-500 font-medium leading-relaxed">{error}</p>
          <button 
            onClick={fetchAgenda}
            className="w-full py-4 bg-neutral-900 text-white rounded-3xl font-black uppercase tracking-widest shadow-xl active:scale-95 transition-transform"
          >
            Tentar Restaurar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 pb-0 selection:bg-orange-500 selection:text-white">
      {/* Top Header */}
      <header className="sticky top-0 z-40 px-4 py-4 md:px-6 md:py-6">
        <div className="max-w-4xl mx-auto">
          {/* Main Control Card */}
          <div className="bg-white rounded-[1.5rem] border border-neutral-200 shadow-lg shadow-neutral-200/50 p-4 md:p-5 relative overflow-hidden">
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-orange-50 rounded-bl-[4rem] -z-10 opacity-50" />
            
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Left: Title & Info */}
              <div className="flex flex-col">
                <h1 className="text-lg md:text-xl font-black text-neutral-900 tracking-tighter uppercase leading-none">
                  {format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
                </h1>
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="px-2 py-0.5 bg-neutral-100 rounded-full text-[9px] font-black text-neutral-500 uppercase tracking-widest">
                    Ciclo: Semana {getCycleWeek(selectedDate)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    <span className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Sistema Ativo</span>
                  </div>
                </div>
              </div>

              {/* Right: Primary Action (Optimization) and Nav */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 bg-neutral-50 border border-neutral-200 p-1 rounded-xl">
                  <button 
                    onClick={() => setSelectedDate(subDays(selectedDate, 1))}
                    className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-900 hover:bg-white rounded-lg transition-all"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button 
                    onClick={() => setSelectedDate(startOfToday())}
                    className="px-3 h-8 text-[9px] font-black text-neutral-600 bg-white border border-neutral-200 rounded-lg shadow-sm active:scale-95 transition-all uppercase tracking-widest"
                  >
                    Hoje
                  </button>
                  <button 
                    onClick={() => setSelectedDate(addDays(selectedDate, 1))}
                    className="w-8 h-8 flex items-center justify-center text-neutral-400 hover:text-neutral-900 hover:bg-white rounded-lg transition-all"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Row: Secondary Tools */}
            <div className="mt-4 pt-4 border-t border-neutral-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                 <div className="text-[10px] font-bold text-neutral-400">
                   {filteredVisitas.length} VISITAS PROGRAMADAS
                 </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <button 
                    onClick={() => setShowDatePicker(!showDatePicker)}
                    className={cn(
                      "w-10 h-10 rounded-xl flex items-center justify-center border transition-all",
                      showDatePicker ? "bg-neutral-900 text-white border-neutral-900" : "text-neutral-400 border-neutral-200 bg-white hover:bg-neutral-50"
                    )}
                  >
                    <CalendarIcon size={18} />
                  </button>
                  <AgendaDatePicker 
                    isOpen={showDatePicker}
                    onClose={() => setShowDatePicker(false)}
                    selectedDate={selectedDate}
                    onSelect={setSelectedDate}
                    visitas={visitas}
                  />
                </div>
                <button 
                   onClick={() => setShowFilters(!showFilters)}
                   className={cn(
                     "w-11 h-11 rounded-2xl flex items-center justify-center border transition-all",
                     showFilters ? "bg-neutral-900 text-white border-neutral-900" : "text-neutral-400 border-neutral-200 bg-white hover:bg-neutral-50"
                   )}
                >
                  <Filter size={20} />
                </button>
                <button 
                   onClick={() => setViewType(viewType === 'list' ? 'map' : 'list')}
                   className={cn(
                     "w-11 h-11 rounded-2xl flex items-center justify-center border transition-all",
                     viewType === 'map' ? "bg-orange-600 text-white border-orange-600 shadow-lg shadow-orange-500/20" : "text-neutral-400 border-neutral-200 bg-white hover:bg-neutral-50"
                   )}
                >
                  <MapIcon size={20} />
                </button>
                <button 
                   onClick={fetchAgenda}
                   className="w-11 h-11 rounded-2xl flex items-center justify-center border border-neutral-200 bg-white text-neutral-400 hover:bg-neutral-50 transition-all active:rotate-180 duration-500 shadow-sm"
                >
                  <RefreshCw size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-6 mt-4">
        <AgendaStats 
          visitasTotal={agendaStatsData.visitasTotal} 
          metaDia={agendaStatsData.metaDia}
          realizadoTotal={agendaStatsData.realizadoTotal}
        />

        {viewType === 'map' && (
          <AgendaMap 
            visitas={filteredVisitas}
            selectedVisita={selectedVisita}
            onSelectVisita={(v) => {
              setSelectedVisita(v);
              setIsDrawerOpen(true);
            }}
          />
        )}

        {/* Filters Panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-8"
            >
              <div className="p-3 bg-white border border-neutral-200 rounded-[1.5rem] grid grid-cols-1 md:grid-cols-3 gap-3 shadow-sm">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
                  <input 
                    type="text"
                    placeholder="Filtrar por cliente..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl pl-11 pr-4 py-3 text-sm font-bold text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-orange-500 transition-all"
                  />
                </div>
                <select 
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  className="bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-3 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500"
                >
                  <option value="">Todas as cidades</option>
                  {uniqueCities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value as any)}
                  className="bg-neutral-50 border border-neutral-200 rounded-2xl px-4 py-3 text-sm font-bold text-neutral-900 outline-none focus:border-orange-500"
                >
                  <option value="todos">Todos status</option>
                  <option value="pendente">Pendente</option>
                  <option value="concluida">Concluída</option>
                  <option value="reagendada">Reagendada</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Day Header Context for Mobile */}
        <div className="flex md:hidden items-center justify-between mb-6">
           <button 
             onClick={() => setSelectedDate(subDays(selectedDate, 1))}
             className="w-12 h-12 bg-white border border-neutral-200 rounded-2xl flex items-center justify-center text-neutral-900 active:scale-90 transition-transform shadow-sm"
           >
             <ChevronLeft size={24} />
           </button>
           <div className="text-center">
             <div className="text-xl font-black text-neutral-900">{format(selectedDate, 'dd/MM')}</div>
             <div className="text-[10px] font-black text-orange-600 uppercase tracking-widest">{format(selectedDate, 'EEEE', { locale: ptBR })}</div>
           </div>
           <button 
             onClick={() => setSelectedDate(addDays(selectedDate, 1))}
             className="w-12 h-12 bg-white border border-neutral-200 rounded-2xl flex items-center justify-center text-neutral-900 active:scale-90 transition-transform shadow-sm"
           >
             <ChevronRight size={24} />
           </button>
        </div>

        {/* Timeline Header */}
        <div className="flex items-center gap-3 mb-4 px-2">
           <div className="h-px bg-neutral-200 flex-1" />
           <div className="text-[9px] font-black text-neutral-400 uppercase tracking-[0.3em]">Timeline do Dia</div>
           <div className="h-px bg-neutral-200 flex-1" />
        </div>

        {/* Visitas List */}
        <div className="flex-1 flex flex-col space-y-2">
          {filteredVisitas.length > 0 ? (
            filteredVisitas.map((v) => (
              <motion.div
                key={v.id}
                layout
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              >
                <VisitaCardCompact 
                  visita={v} 
                  gap={v.cliente_id ? gapsMap[v.cliente_id] : undefined}
                  onClick={() => {
                    setSelectedVisita(v);
                    setIsDrawerOpen(true);
                  }} 
                />
              </motion.div>
            ))
          ) : (
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               className="bg-white border-2 border-dashed border-neutral-200 rounded-[3rem] py-20 px-8 text-center"
            >
              <div className="w-16 h-16 bg-neutral-50 border border-neutral-200 rounded-3xl flex items-center justify-center mx-auto mb-6 text-neutral-300">
                <CalendarDays size={32} />
              </div>
              <h3 className="text-xl font-black text-neutral-900">Nenhuma visita agendada</h3>
              <p className="text-neutral-500 max-w-sm mx-auto mt-4 font-medium leading-relaxed">
                Você não possui roteiro programado para este dia. Aproveite para prospectar ou descansar.
              </p>
            </motion.div>
          )}

          {filteredVisitas.length > 0 && (
            <div className="mt-auto pt-2 pb-2 flex items-center justify-center">
               <div className="flex flex-col items-center gap-1">
                  <div className="w-1 h-3 bg-gradient-to-b from-neutral-200 to-transparent rounded-full" />
                  <span className="text-[9px] font-black text-neutral-300 uppercase tracking-widest">Fim da Agenda</span>
               </div>
            </div>
          )}
        </div>
      </main>

      {/* Drawer */}
      <VisitaDrawer 
        isOpen={isDrawerOpen}
        visita={selectedVisita}
        onClose={() => setIsDrawerOpen(false)}
        onStatusChange={(status) => selectedVisita && handleStatusUpdate(selectedVisita.id, status)}
        onNoteChange={(note) => selectedVisita && handleNoteUpdate(selectedVisita.id, note)}
      />
    </div>
  );
}
